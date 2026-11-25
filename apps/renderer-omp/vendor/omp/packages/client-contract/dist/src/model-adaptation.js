export const MODEL_PARAMETER_FIELDS = ["contextWindow", "maxContextWindow", "maxTokens", "reasoning", "thinkingConfig", "snapcompactShape"];
/** Merge by presence, including explicit false/null, never by truthiness. */
export function mergeModelParameters(recommended, overrides) {
    const out = { ...recommended };
    for (const field of MODEL_PARAMETER_FIELDS) {
        if (overrides[field] !== undefined)
            out[field] = overrides[field];
    }
    if (out.reasoning === false)
        out.thinkingConfig = null;
    return out;
}
export function modelParameterValues(value) {
    if (value.parameters)
        return value.parameters;
    return Object.fromEntries(MODEL_PARAMETER_FIELDS.filter(field => value[field] !== undefined).map(field => [field, value[field]]));
}
/** Stable field comparison for provenance, independent of YAML map key order. */
export function sameModelParameter(left, right) {
    if (left === right)
        return true;
    if (Array.isArray(left) && Array.isArray(right))
        return left.length === right.length && left.every((v, i) => sameModelParameter(v, right[i]));
    if (left && right && typeof left === "object" && typeof right === "object") {
        const a = left, b = right;
        return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => Object.hasOwn(b, k) && sameModelParameter(a[k], b[k]));
    }
    return false;
}
//# sourceMappingURL=model-adaptation.js.map