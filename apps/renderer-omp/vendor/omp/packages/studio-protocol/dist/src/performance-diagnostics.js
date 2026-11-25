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
/**
 * Provider and counter names: lowercase start, then a short identifier. This
 * is the whole defence against dynamic keys — a session title or file path
 * cannot pass it, so providers cannot leak content by accident.
 */
const COUNTER_NAME = /^[a-z][A-Za-z0-9_.-]{0,79}$/u;
const PROVIDER_NAME = /^[a-z][A-Za-z0-9_-]{0,31}$/u;
/** A provider that returns more than this many counters is misusing the registry. */
const MAX_COUNTERS_PER_PROVIDER = 64;
export function isValidCounterValue(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
export function isValidCounterName(name) {
    return typeof name === "string" && COUNTER_NAME.test(name);
}
/**
 * Keep only well-formed entries of a provider result: valid key, finite
 * non-negative value. Invalid entries are dropped, never coerced — a `NaN`
 * turned into `0` would read as "empty", which is exactly the lie the plan
 * forbids ("missing" must stay missing).
 */
export function sanitizeCounters(input) {
    if (input === null || typeof input !== "object" || Array.isArray(input))
        return {};
    const result = {};
    let kept = 0;
    for (const [key, value] of Object.entries(input)) {
        if (!isValidCounterName(key) || !isValidCounterValue(value))
            continue;
        result[key] = value;
        kept += 1;
        if (kept >= MAX_COUNTERS_PER_PROVIDER)
            break;
    }
    return result;
}
export function createCounterRegistry() {
    const providers = new Map();
    return {
        register(name, read) {
            if (!PROVIDER_NAME.test(name)) {
                throw new Error(`invalid diagnostics provider name ${JSON.stringify(name)}`);
            }
            if (providers.has(name)) {
                throw new Error(`diagnostics provider ${JSON.stringify(name)} is already registered`);
            }
            providers.set(name, read);
            let active = true;
            return () => {
                if (!active)
                    return;
                active = false;
                // Only remove our own entry: a later provider re-using the name after
                // we unregistered must not be torn down by our stale closure.
                if (providers.get(name) === read)
                    providers.delete(name);
            };
        },
        collect() {
            const result = {};
            for (const [name, read] of providers) {
                let raw;
                try {
                    raw = read();
                }
                catch {
                    // A broken provider loses its own counters, nothing else.
                    continue;
                }
                for (const [key, value] of Object.entries(sanitizeCounters(raw))) {
                    result[`${name}.${key}`] = value;
                }
            }
            return result;
        },
        providerCount() {
            return providers.size;
        },
    };
}
/** Pick a fixed subset of counters; unknown names are ignored, missing stay missing. */
export function selectCounters(counters, allowList) {
    const result = {};
    for (const key of allowList) {
        const value = counters[key];
        if (isValidCounterValue(value))
            result[key] = value;
    }
    return result;
}
const MEMORY_FIELDS = ["rssBytes", "heapUsedBytes", "heapTotalBytes", "externalBytes", "arrayBuffersBytes"];
/** Drop memory fields that are not finite non-negative numbers; keep counters sane. */
export function normalizeMemorySample(sample) {
    const result = { role: sample.role, counters: sanitizeCounters(sample.counters) };
    for (const field of MEMORY_FIELDS) {
        const value = sample[field];
        if (isValidCounterValue(value))
            result[field] = value;
    }
    return result;
}
const DEFAULT_HEARTBEAT_MS = 5 * 60 * 1000;
const DEFAULT_HEAP_RATIO = 0.05;
const DEFAULT_NATIVE_RATIO = 0.1;
const DEFAULT_MIN_DELTA_BYTES = 1024 * 1024;
function significantChange(previous, next, ratio, minDelta) {
    if (previous === undefined || next === undefined)
        return previous !== next;
    const delta = Math.abs(next - previous);
    if (delta < minDelta)
        return false;
    return delta >= previous * ratio;
}
function countersChanged(previous, next) {
    const previousKeys = Object.keys(previous);
    const nextKeys = Object.keys(next);
    if (previousKeys.length !== nextKeys.length)
        return true;
    for (const key of nextKeys) {
        if (previous[key] !== next[key])
            return true;
    }
    return false;
}
export function createMemorySampleGate(options) {
    const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    const heapRatio = options.heapRatio ?? DEFAULT_HEAP_RATIO;
    const nativeRatio = options.nativeRatio ?? DEFAULT_NATIVE_RATIO;
    const minDelta = options.minDeltaBytes ?? DEFAULT_MIN_DELTA_BYTES;
    let baseline;
    let baselineAt = 0;
    let seq = 0;
    const accept = (sample, reason) => {
        baseline = sample;
        baselineAt = options.now();
        seq += 1;
        return { log: true, reason, seq };
    };
    return {
        observe(input) {
            const sample = normalizeMemorySample(input);
            if (baseline === undefined)
                return accept(sample, "first");
            const ratioFor = (field) => (field === "heapUsedBytes" || field === "heapTotalBytes" ? heapRatio : nativeRatio);
            for (const field of MEMORY_FIELDS) {
                if (significantChange(baseline[field], sample[field], ratioFor(field), minDelta))
                    return accept(sample, "memory");
            }
            if (countersChanged(baseline.counters, sample.counters))
                return accept(sample, "counters");
            if (options.now() - baselineAt >= heartbeatMs)
                return accept(sample, "heartbeat");
            return { log: false, seq };
        },
        reset() {
            baseline = undefined;
            baselineAt = 0;
        },
    };
}
const DEFAULT_LINE_MAX_LENGTH = 1900;
const PREFIX_VALUE = /^[A-Za-z0-9._:-]{1,64}$/u;
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
export function formatMemorySampleLine(sample, options = {}) {
    const requestedMaxLength = options.maxLength ?? DEFAULT_LINE_MAX_LENGTH;
    const maxLength = Number.isFinite(requestedMaxLength) ? Math.max(0, Math.floor(requestedMaxLength)) : DEFAULT_LINE_MAX_LENGTH;
    const normalized = normalizeMemorySample(sample);
    const parts = [`role=${normalized.role}`];
    for (const [key, value] of Object.entries(options.prefix ?? {})) {
        if (!isValidCounterName(key))
            continue;
        const text = typeof value === "number" ? (Number.isFinite(value) ? String(value) : undefined) : PREFIX_VALUE.test(value) ? value : undefined;
        if (text !== undefined)
            parts.push(`${key}=${text}`);
    }
    for (const field of MEMORY_FIELDS) {
        const value = normalized[field];
        if (value !== undefined)
            parts.push(`${field}=${Math.round(value)}`);
    }
    let line = parts.join(" ");
    const counterEntries = Object.entries(normalized.counters);
    let rendered = 0;
    for (const [key, value] of counterEntries) {
        const piece = ` ${key}=${Number.isInteger(value) ? value : value.toFixed(3)}`;
        // Reserve room for the overflow marker so the line never exceeds the cap.
        const marker = rendered + 1 < counterEntries.length ? ` …+${counterEntries.length - rendered - 1}`.length : 0;
        if (line.length + piece.length + marker > maxLength)
            break;
        line += piece;
        rendered += 1;
    }
    if (rendered < counterEntries.length)
        line += ` …+${counterEntries.length - rendered}`;
    // The fixed role/prefix portion can itself be wider than a caller-supplied
    // cap. Keep the public bound absolute even in that degenerate case.
    return line.length <= maxLength ? line : line.slice(0, maxLength);
}
const DEFAULT_SAMPLE_INTERVAL_MS = 60 * 1000;
/**
 * Periodic sampling with two invariants the plan spells out: samples never
 * overlap (a slow `sample()` skips the next tick instead of piling up), and
 * `dispose()` both clears the timer and drops any late result.
 */
export function createDiagnosticsSampler(options) {
    let handle;
    let inFlight = false;
    let disposed = false;
    let generation = 0;
    const tick = async () => {
        if (disposed || inFlight)
            return;
        inFlight = true;
        const current = generation;
        try {
            const sample = await options.sample();
            if (disposed || current !== generation || sample === undefined)
                return;
            const decision = options.gate.observe(sample);
            if (!decision.log)
                return;
            try {
                options.emit(normalizeMemorySample(sample), decision);
            }
            catch {
                // Sinks are diagnostics; a failing sink must not stop sampling.
            }
        }
        catch {
            // A failed sample is simply skipped.
        }
        finally {
            inFlight = false;
        }
    };
    return {
        start() {
            if (disposed || handle !== undefined)
                return;
            handle = options.setInterval(() => {
                void tick();
            }, options.intervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS);
            options.onScheduled?.(handle);
        },
        tick,
        dispose() {
            if (disposed)
                return;
            disposed = true;
            generation += 1;
            if (handle !== undefined)
                options.clearInterval(handle);
            handle = undefined;
        },
        get running() {
            return handle !== undefined && !disposed;
        },
    };
}
//# sourceMappingURL=performance-diagnostics.js.map