export interface AgentModelInspection {
    agentId: string;
    source: "live" | "saved" | "starting";
    selectedModel?: string;
    servingModel?: string;
    usingFallback?: boolean;
    configuredThinking?: string;
    effectiveThinking?: string;
    candidates?: string[];
    candidatesTruncated?: boolean;
}
export type AgentModelOperation = {
    kind: "agent.model.inspect";
    sessionId: string;
    agentId: string;
};
export interface AgentModelResultMap {
    "agent.model.inspect": AgentModelInspection;
}
export declare const AGENT_MODEL_KINDS: readonly ["agent.model.inspect"];
export declare function isAgentModelKind(kind: string): kind is AgentModelOperation["kind"];
//# sourceMappingURL=agent-model.d.ts.map