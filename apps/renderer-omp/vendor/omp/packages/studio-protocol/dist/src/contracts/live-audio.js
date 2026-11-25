export const LIVE_AUDIO_VOICES = ["arbor", "breeze", "cove", "ember", "juniper", "maple", "sol", "spruce", "vale"];
export const LIVE_AUDIO_OPERATION_KINDS = ["live.audio.prepare", "live.audio.start", "live.audio.status", "live.audio.mute", "live.audio.release"];
export function isLiveAudioOperationKind(kind) { return LIVE_AUDIO_OPERATION_KINDS.includes(kind); }
//# sourceMappingURL=live-audio.js.map