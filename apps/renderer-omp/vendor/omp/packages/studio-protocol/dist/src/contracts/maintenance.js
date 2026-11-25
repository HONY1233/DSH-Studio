export const MAINTENANCE_OPERATION_KINDS = [
    "maintenance.compression.auto.status",
    "maintenance.gc.preview",
    "maintenance.gc.apply",
    "maintenance.gc.status",
    "maintenance.session.export",
    "maintenance.export.status",
    "maintenance.connection.check",
];
export const MAINTENANCE_READ_KINDS = [
    "maintenance.gc.preview",
    "maintenance.gc.status",
    "maintenance.export.status",
    "maintenance.connection.check",
];
export function isMaintenanceKind(kind) {
    return MAINTENANCE_OPERATION_KINDS.includes(kind);
}
//# sourceMappingURL=maintenance.js.map