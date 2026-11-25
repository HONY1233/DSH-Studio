function normalize(value) {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
        return value;
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new TypeError("Canonical JSON cannot contain non-finite numbers");
        }
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(normalize);
    }
    if (typeof value === "object") {
        const record = value;
        return Object.fromEntries(Object.keys(record)
            .sort()
            .filter((key) => record[key] !== undefined)
            .map((key) => [key, normalize(record[key])]));
    }
    throw new TypeError(`Canonical JSON cannot contain ${typeof value}`);
}
export function canonicalJson(value) {
    return JSON.stringify(normalize(value));
}
//# sourceMappingURL=canonical-json.js.map