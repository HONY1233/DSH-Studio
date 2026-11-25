/**
 * 派生缓存 —— 会话事件的折叠结果，按 (session, model.key) 共享。
 *
 * 它解决的是工作台化之后必然出现的三个问题：
 *
 * 1) **重复折叠**：同一会话开两个窗口，各自把 5000 条事件折一遍 → 双倍 CPU 与内存。
 *    这里每个 (session, key) 只留一份 state，视图只是持有引用。
 * 2) **搬家重折**：拖 tab 到浮窗会卸载再挂载，如果派生结果跟着组件走，
 *    每搬一次就重折一次。这里 release 只是减引用，state 留在缓存里。
 * 3) **切会话爆内存**：真正不用的会话要能淘汰。按 LRU 淘汰会话，
 *    **但有引用在身的永不淘汰** —— 淘汰活着的视图会让 UI 直接看到状态消失。
 *
 * 一个容易搞错的点：去重是**按 slot 各自记 lastSeq**，不是按会话记一个。
 * 因为晚加入的模型（比如后来才打开 usage 面板）需要从头回放历史，
 * 而老 slot 不该被那次回放重复喂一遍。
 *
 * 零 React、零 DOM、零依赖：整条折叠逻辑在 Node 里全测。
 */

import type { DerivedEntry, DerivedModel, DerivedState } from './model.js'

export interface DerivedCacheOptions {
  /** 最多为多少个会话保留折叠结果（有引用的不算在内）。 */
  readonly capacity?: number
  readonly now?: () => number
  readonly onEvict?: (sessionId: string, reason: 'lru' | 'generation' | 'dropped') => void
}

export interface AcquireOptions {
  /** Host 换代号。不一致说明日志可能重来，旧派生必须整份作废。 */
  readonly generation?: number
  /** 由 pinned 窗口持有：这类会话不参与淘汰。 */
  readonly pinned?: boolean
}

export interface DerivedHandle<S> {
  readonly sessionId: string
  readonly key: string
  readonly generation: number
  /**
   * true = 你加入时这个会话已经折叠过事件了，你的初始状态是空的。
   * 调用方需要从历史回放一遍（`ingest` 会按 slot 各自去重，不会喂重复），
   * 否则你只会看到之后的新事件。
   */
  readonly needsReplay: boolean
  state(): DerivedState<S>
  release(): void
}

export interface IngestResult {
  /** 至少被一个 slot 折叠过的条数。 */
  readonly folded: number
  /** 被跳过的条数（seq 不大于该 slot 的 lastSeq）。 */
  readonly skipped: number
  /** 这一轮实际检查过的条数（= folded + skipped）。 */
  readonly processed: number
  /** 还有没处理完的（只可能因为 budget）。 */
  readonly hasMore: boolean
  /** 没处理完的尾部，下一轮直接喂它，不必重扫整批。 */
  readonly rest?: readonly DerivedEntry[]
  /** 没有消费者时整批丢弃 —— 缓存不为没有人要的会话做折叠。 */
  readonly ignored: boolean
}

export interface IngestOptions {
  /**
   * 这一轮最多检查多少条事件。给大会话的历史回放用：
   * 5000 条同步折完会卡住一帧以上，分片就能让出主线程。
   */
  readonly budget?: number
}

export interface PrependResult {
  /** 真正拼进去的旧事件条数（0 = 全是已折过的重复）。 */
  readonly prepended: number
  /** 有模型拒绝增量拼接，调用方必须退回 `reset` + 整窗重折。 */
  readonly fallback: boolean
  /** 没有消费者，整批丢弃。 */
  readonly ignored: boolean
}

export interface DerivedCacheStats {
  readonly sessions: number
  readonly slots: number
  readonly applies: number
  readonly hits: number
  readonly misses: number
  readonly evicted: number
  /** 想淘汰但所有会话都被引用占着，只能超容量。 */
  readonly blockedEvictions: number
  readonly foldedEntries: number
  readonly skippedEntries: number
}

