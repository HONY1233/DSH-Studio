import type { ClientError, CommandReceipt, CommandRequestId, CommandState } from "@omp-studio/client-contract";
export type ComposerReceiptView = {
    readonly phase: "unknown";
} | {
    readonly phase: "pending";
} | {
    readonly phase: "accepted";
    readonly acceptedAt: string;
} | {
    readonly phase: "interaction_required";
} | {
    readonly phase: "completed";
    readonly observedAt: string;
} | {
    readonly phase: "failed";
    readonly error: ClientError;
    readonly observedAt: string;
} | {
    readonly phase: "rejected";
    readonly reason: string;
    readonly observedAt: string;
} | {
    readonly phase: "outcome_unknown";
    readonly reason: string;
    readonly observedAt: string;
};
export declare function isComposerTerminal(status: CommandState["status"]): boolean;
/**
 * Composer-facing view of one requestId. `accepted` is never treated as
 * completed. Terminal failed/rejected/outcome_unknown keep the Host reason.
 * The reducer already refuses a second terminal; this selector reads that
 * single terminal fact.
 */
export declare function selectComposerReceipt(commands: Readonly<Record<CommandRequestId, CommandState>>, requestId: CommandRequestId): ComposerReceiptView;
export declare function selectComposerTerminal(commands: Readonly<Record<CommandRequestId, CommandState>>, requestId: CommandRequestId): CommandReceipt | undefined;
//# sourceMappingURL=receipt-selectors.d.ts.map