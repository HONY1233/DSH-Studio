/** One event subscription and one ordered fold path per session (XC-04/XC-14). */
import type { DerivedCache } from '../session-derived/cache.js'
import type { DerivedEntry } from '../session-derived/model.js'
import { toDerivedEntries, type RawSessionEventWindow, type SnapshotLike } from './event-adapter.js'

interface Subscription {
  readonly source: SnapshotLike<RawSessionEventWindow>
  off: () => void
  count: number
}

interface Progress {
  min: number
  max: number
}

export type EventContinuity = 'unknown' | 'complete' | 'gap' | 'conflict' | 'buffer-overflow'

export interface SessionEventHubOptions {
  readonly cache: DerivedCache
  readonly trace?: boolean
  /** Host facts such as usage are emitted only for entries actually folded. */
  readonly onEntries?: (sessionId: string, entries: readonly DerivedEntry[]) => void
  readonly maxPendingEntries?: number
}

interface SessionProgress {
  readonly progress: Progress
  signatures: Map<number, string>
  readonly pending: Map<number, DerivedEntry>
  continuity: EventContinuity
}

export class SessionEventHub {
  private readonly cache: DerivedCache
  private readonly trace: boolean
  private readonly onEntries: SessionEventHubOptions['onEntries']
  private readonly maxPendingEntries: number
  private readonly subs = new Map<string, Subscription>()
  private readonly progress = new Map<string, Progress>()
  private readonly states = new Map<string, SessionProgress>()
  private readonly windows = new Map<string, RawSessionEventWindow>()
  private readonly windowListeners = new Set<() => void>()

  constructor(options: SessionEventHubOptions) {
    this.cache = options.cache
    this.trace = options.trace === true
    this.onEntries = options.onEntries
    this.maxPendingEntries = options.maxPendingEntries ?? 5000
  }

  attach(sessionId: string, source: SnapshotLike<RawSessionEventWindow> | undefined): () => void {
    if (!source) return () => {}
    const existing = this.subs.get(sessionId)
    if (existing && existing.source === source) {
      existing.count += 1
      return this.makeDetach(sessionId, existing)
    }
    if (existing) {
      existing.off()
      this.subs.delete(sessionId)
      this.progress.delete(sessionId)
      this.states.delete(sessionId)
      this.cache.reset(sessionId)
    }

    // Register before subscribing: some observable sources synchronously emit
    // their current snapshot from inside subscribe().
    const sub: Subscription = { source, off: () => {}, count: 1 }
    this.subs.set(sessionId, sub)
    this.flush(sessionId, source)
    try {
      sub.off = source.subscribe(() => {
        // A callback from a replaced generation must never mutate the new cache.
        if (this.subs.get(sessionId) === sub) this.flush(sessionId, source)
      })
    } catch (error) {
      if (this.subs.get(sessionId) === sub) this.subs.delete(sessionId)
      throw error
    }
    return this.makeDetach(sessionId, sub)
  }

  get size(): number {
    return this.subs.size
  }

  countOf(sessionId: string): number {
    return this.subs.get(sessionId)?.count ?? 0
  }

  progressOf(sessionId: string): Progress | undefined {
    return this.progress.get(sessionId)
  }

  continuityOf(sessionId: string): EventContinuity {
    return this.states.get(sessionId)?.continuity ?? 'unknown'
  }

  /** Shared render snapshot; ConversationBody must not subscribe to source directly. */
  getWindowSnapshot(sessionId: string): RawSessionEventWindow | undefined {
    return this.windows.get(sessionId)
  }

  subscribeWindow = (listener: () => void): (() => void) => {
    this.windowListeners.add(listener)
    return () => { this.windowListeners.delete(listener) }
  }

  dispose(): void {
    for (const sub of this.subs.values()) sub.off()
    this.subs.clear()
    this.progress.clear()
    this.states.clear()
    this.windows.clear()
    this.windowListeners.clear()
  }

  private makeDetach(sessionId: string, sub: Subscription): () => void {
    let done = false
    return () => {
      if (done) return
      done = true
      sub.count -= 1
      if (sub.count > 0) return
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
    this.windows.set(sessionId, window)
    for (const listener of [...this.windowListeners]) listener()
    if (!window || window.entries.length === 0) return

    const all = toDerivedEntries(window.entries).sort((left, right) => left.seq - right.seq)
    let state = this.states.get(sessionId)
    if (!state) {
      const head = all[0]?.seq ?? 0
      const tail = all.at(-1)?.seq ?? 0
      this.cache.reset(sessionId)
      this.cache.ingest(sessionId, all)
      state = {
        progress: { min: head, max: tail },
        signatures: new Map(all.map((entry) => [entry.seq, this.signature(entry)])),
        pending: new Map(),
        continuity: 'complete',
      }
      this.states.set(sessionId, state)
      this.progress.set(sessionId, state.progress)
      this.onEntries?.(sessionId, all)
      if (this.trace) console.log(`[hub] ${sessionId} initial → ${all.length} 条`)
      return
    }

    const prev = state.progress
    const head = all[0]?.seq ?? prev.min
    if (head < prev.min) {
      const older = all.filter((entry) => entry.seq < prev.min)
      for (const entry of older) {
        if (!this.remember(state, entry)) return
      }
      const prepended = this.cache.prepend(sessionId, older)
      if (prepended.fallback) {
        this.cache.reset(sessionId)
        this.cache.ingest(sessionId, all)
        state.progress.min = head
        state.progress.max = all.at(-1)?.seq ?? prev.max
        state.signatures = new Map(all.map((entry) => [entry.seq, this.signature(entry)]))
        state.pending.clear()
        state.continuity = 'complete'
        this.onEntries?.(sessionId, all)
      } else {
        state.progress.min = head
        this.onEntries?.(sessionId, older)
      }
    }

    // Append fast path maps only the delta. A gap falls back to the full window,
    // which also recovers entries delivered out of order by the Host.
    const delta = window.change?.kind === 'append'
      ? toDerivedEntries(window.change.entries ?? [])
      : all
    for (const entry of delta) {
      if (!this.remember(state, entry)) return
    }
    this.drain(sessionId, state)
  }

  private drain(sessionId: string, state: SessionProgress): void {
    if (state.pending.size > this.maxPendingEntries) {
      state.continuity = 'buffer-overflow'
      return
    }
    const ready: DerivedEntry[] = []
    let next = state.progress.max + 1
    while (state.pending.has(next)) {
      const entry = state.pending.get(next)!
      ready.push(entry)
      state.pending.delete(next)
      next += 1
    }
    if (ready.length > 0) {
      this.cache.ingest(sessionId, ready)
      state.progress.max = ready.at(-1)!.seq
      state.continuity = 'complete'
      this.onEntries?.(sessionId, ready)
      if (this.trace) console.log(`[hub] ${sessionId} ordered +${ready.length}`)
    }
    if (state.pending.size > 0) state.continuity = 'gap'
  }

  private remember(state: SessionProgress, entry: DerivedEntry): boolean {
    const signature = this.signature(entry)
    const known = state.signatures.get(entry.seq)
    if (known !== undefined && known !== signature) {
      state.continuity = 'conflict'
      return false
    }
    state.signatures.set(entry.seq, signature)
    if (entry.seq > state.progress.max) state.pending.set(entry.seq, entry)
    return true
  }

  private signature(entry: DerivedEntry): string {
    return JSON.stringify(entry)
  }
}
