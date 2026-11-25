import { type ConversationContentBlock, type ConversationItem, type ConversationOpenResult, type ConversationRuntimeEvent, type ConversationTranscriptPage } from "./contracts/conversation.js";
import type { OpaqueCursor } from "./contracts/ids.js";
export declare function parseOpaqueConversationCursor(value: unknown, path: string): OpaqueCursor;
export declare function parseConversationContentBlock(value: unknown, path: string): ConversationContentBlock;
export declare function parseConversationItem(value: unknown, path: string): ConversationItem;
export declare function parseConversationTranscriptPage(value: unknown, path?: string): ConversationTranscriptPage;
export declare function parseConversationOpenResult(value: unknown, path?: string): ConversationOpenResult;
export declare function parseSessionTranscriptReadLimit(value: unknown, path: string): number;
export declare function isConversationRuntimeEventKind(kind: unknown): kind is string;
/** True when `value` is an object this parser returned; exposed for tests and counters only. */
export declare function isParsedConversationRuntimeEvent(value: unknown): boolean;
export declare function parseConversationRuntimeEvent(value: unknown, path?: string, reuse?: boolean): ConversationRuntimeEvent;
//# sourceMappingURL=conversation-validation.d.ts.map