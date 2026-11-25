/**
 * Platform-neutral StudioClient implementation over an injected
 * ClientTransport (FRONTEND_INTEGRATION.md §8).
 *
 * The client keeps its own reducer state fed by bootstrap and the event
 * stream so it can enforce §8.3 rules without asking the Renderer:
 * resync gating of sensitive mutations, terminal/no-regression bookkeeping,
 * and transport failures recorded as failed command states. Renderer
 * listeners receive only events accepted by the reducer, filtered exactly by
 * their subscription scope.
 *
 * Renderer injection is `StudioClient` only; this class adds two
 * client-side conveniences (`getState` / `onState`) that are not part of
 * the shared contract.
 */
import type { ClientBootstrap, ClientContextScope, ClientEvent, ClientTransport, CommandHandle, CommandInput, CommandName, CommandOptions, QueryInput, QueryName, QueryResult, StudioClient, SubscriptionScope, Unsubscribe } from "@omp-studio/client-contract";
import { type ClientClockAndIds } from "./clock.js";
import { type ClientState } from "./reducer.js";
export declare class StudioClientImpl implements StudioClient {
    private readonly transport;
    private readonly ids;
    private state;
    private closed;
    private transportUnsubscribe;
    private bootstrapPromise;
    private bootstrapping;
    private transportGeneration;
    private readonly bufferedEvents;
    private readonly listeners;
    private readonly stateListeners;
    constructor(transport: ClientTransport, ids?: ClientClockAndIds);
    /** Current reducer state (client-side convenience; not in StudioClient). */
    getState(): ClientState;
    openContext(scope: ClientContextScope): Promise<StudioClientImpl>;
    get supportsContexts(): boolean;
    bootstrap(): Promise<ClientBootstrap>;
    /** Re-acquire a fresh snapshot and resume the event stream after a gap. */
    resync(): Promise<ClientBootstrap>;
    query<TName extends QueryName>(name: TName, input: QueryInput<TName>): Promise<QueryResult<TName>>;
    command<TName extends CommandName>(name: TName, input: CommandInput<TName>, options?: CommandOptions): Promise<CommandHandle<TName>>;
    subscribe(scope: SubscriptionScope, listener: (event: ClientEvent) => void): Unsubscribe;
    /**
     * Subscribe to reducer state updates (client-side convenience; not in the
     * shared StudioClient contract). Lets the Renderer keep a single state
     * store that also observes transport failures and resync gating, which
     * have no host-issued event kind.
     */
    onState(listener: (state: ClientState) => void): Unsubscribe;
    /** A lost transport is not evidence that an accepted operation failed. */
    transportLost(reason: string): void;
    close(): Promise<void>;
    private assertOpen;
    private ensureSubscribed;
    private applyAction;
    private shouldDeliverEvent;
}
//# sourceMappingURL=studio-client.d.ts.map