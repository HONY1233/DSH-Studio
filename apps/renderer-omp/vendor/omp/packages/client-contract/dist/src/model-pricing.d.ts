import type { ModelCostMeta, ModelPricingMeta } from "./read-models.js";
export declare function parseModelPricing(value: unknown): ModelPricingMeta | undefined;
export declare function resolveModelPrice(base: ModelCostMeta | undefined, pricing: ModelPricingMeta | undefined, timestamp?: number, promptInputTokens?: number): {
    cost: ModelCostMeta | undefined;
    period?: "peak" | "off-peak";
    longContext: boolean;
};
//# sourceMappingURL=model-pricing.d.ts.map