import { SEARCH_CREDENTIAL_KINDS } from "./search-credentials.js";
import { SELECTIVE_COMMIT_COMMAND_KINDS } from "./selective-commit.js";
import { PROMPT_HISTORY_COMMAND_KINDS } from "./prompt-history.js";
import { EXTENSION_LINK_KINDS } from "./extension-links.js";
import { WEBMCP_KINDS } from "./webmcp.js";
import { EVALUATION_WORKSPACE_KINDS } from "./evaluation-workspace.js";
import { ADVISOR_CONFIG_KINDS } from "./advisor-config.js";
import { LOCAL_RESOURCE_KINDS } from "./local-resources.js";
import { DICTATION_KINDS } from "./dictation.js";
import { NATIVE_PLAN_REVIEW_KINDS } from "./plan-review.js";
import { SESSION_WORKTREE_KINDS } from "./session-worktrees.js";
import { SESSION_COMPRESSION_KINDS } from "./session-compression.js";
import { SESSION_PORTABILITY_KINDS } from "./session-portability.js";
import { FEATURE_SETTINGS_KINDS, FEATURE_SETTINGS_READ_KINDS } from "./feature-settings.js";
import { SESSION_TITLES_KINDS } from "./session-titles.js";
import { PREDICTION_KINDS } from "./prediction-channel.js";
import { MAINTENANCE_OPERATION_KINDS, MAINTENANCE_READ_KINDS } from "./maintenance.js";
import { ARCHIVE_OPERATION_KINDS } from "./archive.js";
import { AGENT_MODEL_KINDS } from "./agent-model.js";
import { SESSION_RESTORE_KINDS } from "./session-restore.js";
import { RUNTIME_QUEUE_KINDS } from "./runtime-queue.js";
import { NATIVE_PREFERENCE_KINDS } from "./native-preferences.js";
import { RATCHET_OPERATION_KINDS } from "./ratchet.js";
import { COMPUTER_WORKSPACE_COMMAND_KINDS } from "./computer-workspace.js";
import { COMPUTER_OBSERVATION_KINDS } from "./computer-observation.js";
import { BROWSER_OBSERVATION_KINDS } from "./browser-observation.js";
import { DISASSEMBLER_KINDS } from "./disassembler.js";
import { SESSION_OPTIONS_KINDS } from "./session-options.js";
import { SESSION_GUI_KINDS, SESSION_GUI_READ_KINDS } from "./session-gui.js";
import { SKILLSHARE_OPERATION_KINDS } from "./skillshare.js";
import { LIVE_AUDIO_OPERATION_KINDS } from "./live-audio.js";
import { MEDIA_OPERATION_KINDS } from "./media.js";
import { BENCHMARK_OPERATION_KINDS } from "./benchmarks.js";
import { RUNTIME_CATALOG_OPERATION_KINDS } from "./runtime-catalog.js";
import { JUDGMENT_OPERATION_KINDS } from "./judgments.js";
import { RUNTIME_FEATURE_KINDS, RUNTIME_FEATURE_READ_KINDS } from "./runtime-features.js";
import { ANNOTATION_OPERATION_KINDS } from "./annotations.js";
import {} from "./accounts.js";
export const WORKBENCH_OPERATION_KINDS = [
    ...SELECTIVE_COMMIT_COMMAND_KINDS, ...PROMPT_HISTORY_COMMAND_KINDS,
    ...SEARCH_CREDENTIAL_KINDS,
    ...EXTENSION_LINK_KINDS, ...WEBMCP_KINDS,
    ...EVALUATION_WORKSPACE_KINDS, ...ADVISOR_CONFIG_KINDS, ...LOCAL_RESOURCE_KINDS, ...DICTATION_KINDS, ...SESSION_GUI_KINDS,
    ...SESSION_TITLES_KINDS,
    ...PREDICTION_KINDS,
    ...MAINTENANCE_OPERATION_KINDS,
    ...ARCHIVE_OPERATION_KINDS,
    ...AGENT_MODEL_KINDS,
    ...SESSION_RESTORE_KINDS,
    ...RUNTIME_QUEUE_KINDS,
    ...NATIVE_PREFERENCE_KINDS, ...FEATURE_SETTINGS_KINDS, ...SESSION_PORTABILITY_KINDS, ...SESSION_COMPRESSION_KINDS, ...SESSION_WORKTREE_KINDS, ...NATIVE_PLAN_REVIEW_KINDS,
    ...RATCHET_OPERATION_KINDS,
    ...COMPUTER_OBSERVATION_KINDS,
    ...COMPUTER_WORKSPACE_COMMAND_KINDS,
    ...BROWSER_OBSERVATION_KINDS,
    ...DISASSEMBLER_KINDS,
    ...SESSION_OPTIONS_KINDS, ...SKILLSHARE_OPERATION_KINDS, ...LIVE_AUDIO_OPERATION_KINDS, ...MEDIA_OPERATION_KINDS, ...BENCHMARK_OPERATION_KINDS, ...RUNTIME_CATALOG_OPERATION_KINDS, ...JUDGMENT_OPERATION_KINDS, ...ANNOTATION_OPERATION_KINDS, ...RUNTIME_FEATURE_KINDS, "accounts.status", "accounts.status.details", "accounts.logout", "services.list", "services.start", "services.stop", "services.restart", "services.mode.set", "services.send", "services.logs", "tokens.count", "runtime.models.list", "runtime.models.describe"
];
export const WORKBENCH_READ_KINDS = [
    "search.credentials.list",
    "evaluation.runtime.plan", "evaluation.runtime.read", "evaluation.runtime.rows", "evaluation.runtime.report", "evaluation.runtime.patch", "evaluation.runtime.control", ...SESSION_GUI_READ_KINDS,
    "dictation.inspect",
    "prediction.status", "prediction.prepare", "prediction.release",
    ...MAINTENANCE_READ_KINDS,
    ...ARCHIVE_OPERATION_KINDS,
    "agent.model.inspect",
    "session.restore.inspect",
    "session.queue.get", "session.compaction.enqueue", "session.compaction.cancel", "session.compaction.status",
    "preferences.native.get", ...FEATURE_SETTINGS_READ_KINDS, "session.portability.status", "maintenance.compression.status", "worktrees.session.list", "worktrees.session.startPolicy", "worktrees.session.resume.list", "mode.plan.review.details",
    "ratchet.list", "ratchet.read", "ratchet.stop",
    "computer.status", "computer.capture", "computer.stop", "computer.observe.release",
    "browser.tabs.get", "browser.observe.prepare", "browser.managed.prepare",
    "disassembler.status", "disassembler.metadata.read", "disassembler.query", "disassembler.edit.prepare", "disassembler.cancel",
    "session.speed.get", "session.budget.get", "session.warming.get", "models.presets.list", "skillshare.status", "skillshare.home", "skillshare.search", "skillshare.package", "skillshare.installed", "skillshare.tokens", "skillshare.action", "live.audio.status", "live.audio.mute", "live.audio.release", "media.models", "media.list", "media.read", "benchmarks.accounts.read", "benchmarks.list", "benchmarks.read", ...RUNTIME_CATALOG_OPERATION_KINDS, "judgments.list", "judgments.read", ...ANNOTATION_OPERATION_KINDS, ...RUNTIME_FEATURE_READ_KINDS, "accounts.status", "accounts.status.details", "services.list", "services.logs", "tokens.count", "runtime.models.list", "runtime.models.describe"
];
export function isWorkbenchOperationKind(value) {
    return WORKBENCH_OPERATION_KINDS.includes(value);
}
function record(value, keys) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Expected a workbench object");
    const row = value;
    if (Object.keys(row).some(key => !keys.includes(key)))
        throw new Error("Unknown workbench field");
    return row;
}
function text(value, max = 512, empty = false) {
    if (typeof value !== "string" || (!empty && !value.trim()) || value.includes("\0") || value.length > max)
        throw new Error("Invalid workbench text");
}
function integer(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
        throw new Error("Invalid workbench number");
}
function mode(value) { if (!["session", "persist", "detached"].includes(value))
    throw new Error("Invalid service mode"); }
