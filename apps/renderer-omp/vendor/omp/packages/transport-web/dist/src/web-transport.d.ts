import type { ClientBootstrap, ClientCommandAccepted, ClientCommandRequest, ClientEvent, ClientQueryRequest, ClientQueryResponse, ClientTransport, CommandName, QueryName, SubscriptionScope, Unsubscribe } from "@omp-studio/client-contract";
/**
 * In-process browser-port boundary implemented by the embedder (P0).
 *
 * Structurally identical to {@link ClientTransport}: every method is a typed
 * semantic operation; there is no generic request(path, payload) surface and
 * no URL/channel names. P2 replaces the object's internals with HTTP and
 * WebSocket; the adapter and the contracts it enforces do not change.
 */
export interface OmpStudioWebApi {
    openContext?(scope: import("@omp-studio/client-contract").ClientContextScope): Promise<OmpStudioWebApi>;
    bootstrap(): Promise<ClientBootstrap>;
    query<TName extends QueryName>(request: ClientQueryRequest<TName>): Promise<ClientQueryResponse<TName>>;
    command<TName extends CommandName>(request: ClientCommandRequest<TName>): Promise<ClientCommandAccepted<TName>>;
    subscribe(scope: SubscriptionScope, listener: (event: ClientEvent) => void): Unsubscribe;
    close(): Promise<void>;
}
type EventListener = (event: ClientEvent) => void;
/**
 * P0 semantic web transport over an {@link OmpStudioWebApi}.
 *
 * Envelopes are forwarded verbatim, with defensive cloning in both
 * directions and fail-closed response checks:
 *
 * - requests are cloned before forwarding; results and events are cloned
 *   before delivery, so neither side observes the other's mutations;
 * - a query response must be an object whose `ok` flag is a boolean, whose
 *   `queryName` matches the request, that owns `result` when ok and a
 *   well-formed `error` (object with string `code`/`message`) otherwise;
 * - a command acknowledgement must be an object whose `commandName`
 *   matches the request, whose `status` is exactly `"accepted"`, and that
 *   carries string `requestId`/`acceptedAt`;
 * - bootstrap must resolve to an object. Any violation throws
 *   {@link WebTransportError} instead of surfacing a plausible result;
 * - after `close()`: `bootstrap`/`query`/`command` reject and `subscribe`
 *   throws synchronously; active listeners are unsubscribed (api-side too)
 *   and callbacks never fire after unsubscribe or close;
 * - `close()` is idempotent and always calls `api.close()` exactly once;
 *   its rejection propagates but the transport stays closed.
 */
export declare class WebClientTransport implements ClientTransport {
    #private;
    constructor(api: OmpStudioWebApi);
    openContext(scope: import("@omp-studio/client-contract").ClientContextScope): Promise<ClientTransport>;
    bootstrap(): Promise<ClientBootstrap>;
    query<TName extends QueryName>(request: ClientQueryRequest<TName>): Promise<ClientQueryResponse<TName>>;
    command<TName extends CommandName>(request: ClientCommandRequest<TName>): Promise<ClientCommandAccepted<TName>>;
    subscribe(scope: SubscriptionScope, listener: EventListener): Unsubscribe;
    close(): Promise<void>;
}
/** Creates a {@link ClientTransport} over an in-process {@link OmpStudioWebApi}. */
export declare function createWebTransport(api: OmpStudioWebApi): ClientTransport;
export {};
//# sourceMappingURL=web-transport.d.ts.map