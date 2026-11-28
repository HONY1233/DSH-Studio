/**
 * 浮窗层 —— 绝对定位、视口钳制、z-order、边缘吸附与标题栏拖动。
 * 同组浮窗共享一次拖动预览与一次历史提交；锁定浮窗不参与移动。
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'

import type { FloatNode, MinimizedRecord, PinLevel, Rect, Tab, TabHostRef, TabId } from '../workbench/index.js'

import type { WorkbenchController } from './controller.js'
import {
  clampFloatRect,
  moveFloatRects,
  nextMinimizedPosition,
  snapFloatAt,
  type FloatSnapZone,
} from './float-snap.js'
import { TabPanel } from './tab-panel.js'
import { TabStrip, type TabStripLabels } from './tab-strip.js'

export interface FloatLayerLabels extends TabStripLabels {
  readonly minimize: string
  readonly restore: string
  /** 关闭整个浮窗（与"关闭某个标签"区分）。 */
  readonly closeWindow: string
  readonly moveWindow: string
  readonly lock: string
  readonly unlock: string
  readonly group: string
  readonly ungroup: string
  readonly pinControl: string
  readonly pin: Record<PinLevel, string>
}

export interface FloatLayerProps {
  readonly controller: WorkbenchController
  readonly floats: readonly FloatNode[]
  readonly minimized: readonly MinimizedRecord[]
  readonly viewport: Rect
  readonly resolveTitle: (tab: Tab) => string
  readonly renderContent: (tab: Tab, active: boolean) => ReactNode
  readonly labels: FloatLayerLabels
  readonly onContentTarget?: (tabId: TabId, node: HTMLDivElement | null) => void
  readonly onTabDragStart?: (host: TabHostRef, tabId: TabId, event: PointerEvent<HTMLElement>) => void
}

const PIN_LEVELS = ['none', 'workspace', 'app', 'window', 'windowTop'] as const

