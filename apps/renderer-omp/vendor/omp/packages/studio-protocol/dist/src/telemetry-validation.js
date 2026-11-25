import { ContractValidationError } from "./contract-error.js";
function record(value, path) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new ContractValidationError("expected an object", path);
    }
    return value;
}
function exactKeys(value, allowed, path) {
    const allowedSet = new Set(allowed);
    const unknown = Object.keys(value).find((key) => !allowedSet.has(key));
    if (unknown !== undefined)
        throw new ContractValidationError(`unknown field ${JSON.stringify(unknown)}`, path);
}
function nonEmptyString(value, path) {
    if (typeof value !== "string" || value.length === 0)
        throw new ContractValidationError("expected a non-empty string", path);
    return value;
}
function nonNegativeInteger(value, path) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new ContractValidationError("expected a non-negative safe integer", path);
    }
    return value;
}
function finiteNonNegative(value, path) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new ContractValidationError("expected a finite non-negative number", path);
    }
    return value;
}
function booleanValue(value, path) {
    if (typeof value !== "boolean")
        throw new ContractValidationError("expected a boolean", path);
    return value;
}
const TOKEN_FIELDS = ["input", "output", "reasoning", "cacheRead", "cacheWrite", "total", "cost"];
const UNAVAILABLE_REASONS = [
    "runtime_not_ready",
    "model_context_unknown",
    "probe_dynamic_context_disabled",
];
const TELEMETRY_SOURCES = ["live", "persisted", "archive-recomputed"];
const TELEMETRY_SEMANTICS = [
    "current-live",
    "last-observed",
    "current-environment-recomputed",
];
function parseTokenSet(value, path) {
    const input = record(value, path);
    exactKeys(input, TOKEN_FIELDS, path);
    for (const field of TOKEN_FIELDS)
        finiteNonNegative(input[field], `${path}.${field}`);
    return input;
}
function parseTurn(value, path) {
    const input = record(value, path);
    exactKeys(input, [...TOKEN_FIELDS, "completedAt", "durationMs", "tps"], path);
    for (const field of TOKEN_FIELDS)
        finiteNonNegative(input[field], `${path}.${field}`);
    nonEmptyString(input.completedAt, `${path}.completedAt`);
    if (input.durationMs !== undefined)
        nonNegativeInteger(input.durationMs, `${path}.durationMs`);
    if (input.tps !== undefined)
        finiteNonNegative(input.tps, `${path}.tps`);
    return input;
}
function parseContext(value, path) {
    const input = record(value, path);
    const fields = [
        "contextWindow",
        "usedTokens",
        "percent",
        "anchored",
        "systemPromptTokens",
        "systemContextTokens",
        "systemToolsTokens",
        "skillsTokens",
        "messagesTokens",
    ];
    exactKeys(input, fields, path);
    nonNegativeInteger(input.contextWindow, `${path}.contextWindow`);
    if (input.contextWindow <= 0)
        throw new ContractValidationError("expected a positive integer", `${path}.contextWindow`);
    for (const field of ["usedTokens", "systemPromptTokens", "systemContextTokens", "systemToolsTokens", "skillsTokens", "messagesTokens"]) {
        nonNegativeInteger(input[field], `${path}.${field}`);
    }
    finiteNonNegative(input.percent, `${path}.percent`);
    booleanValue(input.anchored, `${path}.anchored`);
    return input;
}
export function parseSessionTelemetrySnapshot(value, path = "$telemetry") {
    const input = record(value, path);
    exactKeys(input, ["sessionId", "capturedAt", "tokens", "lastCompletedTurn", "context", "unavailableReason", "advisorCost", "generationTps", "requestedModel", "servedModel", "treeCost", "budget", "editRejections", "offTranscript", "decisionModels"], path);
    nonEmptyString(input.sessionId, `${path}.sessionId`);
    nonEmptyString(input.capturedAt, `${path}.capturedAt`);
    for (const key of ["advisorCost", "generationTps"])
        if (input[key] !== undefined)
            finiteNonNegative(input[key], path + "." + key);
    for (const key of ["requestedModel", "servedModel"])
        if (input[key] !== undefined) {
            nonEmptyString(input[key], path + "." + key);
            if (input[key].length > 256)
                throw new ContractValidationError("model name too long", path);
        }
    parseTokenSet(input.tokens, `${path}.tokens`);
    if (input.lastCompletedTurn !== undefined)
        parseTurn(input.lastCompletedTurn, `${path}.lastCompletedTurn`);
    if (input.context !== null)
        parseContext(input.context, `${path}.context`);
    if (input.unavailableReason !== undefined && !UNAVAILABLE_REASONS.includes(input.unavailableReason)) {
        throw new ContractValidationError("unsupported telemetry unavailable reason", `${path}.unavailableReason`);
    }
    return input;
}
export function parseSessionTelemetryReadResult(value, path = "$result") {
    const input = record(value, path);
    exactKeys(input, ["sessionId", "source", "semantics", "telemetry"], path);
    nonEmptyString(input.sessionId, `${path}.sessionId`);
    if (!TELEMETRY_SOURCES.includes(input.source)) {
        throw new ContractValidationError("unsupported telemetry source", `${path}.source`);
    }
    if (!TELEMETRY_SEMANTICS.includes(input.semantics)) {
        throw new ContractValidationError("unsupported telemetry semantics", `${path}.semantics`);
    }
    const telemetry = parseSessionTelemetrySnapshot(input.telemetry, `${path}.telemetry`);
    if (telemetry.sessionId !== input.sessionId) {
        throw new ContractValidationError("telemetry session mismatch", `${path}.sessionId`);
    }
    return input;
}
export function parseSessionTelemetryEvent(value, path = "$event.event") {
    const input = record(value, path);
    exactKeys(input, ["kind", "sessionId", "telemetry"], path);
    if (input.kind !== "session.telemetry.changed")
        throw new ContractValidationError("unsupported telemetry event", `${path}.kind`);
    nonEmptyString(input.sessionId, `${path}.sessionId`);
    const telemetry = parseSessionTelemetrySnapshot(input.telemetry, `${path}.telemetry`);
    if (telemetry.sessionId !== input.sessionId)
        throw new ContractValidationError("telemetry session mismatch", `${path}.sessionId`);
    return input;
}
export function isSessionTelemetryEventKind(kind) {
    return kind === "session.telemetry.changed";
}
//# sourceMappingURL=telemetry-validation.js.map