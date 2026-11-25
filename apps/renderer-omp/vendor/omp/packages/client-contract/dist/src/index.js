/**
 * @omp-studio/client-contract
 *
 * Authoritative P0 product client contract (FRONTEND_INTEGRATION.md §§8, 11,
 * 13 P0). Transport-neutral: the same `StudioClient` surface is implemented
 * by Desktop IPC and local Web adapters, and by in-process semantic adapters
 * during P0.
 *
 * The contract carries only public facts — opaque identities, epochs,
 * versions and pre-redacted text. It never contains Bridge tokens, private
 * endpoints, PIDs, process handles or session/workspace paths.
 */
/** Version of this client contract; bumped on incompatible contract changes. */
export const CLIENT_CONTRACT_VERSION = 2;
export { isSystemFilePath } from "./files.js";
export { MODEL_KINDS, BUILTIN_MODEL_ROLES, parseModelKind, modelAcceptsRole } from "./model-kinds.js";
// Session thinking selectors are protocol facts; re-exported so transport
// adapters can validate them without depending on studio-protocol directly.
export { SESSION_THINKING_LEVELS, SESSION_THINKING_SELECTORS } from "@omp-studio/studio-protocol";
// Runtime settings are a closed public whitelist; re-export the protocol
// facts so transports and Host adapters cannot fall back to arbitrary keys.
export { STUDIO_RUNTIME_CODE_MODES, STUDIO_RUNTIME_COMPACTION_METHODS, STUDIO_RUNTIME_SETTING_KEYS, STUDIO_RUNTIME_UNEXPECTED_STOP_MODELS, STUDIO_RUNTIME_UNEXPECTED_STOP_MODES, } from "@omp-studio/studio-protocol";
export * from "./ids.js";
export * from "./read-models.js";
export * from "./operations.js";
export * from "./lifecycle.js";
export * from "./model-thinking.js";
export * from "./model-pricing.js";
export * from "./provider-yaml-draft.js";
export * from "./conversation.js";
export * from "./git.js";
export * from "./model-adaptation.js";
export * from "./github.js";
export * from "./time-travel.js";
//# sourceMappingURL=index.js.map