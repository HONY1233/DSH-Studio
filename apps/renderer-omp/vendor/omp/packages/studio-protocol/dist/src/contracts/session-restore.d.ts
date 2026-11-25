export interface SessionRestoreInspection {
    targetSessionId: string;
    savedModels: string[];
    status: "available" | "missing-model" | "unconfigured";
    resolvedModel?: string;
    thinking?: string;
    alternatives: Array<{
        model: string;
        label: string;
    }>;
    truncated: boolean;
}
export type SessionRestoreOperation = {
    kind: "session.restore.inspect";
    sessionId: string;
    targetSessionId: string;
};
export interface SessionRestoreResultMap {
    "session.restore.inspect": SessionRestoreInspection;
}
export declare const SESSION_RESTORE_KINDS: readonly ["session.restore.inspect"];
export declare function isSessionRestoreKind(kind: string): kind is SessionRestoreOperation["kind"];
//# sourceMappingURL=session-restore.d.ts.map