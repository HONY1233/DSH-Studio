import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

import type { PaneNode, RegionId } from '../workbench/index.js'

import { PaneView, type SurfaceContext } from './surface.js'

export interface RegionBarProps {
  readonly region: RegionId
  readonly pane: PaneNode
  readonly ctx: SurfaceContext
  readonly label: string
  readonly separatorLabel: string
  readonly size?: number
  readonly onResize?: (size?: number) => void
}

const DEFAULT_SIZE: Readonly<Record<RegionId, number>> = { sidebar: 220, right: 260, bottom: 180 }
const MIN_SIZE: Readonly<Record<RegionId, number>> = { sidebar: 140, right: 160, bottom: 120 }

/** Persistent sidebar/right/bottom hosts; unlike splits these never compact. */
export function RegionBar({ region, pane, ctx, label, separatorLabel, size, onResize }: RegionBarProps): ReactNode {
  const vertical = region === 'sidebar' || region === 'right'
  const [preview, setPreview] = useState<number | null>(null)
  const drag = useRef<{ start: number; size: number; limit: number } | null>(null)
  const currentSize = preview ?? size ?? DEFAULT_SIZE[region]
  const axisPoint = (event: PointerEvent<HTMLElement>): number => vertical ? event.clientX : event.clientY
  const sizeLimit = (target: HTMLElement): number => {
    const parent = target.parentElement?.getBoundingClientRect()
    return Math.max(MIN_SIZE[region], (vertical ? parent?.width ?? 1200 : parent?.height ?? 800) * 0.6)
  }

  const begin = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    drag.current = { start: axisPoint(event), size: currentSize, limit: sizeLimit(event.currentTarget) }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const move = (event: PointerEvent<HTMLDivElement>): void => {
    const state = drag.current
    if (!state) return
    const direction = region === 'right' || region === 'bottom' ? -1 : 1
    const next = state.size + (axisPoint(event) - state.start) * direction
    setPreview(Math.round(Math.min(state.limit, Math.max(MIN_SIZE[region], next))))
  }

  const finish = (): void => {
    const state = drag.current
    drag.current = null
    setPreview(null)
    if (state && preview !== null && preview !== state.size) onResize?.(preview)
  }

  const cancel = (): void => {
    drag.current = null
    setPreview(null)
  }

  const nudge = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    const decrease = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
    const direction = region === 'right' || region === 'bottom' ? -1 : 1
    const step = (decrease ? -1 : 1) * direction * (event.shiftKey ? 40 : 10)
    onResize?.(Math.min(sizeLimit(event.currentTarget), Math.max(MIN_SIZE[region], currentSize + step)))
  }

  const bar = (
    <aside
      data-dock-host={pane.id}
      data-host-kind="region"
      data-region={region}
      aria-label={label}
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: vertical ? '0 0 auto' : '0 0 auto',
        flexBasis: currentSize,
        width: vertical ? currentSize : '100%',
        minWidth: 0,
        minHeight: 0,
        borderTop: region === 'bottom' ? '1px solid var(--color-border-tertiary)' : undefined,
        borderRight: region === 'sidebar' ? '1px solid var(--color-border-tertiary)' : undefined,
        borderLeft: region === 'right' ? '1px solid var(--color-border-tertiary)' : undefined,
        background: 'var(--color-background-secondary, #17191f)',
        overflow: 'hidden',
      }}
    >
      <div style={{ flex: '0 0 auto', padding: '5px 8px', fontSize: 11, color: 'var(--color-text-tertiary)' }}>
        {label}
      </div>
      <div style={{ flex: '1 1 auto', minHeight: 0 }}>
        <PaneView
          pane={pane}
          hostKind="region"
          ctx={{
            ...ctx,
            onTabDragStart: (_host, tabId, event) => ctx.onTabDragStart?.({ kind: 'region', id: pane.id }, tabId, event),
          }}
        />
      </div>
    </aside>
  )

  const separator = (
    <div
      role="separator"
      tabIndex={0}
      aria-label={separatorLabel}
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-valuenow={currentSize}
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onKeyDown={nudge}
      onDoubleClick={() => onResize?.()}
      style={{
        flex: '0 0 5px',
        alignSelf: 'stretch',
        cursor: vertical ? 'col-resize' : 'row-resize',
        background: 'var(--color-border-tertiary)',
        touchAction: 'none',
      }}
    />
  )

  return <>{region === 'right' ? separator : null}{bar}{region === 'right' ? null : separator}</>
}
