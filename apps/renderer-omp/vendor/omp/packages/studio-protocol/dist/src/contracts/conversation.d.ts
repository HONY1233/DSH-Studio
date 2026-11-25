import type { AgentId, OpaqueCursor, RuntimeEpoch, SessionId } from "./ids.js";
/**
 * Strict JSON value. Classes, functions, symbols, `undefined`, `NaN`,
 * `Infinity`, cyclic graphs, and objects with a non-null/non-Object prototype
 * are not representable and must be rejected at the trust boundary.
 */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | {
    readonly [key: string]: JsonValue;
};
export type ConversationRole = "user" | "assistant" | "system" | "extension" | "advisor";
export type ConversationContentBlock = {
    type: "text";
    text: string;
    truncated?: boolean;
    advisor?: string;
    severity?: "nit" | "concern" | "blocker";
} | {
    type: "thinking";
    text: string;
    truncated?: boolean;
} | {
    type: "toolCall";
    presentation?: "reply";
    toolCallId: string;
    toolName: string;
    arguments?: JsonValue;
    truncated?: boolean;
} | {
    type: "toolResult";
    toolCallId: string;
    toolName?: string;
    output?: string;
    data?: JsonValue;
    isError: boolean;
    truncated?: boolean;
};
export type ConversationMessageItem = {
    kind: "message";
    itemId: string;
    parentId: string | null;
    createdAt: string;
    role: ConversationRole;
    content: readonly ConversationContentBlock[];
    excludeFromContext?: boolean;
    asyncNotify?: boolean;
};
export type ConversationCompactionItem = {
    kind: "compaction";
    itemId: string;
    parentId: string | null;
    createdAt: string;
    summary: string;
    shortSummary?: string;
    warning?: string;
};
export type ConversationResetBoundaryItem = {
    kind: "resetBoundary";
    itemId: string;
    parentId: string | null;
    createdAt: string;
};
/**
 * Why an assistant turn produced nothing, carried on the live completion event
 * only. `provider`/`model` matter as much as the text: a gateway that advertises
 * a model through discovery but refuses to serve it is only diagnosable from the
 * pair that was actually requested.
 */
export type ConversationMessageError = {
    message: string;
    /** Provider HTTP status when the failure came from a request. */
    status?: number;
    provider?: string;
    model?: string;
};
/**
 * Persistent public transcript items. These are the only kinds Host/Renderer
 * may render from `session.transcript.read`.
 *
 * First-version mapping of OMP session entries (Commit B reader):
 * - `message` → `message`
 * - `compaction` → `compaction` (summary/shortSummary/warning only; never
 *   `preserveData`, `details`, or provider payloads)
 * - `reset_boundary` → `resetBoundary`
 * - `branch_summary` → **ignored** (`CONVERSATION_BRANCH_SUMMARY_MAPPING`)
 * - displayed advisor `custom_message` → `advisor` message, with one text block per note
 * - other displayed extension messages → `extension` message
 * - native harness traffic and dedicated job records → ignored
 * - `custom` and other entry types → ignored
 *
 * Absolute session file paths, `providerPayload`, secrets, and unfiltered
 * custom data must never appear on this type.
 */
export type ConversationItem = ConversationMessageItem | ConversationCompactionItem | ConversationResetBoundaryItem;
/**
 * Page of the current active branch, oldest-to-newest.
 *
 * - Omit `cursor` on the operation to read the latest page.
 * - `olderCursor` is the only cursor used to read an older page.
 * - `headCursor` is always present, including on an empty branch, so gap
 *   detection and reload share one cursor namespace.
 * - Sibling entries from other branches must not appear in `items`.
 */
export interface ConversationTranscriptPage {
    runtimeEpoch: RuntimeEpoch;
    sessionId: SessionId;
    branchLeafId: string | null;
    items: readonly ConversationItem[];
    olderCursor?: OpaqueCursor;
    headCursor: OpaqueCursor;
    hasMoreBefore: boolean;
}
/** A live conversation surface selected by the product client. */
export type ConversationTarget = {
    readonly kind: "session";
    readonly sessionId: SessionId;
} | {
    readonly kind: "agent";
    readonly parentSessionId: SessionId;
    readonly agentId: AgentId;
};
/**
 * Resolved target identity returned by `conversation.open`.
 *
 * Child Runtime events carry their own session id but the legacy Runtime
 * projector does not carry the Agent Hub id. Returning both identities makes
 * the association explicit and lets a subscribe-before-open client reconcile
 * already-buffered child events without guessing from text or ordering.
 */
