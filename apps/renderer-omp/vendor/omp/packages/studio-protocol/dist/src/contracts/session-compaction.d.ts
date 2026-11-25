/** A conversation override; never a model or user preference. */
export type SessionCompactionThreshold = {
    kind: "percent" | "tokens";
    value: number;
};
export interface SessionCompactionRead {
    sessionId: string;
    threshold: SessionCompactionThreshold | null;
}
export interface SessionCompactionState extends SessionCompactionRead {
    contextWindow: number;
    triggerTokens: number | null;
    automatic: boolean;
}
export declare const SESSION_COMPACTION_ENTRY = "studio.compaction-threshold";
/** Bare values below 100 are percentages; a unit always means tokens. Empty restores inheritance. */
export declare function parseSessionCompactionInput(input: string): SessionCompactionThreshold | null;
export declare function formatSessionCompactionInput(threshold: SessionCompactionThreshold | null): string;
/** Read the last conversation-wide override, including after rewind. Forks do not inherit it. */
export declare function readSessionCompactionThreshold(sessionId: string, entries: readonly {
    type: string;
    customType?: unknown;
    data?: unknown;
}[]): SessionCompactionThreshold | null;
//# sourceMappingURL=session-compaction.d.ts.map