export const BROWSER_OBSERVATION_KINDS = ["browser.tabs.get", "browser.observe.prepare", "browser.managed.prepare", "browser.native.open", "browser.native.close"];
export function isBrowserObservationKind(kind) { return BROWSER_OBSERVATION_KINDS.includes(kind); }
export const BROWSER_FRAME_MAX_BASE64 = 2_796_204;
export const BROWSER_PRIVATE_MAX_BYTES = 4 * 1024 * 1024;
//# sourceMappingURL=browser-observation.js.map