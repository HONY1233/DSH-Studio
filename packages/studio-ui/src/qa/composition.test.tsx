// @vitest-environment jsdom
/**
 * 装配验收 —— 四个包拼在一起到底能不能跑通。
 *
 * 单元测试各自绿，装配起来照样白屏，是这类工作台最常见的事故。
 * 这个文件不测任何单个包的内部逻辑，只测**接缝**：
 *
 * | 验收项 | 判据（install-checklist 第四节） |
 * |---|---|
 * | A 同一会话两个窗口 | 只有**一条** retain，refCount 2 |
 * | B 把 tab 搬到另一格 | 整棵子树被重建，但**底层引用不断**（releaseCount 仍是 0） |
 * | C 关掉所有 tab | 宽限期后正好释放**一次**，注册表清空 |
 * | D 事件流折叠 | 两条订阅同一条流也只折**一次**，两个视图看到同一份快照 |
 * | E 面板 tab | 走 `PanelHost`，`active` 正确下传 |
 * | F 未知内容 | 可读墓碑，不白屏 |
 * | G 空工作台 | 显示空态，且**不自动创建会话** |
 *
 * 这是**测试专用包**：不含运行代码，所以门禁不扫它（`walk` 排除 `*.test.*`）。
 * 里面的 `renderContent` 就是 `docs/composition.md` 那份接线配方，
 * 真机装配时照抄，只把 `FakeFeed` 换成真实事件流适配器。
 */

