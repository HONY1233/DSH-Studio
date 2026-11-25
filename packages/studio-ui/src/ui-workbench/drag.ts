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
  type Point,
  type Rect,
  type SnapZone,
  type Size,
  type TabId,
  clampRect,
  snapZones,
  sticky,
} from '../workbench/index.js'

/** 拖动激活阈值：低于它视为 click。 */
export const DRAG_THRESHOLD = 6

export interface DragSession {
  readonly tabId: TabId
  /** 来源格 id；浮窗拖出的标签也记来源格，便于收回。 */
  readonly from: string
  readonly start: Point
  readonly point: Point
  /** 是否已越过阈值。未激活时不应显示任何预览。 */
  readonly active: boolean
  /** 浮窗预览矩形（已钳进工作区）。 */
  readonly rect: Rect
  readonly zone?: SnapZone
}

export interface DragOptions {
  /** 按住 Ctrl / Cmd 时暂停吸附。 */
  readonly modifierPaused?: boolean
  readonly minSize?: Size
}

export interface BeginDragInput {
  readonly tabId: TabId
  readonly from: string
  readonly start: Point
  /** 初始浮窗尺寸，通常取自源格尺寸。 */
  readonly size: Size
  /** 指针相对浮窗左上角的偏移，保证拖动时"抓着哪就停在哪"。 */
  readonly grab?: Point
}

export function beginDrag(input: BeginDragInput): DragSession {
  const grab = input.grab ?? { x: 24, y: 16 }
  const rect: Rect = {
    x: input.start.x - grab.x,
    y: input.start.y - grab.y,
    w: input.size.w,
    h: input.size.h,
  }
  return { tabId: input.tabId, from: input.from, start: input.start, point: input.start, active: false, rect }
}

export function moveDrag(
  session: DragSession,
  point: Point,
  work: Rect,
  opts: DragOptions = {},
): DragSession {
  const dx = point.x - session.start.x
  const dy = point.y - session.start.y
  const active = session.active || Math.hypot(dx, dy) >= DRAG_THRESHOLD
  if (!active) return { ...session, point }

  const zones = snapZones(work, opts)
  const zone = sticky(session.zone, point, zones, 24)
  // 抓取偏移保持不变：浮窗 1:1 跟随指针。
  const grab = { x: session.start.x - session.rect.x, y: session.start.y - session.rect.y }
  const rect = clampRect(
    { x: point.x - grab.x, y: point.y - grab.y, w: session.rect.w, h: session.rect.h },
    work,
  )
  return { ...session, point, active, zone, rect }
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
