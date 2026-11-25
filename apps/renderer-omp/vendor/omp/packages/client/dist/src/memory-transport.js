/**
 * In-process semantic transport for tests and P0 fixtures (P0 transports are
 * in-process by design). Implements the exact ClientTransport contract:
 * deterministic bootstrap/query/command handlers, `emit(event)` for tests,
 * value cloning where safe, closed-state enforcement and exact subscription
 * scope filtering.
 */
import { toClientError } from "./errors.js";
import { eventMatchesScope } from "./scope.js";
/** Deep-clone plain contract values so callers never share mutable objects. */
function clonePlain(value) {
    if (value === null || typeof value !== "object") {
        return value;
    }
    return JSON.parse(JSON.stringify(value));
}
function unavailable(label) {
    return { code: "UNAVAILABLE", message: `no handler registered for ${label}` };
}
export class MemoryClientTransport {
    handlers;
    closed = false;
    subscribers = [];
    constructor(handlers = {}) {
        this.handlers = handlers;
    }
    async bootstrap() {
        this.assertOpen();
        return clonePlain(await this.invoke(() => this.handlers.bootstrap?.(), "bootstrap"));
    }
    async query(request) {
        this.assertOpen();
        return clonePlain(await this.invoke(() => this.handlers.query?.(request), `query ${request.queryName}`));
    }
    async command(request) {
        this.assertOpen();
        return clonePlain(await this.invoke(() => this.handlers.command?.(request), `command ${request.commandName}`));
    }
    subscribe(scope, listener) {
        if (this.closed) {
            return () => { };
        }
        const subscriber = { scope, listener };
        this.subscribers.push(subscriber);
        return () => {
            const index = this.subscribers.indexOf(subscriber);
            if (index >= 0) {
                this.subscribers.splice(index, 1);
            }
        };
    }
    /** Deliver a host-side event to matching subscribers (tests only). */
    emit(event) {
        if (this.closed) {
            return;
        }
        const payload = clonePlain(event);
        for (const { scope, listener } of this.subscribers) {
            if (eventMatchesScope(payload, scope)) {
                listener(payload);
            }
        }
    }
    async close() {
        if (this.closed) {
            return;
        }
        this.closed = true;
        this.subscribers.length = 0;
    }
    assertOpen() {
        if (this.closed) {
            throw { code: "TRANSPORT_ERROR", message: "transport is closed" };
        }
    }
    async invoke(handler, label) {
        let result;
        try {
            result = handler();
        }
        catch (error) {
            throw toClientError(error);
        }
        if (result === undefined) {
            throw unavailable(label);
        }
        try {
            return await result;
        }
        catch (error) {
            throw toClientError(error);
        }
    }
}
//# sourceMappingURL=memory-transport.js.map