/**
 * OMP 18.11–18.12 Runtime features surfaced to Studio: remembered approvals,
 * job inspection and widgets, and MCP re-authorization.
 * Validation stays at shape level; the overlay services enforce semantics.
 */
export const RUNTIME_FEATURE_KINDS = ["agent.spawn.options", "btw.inject", "session.history.rename", "session.history.pin", "session.lease.inspect", "approvals.forget", "jobs.inspect", "mcp.auth.reauth", "mcp.auth.unauth", "mcp.auth.reconnect"];
export const RUNTIME_FEATURE_READ_KINDS = ["agent.spawn.options", "btw.inject", "session.history.rename", "session.history.pin", "session.lease.inspect", "jobs.inspect"];
export function isRuntimeFeatureKind(kind) { return RUNTIME_FEATURE_KINDS.includes(kind); }
//# sourceMappingURL=runtime-features.js.map