interface MutableState {
  status: 'unknown' | 'ready'
  value: unknown
  lastSeq: number
  /**
   * 已折过的最小 seq（`Infinity` 表示还没折过任何事件）。
   *
   * 增量前插靠它判断"这一页是不是真的更早"：`seq >= firstSeq` 的条目已经在
   * 状态里了，再折一遍会让消息重复。用 min 而不是"从 0 连续"，是因为窗口本来
   * 就可能从任意 seq 开始（会话日志有空洞、也会按页加载）。
   */
  firstSeq: number
  applied: number
  updatedAt: number
}

interface Slot {
  readonly model: DerivedModel<unknown>
  readonly state: MutableState
  view: DerivedState<unknown>
  refs: number
}

interface SessionRecord {
  readonly id: string
  generation: number
  lastUsed: number
  pinned: boolean
  lastSeq: number
  readonly slots: Map<string, Slot>
}

const DEFAULT_CAPACITY = 8

export class DerivedCache {
  private readonly records = new Map<string, SessionRecord>()
  private readonly now: () => number
  private readonly onEvict: DerivedCacheOptions['onEvict']
  private capacity: number
  private readonly listeners = new Set<() => void>()
  private counters = {
    applies: 0,
    hits: 0,
    misses: 0,
    evicted: 0,
    blockedEvictions: 0,
    foldedEntries: 0,
    skippedEntries: 0,
  }

  constructor(options: DerivedCacheOptions = {}) {
    this.capacity = Math.max(1, options.capacity ?? DEFAULT_CAPACITY)
    this.now = options.now ?? (() => Date.now())
    this.onEvict = options.onEvict
  }

  configure(options: { readonly capacity?: number }): void {
    if (options.capacity !== undefined) this.capacity = Math.max(1, options.capacity)
    this.trim()
  }

  acquire<S>(
    sessionId: string,
    model: DerivedModel<S>,
    options: AcquireOptions = {},
  ): DerivedHandle<S> {
    let record = this.records.get(sessionId)

    if (record && options.generation !== undefined && record.generation !== options.generation) {
      // 换代：日志可能重来，旧派生不能留。
      this.drop(sessionId, 'generation')
      record = undefined
    }

    if (!record) {
      record = {
        id: sessionId,
        generation: options.generation ?? 0,
        lastUsed: this.now(),
        pinned: options.pinned ?? false,
        lastSeq: -1,
        slots: new Map(),
      }
      this.records.set(sessionId, record)
    }

    if (options.pinned) record.pinned = true
    record.lastUsed = this.now()

    let slot = record.slots.get(model.key)
    const needsReplay = slot === undefined && record.lastSeq > -1
    if (!slot) {
      this.counters.misses += 1
      slot = {
        model: model as DerivedModel<unknown>,
        state: {
          status: 'unknown',
          value: model.initial(),
          lastSeq: -1,
          firstSeq: Number.POSITIVE_INFINITY,
          applied: 0,
          updatedAt: this.now(),
        },
        view: undefined as unknown as DerivedState<unknown>,
        refs: 0,
      }
      this.refresh(slot)
      record.slots.set(model.key, slot)
    } else {
      this.counters.hits += 1
    }

    slot.refs += 1
    // 加入新会话后立刻收口，避免容量短暂超出。
    this.trim()
    const owned = slot
    let released = false

    return {
      sessionId,
      key: model.key,
      generation: record.generation,
      needsReplay,
      state: () => owned.view as DerivedState<S>,
      release: () => {
        if (released) return
        released = true
        this.releaseSlot(owned)
      },
    }
  }

