import { type SearchCredentialsOperation, type SearchCredentialsResultMap } from "./search-credentials.js";
import { type SelectiveCommitOperation, type SelectiveCommitCommandInputMap, type SelectiveCommitCommandResultMap } from "./selective-commit.js";
import { type PromptHistoryCommandOperation, type PromptHistoryCommandResultMap } from "./prompt-history.js";
import { type ExtensionLinkOperation, type ExtensionLinkResultMap } from "./extension-links.js";
import { type WebMcpOperation, type WebMcpResultMap } from "./webmcp.js";
import { type EvaluationWorkspaceOperation, type EvaluationWorkspaceResultMap } from "./evaluation-workspace.js";
import { type AdvisorConfigOperation, type AdvisorConfigResultMap } from "./advisor-config.js";
import { type LocalResourceOperation, type LocalResourceResultMap } from "./local-resources.js";
import { type DictationOperation, type DictationResultMap } from "./dictation.js";
import { type NativePlanReviewOperation, type NativePlanReviewResultMap } from "./plan-review.js";
import { type SessionWorktreeOperation, type SessionWorktreeResultMap } from "./session-worktrees.js";
import { type SessionCompressionOperation, type SessionCompressionResultMap } from "./session-compression.js";
import { type SessionPortabilityOperation, type SessionPortabilityResultMap } from "./session-portability.js";
import { type FeatureSettingsOperation, type FeatureSettingsResultMap } from "./feature-settings.js";
import { type SessionTitlesOperation, type SessionTitlesResultMap } from "./session-titles.js";
import { type PredictionChannelOperation, type PredictionResultMap } from "./prediction-channel.js";
import { type MaintenanceOperation, type MaintenanceResultMap } from "./maintenance.js";
import { type ArchiveOperation, type ArchiveResultMap } from "./archive.js";
import { type AgentModelOperation, type AgentModelResultMap } from "./agent-model.js";
import { type SessionRestoreOperation, type SessionRestoreResultMap } from "./session-restore.js";
import { type RuntimeQueueOperation, type RuntimeQueueResultMap } from "./runtime-queue.js";
import { type NativePreferenceOperation, type NativePreferenceResultMap } from "./native-preferences.js";
import { type RatchetOperation, type RatchetResultMap } from "./ratchet.js";
import { type ComputerWorkspaceCommand, type ComputerWorkspaceResultMap } from "./computer-workspace.js";
import { type ComputerObservationOperation, type ComputerObservationResultMap } from "./computer-observation.js";
import { type BrowserObservationOperation, type BrowserObservationResultMap } from "./browser-observation.js";
import { type DisassemblerOperation, type DisassemblerResultMap } from "./disassembler.js";
import { type SessionOptionsOperation, type SessionOptionsResultMap } from "./session-options.js";
import { type SessionGuiOperation, type SessionGuiResultMap } from "./session-gui.js";
import { type SkillshareOperation, type SkillshareResultMap } from "./skillshare.js";
import { type LiveAudioOperation, type LiveAudioResultMap } from "./live-audio.js";
import { type MediaOperation, type MediaResultMap } from "./media.js";
import { type BenchmarkOperation, type BenchmarkResultMap } from "./benchmarks.js";
import { type RuntimeCatalogOperation, type RuntimeCatalogResultMap } from "./runtime-catalog.js";
import { type JudgmentOperation, type JudgmentResultMap } from "./judgments.js";
import { type RuntimeFeatureOperation, type RuntimeFeatureResultMap } from "./runtime-features.js";
import { type AnnotationOperation, type AnnotationResultMap } from "./annotations.js";
import { type AccountStatusResult } from "./accounts.js";
/** Shared, presentation-neutral tools added with OMP 18.3.0. */
export interface StudioServiceSpec {
    name: string;
    command: string;
    cwd?: string | undefined;
    env?: Record<string, string> | undefined;
    pty?: boolean | undefined;
    ready?: {
        log?: string | undefined;
        port?: number | undefined;
        host?: string | undefined;
        timeoutMs: number;
    } | undefined;
    restart?: "no" | "on-failure" | "always" | undefined;
    mode?: "session" | "persist" | "detached" | undefined;
}
export interface StudioServiceRow {
    name: string;
    scope?: "session" | "project" | "global";
    manageable?: boolean;
    instanceId: string;
    state: "starting" | "running" | "ready" | "restarting" | "stopping" | "exited" | "failed";
    startedAt: number;
    readyAt?: number;
    exitedAt?: number;
    exitCode?: number;
    restartCount: number;
    outputBytes: number;
    /** Agent-declared canonical HTTP(S) preview URL, when this is a web service. */
    previewUrl?: string;
    pid?: number;
    /** Raw native owner: normally a session ID, or a legacy agent ID. */
    ownerId?: string;
    /** Compatibility alias for ownerId; not necessarily an agent ID. */
    ownerAgentId?: string;
    mode: "session" | "persist" | "detached";
}
export interface RuntimeModelChoice {
    snapcompactShape?: {
        variant: string;
        frameSize?: number;
    };
    serviceTiers?: string[];
    promptCache?: {
        short?: number;
        long?: number;
    };
    promptCacheConfig?: {
        short?: number;
        long?: number;
    };
    compatibility?: {
        supportsMessageThreads?: boolean;
        toolNamePrefix?: string;
        statefulResponses?: boolean;
        preferWebsockets?: boolean;
        useResponsesLite?: boolean;
        toolMode?: "code_mode_only";
    };
    selector: string;
    name: string;
    provider: string;
    kind: string;
    image: boolean;
    reasoning: boolean;
    contextWindow?: number;
    maxTokens?: number;
    webSearch?: string;
}
export interface TokenCountResult {
    bytes: number;
    chars: number;
    lines: number;
    encodings: Array<{
        encoding: string;
        tokens: number;
    }>;
}
export type WorkbenchOperation = Extract<SelectiveCommitOperation, {
    kind: keyof SelectiveCommitCommandInputMap;
}> | PromptHistoryCommandOperation | SearchCredentialsOperation | ExtensionLinkOperation | WebMcpOperation | EvaluationWorkspaceOperation | AdvisorConfigOperation | LocalResourceOperation | DictationOperation | SessionTitlesOperation | PredictionChannelOperation | MaintenanceOperation | ArchiveOperation | AgentModelOperation | SessionRestoreOperation | RuntimeQueueOperation | NativePreferenceOperation | FeatureSettingsOperation | SessionPortabilityOperation | SessionCompressionOperation | SessionWorktreeOperation | NativePlanReviewOperation | RatchetOperation | ComputerObservationOperation | ComputerWorkspaceCommand | BrowserObservationOperation | DisassemblerOperation | SessionOptionsOperation | SessionGuiOperation | SkillshareOperation | LiveAudioOperation | MediaOperation | BenchmarkOperation | RuntimeCatalogOperation | JudgmentOperation | AnnotationOperation | RuntimeFeatureOperation | {
    kind: "accounts.logout";
    sessionId: string;
    accountId: string;
} | {
    kind: "accounts.status";
    refresh?: boolean;
} | {
    kind: "accounts.status.details";
    refresh?: boolean;
} | {
    kind: "services.list";
} | {
    kind: "services.start";
    spec: StudioServiceSpec;
} | {
    kind: "services.stop";
    name: string;
    instanceId: string;
} | {
    kind: "services.restart";
    name: string;
    instanceId: string;
} | {
    kind: "services.mode.set";
    name: string;
    instanceId: string;
    mode: "session" | "persist" | "detached";
} | {
    kind: "services.send";
    name: string;
    instanceId: string;
    text: string;
} | {
    kind: "services.logs";
    name: string;
    instanceId: string;
    cursor?: number;
    lines?: number;
} | {
    kind: "tokens.count";
    text: string;
} | {
    kind: "runtime.models.describe";
    selector: string;
} | {
    kind: "runtime.models.list";
    modelKind?: string;
    cursor?: string;
    limit?: number;
};
export interface WorkbenchResultMap extends SelectiveCommitCommandResultMap, PromptHistoryCommandResultMap, SearchCredentialsResultMap, ExtensionLinkResultMap, WebMcpResultMap, EvaluationWorkspaceResultMap, AdvisorConfigResultMap, LocalResourceResultMap, DictationResultMap, SessionGuiResultMap, SessionTitlesResultMap, PredictionResultMap, MaintenanceResultMap, ArchiveResultMap, AgentModelResultMap, SessionRestoreResultMap, RuntimeQueueResultMap, NativePreferenceResultMap, FeatureSettingsResultMap, SessionPortabilityResultMap, SessionCompressionResultMap, SessionWorktreeResultMap, NativePlanReviewResultMap, RatchetResultMap, ComputerObservationResultMap, Pick<ComputerWorkspaceResultMap, ComputerWorkspaceCommand["kind"]>, BrowserObservationResultMap, DisassemblerResultMap, SessionOptionsResultMap, SkillshareResultMap, LiveAudioResultMap, AnnotationResultMap, JudgmentResultMap, RuntimeCatalogResultMap, BenchmarkResultMap, MediaResultMap, RuntimeFeatureResultMap {
    "accounts.status": AccountStatusResult;
    "accounts.status.details": AccountStatusResult;
    "accounts.logout": {
        loggedOut: true;
    };
    "services.list": {
        enabled: boolean;
        services: StudioServiceRow[];
    };
    "services.start": {
        service: StudioServiceRow;
        readyTimedOut: boolean;
    };
    "services.stop": {
        service: StudioServiceRow;
    };
    "services.restart": {
        service: StudioServiceRow;
    };
    "services.mode.set": {
        service: StudioServiceRow;
    };
    "services.send": {
        service: StudioServiceRow;
    };
    "services.logs": {
        instanceId: string;
        text: string;
        cursor: number;
        state: StudioServiceRow["state"];
    };
    "tokens.count": TokenCountResult;
    "runtime.models.describe": {
        model: RuntimeModelChoice;
    };
    "runtime.models.list": {
        models: RuntimeModelChoice[];
        total: number;
        nextCursor?: string;
    };
}
export declare const WORKBENCH_OPERATION_KINDS: readonly ["commit.draft.select", "commit.draft.execute", "history.prompts.delete", "search.credentials.list", "search.credentials.set", "search.credentials.remove", "extensions.links.activate", "browser.webmcp.invoke", "evaluation.runtime.plan", "evaluation.runtime.start", "evaluation.runtime.read", "evaluation.runtime.rows", "evaluation.runtime.control", "evaluation.runtime.report", "evaluation.runtime.patch", "advisors.config.get", "advisors.config.save", "resource.local.list", "resource.local.ensureDir", "resource.local.open", "resource.local.save", "dictation.inspect", "dictation.open", "dictation.status", "dictation.prepare", "dictation.start", "dictation.stop", "dictation.cancel", "resource.read", "agent.btw.read", "agent.btw.ask", "agent.btw.abort", "prediction.control", "session.queue.list", "session.queue.ack", "session.queue.remove", "session.queue.steer", "session.queue.takeback", "session.tier.get", "session.tier.set", "session.skills.list", "session.titles.inspect", "prediction.status", "prediction.configure", "prediction.clearOverride", "prediction.download.cancel", "prediction.prepare", "prediction.release", "maintenance.compression.auto.status", "maintenance.gc.preview", "maintenance.gc.apply", "maintenance.gc.status", "maintenance.session.export", "maintenance.export.status", "maintenance.connection.check", "archive.sessions.list", "archive.recaps.list", "archive.prompts.search", "archive.session.inspect", "agent.model.inspect", "session.restore.inspect", "session.compaction.enqueue", "session.compaction.cancel", "session.compaction.status", "session.queue.get", "session.queue.entry.remove", "session.queue.promote", "session.queue.edit", "session.queue.restore", "preferences.native.get", "preferences.native.set", "preferences.native.clearOverride", "session.compaction.get", "session.compaction.set", "preferences.features.get", "preferences.features.set", "preferences.features.clearOverride", "accounts.pool.options", "accounts.pool.get", "accounts.pool.set", "models.compaction.preview", "models.compaction.set", "session.portability.pack", "session.portability.anonymize", "session.portability.prepare", "session.portability.import", "session.portability.cancel", "session.portability.moved", "session.portability.status", "maintenance.compression.scan", "maintenance.compression.apply", "maintenance.compression.status", "worktrees.session.resume.list", "worktrees.session.resume.prepare", "worktrees.session.list", "worktrees.session.startPolicy", "worktrees.session.continueHere", "worktrees.session.create", "worktrees.session.open", "worktrees.session.remove.prepare", "worktrees.session.remove.apply", "mode.plan.review.details", "mode.plan.review.save", "mode.plan.review.resolve", "ratchet.list", "ratchet.read", "ratchet.create", "ratchet.approve", "ratchet.start", "ratchet.stop", "computer.status", "computer.configure", "computer.capture", "computer.stop", "computer.observe.release", "computer.observe.open", "computer.observe.close", "computer.frame.capture", "computer.control.stop", "computer.control.continue", "browser.tabs.get", "browser.observe.prepare", "browser.managed.prepare", "browser.native.open", "browser.native.close", "disassembler.status", "disassembler.configure", "disassembler.metadata.read", "disassembler.open", "disassembler.close", "disassembler.save", "disassembler.run", "disassembler.cancel", "disassembler.query", "disassembler.edit.prepare", "disassembler.edit.apply", "session.budget.get", "session.budget.set", "session.budget.clearOverride", "session.speed.get", "session.speed.set", "session.warming.get", "session.warming.set", "models.presets.list", "models.presets.save", "models.presets.apply", "models.presets.delete", "skillshare.status", "skillshare.home", "skillshare.search", "skillshare.package", "skillshare.installed", "skillshare.tokens", "skillshare.prepare", "skillshare.execute", "skillshare.action", "skillshare.discard", "live.audio.prepare", "live.audio.start", "live.audio.status", "live.audio.mute", "live.audio.release", "media.models", "media.list", "media.start", "media.read", "media.cancel", "media.resume", "media.close", "benchmarks.accounts.read", "benchmarks.list", "benchmarks.start", "benchmarks.read", "benchmarks.cancel", "benchmarks.close", "templates.list", "templates.get", "templates.prepare", "mcp.runtime.status", "judgments.list", "judgments.create", "judgments.read", "judgments.cancel", "judgments.close", "judgments.retry", "annotations.capture", "annotations.prepare", "agent.spawn.options", "btw.inject", "session.history.rename", "session.history.pin", "session.lease.inspect", "approvals.forget", "jobs.inspect", "mcp.auth.reauth", "mcp.auth.unauth", "mcp.auth.reconnect", "accounts.status", "accounts.status.details", "accounts.logout", "services.list", "services.start", "services.stop", "services.restart", "services.mode.set", "services.send", "services.logs", "tokens.count", "runtime.models.list", "runtime.models.describe"];
export declare const WORKBENCH_READ_KINDS: readonly WorkbenchOperation["kind"][];
export declare function isWorkbenchOperationKind(value: string): value is WorkbenchOperation["kind"];
export declare function validateServiceSpec(value: unknown): asserts value is StudioServiceSpec;
//# sourceMappingURL=workbench.d.ts.map