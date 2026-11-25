/**
 * Pure client state and reducer (FRONTEND_INTEGRATION.md §8.3, §11).
 *
 * State is split into four top-level areas:
 *   - connection: authority/runtime identity, epochs, state version, event
 *     cursor, resync flag (rebuilt from bootstrap and events);
 *   - entities: the authoritative operator snapshot (rebuilt from bootstrap
 *     and snapshot events);
 *   - commands: the local_pending -> accepted -> interaction_required ->
 *     terminal lifecycle, keyed by requestId;
 *   - ui: Renderer-owned; the reducer never reads or writes it.
 *
 * §8.3 invariants implemented here:
 *   1. bootstrap establishes authority/runtime epoch, stateVersion, cursor
 *      and the initial snapshot; an unavailable bootstrap (Runtime without
 *      a snapshot) still establishes authority, surface and manifests but
 *      keeps stateVersion/cursor null and entities.snapshot null until a
 *      snapshot event arrives;
 *   2. duplicate cursors are idempotent (the reducer returns the same state
 *      reference when nothing changed);
 *   3. stale authority/runtime epochs are ignored;
 *   4. cursor gaps force `resync_required`; the gapped event's payload is
 *      dropped and the cursor does not advance;
 *   5. while resync is required, sensitive mutations
 *      (runtime.install / session.drop / interaction.respond) reduce to a
 *      failed entry with RESYNC_REQUIRED;
 *   6. snapshot events clear resync only on matching authority; version
 *      monotonicity is scoped to one Runtime identity and epoch (either may
 *      restart from a smaller version);

 *   7. command accepted/interaction/terminal transitions never regress or
 *      duplicate; terminal states are final;
 *   8. runtime epoch changes (or runtime loss) mark in-flight commands
 *      outcome_unknown, which is terminal and never retried automatically.
 */
import type { AuthorityEpoch, AuthorityId, BtwSnapshot, ClientBootstrap, ClientError, ClientEvent, ClientInteraction, ClientSelection, CommandName, CommandRequestId, CommandState, EventCursor, IdempotencyKey, RuntimeConnection, RuntimeEpoch, ResidentsReadModel, StateVersion, SurfaceCapabilities } from "@omp-studio/client-contract";
import type { CapabilityManifest, OperatorStateSnapshot } from "@omp-studio/studio-protocol";
/** Renderer-owned area; the client reducer never reads or writes it. */
export type ClientUiState = Readonly<Record<string, unknown>>;
export interface ClientConnectionState {
    readonly phase: "initial" | "bootstrapped" | "closed";
    readonly authorityId: AuthorityId | null;
    readonly authorityEpoch: AuthorityEpoch | null;
    readonly runtime: RuntimeConnection | null;
    /** Runtime epoch tracked independently of the display connection. */
    readonly runtimeEpoch: RuntimeEpoch | null;
    readonly stateVersion: StateVersion | null;
    readonly cursor: EventCursor | null;
    readonly resyncRequired: boolean;
    readonly resyncReason: string | null;
    readonly surface: SurfaceCapabilities | null;
    readonly capabilityManifest: CapabilityManifest | null;
    readonly commandManifestHash: string | null;
    readonly selected: ClientSelection | null;
    readonly contractVersion: number | null;
}
export interface ClientEntitiesState {
    readonly snapshot: OperatorStateSnapshot | null;
    readonly telemetry: OperatorStateSnapshot["telemetry"] | null;
    /** Authority-level broker overview; survives Runtime epoch changes. */
    readonly residents: ResidentsReadModel | null;
    /**
     * Latest BTW side-channel snapshot. Sits beside `telemetry` rather than
     * inside `conversation` because a BTW turn is ephemeral: it never enters the
     * transcript and has no conversation item to attach to. Cleared whenever the
     * Runtime identity or the snapshot baseline is invalidated.
     */
    readonly btw: BtwSnapshot | null;
}
/**
 * Session-level interaction area. At most one pending interaction exists
 * (`interaction.required` always writes it; `interaction.resolved` clears
 * only the matching interactionId + leaseGeneration). A later snapshot that
 * still carries the same GUI prompt must keep this card — clearing it would
 * unmount the Renderer between every `state.changed`. Renderer reads the
 * pending card from here — never by scanning commands.
 */
export interface ClientInteractionState {
    readonly pending: ClientInteraction | null;
}
export interface ClientState {
    readonly connection: ClientConnectionState;
    readonly entities: ClientEntitiesState;
    readonly interaction: ClientInteractionState;
    readonly commands: Readonly<Record<CommandRequestId, CommandState>>;
    readonly ui: ClientUiState;
}
export type ClientAction = {
    readonly type: "bootstrap.set";
    readonly bootstrap: ClientBootstrap;
    /** Client-side observation time for outcome_unknown re-bootstrap marks. */
    readonly occurredAt: string;
} | {
    readonly type: "event";
    readonly event: ClientEvent;
} | {
    readonly type: "command.issue";
    readonly requestId: CommandRequestId;
    readonly commandName: CommandName;
    readonly idempotencyKey: IdempotencyKey;
    readonly issuedAt: string;
} | {
    readonly type: "command.transportFailed";
    readonly requestId: CommandRequestId;
    readonly error: ClientError;
    readonly occurredAt: string;
} | {
    readonly type: "transport.lost";
    readonly reason: string;
    readonly occurredAt: string;
} | {
    readonly type: "close";
};
export declare function createInitialClientState(ui?: ClientUiState): ClientState;
export declare function isSensitiveCommand(name: CommandName): boolean;
export declare const RESYNC_REQUIRED_ERROR: ClientError;
/**
 * Bound retained receipts. In-flight commands are never dropped; oldest
 * terminal rows go first. A long Studio session otherwise keeps every
 * prompt/steer/follow-up receipt for the process lifetime.
 */
export declare const COMMAND_STATE_TERMINAL_CAP = 100;
export declare function reduceClientState(state: ClientState, action: ClientAction): ClientState;
export declare function selectSessionTelemetry(state: ClientState): OperatorStateSnapshot["telemetry"] | null;
export declare function selectBtwSnapshot(state: ClientState): BtwSnapshot | null;
//# sourceMappingURL=reducer.d.ts.map