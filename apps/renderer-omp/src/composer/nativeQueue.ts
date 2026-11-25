import type { CommandInput, PromptTextInput, SessionId, StudioClient } from "@omp-studio/client-contract";
import { hostErrorMessage, waitReceipt } from "../hostError";
import { createComposerDispatchGate } from "./dispatch";

/**
 * The desktop bridge accepts the additive Runtime queue fields on
 * `queue.enqueue`. The vendored OMP input type still describes only its older
 * text-only command, so keep the bridge extension at this renderer seam.
 */
export type NativeQueueInput = PromptTextInput & { readonly sessionId: SessionId };

/** One command, one wrapper-generated requestId, and no prompt/follow-up fallback. */
export async function dispatchNativeQueue(input: {
  readonly client: StudioClient;
  readonly sessionId: SessionId | undefined;
  readonly running: boolean;
  readonly supported: boolean;
  /** Runs only after the synchronous gate and target checks have passed. */
  readonly prepare: () => Promise<PromptTextInput | undefined>;
  readonly gate: ReturnType<typeof createComposerDispatchGate>;
  readonly isCurrentSession: (sessionId: string) => boolean;
  readonly clearAcceptedDraft: () => void;
  readonly onError: (message: string) => void;
  readonly unavailableMessage?: string;
  readonly failureMessage?: string;
}): Promise<boolean> {
  if (!input.gate.tryEnter()) return false;
  try {
    if (!input.running || !input.supported || input.sessionId === undefined || !input.isCurrentSession(input.sessionId)) {
      input.onError(input.unavailableMessage ?? "Native queue unavailable; input kept as a draft.");
      return false;
    }
    const owner = input.sessionId;
    const payload = await input.prepare();
    if (payload === undefined) return false;
    if (!payload.text.trim() && (payload.images?.length ?? 0) === 0) return false;
    // Preparation may await slash side effects. Recheck ownership before the
    // write so a session switch cannot redirect the queued message.
    if (!input.isCurrentSession(owner)) {
      input.onError(input.unavailableMessage ?? "Native queue unavailable; input kept as a draft.");
      return false;
    }
    const outbound: NativeQueueInput = {
      sessionId: owner,
      text: payload.text,
      ...(payload.images === undefined ? {} : { images: [...payload.images] }),
    };
    const handle = await input.client.command("queue.enqueue", outbound as CommandInput<"queue.enqueue">);
    await waitReceipt(input.client, handle.requestId);
    // A late receipt belongs to the captured session. Never clear a draft that
    // now belongs to another conversation.
    if (input.isCurrentSession(owner)) input.clearAcceptedDraft();
    return true;
  } catch (error) {
    input.onError(hostErrorMessage(error, input.failureMessage ?? "Native queue failed; input kept as a draft."));
    return false;
  } finally {
    input.gate.leave();
  }
}
