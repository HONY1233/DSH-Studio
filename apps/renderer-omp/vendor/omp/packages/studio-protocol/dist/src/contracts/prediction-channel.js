export const PREDICTION_KINDS = [
    "prediction.status",
    "prediction.configure",
    "prediction.clearOverride",
    "prediction.download.cancel",
    "prediction.prepare",
    "prediction.release",
];
export function isPredictionKind(kind) {
    return PREDICTION_KINDS.includes(kind);
}
//# sourceMappingURL=prediction-channel.js.map