export function validateServiceSpec(value) {
    const spec = record(value, ["name", "command", "cwd", "env", "pty", "ready", "restart", "mode"]);
    text(spec.name, 48);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/u.test(spec.name))
        throw new Error("Invalid service name");
    text(spec.command, 32768);
    if (spec.cwd !== undefined) {
        text(spec.cwd, 4096);
        if (/^(?:[A-Za-z]:|[\\/])/u.test(spec.cwd) || spec.cwd.split(/[\\/]/u).includes(".."))
            throw new Error("Service cwd must be workspace-relative");
    }
    if (spec.env !== undefined) {
        if (!spec.env || typeof spec.env !== "object" || Array.isArray(spec.env) || Object.keys(spec.env).length > 128)
            throw new Error("Invalid service environment");
        for (const [key, value] of Object.entries(spec.env)) {
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) || ["__proto__", "constructor", "prototype"].includes(key))
                throw new Error("Invalid environment name");
            text(value, 4096, true);
        }
    }
    if (spec.pty !== undefined && typeof spec.pty !== "boolean")
        throw new Error("Invalid service PTY option");
    if (spec.ready !== undefined) {
        const ready = record(spec.ready, ["log", "port", "host", "timeoutMs"]);
        if (ready.log === undefined && ready.port === undefined)
            throw new Error("A readiness condition is required");
        if (ready.log !== undefined) {
            text(ready.log, 1024);
            new RegExp(ready.log, "u");
        }
        if (ready.port !== undefined)
            integer(ready.port, 1, 65535);
        if (ready.host !== undefined)
            text(ready.host, 253);
        integer(ready.timeoutMs, 50, 3_600_000);
    }
    if (spec.restart !== undefined && !["no", "on-failure", "always"].includes(spec.restart))
        throw new Error("Invalid restart policy");
    if (spec.mode !== undefined)
        mode(spec.mode);
}
//# sourceMappingURL=workbench.js.map