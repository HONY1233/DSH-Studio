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
  type LayoutNode,
  type PaneId,
  type Rect,
  type RegionId,
  type SplitId,
  type Tab,
  type TabHostRef,
  type TabId,
  type WorkbenchLayout,
  applyOps,
  ensureWorkbenchRegions,
  findPane,
  panes,
  view,
  workbenchIds,
} from '../workbench/index.js'

import { WorkspaceBackdrop, type BackdropLabels } from './backdrop.js'
import { WorkbenchContentLayer, moveContentHost, type WorkbenchContentEntry } from './content-layer.js'
import type { WorkbenchController } from './controller.js'
import { beginDrag, dragPreview, dropDrag, moveDrag, type DragSession } from './drag.js'
import { DragPreview } from './drag-preview.js'
import { ExclusiveTransferDialog, type ExclusiveTransferDialogLabels } from './exclusive-transfer-dialog.js'
import type { ExclusiveTransferPrompt, ToolTransferDecision } from './exclusive-transfer.js'
import { FloatLayer, type FloatLayerLabels } from './float-layer.js'
import { cloneContentPreview } from './preview.js'
import { RegionBar } from './region-bar.js'
import { DockSurface, type SurfaceContext } from './surface.js'
import type { TabStripLabels } from './tab-strip.js'

export interface WorkbenchLabels {
  readonly tabs: TabStripLabels
  readonly separator: string
  readonly float: FloatLayerLabels
  readonly backdrop: BackdropLabels
  readonly workspace: string
  readonly regions: Readonly<Record<RegionId, string>>
}

export interface ExclusiveTransferBinding {
  readonly prompt: ExclusiveTransferPrompt
  readonly onDecision: (decision: Exclude<ToolTransferDecision, 'cancel'>) => void
  readonly onCancel: () => void
  readonly labels?: ExclusiveTransferDialogLabels
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
  /**
   * 跨会话移动独占工具时的确认框。宿主只有在 reducer 进入 `prompt` 阶段
   * 才传入；没有请求时不渲染任何东西。
   */
  readonly exclusiveTransfer?: ExclusiveTransferBinding
}

const DEFAULT_FLOAT_SIZE = { w: 560, h: 420 }

function topDropTarget(controller: WorkbenchController, session: DragSession): PaneId | undefined {
  if (session.targetHost?.kind === 'pane') return session.targetHost.id as PaneId
  return session.targetPane ?? controller.focusedPane()
}

/** 按渲染树的真实比例求一个 pane 的几何，供“操作后的投影预览”复用。 */
function paneGeometry(node: LayoutNode, paneId: PaneId, rect: Rect): Rect | undefined {
  if (node.kind === 'pane') return node.id === paneId ? rect : undefined
  const vertical = node.axis === 'column'
  const available = vertical ? rect.h : rect.w
  let offset = 0
  for (const [index, child] of node.children.entries()) {
    const length = available * (node.sizes[index] ?? 1 / node.children.length)
    const childRect: Rect = vertical
      ? { ...rect, y: rect.y + offset, h: length }
      : { ...rect, x: rect.x + offset, w: length }
    const found = paneGeometry(child, paneId, childRect)
    if (found) return found
    offset += length
  }
  return undefined
}

/**
 * 顶部落点会分裂指针下的真实 pane，而不是焦点 pane。
 * 先对同一次原子操作做纯投影，再按 compact 后的树计算预览，
 * 避免源格清空后比例变化导致“预览半屏、落定全屏”。
 */
