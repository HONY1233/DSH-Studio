/**
 * 主区面板 —— 工作台挂到 DSH `main` 槽 `conversation` 键上的组件。
 *
 * 所有单例（面板注册表 / 租约注册表 / 派生缓存 / 布局控制器）都在 `apply()`
 * 里创建后闭包传入，**不放在 React 生命周期里**：插件重载时 Cordis 会统一
 * dispose，放在组件里会让「热重载一次泄漏一份注册表」。
 *
 * 三个职责：
 * 1) `renderContent`：tab → 面板 / 会话正文；
 * 2) 空态入口：新建会话走真实 `ctx.sessions.create()`；
 * 3) 首次挂载时把最近一场会话铺开，避免打开客户端看到一片空白。
 */

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react'

import type { DerivedCache } from '../session-derived/cache.js'
import type { PanelRegistry } from '../ui-panel-host/registry.js'
import { PanelHost } from '../ui-panel-host/host.js'
import type { SessionLeaseRegistry } from '../ui-session-views/leases.js'
import { SessionTabView, sessionIdOf, type SessionTabViewLabels } from '../ui-session-views/index.js'
import { SessionViewsProvider } from '../ui-session-views/provider.js'
import type { WorkbenchController } from '../ui-workbench/controller.js'
import { placeOps, type Placement } from '../ui-workbench/placement.js'
import { browserStorage, PlacementMemory } from '../ui-workbench/placement-memory.js'
import { WorkbenchView, type WorkbenchLabels } from '../ui-workbench/workbench-view.js'
import { makeTab, type Tab } from '../workbench/layout.js'
import type { ConversationBodyLabels } from './conversation-body.js'
import type { SessionEventHub } from './event-hub.js'
import { PanelErrorBoundary } from './error-boundary.js'
import { ServiceSlot, useServiceSlot } from './service-slot.js'
import { SessionPane } from './session-pane.js'
import { openSessionInWorkbench, workbenchHasTabs } from './open-session.js'
import { StudioTopbar } from './topbar.js'

/** `ctx.sessions.list` 的最小形状（`ObservableSnapshot<SessionListState>`）。 */
export interface SessionListLike {
  getSnapshot(): {
    readonly ids: readonly string[]
    readonly byId: Readonly<Record<string, { readonly displayTitle?: string; readonly title?: string }>>
  }
  subscribe(listener: () => void): () => void
}

/**
 * 落位记忆是模块级单例：它对应"用户偏好"，生命周期就该跨组件挂载/卸载，
 * 甚至跨会话。放进组件里会在插件重载后丢记忆。
 */
const PLACEMENT_MEMORY = new PlacementMemory(browserStorage())

/** 我们从 client ctx 用到的全部面。 */export interface StudioContext {
  readonly sessions: {
    create(options?: Record<string, unknown>): Promise<string>
    readonly list: SessionListLike
  }
}

export interface StudioMainPanelProps {
  readonly ctx: StudioContext
  readonly controller: WorkbenchController
  readonly leases: SessionLeaseRegistry
  readonly derived: DerivedCache
  readonly hub: SessionEventHub
  readonly panels: PanelRegistry
  readonly labels: WorkbenchLabels
  readonly sessionLabels: SessionTabViewLabels
  readonly conversationLabels?: ConversationBodyLabels
  /** 附件服务槽（条件注入的可订阅视图）。 */
  readonly fileUploadSlot?: ServiceSlot<unknown>
}

/** 没有外部槽时的兜底（模块级常量，身份稳定）。 */
const EMPTY_UPLOAD_SLOT = new ServiceSlot<unknown>()

function Tombstone(props: { readonly what: string; readonly id: string }): ReactNode {
  return (
    <div
      data-testid={`tombstone-${props.what}`}
      role="alert"
      style={{
        display: 'grid',
        placeItems: 'center',
        gap: 4,
        height: '100%',
        padding: 16,
        fontSize: 12,
        color: 'var(--color-text-tertiary, #8a8a85)',
      }}
    >
      <div>{props.what === 'panel' ? '找不到这个面板' : '这个标签的类型不认识'}</div>
      <code style={{ fontSize: 10, opacity: 0.7 }}>{props.id}</code>
    </div>
  )
}

