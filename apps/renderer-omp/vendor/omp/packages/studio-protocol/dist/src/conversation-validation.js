import { ContractValidationError } from "./contract-error.js";
import { CONVERSATION_LIMITS, } from "./contracts/conversation.js";
import { utf8ByteLength } from "./conversation-text.js";
/** Shares the module-scope encoder: a per-call `new TextEncoder()` shows up on the streaming validation path. */
const utf8Bytes = (text) => utf8ByteLength(text);
function record(value, path) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new ContractValidationError("expected an object", path);
    }
    return value;
}
function exactKeys(value, allowed, path) {
    const allowedSet = new Set(allowed);
    const unknown = Object.keys(value).find((key) => !allowedSet.has(key));
    if (unknown !== undefined) {
        throw new ContractValidationError(`unknown field ${JSON.stringify(unknown)}`, path);
    }
}
function nonEmptyString(value, path) {
    if (typeof value !== "string" || value.length === 0) {
        throw new ContractValidationError("expected a non-empty string", path);
    }
    return value;
}
function booleanValue(value, path) {
    if (typeof value !== "boolean")
        throw new ContractValidationError("expected a boolean", path);
    return value;
}
function optionalBoolean(value, path) {
    if (value === undefined)
        return undefined;
    return booleanValue(value, path);
}
function boundedId(value, path) {
    const id = nonEmptyString(value, path);
    if (id.length > CONVERSATION_LIMITS.ITEM_ID_MAX_CHARS) {
        throw new ContractValidationError(`id must be at most ${CONVERSATION_LIMITS.ITEM_ID_MAX_CHARS} characters`, path);
    }
    return id;
}
function boundedUtf8(value, path, maxBytes) {
    if (typeof value !== "string")
        throw new ContractValidationError("expected a string", path);
    if (value.length * 3 > maxBytes && utf8Bytes(value) > maxBytes) {
        throw new ContractValidationError(`exceeds ${maxBytes} UTF-8 bytes`, path);
    }
    return value;
}
function parseMessageError(value, path) {
    const input = record(value, path);
    exactKeys(input, ["message", "status", "provider", "model"], path);
    const message = boundedUtf8(input.message, `${path}.message`, CONVERSATION_LIMITS.NOTICE_MESSAGE_MAX_CHARS);
    if (message.length === 0)
        throw new ContractValidationError("expected a non-empty string", `${path}.message`);
    const error = { message };
    if (input.status !== undefined) {
        if (!Number.isSafeInteger(input.status)) {
            throw new ContractValidationError("expected a safe integer", `${path}.status`);
        }
        error.status = input.status;
    }
    if (input.provider !== undefined)
        error.provider = boundedId(input.provider, `${path}.provider`);
    if (input.model !== undefined)
        error.model = boundedId(input.model, `${path}.model`);
    return error;
}
function positiveInteger(value, path) {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new ContractValidationError("expected a positive safe integer", path);
    }
    return value;
}
function nonNegativeInteger(value, path) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new ContractValidationError("expected a non-negative safe integer", path);
    }
    return value;
}
function jsonValueLimited(value, path, depth, seen) {
    if (depth > CONVERSATION_LIMITS.JSON_VALUE_MAX_DEPTH) {
        throw new ContractValidationError(`JSON depth exceeds ${CONVERSATION_LIMITS.JSON_VALUE_MAX_DEPTH}`, path);
    }
    if (value === null)
        return null;
    switch (typeof value) {
        case "boolean":
        case "string":
            return value;
        case "number":
            if (Number.isFinite(value))
                return value;
            throw new ContractValidationError("expected a finite JSON number", path);
        case "object": {
            if (seen.has(value)) {
                throw new ContractValidationError("cyclic value is not JSON-safe", path);
            }
            seen.add(value);
            try {
                if (Array.isArray(value)) {
                    return value.map((item, index) => jsonValueLimited(item, `${path}[${index}]`, depth + 1, seen));
                }
                const prototype = Object.getPrototypeOf(value);
                if (prototype !== Object.prototype && prototype !== null) {
                    throw new ContractValidationError("expected a plain object", path);
                }
                const result = {};
                for (const [key, item] of Object.entries(value)) {
                    result[key] = jsonValueLimited(item, `${path}.${key}`, depth + 1, seen);
                }
                return result;
            }
            finally {
                seen.delete(value);
            }
        }
        default:
            throw new ContractValidationError("expected a JSON-safe value", path);
    }
}
function parseJsonValue(value, path) {
    const parsed = jsonValueLimited(value, path, 1, new Set());
    const encoded = JSON.stringify(parsed);
    if (utf8Bytes(encoded) > CONVERSATION_LIMITS.JSON_VALUE_MAX_BYTES) {
        throw new ContractValidationError(`JSON value exceeds ${CONVERSATION_LIMITS.JSON_VALUE_MAX_BYTES} UTF-8 bytes`, path);
    }
    return parsed;
}
function parseTruncated(value, path) {
    return optionalBoolean(value, path);
}
export function parseOpaqueConversationCursor(value, path) {
    const cursor = nonEmptyString(value, path);
    if (cursor.length > CONVERSATION_LIMITS.CURSOR_MAX_CHARS) {
        throw new ContractValidationError(`cursor must be at most ${CONVERSATION_LIMITS.CURSOR_MAX_CHARS} characters`, path);
    }
    return cursor;
}
function parseRole(value, path) {
    if (value !== "user" && value !== "assistant" && value !== "system" && value !== "extension" && value !== "advisor") {
        throw new ContractValidationError("unsupported conversation role", path);
    }
    return value;
}
export function parseConversationContentBlock(value, path) {
    const input = record(value, path);
    const type = nonEmptyString(input.type, `${path}.type`);
    if (type === "text" || type === "thinking") {
        exactKeys(input, type === "text" ? ["type", "text", "truncated", "advisor", "severity"] : ["type", "text", "truncated"], path);
        const text = boundedUtf8(input.text, `${path}.text`, CONVERSATION_LIMITS.TEXT_BLOCK_MAX_BYTES);
        const truncated = parseTruncated(input.truncated, `${path}.truncated`);
        const block = { type, text };
        if (truncated !== undefined)
            block.truncated = truncated;
        if (block.type === "text") {
            if (typeof input.advisor === "string")
                block.advisor = input.advisor;
            if (input.severity === "nit" || input.severity === "concern" || input.severity === "blocker")
                block.severity = input.severity;
        }
        return block;
    }
    if (type === "toolCall") {
        exactKeys(input, ["type", "toolCallId", "toolName", "arguments", "truncated", "presentation"], path);
        const toolCallId = boundedId(input.toolCallId, `${path}.toolCallId`);
        const toolName = boundedUtf8(input.toolName, `${path}.toolName`, CONVERSATION_LIMITS.TOOL_NAME_MAX_CHARS);
        if (toolName.length === 0) {
            throw new ContractValidationError("expected a non-empty string", `${path}.toolName`);
        }
        const truncated = parseTruncated(input.truncated, `${path}.truncated`);
        const block = {
            type: "toolCall",
            toolCallId,
            toolName,
        };
        if ("arguments" in input)
            block.arguments = parseJsonValue(input.arguments, `${path}.arguments`);
        if (input.presentation === "reply")
            block.presentation = "reply";
        if (truncated !== undefined)
            block.truncated = truncated;
        return block;
    }
    if (type === "toolResult") {
        exactKeys(input, ["type", "toolCallId", "toolName", "output", "data", "isError", "truncated"], path);
        const toolCallId = boundedId(input.toolCallId, `${path}.toolCallId`);
        const isError = booleanValue(input.isError, `${path}.isError`);
        const truncated = parseTruncated(input.truncated, `${path}.truncated`);
        const block = {
            type: "toolResult",
            toolCallId,
            isError,
        };
        if (input.toolName !== undefined) {
            const toolName = boundedUtf8(input.toolName, `${path}.toolName`, CONVERSATION_LIMITS.TOOL_NAME_MAX_CHARS);
            if (toolName.length === 0) {
                throw new ContractValidationError("expected a non-empty string", `${path}.toolName`);
            }
            block.toolName = toolName;
        }
        if (input.output !== undefined) {
            block.output = boundedUtf8(input.output, `${path}.output`, CONVERSATION_LIMITS.TEXT_BLOCK_MAX_BYTES);
        }
        if ("data" in input)
            block.data = parseJsonValue(input.data, `${path}.data`);
        if (truncated !== undefined)
            block.truncated = truncated;
        return block;
    }
    throw new ContractValidationError("unsupported content block type", `${path}.type`);
}
function parseParentId(value, path) {
    if (value === null)
        return null;
    return boundedId(value, path);
}
export function parseConversationItem(value, path) {
    const input = record(value, path);
    const kind = nonEmptyString(input.kind, `${path}.kind`);
    const itemId = boundedId(input.itemId, `${path}.itemId`);
    const parentId = parseParentId(input.parentId, `${path}.parentId`);
    const createdAt = nonEmptyString(input.createdAt, `${path}.createdAt`);
    if (kind === "message") {
        exactKeys(input, ["kind", "itemId", "parentId", "createdAt", "role", "content", "excludeFromContext", "asyncNotify"], path);
        if (!Array.isArray(input.content)) {
            throw new ContractValidationError("expected an array", `${path}.content`);
        }
        const content = input.content.map((block, index) => parseConversationContentBlock(block, `${path}.content[${index}]`));
        return {
            kind: "message",
            itemId,
            parentId,
            createdAt,
            role: parseRole(input.role, `${path}.role`),
            content,
            ...(input.excludeFromContext === true ? { excludeFromContext: true } : {}),
            ...(input.asyncNotify === true ? { asyncNotify: true } : {}),
        };
    }
    if (kind === "compaction") {
        exactKeys(input, ["kind", "itemId", "parentId", "createdAt", "summary", "shortSummary", "warning"], path);
        const summary = boundedUtf8(input.summary, `${path}.summary`, CONVERSATION_LIMITS.COMPACTION_SUMMARY_MAX_BYTES);
        if (summary.length === 0) {
            throw new ContractValidationError("expected a non-empty string", `${path}.summary`);
        }
        const item = { kind: "compaction", itemId, parentId, createdAt, summary };
        if (input.shortSummary !== undefined) {
            item.shortSummary = boundedUtf8(input.shortSummary, `${path}.shortSummary`, CONVERSATION_LIMITS.COMPACTION_SUMMARY_MAX_BYTES);
        }
        if (input.warning !== undefined) {
            item.warning = boundedUtf8(input.warning, `${path}.warning`, CONVERSATION_LIMITS.COMPACTION_SUMMARY_MAX_BYTES);
        }
        return item;
    }
    if (kind === "resetBoundary") {
        exactKeys(input, ["kind", "itemId", "parentId", "createdAt"], path);
        return { kind: "resetBoundary", itemId, parentId, createdAt };
    }
    throw new ContractValidationError("unsupported conversation item kind", `${path}.kind`);
}
export function parseConversationTranscriptPage(value, path = "$page") {
    const input = record(value, path);
    exactKeys(input, ["runtimeEpoch", "sessionId", "branchLeafId", "items", "olderCursor", "headCursor", "hasMoreBefore"], path);
    const runtimeEpoch = positiveInteger(input.runtimeEpoch, `${path}.runtimeEpoch`);
    const sessionId = nonEmptyString(input.sessionId, `${path}.sessionId`);
    if (input.branchLeafId !== null)
        boundedId(input.branchLeafId, `${path}.branchLeafId`);
    if (!Array.isArray(input.items)) {
        throw new ContractValidationError("expected an array", `${path}.items`);
    }
    if (input.items.length > CONVERSATION_LIMITS.TRANSCRIPT_LIMIT_MAX) {
        throw new ContractValidationError(`items must contain at most ${CONVERSATION_LIMITS.TRANSCRIPT_LIMIT_MAX} entries`, `${path}.items`);
    }
    const items = input.items.map((item, index) => parseConversationItem(item, `${path}.items[${index}]`));
    const headCursor = parseOpaqueConversationCursor(input.headCursor, `${path}.headCursor`);
    const hasMoreBefore = booleanValue(input.hasMoreBefore, `${path}.hasMoreBefore`);
    const encoded = JSON.stringify(input);
    if (utf8Bytes(encoded) > CONVERSATION_LIMITS.PAGE_MAX_BYTES) {
        throw new ContractValidationError(`transcript page exceeds ${CONVERSATION_LIMITS.PAGE_MAX_BYTES} UTF-8 bytes`, path);
    }
    const page = {
        runtimeEpoch: runtimeEpoch,
        sessionId: sessionId,
        branchLeafId: input.branchLeafId,
        items,
        headCursor,
        hasMoreBefore,
    };
    if (input.olderCursor !== undefined) {
        page.olderCursor = parseOpaqueConversationCursor(input.olderCursor, `${path}.olderCursor`);
    }
    return page;
}
function parseConversationResolvedTarget(value, path) {
    const input = record(value, path);
    const kind = nonEmptyString(input.kind, `${path}.kind`);
    if (kind === "session") {
        exactKeys(input, ["kind", "sessionId", "conversationSessionId"], path);
        const sessionId = boundedId(input.sessionId, `${path}.sessionId`);
        const conversationSessionId = boundedId(input.conversationSessionId, `${path}.conversationSessionId`);
        if (conversationSessionId !== sessionId) {
            throw new ContractValidationError("conversationSessionId must equal sessionId", `${path}.conversationSessionId`);
        }
        return {
            kind,
            sessionId: sessionId,
            conversationSessionId: conversationSessionId,
        };
    }
    if (kind === "agent") {
        exactKeys(input, ["kind", "parentSessionId", "agentId", "conversationSessionId"], path);
        return {
            kind,
            parentSessionId: boundedId(input.parentSessionId, `${path}.parentSessionId`),
            agentId: boundedId(input.agentId, `${path}.agentId`),
            conversationSessionId: boundedId(input.conversationSessionId, `${path}.conversationSessionId`),
        };
    }
    throw new ContractValidationError("unsupported conversation target kind", `${path}.kind`);
}
function parseConversationStreamEvent(value, path) {
    const input = record(value, path);
    exactKeys(input, ["streamSeq", "eventSeq", "stateVersion", "occurredAt", "update"], path);
    return {
        streamSeq: positiveInteger(input.streamSeq, `${path}.streamSeq`),
        eventSeq: positiveInteger(input.eventSeq, `${path}.eventSeq`),
        stateVersion: nonNegativeInteger(input.stateVersion, `${path}.stateVersion`),
        occurredAt: nonEmptyString(input.occurredAt, `${path}.occurredAt`),
        update: parseConversationRuntimeEvent(input.update, `${path}.update`),
    };
}
export function parseConversationOpenResult(value, path = "$result") {
    const input = record(value, path);
    exactKeys(input, ["target", "page", "live"], path);
    const target = parseConversationResolvedTarget(input.target, `${path}.target`);
    const page = parseConversationTranscriptPage(input.page, `${path}.page`);
    if (page.sessionId !== target.conversationSessionId) {
        throw new ContractValidationError("page session does not match resolved target", `${path}.page.sessionId`);
    }
    const liveInput = record(input.live, `${path}.live`);
    const status = nonEmptyString(liveInput.status, `${path}.live.status`);
    const watermark = nonNegativeInteger(liveInput.watermark, `${path}.live.watermark`);
    if (!Array.isArray(liveInput.events)) {
        throw new ContractValidationError("expected an array", `${path}.live.events`);
    }
    if (status === "complete") {
        exactKeys(liveInput, ["status", "watermark", "events"], `${path}.live`);
        const events = liveInput.events.map((event, index) => parseConversationStreamEvent(event, `${path}.live.events[${index}]`));
        if (events.length > CONVERSATION_LIMITS.LIVE_REPLAY_MAX_EVENTS) {
            throw new ContractValidationError(`live replay must contain at most ${CONVERSATION_LIMITS.LIVE_REPLAY_MAX_EVENTS} events`, `${path}.live.events`);
        }
        if (utf8Bytes(JSON.stringify(liveInput)) > CONVERSATION_LIMITS.LIVE_REPLAY_MAX_BYTES) {
            throw new ContractValidationError(`live replay exceeds ${CONVERSATION_LIMITS.LIVE_REPLAY_MAX_BYTES} UTF-8 bytes`, `${path}.live`);
        }
        let previous = 0;
        for (const event of events) {
            if (event.streamSeq <= previous || event.streamSeq > watermark) {
                throw new ContractValidationError("stream sequences must increase and not exceed watermark", `${path}.live.events`);
            }
            if (event.update.sessionId !== target.conversationSessionId) {
                throw new ContractValidationError("live event session does not match resolved target", `${path}.live.events`);
            }
            previous = event.streamSeq;
        }
        return { target, page, live: { status, watermark, events } };
    }
    if (status === "resyncRequired") {
        exactKeys(liveInput, ["status", "watermark", "events", "reason"], `${path}.live`);
        if (liveInput.events.length !== 0) {
            throw new ContractValidationError("resyncRequired replay must not contain partial events", `${path}.live.events`);
        }
        return {
            target,
            page,
            live: {
                status,
                watermark,
                events: [],
                reason: nonEmptyString(liveInput.reason, `${path}.live.reason`),
            },
        };
    }
    throw new ContractValidationError("unsupported live replay status", `${path}.live.status`);
}
export function parseSessionTranscriptReadLimit(value, path) {
    const limit = positiveInteger(value, path);
    if (limit < CONVERSATION_LIMITS.TRANSCRIPT_LIMIT_MIN || limit > CONVERSATION_LIMITS.TRANSCRIPT_LIMIT_MAX) {
        throw new ContractValidationError(`limit must be between ${CONVERSATION_LIMITS.TRANSCRIPT_LIMIT_MIN} and ${CONVERSATION_LIMITS.TRANSCRIPT_LIMIT_MAX}`, path);
    }
    return limit;
}
function parseMessageItem(value, path) {
    const item = parseConversationItem(value, path);
    if (item.kind !== "message") {
        throw new ContractValidationError("expected a message item", path);
    }
    return item;
}
function parseCompactionItem(value, path) {
    const item = parseConversationItem(value, path);
    if (item.kind !== "compaction") {
        throw new ContractValidationError("expected a compaction item", path);
    }
    return item;
}
function parseToolResultBlock(value, path) {
    const block = parseConversationContentBlock(value, path);
    if (block.type !== "toolResult") {
        throw new ContractValidationError("expected a toolResult block", path);
    }
    return block;
}
export function isConversationRuntimeEventKind(kind) {
    return typeof kind === "string" && kind.startsWith("conversation.");
}
/**
 * Parsed events this module produced itself. One Runtime event is validated
 * three times on the way out (Host fan-out, facade, IPC outbound check); the
 * second and third calls receive the exact object the first call returned, so
 * they can skip the walk. Membership is by identity only — a caller's own
 * object, a frozen look-alike, or a structured clone is never in here — and
 * the set is weak, so it retains nothing the caller has let go of.
 */
