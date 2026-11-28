// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEffect, useSyncExternalStore } from 'react'

import { findPane, panes, view, type Tab } from '../workbench/index.js'

import { createEmptyController, type WorkbenchController } from './controller.js'
import { beginToolTransfer, type ExclusiveTransferPrompt } from './exclusive-transfer.js'
import { createWorkbenchLabels } from './labels.js'
import { WorkbenchView } from './workbench-view.js'

const labels = createWorkbenchLabels('zh')

function renderView(controller: WorkbenchController, extra: Partial<Parameters<typeof WorkbenchView>[0]> = {}) {
  return render(
    <WorkbenchView
      controller={controller}
      labels={labels}
      resolveTitle={(tab: Tab) => tab.title ?? tab.ref.contentId}
      renderContent={(tab, active) => (
        <div data-testid={`panel-${tab.ref.contentId}`}>{`${tab.ref.contentId}:${active ? 'on' : 'off'}`}</div>
      )}
      viewport={{ x: 0, y: 0, w: 1200, h: 800 }}
      {...extra}
    />,
  )
}

describe('WorkbenchView 空态', () => {
  it('没有内容时显示工作区背景，而不是空白', () => {
    const controller = createEmptyController()
    renderView(controller)
    expect(screen.getByTestId('workspace-backdrop')).toBeDefined()
    expect(screen.getByText('当前没有打开的对话')).toBeDefined()
  })

  it('空态提供新建与打开面板两个入口', () => {
    const controller = createEmptyController()
    const onNew = vi.fn()
    const onPanel = vi.fn()
    renderView(controller, { onNewConversation: onNew, onOpenPanel: onPanel })

    fireEvent.click(screen.getByText('新建对话'))
    fireEvent.click(screen.getByText('打开面板'))
    expect(onNew).toHaveBeenCalledTimes(1)
    expect(onPanel).toHaveBeenCalledTimes(1)
  })

  it('关掉最后一个标签后回到空态，且不自动新建', () => {
    const controller = createEmptyController()
    const pane = controller.focusedPane()
    if (!pane) throw new Error('no pane')
    controller.dispatch({
      kind: 'insertTab',
      pane,
      tab: { id: controller.mint.tab(), ref: { kind: 'conversation', contentId: 's1', instanceId: 's1' }, title: '会话 1' },
    })

    renderView(controller)
    expect(screen.queryByTestId('workspace-backdrop')).toBeNull()

    fireEvent.click(screen.getByLabelText('关闭 会话 1'))
    expect(screen.getByTestId('workspace-backdrop')).toBeDefined()
    expect(screen.queryByTestId('panel-s1')).toBeNull()
    expect(document.querySelector('[data-tab-content-host]')).toBeNull()
  })
})

