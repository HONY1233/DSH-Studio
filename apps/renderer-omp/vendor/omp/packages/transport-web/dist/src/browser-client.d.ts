import type { ClientBootstrap, ClientCommandAccepted, ClientCommandRequest, ClientEvent, ClientQueryRequest, ClientQueryResponse, ClientTransport, CommandName, QueryName, SubscriptionScope, Unsubscribe, WorkspaceId } from '@omp-studio/client-contract';
export interface MobileBrowserSession {
    workspaceId: WorkspaceId;
    workspaceName: string;
    expiresAt: number;
}
export interface WebSocketLike {
    send(data: string): void;
    close(): void;
    onopen?: () => void;
    onmessage?: (event: {
        data: string;
    }) => void;
    onclose?: () => void;
}
export interface BrowserWebClientOptions {
    baseUrl: string;
    contextId?: string;
    fetcher?: typeof fetch;
    webSocketFactory?: (url: string) => WebSocketLike;
    mobile?: {
        onDisconnect: () => void;
    };
}
/** Browser-side ClientTransport over the loopback HTTP/WebSocket adapter. */
export declare class BrowserWebClientTransport implements ClientTransport {
    #private;
    constructor(options: BrowserWebClientOptions);
    pair(code: string): Promise<void>;
    restoreSession(): Promise<MobileBrowserSession>;
    openContext(scope: import('@omp-studio/client-contract').ClientContextScope): Promise<ClientTransport>;
    bootstrap(): Promise<ClientBootstrap>;
    query<T extends QueryName>(request: ClientQueryRequest<T>): Promise<ClientQueryResponse<T>>;
    command<T extends CommandName>(request: ClientCommandRequest<T>): Promise<ClientCommandAccepted<T>>;
    subscribe(scope: SubscriptionScope, listener: (event: ClientEvent) => void): Unsubscribe;
    close(): Promise<void>;
    private req;
}
//# sourceMappingURL=browser-client.d.ts.map