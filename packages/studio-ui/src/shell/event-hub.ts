/**
 * 事件订阅的唯一入口 —— 同一个会话只订阅一次 `eventSource`。
 *
 * 为什么必须共享：一个会话开两个窗口时，如果每个视图各自订阅，两边都会
 * 在挂载时执行一次 flush。真机实测（probe-workbench-deep）：两个窗口时
 * `applies` 从 20 直接变 40，折叠量翻倍，且第二个窗口挂上来会**清掉已有状态**
 * 再重建 —— 表现为打开第二个窗口时第一个窗口的内容闪一下。
 *
 * 为什么不靠 `change.kind` 判断要不要重折：
 * `SessionEventWindow.change` 是"最近一次变更"的快照字段，它不会因为有人重读
 * 而更新。于是"重新挂载 / 重投通知"这类**内容没变**的场景，会读到上一次的
 * `replace`，被误判成"窗口起点变了"，整窗重折。这条真机与单测都抓到过。
 *
 * 现在的做法是记**自己的折叠进度** `{ min, max }`，判断依据只有"窗口内容有没有
 * 朝更早的方向扩展"：
 * - 窗口最早的 seq 比已折的 min 更小 → 向前扩展了（prepend），必须 reset 重折；
 * - 否则只折 `seq > max` 的部分 —— 内容没变时自然什么都不折（幂等）。
 *
 * `change.kind === 'append'` 仍走快路径（只映射新增的那几条），避免每次实时
 * 追加都全量映射整个窗口（5000 条窗口下那是 O(n²)）。
 *
 * 与 `SessionLeaseRegistry` 的分工：那一层管「会话引用（retain）」，
 * 这一层管「事件订阅」。两件事的生命周期不同（引用要跨搬家保活，
 * 订阅跟着实际渲染走），所以不合并。
 */

import type { DerivedCache } from '../session-derived/cache.js'
import { toDerivedEntries, type RawSessionEventWindow, type SnapshotLike } from './event-adapter.js'

interface Subscription {
  readonly source: SnapshotLike<RawSessionEventWindow>
  readonly off: () => void
  count: number
}

/** 已折过的 seq 区间。`max` 之前的 durable 事件都已进缓存。 */
interface Progress {
  min: number
  max: number
}

export interface SessionEventHubOptions {
  readonly cache: DerivedCache
  /** 调试：每次 reset/ingest 打一行。 */
  readonly trace?: boolean
}

export class SessionEventHub {
  private readonly cache: DerivedCache
  private readonly trace: boolean
  private readonly subs = new Map<string, Subscription>()
  /**
   * 每个会话的折叠进度。**跨订阅存亡保留** —— 搬家时订阅会拆了再建，
   * 进度不能跟着丢，否则重建那一刻会把整窗再折一遍。
   */
  private readonly progress = new Map<string, Progress>()

  constructor(options: SessionEventHubOptions) {
    this.cache = options.cache
    this.trace = options.trace === true
  }

  /**
   * 让这个视图加入某会话的事件订阅。
   * @returns 幂等的 detach；最后一个视图离开时取消订阅。
   */
  attach(sessionId: string, source: SnapshotLike<RawSessionEventWindow> | undefined): () => void {
    if (!source) return () => {}

    const existing = this.subs.get(sessionId)
    if (existing && existing.source === source) {
      existing.count += 1
      // 同一订阅已存在：内容只会通过回调更新，这里不必再读一次。
      return this.makeDetach(sessionId, existing)
    }

    // 同一会话换了 source 实例（例如换了一代）：先退掉旧的，再建新的。
    // 换实例意味着可能是新的一代，进度作废。
    if (existing) {
      existing.off()
      this.subs.delete(sessionId)
      this.progress.delete(sessionId)
      this.cache.reset(sessionId)
    }

    // 首次挂载（或搬家后重挂）：读一次窗口补齐。内容没变时这次是空操作。
    this.flush(sessionId, source)

    const off = source.subscribe(() => this.flush(sessionId, source))
    const sub: Subscription = { source, off, count: 1 }
    this.subs.set(sessionId, sub)
    return this.makeDetach(sessionId, sub)
  }

  /** 当前正在订阅多少个会话（调试用）。 */
  get size(): number {
    return this.subs.size
  }

  /** 某个会话被几个视图共用同一订阅。 */
  countOf(sessionId: string): number {
    return this.subs.get(sessionId)?.count ?? 0
  }

