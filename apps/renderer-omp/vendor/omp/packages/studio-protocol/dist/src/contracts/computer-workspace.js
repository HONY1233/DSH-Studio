export const COMPUTER_WORKSPACE_QUERY_KINDS = ["computer.workspace.get", "computer.activity.list", "computer.frame.get", "computer.structure.get"];
export const COMPUTER_WORKSPACE_COMMAND_KINDS = ["computer.observe.open", "computer.observe.close", "computer.frame.capture", "computer.control.stop", "computer.control.continue"];
export const COMPUTER_WORKSPACE_KINDS = [...COMPUTER_WORKSPACE_QUERY_KINDS, ...COMPUTER_WORKSPACE_COMMAND_KINDS];
export function isComputerWorkspaceQuery(kind) {
    return COMPUTER_WORKSPACE_QUERY_KINDS.includes(kind);
}
export function isComputerWorkspaceCommand(kind) {
    return COMPUTER_WORKSPACE_COMMAND_KINDS.includes(kind);
}
export function isComputerWorkspaceKind(kind) {
    return COMPUTER_WORKSPACE_KINDS.includes(kind);
}
//# sourceMappingURL=computer-workspace.js.map