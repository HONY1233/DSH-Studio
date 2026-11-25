export type ExtensionLinkOperation = {
    kind: "extensions.links.activate";
    sessionId: string;
    sourceSessionId?: string;
    agentId?: string;
    url: string;
};
export interface ExtensionLinkResultMap {
    "extensions.links.activate": {
        handled: boolean;
    };
}
export declare const EXTENSION_LINK_KINDS: readonly ["extensions.links.activate"];
//# sourceMappingURL=extension-links.d.ts.map