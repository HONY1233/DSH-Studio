/**
 * Session 端口 —— 工作台与会话层之间**唯一**的接缝。
 *
 * 形状按 DSH 0.2.2-rc.5 的真实契约写（已核对
 * `@deepseek-ai/dsh-api-session-controller/lib/types/client/contract/sessions.d.ts`）：
 *
 * ```ts
 * ctx.sessions.retain(target, { source, signal? }): SessionReference
 * // SessionReference = { sessionId, binding, ready: Promise<SessionBinding>, release() }
 * ctx.sessions.retainInfo(id): ObservableSnapshot<SessionRetainInfo>
 * // SessionRetainInfo = { referenceCount, retainedBy }
 * ```
 *
 * 与早期设计的三处差异（都是真机核对出来的，别按旧文档改回去）：
 *
 * 1) **没有 `connection` / `facets`**。retain 只接受 `source` 与 `signal`；
 *    事件连接和派生计算不再由调用方声明，Host 侧统一管理。
 * 2) **`binding` 同步可得**。`reference.binding` 在 retain 当场就存在，
 *    `ready` 只是等「共享的首次 Session.open()」落定。所以第一帧就能拿到
 *    eventSource，不必等 Promise —— 少一帧空白。
 * 3) **没有 `released` 布尔**，也没有 `openState`。失败只能从 `ready` 的
 *    rejection 观察；`release()` 本身幂等。
 *
 * 为什么不让工作台直接 `import` 会话包：
 * 1) 会话绑定层与工作台都不认识任何具体会话实现，才能在 Node 里单测；
 * 2) 真实 `SessionReference` 是 Controller 私有结构，直接依赖会把上游小改动
 *    变成我们的编译错误。
 */

/** 会话目标：普通 session id，或 direct subagent 地址（dsh 里是 id | address）。 */
export type SessionTarget = string

/**
 * 引用来源：谁在保活这一代。
 *
 * 真实类型是声明合并出来的 `SessionReferenceSource`（dsh 自己用了 `mainView`）。
 * 内置四个值覆盖工作台的全部持有者 —— 排查 `retainInfo().retainedBy` 时能直接
 * 看出是谁没释放。**不要复用内置值**，否则计数会混在一起。
 */
export type BuiltinSessionSource =
  /** 停靠面里的窗口。 */
  | 'workbench:pane'
  /** 浮窗里的窗口。 */
  | 'workbench:float'
  /** Pin 出去的独立系统窗口。 */
  | 'workbench:pinned'
  /** 缩略图 / hover 预览这类短命持有者。 */
  | 'workbench:preview'

export type SessionSource = BuiltinSessionSource | (string & {})

export type OpenState = 'opening' | 'ready' | 'error'

/**
 * 打开结果。等价于 `SessionReference.binding` 的归一化视图。
 *
 * `eventSource` 是**共享**的事件源：同一个会话的所有视图必须用同一个，
 * 各自 `new` 一个就会出现"两个窗口的流互相覆盖"。
 *
 * 真实 `SessionBinding` 是 `{ sessionId, session, eventSource, ctx }`；
 * 这里 `session` / `scope` 留 `unknown` 原样透传 —— 本层不读它们，只在
 * `wrap(node, binding)` 里交回给真实作用域组件。
 */
export interface SessionBinding {
  readonly sessionId: string
  readonly title?: string
  readonly openState: Exclude<OpenState, 'opening'>
  readonly error?: string
  /** `ObservableSnapshot<SessionEventWindow>`，原样透传。 */
  readonly eventSource?: unknown
  readonly session?: unknown
  readonly scope?: unknown
}

export interface SessionRetainOptions {
  readonly source: SessionSource
  /** 独立等待者的取消；不影响其它持有同一代的视图。 */
  readonly signal?: AbortSignal
}

export interface SessionRetainRef {
  /**
   * 打开结果。**可能被拒绝**：`Session.open()` 失败、或引用在 ready 之前被释放。
   * 注册表里对 rejection 一律按"已关闭则忽略"处理。
   */
  readonly ready: Promise<SessionBinding>
  /**
   * 同步可得的 binding（真实 API 在 retain 当场就有 `reference.binding`，
   * `ready` 只是等首次 open 落定）。给宿主先渲染外壳用。
   *
   * 可选：假端口可以不给，此时只能等 `ready`。
   */
  readonly binding?: SessionBinding
  /** 幂等。最后一个引用释放才会真正清理（由 dsh 那位计数）。 */
  release(): void
}

/**
 * 只读观察。真实 `retainInfo` 返回 `ObservableSnapshot<SessionRetainInfo>`，
 * 这里只取当前快照 —— 本层不订阅，仅用于调试面板与测试断言。
 */
export interface SessionRetainInfoLike {
  readonly referenceCount: number
  readonly retainedBy?: Readonly<Record<string, number>>
}

export interface SessionPort {
  retain(target: SessionTarget, options: SessionRetainOptions): SessionRetainRef
  /**
   * 只读观察，等价于 `ctx.sessions.retainInfo(id).getSnapshot()`。
   * **不得**用来做业务判断。
   */
  retainInfo?(target: SessionTarget): SessionRetainInfoLike | undefined
}

/** 把任意异常收敛成一句可展示的话（不吞堆栈，交给 onError）。 */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return String(error)
}
