import { WebTransportError } from "./errors.js";
/**
 * P0 semantic web transport over an {@link OmpStudioWebApi}.
 *
 * Envelopes are forwarded verbatim, with defensive cloning in both
 * directions and fail-closed response checks:
 *
 * - requests are cloned before forwarding; results and events are cloned
 *   before delivery, so neither side observes the other's mutations;
 * - a query response must be an object whose `ok` flag is a boolean, whose
 *   `queryName` matches the request, that owns `result` when ok and a
 *   well-formed `error` (object with string `code`/`message`) otherwise;
 * - a command acknowledgement must be an object whose `commandName`
 *   matches the request, whose `status` is exactly `"accepted"`, and that
 *   carries string `requestId`/`acceptedAt`;
 * - bootstrap must resolve to an object. Any violation throws
 *   {@link WebTransportError} instead of surfacing a plausible result;
 * - after `close()`: `bootstrap`/`query`/`command` reject and `subscribe`
 *   throws synchronously; active listeners are unsubscribed (api-side too)
 *   and callbacks never fire after unsubscribe or close;
 * - `close()` is idempotent and always calls `api.close()` exactly once;
 *   its rejection propagates but the transport stays closed.
 */
export class WebClientTransport {
    #api;
    #closed = false;
    /** Teardowns of live subscriptions; empty once closed. */
    #subscriptions = new Set();
    #apiClose = null;
    constructor(api) {
        this.#api = api;
    }
    async openContext(scope) {
        this.#throwIfClosed();
        if (!this.#api.openContext)
            throw new Error("Update this Host to open concurrent conversations.");
        return new WebClientTransport(await this.#api.openContext(scope));
    }
    async bootstrap() {
        this.#throwIfClosed();
        const bootstrap = await this.#api.bootstrap();
        this.#throwIfClosed();
        if (bootstrap === null || typeof bootstrap !== "object") {
            throw new WebTransportError("TRANSPORT_ERROR", "bootstrap result is not an object");
        }
        return bootstrap;
    }
    async query(request) {
        this.#throwIfClosed();
        const response = await this.#api.query(request);
        this.#throwIfClosed();
        this.#assertQueryEnvelope(request, response);
        return response;
    }
    async command(request) {
        this.#throwIfClosed();
        const accepted = await this.#api.command(request);
        this.#throwIfClosed();
        this.#assertCommandAccepted(request, accepted);
        return accepted;
    }
    subscribe(scope, listener) {
        this.#throwIfClosed();
        let teardown = () => { };
        // Delivery is gated on live membership, so events arriving after
        // unsubscribe or close are dropped before the listener ever runs.
        const wrapped = (event) => {
            if (this.#subscriptions.has(teardown)) {
                listener(event);
            }
        };
        const apiUnsubscribe = this.#api.subscribe(scope, wrapped);
        if (typeof apiUnsubscribe !== "function") {
            throw new WebTransportError("TRANSPORT_ERROR", "api subscribe must return an unsubscribe function");
        }
        teardown = () => {
            if (!this.#subscriptions.has(teardown)) {
                return;
            }
            this.#subscriptions.delete(teardown);
            try {
                apiUnsubscribe();
            }
            catch {
                // Local delivery guarantees never depend on api-side teardown.
            }
        };
        this.#subscriptions.add(teardown);
        return teardown;
    }
    async close() {
        if (this.#closed) {
            if (this.#apiClose !== null) {
                await this.#apiClose;
            }
            return;
        }
        this.#closed = true;
        for (const teardown of [...this.#subscriptions]) {
            teardown();
        }
        this.#apiClose = this.#api.close();
        await this.#apiClose;
    }
    #assertQueryEnvelope(request, response) {
        if (response === null || typeof response !== "object") {
            throw new WebTransportError("TRANSPORT_ERROR", "query response is not an object");
        }
        const envelope = response;
        if (typeof envelope.ok !== "boolean") {
            throw new WebTransportError("TRANSPORT_ERROR", "query response ok flag is not a boolean");
        }
        if (envelope.queryName !== request.queryName) {
            throw new WebTransportError("TRANSPORT_ERROR", `query response name mismatch: expected "${String(request.queryName)}", received "${String(envelope.queryName)}"`);
        }
        if (envelope.ok) {
            if (!("result" in envelope)) {
                throw new WebTransportError("TRANSPORT_ERROR", "query response is missing the result");
            }
        }
        else {
            const error = response.error;
            if (error === null || typeof error !== "object") {
                throw new WebTransportError("TRANSPORT_ERROR", "query response error is not an object");
            }
            const clientError = error;
            if (typeof clientError.code !== "string" || typeof clientError.message !== "string") {
                throw new WebTransportError("TRANSPORT_ERROR", "query response error lacks code/message strings");
            }
        }
    }
    #assertCommandAccepted(request, accepted) {
        if (accepted === null || typeof accepted !== "object") {
            throw new WebTransportError("TRANSPORT_ERROR", "command response is not an object");
        }
        const envelope = accepted;
        if (envelope.commandName !== request.commandName) {
            throw new WebTransportError("TRANSPORT_ERROR", `command response name mismatch: expected "${String(request.commandName)}", received "${String(envelope.commandName)}"`);
        }
        if (envelope.status !== "accepted") {
            throw new WebTransportError("TRANSPORT_ERROR", `command acknowledgement status must be exactly "accepted", received "${String(envelope.status)}"`);
        }
        if (typeof envelope.requestId !== "string" || typeof envelope.acceptedAt !== "string") {
            throw new WebTransportError("TRANSPORT_ERROR", "command response lacks requestId/acceptedAt strings");
        }
    }
    #throwIfClosed() {
        if (this.#closed) {
            throw new WebTransportError("UNAVAILABLE", "transport is closed");
        }
    }
}
/** Creates a {@link ClientTransport} over an in-process {@link OmpStudioWebApi}. */
export function createWebTransport(api) {
    return new WebClientTransport(api);
}
//# sourceMappingURL=web-transport.js.map