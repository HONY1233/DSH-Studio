/**
 * @omp-studio/transport-desktop
 *
 * Renderer-side Desktop transport adapter plus the Desktop IPC contract:
 * the fixed channel constants and envelope parsing for Electron Main.
 */
export { createDesktopTransport } from "./desktop-transport.js";
export { DESKTOP_IPC_CHANNELS, DESKTOP_IPC_LIMITS } from "./channels.js";
export { ValidationError, isPlainObject, parseClientQueryRequest, parseClientCommandRequest, parseSubscriptionScope, } from "./ipc-envelope.js";
export { MOBILE_ACCESS_CHANNELS } from "./mobile-access.js";
//# sourceMappingURL=index.js.map