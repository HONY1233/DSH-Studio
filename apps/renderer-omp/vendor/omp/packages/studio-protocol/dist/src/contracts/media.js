export const MEDIA_OPERATION_KINDS = ["media.models", "media.list", "media.start", "media.read", "media.cancel", "media.resume", "media.close"];
export function isMediaOperationKind(kind) { return MEDIA_OPERATION_KINDS.includes(kind); }
export function mediaInputArtifacts(request) {
    return [...new Set(request.type === "image" ? request.inputArtifacts ?? [] : request.type === "transcription" ? [request.audioArtifact] : request.type === "video" ? [...(request.firstFrame ? [request.firstFrame] : []), ...(request.lastFrame ? [request.lastFrame] : []), ...(request.references?.map(ref => ref.artifactId) ?? [])] : [])];
}
//# sourceMappingURL=media.js.map