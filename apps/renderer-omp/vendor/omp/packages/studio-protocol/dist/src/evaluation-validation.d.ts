import { type EvaluationOperation } from "./contracts/evaluation.js";
/** Mirrored by Runtime: no Node, browser, or transport dependencies. */
export declare class EvaluationValidationError extends Error {
    constructor(message: string);
}
export declare function isEvaluationOperationKind(kind: string): kind is EvaluationOperation["kind"];
//# sourceMappingURL=evaluation-validation.d.ts.map