import { act, render, screen } from '@testing-library/react'
import { useCallback, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import {
  emptyLayout,
  makeTab,
  type LayoutNode,
  type PaneId,
  type PaneNode,
  type SplitId,
  type Tab,
  type TabId,
  type WorkbenchLayout,
} from '../workbench/index.js'
import {
  createWorkbenchController,
  createWorkbenchLabels,
  WorkbenchView,
  type WorkbenchController,
} from '../ui-workbench/index.js'
import { PanelHost, PanelRegistry, type PanelContribution } from '../ui-panel-host/index.js'
import {
  conversationRef,
  createSessionLeaseRegistry,
  createSessionTabViewLabels,
  sessionIdOf,
  SessionTabView,
  SessionViewsProvider,
  type SessionBinding,
  type SessionLeaseRegistry,
  type SessionPort,
  type SessionRetainOptions,
} from '../ui-session-views/index.js'
import {
  DerivedCache,
  createConversationModel,
  type ConversationState,
  type DerivedEntry,
  type DerivedHandle,
} from '../session-derived/index.js'

const labels = createWorkbenchLabels('zh')
const sessionLabels = createSessionTabViewLabels('zh')
const CONVERSATION = createConversationModel()

/** 标签标题：面板用实例 id，会话以后可以换成会话标题。 */
const titleOf = (tab: Tab): string => tab.ref.instanceId

/** 宽限期是 microtask，让出一个即可触发。 */
const tick = (): Promise<void> => Promise.resolve()

// ---------------------------------------------------------------- 构造工具

let counter = 0
const nextId = (): string => `x${(counter += 1)}`

const newTabId = (): TabId => nextId() as TabId

function paneNode(id: string, tabs: Tab[]): PaneNode {
  return tabs.length === 0
    ? { kind: 'pane', id: id as PaneId, tabs: [] }
    : { kind: 'pane', id: id as PaneId, tabs, activeTab: tabs[tabs.length - 1]?.id }
}

function splitRow(children: LayoutNode[]): WorkbenchLayout {
  return {
    version: 2,
    root: {
      kind: 'split',
      id: nextId() as SplitId,
      axis: 'row',
      children,
    sizes: children.map(() => 1 / children.length),
    },
    floats: [],
    minimized: [],
  }
}

// ---------------------------------------------------------------- 假会话端口

interface RetainCall {
  readonly target: string
  readonly options: SessionRetainOptions
  releaseCount: number
  resolve(binding?: Partial<SessionBinding>): void
}

function createPort(): { port: SessionPort; calls: RetainCall[] } {
  const calls: RetainCall[] = []
  const port: SessionPort = {
    retain(target, options) {
      let settle!: (binding: SessionBinding) => void
      const ready = new Promise<SessionBinding>((resolve) => {
        settle = resolve
      })
      const call: RetainCall = {
        target,
        options,
        releaseCount: 0,
        resolve: (binding = {}) => settle({ sessionId: target, openState: 'ready', ...binding }),
      }
      calls.push(call)
      return {
        ready,
        release() {
          call.releaseCount += 1
        },
      }
    },
  }
  return { port, calls }
}

/** 真实的事件流适配器（`binding.eventSource`）在这里被替换成手动推送。 */
class FakeFeed {
  private readonly listeners = new Set<(entries: readonly DerivedEntry[]) => void>()

  readonly subscribe = (fn: (entries: readonly DerivedEntry[]) => void): (() => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  push(entries: readonly DerivedEntry[]): void {
    for (const fn of [...this.listeners]) fn(entries)
  }

  get listenerCount(): number {
    return this.listeners.size
  }
}

// ---------------------------------------------------------------- 接线配方

/** 会话正文：持有派生引用 + 订阅事件流 + 读快照。 */
function ConversationBody(props: {
  readonly sessionId: string
  readonly active: boolean
  readonly cache: DerivedCache
  readonly feed: FakeFeed
}): ReactNode {
  const { sessionId, active, cache, feed } = props
  const [handle, setHandle] = useState<DerivedHandle<ConversationState> | undefined>(undefined)

  useLayoutEffect(() => {
    const next = cache.acquire(sessionId, CONVERSATION)
    setHandle(next)
    const off = feed.subscribe((entries) => {
      cache.ingest(sessionId, entries)
    })
    return () => {
      off()
      next.release()
    }
  }, [cache, sessionId, feed])

  const subscribe = useCallback((listener: () => void) => cache.subscribe(listener), [cache])
  const getSnapshot = useCallback(() => handle?.state(), [handle])
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  if (!state) return <div data-testid="body-skeleton" />
  // unknown ≠ 空：一条事件都没吃到时不能渲染成空列表。
  if (state.status === 'unknown') {
    return <div data-testid={`body-${sessionId}`} data-status="unknown" data-active={String(active)} />
  }

  return (
    <div data-testid={`body-${sessionId}`} data-status="ready" data-active={String(active)} data-applied={state.applied}>
      {state.value.messages.map((message) => (
        <div key={message.seq} data-testid="msg">
          {message.text}
        </div>
      ))}
    </div>
  )
}

function Tombstone(props: { readonly what: string; readonly id: string }): ReactNode {
  return (
    <div data-testid={`tombstone-${props.what}`} role="alert">
      {props.what}: {props.id}
    </div>
  )
}

interface Harness {
  readonly controller: WorkbenchController
  readonly leases: SessionLeaseRegistry
  readonly panels: PanelRegistry
  readonly cache: DerivedCache
  readonly feed: FakeFeed
  readonly calls: RetainCall[]
}

function createHarness(layout: WorkbenchLayout, seedPanels?: (panels: PanelRegistry) => void): Harness {
  const { port, calls } = createPort()
  const leases = createSessionLeaseRegistry({ port })
  const panels = new PanelRegistry()
  const cache = new DerivedCache({ capacity: 8 })
  const feed = new FakeFeed()
  const controller = createWorkbenchController(layout)
  seedPanels?.(panels)

  /** ← 这就是 docs/composition.md 的配方本体。 */
  const renderContent = (tab: Tab, active: boolean): ReactNode => {
    if (tab.ref.kind === 'panel') {
      const contribution = panels.get(tab.ref.contentId)
      return contribution ? (
        <PanelHost contribution={contribution} instanceId={tab.ref.instanceId} active={active} />
      ) : (
        <Tombstone what="panel" id={tab.ref.contentId} />
      )
    }

    const sessionId = sessionIdOf(tab.ref)
    if (!sessionId) return <Tombstone what="kind" id={tab.ref.kind} />

    return (
      <SessionTabView tab={tab} active={active} labels={sessionLabels}>
        {(binding) => (
          <ConversationBody
            sessionId={sessionId}
            active={active}
            cache={cache}
            feed={feed}
          />
        )}
      </SessionTabView>
    )
  }

  render(
    <SessionViewsProvider registry={leases}>
      <WorkbenchView controller={controller} labels={labels} resolveTitle={titleOf} renderContent={renderContent} />
    </SessionViewsProvider>,
  )

  return { controller, leases, panels, cache, feed, calls }
}

function panelTab(contributionId: string, instanceId: string): Tab {
  return makeTab(newTabId(), { kind: 'panel', contentId: contributionId, instanceId })
}

// ---------------------------------------------------------------- 验收

describe('装配：会话多视图', () => {
  it('A 同一会话开两个窗口只 retain 一次，refCount 为 2', async () => {
    const tabA = makeTab(newTabId(), conversationRef('s1'))
    const tabB = makeTab(newTabId(), conversationRef('s1'))
    const h = createHarness(splitRow([paneNode(nextId(), [tabA]), paneNode(nextId(), [tabB])]))

    expect(h.calls).toHaveLength(1)
    expect(h.calls[0]?.target).toBe('s1')
    expect(h.calls[0]?.options.source).toBe('workbench:pane')
    expect(h.leases.inspect('s1')?.refCount).toBe(2)

    await act(async () => {
      h.calls[0]?.resolve()
    })

    // 两个窗口都拿到了内容，且共用同一份 binding
    expect(screen.getAllByTestId('body-s1')).toHaveLength(2)
  })

  it('B 把 tab 搬到另一格：整棵子树重建，但底层引用不断', async () => {
    const tabA = makeTab(newTabId(), conversationRef('s1'))
    const tabB = makeTab(newTabId(), conversationRef('s1'))
    const paneA = paneNode(nextId(), [tabA])
    const paneB = paneNode(nextId(), [tabB])
    const h = createHarness(splitRow([paneA, paneB]))

    await act(async () => {
      h.calls[0]?.resolve()
    })
    const generation = h.leases.inspect('s1')?.generation

    // paneA 搬空之后会被 compact 折叠掉，root 从 split 变成单个 pane ——
    // React 会把 SplitView 整棵替换成 PaneView，两个 tab 都被卸载再挂载。
    act(() => {
      h.controller.dispatch({ kind: 'moveTab', from: paneA.id, to: paneB.id, tabId: tabA.id })
    })

    expect(h.calls).toHaveLength(1)
    expect(h.calls[0]?.releaseCount).toBe(0)
    expect(h.leases.size).toBe(1)
    expect(h.leases.inspect('s1')?.generation).toBe(generation)

    // 前提确认：确实发生过整棵替换（两个格合成一格，SplitView → PaneView）。
    // 没有这条断言，上面的"引用不断"可能只是因为根本没重建过。
    expect(document.querySelectorAll('[data-pane-id]')).toHaveLength(1)

    // 等过宽限期，仍然不能释放
    await act(async () => {
      await tick()
    })
    expect(h.calls[0]?.releaseCount).toBe(0)
    expect(screen.getAllByTestId('body-s1')).toHaveLength(2)
  })

  it('C 关掉所有 tab 后，宽限期结束才释放，且只释放一次', async () => {
    const tabA = makeTab(newTabId(), conversationRef('s1'))
    const tabB = makeTab(newTabId(), conversationRef('s1'))
    const paneA = paneNode(nextId(), [tabA])
    const paneB = paneNode(nextId(), [tabB])
    const h = createHarness(splitRow([paneA, paneB]))

    await act(async () => {
      h.calls[0]?.resolve()
    })

    act(() => {
      h.controller.dispatch({ kind: 'removeTab', pane: paneA.id, tabId: tabA.id })
      h.controller.dispatch({ kind: 'removeTab', pane: paneB.id, tabId: tabB.id })
    })

    // 宽限期内还没放手（搬家靠的就是这段延迟）
    expect(h.calls[0]?.releaseCount).toBe(0)

    await act(async () => {
      await tick()
    })

    expect(h.calls[0]?.releaseCount).toBe(1)
    expect(h.leases.size).toBe(0)
  })
})

describe('装配：派生层', () => {
  it('D 两个视图共用一份快照，重复投递不重复折叠', async () => {
    const tabA = makeTab(newTabId(), conversationRef('s1'))
    const tabB = makeTab(newTabId(), conversationRef('s1'))
    const h = createHarness(splitRow([paneNode(nextId(), [tabA]), paneNode(nextId(), [tabB])]))

    await act(async () => {
      h.calls[0]?.resolve()
    })

    // 两个视图各订阅一次（真机上应在适配层收成一条，见 docs/composition.md）
    expect(h.feed.listenerCount).toBe(2)

    act(() => {
      h.feed.push([{ seq: 1, type: 'user/message', data: { text: '把这段重构一下' } }])
    })

    expect(h.cache.stats().applies).toBe(1)
    expect(screen.getAllByTestId('msg')).toHaveLength(2)
    // 两条订阅同一条流 → ingest 被调两次，第二次全按 seq 跳过
    expect(h.cache.stats().skippedEntries).toBeGreaterThan(0)
  })

  it('D2 未吃到事件时是 unknown，不是空列表', async () => {
    const tab = makeTab(newTabId(), conversationRef('s9'))
    const h = createHarness(splitRow([paneNode(nextId(), [tab])]))

    await act(async () => {
      h.calls[0]?.resolve()
    })

    const body = screen.getByTestId('body-s9')
    expect(body.getAttribute('data-status')).toBe('unknown')
  })
})

describe('装配：面板', () => {
  const filesL: PanelContribution = {
    id: 'files',
    title: { zh: '文件', en: 'Files' },
    scope: 'workspace',
    regions: ['left', 'center'],
    multi: true,
    defaultRegion: 'left',
    keepAlive: true,
    render: ({ panelId, instanceId, active }) => (
      <div data-testid="panel-files" data-active={String(active)} data-panel={panelId} data-instance={instanceId} />
    ),
  }

  it('E 面板 tab 走 PanelHost，active 正确下传', () => {
    const tab = panelTab('files', 'files@1')
    createHarness(splitRow([paneNode(nextId(), [tab])]), (panels) => {
      panels.register(filesL)
    })

    const rendered = screen.getByTestId('panel-files')
    expect(rendered.getAttribute('data-active')).toBe('true')
    expect(rendered.getAttribute('data-panel')).toBe('files')
    expect(rendered.getAttribute('data-instance')).toBe('files@1')
  })

  it('F 未知面板给出可读墓碑，不白屏', () => {
    const tab = panelTab('ghost', 'ghost@1')
    createHarness(splitRow([paneNode(nextId(), [tab])]))

    expect(screen.getByTestId('tombstone-panel').textContent).toContain('ghost')
  })
})

describe('装配：空态', () => {
  it('G 空工作台显示空态，且不自动新建会话', () => {
    const h = createHarness(emptyLayout(nextId() as PaneId))

    expect(screen.getByTestId('workspace-backdrop')).toBeDefined()
    expect(h.calls).toHaveLength(0)
    expect(h.feed.listenerCount).toBe(0)
  })
})
