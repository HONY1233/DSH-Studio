/** Native auth-store metadata; keys and tokens never enter the read model. */
export interface SearchCredentialStatus {
    provider: string;
    configured: boolean;
    source: "runtime" | "config" | "oauth" | "api_key" | "env" | null;
    envVar?: string;
    apiKeyLogin: boolean;
    keyUrl?: string;
    credentials: Array<{
        id: number;
        label: string;
        type: "api_key" | "oauth";
    }>;
}
export type SearchCredentialsOperation = {
    kind: "search.credentials.list";
    sessionId: string;
    providers: string[];
} | {
    kind: "search.credentials.set";
    sessionId: string;
    provider: string;
    apiKey: string;
} | {
    kind: "search.credentials.remove";
    sessionId: string;
    provider: string;
    credentialId: number;
};
export interface SearchCredentialsResultMap {
    "search.credentials.list": {
        providers: SearchCredentialStatus[];
    };
    "search.credentials.set": SearchCredentialStatus;
    "search.credentials.remove": SearchCredentialStatus;
}
export declare const SEARCH_CREDENTIAL_KINDS: readonly ["search.credentials.list", "search.credentials.set", "search.credentials.remove"];
export declare function isSearchCredentialsKind(kind: string): kind is SearchCredentialsOperation["kind"];
//# sourceMappingURL=search-credentials.d.ts.map