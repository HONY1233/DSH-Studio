/**
 * Shared window lifecycle reducer (XC-01).
 *
 * Internal floats and native BrowserWindows have different rendering and
 * persistence adapters, but close/minimize/maximize/restore/attachment changes
 * must have identical state semantics. This module only transforms data; it
 * never touches Electron, React, storage, or the DOM.
 */

export const WINDOW_LIFECYCLE_OPS = Object.freeze([
  'put',
  'close',
  'minimize',
  'maximize',
  'restore',
  'setTopmost',
  'attach',
  'detach',
])

/** @typedef {{ readonly id: string, readonly minimized?: boolean, readonly maximized?: boolean, readonly topmost?: boolean, readonly attachedTo?: string | null }} WindowLifecycleState */

/**
 * @typedef {'put' | 'close' | 'minimize' | 'maximize' | 'restore' | 'setTopmost' | 'attach' | 'detach'} WindowLifecycleOpKind
 * @typedef {
 *   | { readonly kind: 'put'; readonly window: WindowLifecycleState }
 *   | { readonly kind: 'close'; readonly id: string }
 *   | { readonly kind: 'minimize'; readonly id: string; readonly x?: number; readonly y?: number }
 *   | { readonly kind: 'maximize'; readonly id: string }
 *   | { readonly kind: 'restore'; readonly id: string }
 *   | { readonly kind: 'setTopmost'; readonly id: string; readonly topmost: boolean }
 *   | { readonly kind: 'attach'; readonly id: string; readonly attachedTo: string }
 *   | { readonly kind: 'detach'; readonly id: string }
 * } WindowLifecycleOp
 */

function validId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
}

function invalid(message) {
  const error = new Error(message)
  error.code = 'INVALID_WINDOW_OPERATION'
  throw error
}

function assertOp(op) {
  if (!op || typeof op !== 'object' || !WINDOW_LIFECYCLE_OPS.includes(op.kind)) {
    invalid('Unknown window lifecycle operation')
  }
  if (op.kind !== 'put' && !validId(op.id)) invalid('Invalid window id')
}

/**
 * Apply one lifecycle operation without mutating the input collection.
 * Unknown ids are a no-op so late OS events are safe; malformed operations
 * and duplicate ids fail closed. Closing a host also detaches its children.
 *
 * @template {WindowLifecycleState} T
 * @param {readonly T[]} windows
 * @param {WindowLifecycleOp} op
 * @returns {T[]}
 */
export function reduceWindowLifecycle(windows, op) {
  if (!Array.isArray(windows)) invalid('Window collection must be an array')
  assertOp(op)
  const ids = new Set()
  for (const window of windows) {
    if (!window || !validId(window.id)) invalid('Invalid window state')
    if (ids.has(window.id)) invalid(`Duplicate window id: ${window.id}`)
    ids.add(window.id)
  }

  if (op.kind === 'put') {
    if (!op.window || !validId(op.window.id)) invalid('Invalid window state')
    const index = windows.findIndex((window) => window.id === op.window.id)
    if (index < 0) return [...windows, op.window]
    return windows.map((window, itemIndex) => itemIndex === index ? op.window : window)
  }

  if (op.kind === 'close') {
    return windows
      .filter((window) => window.id !== op.id)
      .map((window) => window.attachedTo === op.id ? { ...window, attachedTo: null } : window)
  }

  if (op.kind === 'detach') {
    return windows.map((window) => window.id === op.id ? { ...window, attachedTo: null } : window)
  }

  if (op.kind === 'attach') {
    if (!validId(op.attachedTo)) invalid('Invalid window host id')
    if (op.id === op.attachedTo) invalid('A window cannot host itself')
    return windows.map((window) => window.id === op.id ? { ...window, attachedTo: op.attachedTo } : window)
  }

  if (op.kind === 'setTopmost' && typeof op.topmost !== 'boolean') invalid('topmost must be boolean')

  return windows.map((window) => {
    if (window.id !== op.id) return window
    switch (op.kind) {
      case 'minimize': return { ...window, minimized: true }
      case 'maximize': return { ...window, minimized: false, maximized: true }
      case 'restore': return { ...window, minimized: false, maximized: false }
      case 'setTopmost': return { ...window, topmost: op.topmost }
      default: return window
    }
  })
}

/**
 * Project either adapter into the common state used by parity tests and
 * diagnostics. Internal floats normally keep minimization in a side record.
 *
 * @param {{ readonly id: string, readonly minimized?: boolean, readonly maximized?: boolean, readonly topmost?: boolean, readonly attachedTo?: string | null }} window
 */
export function windowLifecycleProjection(window) {
  return {
    id: window.id,
    minimized: window.minimized === true,
    maximized: window.maximized === true,
    topmost: window.topmost === true,
    attachedTo: window.attachedTo ?? null,
  }
}
