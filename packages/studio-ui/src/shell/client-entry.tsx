/**
 * 插件入口（浏览器半）。
 *
 * 一个插件接管两个座位，理由是它们共享同一份"当前会话"状态：
 *
 *   sidebar（single, root）          ← 会话列表 + 新建
 *   main / key 'conversation'（keyed）← 工作台
 *
 * 选中态的唯一真相是「工作台焦点格的 activeTab」，左栏只是它的投影。
 * 不去读写官方的 Session selection：它在 Session Controller 内部，
 * root scope 拿不到受控值，硬同步会变成两个真相源。
 *
 * 组件的单例（注册表 / 缓存 / 布局控制器）全部在 apply 里创建。
 * 放进 React 生命周期的话，插件热重载一次就泄漏一份 —— Cordis 卸载时
 * 只回收它自己册封的 effect。
 */

import type { ReactNode } from 'react'

import { DerivedCache } from '../session-derived/cache.js'
import { PanelRegistry } from '../ui-panel-host/registry.js'
import { createSessionPort, type SessionsFace } from '../ui-session-views/client.js'
import { createSessionLeaseRegistry } from '../ui-session-views/leases.js'
import { createSessionTabViewLabels } from '../ui-session-views/labels.js'
import { createEmptyController, type WorkbenchController } from '../ui-workbench/controller.js'
import { createWorkbenchLabels } from '../ui-workbench/labels.js'
import { registerBuiltinPanels } from './builtin-panels.js'
import { SessionEventHub } from './event-hub.js'
import { ServiceSlot } from './service-slot.js'
import { injectStudioStyles } from './styles.js'
import { StudioMainPanel, type SessionListLike } from './main-panel.js'
import { openSessionInWorkbench } from './open-session.js'
import { StudioSidebar } from './sidebar.js'

/** Cordis 服务面：只声明用到的成员。 */
export interface SlotFace {
  inject(key: string, callback: () => (() => void) | Iterable<() => void>): () => void
  register(spec: Record<string, unknown>, component: (props: never) => ReactNode): () => void
}

export interface SessionsContextFace extends SessionsFace {
  create(options?: Record<string, unknown>): Promise<string>
  readonly list: SessionListLike
}

export interface StudioClientContext {
  readonly slots: SlotFace
  readonly sessions: SessionsContextFace
  /**
   * Cordis 的副作用登记口（卸载时逆序执行返回的 disposer）。
   * 声明为可选：没有它插件也能跑，只是热重载时内建面板不会被摘干净
   * （会撞 "panel id 已被占用"）—— 所以真机上它是必需的，这里只为可测性放宽。
   */
  readonly effect?: (setup: () => (() => void) | void) => void
  /**
   * 浏览器上传服务（`dsh-client-file-upload` 提供的 `ctx.fileUpload`）。
   * **刻意不放进 `inject`**：它是可选能力，硬依赖会让整个插件在缺包时不激活 ——
   * 那等于"为了附件把工作台也弄没了"。拿不到就禁用附件入口。
   */
  readonly fileUpload?: unknown
  /**
   * Cordis 的**条件注入**：`ctx.inject(deps, cb)` 在依赖就绪时执行 cb，
   * 不可用时不执行。这是访问可选服务的唯一正路 —— 服务隔离意味着
   * 没 inject 的 `ctx.xxx` 读不到（而且会抛错）。
   */
  readonly inject?: (deps: readonly string[], callback: (sub: StudioClientContext) => void) => unknown
}

export const name = '@studio/ui-shell'

/**
 * 需要的 client 服务。
 *
 * `sessions` 是 `ctx.sessions`（ISessions 的外向面，retain / list / create 都在它上面）。
 * 如果这个名字不对，插件不会激活并直接报 required service missing —— 这是明确的
 * 失败信号，比运行时 undefined 好。
 *
 * **`fileUpload` 刻意不在这里**：它是可选能力（附件），加进 inject 会让整个插件在
 * 缺包时不激活 —— 为了附件把工作台也弄没了，不值得。
 */
export const inject = ['slots', 'sessions'] as const

/**
 * 读取一个**可选**的 Cordis 服务。
 *
 * Cordis 的 ctx 是 Proxy：访问没有注入的服务会抛错（不是返回 undefined）。
 * 真机踩过 —— 在 `console.log` 里直接写 `ctx.fileUpload` 把整个 `apply()` 炸掉，
 * 结果工作台一行都没渲染。所有可选能力都必须走这里。
 */
function optionalService(ctx: unknown, key: string): unknown {
  try {
    return (ctx as Record<string, unknown>)[key]
  } catch {
    return undefined
  }
}

