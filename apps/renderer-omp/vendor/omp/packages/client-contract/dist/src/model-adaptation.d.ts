import type { ModelThinkingConfig } from "./model-thinking.js";
import type { ModelKind } from "./model-kinds.js";
export interface SnapcompactShape {
    readonly variant: string;
    readonly frameSize?: number;
}
export declare const MODEL_PARAMETER_FIELDS: readonly ["contextWindow", "maxContextWindow", "maxTokens", "reasoning", "thinkingConfig", "snapcompactShape"];
export type ModelParameterField = (typeof MODEL_PARAMETER_FIELDS)[number];
/** Only fields that models.yml can express. Missing means unknown/inherited. */
export interface ModelParameterValues {
    readonly contextWindow?: number;
    readonly maxContextWindow?: number;
    readonly maxTokens?: number;
    readonly reasoning?: boolean;
    readonly thinkingConfig?: ModelThinkingConfig | null;
    readonly snapcompactShape?: SnapcompactShape;
}
export interface ModelParameterOrigin {
    readonly source: "catalog" | "endpoint" | "manual";
    readonly catalogVersion?: string;
    readonly catalogModel?: string;
}
export type ModelParameterSources = Readonly<Partial<Record<ModelParameterField, ModelParameterOrigin>>>;
export interface ModelAdaptationCandidate {
    readonly kind?: ModelKind;
    readonly webSearch?: string;
    readonly key: string;
    readonly provider: string;
    readonly id: string;
    readonly name: string;
    readonly api: string;
    readonly aliases?: readonly string[];
    readonly values: ModelParameterValues;
    /** Native routing/budget data cannot be transplanted to a gateway YAML row. */
    readonly limitation?: string;
}
export interface ModelAdaptationInput {
    readonly providerId: string;
    readonly api: string;
    readonly modelId: string;
    readonly name?: string;
    readonly endpoint?: ModelParameterValues;
    readonly catalogVersion?: string;
}
export interface ModelAdaptationResult {
    readonly catalogVersion: string;
    readonly status: "matched" | "ambiguous" | "none";
    readonly candidates: readonly ModelAdaptationCandidate[];
    readonly values: ModelParameterValues;
    readonly sources: ModelParameterSources;
}
export interface ModelCatalogStatus {
    readonly version: string;
    readonly upstreamCommit: string;
    readonly source: "builtin" | "updated";
}
export interface ModelNativeProviderInfo {
    readonly id: string;
    readonly name: string;
    readonly credentialScoped: boolean;
    readonly authoritative: boolean;
    readonly api?: string;
    readonly endpoint?: string;
    readonly kinds: readonly ModelKind[];
}
export interface ModelCatalogDocument {
    readonly nativeProviders?: readonly ModelNativeProviderInfo[];
    readonly roleDefaults?: Readonly<Record<string, readonly string[]>>;
    readonly schemaVersion: 1;
    readonly version: string;
    readonly upstreamCommit: string;
    readonly entries: readonly ModelAdaptationCandidate[];
}
export interface ModelCatalogRefreshResult {
    readonly updated: boolean;
    readonly catalog: ModelCatalogStatus;
    readonly message: string;
}
/** Merge by presence, including explicit false/null, never by truthiness. */
export declare function mergeModelParameters(recommended: ModelParameterValues, overrides: ModelParameterValues): ModelParameterValues;
export declare function modelParameterValues(value: ModelParameterValues & {
    readonly parameters?: ModelParameterValues;
}): ModelParameterValues;
/** Stable field comparison for provenance, independent of YAML map key order. */
export declare function sameModelParameter(left: unknown, right: unknown): boolean;
//# sourceMappingURL=model-adaptation.d.ts.map