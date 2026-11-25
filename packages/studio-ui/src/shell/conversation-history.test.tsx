// @vitest-environment jsdom
/**
 * 历史向上加载。
 *
 * 三条必须守住的：
 * - `hasMore` 为 true 才给入口（否则点了没反应）；
 * - 用 `deferConsumption` + `consumeOlder` 配对，**不用**默认的"加载完就发布"
 *   —— 否则量高度时内容已经变了，滚动复原必然算错；
 * - 重折后把滚动位置换算回同一个视觉位置。
 *
 * jsdom 不排版，`scrollHeight`/`clientHeight` 永远是 0，所以用 `defineProperty`
 * 给容器打上可控的假尺寸，这也正是不用 e2e 也能验证换算公式的办法。
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DerivedCache } from '../session-derived/cache.js'
import { ConversationBody } from './conversation-body.js'
import type { RawEventEntry, RawSessionEventWindow } from './event-adapter.js'
import { SessionEventHub } from './event-hub.js'

const IMAGE_REF = { attachmentId: 'x' } // 本文件用不到，占位避免 lint 未使用

function userMsg(seq: number, text: string): RawEventEntry {
  return {
    type: 'event',
    event: {
      type: 'user/message',
      seq,
      time: 1000 + seq,
      data: { content: [{ type: 'text', text }], source: { kind: 'user' } },
    },
  }
}

interface WindowOptions {
  hasMore?: boolean
  entries: RawEventEntry[]
}

/** 可变窗口：`prepend()` 模拟向上加载一页后的新窗口。 */
function makeSource(options: WindowOptions) {
  let window: RawSessionEventWindow = {
    entries: options.entries,
    hasMore: options.hasMore === true,
    revision: 1,
    change: { kind: 'replace', entries: options.entries },
  }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => window,
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    /** 向上追加一页（模拟 Host 发布更早的一页）。 */
    prepend(older: RawEventEntry[], hasMore = false) {
      const entries = [...older, ...window.entries]
      window = {
        entries,
        hasMore,
        revision: window.revision + 1,
        change: { kind: 'prepend', entries: older },
      }
      for (const fn of [...listeners]) fn()
    },
    setHasMore(next: boolean) {
      window = { ...window, hasMore: next, revision: window.revision + 1, change: undefined }
      for (const fn of [...listeners]) fn()
    },
  }
}

interface FakeLoader {
  readonly loadOlder: (options?: { readonly deferConsumption?: boolean }) => Promise<void>
  readonly consumeOlder: () => boolean
  readonly calls: { deferred: boolean | undefined }[]
  readonly consumeCalls: number
}

/** 假的历史加载器：把"准备一页"和"发布"分开，正好对上真实契约。 */
function fakeLoader(
  source: ReturnType<typeof makeSource>,
  page: RawEventEntry[],
  options: {
    consumeReturns?: boolean
    reject?: boolean
    hasMoreAfter?: boolean
    /**
     * 发布瞬间的副作用钩子。
     *
     * 真实浏览器里"发布 → React 重渲染 → 浏览器重新排版 → layout effect"
     * 是一气呵成的，layout effect 读到的一定是**新**的 scrollHeight。
     * jsdom 不排版，所以测试必须在发布那一刻手动把假尺寸改掉，
     * 否则 layout effect 会读到旧高度、换算退化成恒等。
     */
    onConsume?: () => void
  } = {},
): FakeLoader {
  const calls: { deferred: boolean | undefined }[] = []
  let consumeCalls = 0
  let prepared = false
  return {
    calls,
    get consumeCalls() {
      return consumeCalls
    },
    async loadOlder(opts) {
      calls.push({ deferred: opts?.deferConsumption })
      if (options.reject) throw new Error('网络断了')
      prepared = true
    },
    consumeOlder() {
      consumeCalls += 1
      if (!prepared) return false
      prepared = false
      if (options.consumeReturns === false) return false
      options.onConsume?.()
      source.prepend(page, options.hasMoreAfter ?? false)
      return true
    },
  }
}

