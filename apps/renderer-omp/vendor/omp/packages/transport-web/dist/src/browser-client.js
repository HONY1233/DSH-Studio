/** Browser-side ClientTransport over the loopback HTTP/WebSocket adapter. */
export class BrowserWebClientTransport {
    #ready;
    #options;
    #base;
    #fetch;
    #wsFactory;
    #csrf;
    #closed = false;
    #closing;
    #sockets = new Set();
    constructor(options) {
        this.#options = options;
        this.#base = options.baseUrl.replace(/\/$/, "");
        this.#fetch = options.fetcher ?? globalThis.fetch.bind(globalThis);
        if (options.webSocketFactory)
            this.#wsFactory = options.webSocketFactory;
    }
    async pair(code) { const r = await this.#fetch(this.#base + '/api/v1/pair', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) }); if (!r.ok)
        throw new Error('pair_failed'); const b = await r.json(); if (typeof b.csrf !== 'string')
        throw new Error('pair_failed'); this.#csrf = b.csrf; }
    async restoreSession() {
        const { csrf, ...session } = await this.req("/api/v1/session", "GET");
        this.#csrf = csrf;
        return session;
    }
    async openContext(scope) {
        const result = await this.req('/api/v1/context/open', 'POST', scope);
        const client = new BrowserWebClientTransport({ ...this.#options, contextId: result.contextId });
        if (this.#csrf !== undefined)
            client.#csrf = this.#csrf;
        return client;
    }
    async bootstrap() {
        await this.#ready;
        return this.req('/api/v1/bootstrap', 'GET');
    }
    async query(request) { return this.req('/api/v1/query', 'POST', request); }
    async command(request) { return this.req('/api/v1/command', 'POST', request); }
    subscribe(scope, listener) {
        if (this.#closed)
            throw new Error("transport_closed");
        if (!this.#wsFactory)
            throw new Error("websocket_unavailable");
        const query = this.#options.contextId ? "?contextId=" + encodeURIComponent(this.#options.contextId) : "";
        const socket = this.#wsFactory(this.#base.replace(/^http/, "ws") + "/api/v1/events" + query);
        this.#sockets.add(socket);
        let onReady = () => { };
        let onFailure = () => { };
        const timeout = this.#options.mobile ? setTimeout(() => socket.close(), 8_000) : undefined;
        if (this.#options.mobile) {
            this.#ready = new Promise((resolve, reject) => { onReady = resolve; onFailure = reject; });
            void this.#ready.catch(() => { });
        }
        else {
            socket.onopen = () => socket.send(JSON.stringify({ scope }));
        }
        socket.onmessage = ({ data }) => {
            try {
                const frame = JSON.parse(data);
                if (frame.kind === "mobile.ready") {
                    clearTimeout(timeout);
                    onReady();
                }
                else
                    listener(frame);
            }
            catch { }
        };
        socket.onclose = () => {
            clearTimeout(timeout);
            onFailure(new Error("event_stream_closed"));
            if (this.#sockets.delete(socket))
                this.#options.mobile?.onDisconnect();
        };
        return () => { this.#sockets.delete(socket); socket.close(); };
    }
    close() {
        if (this.#closing)
            return this.#closing;
        this.#closing = this.#options.contextId
            ? this.req('/api/v1/context/close', 'POST', {}).then(() => { })
            : Promise.resolve();
        this.#closed = true;
        for (const socket of this.#sockets) {
            this.#sockets.delete(socket);
            socket.close();
        }
        return this.#closing;
    }
    async req(path, method, body) { if (this.#closed)
        throw new Error('transport_closed'); const headers = {}; if (this.#options.contextId)
        headers["X-Studio-Context"] = this.#options.contextId; const init = { method, credentials: 'include', headers }; if (body !== undefined) {
        headers['content-type'] = 'application/json';
        headers['X-Studio-CSRF'] = this.#csrf ?? '';
        init.body = JSON.stringify(body);
    } const r = await this.#fetch(this.#base + path, init); if (!r.ok)
        throw new Error(`http_${r.status}`); return r.json(); }
}
//# sourceMappingURL=browser-client.js.map