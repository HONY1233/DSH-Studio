export declare function utf8ByteLength(text: string): number;
/**
 * Truncate `text` to at most `maxBytes` UTF-8 bytes without splitting a
 * codepoint. Used by live buffers so they match the persisted sanitizer cap.
 *
 * Streaming appends call this once per delta with the whole accumulated block
 * (up to `TEXT_BLOCK_MAX_BYTES`), so the common "still far below the cap" case
 * must not encode: the length bound decides it in O(1).
 */
export declare function truncateUtf8(text: string, maxBytes: number): {
    text: string;
    truncated: boolean;
};
/**
 * Keep the LAST `maxBytes` UTF-8 bytes of `text` without splitting a codepoint.
 *
 * Mirror image of `truncateUtf8`, and the direction matters: that one keeps the
 * head, so it walks the cut at `maxBytes` *backward* to a codepoint boundary;
 * this one keeps the tail, so it starts at `bytes.length - maxBytes` and must
 * walk *forward* — walking backward would retain more than `maxBytes`.
 *
 * Live tool output calls this once per `tool.updated` event with the whole
 * accumulated candidate, so the "still below the cap" case must not encode:
 * the length bound decides it in O(1). Never loop-and-re-encode per character —
 * on multibyte text that degrades to O(n²) and blocks the renderer for seconds.
 */
export declare function tailUtf8(text: string, maxBytes: number): {
    text: string;
    truncated: boolean;
};
/**
 * FNV-1a 32-bit hex. Must match overlay `publicToolCallId` and the archive
 * reader: a truncated id still has to be unique so live overlay and history
 * pairing keep using the same key.
 */
export declare function fnv1aHex(text: string): string;
export declare function publicConversationToolCallId(raw: string, fallback: string): {
    id: string;
    truncated: boolean;
};
//# sourceMappingURL=conversation-text.d.ts.map