// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'

import type { Tab } from '../workbench/index.js'

import { createEmptyController, type WorkbenchController } from './controller.js'
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

  it('浮窗渲染标题栏与内容', () => {
    const controller = withFloat()
    renderView(controller)
    expect(screen.getByTestId('panel-git')).toBeDefined()
    expect(document.querySelector('[data-float-id="f1"]')).not.toBeNull()
  })

  it('最小化后变成胶囊，点击恢复', () => {
    const controller = withFloat()
    renderView(controller)

    fireEvent.click(screen.getByLabelText('最小化'))
    expect(document.querySelector('[data-float-id="f1"]')).toBeNull()
    const capsule = document.querySelector('[data-capsule-for="f1"]')
    expect(capsule).not.toBeNull()

    fireEvent.click(capsule as Element)
    expect(document.querySelector('[data-float-id="f1"]')).not.toBeNull()
  })

  it('关闭浮窗后回到空态', () => {
    const controller = withFloat()
    renderView(controller)
    fireEvent.click(screen.getByLabelText('关闭窗口'))
    expect(document.querySelector('[data-float-id="f1"]')).toBeNull()
    expect(screen.getByTestId('workspace-backdrop')).toBeDefined()
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
