/** Public artifact facts. Storage roots and absolute payload paths stay private. */
export declare const ARTIFACT_KINDS: readonly ["graphic", "image", "video", "audio", "transcript", "judgment", "benchmark", "recording", "annotation", "export"];
export type ArtifactKind = typeof ARTIFACT_KINDS[number];
export interface ArtifactRecord {
    readonly artifactId: string;
    readonly kind: ArtifactKind;
    readonly name: string;
    readonly mimeType: string;
    readonly bytes: number;
    readonly createdAt: string;
    readonly workspaceId?: string;
    readonly sessionId?: string;
    readonly runId?: string;
    readonly sha256: string;
}
export interface ArtifactListInput {
    readonly workspaceId?: string;
    readonly sessionId?: string;
    readonly kind?: ArtifactKind;
    readonly cursor?: string;
    readonly limit?: number;
}
export interface ArtifactPage {
    readonly artifacts: readonly ArtifactRecord[];
    readonly nextCursor?: string;
    readonly total: number;
    readonly totalBytes: number;
}
export interface ArtifactStorageState {
    readonly locationName: string;
    readonly writable: boolean;
    readonly total: number;
    readonly totalBytes: number;
}
export interface ArtifactTextInput {
    readonly kind: "annotation" | "judgment" | "benchmark" | "transcript" | "export";
    readonly name: string;
    readonly text: string;
    readonly workspaceId?: string;
    readonly sessionId?: string;
    readonly runId?: string;
}
export interface ArtifactTextResult {
    readonly artifact: ArtifactRecord;
    readonly text: string;
}
export declare const ARTIFACT_TEXT_MAX_BYTES = 800000;
export declare function validateArtifactTextInput(value: unknown): asserts value is ArtifactTextInput;
//# sourceMappingURL=artifacts.d.ts.map