const parsedEvents = new WeakSet();
/** Recursively freeze a value the parser built. Never applied to caller input. */
function deepFreeze(value) {
    if (value === null || typeof value !== "object" || Object.isFrozen(value))
        return value;
    Object.freeze(value);
    for (const item of Object.values(value))
        deepFreeze(item);
    return value;
}
/** True when `value` is an object this parser returned; exposed for tests and counters only. */
export function isParsedConversationRuntimeEvent(value) {
    return typeof value === "object" && value !== null && parsedEvents.has(value);
}
const PARSER_REUSE_ENABLED = typeof process === "undefined" || process.env.OMP_CONVERSATION_PARSER_REUSE !== "0";
export function parseConversationRuntimeEvent(value, path = "$event.event", reuse = PARSER_REUSE_ENABLED) {
    if (reuse && typeof value === "object" && value !== null && parsedEvents.has(value)) {
        return value;
    }
    const parsed = deepFreeze(parseConversationRuntimeEventFully(value, path));
    parsedEvents.add(parsed);
    return parsed;
}
function parseConversationRuntimeEventFully(value, path) {
    const input = record(value, path);
    const kind = nonEmptyString(input.kind, `${path}.kind`);
    const sessionId = nonEmptyString(input.sessionId, `${path}.sessionId`);
    switch (kind) {
        case "conversation.message.started": {
            exactKeys(input, ["kind", "sessionId", "turnId", "messageId", "role", "createdAt"], path);
            return {
                kind,
                sessionId: sessionId,
                turnId: boundedId(input.turnId, `${path}.turnId`),
                messageId: boundedId(input.messageId, `${path}.messageId`),
                role: parseRole(input.role, `${path}.role`),
                createdAt: nonEmptyString(input.createdAt, `${path}.createdAt`),
            };
        }
        case "conversation.message.delta": {
            exactKeys(input, ["kind", "sessionId", "turnId", "messageId", "blockId", "blockType", "delta"], path);
            if (input.blockType !== "text" && input.blockType !== "thinking") {
                throw new ContractValidationError("unsupported block type", `${path}.blockType`);
            }
            const delta = boundedUtf8(input.delta, `${path}.delta`, CONVERSATION_LIMITS.DELTA_MAX_BYTES);
            if (delta.length === 0) {
                throw new ContractValidationError("expected a non-empty string", `${path}.delta`);
            }
            return {
                kind,
                sessionId: sessionId,
                turnId: boundedId(input.turnId, `${path}.turnId`),
                messageId: boundedId(input.messageId, `${path}.messageId`),
                blockId: boundedId(input.blockId, `${path}.blockId`),
                blockType: input.blockType,
                delta,
            };
        }
        case "conversation.message.completed": {
            exactKeys(input, ["kind", "sessionId", "turnId", "messageId", "item", "error"], path);
            const messageId = boundedId(input.messageId, `${path}.messageId`);
            const item = parseMessageItem(input.item, `${path}.item`);
            if (item.itemId !== messageId) {
                throw new ContractValidationError("item.itemId must equal messageId", `${path}.item.itemId`);
            }
            const error = input.error === undefined ? undefined : parseMessageError(input.error, `${path}.error`);
            return {
                kind,
                sessionId: sessionId,
                turnId: boundedId(input.turnId, `${path}.turnId`),
                messageId,
                item,
                ...(error === undefined ? {} : { error }),
            };
        }
        case "conversation.tool.started": {
            exactKeys(input, ["kind", "sessionId", "turnId", "messageId", "toolCallId", "toolName", "arguments", "startedAt", "presentation"], path);
            const event = {
                kind,
                sessionId: sessionId,
                turnId: boundedId(input.turnId, `${path}.turnId`),
                messageId: boundedId(input.messageId, `${path}.messageId`),
                toolCallId: boundedId(input.toolCallId, `${path}.toolCallId`),
                toolName: boundedUtf8(input.toolName, `${path}.toolName`, CONVERSATION_LIMITS.TOOL_NAME_MAX_CHARS),
                startedAt: nonEmptyString(input.startedAt, `${path}.startedAt`),
            };
            if (event.toolName.length === 0) {
                throw new ContractValidationError("expected a non-empty string", `${path}.toolName`);
            }
            if ("arguments" in input)
                event.arguments = parseJsonValue(input.arguments, `${path}.arguments`);
            if (input.presentation === "reply")
                event.presentation = "reply";
            return event;
        }
        case "conversation.tool.updated": {
            exactKeys(input, ["kind", "sessionId", "turnId", "toolCallId", "updateMode", "output", "truncated", "progress", "presentation", "replies"], path);
            if (input.updateMode !== "append" && input.updateMode !== "replace") {
                throw new ContractValidationError("unsupported update mode", `${path}.updateMode`);
            }
            const event = {
                kind,
                sessionId: sessionId,
                turnId: boundedId(input.turnId, `${path}.turnId`),
                toolCallId: boundedId(input.toolCallId, `${path}.toolCallId`),
                updateMode: input.updateMode,
            };
            if (input.output !== undefined) {
                event.output = boundedUtf8(input.output, `${path}.output`, CONVERSATION_LIMITS.TEXT_BLOCK_MAX_BYTES);
            }
            const truncated = parseTruncated(input.truncated, `${path}.truncated`);
            if (truncated !== undefined)
                event.truncated = truncated;
            if (input.presentation === "reply")
                event.presentation = "reply";
            if (Array.isArray(input.replies))
                event.replies = input.replies.filter((value) => typeof value === "string");
            if (input.progress !== undefined) {
                const raw = input.progress;
                if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
                    typeof raw.progress !== "number" || !Number.isFinite(raw.progress) ||
                    (raw.total !== undefined && (typeof raw.total !== "number" || !Number.isFinite(raw.total))) ||
                    (raw.message !== undefined && typeof raw.message !== "string")) {
                    throw new ContractValidationError("invalid tool progress", `${path}.progress`);
                }
                event.progress = {
                    progress: raw.progress,
                    ...(raw.total === undefined ? {} : { total: raw.total }),
                    ...(raw.message === undefined ? {} : { message: raw.message }),
                };
            }
            return event;
        }
        case "conversation.tool.completed": {
            exactKeys(input, ["kind", "sessionId", "turnId", "toolCallId", "result", "completedAt"], path);
            const result = parseToolResultBlock(input.result, `${path}.result`);
            const toolCallId = boundedId(input.toolCallId, `${path}.toolCallId`);
            if (result.toolCallId !== toolCallId) {
                throw new ContractValidationError("result.toolCallId must equal toolCallId", `${path}.result.toolCallId`);
            }
            return {
                kind,
                sessionId: sessionId,
                turnId: boundedId(input.turnId, `${path}.turnId`),
                toolCallId,
                result,
                completedAt: nonEmptyString(input.completedAt, `${path}.completedAt`),
            };
        }
        case "conversation.turn.completed":
        case "conversation.turn.aborted": {
            exactKeys(input, ["kind", "sessionId", "turnId"], path);
            return {
                kind,
                sessionId: sessionId,
                turnId: boundedId(input.turnId, `${path}.turnId`),
            };
        }
        case "conversation.compaction.started": {
            exactKeys(input, ["kind", "sessionId", "action"], path);
            return {
                kind,
                sessionId: sessionId,
                action: nonEmptyString(input.action, `${path}.action`),
            };
        }
        case "conversation.compaction.completed": {
            exactKeys(input, ["kind", "sessionId", "item", "aborted"], path);
            const aborted = booleanValue(input.aborted, `${path}.aborted`);
            const event = {
                kind,
                sessionId: sessionId,
                aborted,
            };
            if (input.item !== undefined)
                event.item = parseCompactionItem(input.item, `${path}.item`);
            return event;
        }
        case "conversation.notice": {
            exactKeys(input, ["kind", "sessionId", "level", "message", "source"], path);
            if (input.level !== "info" && input.level !== "warning" && input.level !== "error") {
                throw new ContractValidationError("unsupported notice level", `${path}.level`);
            }
            const event = {
                kind,
                sessionId: sessionId,
                level: input.level,
                message: boundedUtf8(input.message, `${path}.message`, CONVERSATION_LIMITS.NOTICE_MESSAGE_MAX_CHARS),
            };
            if (event.message.length === 0) {
                throw new ContractValidationError("expected a non-empty string", `${path}.message`);
            }
            if (input.source !== undefined)
                event.source = nonEmptyString(input.source, `${path}.source`);
            return event;
        }
        default:
            throw new ContractValidationError("unsupported event kind", `${path}.kind`);
    }
}
//# sourceMappingURL=conversation-validation.js.map