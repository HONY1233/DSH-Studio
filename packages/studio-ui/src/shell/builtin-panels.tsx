/**
 * 内建面板 + 顶栏。
 *
 * 之前 `PanelRegistry` 和 `PanelHost` 都在，但没有"打开面板"的入口 ——
 * 用户点按钮只打一行日志。这里补上最小可用的闭环：
 *
 *   顶栏「面板」按钮 → 下拉列表（来自注册表） → 选一个 → 工作台里多一个标签
 *
 * 同时注册两个**真有用**的内建面板：
 * - `studio-debug`：引用计数 / 折叠统计 / 事件订阅数。排查"流没释放""重折了"
 *   这类问题时是唯一一眼能看出真相的地方，比读 console 快。
 * - `session-info`：当前焦点会话的身份与来源分解。
 *
 * 两者的共同点是**只读派生状态**，不需要额外的 Host 能力 —— 所以能立刻可用，
 * 而真正需要 Host 服务的面板（Git / 文件 / 终端）留到各自的服务就绪后再加。
 */

import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react'

import type { DerivedCache } from '../session-derived/cache.js'
import type { PanelContribution, PanelRegistry } from '../ui-panel-host/index.js'
import type { SessionLeaseRegistry } from '../ui-session-views/leases.js'
import type { WorkbenchController } from '../ui-workbench/controller.js'
import type { SessionEventHub } from './event-hub.js'
import { panes } from '../workbench/layout.js'
import { sessionIdOf } from '../ui-session-views/session-tab-view.js'

const MONO = 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)'

const rowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  padding: '3px 0',
  borderBottom: '1px dashed var(--color-border-tertiary, rgba(0,0,0,.06))',
}

function Row(props: { readonly label: string; readonly value: ReactNode }): ReactNode {
  return (
    <div style={rowStyle}>
      <span style={{ color: 'var(--color-text-tertiary, #8a8a85)' }}>{props.label}</span>
      <span style={{ fontFamily: MONO }}>{props.value}</span>
    </div>
  )
}

function Shell(props: { readonly title: string; readonly children: ReactNode }): ReactNode {
  return (
    <div
      style={{
        height: '100%',
        overflowY: 'auto',
        padding: '12px 14px',
        fontSize: 12,
        lineHeight: 1.7,
        color: 'var(--color-text-primary, #2c2c2a)',
      }}
    >
      {/* 标题不重复渲染：标签栏已经有面板名了，正文再写一遍是噪音。
          这里只把它留给无障碍读屏。 */}
      <div aria-label={props.title} role="group">
        {props.children}
      </div>
    </div>
  )
}

export interface BuiltinPanelDeps {
  readonly controller: WorkbenchController
  readonly leases: SessionLeaseRegistry
  readonly derived: DerivedCache
  readonly hub: SessionEventHub
}

/** 当前焦点格的 activeTab 指向哪个会话。 */
function focusedSessionOf(controller: WorkbenchController): string | undefined {
  const state = controller.getState()
  const all = panes(state.root)
  const pane = all.find((p) => p.id === state.focused) ?? all[0]
  if (!pane) return undefined
  const active = pane.tabs.find((tab) => tab.id === pane.activeTab) ?? pane.tabs[pane.tabs.length - 1]
  return active ? sessionIdOf(active.ref) : undefined
}

