export interface CompressionFile {
    sessionId: string;
    name: string;
    bytes: number;
    allocated: number;
}
export interface CompressionSummary {
    supported: boolean;
    method?: "ntfs" | "apfs";
    scanned: number;
    skippedLive: number;
    sessions: number;
    candidates: number;
    compressed: number;
    bytes: number;
    allocatedBefore: number;
    allocatedAfter: number;
    files: CompressionFile[];
    truncated: boolean;
    errors: string[];
}
export interface CompressionState {
    phase: "idle" | "scanning" | "ready" | "applying" | "complete" | "failed";
    days?: number;
    token?: string;
    expiresAt?: number;
    summary?: CompressionSummary;
    error?: string;
}
export type SessionCompressionOperation = {
    kind: "maintenance.compression.scan";
    sessionId: string;
} | {
    kind: "maintenance.compression.apply";
    sessionId: string;
    token: string;
} | {
    kind: "maintenance.compression.status";
    sessionId: string;
};
export interface SessionCompressionResultMap {
    "maintenance.compression.scan": CompressionState;
    "maintenance.compression.apply": CompressionState;
    "maintenance.compression.status": CompressionState;
}
export declare const SESSION_COMPRESSION_KINDS: readonly ["maintenance.compression.scan", "maintenance.compression.apply", "maintenance.compression.status"];
export declare function isSessionCompressionKind(kind: string): kind is SessionCompressionOperation["kind"];
//# sourceMappingURL=session-compression.d.ts.map