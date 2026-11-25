/**
 * Platform-neutral StudioClient implementation over an injected
 * ClientTransport (FRONTEND_INTEGRATION.md §8).
 *
 * The client keeps its own reducer state fed by bootstrap and the event
 * stream so it can enforce §8.3 rules without asking the Renderer:
 * resync gating of sensitive mutations, terminal/no-regression bookkeeping,
 * and transport failures recorded as failed command states. Renderer
 * listeners receive only events accepted by the reducer, filtered exactly by
 * their subscription scope.
 *
 * Renderer injection is `StudioClient` only; this class adds two
 * client-side conveniences (`getState` / `onState`) that are not part of
 * the shared contract.
 */
import { CLIENT_CONTRACT_VERSION } from "@omp-studio/client-contract";
import { createBrowserClockAndIds } from "./clock.js";
import { CLIENT_CLOSED_ERROR, toClientError } from "./errors.js";
import { createInitialClientState, reduceClientState } from "./reducer.js";
import { eventMatchesScope } from "./scope.js";
export class StudioClientImpl {
    transport;
    ids;
    state;
    closed = false;
    transportUnsubscribe = null;
    bootstrapPromise = null;
    bootstrapping = false;
    transportGeneration = 0;
    bufferedEvents = [];
    listeners = [];
    stateListeners = [];
    constructor(transport, ids = createBrowserClockAndIds()) {
        this.transport = transport;
        this.ids = ids;
        this.state = createInitialClientState();
    }
    /** Current reducer state (client-side convenience; not in StudioClient). */
    getState() {
        return this.state;
    }
    async openContext(scope) {
        this.assertOpen();
        if (!this.transport.openContext)
            throw new Error("This Host needs an update to open concurrent conversations.");
        return new StudioClientImpl(await this.transport.openContext(scope));
    }
    get supportsContexts() { return this.transport.supportsContexts ?? this.transport.openContext !== undefined; }
    async bootstrap() {
        this.assertOpen();
        if (this.bootstrapPromise !== null) {
            return this.bootstrapPromise;
        }
        const generation = this.transportGeneration;
        this.bootstrapping = true;
        this.ensureSubscribed();
        const run = (async () => {
            try {
                const bootstrap = await this.transport.bootstrap();
                if (this.closed || generation !== this.transportGeneration)
                    throw CLIENT_CLOSED_ERROR;
                if (bootstrap.contractVersion !== CLIENT_CONTRACT_VERSION) {
                    throw {
                        code: "UNAVAILABLE",
                        message: `Client contract mismatch: expected ${CLIENT_CONTRACT_VERSION}, received ${String(bootstrap.contractVersion)}`,
                    };
                }
                this.applyAction({ type: "bootstrap.set", bootstrap, occurredAt: this.ids.now() });
                const pending = this.bufferedEvents.splice(0);
                for (const event of pending) {
                    this.applyAction({ type: "event", event });
                }
                return bootstrap;
            }
            catch (error) {
                // Events buffered without a successful snapshot cannot be trusted;
                // discard them so a later retry starts from a clean baseline.
                if (generation === this.transportGeneration) {
                    this.bufferedEvents.length = 0;
                    if (this.state.connection.phase === "initial") {
                        this.transportUnsubscribe?.();
                        this.transportUnsubscribe = null;
                    }
                }
                throw error;
            }
            finally {
                if (generation === this.transportGeneration)
                    this.bootstrapping = false;
            }
        })();
        this.bootstrapPromise = run;
        try {
            return await run;
        }
        finally {
            if (this.bootstrapPromise === run)
                this.bootstrapPromise = null;
        }
    }
    /** Re-acquire a fresh snapshot and resume the event stream after a gap. */
    async resync() {
        return this.bootstrap();
    }
    async query(name, input) {
        this.assertOpen();
        const response = await this.transport.query({ queryName: name, input });
        if (!response.ok) {
            throw response.error;
        }
        return response.result;
    }
    async command(name, input, options) {
        this.assertOpen();
        // Workspace-wide clients can be queried without opening a conversation.
        // Establish the event stream before a command can emit its completion.
        // Concurrent first commands share bootstrap's in-flight initialization.
        if (this.state.connection.phase === "initial")
            await this.bootstrap();
        // The handle is created before the transport acknowledgement is awaited
        // so local_pending exists in reducer state immediately.
        const requestId = this.ids.newRequestId();
        const idempotencyKey = options?.idempotencyKey ?? this.ids.newIdempotencyKey();
        const issuedAt = this.ids.now();
        const handle = {
            requestId,
            commandName: name,
            status: "local_pending",
            idempotencyKey,
            issuedAt,
        };
        // The reducer owns the issue-vs-block decision so the resync policy
        // lives in exactly one place.
        this.applyAction({ type: "command.issue", requestId, commandName: name, idempotencyKey, issuedAt });
        const entry = this.state.commands[requestId];
        if (entry !== undefined && entry.status === "failed") {
            throw entry.error;
        }
        try {
            const accepted = await this.transport.command({ commandName: name, input, idempotencyKey, requestId });
            if (accepted.requestId !== requestId) {
                // The host acknowledged a different request than the one issued:
                // the original was never accepted. Fail the original entry in
                // place — never issue a parallel command.
                throw {
                    code: "TRANSPORT_ERROR",
                    message: `acknowledgement requestId mismatch: expected ${requestId}, received ${accepted.requestId}`,
                };
            }
        }
        catch (error) {
            // The transport rejected the envelope or acknowledged a different
            // request: the command was never accepted under its own requestId.
            // Record a failed state, never accepted.
            const clientError = toClientError(error);
            this.applyAction({ type: "command.transportFailed", requestId, error: clientError, occurredAt: this.ids.now() });
            throw clientError;
        }
        return handle;
    }
    subscribe(scope, listener) {
        if (this.closed) {
            return () => { };
        }
        const subscription = { scope, listener };
        this.listeners.push(subscription);
        return () => {
            const index = this.listeners.indexOf(subscription);
            if (index >= 0) {
                this.listeners.splice(index, 1);
            }
        };
    }
    /**
     * Subscribe to reducer state updates (client-side convenience; not in the
     * shared StudioClient contract). Lets the Renderer keep a single state
     * store that also observes transport failures and resync gating, which
     * have no host-issued event kind.
     */
    onState(listener) {
        this.stateListeners.push(listener);
        return () => {
            const index = this.stateListeners.indexOf(listener);
            if (index >= 0) {
                this.stateListeners.splice(index, 1);
            }
        };
    }
    /** A lost transport is not evidence that an accepted operation failed. */
    transportLost(reason) {
        if (this.closed)
            return;
        this.transportGeneration++;
        this.bootstrapPromise = null;
        this.bootstrapping = false;
        this.bufferedEvents.length = 0;
        this.applyAction({ type: "transport.lost", reason, occurredAt: this.ids.now() });
    }
    async close() {
        if (this.closed) {
            return;
        }
        this.closed = true;
        this.applyAction({ type: "close" });
        this.transportUnsubscribe?.();
        this.transportUnsubscribe = null;
        this.listeners.length = 0;
        this.stateListeners.length = 0;
        await this.transport.close();
    }
    assertOpen() {
        if (this.closed) {
            throw CLIENT_CLOSED_ERROR;
        }
    }
    ensureSubscribed() {
        if (this.transportUnsubscribe === null) {
            this.transportUnsubscribe = this.transport.subscribe({ scope: "all" }, (event) => {
                if (this.bootstrapping) {
                    this.bufferedEvents.push(event);
                    return;
                }
                if (this.state.connection.phase === "initial") {
                    return;
                }
                this.applyAction({ type: "event", event });
            });
        }
    }
    applyAction(action) {
        const previous = this.state;
        const next = reduceClientState(this.state, action);
        if (next !== this.state) {
            this.state = next;
            // Streaming conversation updates and computer frames only advance the
            // transport cursor (unless stateVersion or resyncRequired also changed).
            // Notify the scoped event consumers, not every global shell subscriber.
            const streamProgressOnly = action.type === "event"
                && (action.event.kind === "computer.changed" || action.event.kind === "conversation.changed")
                && next.entities === previous.entities
                && next.commands === previous.commands
                && next.connection.stateVersion === previous.connection.stateVersion
                && next.connection.resyncRequired === previous.connection.resyncRequired;
            if (!streamProgressOnly)
                for (const listener of this.stateListeners) {
                    listener(this.state);
                }
        }
        if (action.type === "event" && this.shouldDeliverEvent(previous, next, action.event)) {
            for (const { scope, listener } of this.listeners) {
                if (eventMatchesScope(action.event, scope)) {
                    listener(action.event);
                }
            }
        }
        if (action.type === "event" &&
            !previous.connection.resyncRequired &&
            next.connection.resyncRequired &&
            !this.bootstrapping &&
            !this.closed) {
            queueMicrotask(() => {
                if (!this.closed && this.state.connection.resyncRequired) {
                    void this.bootstrap().catch(() => {
                        // Keep the reducer in resync_required; a later manual resync can retry.
                    });
                }
            });
        }
    }
    shouldDeliverEvent(previous, next, event) {
        // A stale/duplicate event leaves state unchanged. A gap changes only the
        // resync flag while deliberately dropping the event payload.
        if (next === previous || next.connection.cursor !== event.cursor) {
            return false;
        }
        if (event.kind === "computer.changed") {
            return event.change.sessionId === next.entities.snapshot?.sessionId
                && next.connection.runtime?.status === "connected";
        }
        return true;
    }
}
//# sourceMappingURL=studio-client.js.map