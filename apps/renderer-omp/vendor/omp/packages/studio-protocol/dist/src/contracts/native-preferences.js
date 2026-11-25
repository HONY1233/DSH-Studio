export const NATIVE_PREFERENCE_KEYS = [
    "advisor.enabled",
    "advisor.reviewMode",
    "advisor.reviewInterval",
    "advisor.syncBacklog",
    "advisor.immuneTurns",
    "advisor.maxNotesPerUpdate",
    "advisor.evictStaleResults",
    "advisor.continueSeverity",
    "lsp.requestTimeout",
    "sharpshooter.minPromptLength",
    "title.icons",
    "title.generator",
    "title.refreshOnReplan",
    "telemetry.otlpExportEnabled",
];
export const NATIVE_PREFERENCE_KINDS = [
    "preferences.native.get",
    "preferences.native.set",
    "preferences.native.clearOverride",
];
export function isNativePreferenceKind(kind) {
    return NATIVE_PREFERENCE_KINDS.includes(kind);
}
//# sourceMappingURL=native-preferences.js.map