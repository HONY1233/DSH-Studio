export const EVALUATION_WORKSPACE_KINDS = [
    "evaluation.runtime.plan",
    "evaluation.runtime.start",
    "evaluation.runtime.read",
    "evaluation.runtime.rows",
    "evaluation.runtime.control",
    "evaluation.runtime.report",
    "evaluation.runtime.patch",
];
export const isEvaluationWorkspaceKind = (kind) => EVALUATION_WORKSPACE_KINDS.includes(kind);
export const evaluationTerminal = (state) => ["completed", "partial", "failed", "cancelled", "interrupted"].includes(state);
/** Rendering/export helpers operate on the same recorded values. */
export function evaluationComparable(a, b) {
    const comparable = (spec) => {
        if (spec.kind === "benchmark" || spec.kind === "instruction") {
            const { models: _models, ...settings } = spec;
            return settings;
        }
        if (spec.kind === "judgment") {
            const { judgeModel: _judge, attachId: _attach, attachSessionId: _session, ...settings } = spec;
            return settings;
        }
        const { flow: _flow, assist: _assist, objective: _objective, ...settings } = spec;
        return settings;
    };
    return (a.spec.kind === b.spec.kind &&
        a.runtimeVersion === b.runtimeVersion &&
        canonicalEvaluationConfig(a.plan?.settings) === canonicalEvaluationConfig(b.plan?.settings) &&
        canonicalEvaluationConfig(comparable(a.spec)) === canonicalEvaluationConfig(comparable(b.spec)));
}
export function canonicalEvaluationConfig(value) {
    if (Array.isArray(value))
        return "[" + value.map(canonicalEvaluationConfig).join(",") + "]";
    if (value && typeof value === "object")
        return ("{" +
            Object.entries(value)
                .filter(([, v]) => v !== undefined)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([k, v]) => JSON.stringify(k) + ":" + canonicalEvaluationConfig(v))
                .join(",") +
            "}");
    return JSON.stringify(value) ?? "null";
}
//# sourceMappingURL=evaluation-workspace.js.map