export function apply(ctx: StudioClientContext): void {
  try {
    applyInner(ctx)
  } catch (error) {
    // 关键路径（slot 注册）在 applyInner 里最先执行，能到这里说明是更早期的问题。
    // 无论如何都要留下痕迹：插件静默失败时最难查。
    console.error('[studio] apply 失败', error)
  }
}

function applyInner(ctx: StudioClientContext): void {
  injectStudioStyles()

  // 附件服务：可选能力，走条件注入 + 可订阅槽。
  const fileUploadSlot = new ServiceSlot<unknown>()
  try {
    ctx.inject?.(['fileUpload'], (sub) => {
      fileUploadSlot.set(optionalService(sub, 'fileUpload'))
    })
  } catch (error) {
    console.warn('[studio] 条件注入 fileUpload 失败（附件将不可用）', error)
  }
  const panels = new PanelRegistry()

  const port = createSessionPort(ctx.sessions, {
    onError: (target, error) => {
      console.warn(`[studio] retain 失败 ${target}`, error)
    },
  })

  const leases = createSessionLeaseRegistry({
    port,
    // 排查「到底哪条流没释放」时把下面打开：retain/release 各打一行。
    trace: false,
    onError: (target, error) => {
      console.warn(`[studio] 会话引用出错 ${target}`, error)
    },
  })

  const derived = new DerivedCache({ capacity: 8 })
  // 事件订阅的唯一入口：同一会话只订一次，避免第二个窗口挂载时 reset 重折。
  const hub = new SessionEventHub({ cache: derived })
  const controller: WorkbenchController = createEmptyController()

  const labels = createWorkbenchLabels('zh')
  const sessionLabels = createSessionTabViewLabels('zh')

  const openSession = (sessionId: string): void => openSessionInWorkbench(controller, sessionId)

  const createConversation = async (): Promise<void> => {
    try {
      const sessionId = await ctx.sessions.create({})
      openSession(String(sessionId))
    } catch (error) {
      console.error('[studio] 新建会话失败', error)
    }
  }

  // ── 关键路径优先：先把两个座位挂上，后面任何可选能力失败都不影响 UI ──

  // 主区：工作台
  ctx.slots.inject('main', () => {
    return ctx.slots.register(
      {
        name: 'main',
        // keyed 槽用 `key`（不是 `id`）；`conversation` 是官方保留键。
        key: 'conversation',
        // 数字小的赢，官方占 0。写成正数会静默失败（官方继续渲染）。
        priority: -1,
      },
      () => (
        <StudioMainPanel
          ctx={ctx}
          controller={controller}
          leases={leases}
          derived={derived}
          hub={hub}
          panels={panels}
          labels={labels}
          sessionLabels={sessionLabels}
          fileUploadSlot={fileUploadSlot}
        />
      ),
    )
  })

  // 左栏：会话列表
  ctx.slots.inject('sidebar', () => {
    return ctx.slots.register(
      { name: 'sidebar', id: 'studio-sidebar', priority: -1 },
      (owner: { collapsed?: boolean; width?: number; drawer?: boolean }) => (
        <StudioSidebar
          collapsed={owner?.collapsed}
          width={owner?.width}
          drawer={owner?.drawer}
          list={ctx.sessions.list}
          controller={controller}
          onOpenSession={openSession}
          onNewConversation={() => void createConversation()}
        />
      ),
    )
  })

  // ── 以下是可选能力，每一段都单独兜住，绝不能影响上面的座位 ──

  try {
    // 内建面板：工作台状态 / 会话信息。都是只读派生，不依赖额外 Host 能力。
    const disposePanels = registerBuiltinPanels(panels, { controller, leases, derived, hub })
    // Cordis 卸载时把面板摘干净；否则热重载会撞"panel id 已被占用"。
    ctx.effect?.(() => disposePanels)
  } catch (error) {
    console.warn('[studio] 内建面板注册失败', error)
  }

  try {
    // 真机排查钩子。DSH 自己也用 `window.__DSH_BOOT__` 暴露引导状态，同一套路。
    Object.defineProperty(globalThis, '__STUDIO_DEBUG__', {
      configurable: true,
      value: {
        controller,
        leases,
        derived,
        hub,
        get fileUpload() {
          return fileUploadSlot.get()
        },
        /** 当前所有会话的引用计数快照（谁在保活、几份）。 */
        inspect: () => leases.snapshot(),
        stats: () => derived.stats(),
      },
    })
  } catch (error) {
    console.warn('[studio] 调试钩子挂载失败', error)
  }

  // 打印时条件注入可能还没触发（fileUpload 服务可能在本插件之后挂载），
  // 所以这里只能说"尚未就绪"——就绪后输入框的附件入口会自己变可用。
  console.log(
    '[studio] 已接管 sidebar + main.conversation（%d 个内建面板，附件服务 %s）',
    panels.size,
    fileUploadSlot.get() === undefined ? '尚未就绪' : '已就绪',
  )
}
