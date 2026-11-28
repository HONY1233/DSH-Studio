import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

import type { Tab, TabId } from '../workbench/index.js'

export interface WorkbenchContentEntry {
  readonly tab: Tab
  readonly active: boolean
}

export interface WorkbenchContentLayerProps {
  readonly entries: readonly WorkbenchContentEntry[]
  readonly renderContent: (tab: Tab, active: boolean) => ReactNode
  readonly getTarget: (tabId: TabId) => HTMLElement | null
  readonly parkingRef: RefObject<HTMLDivElement | null>
  /** 目标挂载点注册/注销时递增，用于把稳定宿主移到新位置。 */
  readonly revision: number
}

interface ContentFocusSnapshot {
  readonly active: HTMLElement | null
  readonly ranges: readonly Range[]
}

const pendingFocus = new WeakMap<HTMLDivElement, ContentFocusSnapshot>()

function captureFocus(node: HTMLDivElement): ContentFocusSnapshot {
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const selection = window.getSelection()
  const ranges: Range[] = []
  if (selection && selection.anchorNode && node.contains(selection.anchorNode)) {
    for (let index = 0; index < selection.rangeCount; index += 1) {
      ranges.push(selection.getRangeAt(index).cloneRange())
    }
  }
  return { active: active && node.contains(active) ? active : null, ranges }
}

function restoreFocus(node: HTMLDivElement, snapshot: ContentFocusSnapshot): void {
  if (snapshot.active && node.contains(snapshot.active)) {
    snapshot.active.focus({ preventScroll: true })
  }
  if (snapshot.ranges.length > 0) {
    const selection = window.getSelection()
    if (selection) {
      selection.removeAllRanges()
      for (const range of snapshot.ranges) selection.addRange(range)
    }
  }
}

export function moveContentHost(target: HTMLElement, node: HTMLDivElement): void {
  const snapshot = pendingFocus.get(node) ?? captureFocus(node)
  target.appendChild(node)

  // 先移入隐藏停车区时无法聚焦；等可见目标挂载后再恢复。
  if (target.isConnected && !target.hidden) {
    restoreFocus(node, snapshot)
    pendingFocus.delete(node)
  } else {
    pendingFocus.set(node, snapshot)
  }
}

function PreservedContent({
  entry,
  renderContent,
  getTarget,
  parkingRef,
  revision,
}: {
  entry: WorkbenchContentEntry
  renderContent: WorkbenchContentLayerProps['renderContent']
  getTarget: WorkbenchContentLayerProps['getTarget']
  parkingRef: WorkbenchContentLayerProps['parkingRef']
  revision: number
}): ReactNode {
  const hostRef = useRef<HTMLDivElement | null>(null)
  if (!hostRef.current) {
    const host = document.createElement('div')
    host.dataset.tabContentHost = entry.tab.id
    host.style.display = 'flex'
    host.style.flexDirection = 'column'
    host.style.width = '100%'
    host.style.height = '100%'
    host.style.minHeight = '0'
    host.style.overflow = 'hidden'
    hostRef.current = host
  }
  const host = hostRef.current

  useLayoutEffect(() => () => host.remove(), [host])

  useLayoutEffect(() => {
    const target = getTarget(entry.tab.id) ?? parkingRef.current
    if (target && host.parentElement !== target) moveContentHost(target, host)
  }, [entry.tab.id, getTarget, host, parkingRef, revision])

  return createPortal(renderContent(entry.tab, entry.active), host)
}

/** 每个 tab 只挂载一次；布局变化只移动真实 DOM 宿主，不重建正文。 */
export function WorkbenchContentLayer(props: WorkbenchContentLayerProps): ReactNode {
  const { entries, renderContent, getTarget, parkingRef, revision } = props
  return (
    <>
      {entries.map((entry) => (
        <PreservedContent
          key={entry.tab.id}
          entry={entry}
          renderContent={renderContent}
          getTarget={getTarget}
          parkingRef={parkingRef}
          revision={revision}
        />
      ))}
    </>
  )
}
