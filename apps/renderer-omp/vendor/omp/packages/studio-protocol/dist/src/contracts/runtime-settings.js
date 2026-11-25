import { GUI_SETTING_KEYS } from "./gui-settings.js";
/** Runtime settings intentionally exposed to the Studio Bridge. */
export const STUDIO_RUNTIME_SETTING_KEYS = [
    ...GUI_SETTING_KEYS,
    "modelRoles.judge",
    "claudeResets.autoRedeem5h",
    "claudeResets.autoRedeemWeekly",
    "claudeResets.autoRedeemFable",
    "claudeResets.minBlockedMinutes",
    "claudeResets.keepCredits",
    "claudeResets.salvageHorizonHours",
    "mcp.startupTimeoutMs",
    "ttsr.judge",
    "edit.autoRepair.enabled",
    "features.unexpectedStopDetection",
    "providers.unexpectedStopModel",
    "extendedContext",
    "compaction.asyncEnabled",
    "compaction.methodOrder",
    "providers.openai-codex.codeMode",
    "plan.autosave",
    "plan.autosaveDir",
    "retry.waitForUsageReset",
    "compaction.experimentalContextManagement",
    "task.enableEffort",
    "task.maxEffort",
    "task.agentServiceTierOverrides",
    "providers.autoThinkingMaxEffort",
    "providers.judgmentProvider",
    "images.describeForTextModels",
    "images.questionTimeoutMs",
    "tools.speculativeExecution.enabled",
];
export const STUDIO_RUNTIME_UNEXPECTED_STOP_MODES = ["none", "mechanical", "smart"];
export const STUDIO_RUNTIME_UNEXPECTED_STOP_MODELS = [
    "online",
    "qwen3-1.7b",
    "llama3.2:3b",
    "gemma-3-1b",
    "qwen2.5-1.5b",
    "lfm2-1.2b",
];
export const STUDIO_RUNTIME_COMPACTION_METHODS = [
    "remote",
    "snapcompact",
    "handoff",
    "soft",
    "shake",
];
export const STUDIO_RUNTIME_CODE_MODES = ["off", "on", "auto"];
//# sourceMappingURL=runtime-settings.js.map