import { type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { ClientBootstrap, ClientCommandRequest, ClientQueryRequest, ClientQueryResponse, ClientCommandAccepted, ClientEvent, SubscriptionScope, QueryName, CommandName, WorkspaceId } from "@omp-studio/client-contract";
export interface WebAdapterHost {
    openContext?(scope: import("@omp-studio/client-contract").ClientContextScope): Promise<import("@omp-studio/client-contract").ClientTransport>;
    bootstrap(): Promise<ClientBootstrap>;
    query<T extends QueryName>(request: ClientQueryRequest<T>): Promise<ClientQueryResponse<T>>;
    command<T extends CommandName>(request: ClientCommandRequest<T>): Promise<ClientCommandAccepted<T>>;
    subscribe(scope: SubscriptionScope, listener: (event: ClientEvent) => void): () => void;
}
export interface WebAdapterOptions {
    host: WebAdapterHost;
    origins: readonly string[];
    pairingCode?: string;
    pairingTtlMs?: number;
    sessionTtlMs?: number;
    maxBodyBytes?: number;
    maxOutstandingCommands?: number;
    now?: () => number;
    mobile?: {
        workspaceName: string;
        workspaceId: WorkspaceId;
    };
}
interface Session {
    contexts: Map<string, import("@omp-studio/client-contract").ClientTransport>;
    connections: Set<{
        contextId: string;
        close: () => void;
    }>;
    csrf: string;
    expiresAt: number;
    scope: SubscriptionScope;
    outstanding: number;
    revoked: boolean;
    opening?: boolean;
    expiry?: ReturnType<typeof setTimeout>;
}
/** Loopback HTTP adapter implementing pairing, session/CSRF and semantic query/command routes. */
export declare class LoopbackWebAdapter {
    #private;
    constructor(options: WebAdapterOptions);
    get pairingCode(): string;
    get paired(): boolean;
    get pairingExpiresAt(): number;
    rotatePairingCode(): void;
    revokeAll(): Promise<void>;
    private now;
    private closeContext;
    private revoke;
    private pruneSessions;
    private originAllowed;
    private session;
    private body;
    private auth;
    private target;
    handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
    /** Validate a WebSocket upgrade before accepting it; caller performs actual upgrade. */
    authenticateWebSocket(req: IncomingMessage): {
        sessionId: string;
        session: Session;
        host: WebAdapterHost;
    } | undefined;
    trackMobileEvents(req: IncomingMessage, close: () => void): {
        host: WebAdapterHost;
        unsubscribe: () => void;
    } | undefined;
}
/** Create a real loopback HTTP server; caller may attach an upgrade handler. */
export declare function createLoopbackHttpServer(adapter: LoopbackWebAdapter): Server;
export {};
//# sourceMappingURL=server.d.ts.map