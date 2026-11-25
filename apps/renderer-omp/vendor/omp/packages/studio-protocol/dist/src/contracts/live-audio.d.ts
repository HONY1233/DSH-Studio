export declare const LIVE_AUDIO_VOICES: readonly ["arbor", "breeze", "cove", "ember", "juniper", "maple", "sol", "spruce", "vale"];
export interface LiveAudioState {
    available: boolean;
    audioId?: string;
    attached: boolean;
    voice: string;
    endpoint?: string;
    apiKeyConfigured?: boolean;
    phase: "off" | "prepared" | "connecting" | "listening" | "speaking" | "working" | "muted" | "error";
    muted: boolean;
    inputLevel: number;
    outputLevel: number;
    transcripts: Array<{
        role: "user" | "assistant";
        turn: number;
        text: string;
        final: boolean;
    }>;
    error?: string;
}
export type LiveAudioOperation = {
    kind: "live.audio.prepare";
    sessionId: string;
    voice?: string;
} | {
    kind: "live.audio.start";
    sessionId: string;
    audioId: string;
} | {
    kind: "live.audio.status";
    sessionId: string;
} | {
    kind: "live.audio.mute";
    sessionId: string;
    audioId: string;
    muted: boolean;
} | {
    kind: "live.audio.release";
    sessionId: string;
    audioId: string;
};
export interface LiveAudioResultMap {
    "live.audio.prepare": LiveAudioState;
    "live.audio.start": LiveAudioState;
    "live.audio.status": LiveAudioState;
    "live.audio.mute": LiveAudioState;
    "live.audio.release": LiveAudioState;
}
export declare const LIVE_AUDIO_OPERATION_KINDS: readonly ["live.audio.prepare", "live.audio.start", "live.audio.status", "live.audio.mute", "live.audio.release"];
export declare function isLiveAudioOperationKind(kind: string): kind is LiveAudioOperation["kind"];
//# sourceMappingURL=live-audio.d.ts.map