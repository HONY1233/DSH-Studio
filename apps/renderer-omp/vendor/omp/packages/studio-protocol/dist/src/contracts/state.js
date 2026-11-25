/**
 * Session thinking selectors the Runtime accepts and reports. `auto` is a
 * session-only mode (per-turn classification) and is never a `provider/model`
 * suffix; `inherit` is excluded because it resolves back to the provider
 * default instead of expressing an operator selection.
 */
export const SESSION_THINKING_LEVELS = [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
];
export const SESSION_THINKING_SELECTORS = [...SESSION_THINKING_LEVELS, "auto"];
//# sourceMappingURL=state.js.map