/**
 * 标签条 —— 遵循 WAI-ARIA tabs 的手动激活模式：
 * - 方向键只移动焦点，不切换；
 * - Enter / Space 才切换；
 * - 中键点击任意位置关闭（与关闭按钮同一意图）；
 * - chip 让位（可收缩），尾部控件永不让位。
 */

import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

import type { Tab, TabId } from '../workbench/index.js'

export interface TabStripLabels {
  readonly list: string
  readonly close: (title: string) => string
}

export interface TabStripProps {
  readonly tabs: readonly Tab[]
  readonly activeTab?: TabId
  readonly resolveTitle: (tab: Tab) => string
  readonly labels: TabStripLabels
  readonly onSelect: (id: TabId) => void
  readonly onClose: (id: TabId) => void
  readonly onDragStart?: (id: TabId, event: PointerEvent<HTMLElement>) => void
  readonly trailing?: ReactNode
  readonly testId?: string
}

export function TabStrip(props: TabStripProps): ReactNode {
  const { tabs, activeTab, resolveTitle, labels, onSelect, onClose, onDragStart, trailing, testId } = props
  const chips = useRef(new Map<string, HTMLDivElement>())

  const focusAt = (index: number): void => {
    const list = tabs
    if (list.length === 0) return
    const wrapped = ((index % list.length) + list.length) % list.length
    const id = list[wrapped]?.id
    if (id) chips.current.get(id)?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number, tab: Tab): void => {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault()
        focusAt(index + 1)
        break
      case 'ArrowLeft':
        event.preventDefault()
        focusAt(index - 1)
        break
      case 'Home':
        event.preventDefault()
        focusAt(0)
        break
      case 'End':
        event.preventDefault()
        focusAt(tabs.length - 1)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        onSelect(tab.id)
        break
      default:
        break
    }
  }

  return (
    <div
      role="tablist"
      aria-label={labels.list}
      data-testid={testId ?? 'tab-strip'}
      data-dockkit-strip-scroll="true"
      style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, overflowX: 'auto' }}
    >
      {tabs.map((tab, index) => {
        const selected = tab.id === activeTab
        const title = resolveTitle(tab)
        return (
          <div
            key={tab.id}
            ref={(node) => {
              if (node) chips.current.set(tab.id, node)
              else chips.current.delete(tab.id)
            }}
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            data-tab-id={tab.id}
            data-active={selected ? 'true' : 'false'}
            title={title}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index, tab)}
            onAuxClick={(event) => {
              // 中键关闭；不抢主键拖动。
              if (event.button === 1) {
                event.preventDefault()
                onClose(tab.id)
              }
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              onDragStart?.(tab.id, event)
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              flex: '0 1 auto',
              minWidth: 80,
              maxWidth: 220,
              padding: '4px 8px',
              borderRadius: 8,
              cursor: 'default',
              // chip 是标签条里唯一会收缩的部分。
              overflow: 'hidden',
              background: selected ? 'var(--color-background-primary)' : 'transparent',
              border: `0.5px solid ${selected ? 'var(--color-border-secondary)' : 'transparent'}`,
              color: selected ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
              userSelect: 'none',
            }}
          >
            <span
              style={{
                flex: '1 1 auto',
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 12,
              }}
            >
              {title}
            </span>
            <button
              type="button"
              aria-label={labels.close(title)}
              onClick={(event) => {
                event.stopPropagation()
                onClose(tab.id)
              }}
              onPointerDown={(event) => event.stopPropagation()}
              style={{
                flex: '0 0 auto',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: 'inherit',
                fontSize: 12,
                lineHeight: 1,
                padding: 2,
              }}
            >
              ×
            </button>
          </div>
        )
      })}
      {trailing}
    </div>
  )
}
