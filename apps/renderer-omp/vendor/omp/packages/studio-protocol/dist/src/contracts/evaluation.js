/** Bounded to fit the Bridge frame budget, including base64 expansion. */
export const EVALUATION_LIMITS = {
    TEXT_MAX_CHARS: 64 * 1024,
    PATH_MAX_CHARS: 4096,
    ID_MAX_CHARS: 512,
    DEFINITION_MAX_CHARS: 256,
    TIMEOUT_MAX_MS: 120_000,
    IMAGE_MAX_BYTES: 256 * 1024,
    IMAGE_MAX_EDGE: 8192,
    IMAGE_MAX_PIXELS: 16 * 1024 * 1024,
    SCHEMA_MAX_BYTES: 32 * 1024,
    SCHEMA_MAX_DEPTH: 16,
};
//# sourceMappingURL=evaluation.js.map