/**
 * In-process semantic transport for tests and P0 fixtures (P0 transports are
 * in-process by design). Implements the exact ClientTransport contract:
 * deterministic bootstrap/query/command handlers, `emit(event)` for tests,
 * value cloning where safe, closed-state enforcement and exact subscription
 * scope filtering.
 */
import type { ClientBootstrap, ClientCommandAccepted, ClientCommandRequest, ClientEvent, ClientQueryRequest, ClientQueryResponse, ClientTransport, CommandName, QueryName, SubscriptionScope, Unsubscribe } from "@omp-studio/client-contract";
export interface MemoryTransportHandlers {
    bootstrap?(): ClientBootstrap | Promise<ClientBootstrap>;
    query?<TName extends QueryName>(request: ClientQueryRequest<TName>): ClientQueryResponse<TName> | Promise<ClientQueryResponse<TName>>;
    command?<TName extends CommandName>(request: ClientCommandRequest<TName>): ClientCommandAccepted<TName> | Promise<ClientCommandAccepted<TName>>;
}
export declare class MemoryClientTransport implements ClientTransport {
    private readonly handlers;
    private closed;
    private readonly subscribers;
    constructor(handlers?: MemoryTransportHandlers);
    bootstrap(): Promise<ClientBootstrap>;
    query<TName extends QueryName>(request: ClientQueryRequest<TName>): Promise<ClientQueryResponse<TName>>;
    command<TName extends CommandName>(request: ClientCommandRequest<TName>): Promise<ClientCommandAccepted<TName>>;
    subscribe(scope: SubscriptionScope, listener: (event: ClientEvent) => void): Unsubscribe;
    /** Deliver a host-side event to matching subscribers (tests only). */
    emit(event: ClientEvent): void;
    close(): Promise<void>;
    private assertOpen;
    private invoke;
}
//# sourceMappingURL=memory-transport.d.ts.map