// @vitest-environment jsdom
/**
 * React 绑定层的组件测试。
 *
 * 核心那条是「搬家不释放」：把同一个会话从槽位 A 换到槽位 B，
 * React 会卸载 A 的子树、挂载 B 的子树 —— 两步在同一次 commit 里。
 * 这条测试就是在断言这个场景下底层引用一次都没被释放。
 */

import { act, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Tab, TabId } from '../workbench/index.js'

import { createSessionTabViewLabels } from './labels.js'
import { SessionLeaseRegistry } from './leases.js'
import type { SessionSource } from './port.js'
import { SessionViewsProvider } from './provider.js'
import { SessionTabView, conversationRef } from './session-tab-view.js'
import { createFakeSessionPort } from './testing.js'

const labels = createSessionTabViewLabels('zh')
const tabOf = (sessionId: string): Tab => ({ id: 'tab-1' as TabId, ref: conversationRef(sessionId) })

function mount(port: ReturnType<typeof createFakeSessionPort>['port']) {
  const registry = new SessionLeaseRegistry({ port })
  return { registry }
}

const Body = (props: { readonly children?: ReactNode }) => (
  <div data-testid="body">{props.children}</div>
)

describe('SessionTabView 渲染状态', () => {
  it('ready 前是骨架，ready 后换成会话正文', async () => {
    const { port, calls } = createFakeSessionPort()
    const { registry } = mount(port)

    render(
      <SessionViewsProvider registry={registry}>
        <SessionTabView tab={tabOf('s1')} active labels={labels}>
          {(binding) => <Body>{binding.sessionId}</Body>}
        </SessionTabView>
      </SessionViewsProvider>,
    )

    expect(screen.getByTestId('session-tab-skeleton')).toBeDefined()

    await act(async () => {
      calls[0]?.resolve({ title: '设计评审' })
      await Promise.resolve()
    })

    expect(screen.getByTestId('session-tab-view').getAttribute('data-status')).toBe('ready')
    expect(screen.getByTestId('body').textContent).toBe('s1')
  })

  it('wrap 收到 binding，用来套会话作用域子树', async () => {
    const { port, calls } = createFakeSessionPort()
    const { registry } = mount(port)

    render(
      <SessionViewsProvider registry={registry}>
        <SessionTabView
          tab={tabOf('s1')}
          active
          labels={labels}
          wrap={(node, binding, ctx) => (
            <div data-testid="scope" data-session={binding.sessionId} data-active={String(ctx.active)}>
              {node}
            </div>
          )}
        >
          {() => <Body>hi</Body>}
        </SessionTabView>
      </SessionViewsProvider>,
    )

    await act(async () => {
      calls[0]?.resolve()
      await Promise.resolve()
    })

    const scope = screen.getByTestId('scope')
    expect(scope.getAttribute('data-session')).toBe('s1')
    expect(scope.getAttribute('data-active')).toBe('true')
    expect(screen.getByTestId('body').textContent).toBe('hi')
  })

  it('打开失败渲染可读墓碑，不是白屏', async () => {
    const { port, calls } = createFakeSessionPort()
    const { registry } = mount(port)

    render(
      <SessionViewsProvider registry={registry}>
        <SessionTabView tab={tabOf('s1')} active labels={labels}>
          {() => <Body>不该出现</Body>}
        </SessionTabView>
      </SessionViewsProvider>,
    )

    await act(async () => {
      calls[0]?.reject(new Error('会话日志损坏'))
      await Promise.resolve()
    })

    const tombstone = screen.getByTestId('session-tab-tombstone')
    expect(tombstone.getAttribute('role')).toBe('alert')
    expect(tombstone.textContent).toContain('会话日志损坏')
    expect(screen.queryByTestId('body')).toBeNull()
  })

  it('非会话标签不去 retain，直接给墓碑', () => {
    const { port, calls } = createFakeSessionPort()
    const { registry } = mount(port)

    render(
      <SessionViewsProvider registry={registry}>
        <SessionTabView
          tab={{ id: 'tab-p' as TabId, ref: { kind: 'panel', contentId: 'files', instanceId: 'files' } }}
          active
          labels={labels}
        >
          {() => <Body>不该出现</Body>}
        </SessionTabView>
      </SessionViewsProvider>,
    )

    expect(calls).toHaveLength(0)
    expect(screen.getByTestId('session-tab-tombstone').getAttribute('data-status')).toBe('missing')
  })
})

