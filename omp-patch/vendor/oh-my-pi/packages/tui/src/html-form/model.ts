/**
 * Compatibility shim for the fork.
 *
 * Upstream `@oh-my-pi/pi-tui` moved `spansText` into `./parse`; the OMP Studio
 * renderer still imports it from `html-form/model`. Re-export the current
 * implementation so the renderer keeps compiling unchanged.
 */
export { spansText } from "./parse";
export type { FormSpan, FormSpanStyle } from "./parse";