interface Harness {
  readonly cache: DerivedCache
  readonly hub: SessionEventHub
}

function harness(): Harness {
  const cache = new DerivedCache({ capacity: 4 })
  return { cache, hub: new SessionEventHub({ cache }) }
}

function body(h: Harness, source: ReturnType<typeof makeSource>, session: unknown, active = true) {
  return render(
    <ConversationBody
      sessionId="s1"
      active={active}
      cache={h.cache}
      hub={h.hub}
      eventSource={source}
      session={session}
    />,
  )
}

/** 给滚动容器装上可控的假尺寸（jsdom 不排版）。 */
function stubScroll(el: HTMLElement, size: { scrollHeight: number; clientHeight: number }): void {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => size.scrollHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => size.clientHeight })
}

describe('加载更早的入口', () => {
  it('hasMore=false 时不显示', () => {
    const h = harness()
    const source = makeSource({ entries: [userMsg(1, '只有这一条')], hasMore: false })
    body(h, source, fakeLoader(source, []))
    expect(screen.queryByTestId('conversation-load-older')).toBeNull()
  })

  it('hasMore=true 时显示', () => {
    const h = harness()
    const source = makeSource({ entries: [userMsg(1, '只有这一条')], hasMore: true })
    body(h, source, fakeLoader(source, [userMsg(0, '更早的')]))
    expect(screen.getByTestId('conversation-load-older')).toBeDefined()
  })

  it('会话面没有 loadOlder 时不给入口（不显示点了没反应的按钮）', () => {
    const h = harness()
    const source = makeSource({ entries: [userMsg(1, 'x')], hasMore: true })
    body(h, source, { prompt: () => {} })
    expect(screen.queryByTestId('conversation-load-older')).toBeNull()
  })

  it('空态里也保留入口（整页都是被折叠的系统上下文时不能把用户困住）', () => {
    const h = harness()
    const source = makeSource({
      entries: [
        {
          type: 'event',
          event: {
            type: 'user/message',
            seq: 1,
            time: 1,
            data: { content: [{ type: 'text', text: 'reminder' }], source: { kind: 'system-prompt' } },
          },
        },
      ],
      hasMore: true,
    })
    body(h, source, fakeLoader(source, [userMsg(0, '更早')]))
    expect(screen.getByTestId('conversation-empty')).toBeDefined()
    expect(screen.getByTestId('conversation-load-older')).toBeDefined()
  })
})

