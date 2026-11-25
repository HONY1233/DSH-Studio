export type MediaKind = "image" | "video" | "transcription" | "speech";
export type MediaRequest = {
    type: "image";
    model?: string;
    prompt: string;
    inputArtifacts?: string[];
    aspectRatio?: string;
    imageSize?: string;
    count?: number;
} | {
    type: "video";
    model: string;
    prompt?: string;
    duration?: number;
    resolution?: string;
    aspectRatio?: string;
    size?: string;
    firstFrame?: string;
    lastFrame?: string;
    references?: Array<{
        artifactId: string;
        type: "image" | "audio" | "video";
    }>;
    generateAudio?: boolean;
    seed?: number;
    creativity?: number;
    upscaleFactor?: number;
    providerOptions?: Record<string, unknown>;
} | {
    type: "transcription";
    model?: string;
    audioArtifact: string;
    language?: string;
    prompt?: string;
    timestamps?: "none" | "segment" | "word";
    temperature?: number;
} | {
    type: "speech";
    model?: string;
    text: string;
    voice?: string;
    format: "mp3" | "wav" | "pcm" | "opus" | "aac" | "flac";
    speed?: number;
    sampleRate?: number;
    bitRate?: number;
    instructions?: string;
};
export interface MediaModelChoice {
    selector: string;
    name: string;
    kind: MediaKind;
    api: string;
    local: boolean;
    parameters: string[];
    formats?: string[];
    voices?: Array<{
        id: string;
        label: string;
    }>;
}
export interface MediaJob {
    id: string;
    sessionId: string;
    type: MediaKind;
    state: "queued" | "running" | "waiting" | "paused" | "completed" | "cancelled" | "failed" | "interrupted";
    createdAt: number;
    updatedAt: number;
    model?: string;
    cost?: number;
    error?: string;
    canResume: boolean;
    outputCount: number;
}
export interface MediaOutput {
    artifactId: string;
    kind: "image" | "audio" | "video" | "transcript";
    name: string;
    mimeType: string;
    bytes: number;
    sha256: string;
}
export interface MediaDetail {
    job: MediaJob;
    request: MediaRequest;
    outputs: MediaOutput[];
    text?: string;
    textTruncated?: boolean;
}
export type MediaOperation = {
    kind: "media.models";
    sessionId: string;
    cursor?: string;
} | {
    kind: "media.list";
    sessionId: string;
} | {
    kind: "media.start";
    sessionId: string;
    request: MediaRequest; /** Main-only input grants; rejected at public IPC. */
    inputTransfers?: Array<{
        artifactId: string;
        transferId: string;
    }>;
} | {
    kind: "media.read";
    sessionId: string;
    id: string;
} | {
    kind: "media.cancel";
    sessionId: string;
    id: string;
} | {
    kind: "media.resume";
    sessionId: string;
    id: string;
} | {
    kind: "media.close";
    sessionId: string;
    id: string;
};
export interface MediaResultMap {
    "media.models": {
        available: boolean;
        models: MediaModelChoice[];
        nextCursor?: string;
    };
    "media.list": {
        available: boolean;
        jobs: MediaJob[];
    };
    "media.start": {
        job: MediaJob;
    };
    "media.read": MediaDetail;
    "media.cancel": {
        job: MediaJob;
    };
    "media.resume": {
        job: MediaJob;
    };
    "media.close": {
        closed: boolean;
    };
}
export declare const MEDIA_OPERATION_KINDS: readonly ["media.models", "media.list", "media.start", "media.read", "media.cancel", "media.resume", "media.close"];
export declare function isMediaOperationKind(kind: string): kind is MediaOperation["kind"];
export declare function mediaInputArtifacts(request: MediaRequest): string[];
//# sourceMappingURL=media.d.ts.map