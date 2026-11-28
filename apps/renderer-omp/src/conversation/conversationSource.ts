import type {
  ClientEvent,
  ConversationTranscriptPage,
  ConversationTranscriptReadPage,
  OpaqueCursor,
  SessionId,
  StudioClient,
  Unsubscribe,
} from "@omp-studio/client-contract";
import type { AgentId, ConversationOpenResult, ConversationTarget } from "@omp-studio/studio-protocol";

export type ConversationSourceClient = Pick<StudioClient, "query" | "subscribe">;
export type ConversationSourcePage = ConversationTranscriptPage | ConversationTranscriptReadPage;

/**
 * A bounded recovery journal is usable only when every sequence after the
 * client's contiguous watermark is present. Initial opens intentionally omit
 * the watermark because their transcript page already contains history.
 */
export function hasContiguousReplay(
  afterStreamSeq: number | undefined,
  events: readonly { readonly streamSeq: number }[],
  watermark: number,
): boolean {
  if (afterStreamSeq === undefined) return true
  if (!Number.isSafeInteger(afterStreamSeq) || afterStreamSeq < 0 || afterStreamSeq > watermark) return false
  let expected = afterStreamSeq + 1
  for (const event of events) {
    if (event.streamSeq !== expected) return false
    expected += 1
  }
  return expected === watermark + 1
}

/**
 * The only module aware of transport query names. Engines consume this narrow
 * source so protocol migrations do not leak into Store or React hooks.
 */
export function createConversationSource(client: ConversationSourceClient) {
  return {
    subscribe(listener: (event: ClientEvent) => void): Unsubscribe {
      return client.subscribe({ scope: "all" }, listener);
    },
    open(target: ConversationTarget, limit: number, afterStreamSeq?: number): Promise<ConversationOpenResult> {
      return afterStreamSeq === undefined
        ? client.query("conversation.open", { target, limit })
        : client.query("conversation.open", { target, limit, afterStreamSeq });
    },
    readLiveOlder(target: ConversationTarget, cursor: OpaqueCursor, limit: number): Promise<ConversationTranscriptPage> {
      return target.kind === "session"
        ? client.query("session.transcript.read", { cursor, limit })
        : client.query("agent.conversation.read", { agentId: target.agentId as AgentId, cursor, limit });
    },
    readArchive(sessionId: SessionId, agentId: string | undefined, cursor: OpaqueCursor | undefined, limit: number): Promise<ConversationTranscriptReadPage> {
      return client.query("session.transcript.readPage", { sessionId, ...(agentId === undefined ? {} : { agentId: agentId as AgentId }), ...(cursor === undefined ? {} : { cursor }), limit });
    },
  };
}