  /**
   * 喂一批事件。返回有多少条真正被折叠。
   *
   * 顺序无关：内部按 seq 升序处理，乱序批次也能正确折叠；
   * 重复与旧包按 slot 各自的 lastSeq 丢掉。
   */
  ingest(sessionId: string, entries: readonly DerivedEntry[], options: IngestOptions = {}): IngestResult {
    const record = this.records.get(sessionId)
    if (!record || record.slots.size === 0) {
      return { folded: 0, skipped: entries.length, processed: 0, hasMore: false, ignored: true }
    }
    if (entries.length === 0) {
      return { folded: 0, skipped: 0, processed: 0, hasMore: false, ignored: false }
    }

    const sorted = [...entries].sort((a, b) => a.seq - b.seq)
    const budget = options.budget ?? Number.POSITIVE_INFINITY
    let folded = 0
    let skipped = 0
    let index = 0

    for (; index < sorted.length; index += 1) {
      if (index >= budget) break
      const entry = sorted[index]
      if (!entry) continue
      let touched = false

      for (const slot of record.slots.values()) {
        if (entry.seq <= slot.state.lastSeq) continue
        slot.state.value = slot.model.apply(slot.state.value, entry)
        slot.state.lastSeq = entry.seq
        if (entry.seq < slot.state.firstSeq) slot.state.firstSeq = entry.seq
        slot.state.applied += 1
        slot.state.status = 'ready'
        slot.state.updatedAt = this.now()
        this.refresh(slot)
        this.counters.applies += 1
        touched = true
      }

      if (touched) folded += 1
      else skipped += 1
      if (entry.seq > record.lastSeq) record.lastSeq = entry.seq
    }

    this.counters.foldedEntries += folded
    this.counters.skippedEntries += skipped
    record.lastUsed = this.now()
    // 只在真的折出新内容时通知：重复投递不该触发重渲染。
    if (folded > 0) this.notify()

    const hasMore = index < sorted.length
    return {
      folded,
      skipped,
      processed: folded + skipped,
      hasMore,
      ...(hasMore ? { rest: sorted.slice(index) } : {}),
      ignored: false,
    }
  }

  /**
   * 就地重置一个会话的全部派生状态，**保留 slot 与引用**。
   *
   * 用途：真实事件窗口支持 `prepend`（向上加载更早的历史），而折叠是
   * 「seq 只增」的 —— 更早的事件会被 `seq <= lastSeq` 丢掉。此时唯一正确的
   * 做法是把状态清空后按新窗口重折一遍。
   *
   * 不用 `drop()` 的原因：drop 会删掉 record，所有已发出的 handle 立刻失效，
   * 视图必须重建。reset 保住 slot 对象，handle 继续有效，视图只会看到一次内容变化。
   */
  reset(sessionId: string): boolean {
    const record = this.records.get(sessionId)
    if (!record) return false
    for (const slot of record.slots.values()) {
      slot.state.status = 'unknown'
      slot.state.value = slot.model.initial()
      slot.state.lastSeq = -1
      slot.state.firstSeq = Number.POSITIVE_INFINITY
      slot.state.applied = 0
      slot.state.updatedAt = this.now()
      this.refresh(slot)
    }
    record.lastSeq = -1
    this.notify()
    return true
  }