  /** 已折到哪个 seq（调试用；`undefined` 表示还没折过）。 */
  progressOf(sessionId: string): Progress | undefined {
    return this.progress.get(sessionId)
  }

  dispose(): void {
    for (const sub of this.subs.values()) sub.off()
    this.subs.clear()
  }

  private makeDetach(sessionId: string, sub: Subscription): () => void {
    let done = false
    return () => {
      if (done) return
      done = true
      sub.count -= 1
      if (sub.count > 0) return
      // 只有仍是当前登记的那个才拆（换过一代的情况已被 attach 处理）
      if (this.subs.get(sessionId) === sub) this.subs.delete(sessionId)
      sub.off()
    }
  }

  private flush(sessionId: string, source: SnapshotLike<RawSessionEventWindow>): void {
    let window: RawSessionEventWindow
    try {
      window = source.getSnapshot()
    } catch (error) {
      console.warn('[studio] 读事件窗口失败', error)
      return
    }
    if (!window || window.entries.length === 0) return

    const prev = this.progress.get(sessionId)
    const change = window.change

    // ── 快路径：尾部追加。只映射新增的那几条，避免全量映射整个窗口。 ──
    if (change?.kind === 'append' && prev) {
      const fresh = toDerivedEntries(change.entries ?? []).filter((entry) => entry.seq > prev.max)
      if (fresh.length === 0) return
      if (this.trace) console.log(`[hub] ${sessionId} append +${fresh.length}`)
      this.cache.ingest(sessionId, fresh)
      this.progress.set(sessionId, { min: prev.min, max: fresh[fresh.length - 1]?.seq ?? prev.max })
      return
    }

    // ── 快路径：流式结算。durable 消息替换 transient 行。 ──
    if (change?.kind === 'settle-assistant' && prev) {
      if (!change.entry) return
      const settled = toDerivedEntries([change.entry]).filter((entry) => entry.seq > prev.max)
      if (settled.length === 0) return
      if (this.trace) console.log(`[hub] ${sessionId} settle +${settled.length}`)
      this.cache.ingest(sessionId, settled)
      this.progress.set(sessionId, { min: prev.min, max: settled[settled.length - 1]?.seq ?? prev.max })
      return
    }

    // ── 慢路径：首次读、重挂载、replace、prepend。
    //    必须全量映射，但只在窗口变过时才真的折。 ──
    const durable = toDerivedEntries(window.entries)
    if (durable.length === 0) return

    const head = durable[0]?.seq ?? 0
    const tail = durable[durable.length - 1]?.seq ?? 0

    // 窗口向前扩展了（拿到更早的历史）→ 优先增量前插。
    if (!prev || head < prev.min) {
      if (!prev) {
        // 首次读：没有可复用的旧结果，整窗折一遍。
        if (this.trace) {
          console.log(`[hub] ${sessionId} initial (${change?.kind ?? 'none'}) → ${durable.length} 条`)
        }
        this.cache.reset(sessionId)
        this.cache.ingest(sessionId, durable)
        this.progress.set(sessionId, { min: head, max: tail })
        return
      }

      // 增量前插：只折真正更早的那一段，再让模型把两份状态拼起来。
      // 拼不了（页边界切在工具调用中间、或模型不支持）才退回整窗重折。
      const older = durable.filter((entry) => entry.seq < prev.min)
      const prepended = this.cache.prepend(sessionId, older)
      if (prepended.fallback) {
        if (this.trace) {
          console.log(`[hub] ${sessionId} rebuild (fallback) → ${durable.length} 条`)
        }
        this.cache.reset(sessionId)
        this.cache.ingest(sessionId, durable)
        this.progress.set(sessionId, { min: head, max: tail })
        return
      }

      if (this.trace) {
        console.log(`[hub] ${sessionId} prepend +${prepended.prepended} (窗口 ${head}…${tail})`)
      }
      const fresh = durable.filter((entry) => entry.seq > prev.max)
      if (fresh.length > 0) this.cache.ingest(sessionId, fresh)
      this.progress.set(sessionId, { min: head, max: Math.max(prev.max, tail) })
      return
    }

    // 内容没变或只在尾部增长：只折没折过的部分。
    const fresh = durable.filter((entry) => entry.seq > prev.max)
    if (fresh.length === 0) return
    if (this.trace) console.log(`[hub] ${sessionId} catch-up +${fresh.length}`)
    this.cache.ingest(sessionId, fresh)
    this.progress.set(sessionId, { min: prev.min, max: tail })
  }
}