export type ConversationResolvedTarget = {
    readonly kind: "session";
    readonly sessionId: SessionId;
    readonly conversationSessionId: SessionId;
} | {
    readonly kind: "agent";
    readonly parentSessionId: SessionId;
    readonly agentId: AgentId;
    readonly conversationSessionId: SessionId;
};
export interface ConversationStreamEvent {
    /** Monotonic only within `target.conversationSessionId` and this Runtime epoch. */
    readonly streamSeq: number;
    /** Original Runtime Bridge sequence; it is global and may be sparse per target. */
    readonly eventSeq: number;
    readonly stateVersion: number;
    readonly occurredAt: string;
    readonly update: ConversationRuntimeEvent;
}
export type ConversationLiveReplay = {
    readonly status: "complete";
    /** All buffered live events at or below this target-level sequence are represented. */
    readonly watermark: number;
    readonly events: readonly ConversationStreamEvent[];
} | {
    readonly status: "resyncRequired";
    readonly watermark: number;
    readonly events: readonly [];
    readonly reason: string;
};
export interface ConversationOpenResult {
    readonly target: ConversationResolvedTarget;
    readonly page: ConversationTranscriptPage;
    /** Bounded recovery state captured atomically after `page` was read. */
    readonly live: ConversationLiveReplay;
}
/**
 * `session.transcript.read` is gated by the existing capability `session.history`.
 * The operation exists in the contract now; Runtime hello must not advertise
 * `session.history` as implemented until the transcript reader is wired
 * (plan 02 Commit B).
 */
export declare const SESSION_TRANSCRIPT_READ_KIND: "session.transcript.read";
export declare const SESSION_TRANSCRIPT_READ_CAPABILITY: "session.history";
export declare const SESSION_TRANSCRIPT_READ_CONCURRENCY: "read-concurrent";
export type SessionTranscriptRead = {
    kind: typeof SESSION_TRANSCRIPT_READ_KIND;
    cursor?: OpaqueCursor;
    limit?: number;
};
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
export declare const CONVERSATION_CURSOR_SCHEMA_VERSION: 1;
export declare const CONVERSATION_CURSOR_DIRECTION: "older";
export declare const CONVERSATION_CURSOR_NAMESPACE: "session.transcript.v1";
/**
 * Frozen size and safety limits. Projectors and tests must import these
 * rather than scattering magic numbers. Truncation of oversized native
 * content is a Runtime sanitizer concern (Commit B) and must set
 * `truncated: true`. The trust-boundary parsers below **reject** over-limit
 * public payloads so a buggy projector cannot pass a frame that exceeds the
 * Bridge budget.
 */
export declare const CONVERSATION_LIMITS: {
    readonly TRANSCRIPT_LIMIT_MIN: 1;
    readonly TRANSCRIPT_LIMIT_MAX: 100;
    readonly TRANSCRIPT_LIMIT_DEFAULT: 50;
    readonly TEXT_BLOCK_MAX_BYTES: number;
    readonly JSON_VALUE_MAX_BYTES: number;
    readonly JSON_VALUE_MAX_DEPTH: 12;
    /** Must remain below `DEFAULT_MAX_CONTROL_FRAME_BYTES` (1 MiB). */
    readonly PAGE_MAX_BYTES: number;
    readonly CURSOR_MAX_CHARS: 1024;
    readonly ITEM_ID_MAX_CHARS: 256;
    readonly TOOL_NAME_MAX_CHARS: 256;
    readonly NOTICE_MESSAGE_MAX_CHARS: number;
    readonly DELTA_MAX_BYTES: number;
    readonly COMPACTION_SUMMARY_MAX_BYTES: number;
    readonly LIVE_REPLAY_MAX_EVENTS: 512;
    readonly LIVE_REPLAY_MAX_BYTES: number;
};
/**
 * First-version `branch_summary` handling: skip the entry. Do not map it to
 * `compaction`. A later contract revision may introduce a dedicated public
 * kind; until then Host/Renderer must not invent one.
 */
