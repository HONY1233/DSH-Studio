const TERMINAL = {
    completed: true,
    failed: true,
    rejected: true,
    outcome_unknown: true,
};
export function isComposerTerminal(status) {
    return status in TERMINAL;
}
/**
 * Composer-facing view of one requestId. `accepted` is never treated as
 * completed. Terminal failed/rejected/outcome_unknown keep the Host reason.
 * The reducer already refuses a second terminal; this selector reads that
 * single terminal fact.
 */
export function selectComposerReceipt(commands, requestId) {
    const entry = commands[requestId];
    if (entry === undefined)
        return { phase: "unknown" };
    switch (entry.status) {
        case "local_pending":
            return { phase: "pending" };
        case "accepted":
            return { phase: "accepted", acceptedAt: entry.acceptedAt };
        case "interaction_required":
            return { phase: "interaction_required" };
        case "completed":
            return { phase: "completed", observedAt: entry.observedAt };
        case "failed":
            return { phase: "failed", error: entry.error, observedAt: entry.observedAt };
        case "rejected":
            return { phase: "rejected", reason: entry.reason, observedAt: entry.observedAt };
        case "outcome_unknown":
            return { phase: "outcome_unknown", reason: entry.reason, observedAt: entry.observedAt };
        default: {
            const _exhaustive = entry;
            return { phase: "unknown" };
        }
    }
}
export function selectComposerTerminal(commands, requestId) {
    const entry = commands[requestId];
    if (entry === undefined || !isComposerTerminal(entry.status))
        return undefined;
    return entry;
}
//# sourceMappingURL=receipt-selectors.js.map