describe('多视图持有', () => {
  it('同一会话两个视图只 retain 一次', () => {
    const { port, calls } = createFakeSessionPort()
    const { registry } = mount(port)

    render(
      <SessionViewsProvider registry={registry}>
        <SessionTabView tab={tabOf('s1')} active labels={labels}>
          {() => <Body>左</Body>}
        </SessionTabView>
        <SessionTabView tab={tabOf('s1')} active={false} source="workbench:float" labels={labels}>
          {() => <Body>右</Body>}
        </SessionTabView>
      </SessionViewsProvider>,
    )

    expect(calls).toHaveLength(1)
    expect(registry.inspect('s1')?.refCount).toBe(2)
  })

  it('关掉其中一个视图后另一个仍持有', async () => {
    const { port, calls } = createFakeSessionPort()
    const { registry } = mount(port)

    const view = (key: string) => (
      <SessionTabView key={key} tab={tabOf('s1')} active labels={labels}>
        {() => <Body>{key}</Body>}
      </SessionTabView>
    )

    const { rerender } = render(
      <SessionViewsProvider registry={registry}>
        {view('left')}
        {view('right')}
      </SessionViewsProvider>,
    )

    rerender(<SessionViewsProvider registry={registry}>{view('left')}</SessionViewsProvider>)
    await act(async () => {
      await Promise.resolve()
    })

    expect(registry.inspect('s1')?.refCount).toBe(1)
    expect(calls[0]?.releaseCount).toBe(0)
  })
})

describe('搬家不释放', () => {
  function SlotHost(props: {
    readonly registry: SessionLeaseRegistry
    readonly where: 'a' | 'b'
    readonly source: SessionSource
  }): ReactNode {
    const view = (
      <SessionTabView tab={tabOf('s1')} active source={props.source} labels={labels}>
        {(binding) => <Body>{binding.sessionId}</Body>}
      </SessionTabView>
    )
    return (
      <SessionViewsProvider registry={props.registry}>
        <div data-slot="a">{props.where === 'a' ? view : null}</div>
        <div data-slot="b">{props.where === 'b' ? view : null}</div>
      </SessionViewsProvider>
    )
  }

  it('从停靠面搬到浮窗不释放底层引用', async () => {
    const { port, calls } = createFakeSessionPort()
    const registry = new SessionLeaseRegistry({ port })

    const { rerender } = render(
      <SlotHost registry={registry} where="a" source="workbench:pane" />,
    )

    // 同一次 commit 里：卸载槽位 A、挂载槽位 B。
    rerender(<SlotHost registry={registry} where="b" source="workbench:float" />)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.releaseCount).toBe(0)
    expect(registry.size).toBe(1)
    expect(registry.inspect('s1')?.refCount).toBe(1)

    // 宽限期已经过去，仍然不能被关掉。
    await act(async () => {
      await Promise.resolve()
    })
    expect(calls[0]?.releaseCount).toBe(0)
    expect(registry.size).toBe(1)
  })

  it('真关掉（卸载且没在新位置挂载）才释放', async () => {
    const { port, calls } = createFakeSessionPort()
    const registry = new SessionLeaseRegistry({ port })

    const { unmount } = render(
      <SlotHost registry={registry} where="a" source="workbench:pane" />,
    )
    unmount()

    await act(async () => {
      await Promise.resolve()
    })

    expect(calls[0]?.releaseCount).toBe(1)
    expect(registry.size).toBe(0)
  })

  it('重新打开的是一场新的一代', async () => {
    const { port, calls } = createFakeSessionPort()
    const registry = new SessionLeaseRegistry({ port })
    const onGeneration = vi.fn()

    const { unmount } = render(
      <SlotHost registry={registry} where="a" source="workbench:pane" />,
    )
    unmount()
    await act(async () => {
      await Promise.resolve()
    })

    render(<SlotHost registry={registry} where="a" source="workbench:pane" />)
    onGeneration(registry.inspect('s1')?.generation)

    expect(calls).toHaveLength(2)
    expect(onGeneration).toHaveBeenCalledWith(2)
  })
})
