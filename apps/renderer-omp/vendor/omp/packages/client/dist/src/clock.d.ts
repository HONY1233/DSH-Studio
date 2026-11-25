/**
 * Time and identifier generation for the platform-neutral client.
 *
 * Browser-safe by design: the default implementation uses
 * `globalThis.crypto.randomUUID()` and `Date`, with no Node or Electron
 * imports anywhere in this package's `src`. Tests inject a deterministic
 * implementation.
 */
import type { CommandRequestId, IdempotencyKey } from "@omp-studio/client-contract";
export interface ClientClockAndIds {
    /** Current time as an ISO-8601 string. */
    now(): string;
    /** Fresh opaque request id for a submitted command. */
    newRequestId(): CommandRequestId;
    /** Fresh idempotency key when the caller did not supply one. */
    newIdempotencyKey(): IdempotencyKey;
}
export declare function createBrowserClockAndIds(): ClientClockAndIds;
//# sourceMappingURL=clock.d.ts.map