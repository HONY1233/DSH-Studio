/** Display-geometry validation, clamping and restoration (X2.10). */
import { ControlError, ControlErrorCode } from './control.js'
import { validateRect } from './workbench-schema.js'

const DEFAULT_MARGIN = 8
const MIN_VISIBLE_WIDTH = 120
const MIN_VISIBLE_HEIGHT = 80

function invalid(message, details = {}) {
  return new ControlError(ControlErrorCode.INVALID_ARGUMENT, message, details)
}

function finite(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid(`${name} 必须是有限数`)
  return value
}

export function validateDisplay(display) {
  if (!display || typeof display !== 'object') throw invalid('display 必须是对象')
  if (typeof display.id !== 'string' || !display.id) throw invalid('display.id 必须是非空字符串')
  const workArea = validateRect(display.workArea)
  const scaleFactor = finite(display.scaleFactor, 'display.scaleFactor')
  if (scaleFactor <= 0 || scaleFactor > 16) throw invalid('display.scaleFactor 必须在 0..16 之间')
  return { id: display.id, workArea, scaleFactor }
}

export function normalizeDisplays(displays) {
  if (!Array.isArray(displays) || displays.length === 0) throw invalid('displays 不能为空')
  const normalized = displays.map(validateDisplay)
  const ids = new Set()
  for (const display of normalized) {
    if (ids.has(display.id)) throw invalid(`display id 重复: ${display.id}`)
    ids.add(display.id)
  }
  return normalized
}

export function intersectionArea(a, b) {
  const left = Math.max(a.x, b.x)
  const top = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.w, b.x + b.w)
  const bottom = Math.min(a.y + a.h, b.y + b.h)
  return Math.max(0, right - left) * Math.max(0, bottom - top)
}

export function clampRect(rect, workArea, { margin = DEFAULT_MARGIN } = {}) {
  const safeRect = validateRect(rect)
  const area = validateRect(workArea)
  if (!Number.isSafeInteger(margin) || margin < 0) throw invalid('margin 必须是非负整数')
  const maxWidth = Math.max(1, area.w - margin * 2)
  const maxHeight = Math.max(1, area.h - margin * 2)
  const w = Math.min(safeRect.w, maxWidth)
  const h = Math.min(safeRect.h, maxHeight)
  const x = Math.max(area.x + margin, Math.min(safeRect.x, area.x + area.w - margin - w))
  const y = Math.max(area.y + margin, Math.min(safeRect.y, area.y + area.h - margin - h))
  return validateRect({ x, y, w, h })
}

export function chooseDisplay(displayId, displays) {
  const normalized = normalizeDisplays(displays)
  if (typeof displayId === 'string') {
    const exact = normalized.find((display) => display.id === displayId)
    if (exact) return { display: exact, reason: 'exact' }
  }
  return { display: normalized[0], reason: displayId ? 'missing' : 'primary' }
}

export function restoreWindowGeometry(saved, displays, { margin = DEFAULT_MARGIN } = {}) {
  const normalized = normalizeDisplays(displays)
  let candidate = null
  let invalidRect = false
  try {
    candidate = validateRect(saved)
  } catch {
    invalidRect = true
  }
  if (!candidate) {
    const primary = normalized[0]
    return {
      rect: clampRect({ x: primary.workArea.x + margin, y: primary.workArea.y + margin, w: 800, h: 600 }, primary.workArea, { margin }),
      displayId: primary.id,
      scaleFactor: primary.scaleFactor,
      reason: 'invalid-rect',
    }
  }
  const exact = normalized.find((display) => display.id === saved.displayId)
  let display
  let reason
  if (exact) {
    display = exact
    reason = 'exact'
  } else {
    const ranked = normalized
      .map((item) => ({ display: item, area: intersectionArea(candidate, item.workArea) }))
      .sort((left, right) => right.area - left.area)
    display = ranked[0].area > 0 ? ranked[0].display : normalized[0]
    reason = ranked[0].area > 0 ? 'best-intersection' : 'primary-fallback'
  }
  const rect = clampRect(candidate, display.workArea, { margin })
  const fullyVisible = rect.x === candidate.x && rect.y === candidate.y && rect.w === candidate.w && rect.h === candidate.h
  return {
    rect,
    displayId: display.id,
    scaleFactor: display.scaleFactor,
    reason: invalidRect ? 'invalid-rect' : (fullyVisible ? reason : `${reason}-clamped`),
  }
}

export function ensureRectVisible(rect, displays, options = {}) {
  return restoreWindowGeometry({ ...rect, displayId: null }, displays, options)
}

export function geometryTemplate(workArea, name = 'center') {
  const area = validateRect(workArea)
  if (name === 'center') {
    return clampRect({
      x: area.x + area.w * 0.2,
      y: area.y + area.h * 0.2,
      w: area.w * 0.6,
      h: area.h * 0.6,
    }, area)
  }
  if (name === 'left-half') {
    return clampRect({ x: area.x, y: area.y, w: area.w / 2, h: area.h }, area, { margin: 0 })
  }
  if (name === 'right-half') {
    return clampRect({ x: area.x + area.w / 2, y: area.y, w: area.w / 2, h: area.h }, area, { margin: 0 })
  }
  throw invalid(`未知几何模板: ${name}`)
}

export function hasUsableIntersection(rect, workArea) {
  const safeRect = validateRect(rect)
  const area = validateRect(workArea)
  const intersection = intersectionArea(safeRect, area)
  return intersection >= MIN_VISIBLE_WIDTH * MIN_VISIBLE_HEIGHT
}
