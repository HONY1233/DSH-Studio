const MAX_EXTERNAL_URL_LENGTH = 8192;
const EXPLICIT_HTTP_URL = /^https?:\/\/[^/?#]+/iu;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/iu;
const UNSAFE_EXTENSION_SCHEMES = new Set(["javascript", "vbscript", "livescript", "mocha", "data", "file", "about", "blob", "http", "https", "mailto"]);

function cleanUrlText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text || text.length > MAX_EXTERNAL_URL_LENGTH) return null;
  // URL parsers silently remove some controls and interpret backslashes as
  // slashes. Reject the original spelling so the displayed and opened values
  // cannot diverge.
  if (/[\s\u0000-\u001f\u007f\\]/u.test(text)) return null;
  return text;
}

function parseHttpUrl(text: string): string | null {
  if (!EXPLICIT_HTTP_URL.test(text)) return null;
  try {
    const url = new URL(text);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Strict external browser URL. Bare hosts are intentionally not inferred. */
export function normalizeExternalUrl(raw: unknown): string | null {
  const text = cleanUrlText(raw);
  return text === null ? null : parseHttpUrl(text);
}

/** Address-bar style input may omit the scheme; every other URL stays explicit. */
export function normalizeExternalBrowserUrl(raw: unknown): string | null {
  const text = cleanUrlText(raw);
  if (text === null) return null;
  if (/^https?:\/\//iu.test(text)) return parseHttpUrl(text);
  if (/^https?:/iu.test(text)) return null;
  if (URL_SCHEME.test(text)) {
    const colon = text.indexOf(":");
    if (!/^\d+(?:[/?#]|$)/u.test(text.slice(colon + 1))) return null;
  }
  return parseHttpUrl(`https://${text}`);
}

export function normalizeMailtoUrl(raw: unknown): string | null {
  const text = cleanUrlText(raw);
  if (text === null || text.length > 2048 || !/^mailto:/iu.test(text)) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "mailto:" || !url.pathname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Structurally safe extension URI. Registration is checked by the caller;
 * script/data/local-document schemes are never eligible for extension routing.
 */
export function normalizeExtensionUrl(raw: unknown): string | null {
  const text = cleanUrlText(raw);
  if (text === null) return null;
  const match = /^([a-z][a-z0-9+.-]*):/iu.exec(text);
  if (!match || UNSAFE_EXTENSION_SCHEMES.has(match[1].toLowerCase())) return null;
  try {
    const url = new URL(text);
    return url.protocol === `${match[1].toLowerCase()}:` ? url.href : null;
  } catch {
    return null;
  }
}
