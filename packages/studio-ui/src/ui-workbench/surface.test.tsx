// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useSyncExternalStore } from 'react'

import { makeTab, type Tab } from '../workbench/index.js'

import { createEmptyController, type WorkbenchController } from './controller.js'
import { createWorkbenchLabels } from './labels.js'
import { DockSurface, type SurfaceContext } from './surface.js'

const labels = createWorkbenchLabels('zh')

function useController(controller: WorkbenchController) {
  const state = useSyncExternalStore(
    (l) => controller.subscribe(l),
    () => controller.getState(),
  )
  return state
}

function Harness({ controller }: { controller: WorkbenchController }) {
  const state = useController(controller)
  const ctx: SurfaceContext = {
    controller,
    resolveTitle: (tab) => tab.title ?? tab.ref.contentId,
    renderContent: (tab: Tab, active: boolean) => (
      <div data-testid={`content-${tab.ref.contentId}`}>{`${tab.ref.contentId}:${active ? 'on' : 'off'}`}</div>
    ),
    labels: { ...labels.tabs, separator: labels.separator },
  }
  return <DockSurface node={state.root} ctx={ctx} />
}

function setup() {
  const controller = createEmptyController()
  const pane = controller.focusedPane()
  if (!pane) throw new Error('no pane')
  controller.dispatch({
    kind: 'insertTab',
    pane,
    tab: makeTab(controller.mint.tab(), { kind: 'panel', contentId: 'A', instanceId: 'A' }, 'A'),
  })
  controller.dispatch({
    kind: 'insertTab',
    pane,
    tab: makeTab(controller.mint.tab(), { kind: 'panel', contentId: 'B', instanceId: 'B' }, 'B'),
  })
  const second = controller.mint.pane()
  const split = controller.mint.split()
  controller.dispatch({ kind: 'split', pane, axis: 'row', at: 'after', newPane: second, newSplit: split })
  controller.dispatch({
    kind: 'insertTab',
    pane: second,
    tab: makeTab(controller.mint.tab(), { kind: 'panel', contentId: 'C', instanceId: 'C' }, 'C'),
  })
  return { controller, pane, second, split }
}

describe('DockSurface', () => {
  it('分裂后每个格各有标签条', () => {
    const { controller } = setup()
    render(<Harness controller={controller} />)
    expect(screen.getAllByRole('tablist')).toHaveLength(2)
  })

  it('同格内非活动标签保持挂载，只是 hidden', () => {
    const { controller } = setup()
    render(<Harness controller={controller} />)

    const a = screen.getByTestId('content-A').closest('[role="tabpanel"]')
    const b = screen.getByTestId('content-B').closest('[role="tabpanel"]')
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    // B 是后插入的，默认活动；A 保持挂载但隐藏。
    expect(a?.hasAttribute('hidden')).toBe(true)
    expect(b?.hasAttribute('hidden')).toBe(false)
  })

  it('点击标签切换活动项，不重建内容节点', () => {
    const { controller } = setup()
    render(<Harness controller={controller} />)
    const before = screen.getByTestId('content-A')

    fireEvent.click(screen.getByText('A'))

    const after = screen.getByTestId('content-A')
    expect(after).toBe(before)
    expect(after.closest('[role="tabpanel"]')?.hasAttribute('hidden')).toBe(false)
    expect(after.textContent).toBe('A:on')
  })

  it('关闭标签后从 DOM 移除', () => {
    const { controller } = setup()
    render(<Harness controller={controller} />)
    fireEvent.click(screen.getByLabelText('关闭 A'))
    expect(screen.queryByTestId('content-A')).toBeNull()
    expect(screen.getByTestId('content-B')).toBeDefined()
  })

  it('分隔条可键盘调整比例，且只落一次 op', () => {
    const { controller, split, pane } = setup()
    render(<Harness controller={controller} />)
    const before = controller.getState()

    const separator = screen.getByRole('separator')
    fireEvent.keyDown(separator, { key: 'ArrowRight' })

    const after = controller.getState()
    expect(after).not.toBe(before)
    const root = after.root
    expect(root.kind).toBe('split')
    if (root.kind === 'split' && root.id === split) {
      expect(root.sizes[0]).toBeGreaterThan(0.5)
    }
    // 键盘微调也应该可以撤销
    expect(controller.canUndo()).toBe(true)
    controller.undo()
    expect(JSON.stringify(controller.getState().root)).toBe(JSON.stringify(before.root))
    expect(pane).toBeTruthy()
  })

  it('双击分隔条恢复均分', () => {
    const { controller, split } = setup()
    controller.dispatch({ kind: 'resize', split, sizes: [0.8, 0.2] })
    render(<Harness controller={controller} />)

    fireEvent.doubleClick(screen.getByRole('separator'))
    const root = controller.getState().root
    if (root.kind === 'split') expect(root.sizes[0]).toBeCloseTo(0.5, 5)
  })
})