describe('WorkbenchView 浮窗', () => {
  function withFloat() {
    const controller = createEmptyController()
    const pane = controller.focusedPane()
    if (!pane) throw new Error('no pane')
    const tab = {
      id: controller.mint.tab(),
      ref: { kind: 'panel' as const, contentId: 'git', instanceId: 'git' },
      title: 'Git',
    }
    controller.dispatch({ kind: 'insertTab', pane, tab })
    controller.dispatch({
      kind: 'floatTabs',
      pane,
      tabIds: [tab.id],
      floatId: 'f1',
      rect: { x: 100, y: 100, w: 400, h: 300 },
    })
    return controller
  }

  function withFloats(count: number) {
    const controller = createEmptyController()
    const pane = controller.focusedPane()
    if (!pane) throw new Error('no pane')
    for (let index = 0; index < count; index += 1) {
      const tab = {
        id: controller.mint.tab(),
        ref: { kind: 'panel' as const, contentId: `float-${index}`, instanceId: `float-${index}` },
        title: `Float ${index}`,
      }
      controller.dispatch({ kind: 'insertTab', pane, tab })
      controller.dispatch({
        kind: 'floatTabs',
        pane,
        tabIds: [tab.id],
        floatId: `f${index + 1}`,
        rect: { x: 100 + index * 40, y: 100 + index * 40, w: 400, h: 300 },
      })
    }
    return controller
  }

  function floatTitlebar(floatId: string): HTMLElement {
    const titlebar = document.querySelector(`[data-float-id="${floatId}"] [data-float-titlebar="true"]`) as HTMLElement | null
    if (!titlebar) throw new Error(`missing titlebar: ${floatId}`)
    Object.defineProperty(titlebar, 'setPointerCapture', { configurable: true, value: vi.fn() })
    return titlebar
  }

  it('浮窗渲染标题栏与内容', () => {
    const controller = withFloat()
    renderView(controller)
    expect(screen.getByTestId('panel-git')).toBeDefined()
    expect(document.querySelector('[data-float-id="f1"]')).not.toBeNull()
  })

  it('最小化后变成胶囊，点击恢复且正文节点不重建', () => {
    const controller = withFloat()
    const mounted = vi.fn()
    function FloatContent() {
      useEffect(() => {
        mounted()
      }, [])
      return <input aria-label="float-draft" defaultValue="初始" />
    }
    renderView(controller, { renderContent: () => <FloatContent /> })
    const input = screen.getByLabelText('float-draft') as HTMLInputElement
    input.value = '浮窗草稿'

    fireEvent.click(screen.getByLabelText('最小化'))
    expect(document.querySelector('[data-float-id="f1"]')).toBeNull()
    const capsule = document.querySelector('[data-capsule-for="f1"]')
    expect(capsule).not.toBeNull()

    fireEvent.click(capsule as Element)
    expect(document.querySelector('[data-float-id="f1"]')).not.toBeNull()
    expect(screen.getByLabelText('float-draft')).toBe(input)
    expect(input.value).toBe('浮窗草稿')
    expect(mounted).toHaveBeenCalledTimes(1)
  })

  it('按下浮窗标签只准备拖动，不抢焦点、层级或历史', () => {
    const controller = withFloats(2)
    renderView(controller)
    const before = controller.getState()
    const canUndoBefore = controller.canUndo()
    const tab = document.querySelector('[data-float-id="f1"] [role="tab"]') as HTMLElement

    fireEvent.pointerDown(tab, { button: 0, clientX: 120, clientY: 120 })
    expect(controller.getState()).toBe(before)
    fireEvent.pointerMove(window, { clientX: 180, clientY: 170 })
    fireEvent.pointerCancel(window)

    expect(controller.getState()).toBe(before)
    expect(controller.getState().floats.map((float) => float.id)).toEqual(['f1', 'f2'])
    expect(controller.getState().focused).toBe('f2')
    expect(controller.canUndo()).toBe(canUndoBefore)
    expect(document.querySelector('[data-drag-preview]')).toBeNull()
  })

  it('点击浮窗会提升 z-order，撤销恢复原顺序', () => {
    const controller = withFloats(2)
    renderView(controller)
    const first = document.querySelector('[data-float-id="f1"]') as HTMLElement
    const second = document.querySelector('[data-float-id="f2"]') as HTMLElement
    expect(Number(first.dataset.floatZ)).toBeLessThan(Number(second.dataset.floatZ))

    const titlebar = floatTitlebar('f1')
    fireEvent.pointerDown(titlebar, { button: 0, clientX: 120, clientY: 120 })
    fireEvent.pointerUp(titlebar)

    expect(controller.getState().floats.map((float) => float.id)).toEqual(['f2', 'f1'])
    expect(Number(first.dataset.floatZ)).toBeGreaterThan(Number(second.dataset.floatZ))
    act(() => {
      controller.undo()
    })
    expect(controller.getState().floats.map((float) => float.id)).toEqual(['f1', 'f2'])
  })

  it('拖到视口边缘时吸附为半屏，松手提交最终 rect', () => {
    const controller = withFloat()
    renderView(controller)
    const titlebar = floatTitlebar('f1')

    fireEvent.pointerDown(titlebar, { button: 0, clientX: 150, clientY: 150 })
    fireEvent.pointerMove(titlebar, { clientX: 8, clientY: 300 })
    expect(document.querySelector('[data-float-snap-preview="left"]')).not.toBeNull()
    fireEvent.pointerUp(titlebar)

    expect(controller.getState().floats[0]?.rect).toEqual({ x: 0, y: 0, w: 600, h: 800 })
    expect(document.querySelector('[data-float-snap-preview]')).toBeNull()
  })

  it.each(['pointercancel', 'blur', 'escape'] as const)('%s 回滚浮窗拖动和吸附预览', (kind) => {
    const controller = withFloat()
    renderView(controller)
    const before = controller.getState()
    const titlebar = floatTitlebar('f1')

    fireEvent.pointerDown(titlebar, { button: 0, clientX: 150, clientY: 150 })
    fireEvent.pointerMove(titlebar, { clientX: 8, clientY: 300 })
    expect(document.querySelector('[data-float-snap-preview]')).not.toBeNull()

    if (kind === 'pointercancel') fireEvent.pointerCancel(titlebar)
    else if (kind === 'blur') fireEvent.blur(window)
    else fireEvent.keyDown(window, { key: 'Escape' })

    expect(controller.getState()).toBe(before)
    expect(controller.getState().floats[0]?.rect).toEqual({ x: 100, y: 100, w: 400, h: 300 })
    expect(document.querySelector('[data-float-snap-preview]')).toBeNull()
  })

  it('多个最小化胶囊自动错位', () => {
    const controller = withFloats(2)
    renderView(controller)

    fireEvent.click(screen.getAllByLabelText('最小化')[0] as Element)
    fireEvent.click(screen.getAllByLabelText('最小化')[0] as Element)
    const first = document.querySelector('[data-capsule-for="f1"]') as HTMLElement
    const second = document.querySelector('[data-capsule-for="f2"]') as HTMLElement
    expect(first.style.top).toBe('752px')
    expect(second.style.top).toBe('752px')
    expect(first.style.left).toBe('16px')
    expect(second.style.left).toBe('164px')
  })

  it('分组后拖动任一浮窗会整组移动，撤销同时恢复', () => {
    const controller = withFloats(2)
    renderView(controller)
    fireEvent.click(screen.getAllByLabelText('与相邻浮窗分组')[0] as Element)
    expect(controller.getState().floats.map((float) => float.groupId)).toEqual([
      controller.getState().floats[0]?.groupId,
      controller.getState().floats[0]?.groupId,
    ])

    const titlebar = floatTitlebar('f1')
    fireEvent.pointerDown(titlebar, { button: 0, clientX: 120, clientY: 120 })
    fireEvent.pointerMove(titlebar, { clientX: 170, clientY: 160 })
    fireEvent.pointerUp(titlebar)

    expect(controller.getState().floats.map((float) => float.rect)).toEqual([
      { x: 150, y: 140, w: 400, h: 300 },
      { x: 190, y: 180, w: 400, h: 300 },
    ])
    act(() => controller.undo())
    expect(controller.getState().floats.map((float) => float.rect)).toEqual([
      { x: 100, y: 100, w: 400, h: 300 },
      { x: 140, y: 140, w: 400, h: 300 },
    ])
  })

  it('锁定浮窗后指针与键盘都不能移动', () => {
    const controller = withFloat()
    renderView(controller)
    fireEvent.click(screen.getByLabelText('锁定窗口'))
    const before = controller.getState()
    const titlebar = floatTitlebar('f1')

    fireEvent.pointerDown(titlebar, { button: 0, clientX: 150, clientY: 150 })
    fireEvent.pointerMove(titlebar, { clientX: 220, clientY: 210 })
    fireEvent.pointerUp(titlebar)
    fireEvent.keyDown(titlebar, { key: 'ArrowRight' })
    fireEvent.keyDown(titlebar, { key: 'Enter' })

    expect(controller.getState()).toBe(before)
    expect(document.querySelector('[data-float-id="f1"]')?.getAttribute('data-float-locked')).toBe('true')
  })

  it('Pin 下拉控件切换五档并纳入撤销', () => {
    const controller = withFloat()
    renderView(controller)
    const select = screen.getByLabelText('窗口固定级别')
    fireEvent.change(select, { target: { value: 'windowTop' } })
    expect(controller.getState().floats[0]?.pin).toBe('windowTop')
    expect(document.querySelector('[data-float-id="f1"]')?.getAttribute('data-pin')).toBe('windowTop')
    act(() => controller.undo())
    expect(controller.getState().floats[0]?.pin).toBe('none')
  })

  it('标题栏可用键盘移动分组浮窗', () => {
    const controller = withFloats(2)
    renderView(controller)
    fireEvent.click(screen.getAllByLabelText('与相邻浮窗分组')[0] as Element)
    const titlebar = floatTitlebar('f1')
    fireEvent.keyDown(titlebar, { key: 'ArrowRight' })
    fireEvent.keyDown(titlebar, { key: 'Enter' })
    expect(controller.getState().floats.map((float) => float.rect.x)).toEqual([120, 160])
  })

  it('关闭浮窗后回到空态', () => {
    const controller = withFloat()
    renderView(controller)
    fireEvent.click(screen.getByLabelText('关闭窗口'))
    expect(document.querySelector('[data-float-id="f1"]')).toBeNull()
    expect(screen.getByTestId('workspace-backdrop')).toBeDefined()
  })
})

