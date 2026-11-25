/**
 * Renderer-side Desktop transport: forwards typed envelopes between the
 * Renderer and the Desktop shell's `OmpStudioDesktopApi` 1:1. Electron IPC
 * already copies payloads, so nothing is cloned here.
 *
 * `close()` is idempotent and unsubscribes every active listener; no
 * operation is accepted afterwards.
 */
import type { ClientBootstrap, ClientContextScope, ClientCommandAccepted, ClientCommandRequest, ClientEvent, ClientQueryRequest, ClientQueryResponse, ClientTransport, CommandName, QueryName, SubscriptionScope, Unsubscribe } from "@omp-studio/client-contract";
import type { OmpStudioDesktopApi } from "./desktop-api.js";
export declare class DesktopClientTransport implements ClientTransport {
    private readonly api;
    private readonly contextId?;
    private closed;
    private closePromise;
    private readonly subscriptions;
    constructor(api: OmpStudioDesktopApi, contextId?: string | undefined);
    get supportsContexts(): boolean;
    openContext(scope: ClientContextScope): Promise<ClientTransport>;
    bootstrap(): Promise<ClientBootstrap>;
    query<TName extends QueryName>(request: ClientQueryRequest<TName>): Promise<ClientQueryResponse<TName>>;
    command<TName extends CommandName>(request: ClientCommandRequest<TName>): Promise<ClientCommandAccepted<TName>>;
    subscribe(scope: SubscriptionScope, listener: (event: ClientEvent) => void): Unsubscribe;
    close(): Promise<void>;
    private assertOpen;
}
/** Create a renderer-side `ClientTransport` bound to a Desktop shell api. */
export declare function createDesktopTransport(api: OmpStudioDesktopApi): ClientTransport;
//# sourceMappingURL=desktop-transport.d.ts.map