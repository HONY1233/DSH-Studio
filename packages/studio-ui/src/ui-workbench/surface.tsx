/**
 * 停靠面 —— 递归渲染分裂树。
 *
 * 两条关键行为：
 * - **预览本地化**：拖动分隔条只改本地 preview，松手才 `dispatch(resize)`。
 *   逐帧落 op 会把撤销栈灌满（omp 的教训）。
 * - **标签保活**：一个格里所有标签内容都挂载，非活动项用 `hidden` 摘出渲染，
 *   这样切标签、搬窗口都不会重建正文与订阅。
 */

import { Fragment, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

import type { LayoutNode, PaneNode, SplitNode, Tab, TabHostRef, TabId } from '../workbench/index.js'

import type { WorkbenchController } from './controller.js'
import { TabPanel } from './tab-panel.js'
import { TabStrip, type TabStripLabels } from './tab-strip.js'

export interface SurfaceContext {
  readonly controller: WorkbenchController
  readonly resolveTitle: (tab: Tab) => string
  readonly renderContent: (tab: Tab, active: boolean) => ReactNode
  readonly labels: TabStripLabels & { readonly separator: string }
  readonly onTabDragStart?: (host: TabHostRef, tabId: TabId, event: PointerEvent<HTMLElement>) => void
  readonly onContentTarget?: (tabId: TabId, node: HTMLDivElement | null) => void
}

export function DockSurface({ node, ctx }: { node: LayoutNode; ctx: SurfaceContext }): ReactNode {
  return node.kind === 'pane' ? <PaneView pane={node} ctx={ctx} /> : <SplitView split={node} ctx={ctx} />
}

export function PaneView({ pane, ctx, hostKind = 'pane' }: { pane: PaneNode; ctx: SurfaceContext; hostKind?: 'pane' | 'region' }): ReactNode {
  const { controller, resolveTitle, renderContent, labels, onTabDragStart, onContentTarget } = ctx
  const active = pane.tabs.find((t) => t.id === pane.activeTab) ?? pane.tabs[pane.tabs.length - 1]
  const host: TabHostRef = { kind: hostKind, id: pane.id }
  const selectTab = (tabId: TabId): void => {
    if (hostKind === 'region') {
      controller.dispatchMany(
        [
          { kind: 'setHostTabs', host, tabs: pane.tabs, activeTab: tabId },
          { kind: 'focus', id: pane.id },
        ],
        'activate-tab',
      )
      return
    }
    controller.dispatch({ kind: 'activateTab', pane: pane.id, tabId }, 'activate-tab')
  }
  const closeTab = (tabId: TabId): void => {
    if (hostKind === 'pane') {
      controller.dispatch({ kind: 'removeTab', pane: pane.id, tabId }, 'close-tab')
      return
    }
    const index = pane.tabs.findIndex((tab) => tab.id === tabId)
    const tabs = pane.tabs.filter((tab) => tab.id !== tabId)
    const activeTab = pane.activeTab === tabId
      ? tabs[Math.min(Math.max(index, 0), Math.max(0, tabs.length - 1))]?.id
      : pane.activeTab
    controller.dispatch({ kind: 'setHostTabs', host, tabs, activeTab }, 'close-tab')
  }

  return (
    <section
      data-pane-id={pane.id}
      data-dock-host={pane.id}
      data-host-kind={hostKind}
      data-drop-region="pane"
      data-empty={pane.tabs.length === 0 ? 'true' : 'false'}
      style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, height: '100%', overflow: 'hidden' }}
    >
      {pane.tabs.length > 0 && (
        <div style={{ flex: '0 0 auto', padding: '4px 6px' }}>
          <TabStrip
            tabs={pane.tabs}
            activeTab={active?.id}
            resolveTitle={resolveTitle}
            labels={labels}
            testId={`tab-strip-${pane.id}`}
            onSelect={selectTab}
            onClose={closeTab}
            onDragStart={(id, event) => onTabDragStart?.(host, id, event)}
          />
        </div>
      )}
      <div style={{ flex: '1 1 auto', minHeight: 0, position: 'relative' }}>
        {pane.tabs.map((tab) => (
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
    </section>
  )
}

function SplitView({ split, ctx }: { split: SplitNode; ctx: SurfaceContext }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState<number[] | null>(null)
  const drag = useRef<{ index: number; start: number; sizes: number[]; total: number } | null>(null)
  const sizes = preview ?? split.sizes

  const axisPoint = (event: PointerEvent<HTMLElement>): number =>
    split.axis === 'row' ? event.clientX : event.clientY

  const onPointerDown = (index: number) => (event: PointerEvent<HTMLDivElement>) => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      index,
      start: axisPoint(event),
      sizes: [...split.sizes],
      total: split.axis === 'row' ? box.width : box.height,
    }
    setPreview([...split.sizes])
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const state = drag.current
    if (!state || state.total <= 0) return
    const delta = (axisPoint(event) - state.start) / state.total
    const next = [...state.sizes]
    const a = next[state.index] ?? 0
    const b = next[state.index + 1] ?? 0
    const min = 0.12
    const moved = Math.min(Math.max(delta, min - a), b - min)
    next[state.index] = a + moved
    next[state.index + 1] = b - moved
    setPreview(next)
  }

  const cancel = (): void => {
    drag.current = null
    setPreview(null)
  }

  const finish = (): void => {
    const state = drag.current
    drag.current = null
    if (!state || !preview) {
      setPreview(null)
      return
    }
    // 只有真正变了才落 op —— 双击/误触不产生历史。
    const changed = preview.some((v, i) => Math.abs(v - (split.sizes[i] ?? 0)) > 0.001)
    setPreview(null)
    if (changed) ctx.controller.dispatch({ kind: 'resize', split: split.id, sizes: preview })
  }

  const nudge = (index: number) => (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.02
    const dir = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    const next = [...split.sizes]
    const a = next[index] ?? 0
    const b = next[index + 1] ?? 0
    const moved = Math.min(Math.max(dir * step, 0.12 - a), b - 0.12)
    next[index] = a + moved
    next[index + 1] = b - moved
    ctx.controller.dispatch({ kind: 'resize', split: split.id, sizes: next })
  }

  return (
    <div
      ref={ref}
      data-split-id={split.id}
      data-axis={split.axis}
      style={{
        display: 'flex',
        flexDirection: split.axis === 'row' ? 'row' : 'column',
        minWidth: 0,
        minHeight: 0,
        height: '100%',
        width: '100%',
      }}
    >
      {split.children.map((child, index) => (
        <Fragment key={child.id}>
          <div
            style={{
              flex: `${sizes[index] ?? 1} 1 0%`,
              minWidth: 0,
              minHeight: 0,
              overflow: 'hidden',
            }}
          >
            <DockSurface node={child} ctx={ctx} />
          </div>
          {index < split.children.length - 1 && (
            <div
              role="separator"
              aria-orientation={split.axis === 'row' ? 'vertical' : 'horizontal'}
              aria-label={ctx.labels.separator}
              tabIndex={0}
              data-separator-index={index}
              onPointerDown={onPointerDown(index)}
              onPointerMove={onPointerMove}
              onPointerUp={finish}
              onPointerCancel={cancel}
              onLostPointerCapture={cancel}
              onDoubleClick={() => {
                const even = split.children.map(() => 1 / split.children.length)
                ctx.controller.dispatch({ kind: 'resize', split: split.id, sizes: even })
              }}
              onKeyDown={nudge(index)}
              style={{
                flex: '0 0 1px',
                alignSelf: 'stretch',
                cursor: split.axis === 'row' ? 'col-resize' : 'row-resize',
                background: 'var(--color-border-tertiary)',
              }}
            />
          )}
        </Fragment>
      ))}
    </div>
  )
}
