/**
 * 左栏 —— 真实会话列表。
 *
 * 为什么不复用官方 sidebar：我们需要知道「当前选中的是哪场会话」，
 * 官方把 selection 放在 Session Controller 内部，从 root scope 拿不到它的
 * 受控值；而 `main` 槽的 `session-maybe` scope props 只注入给注册在该 scope
 * 的组件，工作台是 root scope，用不上。
 *
 * 所以左栏由我们接管，选中态就是「工作台焦点格的 activeTab」——
 * 单一真相，不需要和官方 selection 做双向同步。
 */

import { useCallback, useMemo, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'

import type { WorkbenchController } from '../ui-workbench/controller.js'
import { panes } from '../workbench/layout.js'
import { sessionIdOf } from '../ui-session-views/session-tab-view.js'
import type { SessionListLike } from './main-panel.js'

export interface SidebarProps {
  readonly collapsed?: boolean
  readonly width?: number
  readonly drawer?: boolean
  readonly list: SessionListLike
  readonly controller: WorkbenchController
  readonly onOpenSession: (sessionId: string) => void
  readonly onNewConversation: () => void
  readonly onCreateFailed?: (error: unknown) => void
}

const S = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 8px 8px',
    background: 'var(--color-background-primary, #faf9f6)',
    color: 'var(--color-text-primary, #2c2c2a)',
    fontSize: 13,
    lineHeight: 1.5,
    borderRight: '1px solid var(--color-border-tertiary, rgba(0,0,0,.08))',
    fontFamily: 'var(--font-sans, system-ui, sans-serif)',
  } satisfies CSSProperties,
  brand: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 6,
    padding: '2px 8px 12px',
  } satisfies CSSProperties,
  newButton: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    width: '100%',
    boxSizing: 'border-box',
    padding: '7px 9px',
    marginBottom: 14,
    border: '1px solid var(--color-border-secondary, rgba(0,0,0,.1))',
    borderRadius: 8,
    background: 'var(--color-background-secondary, #fff)',
    color: 'inherit',
    fontSize: 13,
    fontFamily: 'inherit',
    cursor: 'pointer',
    textAlign: 'left',
  } satisfies CSSProperties,
  group: { padding: '0 8px 6px', fontSize: 11, color: 'var(--color-text-tertiary, #888780)' } satisfies CSSProperties,
  list: { flex: '1 1 auto', overflowY: 'auto', minHeight: 0 } satisfies CSSProperties,
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    padding: '6px 9px',
    borderRadius: 7,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  } satisfies CSSProperties,
  itemActive: { background: 'rgba(0,0,0,.075)', fontWeight: 500 } satisfies CSSProperties,
  dot: { width: 5, height: 5, borderRadius: '50%', background: '#b4b2a9', flex: 'none' } satisfies CSSProperties,
  title: { overflow: 'hidden', textOverflow: 'ellipsis' } satisfies CSSProperties,
  empty: { padding: '10px 9px', fontSize: 12, color: 'var(--color-text-tertiary, #888780)' } satisfies CSSProperties,
} as const

/** 当前焦点格的 activeTab 指向哪个会话。 */
function activeSessionOf(controller: WorkbenchController): string | undefined {
  const state = controller.getState()
  const focused = state.focused
  const all = panes(state.root)
  const pane = all.find((p) => p.id === focused) ?? all[0]
  if (!pane) return undefined
  const active = pane.tabs.find((tab) => tab.id === pane.activeTab) ?? pane.tabs[pane.tabs.length - 1]
  return active ? sessionIdOf(active.ref) : undefined
}

export function StudioSidebar(props: SidebarProps): ReactNode {
  const { list, controller } = props

  const subscribe = useCallback((listener: () => void) => list.subscribe(listener), [list])
  const getSnapshot = useCallback(() => list.getSnapshot(), [list])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const subscribeController = useCallback(
    (listener: () => void) => controller.subscribe(listener),
    [controller],
  )
  const getControllerState = useCallback(() => controller.getState(), [controller])
  useSyncExternalStore(subscribeController, getControllerState, getControllerState)
  const activeSessionId = activeSessionOf(controller)

  const rows = useMemo(
    () =>
      snapshot.ids.map((rawId) => {
        const id = String(rawId)
        const row = snapshot.byId[id]
        const title = row?.displayTitle ?? row?.title ?? id.slice(0, 8)
        return { id, title }
      }),
    [snapshot],
  )

  if (props.collapsed === true) {
    return (
      <div style={{ ...S.root, padding: '10px 4px', alignItems: 'center' }}>
        <div style={{ fontSize: 15 }}>W</div>
      </div>
    )
  }

  return (
    <div style={S.root} data-testid="studio-sidebar" data-session-count={rows.length}>
      <div style={S.brand}>
        <span style={{ fontSize: 13, fontWeight: 500, letterSpacing: '.02em' }}>Stock Workbench</span>
        <span
          style={{
            fontSize: 10,
            padding: '1px 5px',
            borderRadius: 4,
            background: 'rgba(0,0,0,.06)',
            color: '#5f5e5a',
          }}
        >
          studio
        </span>
      </div>

      <button type="button" style={S.newButton} onClick={props.onNewConversation}>
        <span style={{ fontSize: 14, lineHeight: 1 }}>+</span>
        <span>新建会话</span>
      </button>

      <div style={S.group}>会话</div>

      <div style={S.list}>
        {rows.length === 0 ? (
          <div style={S.empty}>还没有会话</div>
        ) : (
          rows.map((row) => (
            <div
              key={row.id}
              data-testid="sidebar-item"
              data-session-id={row.id}
              data-active={row.id === activeSessionId ? 'true' : 'false'}
              style={{ ...S.item, ...(row.id === activeSessionId ? S.itemActive : null) }}
              onClick={() => props.onOpenSession(row.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') props.onOpenSession(row.id)
              }}
              role="button"
              tabIndex={0}
            >
              <span style={S.dot} />
              <span style={S.title}>{row.title}</span>
            </div>
          ))
        )}
      </div>

      <div
        style={{
          borderTop: '1px solid var(--color-border-tertiary, rgba(0,0,0,.07))',
          marginTop: 8,
          padding: '8px 8px 0',
          fontSize: 12,
          color: 'var(--color-text-secondary, #5f5e5a)',
        }}
      >
        设置 · 工作区
      </div>
    </div>
  )
}
