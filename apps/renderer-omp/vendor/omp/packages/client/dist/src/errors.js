/**
 * Shared error coercion for the client and the in-process transport.
 * Only the safe public `ClientError` shape ever crosses these boundaries.
 */
/** Thrown by any client/transport call made after close. */
export const CLIENT_CLOSED_ERROR = Object.freeze({
    code: "TRANSPORT_ERROR",
    message: "transport is closed",
});
/** Coerce an arbitrary rejection into the typed public error shape. */
export function toClientError(error) {
    if (isClientError(error)) {
        return error;
    }
    if (error instanceof Error) {
        return { code: "TRANSPORT_ERROR", message: error.message };
    }
    return { code: "TRANSPORT_ERROR", message: "transport failure" };
}
function isClientError(value) {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const candidate = value;
    return typeof candidate.code === "string" && typeof candidate.message === "string";
}
//# sourceMappingURL=errors.js.map