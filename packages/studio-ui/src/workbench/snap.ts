/**
 * 吸附落区 —— 纯几何，可在 Node 里单测，不碰 DOM。
 *
 * 数值来自 omp-studio 的实测经验（docs/workbench-docking.md）：
 * - 边缘触发带随工作区宽度自适应，常见尺寸下 64–112px；
 * - 角落 112–192 宽 / 100–220 高，明显优先于边缘；
 * - 顶部带 48–72px，触发最大化；
 * - 预览出现后再给 24px 缓冲，避免分区交界处来回闪动；
 * - 按住 Ctrl / Cmd 暂停吸附（返回空数组，调用方按自由浮窗处理）。
 */

import type { PaneId, Point, Rect, Size, TabHostRef } from './layout.js'

export type SnapRegion = 'left' | 'right' | 'top' | 'bottom'
export type SnapCorner = 'tl' | 'tr' | 'bl' | 'br'

export type DockDestination =
  | { readonly to: 'pane'; readonly pane: PaneId; readonly index?: number }
  | { readonly to: 'host'; readonly host: TabHostRef; readonly index?: number }
  | { readonly to: 'edge'; readonly region: SnapRegion }
  | { readonly to: 'corner'; readonly corner: SnapCorner }
  | { readonly to: 'float'; readonly rect: Rect }
  | { readonly to: 'window' }

export interface SnapZone {
  readonly kind: 'corner' | 'edge' | 'top' | 'bottom' | 'pane'
  readonly corner?: SnapCorner
  readonly region?: SnapRegion
  /** 命中判定用的热区（含缓冲前的原始带）。 */
  readonly hit: Rect
  /** 预览高亮区，也就是落定后的目标几何。 */
  readonly rect: Rect
  readonly dest: DockDestination
}

export interface SnapOptions {
  /** 按住 Ctrl / Cmd 时为 true，直接不产生任何落区。 */
  readonly modifierPaused?: boolean
  /** 面板最小尺寸；不够就整块接收（退化成移动）。 */
  readonly minSize?: Size
  /** 预览保持缓冲，默认 24。 */
  readonly buffer?: number
}

/** 一个分区的最小可用尺寸，低于此值不再分栏。 */
export const MIN_CELL: Size = { w: 360, h: 280 }

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

export function bands(work: Rect): {
  edge: number
  cornerW: number
  cornerH: number
  top: number
} {
  return {
    edge: clamp(Math.round(work.w * 0.08), 64, 112),
    cornerW: clamp(Math.round(work.w * 0.14), 112, 192),
    cornerH: clamp(Math.round(work.h * 0.28), 100, 220),
    top: clamp(Math.round(work.h * 0.09), 48, 72),
  }
}

export function contains(rect: Rect, p: Point): boolean {
  return p.x >= rect.x && p.x < rect.x + rect.w && p.y >= rect.y && p.y < rect.y + rect.h
}

function half(work: Rect, side: 'left' | 'right' | 'top' | 'bottom'): Rect {
  switch (side) {
    case 'left':
      return { x: work.x, y: work.y, w: work.w / 2, h: work.h }
    case 'right':
      return { x: work.x + work.w / 2, y: work.y, w: work.w / 2, h: work.h }
    case 'top':
      return { x: work.x, y: work.y, w: work.w, h: work.h / 2 }
    case 'bottom':
      return { x: work.x, y: work.y + work.h / 2, w: work.w, h: work.h / 2 }
  }
}

function quadrant(work: Rect, corner: SnapCorner): Rect {
  const w = work.w / 2
  const h = work.h / 2
  switch (corner) {
    case 'tl':
      return { x: work.x, y: work.y, w, h }
    case 'tr':
      return { x: work.x + w, y: work.y, w, h }
    case 'bl':
      return { x: work.x, y: work.y + h, w, h }
    case 'br':
      return { x: work.x + w, y: work.y + h, w, h }
  }
}

/**
 * 生成落区，**顺序即优先级**：四角 → 左右边缘 → 顶部 → 底部。
 * 调用方用 `pickZone()` 取第一个命中的，就自动实现了"角落优先"。
 */
