/**
 * Public conversation types for Host/Client. These are the protocol's
 * already-sanitized shapes — Host and Renderer must not invent a parallel
 * item/event vocabulary.
 */
export { CONVERSATION_LIMITS, CONVERSATION_MESSAGE_DELTA_INCREMENTS_STATE_VERSION, SESSION_TRANSCRIPT_READ_CAPABILITY, SESSION_TRANSCRIPT_READ_CONCURRENCY, SESSION_TRANSCRIPT_READ_KIND, parseConversationRuntimeEvent, parseConversationTranscriptPage, publicConversationToolCallId, tailUtf8, truncateUtf8, utf8ByteLength, } from "@omp-studio/studio-protocol";
//# sourceMappingURL=conversation.js.map