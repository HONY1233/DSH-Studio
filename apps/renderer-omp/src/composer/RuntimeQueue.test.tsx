// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import type { StudioClient } from "@omp-studio/client-contract";
import { I18nProvider } from "../i18n";
import { RuntimeQueue } from "./RuntimeQueue";

vi.mock("../hostError", () => ({
  waitReceipt: async (client: { results: Record<string, unknown> }, id: string) => {
    const value = client.results[id];
    if (value && typeof value === "object" && "error" in value) throw value.error;
    return value;
  },
  hostErrorMessage: (error: Error) => error.message,
}));

const roots: Root[] = [];
const props = { sessionId: "s", available: true, canRemove: true };
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

beforeAll(() => { actEnvironment.IS_REACT_ACT_ENVIRONMENT = true; });
afterAll(() => { delete actEnvironment.IS_REACT_ACT_ENVIRONMENT; });
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.useRealTimers();
});

function mount(children: ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(<I18nProvider forcedLanguage="en">{children}</I18nProvider>));
  return { container, root };
}

function queueSnapshot(total = 2) {
  return {
    sessionId: "s",
    total,
    followUpMode: "one-at-a-time",
    steeringMode: "all",
    items: Array.from({ length: total }, (_, index) => ({
      id: index === 0 ? "first" : "second",
      queue: "followUp",
      state: "pending",
      text: "same",
      imageCount: 0,
    })),
  };
}

function fake(removeResult: unknown = { removed: true }) {
  let sequence = 0;
  const results: Record<string, unknown> = {};
  const command = vi.fn(async (kind: string, _input: { id?: string }) => {
    const requestId = String(++sequence);
    results[requestId] = kind === "session.queue.list" ? queueSnapshot() : removeResult;
    return { requestId };
  });
  return { client: { command, results } as unknown as StudioClient, command };
}

function cancelButtons(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].filter((button) => button.textContent === "Cancel");
}

async function settle() {
  await act(async () => {});
}

it("cancels the selected Runtime identity for duplicate text and exposes no unsupported actions", async () => {
  const { client, command } = fake();
  const { container } = mount(<RuntimeQueue {...props} client={client} />);
  await settle();

  const buttons = cancelButtons(container);
  expect(buttons).toHaveLength(2);
  act(() => buttons[1]!.click());
  await settle();
  expect(command).toHaveBeenCalledWith("session.queue.remove", { sessionId: "s", id: "second" });
  expect([...container.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Cancel"]);
  expect(command.mock.calls.every(([kind]) => !kind.startsWith("core.") && kind !== "session.queue.takeback" && kind !== "session.queue.steer")).toBe(true);
});

it("disables native removal unless its exact capability is exposed", async () => {
  const { client, command } = fake();
  const { container } = mount(<RuntimeQueue {...props} client={client} canRemove={false} />);
  await settle();

  const button = cancelButtons(container)[0]!;
  expect(button.disabled).toBe(true);
  act(() => button.click());
  await settle();
  expect(command).toHaveBeenCalledTimes(1);
});

it("reports an already-sent removal as a non-error outcome", async () => {
  const { client } = fake({ removed: false, status: "already-sent" });
  const { container } = mount(<RuntimeQueue {...props} client={client} />);
  await settle();

  act(() => cancelButtons(container)[0]!.click());
  await settle();
  expect(container.querySelector('[role="status"]')?.textContent).toContain("already sent");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("also treats the bridge INVALID_STATE already-sent receipt as non-error", async () => {
  const { client } = fake({ error: { code: "INVALID_STATE", message: "already sent" } });
  const { container } = mount(<RuntimeQueue {...props} client={client} />);
  await settle();

  act(() => cancelButtons(container)[0]!.click());
  await settle();
  expect(container.querySelector('[role="status"]')?.textContent).toContain("already sent");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("distinguishes an already-cancelled Runtime item from a sent item", async () => {
  const { client } = fake({ removed: false, status: "already-cancelled" });
  const { container } = mount(<RuntimeQueue {...props} client={client} />);
  await settle();

  act(() => cancelButtons(container)[0]!.click());
  await settle();
  expect(container.querySelector('[role="status"]')?.textContent).toContain("already cancelled");
  expect(container.querySelector('[role="status"]')?.textContent).not.toContain("already sent");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("does not invent a sent outcome from an unclassified removal or INVALID_STATE", async () => {
  for (const removeResult of [
    { removed: false },
    { error: { code: "INVALID_STATE", message: "queue revision changed" } },
  ]) {
    const { client } = fake(removeResult);
    const { container } = mount(<RuntimeQueue {...props} client={client} />);
    await settle();

    act(() => cancelButtons(container)[0]!.click());
    await settle();
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  }
});

it("does not repeatedly wake an idle empty Runtime, and refreshes when work starts", async () => {
  vi.useFakeTimers();
  let sequence = 0;
  const results: Record<string, unknown> = {};
  const command = vi.fn(async () => {
    const requestId = String(++sequence);
    results[requestId] = queueSnapshot(0);
    return { requestId };
  });
  const client = { command, results } as unknown as StudioClient;
  const { root } = mount(<RuntimeQueue {...props} client={client} />);
  await settle();
  expect(command).toHaveBeenCalledOnce();

  act(() => root.render(<I18nProvider forcedLanguage="en"><RuntimeQueue {...props} client={client} running /></I18nProvider>));
  await settle();
  expect(command).toHaveBeenCalledTimes(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  expect(command).toHaveBeenCalledTimes(3);
});

it("coalesces demand changes behind an outstanding queue read and ignores its old error", async () => {
  let reject!: (cause: Error) => void;
  const blocked = new Promise<unknown>((_resolve, fail) => { reject = fail; });
  let sequence = 0;
  const results: Record<string, unknown> = {};
  const command = vi.fn(async () => {
    const requestId = String(++sequence);
    results[requestId] = sequence === 1 ? blocked : queueSnapshot(0);
    return { requestId };
  });
  const client = { command, results } as unknown as StudioClient;
  const { container, root } = mount(<RuntimeQueue {...props} client={client} />);
  await settle();
  act(() => root.render(<I18nProvider forcedLanguage="en"><RuntimeQueue {...props} client={client} running pending={1} /></I18nProvider>));
  act(() => root.render(<I18nProvider forcedLanguage="en"><RuntimeQueue {...props} client={client} running pending={2} /></I18nProvider>));
  await settle();
  expect(command).toHaveBeenCalledOnce();

  await act(async () => { reject(new Error("stale queue failure")); });
  expect(command).toHaveBeenCalledTimes(2);
  expect(container.textContent).not.toContain("stale queue failure");
});
