/**
 * 租约注册表 —— 把 `sessions.retain` 的引用计数包成"搬家不重连"。
 *
 * 三条规则（对应 docs/session-views.md 的三节）：
 *
 * 1) **同会话同代**：一个 target 只有一条底层 retain 引用，多个视图共享它。
 *    视图数量自己数，底层只 retain 一次 —— 否则两个窗口各 follow 一次，
 *    流翻倍、状态互相覆盖。
 * 2) **宽限期延迟释放**：计数归零后不立刻 `release()`，先等一个微任务。
 *    因为把 tab 从停靠面搬到浮窗时 React 会**卸载再挂载**（两棵子树），
 *    同步释放必然掉连接。落在宽限期内的重新 acquire 直接复用同一代。
 * 3) **释放后删表**：宽限期结束才 `release()` 并从 map 里删除。
 *    下次 acquire 得到**新的一代**（generation+1），对应 dsh 的
 *    "后续获取可以为同一 id 创建新 generation"。
 *
 * 本文件零 React，可以在 Node 里同步验证。
 */

import {
  describeError,
  type SessionBinding,
  type SessionPort,
  type SessionRetainRef,
  type SessionSource,
  type SessionTarget,
} from './port.js'

/**
 * 宽限期策略。
 *
 * `microtask` 是默认值：React 同一次 commit 里的"卸载 A + 挂载 B"发生在
 * 同一个宏任务内，微任务一定排在它之后，所以既不会误杀也能立刻回收。
 */
export type GracePolicy = { readonly kind: 'microtask' } | { readonly kind: 'timeout'; readonly ms: number }

export const MICROTASK_GRACE: GracePolicy = { kind: 'microtask' }

export type LeaseStatus = 'opening' | 'ready' | 'error'

export interface SessionSourceCount {
  readonly source: SessionSource
  readonly count: number
}

/**
 * 一代引用的只读快照。**对象身份只在内容变化时改变**，
 * 所以可以直接喂给 `useSyncExternalStore` 的 getSnapshot。
 */
export interface LeaseView {
  readonly target: SessionTarget
  /** 同一 target 的第几代。跨宽限期重新打开会 +1。 */
  readonly generation: number
  readonly refCount: number
  readonly sources: readonly SessionSourceCount[]
  readonly status: LeaseStatus
  /** 计数已归零、正在等宽限期结束。此时仍可 acquire 拿回同一代。 */
  readonly draining: boolean
  readonly closed: boolean
  readonly binding?: SessionBinding
  readonly error?: string
}

/** 一个视图对某一代的持有凭证。 */
export interface SessionLease {
  readonly target: SessionTarget
  readonly source: SessionSource
  /** 当前快照；引用关闭后仍是最后一份，不会抛。 */
  current(): LeaseView
  /** 幂等。只减少本视图那一份，底层引用由注册表在计数归零后释放。 */
  release(): void
}

export interface SessionLeaseRegistryOptions {
  readonly port: SessionPort
  readonly grace?: GracePolicy
  /** 同步抛错或 ready 拒绝时的上报口；不影响 UI（UI 读 status）。 */
  readonly onError?: (target: SessionTarget, error: unknown) => void
  /**
   * 调试开关：每次底层 retain/release 都打一行日志（含当前计数）。
   * 真机排查「到底是哪条流没释放」时打开它，比读 retainInfo 直观。
   */
  readonly trace?: boolean
}

interface Entry {
  readonly target: SessionTarget
  readonly generation: number
  ref: SessionRetainRef
  refCount: number
  readonly sources: Map<SessionSource, number>
  status: LeaseStatus
  binding?: SessionBinding
  error?: string
  /** 每次归零 +1，旧定时回调作废；acquire 也 +1 来取消待释放。 */
  drainToken: number
  closed: boolean
  view: LeaseView
}

const DETACHED_REF: SessionRetainRef = {
  // 已被拒绝的 ready；attach 之前会先挂 catch，不会产生未处理拒绝。
  ready: Promise.reject(new Error('detached')),
  release: () => {},
}
void DETACHED_REF.ready.catch(() => {})

export class SessionLeaseRegistry {
  private readonly port: SessionPort
  private readonly grace: GracePolicy
  private readonly onError: ((target: SessionTarget, error: unknown) => void) | undefined
  private readonly trace: boolean

  private readonly entries = new Map<SessionTarget, Entry>()
  private readonly listeners = new Set<() => void>()
  /** 每个 target 已经开到第几代；release 后不重置，用于断言"重新打开是新的一代"。 */
  private readonly generations = new Map<SessionTarget, number>()
  private disposed = false

  constructor(options: SessionLeaseRegistryOptions) {
    this.port = options.port
    this.grace = options.grace ?? MICROTASK_GRACE
    this.onError = options.onError
    this.trace = options.trace === true
  }

  // -------------------------------------------------------------- 读写

  acquire(target: SessionTarget, source: SessionSource = 'workbench:pane'): SessionLease {
    if (this.disposed) throw new Error('SessionLeaseRegistry 已 dispose，不能再 acquire')

    const entry = this.entries.get(target) ?? this.open(target, source)
    entry.refCount += 1
    entry.sources.set(source, (entry.sources.get(source) ?? 0) + 1)
    // 取消待执行的释放：宽限期内的重新挂载拿回同一代，不重连。
    entry.drainToken += 1
    this.refresh(entry)
    this.notify()
    return this.makeLease(entry, source)
  }

