export const UPGRADE_OPERATION_KINDS = [
    "btw.history.list", "btw.history.read", "btw.followUp", "btw.images.resolve", "session.models.mentions",
    "session.import.list", "session.import.preview", "session.import.execute",
    "runtime.auth.get", "runtime.auth.set", "runtime.auth.remove",
];
export function isUpgradeOperationKind(kind) {
    return UPGRADE_OPERATION_KINDS.includes(kind);
}
//# sourceMappingURL=runtime-upgrade.js.map