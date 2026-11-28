import { describe, expect, it, vi } from "vitest";

import { createConversationSource, hasContiguousReplay } from "./conversationSource";

describe("conversation source recovery", () => {
  it("omits the watermark on initial open and sends it on reconnect", async () => {
    const query = vi.fn(async () => ({})) as never;
    const source = createConversationSource({ query, subscribe: () => () => {} } as never);
    const target = { kind: "session", sessionId: "session" } as const;
    await source.open(target, 50);
    await source.open(target, 50, 7);
    expect(query).toHaveBeenNthCalledWith(1, "conversation.open", { target, limit: 50 });
    expect(query).toHaveBeenNthCalledWith(2, "conversation.open", { target, limit: 50, afterStreamSeq: 7 });
  });

  it("accepts only a complete, duplicate-free sequence after the requested watermark", () => {
    expect(hasContiguousReplay(undefined, [], 9)).toBe(true);
    expect(hasContiguousReplay(2, [{ streamSeq: 3 }, { streamSeq: 4 }], 4)).toBe(true);
    expect(hasContiguousReplay(4, [], 4)).toBe(true);
    expect(hasContiguousReplay(2, [{ streamSeq: 4 }], 4)).toBe(false);
    expect(hasContiguousReplay(2, [{ streamSeq: 3 }, { streamSeq: 5 }], 5)).toBe(false);
    expect(hasContiguousReplay(2, [{ streamSeq: 3 }, { streamSeq: 3 }], 3)).toBe(false);
    expect(hasContiguousReplay(2, [], 3)).toBe(false);
    expect(hasContiguousReplay(6, [], 5)).toBe(false);
  });
});
