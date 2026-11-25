/** OMP 18.3.0 catalog kinds. Older cached rows without a kind remain chat. */
export declare const MODEL_KINDS: readonly ["chat", "tiny", "image", "tts", "stt", "search", "judge", "embedding", "rerank", "video"];
export type ModelKind = typeof MODEL_KINDS[number];
export declare function parseModelKind(value: unknown): ModelKind | undefined;
export declare const BUILTIN_MODEL_ROLES: readonly [{
    readonly id: "default";
    readonly name: "Default";
    readonly desc: "默认主模型";
}, {
    readonly id: "smol";
    readonly name: "Fast";
    readonly desc: "快速、低成本任务";
}, {
    readonly id: "slow";
    readonly name: "Thinking";
    readonly desc: "复杂推理任务";
}, {
    readonly id: "vision";
    readonly name: "Vision";
    readonly desc: "视觉与图片理解";
}, {
    readonly id: "plan";
    readonly name: "Architect";
    readonly desc: "规划和架构任务";
}, {
    readonly id: "commit";
    readonly name: "Commit";
    readonly desc: "Commit 相关任务";
}, {
    readonly id: "tiny";
    readonly name: "Tiny";
    readonly desc: "标题等轻量后台任务";
}, {
    readonly id: "memory";
    readonly name: "Memory";
    readonly desc: "记忆整理与总结";
}, {
    readonly id: "task";
    readonly name: "Subtask";
    readonly desc: "通用子任务";
}, {
    readonly id: "advisor";
    readonly name: "Advisor";
    readonly desc: "第二模型审查";
}, {
    readonly id: "image";
    readonly name: "Image";
    readonly desc: "图片生成";
}, {
    readonly id: "web";
    readonly name: "Web";
    readonly desc: "联网搜索";
}, {
    readonly id: "speech";
    readonly name: "Speech";
    readonly desc: "语音合成";
}, {
    readonly id: "dictation";
    readonly name: "Dictation";
    readonly desc: "录音与音频转写";
}, {
    readonly id: "judge";
    readonly name: "Judge";
    readonly desc: "结构化判断与批量评估";
}, {
    readonly id: "widget";
    readonly name: "Job widgets";
    readonly desc: "后台任务实时小组件（未设置时用 Fast）";
}];
/** Mirrors native roleCandidatePool; model capabilities are facts, not guesses from names. */
export declare function modelAcceptsRole(role: string, model: {
    readonly kind?: ModelKind;
    readonly webSearch?: string;
}): boolean;
//# sourceMappingURL=model-kinds.d.ts.map