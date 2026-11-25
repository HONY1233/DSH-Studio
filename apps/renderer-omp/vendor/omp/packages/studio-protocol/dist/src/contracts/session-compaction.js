export const SESSION_COMPACTION_ENTRY = "studio.compaction-threshold";
/** Bare values below 100 are percentages; a unit always means tokens. Empty restores inheritance. */
export function parseSessionCompactionInput(input) {
    const text = input.trim();
    if (!text)
        return null;
    const match = /^(\d+(?:\.\d+)?|\.\d+)\s*(%|k|m)?$/i.exec(text);
    if (!match)
        throw new Error("Use a percentage or token count, e.g. 80%, 150k or 0.5m");
    const value = Number(match[1]);
    const unit = match[2]?.toLowerCase();
    if (unit === "%" || (!unit && value < 100)) {
        if (value <= 0 || value >= 100)
            throw new Error("Choose a percentage greater than 0 and below 100");
        return { kind: "percent", value };
    }
    const tokens = unit ? Number(`${match[1]}e${unit === "k" ? 3 : 6}`) : value;
    if (!Number.isSafeInteger(tokens) || tokens <= 0)
        throw new Error("Choose a positive whole token count");
    return { kind: "tokens", value: tokens };
}
export function formatSessionCompactionInput(threshold) {
    if (!threshold)
        return "";
    if (threshold.kind === "percent")
        return `${threshold.value}%`;
    const value = threshold.value;
    if (value < 100)
        return `${value / 1_000}k`;
    return value >= 1_000_000 && value % 1_000 === 0 ? `${value / 1_000_000}m`
        : value >= 1_000 && value % 100 === 0 ? `${value / 1_000}k` : String(value);
}
/** Read the last conversation-wide override, including after rewind. Forks do not inherit it. */
export function readSessionCompactionThreshold(sessionId, entries) {
    for (let index = entries.length - 1; index >= 0; index--) {
        const entry = entries[index];
        if (entry.type !== "custom" || entry.customType !== SESSION_COMPACTION_ENTRY)
            continue;
        const data = entry.data;
        if (data?.sessionId === sessionId && typeof data.input === "string")
            return parseSessionCompactionInput(data.input);
    }
    return null;
}
//# sourceMappingURL=session-compaction.js.map