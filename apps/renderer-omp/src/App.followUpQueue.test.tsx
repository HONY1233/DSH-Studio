// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StudioClientImpl } from "@omp-studio/client";
import { contractFixtures } from "@omp-studio/testkit";
import type { ClientBootstrap, ClientEvent, ClientTransport, ConversationMessageItem, QueryInput } from "@omp-studio/client-contract";
import { App } from "./App";
import { __resetAppSettingsForTests } from "./settings/appSettings";
import { STARTUP_NOTICE_ID, STARTUP_NOTICE_STORAGE_KEY } from "./settings/startupNotice";
import { PREVIEW_MODE_STORAGE_KEY } from "./preview/mode";

const clients: StudioClientImpl[] = [];
vi.setConfig({ testTimeout: 15_000 });

afterEach(async () => {
  cleanup();
  window.dispatchEvent(new Event("pagehide"));
  for (const client of clients.splice(0)) await client.close();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  __resetAppSettingsForTests(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function createNativeQueueHarness(options?: { readonly unsupportedQueue?: boolean; readonly running?: boolean }) {
  const fixture = structuredClone(contractFixtures.bootstrap) as ClientBootstrap;
  const workspaceId = fixture.residents!.residents[0]!.workspaceId;
  const capabilities = fixture.capabilityManifest.capabilities.filter((cap) =>
    cap.id !== "session.queue.list" && cap.id !== "session.queue.get" && cap.id !== "core.followUp");
  if (options?.unsupportedQueue !== true) {
    for (const id of ["queue.enqueue", "session.queue.list", "session.queue.remove"] as const) {
      if (!capabilities.some((cap) => cap.id === id)) capabilities.push({ id, grade: "stable", version: 1, evidence: "test" });
    }
  }
  const manifest = { ...fixture.capabilityManifest, capabilities };
  const calls: Array<{ readonly name: string; readonly input: unknown }> = [];
  const queuedEntries: Array<{ id: string; queue: "followUp"; state: "pending"; text: string; imageCount: number }> = [];
  const messages: ConversationMessageItem[] = [
    {
      kind: "message",
      itemId: "user-initial",
      parentId: null,
      createdAt: "2026-11-18T00:33:00.000Z",
      role: "user",
      content: [{ type: "text", text: "Initial task" }],
    },
  ];
  let cursor = 0;
  let streamSeq = 0;
  const listeners = new Set<(event: ClientEvent) => void>();
  let current: ClientBootstrap = {
    ...fixture,
    capabilityManifest: manifest,
    cursor: "0" as never,
    selected: { ...fixture.selected, workspaceId },
    snapshot: {
      ...fixture.snapshot!,
      isStreaming: options?.running !== false,
      pendingMessages: 0,
    },
  };

  const emit = (event: object) => {
    const value = {
      ...event,
      authorityEpoch: fixture.authority.authorityEpoch,
      cursor: String(++cursor),
      occurredAt: new Date().toISOString(),
    } as ClientEvent;
    for (const listener of listeners) listener(value);
  };

  const transport: ClientTransport = {
    bootstrap: async () => current,
    subscribe: (_scope, listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    query: async (request) => {
      if (request.queryName === "capabilities.get") {
        return { ok: true, queryName: request.queryName, result: current.capabilityManifest } as never;
      }
      const response = structuredClone((contractFixtures.queryResponses as Record<string, unknown>)[request.queryName]) as {
        ok: boolean;
        result: Record<string, unknown>;
      };
      if (request.queryName === "history.list") response.result = { ...response.result, entries: [], total: 0 };
      if (request.queryName === "projects.list") response.result = { ...response.result, activeWorkspaceId: workspaceId };
      if (request.queryName === "conversation.open") {
        const target = (request.input as QueryInput<"conversation.open">).target;
        const sessionId = target.kind === "session" ? target.sessionId : target.parentSessionId;
        response.result = {
          target: { kind: "session", sessionId, conversationSessionId: sessionId },
          page: { ...(response.result.page as object), sessionId, items: [...messages], hasMoreBefore: false },
          live: { status: "complete", watermark: streamSeq, events: [] },
        };
      }
      return response as never;
    },
    command: async (request) => {
      calls.push({ name: request.commandName, input: request.input });
      let result: unknown = {};
      if (request.commandName === "session.queue.list") {
        result = {
          sessionId: current.snapshot!.sessionId,
          items: [...queuedEntries],
          total: queuedEntries.length,
          followUpMode: "one-at-a-time",
          steeringMode: "all",
        };
      } else if (request.commandName === "queue.enqueue") {
        const input = request.input as { sessionId: string; text: string; images?: unknown[] };
        if (input.sessionId !== current.snapshot!.sessionId) throw new Error("wrong queue session");
        queuedEntries.push({ id: `q-${queuedEntries.length + 1}`, queue: "followUp", state: "pending", text: input.text, imageCount: input.images?.length ?? 0 });
        const snapshot = {
          ...current.snapshot!,
          isStreaming: true,
          pendingMessages: queuedEntries.length,
          stateVersion: ((current.snapshot!.stateVersion as number) + 1) as never,
        };
        current = { ...current, snapshot, stateVersion: snapshot.stateVersion };
        emit({ kind: "snapshot", snapshot });
        result = { queued: true, pendingMessages: queuedEntries.length };
      }
      emit({
        kind: "command.receipt",
        receipt: {
          requestId: request.requestId,
          commandName: request.commandName,
          status: "completed",
          result,
          observedAt: new Date().toISOString(),
        },
      });
      return {
        commandName: request.commandName,
        requestId: request.requestId,
        status: "accepted",
        acceptedAt: new Date().toISOString(),
      };
    },
    close: async () => {
      listeners.clear();
    },
  };

  const client = new StudioClientImpl(transport);
  clients.push(client);
  return {
    client,
    calls,
    dequeueToConversation(text: string) {
      queuedEntries.shift();
      const sessionId = current.snapshot!.sessionId;
      const item: ConversationMessageItem = {
        kind: "message",
        itemId: "user-queued-1",
        parentId: "user-initial",
        createdAt: "2026-11-18T00:49:00.000Z",
        role: "user",
        content: [{ type: "text", text }],
      };
      messages.push(item);
      emit({
        kind: "conversation.changed",
        sessionId,
        runtimeEpoch: current.snapshot!.runtimeEpoch,
        stateVersion: current.snapshot!.stateVersion,
        streamSeq: ++streamSeq,
        eventSeq: streamSeq,
        update: { kind: "conversation.message.completed", sessionId, turnId: "turn-1", messageId: item.itemId, item },
      });
      const snapshot = {
        ...current.snapshot!,
        pendingMessages: queuedEntries.length,
        stateVersion: ((current.snapshot!.stateVersion as number) + 1) as never,
      };
      current = { ...current, snapshot, stateVersion: snapshot.stateVersion };
      emit({ kind: "snapshot", snapshot });
    },
  };
}

async function mountApp(client: StudioClientImpl) {
  localStorage.setItem(STARTUP_NOTICE_STORAGE_KEY, STARTUP_NOTICE_ID);
  localStorage.setItem(PREVIEW_MODE_STORAGE_KEY, "0");
  __resetAppSettingsForTests(JSON.stringify({ language: "en", restoreLastSession: false, startupPage: "workbench" }));
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.scrollTo = vi.fn();
  render(<App client={client} />);
  await waitFor(() => expect(document.querySelector("#workbench")).not.toBeNull());
  await screen.findByText("Initial task");
}

describe("native streaming queue dispatch", () => {
  it("queues streaming Enter through queue.enqueue without an optimistic user bubble", async () => {
    const harness = createNativeQueueHarness();
    await mountApp(harness.client);

    const editor = document.querySelector<HTMLElement>('.chip-composer-editor[contenteditable="true"]')!;
    editor.textContent = "Queued mid-stream follow-up";
    fireEvent.input(editor);
    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });

    await waitFor(() => expect(harness.calls.some((call) => call.name === "queue.enqueue")).toBe(true));
    expect(harness.calls.some((call) => call.name === "core.followUp" || call.name === "core.prompt")).toBe(false);
    expect(document.querySelectorAll('[data-item-id^="pending:"]')).toHaveLength(0);
    const timeline = document.querySelector(".convo-transcript") ?? document.querySelector("#workbench")!;
    expect(timeline.querySelectorAll(".ev-user")).toHaveLength(1);

    act(() => harness.dequeueToConversation("Queued mid-stream follow-up"));
    await screen.findByText("Queued mid-stream follow-up");
    expect(timeline.querySelectorAll(".ev-user")).toHaveLength(2);
  });

  it("fails closed and preserves the draft when native queueing is unsupported", async () => {
    const harness = createNativeQueueHarness({ unsupportedQueue: true });
    await mountApp(harness.client);

    const editor = document.querySelector<HTMLElement>('.chip-composer-editor[contenteditable="true"]')!;
    editor.textContent = "Keep this draft";
    fireEvent.input(editor);
    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });

    await screen.findByText(/Native queue unavailable/);
    expect(editor.textContent).toContain("Keep this draft");
    expect(harness.calls.some((call) => call.name === "queue.enqueue" || call.name === "core.followUp" || call.name === "core.prompt")).toBe(false);
  });

  it("keeps idle Enter on the ordinary prompt command", async () => {
    const harness = createNativeQueueHarness({ running: false });
    await mountApp(harness.client);

    const editor = document.querySelector<HTMLElement>('.chip-composer-editor[contenteditable="true"]')!;
    editor.textContent = "Idle prompt";
    fireEvent.input(editor);
    await act(async () => {
      fireEvent.keyDown(editor, { key: "Enter" });
    });

    await waitFor(() => expect(harness.calls.some((call) => call.name === "core.prompt")).toBe(true));
    expect(harness.calls.some((call) => call.name === "queue.enqueue")).toBe(false);
  });
});