export function FloatLayer(props: FloatLayerProps): ReactNode {
  const { controller, floats, minimized, viewport, resolveTitle, renderContent, labels, onContentTarget, onTabDragStart } = props
  const [groupPreview, setGroupPreview] = useState<Record<string, Rect> | null>(null)

  return (
    <>
      {floats.map((float, index) => {
        const capsule = minimized.find((m) => m.floatId === float.id)
        if (capsule) {
          const rect = clampFloatRect({ x: capsule.x, y: capsule.y, w: 140, h: 32 }, viewport)
          return (
            <button
              key={`capsule-${float.id}`}
              type="button"
              data-capsule-for={float.id}
              aria-label={labels.restore}
              onClick={() =>
                controller.dispatchMany(
                  [{ kind: 'unminimize', floatId: float.id }, { kind: 'raiseFloat', floatId: float.id }],
                  'restore-float',
                )
              }
              style={{
                position: 'absolute',
                left: rect.x,
                top: rect.y,
                width: rect.w,
                height: rect.h,
                zIndex: 900 + index,
                border: '0.5px solid var(--color-border-secondary)',
                background: 'var(--color-background-primary)',
                color: 'var(--color-text-primary)',
                borderRadius: 999,
                padding: '4px 10px',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              {floatTitle(float, resolveTitle)}
            </button>
          )
        }
        return (
          <FloatWindow
            key={float.id}
            float={float}
            floats={floats}
            viewport={viewport}
            controller={controller}
            resolveTitle={resolveTitle}
            renderContent={renderContent}
            labels={labels}
            onContentTarget={onContentTarget}
            onTabDragStart={onTabDragStart}
            minimized={minimized}
            zIndex={(float.pin === 'windowTop' ? 1000 : 20) + index}
            previewOverride={groupPreview?.[float.id]}
            onGroupPreview={setGroupPreview}
          />
        )
      })}
    </>
  )
}

function floatTitle(float: FloatNode, resolveTitle: (tab: Tab) => string): string {
  const active = float.tabs.find((t) => t.id === float.activeTab) ?? float.tabs[float.tabs.length - 1]
  return active ? resolveTitle(active) : '—'
}

interface MoveOrigin {
  readonly id: string
  readonly rect: Rect
}

interface DragState {
  readonly start: { x: number; y: number }
  readonly origins: readonly MoveOrigin[]
  readonly pointerId: number
  readonly grouped: boolean
  current: Record<string, Rect>
  snap: FloatSnapZone | null
}

function FloatWindow({
  float,
  floats,
  viewport,
  controller,
  resolveTitle,
  renderContent,
  labels,
  onContentTarget,
  onTabDragStart,
  minimized,
  zIndex,
  previewOverride,
  onGroupPreview,
}: {
  float: FloatNode
  floats: readonly FloatNode[]
  viewport: Rect
  controller: WorkbenchController
  resolveTitle: (tab: Tab) => string
  renderContent: (tab: Tab, active: boolean) => ReactNode
  labels: FloatLayerLabels
  onContentTarget?: (tabId: TabId, node: HTMLDivElement | null) => void
  onTabDragStart?: (host: TabHostRef, tabId: TabId, event: PointerEvent<HTMLElement>) => void
  minimized: readonly MinimizedRecord[]
  zIndex: number
  previewOverride?: Rect
  onGroupPreview: (preview: Record<string, Rect> | null) => void
}): ReactNode {
  const [preview, setPreview] = useState<Rect | null>(null)
  const [snap, setSnap] = useState<FloatSnapZone | null>(null)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<DragState | null>(null)
  const rect = previewOverride ?? preview ?? float.rect
  const active = float.tabs.find((t) => t.id === float.activeTab) ?? float.tabs[float.tabs.length - 1]
  const groupMembers = float.groupId ? floats.filter((item) => item.groupId === float.groupId) : []
  const grouped = groupMembers.length > 1
  const moveLocked = float.locked === true || groupMembers.some((item) => item.locked)

  const raise = useCallback(() => {
    const state = controller.getState()
    const current = state.floats.find((item) => item.id === float.id)
    if (!current) return
    const members = current.groupId ? state.floats.filter((item) => item.groupId === current.groupId) : [current]
    const memberIds = new Set(members.map((item) => item.id))
    const order = [
      ...state.floats.filter((item) => !memberIds.has(item.id)).map((item) => item.id),
      ...state.floats.filter((item) => memberIds.has(item.id)).map((item) => item.id),
    ]
    if (order.every((id, index) => id === state.floats[index]?.id) && state.focused === float.id) return
    controller.dispatchMany(
      [{ kind: 'reorderFloats', order }, { kind: 'focus', id: float.id }],
      'raise-float',
    )
  }, [controller, float.id])

  const clearPreview = useCallback(() => {
    setDragging(false)
    setPreview(null)
    setSnap(null)
    onGroupPreview(null)
  }, [onGroupPreview])

  const cancelDrag = useCallback(() => {
    if (!drag.current) return
    drag.current = null
    clearPreview()
  }, [clearPreview])

  useEffect(() => {
    if (!dragging) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') cancelDrag()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', cancelDrag)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', cancelDrag)
    }
  }, [cancelDrag, dragging])

  const begin = (point: { x: number; y: number }, pointerId: number): boolean => {
    if (moveLocked) return false
    const origins = (grouped ? groupMembers : [float]).map((item) => ({ id: item.id, rect: item.rect }))
    drag.current = {
      start: point,
      origins,
      pointerId,
      grouped,
      current: Object.fromEntries(origins.map((item) => [item.id, item.rect])),
      snap: null,
    }
    setDragging(true)
    return true
  }

  const applyDelta = (dx: number, dy: number, pointer?: { x: number; y: number }): void => {
    const state = drag.current
    if (!state) return
    if (state.grouped) {
      state.current = moveFloatRects(state.origins, { x: dx, y: dy }, viewport)
      state.snap = null
      setSnap(null)
      onGroupPreview(state.current)
      return
    }
    const origin = state.origins[0]
    if (!origin) return
    const zone = pointer ? snapFloatAt(pointer, viewport) : null
    state.snap = zone
    state.current = {
      [origin.id]: zone?.rect ?? clampFloatRect({ ...origin.rect, x: origin.rect.x + dx, y: origin.rect.y + dy }, viewport),
    }
    setSnap(zone)
    setPreview(state.current[origin.id] ?? null)
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const target = event.target instanceof HTMLElement ? event.target : null
    if (target?.closest('button, select, [role="tab"]')) return
    if (!begin({ x: event.clientX, y: event.clientY }, event.pointerId)) return
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    applyDelta(event.clientX - state.start.x, event.clientY - state.start.y, { x: event.clientX, y: event.clientY })
  }

  const commitDrag = (): void => {
    const state = drag.current
    drag.current = null
    clearPreview()
    if (!state) return
    if (state.grouped && float.groupId) {
      const moves = state.origins.map((origin) => ({ floatId: origin.id, rect: state.current[origin.id] ?? origin.rect }))
      if (moves.some((move) => {
        const before = state.origins.find((origin) => origin.id === move.floatId)?.rect
        return before && (before.x !== move.rect.x || before.y !== move.rect.y || before.w !== move.rect.w || before.h !== move.rect.h)
      })) {
        controller.dispatch({ kind: 'moveFloatGroup', groupId: float.groupId, moves }, 'move-float-group')
      }
      return
    }
    const origin = state.origins[0]
    const finalRect = origin ? state.current[origin.id] : undefined
    if (!origin || !finalRect) return
    if (finalRect.x !== origin.rect.x || finalRect.y !== origin.rect.y || finalRect.w !== origin.rect.w || finalRect.h !== origin.rect.h) {
      controller.dispatch({ kind: 'moveFloat', floatId: float.id, rect: finalRect }, 'move-float')
    }
  }

  const onTitleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelDrag()
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (drag.current) commitDrag()
      else if (begin({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }, -1)) applyDelta(0, 0)
      return
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    if (!drag.current && !begin({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }, -1)) return
    const step = event.shiftKey ? 50 : 20
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
    applyDelta(dx, dy)
  }

  const closeTab = (tabId: TabId): void => {
    controller.dispatch({ kind: 'closeFloatTab', floatId: float.id, tabId })
  }

  const minimize = (): void => {
    const position = nextMinimizedPosition(viewport, minimized)
    controller.dispatch({ kind: 'minimize', floatId: float.id, ...position }, 'minimize-float')
  }

  const toggleGroup = (): void => {
    if (float.groupId) {
      controller.dispatch({ kind: 'ungroupFloat', floatId: float.id }, 'ungroup-float')
      return
    }
    const index = floats.findIndex((item) => item.id === float.id)
    const other = floats[index + 1] ?? floats[index - 1]
    if (!other || other.id === float.id || other.groupId) return
    controller.dispatch(
      { kind: 'groupFloats', groupId: controller.mint.float(), floatIds: [float.id, other.id] },
      'group-floats',
    )
  }

  const groupControl = float.groupId
    ? { label: labels.ungroup, disabled: false }
    : { label: labels.group, disabled: floats.filter((item) => !item.groupId).length < 2 }

  return (
    <>
      <div
        data-float-id={float.id}
        data-float-z={zIndex}
        data-dock-host={float.id}
        data-host-kind="float"
        data-float-dragging={dragging ? 'true' : 'false'}
        data-float-group={float.groupId}
        data-float-locked={float.locked ? 'true' : 'false'}
        data-drop-region="float"
        data-pin={float.pin}
        onPointerDownCapture={(event) => {
          const target = event.target instanceof HTMLElement ? event.target : null
          if (!target?.closest('[role="tab"]')) raise()
        }}
        style={{
          position: 'absolute',
          left: rect.x,
          top: rect.y,
          width: rect.w,
          height: rect.h,
          zIndex,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--color-background-primary)',
          border: `0.5px solid ${moveLocked ? 'var(--color-border-warning, #b7791f)' : 'var(--color-border-secondary)'}`,
          borderRadius: 12,
          boxShadow: '0 8px 28px rgba(0,0,0,0.12)',
          overflow: 'hidden',
        }}
      >
        <div
          data-float-titlebar="true"
          role="group"
          tabIndex={0}
          aria-label={labels.moveWindow}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={commitDrag}
          onPointerCancel={cancelDrag}
          onLostPointerCapture={cancelDrag}
          onKeyDown={onTitleKeyDown}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', cursor: moveLocked ? 'not-allowed' : 'move', flex: '0 0 auto' }}
        >
          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{labels.pin[float.pin]}</span>
          <TabStrip
            tabs={float.tabs}
            activeTab={active?.id}
            resolveTitle={resolveTitle}
            labels={labels}
            testId={`float-tabs-${float.id}`}
            onSelect={(id) => controller.dispatch({ kind: 'activateFloatTab', floatId: float.id, tabId: id })}
            onClose={closeTab}
            onDragStart={(id, event) => onTabDragStart?.({ kind: 'float', id: float.id }, id, event)}
          />
          <select
            aria-label={labels.pinControl}
            value={float.pin}
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => controller.dispatch({ kind: 'setPin', floatId: float.id, pin: event.target.value as PinLevel }, 'set-pin')}
            style={controlStyle}
          >
            {PIN_LEVELS.map((level) => <option key={level} value={level}>{labels.pin[level]}</option>)}
          </select>
          <button
            type="button"
            aria-label={groupControl.label}
            disabled={groupControl.disabled}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={toggleGroup}
            style={iconButton}
          >
            {float.groupId ? 'U' : 'G'}
          </button>
          <button
            type="button"
            aria-label={float.locked ? labels.unlock : labels.lock}
            aria-pressed={float.locked === true}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => controller.dispatch({ kind: 'setLocked', floatId: float.id, locked: !float.locked }, 'toggle-lock')}
            style={iconButton}
          >
            {float.locked ? 'L' : 'l'}
          </button>
          <button
            type="button"
            aria-label={labels.minimize}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={minimize}
            style={iconButton}
          >
            –
          </button>
          <button
            type="button"
            aria-label={labels.closeWindow}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => controller.dispatch({ kind: 'removeFloat', floatId: float.id })}
            style={iconButton}
          >
            ×
          </button>
        </div>
        <div style={{ flex: '1 1 auto', minHeight: 0, position: 'relative' }}>
          {float.tabs.map((tab) => (
            <TabPanel
              key={tab.id}
              tabId={tab.id}
              active={tab.id === active?.id}
              registerTarget={onContentTarget}
            >
              {onContentTarget ? null : renderContent(tab, tab.id === active?.id)}
            </TabPanel>
          ))}
        </div>
      </div>
      {snap ? (
        <div
          data-float-snap-preview={snap.region}
          style={{
            position: 'absolute',
            left: snap.rect.x,
            top: snap.rect.y,
            width: snap.rect.w,
            height: snap.rect.h,
            pointerEvents: 'none',
            border: '2px solid var(--color-border-info, #4a7dff)',
            background: 'color-mix(in srgb, var(--color-background-info, #2c2c2a) 20%, transparent)',
            borderRadius: 12,
            zIndex: zIndex + 500,
          }}
        />
      ) : null}
    </>
  )
}

const iconButton = {
  flex: '0 0 auto',
  border: 'none',
  background: 'transparent',
  color: 'var(--color-text-secondary)',
  cursor: 'pointer',
  fontSize: 13,
  lineHeight: 1,
  padding: 2,
} as const

const controlStyle = {
  flex: '0 0 auto',
  maxWidth: 130,
  border: 'none',
  background: 'transparent',
  color: 'var(--color-text-secondary)',
  fontSize: 11,
} as const
