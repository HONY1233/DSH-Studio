import type { ModelProviderModelInput } from "./operations.js";
import type { ModelAuthType, ModelCatalogEntry, ModelOverridePatch } from "./read-models.js";
export type YamlNode = {
    [key: string]: unknown;
};
/** The subset of the provider editor draft the YAML node is derived from. */
export interface ProviderYamlDraft {
    id: string;
    name: string;
    website: string;
    note: string;
    api: string;
    endpointUrl: string;
    local: boolean;
    authType: string;
    apiKey: string;
    envName: string;
    command: string;
    discoveryType: string;
    advertisedReasoning?: boolean;
    discoveryTimeoutMs?: number | undefined;
    headersText: string;
    disableStrictTools: boolean;
    transport: "" | "pi-native";
    remoteCompactionEnabled: boolean;
    remoteCompactionEndpoint: string;
    remoteCompactionModel: string;
    models: ReadonlyArray<ModelCatalogEntry>;
    modelOverrides: Readonly<Record<string, ModelOverridePatch>>;
}
export declare function mapApiAlias(api: string | undefined): string;
/** The provider's node already in `models.yml`, or `undefined` for a new one. */
export declare function nestedProviderYamlNode(value: unknown): Record<string, unknown> | undefined;
export declare function envNameForProviderId(id: string): string;
export declare function providerModelYamlNode(model: ModelCatalogEntry | ModelProviderModelInput, previous: Record<string, unknown> | undefined): Record<string, unknown>;
/** One `modelOverrides:` row, sparse like the Host writer. */
export declare function providerOverrideYamlNode(override: ModelOverridePatch, previous: Record<string, unknown> | undefined): Record<string, unknown>;
/**
 * Derive the `providers.<id>` node the save would write.
 *
 * `previous` is the node currently in `models.yml` (or `undefined` for a new
 * provider) and is treated as immutable — it is only read and shallow-copied.
 * Fields the form does not own are carried over untouched. `storedAuth` is the
 * provider's loaded auth type; see `apiKeyFromDraft`.
 */
export declare function draftProviderYamlNode(draft: ProviderYamlDraft, previous: Record<string, unknown> | undefined, storedAuth?: ModelAuthType | string): YamlNode;
//# sourceMappingURL=provider-yaml-draft.d.ts.map