describe('WorkbenchView 拖放', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'elementFromPoint')
  })

  function withTwoPanes() {
    const controller = createEmptyController()
    const first = controller.focusedPane()
    if (!first) throw new Error('no pane')
    const a = {
      id: controller.mint.tab(),
      ref: { kind: 'panel' as const, contentId: 'A', instanceId: 'A' },
      title: 'A',
    }
    controller.dispatch({ kind: 'insertTab', pane: first, tab: a })
    const second = controller.mint.pane()
    const split = controller.mint.split()
    controller.dispatch({ kind: 'split', pane: first, axis: 'row', at: 'after', newPane: second, newSplit: split })
    controller.dispatch({
      kind: 'insertTab',
      pane: second,
      tab: {
        id: controller.mint.tab(),
        ref: { kind: 'panel', contentId: 'C', instanceId: 'C' },
        title: 'C',
      },
    })
    return { controller, first, second, split, tabId: a.id }
  }

  it('拖到实际目标格中心时合并进该格，不使用焦点格', () => {
    const { controller, first, second, tabId } = withTwoPanes()
    renderView(controller)
    const target = document.querySelector(`[data-pane-id="${second}"]`) as HTMLElement
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => target),
    })
    Object.defineProperty(target, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ x: 400, y: 0, left: 400, top: 0, right: 1200, bottom: 800, width: 800, height: 800, toJSON() {} }),
    })

    fireEvent.pointerDown(screen.getByText('A'), { button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 700, clientY: 300 })
    expect(document.querySelector('[data-drag-preview="zone"]')).not.toBeNull()
    fireEvent.pointerUp(window)

    expect(findPane(controller.getState().root, first)?.tabs.some((tab) => tab.id === tabId)).toBe(false)
    expect(findPane(controller.getState().root, second)?.tabs.some((tab) => tab.id === tabId)).toBe(true)
  })

  it('顶部停靠分裂指针下的真实格，而不是焦点格', () => {
    const { controller, first, second, split, tabId } = withTwoPanes()
    renderView(controller)
    const target = document.querySelector(`[data-pane-id="${second}"]`) as HTMLElement
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => target),
    })
    Object.defineProperty(target, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ x: 400, y: 0, left: 400, top: 0, right: 1200, bottom: 800, width: 800, height: 800, toJSON() {} }),
    })

    fireEvent.pointerDown(screen.getByText('A'), { button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 700, clientY: 10 })
    expect(document.querySelector('[data-drag-preview="zone"]')).not.toBeNull()
    fireEvent.pointerUp(window)

    const state = controller.getState()
    const seed = state.root.kind === 'pane' ? state.root.id : panes(state.root)[0]!.id
    const shown = view(state, seed)
    expect(shown.root.kind).toBe('split')
    if (shown.root.kind === 'split') expect(shown.root.id).not.toBe(split)
    expect(findPane(shown.root, first)).toBeUndefined()
    expect(panes(shown.root).some((pane) => pane.tabs.some((tab) => tab.id === tabId))).toBe(true)
    expect(panes(shown.root).some((pane) => pane.id === second)).toBe(true)
  })

  it('顶部落点预览按 compact 投影，源格只剩一个标签时落定不再缩成半屏', () => {
    const controller = createEmptyController()
    const pane = controller.focusedPane()
    if (!pane) throw new Error('no pane')
    controller.dispatch({
      kind: 'insertTab',
      pane,
      tab: { id: controller.mint.tab(), ref: { kind: 'panel', contentId: 'A', instanceId: 'A' }, title: 'A' },
    })
    renderView(controller)
    const target = document.querySelector(`[data-pane-id="${pane}"]`) as HTMLElement
    const mainHost = target.parentElement as HTMLElement
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => target) })
    Object.defineProperty(target, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800, toJSON() {} }),
    })
    Object.defineProperty(mainHost, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800, toJSON() {} }),
    })

    fireEvent.pointerDown(screen.getByText('A'), { button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 600, clientY: 10 })
    const preview = document.querySelector('[data-drag-preview="zone"]') as HTMLElement
    expect(preview.style.width).toBe('1200px')
    expect(preview.style.height).toBe('800px')
    fireEvent.pointerUp(window)

    const shown = view(controller.getState(), pane)
    expect(shown.root.kind).toBe('pane')
    expect(panes(shown.root)).toHaveLength(1)
  })

  it('跨格移动保持正文 DOM、输入值、焦点、选区和滚动', () => {
    const { controller, second, tabId } = withTwoPanes()
    renderView(controller, {
      renderContent: (tab) =>
        tab.ref.contentId === 'A' ? (
          <div>
            <input aria-label="draft" defaultValue="初始" />
            <div data-testid="scroller" style={{ height: 40, overflow: 'auto' }}>
              <div style={{ height: 200 }}>long content</div>
            </div>
          </div>
        ) : (
          <div>{tab.ref.contentId}</div>
        ),
    })
    const target = document.querySelector(`[data-pane-id="${second}"]`) as HTMLElement
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => target),
    })
    Object.defineProperty(target, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ x: 400, y: 0, left: 400, top: 0, right: 1200, bottom: 800, width: 800, height: 800, toJSON() {} }),
    })

    const input = screen.getByLabelText('draft') as HTMLInputElement
    const scroller = screen.getByTestId('scroller') as HTMLDivElement
    input.value = '中文草稿'
    input.focus()
    input.setSelectionRange(1, 1)
    scroller.scrollTop = 42

    fireEvent.pointerDown(screen.getByText('A'), { button: 0, clientX: 100, clientY: 100 })
    expect(document.querySelector('[data-drag-preview-live="true"]')).toBeNull()
    fireEvent.pointerMove(window, { clientX: 700, clientY: 300 })
    const preview = document.querySelector('[data-drag-preview-live="true"]') as HTMLElement | null
    expect(preview).not.toBeNull()
    expect(preview?.querySelector('input')?.value).toBe('中文草稿')
    expect(preview?.querySelector('[data-drag-preview-content]')?.hasAttribute('inert')).toBe(true)
    expect(document.querySelectorAll('[data-tab-content-host]')).toHaveLength(2)
    fireEvent.pointerUp(window)

    expect(document.querySelector('[data-drag-preview]')).toBeNull()

    expect(findPane(controller.getState().root, second)?.tabs.some((tab) => tab.id === tabId)).toBe(true)
    expect(screen.getByLabelText('draft')).toBe(input)
    expect(input.value).toBe('中文草稿')
    expect(document.activeElement).toBe(input)
    expect(input.selectionStart).toBe(1)
    expect(input.selectionEnd).toBe(1)
    expect(scroller.scrollTop).toBe(42)
  })

  it.each(['pointercancel', 'blur', 'escape'] as const)('%s 会完整回滚拖动且不提交布局', (kind) => {
    const { controller, first, tabId } = withTwoPanes()
    renderView(controller)
    const before = controller.getState()

    fireEvent.pointerDown(screen.getByText('A'), { button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 700, clientY: 300 })
    expect(document.querySelector('[data-drag-preview]')).not.toBeNull()

    if (kind === 'pointercancel') fireEvent.pointerCancel(window)
    else if (kind === 'blur') fireEvent.blur(window)
    else fireEvent.keyDown(window, { key: 'Escape' })

    expect(controller.getState()).toBe(before)
    expect(findPane(controller.getState().root, first)?.tabs.some((tab) => tab.id === tabId)).toBe(true)
    expect(document.querySelector('[data-drag-preview]')).toBeNull()
  })
})

