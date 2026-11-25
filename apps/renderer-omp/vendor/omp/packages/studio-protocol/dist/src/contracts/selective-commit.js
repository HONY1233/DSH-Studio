export const SELECTIVE_COMMIT_QUERY_KINDS = [
    "commit.draft.prepare", "commit.draft.read", "commit.draft.preview", "commit.draft.release",
];
export const SELECTIVE_COMMIT_COMMAND_KINDS = ["commit.draft.select", "commit.draft.execute"];
export const SELECTIVE_COMMIT_OPERATION_KINDS = [...SELECTIVE_COMMIT_QUERY_KINDS, ...SELECTIVE_COMMIT_COMMAND_KINDS];
export function isSelectiveCommitKind(kind) {
    return SELECTIVE_COMMIT_OPERATION_KINDS.includes(kind);
}
//# sourceMappingURL=selective-commit.js.map