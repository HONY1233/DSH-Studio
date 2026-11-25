/**
 * Shared error coercion for the client and the in-process transport.
 * Only the safe public `ClientError` shape ever crosses these boundaries.
 */
import type { ClientError } from "@omp-studio/client-contract";
/** Thrown by any client/transport call made after close. */
export declare const CLIENT_CLOSED_ERROR: ClientError;
/** Coerce an arbitrary rejection into the typed public error shape. */
export declare function toClientError(error: unknown): ClientError;
//# sourceMappingURL=errors.d.ts.map