describe('WorkbenchView 订阅', () => {
  it('dispatch 后自动重渲染', () => {
    const controller = createEmptyController()
    function Host() {
      const state = useSyncExternalStore(
        (l) => controller.subscribe(l),
        () => controller.getState(),
      )
      return <span data-testid="count">{state.floats.length}</span>
    }
    render(
      <>
        <Host />
        <WorkbenchView
          controller={controller}
          labels={labels}
          resolveTitle={(tab) => tab.ref.contentId}
          renderContent={() => null}
          viewport={{ x: 0, y: 0, w: 1200, h: 800 }}
        />
      </>,
    )
    expect(screen.getByTestId('count').textContent).toBe('0')
    const pane = controller.focusedPane()
    const tab = { id: controller.mint.tab(), ref: { kind: 'panel' as const, contentId: 'x', instanceId: 'x' } }
    // 外部 store 的更新包在 act 里，才能同步冲进 DOM。
    act(() => {
      controller.dispatch({ kind: 'insertTab', pane: pane!, tab })
      controller.dispatch({
        kind: 'floatTabs',
        pane: pane!,
        tabIds: [tab.id],
        floatId: 'f9',
        rect: { x: 0, y: 0, w: 200, h: 200 },
      })
    })
    expect(screen.getByTestId('count').textContent).toBe('1')
  })
})

