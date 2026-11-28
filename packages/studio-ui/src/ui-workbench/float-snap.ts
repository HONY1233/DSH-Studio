import type { Point, Rect } from '../workbench/index.js'

export type FloatSnapRegion = 'left' | 'right' | 'top' | 'bottom' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'

export interface FloatSnapZone {
  readonly region: FloatSnapRegion
  readonly rect: Rect
}

export interface MinimizedPosition {
  readonly x: number
  readonly y: number
}

const DEFAULT_SNAP_THRESHOLD = 24

function halfRects(viewport: Rect): Record<'left' | 'right' | 'top' | 'bottom', Rect> {
  const halfW = viewport.w / 2
  const halfH = viewport.h / 2
  return {
    left: { x: viewport.x, y: viewport.y, w: halfW, h: viewport.h },
    right: { x: viewport.x + halfW, y: viewport.y, w: halfW, h: viewport.h },
    top: { x: viewport.x, y: viewport.y, w: viewport.w, h: halfH },
    bottom: { x: viewport.x, y: viewport.y + halfH, w: viewport.w, h: halfH },
  }
}

function quarterRects(viewport: Rect): Record<Exclude<FloatSnapRegion, 'left' | 'right' | 'top' | 'bottom'>, Rect> {
  const halfW = viewport.w / 2
  const halfH = viewport.h / 2
  return {
    topLeft: { x: viewport.x, y: viewport.y, w: halfW, h: halfH },
    topRight: { x: viewport.x + halfW, y: viewport.y, w: halfW, h: halfH },
    bottomLeft: { x: viewport.x, y: viewport.y + halfH, w: halfW, h: halfH },
    bottomRight: { x: viewport.x + halfW, y: viewport.y + halfH, w: halfW, h: halfH },
  }
}

/** 指针进入视口边缘阈值时返回半屏/四象限吸附区域；角落优先于边缘。 */
export function snapFloatAt(
  point: Point,
  viewport: Rect,
  threshold = DEFAULT_SNAP_THRESHOLD,
): FloatSnapZone | null {
  const edge = Math.max(0, Math.min(threshold, viewport.w / 2, viewport.h / 2))
  const nearLeft = point.x <= viewport.x + edge
  const nearRight = point.x >= viewport.x + viewport.w - edge
  const nearTop = point.y <= viewport.y + edge
  const nearBottom = point.y >= viewport.y + viewport.h - edge

  if (nearLeft && nearTop) return { region: 'topLeft', rect: quarterRects(viewport).topLeft }
  if (nearRight && nearTop) return { region: 'topRight', rect: quarterRects(viewport).topRight }
  if (nearLeft && nearBottom) return { region: 'bottomLeft', rect: quarterRects(viewport).bottomLeft }
  if (nearRight && nearBottom) return { region: 'bottomRight', rect: quarterRects(viewport).bottomRight }

  const halves = halfRects(viewport)
  if (nearLeft) return { region: 'left', rect: halves.left }
  if (nearRight) return { region: 'right', rect: halves.right }
  if (nearTop) return { region: 'top', rect: halves.top }
  if (nearBottom) return { region: 'bottom', rect: halves.bottom }
  return null
}

/** 把浮窗限制在视口内；浮窗大于视口时优先保证尺寸非负且位置可达。 */
export function clampFloatRect(rect: Rect, viewport: Rect): Rect {
  const w = Math.max(0, Math.min(rect.w, viewport.w))
  const h = Math.max(0, Math.min(rect.h, viewport.h))
  const maxX = viewport.x + viewport.w - w
  const maxY = viewport.y + viewport.h - h
  return {
    x: Math.min(Math.max(rect.x, viewport.x), maxX),
    y: Math.min(Math.max(rect.y, viewport.y), maxY),
    w,
    h,
  }
}

/** 对一组浮窗应用同一位移，并让整组边界保持在视口内，避免破坏相对位置。 */
export function moveFloatRects(
  origins: readonly { readonly id: string; readonly rect: Rect }[],
  delta: Point,
  viewport: Rect,
): Record<string, Rect> {
  if (origins.length === 0) return {}
  const minX = Math.min(...origins.map((item) => item.rect.x))
  const minY = Math.min(...origins.map((item) => item.rect.y))
  const maxX = Math.max(...origins.map((item) => item.rect.x + item.rect.w))
  const maxY = Math.max(...origins.map((item) => item.rect.y + item.rect.h))
  const width = maxX - minX
  const height = maxY - minY
  const maxDeltaX = viewport.x + viewport.w - width - minX
  const maxDeltaY = viewport.y + viewport.h - height - minY
  const dx = maxDeltaX < viewport.x - minX ? viewport.x - minX : Math.min(Math.max(delta.x, viewport.x - minX), maxDeltaX)
  const dy = maxDeltaY < viewport.y - minY ? viewport.y - minY : Math.min(Math.max(delta.y, viewport.y - minY), maxDeltaY)
  return Object.fromEntries(origins.map((item) => [item.id, { ...item.rect, x: item.rect.x + dx, y: item.rect.y + dy }]))
}

function overlaps(a: MinimizedPosition, b: MinimizedPosition, size: { w: number; h: number }, gap: number): boolean {
  return !(
    a.x + size.w + gap <= b.x ||
    b.x + size.w + gap <= a.x ||
    a.y + size.h + gap <= b.y ||
    b.y + size.h + gap <= a.y
  )
}

/** 从底部向左排布最小化胶囊，跳过已占用位置；空间不足时安全钳制。 */
export function nextMinimizedPosition(
  viewport: Rect,
  occupied: readonly MinimizedPosition[],
  size = { w: 140, h: 32 },
  gap = 8,
  margin = 16,
): MinimizedPosition {
  const usableW = Math.max(0, viewport.w - margin * 2)
  const usableH = Math.max(0, viewport.h - margin * 2)
  const columns = Math.max(1, Math.floor((usableW + gap) / (size.w + gap)))
  const rows = Math.max(1, Math.floor((usableH + gap) / (size.h + gap)))
  const startX = viewport.x + Math.min(margin, usableW / 2)
  const startY = viewport.y + viewport.h - Math.min(margin, usableH / 2) - size.h

  for (let index = 0; index < columns * rows; index += 1) {
    const row = Math.floor(index / columns)
    const column = index % columns
    const candidate = {
      x: startX + column * (size.w + gap),
      y: startY - row * (size.h + gap),
    }
    if (!occupied.some((item) => overlaps(candidate, item, size, gap))) return candidate
  }

  return { x: startX, y: Math.max(viewport.y, startY) }
}
