/**
 * Narrow typed surface the Desktop shell exposes to the Renderer.
 *
 * P0 shape: an in-process semantic adapter that mirrors `ClientTransport`
 * method-for-method. There is deliberately no generic `invoke(channel,
 * payload)` escape hatch — every capability is a named, typed method, so the
 * Renderer can never address an arbitrary channel. The P1 Electron Main
 * implementation behind this interface must keep the same method set; IPC
 * channel names never appear in this package.
 *
 * The contract carries only public facts — opaque identities, epochs,
 * versions and pre-redacted text (FRONTEND_INTEGRATION.md §8). It never
 * contains Bridge tokens, private endpoints, PIDs, process handles or
 * session/workspace paths.
 */
export {};
//# sourceMappingURL=desktop-api.js.map