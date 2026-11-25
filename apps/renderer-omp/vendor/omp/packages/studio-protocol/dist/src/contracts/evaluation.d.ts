import type { AgentId, Generation, JobId } from "./ids.js";
/** Bounded to fit the Bridge frame budget, including base64 expansion. */
export declare const EVALUATION_LIMITS: {
    readonly TEXT_MAX_CHARS: number;
    readonly PATH_MAX_CHARS: 4096;
    readonly ID_MAX_CHARS: 512;
    readonly DEFINITION_MAX_CHARS: 256;
    readonly TIMEOUT_MAX_MS: 120000;
    readonly IMAGE_MAX_BYTES: number;
    readonly IMAGE_MAX_EDGE: 8192;
    readonly IMAGE_MAX_PIXELS: number;
    readonly SCHEMA_MAX_BYTES: number;
    readonly SCHEMA_MAX_DEPTH: 16;
};
export type EvaluationTarget = {
    url?: string;
    tabId?: string;
    elementHandle?: string;
};
export type EvaluationImageMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp";
export interface EvaluationResult {
    value?: unknown;
    screenshotData?: string;
    mimeType?: EvaluationImageMime;
    title?: string;
}
export interface TerminalImageResult {
    encoding: "base64";
    data: string;
    mimeType: EvaluationImageMime;
    width?: number;
    height?: number;
    source: "kitty" | "sixel";
}
export interface VideoFrameResult {
    attachmentId: string;
    timestampMs: number;
    data: string;
    mimeType: EvaluationImageMime;
    width?: number;
    height?: number;
}
type EvalJobRead = {
    jobId: JobId;
    expectedGeneration?: Generation;
};
export type EvaluationOperation = {
    kind: "browser.evaluate";
    expression: string;
    target?: EvaluationTarget;
    timeoutMs?: number;
} | {
    kind: "computer.evaluate";
    action: string;
    target?: EvaluationTarget;
    timeoutMs?: number;
}
/** Runtime-readable path, including attachment:// references, rather than image bytes. */
 | {
    kind: "image.read";
    image: string;
    question: string;
} | {
    kind: "terminal.image";
    result: TerminalImageResult;
} | {
    kind: "video.metadata";
    attachmentId: string;
} | {
    kind: "video.frame";
    attachmentId: string;
    timestampMs: number;
} | {
    kind: "eval.agent.start";
    definition: string;
    assignment: string;
    async?: boolean;
} | ({
    kind: "eval.agent.status";
} & EvalJobRead) | ({
    kind: "eval.agent.wait";
    timeoutMs?: number;
} & EvalJobRead) | {
    kind: "eval.agent.cancel";
    jobId: JobId;
    expectedGeneration: Generation;
} | {
    kind: "eval.completion.start";
    prompt: string;
    model?: "smol" | "default" | "slow";
    system?: string;
    schema?: Record<string, unknown>;
} | ({
    kind: "eval.completion.status";
} & EvalJobRead) | ({
    kind: "eval.completion.wait";
    timeoutMs?: number;
} & EvalJobRead) | {
    kind: "eval.completion.cancel";
    jobId: JobId;
    expectedGeneration: Generation;
} | {
    kind: "eval.workpool.status";
    name: string;
    ownerAgentId?: AgentId;
};
export {};
//# sourceMappingURL=evaluation.d.ts.map