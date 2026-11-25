/**
 * 浮窗层 —— 绝对定位、视口钳制、标题栏拖动只落一次 op。
 * 胶囊（最小化）单独一层，位置记在 `layout.minimized`。
 */

import { useRef, useState, type PointerEvent, type ReactNode } from 'react'

import type { FloatNode, MinimizedRecord, Rect, Tab, TabId } from '../workbench/index.js'

import type { WorkbenchController } from './controller.js'
import { TabStrip, type TabStripLabels } from './tab-strip.js'

export interface FloatLayerLabels extends TabStripLabels {
  readonly minimize: string
  readonly restore: string
  /** 关闭整个浮窗（与"关闭某个标签"区分）。 */
  readonly closeWindow: string
  readonly pin: Record<'none' | 'workspace' | 'app' | 'window' | 'windowTop', string>
}

export interface FloatLayerProps {
  readonly controller: WorkbenchController
  readonly floats: readonly FloatNode[]
  readonly minimized: readonly MinimizedRecord[]
  readonly viewport: Rect
  readonly resolveTitle: (tab: Tab) => string
  readonly renderContent: (tab: Tab, active: boolean) => ReactNode
  readonly labels: FloatLayerLabels
}

export function FloatLayer(props: FloatLayerProps): ReactNode {
  const { controller, floats, minimized, viewport, resolveTitle, renderContent, labels } = props

  return (
    <>
      {floats.map((float) => {
        const capsule = minimized.find((m) => m.floatId === float.id)
        if (capsule) {
          return (
            <button
              key={`capsule-${float.id}`}
              type="button"
              data-capsule-for={float.id}
              aria-label={labels.restore}
              onClick={() => controller.dispatch({ kind: 'unminimize', floatId: float.id })}
              style={{
                position: 'absolute',
                left: capsule.x,
                top: capsule.y,
                zIndex: 30,
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
            viewport={viewport}
            controller={controller}
            resolveTitle={resolveTitle}
            renderContent={renderContent}
            labels={labels}
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

function FloatWindow({
  float,
  viewport,
  controller,
  resolveTitle,
  renderContent,
  labels,
}: {
  float: FloatNode
  viewport: Rect
  controller: WorkbenchController
  resolveTitle: (tab: Tab) => string
  renderContent: (tab: Tab, active: boolean) => ReactNode
  labels: FloatLayerLabels
}): ReactNode {
  const [preview, setPreview] = useState<Rect | null>(null)
  const drag = useRef<{ start: { x: number; y: number }; origin: Rect } | null>(null)
  const rect = preview ?? float.rect
  const active = float.tabs.find((t) => t.id === float.activeTab) ?? float.tabs[float.tabs.length - 1]

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { start: { x: event.clientX, y: event.clientY }, origin: float.rect }
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const state = drag.current
    if (!state) return
    const next: Rect = {
      x: Math.min(Math.max(state.origin.x + event.clientX - state.start.x, viewport.x), viewport.x + viewport.w - float.rect.w),
      y: Math.min(Math.max(state.origin.y + event.clientY - state.start.y, viewport.y), viewport.y + viewport.h - float.rect.h),
      w: float.rect.w,
      h: float.rect.h,
    }
    setPreview(next)
  }

  const finish = (): void => {
    const state = drag.current
    drag.current = null
    if (!state || !preview) {
      setPreview(null)
      return
    }
    const moved = preview.x !== float.rect.x || preview.y !== float.rect.y
    setPreview(null)
    if (moved) controller.dispatch({ kind: 'moveFloat', floatId: float.id, rect: preview })
  }

  const closeTab = (tabId: TabId): void => {
    // closeFloatTab 在关到空时自动移除浮窗，不需要分支。
    controller.dispatch({ kind: 'closeFloatTab', floatId: float.id, tabId })
  }

  return (
    <div
      data-float-id={float.id}
      data-pin={float.pin}
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        zIndex: float.pin === 'windowTop' ? 40 : 20,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-background-primary)',
        border: '0.5px solid var(--color-border-secondary)',
        borderRadius: 12,
        boxShadow: '0 8px 28px rgba(0,0,0,0.12)',
        overflow: 'hidden',
      }}
    >
      <div
        data-float-titlebar="true"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', cursor: 'move', flex: '0 0 auto' }}
      >
        <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
          {labels.pin[float.pin]}
        </span>
        {float.tabs.length > 1 ? (
          <TabStrip
            tabs={float.tabs}
            activeTab={active?.id}
            resolveTitle={resolveTitle}
            labels={labels}
            testId={`float-tabs-${float.id}`}
            onSelect={(id) => controller.dispatch({ kind: 'activateFloatTab', floatId: float.id, tabId: id })}
            onClose={closeTab}
          />
        ) : (
          <span style={{ flex: '1 1 auto', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {active ? resolveTitle(active) : '—'}
          </span>
        )}
        <button
          type="button"
          aria-label={labels.minimize}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => controller.dispatch({ kind: 'minimize', floatId: float.id, x: viewport.x + 16, y: viewport.y + viewport.h - 40 })}
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
          <div
            key={tab.id}
            role="tabpanel"
            data-tab-panel={tab.id}
            hidden={tab.id !== active?.id}
            style={{ height: '100%', minHeight: 0, overflow: 'hidden' }}
          >
            {renderContent(tab, tab.id === active?.id)}
          </div>
        ))}
      </div>
    </div>
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
