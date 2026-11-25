/**
 * Role-selector thinking levels (`modelRoles` suffix) and how they interact
 * with a model's catalog capability surface.
 *
 * `auto` is session-only and is never a `provider/model:auto` suffix.
 */
export declare const ROLE_THINKING_LEVELS: readonly ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
export type RoleThinkingLevel = (typeof ROLE_THINKING_LEVELS)[number];
/** Efforts a custom/override model may advertise in `models.yml` `thinking.efforts`. */
export declare const MODEL_CONFIG_THINKING_EFFORTS: readonly ["minimal", "low", "medium", "high", "xhigh", "max"];
export type ModelConfigThinkingEffort = (typeof MODEL_CONFIG_THINKING_EFFORTS)[number];
export declare const MODEL_THINKING_MODES: readonly ["effort", "budget", "google-level", "anthropic-adaptive", "anthropic-budget-effort"];
export interface ModelThinkingConfig {
    readonly unverified?: boolean;
    readonly mode: (typeof MODEL_THINKING_MODES)[number];
    readonly efforts: readonly ModelConfigThinkingEffort[];
    readonly defaultLevel?: ModelConfigThinkingEffort;
    readonly effortMap?: Readonly<Partial<Record<ModelConfigThinkingEffort, string>>>;
    readonly supportsDisplay?: boolean;
    readonly requiresEffort?: boolean;
}
/** Project a native/cache/YAML object onto the subset models.yml accepts. */
export declare function parseModelThinkingConfig(value: unknown): ModelThinkingConfig | undefined;
/** Shared by the YAML preview and Host writer. Undefined preserves; null clears. */
export declare function modelThinkingYamlNode(config: ModelThinkingConfig | null | undefined, legacyEfforts: readonly string[] | undefined, previous: Record<string, unknown> | undefined): Record<string, unknown> | undefined;
export interface RoleThinkingModel {
    readonly reasoning: boolean;
    readonly thinking?: ReadonlyArray<string>;
    readonly thinkingConfig?: ModelThinkingConfig | null;
}
export interface RoleThinkingControl {
    readonly ids: ReadonlyArray<RoleThinkingLevel>;
    readonly disabled: boolean;
}
/**
 * Extract user-facing effort ids from an OMP catalog `thinking` field.
 * Catalog stores `{ efforts: string[] }`; a string array is accepted as a
 * fallback. Unknown ids are dropped.
 */
export declare function parseCacheThinkingEfforts(value: unknown): string[];
/**
 * Parse `models.yml` `thinking` / `thinking.efforts` for the model editor.
 * Drops unknown ids (and ignores 'off' which is a role/session control level, not a model effort).
 */
export declare function parseModelThinkingEfforts(value: unknown): ModelConfigThinkingEffort[];
/**
 * Options for the role thinking control:
 * - unknown model: full ladder, enabled
 * - `reasoning: false`: Off only, disabled
 * - reasoning but no controllable efforts: full ladder, enabled (write as-is)
 * - has efforts: Off + that ladder
 */
export declare function roleThinkingControl(model: RoleThinkingModel | undefined): RoleThinkingControl;
/**
 * Snap a requested role thinking suffix onto the model's legal ladder.
 * Off stays Off. Models without a controllable surface keep the request as-is.
 * Unsupported efforts select the nearest tier; ties select the higher tier.
 */
export declare function clampRoleThinking(thinking: string | undefined, model: RoleThinkingModel | undefined): string | undefined;
/** Only model selection adopts a default; merely reading a role never rewrites it. */
export declare function thinkingForRoleModel(thinking: string | undefined, model: RoleThinkingModel | undefined): string | undefined;
//# sourceMappingURL=model-thinking.d.ts.map