  /** 立即结束所有宽限期（关窗、退出前调用）。 */
  flush(): void {
    for (const entry of [...this.entries.values()]) {
      if (entry.refCount === 0) this.close(entry)
    }
  }

  /** 释放一切，含仍被持有的引用。之后不能再 acquire。 */
  dispose(): void {
    this.disposed = true
    for (const entry of [...this.entries.values()]) this.close(entry)
    this.listeners.clear()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 当前所有代的快照。顺序按 target 首次打开的顺序。 */
  snapshot(): readonly LeaseView[] {
    return [...this.entries.values()].map((entry) => entry.view)
  }

  inspect(target: SessionTarget): LeaseView | undefined {
    return this.entries.get(target)?.view
  }

  /** 底层还活着的代数（= map 大小）。全部释放后必须是 0。 */
  get size(): number {
    return this.entries.size
  }

  /** 正在等宽限期的代数。 */
  get draining(): number {
    let count = 0
    for (const entry of this.entries.values()) if (entry.refCount === 0) count += 1
    return count
  }

  // -------------------------------------------------------------- 内部

  private open(target: SessionTarget, source: SessionSource): Entry {
    const generation = (this.generations.get(target) ?? 0) + 1
    this.generations.set(target, generation)

    const entry: Entry = {
      target,
      generation,
      ref: DETACHED_REF,
      refCount: 0,
      sources: new Map(),
      status: 'opening',
      drainToken: 0,
      closed: false,
      view: undefined as unknown as LeaseView,
    }

    try {
      // 真实契约只有 source（+ 可选 signal）：connection 与 facets 由 Host 统一管，
      // 调用方不再声明。早期版本这里多传了两个字段，真机核对后删掉。
      if (this.trace) console.log(`[lease] retain ${target} <- ${source}`)
      entry.ref = this.port.retain(target, { source })
      // 真实 API 的 binding 在 retain 当场就存在；先记下来，首帧即可渲染外壳。
      if (entry.ref.binding) entry.binding = entry.ref.binding
      this.attach(entry)
    } catch (error) {
      // 会话不存在 / 端口没连上，不能让整棵树崩掉：降级成错误态。
      entry.status = 'error'
      entry.error = describeError(error)
      this.onError?.(target, error)
    }

    this.refresh(entry)
    this.entries.set(target, entry)
    return entry
  }

  private attach(entry: Entry): void {
    const { ref } = entry
    void ref.ready.then(
      (binding) => {
        if (entry.closed) return
        entry.binding = binding
        if (binding.openState === 'error') {
          entry.status = 'error'
          entry.error = binding.error ?? '会话打开失败'
        } else {
          entry.status = 'ready'
          entry.error = undefined
        }
        this.refresh(entry)
        this.notify()
      },
      (error: unknown) => {
        // 引用在 ready 之前被释放时也会走到这里，此时 entry 已关闭，直接忽略。
        if (entry.closed) return
        entry.status = 'error'
        entry.error = describeError(error)
        this.refresh(entry)
        this.notify()
        this.onError?.(entry.target, error)
      },
    )
  }

  private makeLease(entry: Entry, source: SessionSource): SessionLease {
    let released = false
    return {
      target: entry.target,
      source,
      current: () => entry.view,
      release: () => {
        if (released) return
        released = true
        this.drop(entry, source)
      },
    }
  }

  private drop(entry: Entry, source: SessionSource): void {
    if (entry.closed) return

    entry.refCount = Math.max(0, entry.refCount - 1)
    const count = (entry.sources.get(source) ?? 0) - 1
    if (count > 0) entry.sources.set(source, count)
    else entry.sources.delete(source)

    if (entry.refCount > 0) {
      this.refresh(entry)
      this.notify()
      return
    }

    const token = (entry.drainToken += 1)
    this.refresh(entry)
    this.notify()
    this.scheduleClose(entry, token)
  }

  private scheduleClose(entry: Entry, token: number): void {
    const finish = (): void => {
      if (entry.closed || entry.drainToken !== token) return
      this.close(entry)
    }
    if (this.grace.kind === 'timeout') {
      setTimeout(finish, this.grace.ms)
      return
    }
    if (typeof queueMicrotask === 'function') queueMicrotask(finish)
    else void Promise.resolve().then(finish)
  }

  private close(entry: Entry): void {
    if (entry.closed) return
    entry.closed = true
    // 先删表再 release：与 dsh「先退出可访问映射，再执行清理」的顺序一致，
    // 否则 release 里同步触发的回调可能看到半死不活的这一代。
    this.entries.delete(entry.target)
    if (this.trace) console.log(`[lease] release ${entry.target} (gen ${entry.generation})`)
    try {
      entry.ref.release()
    } catch (error) {
      this.onError?.(entry.target, error)
    }
    this.refresh(entry)
    this.notify()
  }

  private refresh(entry: Entry): void {
    const sources: SessionSourceCount[] = []
    for (const [source, count] of entry.sources) {
      if (count > 0) sources.push({ source, count })
    }
    entry.view = {
      target: entry.target,
      generation: entry.generation,
      refCount: entry.refCount,
      sources,
      status: entry.status,
      draining: entry.refCount === 0,
      closed: entry.closed,
      ...(entry.binding === undefined ? {} : { binding: entry.binding }),
      ...(entry.error === undefined ? {} : { error: entry.error }),
    }
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }
}

export function createSessionLeaseRegistry(options: SessionLeaseRegistryOptions): SessionLeaseRegistry {
  return new SessionLeaseRegistry(options)
}
