import { restoreWindowGeometry } from '@dsh-studio/workbench-core'

export const NATIVE_WINDOW_STORAGE_FORMAT = 'dsh-native-windows'
export const NATIVE_WINDOW_STORAGE_VERSION = 1
const MAX_WINDOWS = 128

export function normalizeNativeRect(rect) {
  if (!rect || typeof rect !== 'object') return null
  const values = [rect.x, rect.y, rect.width ?? rect.w, rect.height ?? rect.h]
  if (!values.every((value) => typeof value === 'number' && Number.isFinite(value))) return null
  const [x, y, width, height] = values
  if (width < 1 || height < 1 || width > 16_384 || height > 16_384) return null
  if (Math.abs(x) > 32_768 || Math.abs(y) > 32_768) return null
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}

export function normalizeDisplaysForNative(displays) {
  if (!Array.isArray(displays) || displays.length === 0) throw new Error('no displays available')
  return displays.map((display) => ({
    id: String(display.id),
    workArea: {
      x: display.workArea.x,
      y: display.workArea.y,
      w: display.workArea.width,
      h: display.workArea.height,
    },
    scaleFactor: display.scaleFactor,
  }))
}

export function restoreNativeGeometry(saved, displays) {
  const normalized = normalizeDisplaysForNative(displays)
  const rect = normalizeNativeRect(saved)
  const restored = restoreWindowGeometry(
    rect ? { ...rect, w: rect.width, h: rect.height, displayId: saved?.displayId ?? null } : { x: NaN, y: 0, w: 800, h: 600 },
    normalized,
  )
  return { x: restored.rect.x, y: restored.rect.y, width: restored.rect.w, height: restored.rect.h, displayId: restored.displayId }
}

export function normalizeNativeWindowState(value) {
  if (!value || typeof value !== 'object') return null
  if (typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.id)) return null
  const normalizedGeometry = normalizeNativeRect(value.geometry)
  if (!normalizedGeometry || typeof value.geometry.displayId !== 'string' || !value.geometry.displayId) return null
  const geometry = { ...normalizedGeometry, displayId: value.geometry.displayId }
  if (typeof value.title !== 'string' || value.title.length > 256) return null
  if (![value.maximized, value.minimized, value.topmost].every((flag) => typeof flag === 'boolean')) return null
  const attachedTo = value.attachedTo ?? null
  if (attachedTo !== null && attachedTo !== 'main' && typeof attachedTo !== 'string') return null
  return {
    id: value.id,
    title: value.title,
    geometry,
    maximized: value.maximized,
    minimized: value.minimized,
    topmost: value.topmost,
    attachedTo,
  }
}

export function decodeNativeWindowState(raw) {
  if (raw === null || raw === undefined) return []
  let parsed
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    throw new Error('Native window state is corrupt; refusing to overwrite it')
  }
  if (parsed?.format !== NATIVE_WINDOW_STORAGE_FORMAT || parsed?.version !== NATIVE_WINDOW_STORAGE_VERSION || !Array.isArray(parsed.windows)) {
    throw new Error('Unsupported native window state; refusing to overwrite it')
  }
  if (parsed.windows.length > MAX_WINDOWS) throw new Error('Too many persisted native windows')
  const ids = new Set()
  return parsed.windows.map((item) => {
    const state = normalizeNativeWindowState(item)
    if (!state || ids.has(state.id) || (state.attachedTo !== null && state.attachedTo !== 'main' && state.attachedTo === state.id)) {
      throw new Error('Invalid persisted native window state')
    }
    ids.add(state.id)
    return state
  })
}

export function encodeNativeWindowState(windows, now = new Date().toISOString()) {
  return JSON.stringify({ format: NATIVE_WINDOW_STORAGE_FORMAT, version: NATIVE_WINDOW_STORAGE_VERSION, savedAt: now, windows })
}
