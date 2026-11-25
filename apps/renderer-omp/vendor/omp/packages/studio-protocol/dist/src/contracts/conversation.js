/**
 * `session.transcript.read` is gated by the existing capability `session.history`.
 * The operation exists in the contract now; Runtime hello must not advertise
 * `session.history` as implemented until the transcript reader is wired
 * (plan 02 Commit B).
 */
export const SESSION_TRANSCRIPT_READ_KIND = "session.transcript.read";
export const SESSION_TRANSCRIPT_READ_CAPABILITY = "session.history";
export const SESSION_TRANSCRIPT_READ_CONCURRENCY = "read-concurrent";
/**
 * Opaque conversation cursor (wire type: `OpaqueCursor` string).
 *
 * Runtime encodes a signed payload in a **separate namespace** from
 * `agent.transcript.read` cursors. The payload binds:
 * - schema version (`CONVERSATION_CURSOR_SCHEMA_VERSION`)
 * - session identity
 * - runtime epoch (generation equivalent)
 * - active branch leaf id
 * - page boundary entry id
 * - direction (`older` only in v1)
 *
 * Must not encode file paths, tokens, or raw branch bytes. Host and Renderer
 * treat the string as opaque and must not parse it.
 *
 * Tampered / malformed / wrong-namespace cursor → `INVALID_ARGUMENT`.
 * Well-formed cursor for a different session, branch leaf, or epoch → `CURSOR_STALE`.
 */
export const CONVERSATION_CURSOR_SCHEMA_VERSION = 1;
export const CONVERSATION_CURSOR_DIRECTION = "older";
export const CONVERSATION_CURSOR_NAMESPACE = "session.transcript.v1";
/**
 * Frozen size and safety limits. Projectors and tests must import these
 * rather than scattering magic numbers. Truncation of oversized native
 * content is a Runtime sanitizer concern (Commit B) and must set
 * `truncated: true`. The trust-boundary parsers below **reject** over-limit
 * public payloads so a buggy projector cannot pass a frame that exceeds the
 * Bridge budget.
 */
export const CONVERSATION_LIMITS = {
    TRANSCRIPT_LIMIT_MIN: 1,
    TRANSCRIPT_LIMIT_MAX: 100,
    TRANSCRIPT_LIMIT_DEFAULT: 50,
    TEXT_BLOCK_MAX_BYTES: 256 * 1024,
    JSON_VALUE_MAX_BYTES: 256 * 1024,
    JSON_VALUE_MAX_DEPTH: 12,
    /** Must remain below `DEFAULT_MAX_CONTROL_FRAME_BYTES` (1 MiB). */
    PAGE_MAX_BYTES: 768 * 1024,
    CURSOR_MAX_CHARS: 1024,
    ITEM_ID_MAX_CHARS: 256,
    TOOL_NAME_MAX_CHARS: 256,
    NOTICE_MESSAGE_MAX_CHARS: 16 * 1024,
    DELTA_MAX_BYTES: 32 * 1024,
    COMPACTION_SUMMARY_MAX_BYTES: 256 * 1024,
    LIVE_REPLAY_MAX_EVENTS: 512,
    LIVE_REPLAY_MAX_BYTES: 2 * 1024 * 1024,
};
/**
 * First-version `branch_summary` handling: skip the entry. Do not map it to
 * `compaction`. A later contract revision may introduce a dedicated public
 * kind; until then Host/Renderer must not invent one.
 */
export const CONVERSATION_BRANCH_SUMMARY_MAPPING = "ignore";
export const CONVERSATION_PUBLIC_ITEM_KINDS = ["message", "compaction", "resetBoundary"];
export const CONVERSATION_IGNORED_SESSION_ENTRY_TYPES = [
    "branch_summary",
    "custom",
    "label",
    "model_change",
    "service_tier_change",
];
/**
 * Frozen: a pure `conversation.message.delta` must increment `eventSeq` but
 * must **not** increment envelope `stateVersion`. `stateVersion` advances when
 * persisted conversation authority changes (message/tool/turn/compaction
 * completed or aborted) or operator snapshot fields change.
 */
export const CONVERSATION_MESSAGE_DELTA_INCREMENTS_STATE_VERSION = false;
/**
 * Secret-shaped key names. The Runtime sanitizer replaces matching keys
 * before a public item is emitted, except usage-count keys that only share
 * the substring `token` — see `conversationRedactKey`. Public parsers still
 * reject unknown item/block fields via exact-key checks.
 */
export const CONVERSATION_REDACT_KEY_PATTERN = /token|secret|password|api[_-]?key|authorization|cookie|providerpayload/iu;
/** Usage totals that contain `token` but are not credentials. */
const CONVERSATION_USAGE_TOKEN_KEYS = /^(tokens|tokensBefore|contextTokens|inputTokens|outputTokens|totalTokens|tokenUsage|tokensPerSecond)$/iu;
/** Whether a JSON key must be replaced with `[redacted]` on the public conversation surface. */
export function conversationRedactKey(key) {
    if (CONVERSATION_USAGE_TOKEN_KEYS.test(key))
        return false;
    return CONVERSATION_REDACT_KEY_PATTERN.test(key);
}
//# sourceMappingURL=conversation.js.map