describe('WorkbenchView 独占工具确认', () => {
  function pendingPrompt(): ExclusiveTransferPrompt {
    const state = beginToolTransfer({
      source: {
        instanceId: 'terminal-1',
        toolId: 'terminal',
        sessionId: 'session-a',
        concurrency: 'exclusive',
      },
      target: { sessionId: 'session-b' },
    })
    if (state.phase !== 'prompt') throw new Error('expected prompt')
    return state
  }

  it('没有 transfer 绑定时不渲染确认框', () => {
    renderView(createEmptyController())
    expect(screen.queryByTestId('exclusive-transfer')).toBeNull()
  })

  it('宿主传入 prompt 时渲染，并把两个明确选择交回宿主', () => {
    const onDecision = vi.fn()
    const onCancel = vi.fn()
    const controller = createEmptyController()
    renderView(controller, {
      exclusiveTransfer: { prompt: pendingPrompt(), onDecision, onCancel },
    })

    expect(screen.getByTestId('exclusive-transfer')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '移动并改归属' }))
    expect(onDecision).toHaveBeenCalledWith('move')
    expect(onCancel).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '创建新实例' }))
    expect(onDecision).toHaveBeenCalledWith('new')
  })
})

describe('WorkbenchView 过载状态', () => {
  it('达到 view 上限时保留原布局并显示可关闭的明确拒绝', () => {
    const controller = createEmptyController({ limits: { maxTabsPerWorkspace: 1 } })
    const pane = controller.focusedPane()
    if (!pane) throw new Error('no pane')
    const first = { id: controller.mint.tab(), ref: { kind: 'conversation' as const, contentId: 's1', instanceId: 's1' } }
    controller.dispatch({ kind: 'insertTab', pane, tab: first })

    renderView(controller)
    act(() => {
      controller.dispatch({
        kind: 'insertTab',
        pane,
        tab: { id: controller.mint.tab(), ref: { kind: 'conversation', contentId: 's2', instanceId: 's2' } },
      })
    })

    const alert = screen.getByTestId('workbench-limit')
    expect(alert.getAttribute('data-code')).toBe('LIMIT_EXCEEDED')
    expect(alert.textContent).toContain('view 已达上限（1）')
    expect(screen.queryByTestId('panel-s2')).toBeNull()
    expect(screen.getByTestId('panel-s1')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: '知道了' }))
    expect(screen.queryByTestId('workbench-limit')).toBeNull()
  })
})
