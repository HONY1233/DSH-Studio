/**
 * WorkbenchView —— 工作台合成层。
 *
 * 组成：顶栏（可注入） + 停靠面 / 空态背景 + 浮窗层 + 拖动预览。
 *
 * 本组件只认识 `WorkbenchController` 与两个渲染回调
 * （`resolveTitle` / `renderContent`），不知道任何具体面板或会话实现。
 * 这是门禁规则「ui-workbench 不得 import 具体面板」的落地方式。
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'

import {
  type PaneId,
  type Rect,
  type Tab,
  type TabId,
  type WorkbenchLayout,
  panes,
  view,
} from '../workbench/index.js'

import { WorkspaceBackdrop, type BackdropLabels } from './backdrop.js'
import type { WorkbenchController } from './controller.js'
import { beginDrag, dragPreview, dropDrag, moveDrag, type DragSession } from './drag.js'
import { FloatLayer, type FloatLayerLabels } from './float-layer.js'
import { DockSurface, type SurfaceContext } from './surface.js'
import type { TabStripLabels } from './tab-strip.js'

export interface WorkbenchLabels {
  readonly tabs: TabStripLabels
  readonly separator: string
  readonly float: FloatLayerLabels
  readonly backdrop: BackdropLabels
  readonly workspace: string
}

export interface WorkbenchViewProps {
  readonly controller: WorkbenchController
  readonly labels: WorkbenchLabels
  readonly resolveTitle: (tab: Tab) => string
  readonly renderContent: (tab: Tab, active: boolean) => ReactNode
  readonly topbar?: ReactNode
  /** 工作区几何；缺省时读容器实测尺寸。拖动吸附需要它。 */
  readonly viewport?: Rect
  readonly recent?: readonly { readonly id: string; readonly title: string }[]
  readonly onNewConversation?: () => void
  readonly onOpenPanel?: () => void
  readonly onOpenRecent?: (id: string) => void
}

const DEFAULT_FLOAT_SIZE = { w: 560, h: 420 }

export function WorkbenchView(props: WorkbenchViewProps): ReactNode {
  const { controller, labels, resolveTitle, renderContent, topbar } = props
  const state = useSyncExternalStore(
    useCallback((listener: () => void) => controller.subscribe(listener), [controller]),
    useCallback(() => controller.getState(), [controller]),
  )
  const hostRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<DragSession | null>(null)

  const workRect = (): Rect => {
    if (props.viewport) return props.viewport
    const box = hostRef.current?.getBoundingClientRect()
    return { x: box?.left ?? 0, y: box?.top ?? 0, w: box?.width ?? 1280, h: box?.height ?? 800 }
  }

  const startDrag = (pane: PaneId, tabId: TabId, event: ReactPointerEvent<HTMLElement>): void => {
    setDrag(
      beginDrag({
        tabId,
        from: pane,
        start: { x: event.clientX, y: event.clientY },
        size: DEFAULT_FLOAT_SIZE,
      }),
    )
  }

  /** 吸附落定 = 分裂 + 把标签移进新格，一次手势合成一条历史。 */
  const absorb = (session: DragSession, dest: NonNullable<ReturnType<typeof dropDrag>>['dest']): void => {
    if (!dest || dest.to === 'pane' || dest.to === 'float' || dest.to === 'window') return
    const target = controller.focusedPane()
    if (!target) return
    const region = dest.to === 'edge' ? dest.region : dest.corner
    const axis: 'row' | 'column' = region === 'left' || region === 'right' ? 'row' : 'column'
    const at: 'before' | 'after' = region === 'left' || region === 'tl' || region === 'top' ? 'before' : 'after'
    const newPane = controller.mint.pane()
    const newSplit = controller.mint.split()
    controller.dispatchMany(
      [
        { kind: 'split', pane: target, axis, at, newPane, newSplit },
        { kind: 'moveTab', from: session.from as PaneId, to: newPane, tabId: session.tabId },
      ],
      'absorb',
    )
  }

  useEffect(() => {
    if (!drag) return
    const onMove = (event: PointerEvent): void => {
      setDrag((current) =>
        current ? moveDrag(current, { x: event.clientX, y: event.clientY }, workRect()) : current,
      )
    }
    const onUp = (): void => {
      setDrag((current) => {
        if (!current) return null
        const result = dropDrag(current)
        if (result?.dest) absorb(current, result.dest)
        else if (result?.rect) {
          controller.dispatch(
            {
              kind: 'floatTabs',
              pane: current.from as PaneId,
              tabIds: [current.tabId],
              floatId: controller.mint.float(),
              rect: result.rect,
            },
            'float',
          )
        }
        return null
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null, controller])

  const seed = (panes(state.root)[0]?.id ?? state.root.id) as PaneId
  const shown = view(state, seed)
  const empty = panes(shown.root).every((p) => p.tabs.length === 0) && state.floats.length === 0

  const ctx: SurfaceContext = {
    controller,
    resolveTitle,
    renderContent,
    labels: { ...labels.tabs, separator: labels.separator },
    onTabDragStart: startDrag,
  }

  const preview = drag ? dragPreview(drag) : undefined

  return (
    <div
      data-testid="workbench"
      data-empty={empty ? 'true' : 'false'}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, position: 'relative' }}
    >
      <div style={{ flex: '0 0 auto', minHeight: 28 }} data-testid="workbench-topbar">
        {topbar ?? (
          <div style={{ fontSize: 12, padding: '6px 10px', color: 'var(--color-text-tertiary)' }}>
            {labels.workspace}
          </div>
        )}
      </div>

      <div ref={hostRef} style={{ flex: '1 1 auto', minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        {empty ? (
          <WorkspaceBackdrop
            labels={labels.backdrop}
            recent={props.recent}
            onNewConversation={() => props.onNewConversation?.()}
            onOpenPanel={() => props.onOpenPanel?.()}
            onOpenRecent={props.onOpenRecent}
          />
        ) : (
          <DockSurface node={shown.root} ctx={ctx} />
        )}

        <FloatLayer
          controller={controller}
          floats={state.floats}
          minimized={state.minimized}
          viewport={workRect()}
          resolveTitle={resolveTitle}
          renderContent={renderContent}
          labels={labels.float}
        />

        {preview && (
          <div
            data-drag-preview={preview.kind}
            style={{
              position: 'absolute',
              left: preview.rect.x - (props.viewport?.x ?? hostRef.current?.getBoundingClientRect().left ?? 0),
              top: preview.rect.y - (props.viewport?.y ?? hostRef.current?.getBoundingClientRect().top ?? 0),
              width: preview.rect.w,
              height: preview.rect.h,
              pointerEvents: 'none',
              border: '1px dashed var(--color-border-primary)',
              borderRadius: 8,
              background: 'color-mix(in srgb, var(--color-background-info) 40%, transparent)',
              zIndex: 50,
            }}
          />
        )}
      </div>
    </div>
  )
}

/** 供上层判断是否需要渲染顶栏标签模式（全部对话都在窗口里）。 */
export function hasOnlyFloatWindows(layout: WorkbenchLayout): boolean {
  return panes(layout.root).every((p) => p.tabs.length === 0) && layout.floats.some((f) => f.tabs.length > 0)
}
