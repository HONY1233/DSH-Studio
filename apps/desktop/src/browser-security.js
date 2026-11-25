import { randomUUID } from 'node:crypto'

const MAX_URL_LENGTH = 8192
const MAX_BOUNDS_EXTENT = 16_384
const MAX_BOUNDS_OFFSET = 32_768
const WORKSPACE_ID = /^[A-Za-z0-9_-]{1,128}$/

function parsedUrl(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_URL_LENGTH) return null
  // URL parsing strips some ASCII controls; reject them before parsing so a
  // visually different value cannot become a trusted URL.
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

export function normalizeBrowserUrl(raw) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) return { ok: false, reason: 'EMPTY_URL' }
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`
  const url = parsedUrl(candidate)
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    return { ok: false, reason: 'UNSUPPORTED_URL_SCHEME' }
  }
  if (!url.hostname || url.username || url.password) {
    return { ok: false, reason: 'INVALID_URL_AUTHORITY' }
  }
  return { ok: true, url: url.href }
}

/** Strict system-browser target. Bare hosts and all non-HTTP(S)/mailto schemes fail closed. */
export function normalizeExternalSystemUrl(raw) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text || text.length > MAX_URL_LENGTH || /[\s\u0000-\u001f\u007f\\]/u.test(text)) return null
  if (text.length > 2048 && /^mailto:/iu.test(text)) return null
  try {
    const url = new URL(text)
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname && !url.username && !url.password) {
      return url.href
    }
    if (url.protocol === 'mailto:' && url.pathname && !url.username && !url.password) return url.href
  } catch {
    // Malformed URLs are not eligible for the operating-system handler.
  }
  return null
}

/**
 * Renderer popups never become Electron windows. A strict HTTP(S)/mailto target
 * is handed to the OS browser; everything else is silently denied.
 */
export function createExternalUrlHandler(openExternal, onError = () => {}) {
  return ({ url } = {}) => {
    const safeUrl = normalizeExternalSystemUrl(url)
    if (safeUrl !== null) {
      void Promise.resolve().then(() => openExternal(safeUrl)).catch(onError)
    }
    return { action: 'deny' }
  }
}

export function createExternalUrlIpcHandler(requireSender, openExternal) {
  return (event, payload) => {
    requireSender(event)
    const url = normalizeExternalSystemUrl(payload?.url)
    if (url === null) {
      const error = new Error('External URL is not allowed')
      error.code = 'INVALID_EXTERNAL_URL'
      throw error
    }
    return openExternal(url)
  }
}

function isLoopbackHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

export function resolveTrustedRendererUrl(configured, distHref, { allowDevelopmentFallback = true } = {}) {
  const value = configured ?? (distHref || (allowDevelopmentFallback ? 'http://127.0.0.1:5173' : null))
  if (typeof value !== 'string' || !value) {
    throw new Error('Packaged renderer entry is missing; refusing the development server fallback')
  }
  const url = parsedUrl(value)
  if (!url || url.username || url.password || url.hash) {
    throw new Error('DSH_RENDERER_URL must be an exact trusted renderer entry')
  }
  if (url.protocol === 'file:') {
    if (!distHref || url.href !== distHref) throw new Error('Untrusted file renderer entry')
  } else if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Unsupported renderer URL scheme')
  } else if (!isLoopbackHost(url.hostname)) {
    throw new Error('DSH_RENDERER_URL must point to a loopback development server')
  }
  return url.href
}

export function isTrustedRendererUrl(candidate, expected) {
  const actual = parsedUrl(candidate)
  const trusted = parsedUrl(expected)
  if (!actual || !trusted) return false
  // Hash routing is renderer-local. Every other component, including query,
  // path, port and file name, must remain identical to the boot entry.
  actual.hash = ''
  trusted.hash = ''
  return actual.href === trusted.href
}

export function readNavigationDetails(eventOrDetails, legacyUrl, legacyIsMainFrame) {
  if (eventOrDetails && typeof eventOrDetails.url === 'string') {
    return {
      event: eventOrDetails,
      url: eventOrDetails.url,
      isMainFrame: eventOrDetails.isMainFrame === true,
    }
  }
  return { event: eventOrDetails, url: legacyUrl, isMainFrame: legacyIsMainFrame === true }
}

export function isAllowedFrameNavigation(candidate, currentUrl, isMainFrame) {
  const next = parsedUrl(candidate)
  if (!next) return false
  if (isMainFrame) return (next.protocol === 'http:' || next.protocol === 'https:') && Boolean(next.hostname)
  if (next.protocol === 'about:' && (next.pathname === 'blank' || next.href === 'about:blank')) return true
  const current = parsedUrl(currentUrl)
  return Boolean(
    current
    && (current.protocol === 'http:' || current.protocol === 'https:')
    && (next.protocol === 'http:' || next.protocol === 'https:')
    && next.origin === current.origin,
  )
}

export function browserPartitionForWorkspace(workspaceId, persistent = false) {
  if (typeof workspaceId !== 'string' || !WORKSPACE_ID.test(workspaceId)) {
    throw new Error('Invalid opaque workspace ID')
  }
  return `${persistent ? 'persist:' : ''}dsh-workspace-${workspaceId}`
}

export function createEphemeralBrowserPartition() {
  return browserPartitionForWorkspace(randomUUID(), false)
}

export function normalizeBrowserBounds(rect) {
  if (!rect || typeof rect !== 'object') return null
  const { x, y, width, height } = rect
  if (![x, y, width, height].every(value => typeof value === 'number' && Number.isFinite(value))) return null
  if (width <= 0 || height <= 0 || width > MAX_BOUNDS_EXTENT || height > MAX_BOUNDS_EXTENT) return null
  if (Math.abs(x) > MAX_BOUNDS_OFFSET || Math.abs(y) > MAX_BOUNDS_OFFSET) return null
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}

export function createPermissionGuards() {
  return {
    check: () => false,
    request: (_contents, _permission, callback) => callback(false),
  }
}

export function shouldBlockDevToolsInput(input, devToolsEnabled) {
  if (devToolsEnabled || !input) return false
  const key = String(input.key ?? '').toLowerCase()
  if (input.type !== 'keyDown' && input.type !== 'keyUp') return false
  if (key === 'f12') return true
  return key === 'i' && Boolean(input.control || input.meta) && Boolean(input.shift)
}

export function createMainIpcGuard(isMainSender) {
  return function requireMainSender(event) {
    if (!isMainSender(event)) {
      const error = new Error('Privileged IPC requires the trusted main renderer frame')
      error.code = 'PERMISSION_DENIED'
      throw error
    }
  }
}
