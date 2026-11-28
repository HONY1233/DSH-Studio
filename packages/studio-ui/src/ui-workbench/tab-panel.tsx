import { useCallback, type ReactNode } from 'react'

import type { TabId } from '../workbench/index.js'

export interface TabPanelProps {
  readonly tabId: TabId
  readonly active: boolean
  readonly registerTarget?: (tabId: TabId, node: HTMLDivElement | null) => void
  readonly children?: ReactNode
}

/**
 * 正文挂载点。WorkbenchView 会把每个 tab 的稳定内容宿主移进这里；
 * 单独渲染 DockSurface 时仍可通过 children 使用旧的直接渲染方式。
 */
export function TabPanel({ tabId, active, registerTarget, children }: TabPanelProps): ReactNode {
  const ref = useCallback(
    (node: HTMLDivElement | null) => registerTarget?.(tabId, node),
    [registerTarget, tabId],
  )

  return (
    <div
      ref={ref}
      role="tabpanel"
      data-tab-panel={tabId}
      hidden={!active}
      style={{ height: '100%', minHeight: 0, overflow: 'hidden' }}
    >
      {children}
    </div>
  )
}
