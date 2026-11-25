import { ContractValidationError } from "./contract-error.js";
import { BTW_ERROR_CODES, BTW_ID_MAX_CHARS, BTW_STATUSES, } from "./contracts/btw.js";
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
function boundedNonEmptyString(value, path, maxChars) {
    if (typeof value !== "string" || value.length === 0) {
        throw new ContractValidationError("expected a non-empty string", path);
    }
    if (value.length > maxChars)
        throw new ContractValidationError(`string exceeds ${maxChars} characters`, path);
    return value;
}
function boundedString(value, path, maxChars) {
    if (typeof value !== "string")
        throw new ContractValidationError("expected a string", path);
    if (value.length > maxChars)
        throw new ContractValidationError(`string exceeds ${maxChars} characters`, path);
    return value;
}
function parseBtwError(value, path) {
    const input = record(value, path);
    exactKeys(input, ["code", "message"], path);
    if (!BTW_ERROR_CODES.includes(input.code)) {
        throw new ContractValidationError("unsupported BTW error code", `${path}.code`);
    }
    boundedString(input.message, `${path}.message`, Number.POSITIVE_INFINITY);
    return input;
}
/**
 * Structural parse for the `btw.changed` payload. The Runtime already keeps
 * this snapshot path-free, so this is a contract boundary check rather than a
 * sanitizer: an unknown field or an out-of-range status is a protocol bug and
 * must fail the frame instead of reaching the Renderer as `unknown`.
 */
export function parseBtwSnapshot(value, path = "$snapshot") {
    const input = record(value, path);
    exactKeys(input, ["ephemeralId", "status", "text", "copy", "error", "sessionId", "topicId", "question", "title", "turnIndex", "injection"], path);
    for (const key of ["sessionId", "topicId"])
        if (input[key] !== undefined)
            boundedNonEmptyString(input[key], path + "." + key, BTW_ID_MAX_CHARS);
    if (input.question !== undefined)
        boundedString(input.question, path + ".question", Number.POSITIVE_INFINITY);
    boundedNonEmptyString(input.ephemeralId, `${path}.ephemeralId`, BTW_ID_MAX_CHARS);
    if (!BTW_STATUSES.includes(input.status)) {
        throw new ContractValidationError("unsupported BTW status", `${path}.status`);
    }
    boundedString(input.text, `${path}.text`, Number.POSITIVE_INFINITY);
    if (input.copy !== undefined)
        boundedString(input.copy, `${path}.copy`, Number.POSITIVE_INFINITY);
    if (input.error !== undefined)
        parseBtwError(input.error, `${path}.error`);
    return input;
}
export function isBtwStatus(value) {
    return typeof value === "string" && BTW_STATUSES.includes(value);
}
export function isBtwErrorCode(value) {
    return typeof value === "string" && BTW_ERROR_CODES.includes(value);
}
//# sourceMappingURL=btw-validation.js.map