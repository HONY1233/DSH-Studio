import { type BtwErrorCode, type BtwSnapshot, type BtwStatus } from "./contracts/btw.js";
/**
 * Structural parse for the `btw.changed` payload. The Runtime already keeps
 * this snapshot path-free, so this is a contract boundary check rather than a
 * sanitizer: an unknown field or an out-of-range status is a protocol bug and
 * must fail the frame instead of reaching the Renderer as `unknown`.
 */
export declare function parseBtwSnapshot(value: unknown, path?: string): BtwSnapshot;
export declare function isBtwStatus(value: unknown): value is BtwStatus;
export declare function isBtwErrorCode(value: unknown): value is BtwErrorCode;
//# sourceMappingURL=btw-validation.d.ts.map