export declare const CONVERSATION_BRANCH_SUMMARY_MAPPING: "ignore";
export declare const CONVERSATION_PUBLIC_ITEM_KINDS: readonly ["message", "compaction", "resetBoundary"];
export declare const CONVERSATION_IGNORED_SESSION_ENTRY_TYPES: readonly ["branch_summary", "custom", "label", "model_change", "service_tier_change"];
/**
 * Frozen: a pure `conversation.message.delta` must increment `eventSeq` but
 * must **not** increment envelope `stateVersion`. `stateVersion` advances when
 * persisted conversation authority changes (message/tool/turn/compaction
 * completed or aborted) or operator snapshot fields change.
 */
export declare const CONVERSATION_MESSAGE_DELTA_INCREMENTS_STATE_VERSION: false;
/**
 * Secret-shaped key names. The Runtime sanitizer replaces matching keys
 * before a public item is emitted, except usage-count keys that only share
 * the substring `token` — see `conversationRedactKey`. Public parsers still
 * reject unknown item/block fields via exact-key checks.
 */
export declare const CONVERSATION_REDACT_KEY_PATTERN: RegExp;
/** Whether a JSON key must be replaced with `[redacted]` on the public conversation surface. */
export declare function conversationRedactKey(key: string): boolean;
/**
 * Live conversation events. Time source freeze:
 *
 * - `StudioEventEnvelope.occurredAt` is the **only** event-emission timestamp.
 *   Inner payloads must not include `occurredAt`.
 * - `createdAt` / `startedAt` / `completedAt` on inner payloads are domain
 *   timestamps of the message or tool call, not emission time.
 * - Envelope also carries `runtimeEpoch`, `eventSeq`, and `stateVersion`.
 *   Inner payloads must not repeat those fields.
 *
 * Identity freeze:
 *
 * - `messageId` is the persistent SessionEntry id. Runtime must know this id
 *   before emitting `conversation.message.started`.
 * - `conversation.message.completed.item.itemId` **must equal** `messageId`.
 * - There is no `replacesLiveId`. Downstream must not correlate by text.
 */
/** MCP `notifications/progress`: `progress` of an optional `total`, with an optional phase message. */
export interface ConversationToolProgress {
    progress: number;
    total?: number;
    message?: string;
}
export type ConversationRuntimeEvent = {
    kind: "conversation.message.started";
    sessionId: SessionId;
    turnId: string;
    messageId: string;
    role: ConversationRole;
    createdAt: string;
} | {
    kind: "conversation.message.delta";
    sessionId: SessionId;
    turnId: string;
    messageId: string;
    blockId: string;
    blockType: "text" | "thinking";
    delta: string;
} | {
    kind: "conversation.message.completed";
    sessionId: SessionId;
    turnId: string;
    messageId: string;
    item: ConversationMessageItem;
    /**
     * Present when the assistant message ended with a provider error. The
     * persisted item has no error field; the client latches the last live
     * payload until that session's next assistant message starts streaming,
     * or a later one completes without an error.
     */
    error?: ConversationMessageError;
} | {
    kind: "conversation.tool.started";
    presentation?: "reply";
    sessionId: SessionId;
    turnId: string;
    messageId: string;
    toolCallId: string;
    toolName: string;
    arguments?: JsonValue;
    startedAt: string;
} | {
    kind: "conversation.tool.updated";
    presentation?: "reply";
    replies?: readonly string[];
    sessionId: SessionId;
    turnId: string;
    toolCallId: string;
    updateMode: "append" | "replace";
    output?: string;
    truncated?: boolean;
    /** Latest MCP progress notification of the call. */
    progress?: ConversationToolProgress;
} | {
    kind: "conversation.tool.completed";
    sessionId: SessionId;
    turnId: string;
    toolCallId: string;
    result: Extract<ConversationContentBlock, {
        type: "toolResult";
    }>;
    completedAt: string;
} | {
    kind: "conversation.turn.completed";
    sessionId: SessionId;
    turnId: string;
} | {
    kind: "conversation.turn.aborted";
    sessionId: SessionId;
    turnId: string;
} | {
    kind: "conversation.compaction.started";
    sessionId: SessionId;
    action: string;
} | {
    kind: "conversation.compaction.completed";
    sessionId: SessionId;
    item?: ConversationCompactionItem;
    aborted: boolean;
} | {
    kind: "conversation.notice";
    sessionId: SessionId;
    level: "info" | "warning" | "error";
    message: string;
    source?: string;
};
//# sourceMappingURL=conversation.d.ts.map