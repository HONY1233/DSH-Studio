/**
 * `ctx.sessions` → `SessionPort` 适配器。
 *
 * 这是整个工作台与会话层之间**唯一的**真机适配点。它只做三件事：
 *   1) 把真实 `SessionRetainOptions` 的形状收敛（只有 `source` / `signal`）；
 *   2) 把真实 `SessionBinding` 归一化成 `{ sessionId, openState, eventSource, session, scope }`；
 *   3) 把 `retainInfo` 的 `ObservableSnapshot` 拆成当前快照。
 *
 * 刻意**不 import `@deepseek-ai/cordis` 或会话包的类型**：自己声明需要的最小形状。
 * 三个好处：本包可独立 typecheck；看 `SessionsFace` 就知道我们需要 DSH 提供什么；
 * 上游小改字段不会变成我们的编译错误（只会在归一化函数里显式暴露）。
 *
 * 真实契约（0.2.2-rc.5，已核对 .d.ts）：
 * ```ts
 * ctx.sessions.retain(target, { source, signal? }): SessionReference
 * // { sessionId, binding, ready: Promise<SessionBinding>, release() }
 * ctx.sessions.retainInfo(id): ObservableSnapshot<{ referenceCount, retainedBy }>
 * ```
 */

import {
  describeError,
  type SessionBinding,
  type SessionPort,
  type SessionRetainInfoLike,
  type SessionRetainRef,
} from './port.js'

/** 真实 `SessionBinding`：`{ sessionId, session, eventSource, ctx }`。 */
export interface RawSessionBinding {
  readonly sessionId: string
  readonly session?: unknown
  readonly eventSource?: unknown
  readonly ctx?: unknown
}

/** 真实 `SessionReference`。 */
export interface RawSessionReference {
  readonly sessionId: string
  /** 同步可得；`ready` 只是等「共享的首次 open」落定。 */
  readonly binding: RawSessionBinding
  readonly ready: Promise<RawSessionBinding>
  release(): void
}

export interface RawSessionRetainInfo {
  readonly referenceCount: number
  readonly retainedBy?: Readonly<Record<string, number>>
}

/** `ObservableSnapshot<T>` 的最小形状（只需要读一次快照）。 */
export interface SnapshotLike<T> {
  getSnapshot(): T
  subscribe?(listener: () => void): () => void
}

/** 我们从 `ctx.sessions` 用到的全部面。多一个都没有。 */
export interface SessionsFace {
  retain(target: string, options: { source: string; signal?: AbortSignal }): RawSessionReference
  retainInfo?(id: string): SnapshotLike<RawSessionRetainInfo>
  /** 借用已 retain 的 binding，不延长生命周期。调试用。 */
  binding?(id: string): RawSessionBinding | undefined
}

export interface CreateSessionPortOptions {
  /** 端口层就失败时的上报口（retain 同步抛错）。 */
  readonly onError?: (target: string, error: unknown) => void
}

/**
 * 归一化一条 binding。
 *
 * `openState` 恒为 `ready`：真实 binding 存在就说明 `SessionFace` 已可用，
 * `ready` 的 rejection 是唯一的失败信号（由注册表转成 error 态）。
 */
export function toBinding(raw: RawSessionBinding): SessionBinding {
  return {
    sessionId: String(raw.sessionId),
    openState: 'ready',
    ...(raw.eventSource === undefined ? {} : { eventSource: raw.eventSource }),
    ...(raw.session === undefined ? {} : { session: raw.session }),
    ...(raw.ctx === undefined ? {} : { scope: raw.ctx }),
  }
}

export function createSessionPort(
  sessions: SessionsFace,
  options: CreateSessionPortOptions = {},
): SessionPort {
  return {
    retain(target, retainOptions): SessionRetainRef {
      let raw: RawSessionReference
      try {
        raw = sessions.retain(target, {
          source: retainOptions.source,
          ...(retainOptions.signal === undefined ? {} : { signal: retainOptions.signal }),
        })
      } catch (error) {
        // 端口本身抛错（会话不存在 / 没连上）：返回一个已拒绝的引用，
        // 让注册表走统一的 error 降级，而不是把异常漏进 React 渲染。
        options.onError?.(target, error)
        return {
          ready: Promise.reject(error instanceof Error ? error : new Error(describeError(error))),
          release: () => {},
        }
      }

      // 同步 binding：先给外壳用，少一帧空白。
      const syncBinding = raw.binding ? toBinding(raw.binding) : undefined

      return {
        ready: raw.ready.then(toBinding),
        ...(syncBinding === undefined ? {} : { binding: syncBinding }),
        release: () => raw.release(),
      }
    },

    retainInfo(target): SessionRetainInfoLike | undefined {
      const source = sessions.retainInfo?.(target)
      if (!source) return undefined
      try {
        const snapshot = source.getSnapshot()
        return {
          referenceCount: snapshot.referenceCount,
          ...(snapshot.retainedBy === undefined ? {} : { retainedBy: snapshot.retainedBy }),
        }
      } catch {
        return undefined
      }
    },
  }
}