function DebugPanel(deps: BuiltinPanelDeps): ReactNode {
  const { leases, derived, hub, controller } = deps

  // 三个源都订阅，用版本号触发重渲染。
  //
  // **不能**用 `useSyncExternalStore(..., () => derived.stats())`：`stats()` 每次构造
  // 新对象，React 会认为快照一直在变 → 无限重渲染 → 抛错并卸载整棵树（真机踩过，
  // 表现为点开面板后工作台上的标签全没了）。版本号是原始值，天然稳定。
  const [, setVersion] = useState(0)
  useEffect(() => {
    const bump = (): void => setVersion((v) => v + 1)
    const offDerived = derived.subscribe(bump)
    const offLeases = leases.subscribe(bump)
    const offController = controller.subscribe(bump)
    return () => {
      offDerived()
      offLeases()
      offController()
    }
  }, [derived, leases, controller])

  const stats = derived.stats()
  const sessions = leases.snapshot()
  const state = controller.getState()

  return (
    <Shell title="工作台状态">
      <Row label="打开的标签" value={panes(state.root).reduce((n, p) => n + p.tabs.length, 0)} />
      <Row label="浮窗" value={state.floats.length} />
      <Row label="会话引用（代数）" value={leases.size} />
      <Row label="事件订阅（会话）" value={hub.size} />
      <div style={{ height: 10 }} />
      <Row label="折叠 applies" value={stats.applies} />
      <Row label="跳过去重" value={stats.skippedEntries} />
      <Row label="缓存会话 / slot" value={`${stats.sessions} / ${stats.slots}`} />
      <Row label="命中 / 未命中" value={`${stats.hits} / ${stats.misses}`} />
      <Row label="淘汰 / 被引用挡住" value={`${stats.evicted} / ${stats.blockedEvictions}`} />

      <div style={{ fontSize: 11, marginTop: 12, marginBottom: 4, color: 'var(--color-text-tertiary, #8a8a85)' }}>
        引用分解
      </div>
      {sessions.length === 0 ? (
        <div style={{ color: 'var(--color-text-tertiary, #8a8a85)' }}>没有持有中的会话</div>
      ) : (
        sessions.map((view) => (
          <div key={String(view.target)} style={{ fontFamily: MONO, fontSize: 11, padding: '2px 0' }}>
            {String(view.target).slice(-10)} · ref {view.refCount} · gen {view.generation} ·{' '}
            {view.sources.map((s) => `${s.source}×${s.count}`).join(', ')}
          </div>
        ))
      )}
    </Shell>
  )
}

function SessionInfoPanel(deps: BuiltinPanelDeps): ReactNode {
  const { controller, leases } = deps
  const subscribe = useCallback((listener: () => void) => controller.subscribe(listener), [controller])
  const getState = useCallback(() => controller.getState(), [controller])
  useSyncExternalStore(subscribe, getState, getState)

  const sessionId = focusedSessionOf(controller)
  const lease = sessionId ? leases.inspect(sessionId) : undefined

  if (!sessionId) {
    return (
      <Shell title="会话信息">
        <div style={{ color: 'var(--color-text-tertiary, #8a8a85)' }}>当前没有聚焦的会话</div>
      </Shell>
    )
  }

  return (
    <Shell title="会话信息">
      <Row label="sessionId" value={<span style={{ fontSize: 10 }}>{sessionId}</span>} />
      <Row label="代 generation" value={lease?.generation ?? '—'} />
      <Row label="视图引用" value={lease?.refCount ?? 0} />
      <Row label="状态" value={lease?.status ?? 'unknown'} />
      {lease?.sources.map((s) => <Row key={s.source} label={`来源 ${s.source}`} value={s.count} />)}
      {lease?.error && (
        <div style={{ marginTop: 8, color: 'var(--color-text-danger, #c0392b)', fontSize: 11 }}>{lease.error}</div>
      )}
    </Shell>
  )
}

/** 注册内建面板；返回 disposer（交给 Cordis 的 effect 生命周期）。 */
export function registerBuiltinPanels(panels: PanelRegistry, deps: BuiltinPanelDeps): () => void {
  const contributions: PanelContribution[] = [
    {
      id: 'studio-debug',
      title: { zh: '工作台状态', en: 'Workbench state' },
      scope: 'global',
      regions: ['right', 'float'],
      multi: false,
      defaultRegion: 'right',
      keepAlive: true,
      render: () => <DebugPanel {...deps} />,
    },
    {
      id: 'session-info',
      title: { zh: '会话信息', en: 'Session info' },
      scope: 'session',
      regions: ['right', 'float'],
      multi: false,
      defaultRegion: 'right',
      keepAlive: true,
      render: () => <SessionInfoPanel {...deps} />,
    },
  ]

  const disposers = contributions.map((contribution) => panels.register(contribution))
  return () => {
    for (const dispose of disposers) dispose()
  }
}
