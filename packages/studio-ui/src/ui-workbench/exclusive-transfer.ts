/**
 * 跨会话移动独占工具 —— 纯决策 reducer（X4.4 / XC-17）。
 *
 * 规则来自产品计划：Terminal / SSH / WSL / Computer / 浏览器登录空间默认
 * `exclusive`，同一时刻只能有一个 live owner。把这种工具拖到另一场会话时，
 * **必须由用户明确选择**：
 *
 *   - `move`：移动实例并把归属改到目标会话；
 *   - `new`：在目标会话创建一个新实例，源实例保持不动。
 *
 * 这里刻意没有 "copy" 这个决策，也没有默认决策。`beginToolTransfer` 遇到
 * 跨会话 exclusive 时只返回 `prompt`，不会产生任何 action；只有显式调用
 * `resolveToolTransfer` 才会得到可执行结果。默认结果永远是取消（不复制）。
 *
 * 语义边界：同会话移动和 shared-read / stateless 工具的跨会话移动不需要
 * 确认 —— 它们不涉及独占 PTY / 登录空间，直接给出 move 计划即可。
 */

export type ToolConcurrency = 'shared-read' | 'exclusive' | 'stateless'
export type ToolTransferDecision = 'move' | 'new' | 'cancel'
export type ToolTransferMode = 'move' | 'new'

export interface ToolTransferSource {
  readonly instanceId: string
  readonly toolId: string
  /** 工具实例当前归属的会话。 */
  readonly sessionId: string
  readonly concurrency: ToolConcurrency
  readonly hostId?: string
  readonly windowId?: string
}

export interface ToolTransferTarget {
  readonly sessionId: string
  readonly hostId?: string
  readonly windowId?: string
}

export interface ToolTransferRequest {
  readonly source: ToolTransferSource
  readonly target: ToolTransferTarget
}

export interface ToolTransferAction {
  readonly kind: 'tool.transfer'
  readonly mode: ToolTransferMode
  readonly instanceId: string
  readonly toolId: string
  readonly fromSessionId: string
  readonly toSessionId: string
  /** 仅 `new` 模式：目标会话里的新实例 id，由调用方在确认后 mint。 */
  readonly newInstanceId?: string
}

/** 跨会话 exclusive 的确认阶段。只有这个阶段会渲染对话框。 */
export interface ExclusiveTransferPrompt {
  readonly phase: 'prompt'
  readonly source: ToolTransferSource
  readonly target: ToolTransferTarget
  /** 两个明确选项，顺序固定；没有 copy。 */
  readonly options: readonly ['move', 'new']
  /** 默认决策是取消：不点按钮就不会发生任何转移。 */
  readonly defaultDecision: 'cancel'
  readonly copyByDefault: false
}

export type ToolTransferState =
  | { readonly phase: 'none' }
  | {
      readonly phase: 'direct'
      readonly request: ToolTransferRequest
      readonly reason: 'same-session' | 'non-exclusive'
      readonly action: ToolTransferAction
    }
  | ExclusiveTransferPrompt
  | {
      readonly phase: 'cancelled'
      readonly request: ToolTransferRequest
      readonly reason: 'user'
    }
  | {
      readonly phase: 'resolved'
      readonly request: ToolTransferRequest
      readonly decision: Exclude<ToolTransferDecision, 'cancel'>
      readonly action: ToolTransferAction
    }

export class ToolTransferError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolTransferError'
  }
}

const CONCURRENCY: readonly ToolConcurrency[] = ['shared-read', 'exclusive', 'stateless']

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ToolTransferError(`${field} 必须是非空字符串`)
  }
  return value
}

function endpoint<T extends { readonly sessionId: string }>(value: T, field: string): T {
  if (!value || typeof value !== 'object') throw new ToolTransferError(`${field} 必须是对象`)
  text(value.sessionId, `${field}.sessionId`)
  return value
}

