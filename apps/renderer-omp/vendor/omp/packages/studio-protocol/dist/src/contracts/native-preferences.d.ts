export declare const NATIVE_PREFERENCE_KEYS: readonly ["advisor.enabled", "advisor.reviewMode", "advisor.reviewInterval", "advisor.syncBacklog", "advisor.immuneTurns", "advisor.maxNotesPerUpdate", "advisor.evictStaleResults", "advisor.continueSeverity", "lsp.requestTimeout", "sharpshooter.minPromptLength", "title.icons", "title.generator", "title.refreshOnReplan", "telemetry.otlpExportEnabled"];
export type NativePreferenceKey = (typeof NATIVE_PREFERENCE_KEYS)[number];
export type NativePreferenceValue = string | number | boolean;
export interface NativePreference {
    key: NativePreferenceKey;
    group: "advisor" | "tools" | "titles" | "diagnostics";
    label: string;
    description: string;
    value: NativePreferenceValue;
    effective: NativePreferenceValue;
    source: "env" | "default" | "runtime" | "overlay" | "project" | "global";
    type: "boolean" | "number" | "enum";
    choices?: NativePreferenceValue[];
    restartRequired: boolean;
}
export type NativePreferenceOperation = {
    kind: "preferences.native.get";
    sessionId: string;
} | {
    kind: "preferences.native.set";
    sessionId: string;
    key: NativePreferenceKey;
    value: NativePreferenceValue;
    scope: "session" | "global";
} | {
    kind: "preferences.native.clearOverride";
    sessionId: string;
    key: NativePreferenceKey;
};
export interface NativePreferenceResultMap {
    "preferences.native.get": {
        preferences: NativePreference[];
    };
    "preferences.native.set": NativePreference;
    "preferences.native.clearOverride": NativePreference;
}
export declare const NATIVE_PREFERENCE_KINDS: readonly ["preferences.native.get", "preferences.native.set", "preferences.native.clearOverride"];
export declare function isNativePreferenceKind(kind: string): kind is NativePreferenceOperation["kind"];
//# sourceMappingURL=native-preferences.d.ts.map