export function StudioMainPanel(props: StudioMainPanelProps): ReactNode {
  const { ctx, controller, leases, derived, hub, panels, labels, sessionLabels } = props
  const conversationLabels = props.conversationLabels
  // 附件服务可能在插件加载后才就绪；这里订阅槽，就绪后自动重渲染。
  // 用常量空槽兜底，**不能**写成 `slot ? useServiceSlot(slot) : undefined` ——
  // 那是条件调用 hook，hook 数量会随 prop 变化而变。
  const uploader = useServiceSlot(props.fileUploadSlot ?? EMPTY_UPLOAD_SLOT)

  // 会话列表：标题与"首次铺开"都来自它。
  const subscribeList = useCallback((listener: () => void) => ctx.sessions.list.subscribe(listener), [ctx])
  const getList = useCallback(() => ctx.sessions.list.getSnapshot(), [ctx])
  const list = useSyncExternalStore(subscribeList, getList, getList)

  const titleOf = useCallback(
    (sessionId: string): string => {
      const row = list.byId[sessionId]
      const title = row?.displayTitle ?? row?.title
      return title && title.length > 0 ? title : sessionId.slice(0, 8)
    },
    [list],
  )

  const resolveTitle = useCallback(
    (tab: Tab): string => {
      if (tab.title) return tab.title
      const sessionId = sessionIdOf(tab.ref)
      if (sessionId) return titleOf(sessionId)
      const contribution = panels.get(tab.ref.contentId)
      return contribution?.title.zh ?? tab.ref.instanceId
    },
    [panels, titleOf],
  )

  const openConversation = useCallback(
    (sessionId: string): void => {
      openSessionInWorkbench(controller, sessionId)
    },
    [controller],
  )

  const onNewConversation = useCallback((): void => {
    void ctx.sessions
      .create({})
      .then((sessionId) => openConversation(String(sessionId)))
      .catch((error: unknown) => {
        console.error('[studio] 新建会话失败', error)
      })
  }, [ctx, openConversation])

  const openPanel = useCallback(
    (panelId: string, placement?: Placement, options?: { readonly remember?: boolean }): void => {
      const contribution = panels.get(panelId)
      if (!contribution) return
      // 多实例面板要给唯一 instanceId（持久化键与 React key 都用它）
      const instanceId = contribution.multi ? `${panelId}@${controller.mint.tab()}` : panelId
      const tab = makeTab(controller.mint.tab(), { kind: 'panel', contentId: panelId, instanceId })

      // 优先级：本次明确选择 > 上次记忆 > 面板声明。记忆跟着"打开"这个动作更新，
      // 菜单里的「默认」会把它清掉（options.remember === false）。
      const remembered = PLACEMENT_MEMORY.get(panelId)
      const region: Placement = placement ?? remembered ?? (contribution.defaultRegion as Placement)
      if (options?.remember === false) PLACEMENT_MEMORY.forget(panelId)
      else PLACEMENT_MEMORY.remember(panelId, region)

      const pane = controller.focusedPane()
      if (!pane) {
        // 工作台被关到没有格（理论上只有空布局）：退回"先插进根格"的行为
        controller.open(tab.ref)
        return
      }

      controller.dispatchMany(
        placeOps(region, {
          pane,
          tab,
          ids: {
            pane: controller.mint.pane(),
            split: controller.mint.split(),
            floatId: controller.mint.float(),
          },
        }),
        `open-panel:${region}`,
      )
    },
    [controller, panels],
  )

  /** 菜单显示用：这个面板下次会放哪、这个位置是不是用户记下来的。 */
  const regionOf = useCallback(
    (panelId: string): { placement: Placement; remembered: boolean } => {
      const remembered = PLACEMENT_MEMORY.get(panelId)
      const contribution = panels.get(panelId)
      const placement: Placement =
        remembered ?? ((contribution?.defaultRegion as Placement | undefined) ?? 'center')
      return { placement, remembered: remembered !== undefined }
    },
    [panels],
  )

  // 首次铺开：把最近一场会话放进工作台，别让用户一打开就是空白。
  //
  // **必须是"一生只做一次"**，用 ref 守住，不能只靠 deps。真机实测过：
  // `ctx.sessions.list` 的快照身份在会话列表更新时会换（ids 是新数组），
  // effect 因此重跑；而重跑时工作台刚好被用户关空，`workbenchHasTabs` 为 false，
  // 于是又自动开一个新标签 —— 表现为"关掉最后一个标签后它自己又回来了"。
  // 这与设计纪律"空态不自动新建会话"直接冲突，所以这里用 ref 一次性锁死。
  const seededRef = useRef(false)
  useEffect(() => {
    if (seededRef.current) return
    const first = list.ids[0]
    if (!first) return
    seededRef.current = true
    if (workbenchHasTabs(controller)) return
    openConversation(String(first))
  }, [controller, list.ids, openConversation])

  const recent = useMemo(
    () =>
      list.ids.slice(0, 5).map((id) => ({
        id: String(id),
        title: titleOf(String(id)),
      })),
    [list.ids, titleOf],
  )

  const renderContent = useCallback(
    (tab: Tab, active: boolean): ReactNode => {
      if (tab.ref.kind === 'panel') {
        const contribution = panels.get(tab.ref.contentId)
        if (!contribution) return <Tombstone what="panel" id={tab.ref.contentId} />
        // 单个面板的渲染错误不该让整棵工作台消失（真机上就是这么丢过全部标签）。
        return (
          <PanelErrorBoundary key={tab.id} label={contribution.title.zh}>
            <PanelHost contribution={contribution} instanceId={tab.ref.instanceId} active={active} />
          </PanelErrorBoundary>
        )
      }

      const sessionId = sessionIdOf(tab.ref)
      if (!sessionId) return <Tombstone what="kind" id={tab.ref.kind} />

      return (
        <PanelErrorBoundary key={tab.id} label={`会话 ${sessionId.slice(-8)}`}>
          <SessionTabView tab={tab} active={active} labels={sessionLabels}>
            {(binding) => (
              <SessionPane
                sessionId={sessionId}
                active={active}
                cache={derived}
                hub={hub}
                session={binding.session}
                uploader={uploader}
                eventSource={binding.eventSource}
                conversationLabels={conversationLabels}
              />
            )}
          </SessionTabView>
        </PanelErrorBoundary>
      )
    },
    [conversationLabels, derived, hub, panels, sessionLabels],
  )

  return (
    <SessionViewsProvider registry={leases}>
      <WorkbenchView
        controller={controller}
        labels={labels}
        resolveTitle={resolveTitle}
        renderContent={renderContent}
        recent={recent}
        onNewConversation={onNewConversation}
        onOpenRecent={openConversation}
        onOpenPanel={() => openPanel('studio-debug')}
        topbar={
          <StudioTopbar
            panels={panels}
            onOpenPanel={openPanel}
            regionOf={regionOf}
            sessionCount={list.ids.length}
          />
        }
      />
    </SessionViewsProvider>
  )
}