/** 校验并冻结请求的语义字段；不复制宿主私有数据。 */
export function normalizeToolTransferRequest(input: ToolTransferRequest): ToolTransferRequest {
  if (!input || typeof input !== 'object') throw new ToolTransferError('transfer request 必须是对象')
  const source = input.source
  if (!source || typeof source !== 'object') throw new ToolTransferError('transfer.source 必须是对象')
  text(source.instanceId, 'transfer.source.instanceId')
  text(source.toolId, 'transfer.source.toolId')
  text(source.sessionId, 'transfer.source.sessionId')
  if (!CONCURRENCY.includes(source.concurrency)) {
    throw new ToolTransferError('transfer.source.concurrency 无效')
  }
  endpoint(input.target, 'transfer.target')
  return {
    source: {
      instanceId: source.instanceId,
      toolId: source.toolId,
      sessionId: source.sessionId,
      concurrency: source.concurrency,
      ...(source.hostId === undefined ? {} : { hostId: text(source.hostId, 'transfer.source.hostId') }),
      ...(source.windowId === undefined ? {} : { windowId: text(source.windowId, 'transfer.source.windowId') }),
    },
    target: {
      sessionId: input.target.sessionId,
      ...(input.target.hostId === undefined ? {} : { hostId: text(input.target.hostId, 'transfer.target.hostId') }),
      ...(input.target.windowId === undefined ? {} : { windowId: text(input.target.windowId, 'transfer.target.windowId') }),
    },
  }
}

export function requiresExclusiveChoice(request: ToolTransferRequest): boolean {
  const normalized = normalizeToolTransferRequest(request)
  return normalized.source.concurrency === 'exclusive'
    && normalized.source.sessionId !== normalized.target.sessionId
}

function moveAction(request: ToolTransferRequest): ToolTransferAction {
  return {
    kind: 'tool.transfer',
    mode: 'move',
    instanceId: request.source.instanceId,
    toolId: request.source.toolId,
    fromSessionId: request.source.sessionId,
    toSessionId: request.target.sessionId,
  }
}

/**
 * 开始一次工具转移。
 *
 * 跨会话 exclusive 返回 `prompt`，且**不创建 action**；其它情况直接 move。
 */
export function beginToolTransfer(input: ToolTransferRequest): ToolTransferState {
  const request = normalizeToolTransferRequest(input)
  if (request.source.sessionId === request.target.sessionId) {
    return { phase: 'direct', request, reason: 'same-session', action: moveAction(request) }
  }
  if (request.source.concurrency !== 'exclusive') {
    return { phase: 'direct', request, reason: 'non-exclusive', action: moveAction(request) }
  }
  return {
    phase: 'prompt',
    source: request.source,
    target: request.target,
    options: ['move', 'new'],
    defaultDecision: 'cancel',
    copyByDefault: false,
  }
}

export interface ResolveTransferOptions {
  /** `new` 模式下由调用方 mint 的新实例 id，必须与源实例不同。 */
  readonly newInstanceId?: string
}

/**
 * 用户确认后产生可执行 action。
 *
 * - 只有 `prompt` 阶段可以确认；重复确认、跳过确认都抛错；
 * - `cancel` 不产生 action；
 * - `new` 必须显式提供新的实例 id；
 * - `copy` 不在联合类型里，运行时也拒绝。
 */
export function resolveToolTransfer(
  state: ToolTransferState,
  decision: ToolTransferDecision,
  options: ResolveTransferOptions = {},
): ToolTransferState {
  if (state.phase !== 'prompt') throw new ToolTransferError('只有等待确认的独占工具转移可以决定')
  const request: ToolTransferRequest = { source: state.source, target: state.target }
  if (decision === 'cancel') return { phase: 'cancelled', request, reason: 'user' }
  if (decision === 'move') {
    return { phase: 'resolved', request, decision, action: moveAction(request) }
  }
  if (decision === 'new') {
    const newInstanceId = options.newInstanceId
    if (typeof newInstanceId !== 'string' || newInstanceId.trim().length === 0) {
      throw new ToolTransferError('创建新实例必须提供 newInstanceId')
    }
    if (newInstanceId === request.source.instanceId) {
      throw new ToolTransferError('newInstanceId 不能与源实例相同；这不叫新建')
    }
    return {
      phase: 'resolved',
      request,
      decision,
      action: {
        kind: 'tool.transfer',
        mode: 'new',
        instanceId: request.source.instanceId,
        toolId: request.source.toolId,
        fromSessionId: request.source.sessionId,
        toSessionId: request.target.sessionId,
        newInstanceId,
      },
    }
  }
  throw new ToolTransferError(`未知转移决策: ${String(decision)}；默认不复制`)
}