function projectedTopDropRect(
  layout: WorkbenchLayout,
  seed: PaneId,
  session: DragSession,
  target: PaneId,
  mainRect: Rect,
): Rect | undefined {
  if (session.zone?.kind !== 'top' || !findPane(layout.root, target)) return undefined
  const used = workbenchIds(layout)
  let suffix = 0
  let newPane = `drop-preview-pane-${suffix}` as PaneId
  let newSplit = `drop-preview-split-${suffix}` as SplitId
  while (used.has(newPane) || used.has(newSplit)) {
    suffix += 1
    newPane = `drop-preview-pane-${suffix}` as PaneId
    newSplit = `drop-preview-split-${suffix}` as SplitId
  }
  const projected = applyOps(layout, [
    { kind: 'split', pane: target, axis: 'column', at: 'before', newPane, newSplit },
    { kind: 'transferTab', from: session.from, to: { kind: 'pane', id: newPane }, tabId: session.tabId },
  ]).next
  return paneGeometry(view(projected, seed).root, newPane, mainRect)
}

export function WorkbenchView(props: WorkbenchViewProps): ReactNode {
  const { controller, labels, resolveTitle, renderContent, topbar } = props
  const state = useSyncExternalStore(
    useCallback((listener: () => void) => controller.subscribe(listener), [controller]),
    useCallback(() => controller.getState(), [controller]),
  )
  // The layout snapshot does not change when a limit rejects an op, so the
  // overload notice needs its own snapshot to trigger a re-render.
  const limitError = useSyncExternalStore(
    useCallback((listener: () => void) => controller.subscribe(listener), [controller]),
    useCallback(() => controller.limitError(), [controller]),
    useCallback(() => controller.limitError(), [controller]),
  )
  const hostRef = useRef<HTMLDivElement>(null)
  const mainHostRef = useRef<HTMLDivElement>(null)
  const parkingRef = useRef<HTMLDivElement>(null)
  const contentTargets = useRef(new Map<TabId, HTMLDivElement>())
  const [contentRevision, setContentRevision] = useState(0)
  const dragRef = useRef<DragSession | null>(null)
  const dragSourceRef = useRef<HTMLElement | null>(null)
  const [drag, setDrag] = useState<DragSession | null>(null)
  const [previewContent, setPreviewContent] = useState<HTMLElement | null>(null)
  const [previewSourceSize, setPreviewSourceSize] = useState({ w: 640, h: 480 })

  const registerContentTarget = useCallback((tabId: TabId, node: HTMLDivElement | null): void => {
    const previous = contentTargets.current.get(tabId)
    if (previous === node) return
    if (node) {
      contentTargets.current.set(tabId, node)
    } else {
      // React 移除旧 panel 前先把正文宿主移到停车区，避免祖先卸载导致焦点丢失。
      const host = previous?.querySelector<HTMLDivElement>('[data-tab-content-host]')
      if (previous && host && parkingRef.current) moveContentHost(parkingRef.current, host)
      contentTargets.current.delete(tabId)
    }
    setContentRevision((revision) => revision + 1)
  }, [])

  const getContentTarget = useCallback((tabId: TabId): HTMLElement | null => {
    return contentTargets.current.get(tabId) ?? null
  }, [])

  const workRect = (): Rect => {
    if (props.viewport) return props.viewport
    const box = hostRef.current?.getBoundingClientRect()
    return { x: box?.left ?? 0, y: box?.top ?? 0, w: box?.width ?? 1280, h: box?.height ?? 800 }
  }

  const startDrag = (host: TabHostRef, tabId: TabId, event: ReactPointerEvent<HTMLElement>): void => {
    const session = beginDrag({
      tabId,
      from: host,
      start: { x: event.clientX, y: event.clientY },
      size: DEFAULT_FLOAT_SIZE,
    })
    dragSourceRef.current =
      Array.from(hostRef.current?.querySelectorAll<HTMLElement>('[data-tab-content-host]') ?? []).find(
        (node) => node.dataset.tabContentHost === tabId,
      ) ?? null
    setPreviewContent(null)
    dragRef.current = session
    setDrag(session)
  }

  const hostAtPoint = (point: { x: number; y: number }): { host: TabHostRef; rect: Rect; index?: number } | undefined => {
    if (typeof document.elementFromPoint !== 'function') return undefined
    const element = document.elementFromPoint(point.x, point.y)
    const hostElement = element?.closest<HTMLElement>('[data-dock-host]')
    const kind = hostElement?.dataset.hostKind
    const id = hostElement?.dataset.dockHost
    if (!hostElement || !id || (kind !== 'pane' && kind !== 'region' && kind !== 'float')) return undefined
    const box = hostElement.getBoundingClientRect()
    const tabElement = element?.closest<HTMLElement>('[data-tab-id]')
    const tabs = hostElement.querySelectorAll<HTMLElement>('[data-tab-id]')
    const index = tabElement ? Array.from(tabs).indexOf(tabElement) : -1
    return {
      host: { kind, id },
      rect: { x: box.left, y: box.top, w: box.width, h: box.height },
      ...(index >= 0 ? { index } : {}),
    }
  }

  const sameHost = (a: TabHostRef, b: TabHostRef): boolean => a.kind === b.kind && a.id === b.id

  /** 一次 drop 只提交一个原子操作，因此只产生一条历史和一次保存。 */
  const absorb = (session: DragSession, dest: NonNullable<ReturnType<typeof dropDrag>>['dest']): void => {
    if (!dest || dest.to === 'float' || dest.to === 'window') return
    if (dest.to === 'host' || dest.to === 'pane') {
      const host: TabHostRef = dest.to === 'host' ? dest.host : { kind: 'pane', id: dest.pane }
      const index = dest.index
      if (sameHost(host, session.from) && index === undefined) return
      controller.dispatch(
        { kind: 'transferTab', from: session.from, to: host, tabId: session.tabId, index },
        'transfer-tab',
      )
      return
    }
    const regionName = dest.to === 'edge' ? dest.region : dest.corner
    const fixedRegion: RegionId | undefined =
      regionName === 'left' || regionName === 'tl' || regionName === 'bl'
        ? 'sidebar'
        : regionName === 'right' || regionName === 'tr' || regionName === 'br'
          ? 'right'
          : regionName === 'bottom'
            ? 'bottom'
            : undefined
    if (fixedRegion) {
      const pane = ensureWorkbenchRegions(controller.getState()).regions?.[fixedRegion]
      if (pane) {
        controller.dispatch(
          { kind: 'transferTab', from: session.from, to: { kind: 'region', id: pane.id }, tabId: session.tabId },
          'transfer-tab',
        )
      }
      return
    }
    // 顶部保留主区半屏分栏；固定区域不能被再次 split。
    const target = topDropTarget(controller, session)
    if (!target) return
    const newPane = controller.mint.pane()
    const newSplit = controller.mint.split()
    controller.dispatchMany(
      [
        { kind: 'split', pane: target, axis: 'column', at: 'before', newPane, newSplit },
        { kind: 'transferTab', from: session.from, to: { kind: 'pane', id: newPane }, tabId: session.tabId },
      ],
      'absorb',
    )
  }

  useEffect(() => {
    if (!drag) return
    const onMove = (event: PointerEvent): void => {
      const current = dragRef.current
      if (!current) return
      const point = { x: event.clientX, y: event.clientY }
      const target = hostAtPoint(point)
      const regionRects: Partial<Record<RegionId, Rect>> = {}
      for (const region of ['sidebar', 'right', 'bottom'] as const) {
        const element = hostRef.current?.querySelector<HTMLElement>(`[data-region="${region}"]`)
        if (!element) continue
        const box = element.getBoundingClientRect()
        if (box.width <= 0 || box.height <= 0) continue
        regionRects[region] = { x: box.left, y: box.top, w: box.width, h: box.height }
      }
      const next = moveDrag(current, point, workRect(), {
        targetHost: target?.host,
        targetRect: target?.rect,
        targetIndex: target?.index,
        regionRects,
        modifierPaused: event.ctrlKey || event.metaKey,
      })
      if (!current.active && next.active && dragSourceRef.current) {
        const source = dragSourceRef.current
        const box = source.getBoundingClientRect()
        setPreviewSourceSize({
          w: box.width || source.offsetWidth || 640,
          h: box.height || source.offsetHeight || 480,
        })
        setPreviewContent(cloneContentPreview(source))
      }
      dragRef.current = next
      setDrag(next)
    }
    const onUp = (): void => {
      const current = dragRef.current
      dragRef.current = null
      dragSourceRef.current = null
      setPreviewContent(null)
      setDrag(null)
      if (!current) return
      const result = dropDrag(current)
      if (result?.dest) absorb(current, result.dest)
      else if (result?.rect) {
        controller.dispatch(
          {
            kind: 'floatTab',
            from: current.from,
            tabId: current.tabId,
            floatId: controller.mint.float(),
            rect: result.rect,
          },
          'float',
        )
      }
    }
    const cancel = (): void => {
      dragRef.current = null
      dragSourceRef.current = null
      setPreviewContent(null)
      setDrag(null)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') cancel()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('keydown', onKeyDown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null, controller])

  const normalized = ensureWorkbenchRegions(state)
  const seed = (panes(normalized.root)[0]?.id ?? normalized.root.id) as PaneId
  const shown = view(normalized, seed)
  const empty = panes(shown.root).every((p) => p.tabs.length === 0) && normalized.floats.length === 0
  const entriesFor = (host: { tabs: readonly Tab[]; activeTab?: TabId }): WorkbenchContentEntry[] => {
    const active = host.tabs.find((tab) => tab.id === host.activeTab) ?? host.tabs[host.tabs.length - 1]
    return host.tabs.map((tab) => ({ tab, active: tab.id === active?.id }))
  }
  const contentEntries: WorkbenchContentEntry[] = [
    ...panes(normalized.root).flatMap(entriesFor),
    ...Object.values(normalized.regions ?? {}).flatMap(entriesFor),
    ...normalized.floats.flatMap(entriesFor),
  ]

  const ctx: SurfaceContext = {
    controller,
    resolveTitle,
    renderContent,
    labels: { ...labels.tabs, separator: labels.separator },
    onTabDragStart: startDrag,
    onContentTarget: registerContentTarget,
  }

  const dropPreview = drag ? dragPreview(drag) : undefined
  const hostBox = hostRef.current?.getBoundingClientRect()
  const mainBox = mainHostRef.current?.getBoundingClientRect()
  const mainRect: Rect = mainBox && mainBox.width > 0 && mainBox.height > 0
    ? { x: mainBox.left, y: mainBox.top, w: mainBox.width, h: mainBox.height }
    : workRect()
  const topTarget = drag?.zone?.kind === 'top' ? topDropTarget(controller, drag) : undefined
  const projectedTop = drag && topTarget
    ? projectedTopDropRect(normalized, seed, drag, topTarget, mainRect)
    : undefined
  const previewRect = dropPreview
    ? {
        ...(projectedTop ?? dropPreview.rect),
        x: (projectedTop ?? dropPreview.rect).x - (props.viewport?.x ?? hostBox?.left ?? 0),
        y: (projectedTop ?? dropPreview.rect).y - (props.viewport?.y ?? hostBox?.top ?? 0),
      }
    : undefined
  return (
    <div
      data-testid="workbench"
      data-drop-host="workbench"
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

      {limitError ? (
        <div
          role="alert"
          data-testid="workbench-limit"
          data-code={limitError.code}
          style={{
            position: 'absolute',
            top: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 40,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            maxWidth: 'min(560px, calc(100% - 24px))',
            padding: '8px 12px',
            borderRadius: 8,
            background: 'var(--color-bg-elevated, #1f1f1f)',
            border: '1px solid var(--color-border-danger, #b3261e)',
            color: 'var(--color-text-primary, #f3f3f3)',
            boxShadow: '0 6px 20px rgba(0, 0, 0, 0.35)',
            fontSize: 12,
          }}
        >
          <span style={{ flex: '1 1 auto', minWidth: 0 }}>{limitError.message}</span>
          <button
            type="button"
            onClick={() => controller.clearLimitError()}
            style={{ flex: '0 0 auto', fontSize: 12, cursor: 'pointer' }}
          >
            知道了
          </button>
        </div>
      ) : null}

      <div ref={hostRef} style={{ display: 'flex', flex: '1 1 auto', minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        {normalized.regions?.sidebar ? (
          <RegionBar
            region="sidebar"
            pane={normalized.regions.sidebar}
            ctx={ctx}
            label={labels.regions.sidebar}
            separatorLabel={labels.separator}
            size={normalized.regionSizes?.sidebar}
            onResize={(size) => controller.dispatch({ kind: 'resizeRegion', region: 'sidebar', ...(size === undefined ? {} : { sizes: size }) }, 'resize-region')}
          />
        ) : null}
        <div
          style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minWidth: 0, minHeight: 0, position: 'relative' }}
        >
          <div
            ref={mainHostRef}
            data-empty-main-host={empty ? 'true' : undefined}
            data-dock-host={seed}
            data-host-kind="pane"
            style={{ flex: '1 1 auto', minHeight: 0, position: 'relative' }}
          >
            <DockSurface node={shown.root} ctx={ctx} />
            {empty ? (
              <div style={{ position: 'absolute', inset: 0 }}>
                <WorkspaceBackdrop
                  labels={labels.backdrop}
                  recent={props.recent}
                  onNewConversation={() => props.onNewConversation?.()}
                  onOpenPanel={() => props.onOpenPanel?.()}
                  onOpenRecent={props.onOpenRecent}
                />
              </div>
            ) : null}
          </div>
          {normalized.regions?.bottom ? (
            <RegionBar
              region="bottom"
              pane={normalized.regions.bottom}
              ctx={ctx}
              label={labels.regions.bottom}
              separatorLabel={labels.separator}
              size={normalized.regionSizes?.bottom}
              onResize={(size) => controller.dispatch({ kind: 'resizeRegion', region: 'bottom', ...(size === undefined ? {} : { sizes: size }) }, 'resize-region')}
            />
          ) : null}
        </div>
        {normalized.regions?.right ? (
          <RegionBar
            region="right"
            pane={normalized.regions.right}
            ctx={ctx}
            label={labels.regions.right}
            separatorLabel={labels.separator}
            size={normalized.regionSizes?.right}
            onResize={(size) => controller.dispatch({ kind: 'resizeRegion', region: 'right', ...(size === undefined ? {} : { sizes: size }) }, 'resize-region')}
          />
        ) : null}

        <FloatLayer
          controller={controller}
          floats={state.floats}
          minimized={state.minimized}
          viewport={workRect()}
          resolveTitle={resolveTitle}
          renderContent={renderContent}
          labels={labels.float}
          onContentTarget={registerContentTarget}
          onTabDragStart={startDrag}
        />

        {dropPreview && previewRect && (
          <DragPreview
            kind={dropPreview.kind}
            rect={previewRect}
            content={previewContent}
            sourceSize={previewSourceSize}
          />
        )}
      </div>

      <div ref={parkingRef} hidden data-content-parking="true" />
      <WorkbenchContentLayer
        entries={contentEntries}
        renderContent={renderContent}
        getTarget={getContentTarget}
        parkingRef={parkingRef}
        revision={contentRevision}
      />
      {props.exclusiveTransfer ? (
        <ExclusiveTransferDialog
          prompt={props.exclusiveTransfer.prompt}
          onDecision={props.exclusiveTransfer.onDecision}
          onCancel={props.exclusiveTransfer.onCancel}
          labels={props.exclusiveTransfer.labels}
        />
      ) : null}
    </div>
  )
}

/** 供上层判断是否需要渲染顶栏标签模式（全部对话都在窗口里）。 */
export function hasOnlyFloatWindows(layout: WorkbenchLayout): boolean {
  const normalized = ensureWorkbenchRegions(layout)
  return panes(normalized.root).every((p) => p.tabs.length === 0)
    && Object.values(normalized.regions ?? {}).every((pane) => pane.tabs.length === 0)
    && normalized.floats.some((f) => f.tabs.length > 0)
}
