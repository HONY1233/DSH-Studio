// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'

import { type Tab, type TabId, createMint, makeTab } from '../workbench/index.js'

import { TabStrip } from './tab-strip.js'

const ref = (id: string) => ({ kind: 'panel' as const, contentId: id, instanceId: id })

function tabs(count: number): Tab[] {
  const mint = createMint('s')
  return Array.from({ length: count }, (_, i) => makeTab(mint.tab(), ref(`p${i}`), `P${i}`))
}

const labels = { list: '标签', close: (title: string) => `关闭 ${title}` }

describe('TabStrip', () => {
  it('渲染全部标签并标记选中项', () => {
    const list = tabs(3)
    render(
      <TabStrip
        tabs={list}
        activeTab={list[1]?.id}
        resolveTitle={(t) => t.title ?? ''}
        labels={labels}
        onSelect={() => {}}
        onClose={() => {}}
      />,
    )
    const chips = screen.getAllByRole('tab')
    expect(chips).toHaveLength(3)
    expect(chips[1]?.getAttribute('aria-selected')).toBe('true')
    expect(chips[0]?.getAttribute('aria-selected')).toBe('false')
  })

  it('点击切换，关闭按钮不触发切换', () => {
    const list = tabs(2)
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(
      <TabStrip
        tabs={list}
        activeTab={list[0]?.id}
        resolveTitle={(t) => t.title ?? ''}
        labels={labels}
        onSelect={onSelect}
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByText('P1'))
    expect(onSelect).toHaveBeenCalledWith(list[1]?.id)

    onSelect.mockClear()
    fireEvent.click(screen.getByLabelText('关闭 P0'))
    expect(onClose).toHaveBeenCalledWith(list[0]?.id)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('中键点击任意位置关闭', () => {
    const list = tabs(1)
    const onClose = vi.fn()
    render(
      <TabStrip
        tabs={list}
        activeTab={list[0]?.id}
        resolveTitle={(t) => t.title ?? ''}
        labels={labels}
        onSelect={() => {}}
        onClose={onClose}
      />,
    )
    // RTL 没有 auxClick 快捷方法，手动派发中键事件。
    fireEvent(screen.getByText('P0'), new MouseEvent('auxclick', { bubbles: true, button: 1 }))
    expect(onClose).toHaveBeenCalledWith(list[0]?.id)
  })

  it('方向键只移动焦点，不切换', () => {
    const list = tabs(3)
    const onSelect = vi.fn()
    render(
      <TabStrip
        tabs={list}
        activeTab={list[0]?.id}
        resolveTitle={(t) => t.title ?? ''}
        labels={labels}
        onSelect={onSelect}
        onClose={() => {}}
      />,
    )
    const chips = screen.getAllByRole('tab')
    chips[0]?.focus()
    fireEvent.keyDown(chips[0] as HTMLElement, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(chips[1])
    expect(onSelect).not.toHaveBeenCalled()

    fireEvent.keyDown(chips[1] as HTMLElement, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(list[1]?.id)
  })

  it('Home / End 跳到首尾并循环', () => {
    const list = tabs(3)
    render(
      <TabStrip
        tabs={list}
        activeTab={list[1]?.id}
        resolveTitle={(t) => t.title ?? ''}
        labels={labels}
        onSelect={() => {}}
        onClose={() => {}}
      />,
    )
    const chips = screen.getAllByRole('tab')
    chips[1]?.focus()
    fireEvent.keyDown(chips[1] as HTMLElement, { key: 'End' })
    expect(document.activeElement).toBe(chips[2])
    fireEvent.keyDown(chips[2] as HTMLElement, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(chips[0])
  })

  it('受控切换后 tabIndex 跟着走', () => {
    const list = tabs(2)
    function Host() {
      const [active, setActive] = useState<TabId | undefined>(list[0]?.id)
      return (
        <TabStrip
          tabs={list}
          activeTab={active}
          resolveTitle={(t) => t.title ?? ''}
          labels={labels}
          onSelect={setActive}
          onClose={() => {}}
        />
      )
    }
    render(<Host />)
    const chips = screen.getAllByRole('tab')
    expect(chips[0]?.getAttribute('tabindex')).toBe('0')
    fireEvent.click(chips[1] as HTMLElement)
    expect(chips[0]?.getAttribute('tabindex')).toBe('-1')
    expect(chips[1]?.getAttribute('tabindex')).toBe('0')
  })
})
