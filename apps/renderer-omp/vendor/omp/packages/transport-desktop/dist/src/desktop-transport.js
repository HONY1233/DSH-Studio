/**
 * Renderer-side Desktop transport: forwards typed envelopes between the
 * Renderer and the Desktop shell's `OmpStudioDesktopApi` 1:1. Electron IPC
 * already copies payloads, so nothing is cloned here.
 *
 * `close()` is idempotent and unsubscribes every active listener; no
 * operation is accepted afterwards.
 */
class TransportClosedError extends Error {
    constructor() {
        super("desktop transport is closed");
        this.name = "TransportClosedError";
    }
}
export class DesktopClientTransport {
    api;
    contextId;
    closed = false;
    closePromise = null;
    subscriptions = new Set();
    constructor(api, contextId) {
        this.api = api;
        this.contextId = contextId;
    }
    get supportsContexts() { return this.api.openContext !== undefined; }
    async openContext(scope) {
        this.assertOpen();
        if (!this.api.openContext)
            throw new Error("This Host needs an update to open concurrent conversations.");
        return new DesktopClientTransport(this.api, await this.api.openContext(scope));
    }
    async bootstrap() {
        this.assertOpen();
        return this.api.bootstrap(this.contextId);
    }
    async query(request) {
        this.assertOpen();
        return this.api.query(request, this.contextId);
    }
    async command(request) {
        this.assertOpen();
        return this.api.command(request, this.contextId);
    }
    subscribe(scope, listener) {
        this.assertOpen();
        // `stopApi` is the api-level cancellation: it drops this listener *and*
        // releases the Main-side registration behind it (preload -> `unsubscribe`
        // channel). Without that half, stopping a listener leaked a live Host
        // subscription and kept forwarding events nobody consumed.
        let active = true;
        const stopApi = this.api.subscribe(scope, (event) => {
            if (active)
                listener(event);
        }, this.contextId);
        const unsubscribe = () => {
            if (!active)
                return;
            active = false;
            this.subscriptions.delete(unsubscribe);
            stopApi();
        };
        this.subscriptions.add(unsubscribe);
        return unsubscribe;
    }
    close() {
        if (this.closePromise !== null)
            return this.closePromise;
        this.closed = true;
        const active = [...this.subscriptions];
        this.subscriptions.clear();
        for (const unsubscribe of active)
            unsubscribe();
        this.closePromise = Promise.resolve().then(() => this.api.close(this.contextId));
        return this.closePromise;
    }
    assertOpen() {
        if (this.closed)
            throw new TransportClosedError();
    }
}
/** Create a renderer-side `ClientTransport` bound to a Desktop shell api. */
export function createDesktopTransport(api) {
    return new DesktopClientTransport(api);
}
//# sourceMappingURL=desktop-transport.js.map