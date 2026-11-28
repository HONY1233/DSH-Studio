/**
 * 拖动会话 —— 纯手势状态机，不碰 DOM、不碰 React。
 *
 * 三条规则直接对应 omp 的踩坑记录：
 * 1) 超过 6px 才算拖动，否则是一次 click（避免"点一下就浮出"）；
 * 2) 拖动中只更新预览，**绝不**逐帧落 op；
 * 3) 落区用 sticky 保持，避免交界处高频闪动。
 */

import {
  type DockDestination,
  type PaneId,
  type Point,
  type Rect,
  type RegionId,
  type SnapZone,
  type Size,
  type TabHostRef,
  type TabId,
  clampRect,
  contains,
  snapZones,
  sticky,
} from '../workbench/index.js'

/** 拖动激活阈值：低于它视为 click。 */
export const DRAG_THRESHOLD = 6

export interface DragSession {
  readonly tabId: TabId
  /** 来源宿主；兼容旧调用方传入的 pane id。 */
  readonly from: TabHostRef
  readonly start: Point
  readonly point: Point
  /** 是否已越过阈值。未激活时不应显示任何预览。 */
  readonly active: boolean
  /** 浮窗预览矩形（已钳进工作区）。 */
  readonly rect: Rect
  readonly zone?: SnapZone
  /** 当前指针命中的真实目标宿主；边缘停靠也优先分裂该宿主。 */
  readonly targetHost?: TabHostRef
  /** 旧 pane 调用方兼容别名。 */
  readonly targetPane?: PaneId
}

export interface DragOptions {
  /** 按住 Ctrl / Cmd 时暂停吸附。 */
  readonly modifierPaused?: boolean
  readonly minSize?: Size
  /** 指针当前命中的真实目标宿主；由 DOM 宿主探测后注入。 */
  readonly targetHost?: TabHostRef
  /** 旧 pane 调用方兼容别名。 */
  readonly targetPane?: PaneId
  readonly targetRect?: Rect
  /** 固定区域真实几何；边缘/角落预览与最终落位保持一致。 */
  readonly regionRects?: Readonly<Partial<Record<RegionId, Rect>>>
  /** 指针落在标签条时命中的插入顺序。 */
  readonly targetIndex?: number
}

export interface BeginDragInput {
  readonly tabId: TabId
  readonly from: TabHostRef | string
  readonly start: Point
  /** 初始浮窗尺寸，通常取自源格尺寸。 */
  readonly size: Size
  /** 指针相对浮窗左上角的偏移，保证拖动时"抓着哪就停在哪"。 */
  readonly grab?: Point
}

export function beginDrag(input: BeginDragInput): DragSession {
  const from: TabHostRef = typeof input.from === 'string' ? { kind: 'pane', id: input.from } : input.from
  const grab = input.grab ?? { x: 24, y: 16 }
  const rect: Rect = {
    x: input.start.x - grab.x,
    y: input.start.y - grab.y,
    w: input.size.w,
    h: input.size.h,
  }
  return { tabId: input.tabId, from, start: input.start, point: input.start, active: false, rect }
}

export function moveDrag(
  session: DragSession,
  point: Point,
  work: Rect,
  opts: DragOptions = {},
): DragSession {
  const dx = point.x - session.start.x
  const dy = point.y - session.start.y
  const active = session.active || Math.hypot(dx, dy) > DRAG_THRESHOLD
  if (!active) return { ...session, point }

  const zones = snapZones(work, opts)
  const targetHost = opts.targetHost ?? (opts.targetPane ? { kind: 'pane' as const, id: opts.targetPane } : undefined)
  const targetPane = targetHost?.kind === 'pane' ? targetHost.id as PaneId : opts.targetPane
  const previousSnap = session.zone?.kind === 'pane' ? undefined : session.zone
  const snapZone = sticky(previousSnap, point, zones, 24)
  // 边缘/角落优先；落在具体宿主内时合并进该宿主，而不是误用焦点格。
  const hostZone: SnapZone | undefined =
    !opts.modifierPaused &&
    (opts.targetIndex !== undefined || !snapZone) &&
    targetHost &&
    opts.targetRect &&
    contains(opts.targetRect, point)
      ? {
          kind: 'pane',
          hit: opts.targetRect,
          rect: opts.targetRect,
          dest: opts.targetHost
            ? { to: 'host', host: targetHost, index: opts.targetIndex }
            : { to: 'pane', pane: opts.targetPane!, index: opts.targetIndex },
        }
      : undefined
  let zone = hostZone ?? snapZone
  if (zone && zone.kind !== 'pane') {
    const edge = zone.region ?? (zone.corner === 'tl' || zone.corner === 'tr' ? 'top' : zone.corner === 'bl' || zone.corner === 'br' ? 'bottom' : undefined)
    const fixed: RegionId | undefined =
      edge === 'left' || zone.corner === 'tl' || zone.corner === 'bl'
        ? 'sidebar'
        : edge === 'right' || zone.corner === 'tr' || zone.corner === 'br'
          ? 'right'
          : edge === 'bottom'
            ? 'bottom'
            : undefined
    const regionRect = fixed ? opts.regionRects?.[fixed] : undefined
    if (regionRect) zone = { ...zone, rect: regionRect }
  }
  // 抓取偏移保持不变：浮窗 1:1 跟随指针。
  const grab = { x: session.start.x - session.rect.x, y: session.start.y - session.rect.y }
  const rect = clampRect(
    { x: point.x - grab.x, y: point.y - grab.y, w: session.rect.w, h: session.rect.h },
    work,
  )
  return { ...session, point, active, zone, rect, targetHost, targetPane }
}

export interface DragResult {
  /** 落到停靠区时的目标；为空表示应落成浮窗。 */
  readonly dest?: DockDestination
  /** 落成浮窗时的矩形。 */
  readonly rect?: Rect
}

/** 松手：未越阈值返回 undefined（调用方按 click 处理）。 */
export function dropDrag(session: DragSession): DragResult | undefined {
  if (!session.active) return undefined
  if (session.zone) return { dest: session.zone.dest }
  return { rect: session.rect }
}

/** 预览高亮区：只有命中落区时才有，浮窗预览用 rect。 */
export function dragPreview(session: DragSession): { rect: Rect; kind: 'zone' | 'float' } | undefined {
  if (!session.active) return undefined
  return session.zone ? { rect: session.zone.rect, kind: 'zone' } : { rect: session.rect, kind: 'float' }
}
