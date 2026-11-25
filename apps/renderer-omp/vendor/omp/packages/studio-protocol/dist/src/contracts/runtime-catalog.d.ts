export interface PromptTemplateRow {
    id: string;
    name: string;
    description: string;
    source: string;
    version: string;
}
export interface McpRuntimeStatus {
    available: boolean;
    startupTimeoutMs: number;
    ready: boolean;
    settled: boolean;
    servers: Array<{
        name: string;
        replacedByBuiltin?: string;
        evalNamespaceUri?: string;
        state: "ready" | "pending" | "failed" | "disconnected";
        tools: number;
        transport?: "stdio" | "http" | "sse";
        source?: {
            providerName: string;
            level: "user" | "project" | "native";
        };
        error?: string;
        toolInfo?: Array<{
            name: string;
            mcpServerName: string;
            mcpToolName: string;
            description?: string;
            readOnlyHint?: boolean;
        }>;
    }>;
    total: number;
}
export type RuntimeCatalogOperation = {
    kind: "templates.list";
    sessionId: string;
    cursor?: string;
    limit?: number;
} | {
    kind: "templates.get";
    sessionId: string;
    id: string;
    version: string;
} | {
    kind: "templates.prepare";
    sessionId: string;
    id: string;
    version: string;
    arguments: string;
} | {
    kind: "mcp.runtime.status";
    sessionId: string;
};
export interface RuntimeCatalogResultMap {
    "templates.list": {
        templates: PromptTemplateRow[];
        nextCursor?: string;
    };
    "templates.get": {
        template: PromptTemplateRow;
        content: string;
    };
    "templates.prepare": {
        text: string;
    };
    "mcp.runtime.status": McpRuntimeStatus;
}
export declare const RUNTIME_CATALOG_OPERATION_KINDS: readonly ["templates.list", "templates.get", "templates.prepare", "mcp.runtime.status"];
export declare function isRuntimeCatalogOperationKind(kind: string): kind is RuntimeCatalogOperation["kind"];
//# sourceMappingURL=runtime-catalog.d.ts.map