export function snapZones(work: Rect, opts: SnapOptions = {}): readonly SnapZone[] {
  if (opts.modifierPaused) return []
  if (work.w <= 0 || work.h <= 0) return []

  const b = bands(work)
  const minW = Math.max(MIN_CELL.w, opts.minSize?.w ?? 0)
  const minH = Math.max(MIN_CELL.h, opts.minSize?.h ?? 0)
  const zones: SnapZone[] = []

  const corners: SnapCorner[] = ['tl', 'tr', 'bl', 'br']
  for (const corner of corners) {
    const rect = quadrant(work, corner)
    if (rect.w < minW || rect.h < minH) continue
    const x = corner === 'tl' || corner === 'bl' ? work.x : work.x + work.w - b.cornerW
    const y = corner === 'tl' || corner === 'tr' ? work.y : work.y + work.h - b.cornerH
    zones.push({
      kind: 'corner',
      corner,
      hit: { x, y, w: b.cornerW, h: b.cornerH },
      rect,
      dest: { to: 'corner', corner },
    })
  }

  const edges: Array<['left' | 'right', Rect]> = [
    ['left', half(work, 'left')],
    ['right', half(work, 'right')],
  ]
  for (const [region, rect] of edges) {
    if (rect.w < minW) continue
    const x = region === 'left' ? work.x : work.x + work.w - b.edge
    zones.push({
      kind: 'edge',
      region,
      hit: { x, y: work.y + b.cornerH, w: b.edge, h: Math.max(0, work.h - b.cornerH * 2) },
      rect,
      dest: { to: 'edge', region },
    })
  }

  const topRect = half(work, 'top')
  if (topRect.w >= minW && topRect.h >= minH) {
    zones.push({
      kind: 'top',
      region: 'top',
      hit: { x: work.x, y: work.y, w: work.w, h: b.top },
      rect: topRect,
      dest: { to: 'edge', region: 'top' },
    })
  }

  const bottomRect = half(work, 'bottom')
  if (bottomRect.w >= minW && bottomRect.h >= minH) {
    zones.push({
      kind: 'bottom',
      region: 'bottom',
      hit: { x: work.x, y: work.y + work.h - b.top, w: work.w, h: b.top },
      rect: bottomRect,
      dest: { to: 'edge', region: 'bottom' },
    })
  }

  return zones
}

/** 命中检测：按落区顺序取第一个。 */
export function pickZone(point: Point, zones: readonly SnapZone[]): SnapZone | undefined {
  return zones.find((z) => contains(z.hit, point))
}

/**
 * 预览保持：指针稍微离开上一个落区（默认 24px）仍保持它，
 * 越过缓冲带才切换。解决交界处高频抖动。
 */
export function sticky(
  prev: SnapZone | undefined,
  point: Point,
  zones: readonly SnapZone[],
  buffer = 24,
): SnapZone | undefined {
  const hit = pickZone(point, zones)
  if (!prev) return hit
  if (hit && hit.dest === prev.dest) return hit
  const grown: Rect = {
    x: prev.hit.x - buffer,
    y: prev.hit.y - buffer,
    w: prev.hit.w + buffer * 2,
    h: prev.hit.h + buffer * 2,
  }
  if (contains(grown, point)) return hit && zones.indexOf(hit) < zones.indexOf(prev) ? hit : prev
  return hit
}

/** 落区能否容纳该面板；不足则该落区退化成整块移动，不提供预览。 */
export function canDock(rect: Rect, minSize?: Size): boolean {
  const needW = Math.max(MIN_CELL.w, minSize?.w ?? 0)
  const needH = Math.max(MIN_CELL.h, minSize?.h ?? 0)
  return rect.w >= needW && rect.h >= needH
}

/** 在该落区里还能不能再分一刀（拖动分隔条与"分栏"控件都用这个判据）。 */
export function canSplit(rect: Rect, axis: 'row' | 'column', minSize?: Size): boolean {
  const needW = Math.max(MIN_CELL.w, minSize?.w ?? 0)
  const needH = Math.max(MIN_CELL.h, minSize?.h ?? 0)
  return axis === 'row' ? rect.w / 2 >= needW : rect.h / 2 >= needH
}

/** 浮窗矩形钳进视口；比视口大的按视口尺寸绘制。 */
export function clampRect(rect: Rect, viewport: Rect): Rect {
  const w = Math.min(rect.w, viewport.w)
  const h = Math.min(rect.h, viewport.h)
  return {
    x: clamp(rect.x, viewport.x, viewport.x + viewport.w - w),
    y: clamp(rect.y, viewport.y, viewport.y + viewport.h - h),
    w,
    h,
  }
}
