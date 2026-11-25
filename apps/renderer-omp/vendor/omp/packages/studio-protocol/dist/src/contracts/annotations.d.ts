/** A frozen source and its exact-text anchors. No executable paths or UI markup. */
export interface AnnotationSource {
    id: string;
    kind: "message" | "quote" | "file" | "diff";
    label: string;
    text: string;
    version: string;
    path?: string;
    sessionId?: string;
    messageId?: string;
}
export interface AnnotationNote {
    id: string;
    sourceId: string;
    note: string;
    /** UTF-16 offsets in the captured source, end exclusive. Omitted means whole source. */
    selection?: {
        start: number;
        end: number;
    };
}
export type AnnotationCapture = {
    kind: "file";
    path: string;
} | {
    kind: "diff";
    path?: string;
} | {
    kind: "message" | "quote";
    text: string;
    label: string;
    sessionId?: string;
    messageId?: string;
};
export interface AnnotationBundle {
    schemaVersion: 1;
    revision: number;
    sources: AnnotationSource[];
    notes: AnnotationNote[];
    workspaceId?: string;
    sessionId?: string;
}
export type AnnotationOperation = {
    kind: "annotations.capture";
    source: AnnotationCapture;
} | {
    kind: "annotations.prepare";
    sources: AnnotationSource[];
    notes: AnnotationNote[];
    action: "feedback" | "review";
    allowStale?: boolean;
};
export interface AnnotationResultMap {
    "annotations.capture": {
        source: AnnotationSource;
    };
    "annotations.prepare": {
        prompt: string;
        staleSources: string[];
    };
}
export declare const ANNOTATION_OPERATION_KINDS: readonly ["annotations.capture", "annotations.prepare"];
export declare function validateAnnotationBundle(value: unknown): asserts value is AnnotationBundle;
//# sourceMappingURL=annotations.d.ts.map