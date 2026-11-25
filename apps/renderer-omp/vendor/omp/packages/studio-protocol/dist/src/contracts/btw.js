/**
 * BTW (`/btw`) side-channel contract.
 *
 * A BTW request is one ephemeral turn against the live session's model,
 * system prompt and history. It never enters the transcript, never calls
 * tools, and persists its own history without changing the main transcript. The Runtime owns a
 * single slot: asking again while one is running is rejected.
 *
 * The branch authorization token is deliberately absent — it
 * travels only on the `btw.ask` receipt, so a late `btw.changed` observer
 * cannot promote someone else's answer into a new session.
 */
export const BTW_STATUSES = ["running", "completed", "failed", "aborted"];
export const BTW_ERROR_CODES = ["INTERNAL_ERROR", "OUTPUT_LIMIT"];
/**
 * Legacy size hint retained for API consumers. Native BTW answers are no longer
 * capped by this value; the enclosing transport frame supplies its own limit.
 */
export const BTW_TEXT_MAX_CHARS = 1024 * 1024;
/** Bound on the opaque ephemeral id so a malformed frame cannot grow the state. */
export const BTW_ID_MAX_CHARS = 128;
export const BTW_ERROR_MESSAGE_MAX_CHARS = 512;
//# sourceMappingURL=btw.js.map