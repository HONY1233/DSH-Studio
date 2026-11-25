/**
 * Command lifecycle, event envelope and subscription scope.
 *
 * Mutation lifecycle (FRONTEND_INTEGRATION.md §8.2):
 *
 *   local_pending -> accepted -> interaction_required (optional)
 *     -> completed | failed | rejected | outcome_unknown
 *
 * `accepted` only means "request taken"; terminal receipts carry the final
 * outcome. Events carry authority/runtime epoch, state version and a
 * monotonic cursor so the reducer can ignore stale epochs, detect gaps and
 * resync (FRONTEND_INTEGRATION.md §8.3).
 */
export {};
//# sourceMappingURL=lifecycle.js.map