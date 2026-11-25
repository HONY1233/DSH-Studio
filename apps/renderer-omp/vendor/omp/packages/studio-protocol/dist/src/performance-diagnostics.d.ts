/**
 * Shared numeric diagnostics helpers (W01).
 *
 * Every process (Electron Main/Host, Renderer, Runtime) owns caches, queues and
 * listeners whose *counts* are worth logging, but nothing here is a wire
 * contract: no envelope, no client-contract query, no Host capability. The
 * module deals only in finite non-negative numbers under fixed keys, so a
 * pasted log line can never carry a transcript, a path or a session title.
 *
 * Three pieces, each independently testable with injected clocks:
 *
 * - `createCounterRegistry()` — modules register a `read()` returning scalars
 *   they already track; the sampler never reaches into private state.
 * - `createMemorySampleGate()` — first / significant change / counter change /
 *   heartbeat gating so a static process writes one line per heartbeat, not
 *   one per sample.
 * - `formatMemorySampleLine()` — the single bounded `k=v` line handed to the
 *   existing log sinks (HostLog `detail` is capped at 2000 chars).
 */
export type PerformanceCounters = Readonly<Record<string, number>>;
export interface CounterRegistry {
    /**
     * Register a provider under a fixed name. Returns an idempotent unregister.
     * A second provider under the same name is a programming error and throws;
     * silently replacing it would hide a leaked registration.
     */
    register(name: string, read: () => PerformanceCounters): () => void;
    /** Read every provider once. Keys are `${provider}.${counter}`. */
    collect(): PerformanceCounters;
    /** Number of live providers — itself a resource count worth reporting. */
    providerCount(): number;
}
export type MemorySampleRole = "main-host" | "renderer" | "runtime";
export interface MemorySample {
    role: MemorySampleRole;
    rssBytes?: number;
    heapUsedBytes?: number;
    heapTotalBytes?: number;
    externalBytes?: number;
    arrayBuffersBytes?: number;
    counters: PerformanceCounters;
}
export declare function isValidCounterValue(value: unknown): value is number;
export declare function isValidCounterName(name: unknown): name is string;
/**
 * Keep only well-formed entries of a provider result: valid key, finite
 * non-negative value. Invalid entries are dropped, never coerced — a `NaN`
 * turned into `0` would read as "empty", which is exactly the lie the plan
 * forbids ("missing" must stay missing).
 */
export declare function sanitizeCounters(input: unknown): PerformanceCounters;
export declare function createCounterRegistry(): CounterRegistry;
/** Pick a fixed subset of counters; unknown names are ignored, missing stay missing. */
export declare function selectCounters(counters: PerformanceCounters, allowList: readonly string[]): PerformanceCounters;
/** Drop memory fields that are not finite non-negative numbers; keep counters sane. */
export declare function normalizeMemorySample(sample: MemorySample): MemorySample;
export interface MemorySampleGateOptions {
    /** Injected clock in milliseconds. */
    readonly now: () => number;
    /** Heartbeat interval; a static process logs once per heartbeat. Default 5 minutes. */
    readonly heartbeatMs?: number;
    /** Relative heap change that counts as significant. Default 5%. */
    readonly heapRatio?: number;
    /** Relative RSS / external / ArrayBuffer change that counts as significant. Default 10%. */
    readonly nativeRatio?: number;
    /**
     * Absolute floor under which a relative change is noise. Guards the zero /
     * tiny-base case: going from 0 to 4 KiB is an infinite ratio but not news.
     * Default 1 MiB.
     */
    readonly minDeltaBytes?: number;
}
export type MemorySampleGateReason = "first" | "memory" | "counters" | "heartbeat";
export interface MemorySampleGateDecision {
    readonly log: boolean;
    readonly reason?: MemorySampleGateReason;
    /** Sequence number of accepted samples, starting at 1; stays on the last accepted value when `log` is false. */
    readonly seq: number;
}
export interface MemorySampleGate {
    /** Decide whether `sample` deserves a log line; accepted samples become the new baseline. */
    observe(sample: MemorySample): MemorySampleGateDecision;
    /** Forget the baseline so the next sample logs as `first` again. */
    reset(): void;
}
export declare function createMemorySampleGate(options: MemorySampleGateOptions): MemorySampleGate;
export interface FormatMemorySampleOptions {
    /** Upper bound on the produced line; default 1900 (under HostLog's 2000-char detail cap). */
    readonly maxLength?: number;
    /** Extra fixed fields rendered before the memory fields (e.g. `seq`, `reason`, `instance`). */
    readonly prefix?: Readonly<Record<string, string | number>>;
}
/**
 * One `k=v` line: role, prefix fields, present memory fields, then counters in
 * insertion order. Missing memory fields are simply absent. When the counters
 * do not fit, trailing ones are dropped and `…+N` records how many.
 *
 * RSS, heap, external and ArrayBuffer bytes are reported side by side and
 * never summed: ArrayBuffers may already be inside `external`, and RSS counts
 * shared pages. Cache byte budgets logged as counters are logical budgets, not
 * V8 heap occupancy — the caller's counter names should say so.
 */
export declare function formatMemorySampleLine(sample: MemorySample, options?: FormatMemorySampleOptions): string;
export interface DiagnosticsSamplerOptions {
    /** Regular interval; default 60 seconds. */
    readonly intervalMs?: number;
    /** Take one sample. May be async; a rejected sample is skipped, not retried early. */
    readonly sample: () => MemorySample | undefined | Promise<MemorySample | undefined>;
    /** Receives every sample the gate accepts. Must not throw into the timer. */
    readonly emit: (sample: MemorySample, decision: MemorySampleGateDecision) => void;
    readonly gate: MemorySampleGate;
    /** Injected timers so tests and `unref()`-capable hosts stay in control. */
    readonly setInterval: (callback: () => void, ms: number) => unknown;
    readonly clearInterval: (handle: unknown) => void;
    /** Called with the interval handle once; Node callers pass `(h) => h.unref?.()`. */
    readonly onScheduled?: (handle: unknown) => void;
}
export interface DiagnosticsSampler {
    /** Idempotent; a started sampler keeps a single interval. */
    start(): void;
    /** Run one sample now (still subject to the no-overlap guard and the gate). */
    tick(): Promise<void>;
    /** Clear the interval; a sample in flight is discarded when it resolves. */
    dispose(): void;
    readonly running: boolean;
}
/**
 * Periodic sampling with two invariants the plan spells out: samples never
 * overlap (a slow `sample()` skips the next tick instead of piling up), and
 * `dispose()` both clears the timer and drops any late result.
 */
export declare function createDiagnosticsSampler(options: DiagnosticsSamplerOptions): DiagnosticsSampler;
//# sourceMappingURL=performance-diagnostics.d.ts.map