describe('加载走 deferConsumption + consumeOlder', () => {
  it('点击时先用 deferConsumption 请求，再显式发布', async () => {
    const h = harness()
    const source = makeSource({ entries: [userMsg(5, '当前')], hasMore: true })
    const loader = fakeLoader(source, [userMsg(1, '更早')])
    body(h, source, loader)

    fireEvent.click(screen.getByTestId('conversation-load-older'))
    await waitFor(() => expect(loader.consumeCalls).toBe(1))

    // 关键断言：必须是 deferred 请求 —— 否则滚动锚点会在内容变化后才记
    expect(loader.calls).toEqual([{ deferred: true }])
  })

  it('发布后新消息出现在列表里', async () => {
    const h = harness()
    const source = makeSource({ entries: [userMsg(5, '当前')], hasMore: true })
    const loader = fakeLoader(source, [userMsg(1, '更早的消息')])
    body(h, source, loader)

    fireEvent.click(screen.getByTestId('conversation-load-older'))
    await waitFor(() => expect(screen.getByText('更早的消息')).toBeDefined())
    expect(screen.getByText('当前')).toBeDefined()
  })

  it('consumeOlder 返回 false 时显示失败文案（页面被作废）', async () => {
    const h = harness()
    const source = makeSource({ entries: [userMsg(5, '当前')], hasMore: true })
    const loader = fakeLoader(source, [], { consumeReturns: false })
    body(h, source, loader)

    fireEvent.click(screen.getByTestId('conversation-load-older'))
    await waitFor(() =>
      expect(screen.getByTestId('conversation-load-older').textContent).toContain('加载失败'),
    )
  })

  it('loadOlder 抛错时把原因显示出来，且按钮可重试', async () => {
    const h = harness()
    const source = makeSource({ entries: [userMsg(5, '当前')], hasMore: true })
    const loader = fakeLoader(source, [], { reject: true })
    body(h, source, loader)

    fireEvent.click(screen.getByTestId('conversation-load-older'))
    await waitFor(() =>
      expect(screen.getByTestId('conversation-load-older').textContent).toContain('网络断了'),
    )
    expect((screen.getByTestId('conversation-load-older') as HTMLButtonElement).disabled).toBe(false)
  })

  it('加载中禁用按钮并显示"正在加载"', async () => {
    const h = harness()
    const source = makeSource({ entries: [userMsg(5, '当前')], hasMore: true })
    let release: (() => void) | undefined
    const loader = {
      loadOlder: () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
      consumeOlder: () => true,
    }
    body(h, source, loader)

    fireEvent.click(screen.getByTestId('conversation-load-older'))
    await waitFor(() =>
      expect((screen.getByTestId('conversation-load-older') as HTMLButtonElement).disabled).toBe(true),
    )
    expect(screen.getByTestId('conversation-load-older').textContent).toContain('正在加载')

    await act(async () => {
      release?.()
      await Promise.resolve()
    })
    expect((screen.getByTestId('conversation-load-older') as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('滚动位置保持', () => {
  it('发布后把 scrollTop 换算回同一视觉位置', async () => {
    const h = harness()
    const source = makeSource({ entries: [userMsg(5, '当前')], hasMore: true })

    // 发布前：内容 1000 高、视口 400、用户滚到 30
    const size = { scrollHeight: 1000, clientHeight: 400 }
    // 发布瞬间内容变高 600 —— 必须在 consume 里改，模拟浏览器排版
    const loader = fakeLoader(source, [userMsg(1, '更早')], {
      onConsume: () => {
        size.scrollHeight = 1600
      },
    })
    const view = body(h, source, loader)

    const el = view.getByTestId('conversation-body')
    stubScroll(el, size)
    el.scrollTop = 30

    fireEvent.click(screen.getByTestId('conversation-load-older'))
    await waitFor(() => expect(loader.consumeCalls).toBe(1))
    await act(async () => {
      await Promise.resolve()
    })

    // 期望 scrollTop = 1600 - 1000 + 30 = 630
    expect(el.scrollTop).toBe(630)
  })

  it('内容反而变短时 scrollTop 不为负', async () => {
    const h = harness()
    const source = makeSource({ entries: [userMsg(5, '当前')], hasMore: true })
    const size = { scrollHeight: 1000, clientHeight: 400 }
    const loader = fakeLoader(source, [userMsg(1, '更早')], {
      onConsume: () => {
        size.scrollHeight = 500 // 荒谬但必须不炸
      },
    })
    const view = body(h, source, loader)

    const el = view.getByTestId('conversation-body')
    stubScroll(el, size)
    el.scrollTop = 0

    fireEvent.click(screen.getByTestId('conversation-load-older'))
    await waitFor(() => expect(loader.consumeCalls).toBe(1))
    await act(async () => {
      await Promise.resolve()
    })

    expect(el.scrollTop).toBeGreaterThanOrEqual(0)
  })

  it('隐藏标签滚动时不自动加载（保活的隐藏标签不该偷偷拉历史）', async () => {
    const h = harness()
    const source = makeSource({ entries: [userMsg(5, '当前')], hasMore: true })
    const loader = fakeLoader(source, [userMsg(1, '更早')])
    const view = body(h, source, loader, false) // active = false

    const el = view.getByTestId('conversation-body')
    stubScroll(el, { scrollHeight: 1000, clientHeight: 400 })
    el.scrollTop = 0
    fireEvent.scroll(el)
    await act(async () => {
      await Promise.resolve()
    })

    expect(loader.calls).toHaveLength(0)
  })
})

// 让上面那条"占位"常量真的被用到，避免 noUnusedLocals 报错
void IMAGE_REF
