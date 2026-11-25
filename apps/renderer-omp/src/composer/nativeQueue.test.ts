import { describe, expect, it, vi } from "vitest";
import { StudioClientImpl } from "@omp-studio/client";
import {
  CLIENT_CONTRACT_VERSION,
  type ClientBootstrap,
  type ClientCommandRequest,
  type ClientEvent,
  type ClientTransport,
  type CommandRequestId,
  type IdempotencyKey,
  type PromptTextInput,
  type SessionId,
} from "@omp-studio/client-contract";
import { createComposerDispatchGate } from "./dispatch";
import { dispatchNativeQueue } from "./nativeQueue";

function harness() {
  const calls: ClientCommandRequest[] = [];
  const listeners = new Set<(event: ClientEvent) => void>();
  let request = 0;
  const client = new StudioClientImpl({
    bootstrap: async () => ({
      contractVersion: CLIENT_CONTRACT_VERSION,
      authority: { authorityId: "test", authorityEpoch: "epoch-1" },
      runtime: { status: "connected", runtimeId: "runtime-1", runtimeEpoch: "epoch-1", classification: "managed", backend: "rpc-ui" },
      surface: {},
      capabilityManifest: { capabilities: [] },
      commandManifestHash: "manifest-1",
      selected: {},
    } as unknown as ClientBootstrap),
    query: async () => { throw new Error("unexpected query"); },
    command: async (request) => {
      calls.push(request);
      return { commandName: request.commandName, requestId: request.requestId, status: "accepted", acceptedAt: new Date().toISOString() };
    },
    subscribe: (_scope, listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    close: async () => { listeners.clear(); },
  } as ClientTransport, {
    now: () => "2026-11-25T00:00:00.000Z",
    newRequestId: () => `request-${++request}` as CommandRequestId,
    newIdempotencyKey: () => `idempotency-${request}` as IdempotencyKey,
  });
  const complete = (index: number, status: "completed" | "failed", result: unknown = {}) => {
    const sent = calls[index]!;
    const event = {
      kind: "command.receipt",
      authorityEpoch: "epoch-1",
      runtimeEpoch: "epoch-1",
      cursor: String(index + 1),
      occurredAt: "2026-11-25T00:00:00.000Z",
      receipt: status === "completed"
        ? { requestId: sent.requestId, commandName: sent.commandName, status, result, observedAt: "2026-11-25T00:00:00.000Z" }
        : { requestId: sent.requestId, commandName: sent.commandName, status, error: { code: "CAPABILITY_UNAVAILABLE", message: "queue rejected" }, observedAt: "2026-11-25T00:00:00.000Z" },
    } as unknown as ClientEvent;
    for (const listener of listeners) listener(event);
  };
  return { client, calls, complete };
}

const sessionA = "session-a" as SessionId;
const payload: PromptTextInput = {
  text: "queued text",
  images: [{ type: "image", mimeType: "image/png", data: "aW1hZ2U=" }],
};

function options(client: StudioClientImpl, overrides: Partial<Parameters<typeof dispatchNativeQueue>[0]> = {}) {
  return {
    client,
    sessionId: sessionA,
    running: true,
    supported: true,
    payload,
    prepare: async () => payload,
    gate: createComposerDispatchGate(),
    isCurrentSession: (sessionId: string) => sessionId === "session-a",
    clearAcceptedDraft: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}

describe("native streaming queue dispatch", () => {
  it("sends only queue.enqueue with captured identity, images, and the wrapper requestId", async () => {
    const { client, calls, complete } = harness();
    const input = options(client);
    const sending = dispatchNativeQueue(input);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      commandName: "queue.enqueue",
      requestId: "request-1",
      idempotencyKey: "idempotency-1",
      input: { sessionId: sessionA, ...payload },
    });
    complete(0, "completed", { queued: true });
    expect(await sending).toBe(true);
    expect(input.clearAcceptedDraft).toHaveBeenCalledOnce();
    expect(calls.map((call) => call.commandName)).toEqual(["queue.enqueue"]);
  });

  it("acquires dispatch ownership before preparation and blocks a second submit", async () => {
    const { client, calls, complete } = harness();
    let release!: () => void;
    const prepared = new Promise<PromptTextInput>(resolve => { release = () => resolve(payload); });
    const prepare = vi.fn(() => prepared);
    const input = options(client, { prepare });
    const sending = dispatchNativeQueue(input);
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
    expect(await dispatchNativeQueue(input)).toBe(false);
    expect(prepare).toHaveBeenCalledOnce();
    expect(calls).toEqual([]);
    release();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    complete(0, "completed", { queued: true });
    expect(await sending).toBe(true);
  });

  it("fails closed without core.followUp/query fallback when the exact capability is unsupported", async () => {
    const { client, calls } = harness();
    const input = options(client, { supported: false });
    expect(await dispatchNativeQueue(input)).toBe(false);
    expect(calls).toEqual([]);
    expect(input.onError).toHaveBeenCalledWith(expect.stringContaining("draft"));
    expect(input.clearAcceptedDraft).not.toHaveBeenCalled();
  });

  it("keeps the draft on a failed native receipt and never retries through another command", async () => {
    const { client, calls, complete } = harness();
    const input = options(client);
    const sending = dispatchNativeQueue(input);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    complete(0, "failed");
    expect(await sending).toBe(false);
    expect(input.clearAcceptedDraft).not.toHaveBeenCalled();
    expect(input.onError).toHaveBeenCalledWith("queue rejected");
    expect(calls.map((call) => call.commandName)).toEqual(["queue.enqueue"]);
  });

  it("blocks same-frame double submit and does not clear a draft after a session switch", async () => {
    const { client, calls, complete } = harness();
    let current = "session-a";
    const input = options(client, { isCurrentSession: (sessionId) => current === sessionId });
    const sending = dispatchNativeQueue(input);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(await dispatchNativeQueue({ ...input, gate: input.gate })).toBe(false);
    current = "session-b";
    complete(0, "completed", { queued: true });
    expect(await sending).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.input).toEqual({ sessionId: sessionA, ...payload });
    expect(input.clearAcceptedDraft).not.toHaveBeenCalled();
  });

  it("refuses a stale session before issuing a command", async () => {
    const { client, calls } = harness();
    const input = options(client, { isCurrentSession: () => false });
    expect(await dispatchNativeQueue(input)).toBe(false);
    expect(calls).toEqual([]);
    expect(input.clearAcceptedDraft).not.toHaveBeenCalled();
  });

  it("rechecks the session after asynchronous preparation", async () => {
    const { client, calls } = harness();
    let current = "session-a";
    const input = options(client, {
      isCurrentSession: (sessionId) => current === sessionId,
      prepare: async () => { current = "session-b"; return payload; },
    });
    expect(await dispatchNativeQueue(input)).toBe(false);
    expect(calls).toEqual([]);
    expect(input.clearAcceptedDraft).not.toHaveBeenCalled();
  });

  it("does not turn idle prompting into queueing", async () => {
    const { client, calls } = harness();
    const input = options(client, { running: false });
    expect(await dispatchNativeQueue(input)).toBe(false);
    expect(calls).toEqual([]);
  });
});
