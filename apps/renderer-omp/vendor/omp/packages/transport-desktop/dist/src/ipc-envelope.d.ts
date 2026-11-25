/**
 * Envelope parsing for the Desktop IPC boundary.
 *
 * Main only checks the envelope shape here and copies the known fields, so
 * extra fields (window ids, authority) never reach the Host. Per-command
 * input checks live in the Host facade and the services that run them.
 */
import type { ClientCommandRequest, ClientQueryRequest, SubscriptionScope } from "@omp-studio/client-contract";
/** Thrown when an IPC payload is not a well-formed envelope. */
export declare class ValidationError extends Error {
    constructor(message: string);
}
/** True for plain objects with an `Object.prototype` or null prototype. */
export declare function isPlainObject(value: unknown): value is Record<string, unknown>;
export declare function parseClientQueryRequest(value: unknown): ClientQueryRequest;
export declare function parseClientCommandRequest(value: unknown): ClientCommandRequest;
export declare function parseSubscriptionScope(value: unknown): SubscriptionScope;
//# sourceMappingURL=ipc-envelope.d.ts.map