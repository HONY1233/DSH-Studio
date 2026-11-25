export const MODEL_SERVICES_QUERY_KINDS = ["models.available.read", "models.available.release", "models.antigravity.readiness", "models.systemTemplates.list", "models.systemTemplates.inspect", "models.systemTemplates.file.read", "models.auth.providers.read"];
export const MODEL_SERVICES_COMMAND_KINDS = ["models.available.refresh", "models.systemTemplates.binding.set", "models.systemTemplates.file.write", "models.auth.login", "models.auth.cancel", "models.auth.key.set", "models.auth.key.remove", "models.auth.unpause", "models.provider.roster.refresh", "models.accounts.resetPolicy.set"];
export function isModelServicesQueryKind(kind) {
    return MODEL_SERVICES_QUERY_KINDS.includes(kind);
}
export function isModelServicesKind(kind) {
    return isModelServicesQueryKind(kind) || MODEL_SERVICES_COMMAND_KINDS.includes(kind);
}
//# sourceMappingURL=model-services.js.map