  /**
   * 增量前插：把「更早的一页」接到当前折叠结果前面，**不重折已有内容**。
   *
   * 与 `reset` + 全窗 `ingest` 的差别就是省掉的那部分工作：整窗重折要把窗口里
   * 每一条都已折过的事件重新过一遍 adapter 与 `apply`（500 条历史 + 5000 条窗口
   * 时是 5000 次无用功）。这里只折真正新增的旧页，再让模型把两份状态拼起来。
   *
   * 模型可以拒绝拼接（返回 undefined）—— 比如"旧页结束时还有工具调用没结果"，
   * 硬拼会把一次调用断成两截。此时返回 `fallback: true`，调用方必须整窗重折。
   *
   * 已经被折过的条目（`seq >= firstSeq`）会被丢掉，所以重复投递是幂等的。
   */
  prepend(sessionId: string, entries: readonly DerivedEntry[]): PrependResult {
    const record = this.records.get(sessionId)
    if (!record || record.slots.size === 0) {
      return { prepended: 0, fallback: false, ignored: true }
    }
    if (entries.length === 0) return { prepended: 0, fallback: false, ignored: false }

    const sorted = [...entries].sort((a, b) => a.seq - b.seq)
    let prepended = 0
    let fallback = false

    for (const slot of record.slots.values()) {
      const older = sorted.filter((entry) => entry.seq < slot.state.firstSeq)
      if (older.length === 0) continue
      if (!slot.model.prepend) {
        fallback = true
        continue
      }

      let staged = slot.model.initial()
      for (const entry of older) staged = slot.model.apply(staged, entry)
      const merged = slot.model.prepend(staged, slot.state.value)
      if (merged === undefined) {
        // 当前状态不动，交给调用方整窗重折。
        fallback = true
        continue
      }

      slot.state.value = merged
      slot.state.firstSeq = older[0]?.seq ?? slot.state.firstSeq
      slot.state.applied += older.length
      slot.state.updatedAt = this.now()
      this.refresh(slot)
      // 与 ingest 同口径：`applies` 数的是 `apply` 调用次数（调试面板按它看成本），
      // 增量前插也是真的调了 apply，不能漏计 —— 否则"省了多少"根本无从比较。
      this.counters.applies += older.length
      this.counters.foldedEntries += older.length
      prepended = Math.max(prepended, older.length)
    }

    // 前插不改变 lastSeq（更早的事件不会比已有的尾更大），但 record.lastSeq 保持。
    if (prepended > 0) this.notify()
    return { prepended, fallback, ignored: false }
  }

  /** 显式丢弃某个会话（会话被删除、或用户关掉"保留缓存"）。 */
  drop(sessionId: string, reason: 'generation' | 'dropped' = 'dropped'): boolean {
    if (!this.records.delete(sessionId)) return false
    this.onEvict?.(sessionId, reason)
    this.notify()
    return true
  }

  /** 变更通知。React 侧配 `useSyncExternalStore` 用（快照对象身份稳定）。 */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Host 换代：所有不是这一代的派生都作废。 */
  resetGenerations(generation: number): string[] {
    const dropped: string[] = []
    for (const [id, record] of [...this.records]) {
      if (record.generation === generation) continue
      this.records.delete(id)
      this.onEvict?.(id, 'generation')
      dropped.push(id)
    }
    if (dropped.length > 0) this.notify()
    return dropped
  }

  pin(sessionId: string, pinned = true): void {
    const record = this.records.get(sessionId)
    if (record) record.pinned = pinned
    this.trim()
  }

  peek(sessionId: string, key: string): DerivedState<unknown> | undefined {
    return this.records.get(sessionId)?.slots.get(key)?.view
  }

  /** 仅供调试/测试：某个 slot 当前被几个视图持有。 */
  refCount(sessionId: string, key: string): number {
    return this.records.get(sessionId)?.slots.get(key)?.refs ?? 0
  }

  stats(): DerivedCacheStats {
    let slots = 0
    for (const record of this.records.values()) slots += record.slots.size
    return { sessions: this.records.size, slots, ...this.counters }
  }

  private releaseSlot(slot: Slot): void {
    slot.refs = Math.max(0, slot.refs - 1)
    this.trim()
  }

  /**
   * LRU 淘汰。选不中的情况会累加 `blockedEvictions` —— 宁可超容量，
   * 也不淘汰还挂在视图上的会话（那会让 UI 看到状态凭空消失）。
   */
  private trim(): void {
    while (this.records.size > this.capacity) {
      let victim: SessionRecord | undefined
      for (const record of this.records.values()) {
        if (record.pinned) continue
        let refs = 0
        for (const slot of record.slots.values()) refs += slot.refs
        if (refs > 0) continue
        if (!victim || record.lastUsed < victim.lastUsed) victim = record
      }

      if (!victim) {
        this.counters.blockedEvictions += 1
        return
      }
      this.records.delete(victim.id)
      this.counters.evicted += 1
      this.onEvict?.(victim.id, 'lru')
      this.notify()
    }
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }

  private refresh(slot: Slot): void {
    slot.view = {
      status: slot.state.status,
      value: slot.state.value,
      lastSeq: slot.state.lastSeq,
      applied: slot.state.applied,
      updatedAt: slot.state.updatedAt,
    }
  }
}
