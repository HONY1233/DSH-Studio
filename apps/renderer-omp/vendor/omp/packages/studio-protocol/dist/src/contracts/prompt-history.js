export const PROMPT_HISTORY_QUERY_KINDS = ["history.prompts.list", "history.prompts.read"];
export const PROMPT_HISTORY_COMMAND_KINDS = ["history.prompts.delete"];
export function isPromptHistoryKind(kind) {
    return [...PROMPT_HISTORY_QUERY_KINDS, ...PROMPT_HISTORY_COMMAND_KINDS].includes(kind);
}
//# sourceMappingURL=prompt-history.js.map