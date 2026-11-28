// @vitest-environment jsdom
/**
 * X4.3 renderer 侧的能力门：
 * - 只有 Host 标记 available 的工具能勾选；
 * - 命令里只带 selection + revision，**绝不带 capability**；
 * - Main 拒绝时展示真实错误，本地不假装已选。
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SessionToolsetBar, type WorkbenchToolsetReadModel } from './toolset-bar.js'

interface MockApi {
  openContext: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  query: ReturnType<typeof vi.fn>
  command: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
}

function model(overrides: Partial<WorkbenchToolsetReadModel> = {}): WorkbenchToolsetReadModel {
  return {
    schemaVersion: 1,
    sessionId: 'session-a',
    revision: 4,
    capabilityRevision: 'dsh-tools-1-v1',
    capabilities: {
      source: 'host',
      revision: 'dsh-tools-1-v1',
      observedAt: '2026-11-28T00:00:00.000Z',
      tools: {
        files: { grade: 'available', evidence: 'workspace.file.*' },
        git: { grade: 'available', evidence: 'git.log.list' },
        mcp: { grade: 'configured', reason: '仅配置，未连接' },
        browser: { grade: 'unavailable', reason: '托管浏览器安全门未开放' },
      },
    },
    toolset: [],
    effectiveToolset: [],
    staleToolset: [],
    instances: [],
    ...overrides,
  }
}

function mockBridge(options: { initial?: WorkbenchToolsetReadModel; receipt?: (request: { requestId: string }) => unknown } = {}): MockApi {
  let listeners: Array<(event: unknown) => void> = []
  const api: MockApi = {
    openContext: vi.fn(async () => 'ctx-1'),
    close: vi.fn(async () => {}),
    query: vi.fn(async () => ({ ok: true, queryName: 'workbench.toolset.get', result: options.initial ?? model() })),
    subscribe: vi.fn((_scope, listener: (event: unknown) => void) => {
      listeners.push(listener)
      return () => { listeners = listeners.filter((item) => item !== listener) }
    }),
    command: vi.fn(async (request: { requestId: string; commandName: string; input: unknown }) => {
      const receipt = options.receipt?.(request)
      queueMicrotask(() => {
        for (const listener of listeners) {
          listener({
            kind: 'command.receipt',
            receipt: {
              requestId: request.requestId,
              ...(receipt ?? {
                status: 'completed',
                result: model({ revision: 5, toolset: (request.input as { toolset: string[] }).toolset }),
              }),
            },
          })
        }
      })
      return { commandName: request.commandName, requestId: request.requestId, status: 'accepted' }
    }),
  }
  ;(globalThis as unknown as { dshStudio?: MockApi }).dshStudio = api
  return api
}

afterEach(() => {
  cleanup()
  delete (globalThis as unknown as { dshStudio?: MockApi }).dshStudio
})

describe('SessionToolsetBar', () => {
  it('只在 Host 标记 available 时允许勾选，并把选择结果交给 Main 校验', async () => {
    const api = mockBridge()
    render(<SessionToolsetBar sessionId="session-a" />)

    await screen.findByTestId('session-toolset')
    expect(screen.getByText('未选择')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '选择' }))

    const files = screen.getByRole('checkbox', { name: /文件/ }) as HTMLInputElement
    const mcp = screen.getByRole('checkbox', { name: /MCP/ }) as HTMLInputElement
    const browser = screen.getByRole('checkbox', { name: /浏览器/ }) as HTMLInputElement
    expect(files.disabled).toBe(false)
    expect(mcp.disabled).toBe(true)
    expect(browser.disabled).toBe(true)
    expect(screen.getByText('托管浏览器安全门未开放')).toBeTruthy()

    fireEvent.click(files)
    await waitFor(() => expect(api.command).toHaveBeenCalledTimes(1))

    const request = api.command.mock.calls[0][0] as {
      commandName: string
      input: Record<string, unknown>
    }
    expect(request.commandName).toBe('workbench.toolset.set')
    expect(request.input).toEqual({
      expectedRevision: 4,
      capabilityRevision: 'dsh-tools-1-v1',
      toolset: ['files'],
    })
    expect('capabilities' in request.input).toBe(false)
    await waitFor(() => expect((screen.getByRole('checkbox', { name: /文件/ }) as HTMLInputElement).checked).toBe(true))

    fireEvent.click(files)
    await waitFor(() => expect(api.command).toHaveBeenCalledTimes(2))
    expect((api.command.mock.calls[1][0] as { input: { toolset: string[] } }).input.toolset).toEqual([])
  })

  it('Main 拒绝时显示真实错误且不把工具显示为已选', async () => {
    const api = mockBridge({
      receipt: () => ({ status: 'failed', error: { code: 'CAPABILITY_UNAVAILABLE', message: 'browser 不在 Host capability 子集内' } }),
    })
    render(<SessionToolsetBar sessionId="session-a" />)
    await screen.findByTestId('session-toolset')
    fireEvent.click(screen.getByRole('button', { name: '选择' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /文件/ }))

    await waitFor(() => expect(api.command).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'browser 不在 Host capability 子集内')
    expect(screen.getByText('未选择')).toBeTruthy()
    expect((screen.getByRole('checkbox', { name: /文件/ }) as HTMLInputElement).checked).toBe(false)
  })

  it('切换会话时先清空旧模型，加载期间不串场上一个会话的工具集', async () => {
    const api = mockBridge()
    let release!: (value: unknown) => void
    const waiting = new Promise((resolve) => { release = resolve })
    let calls = 0
    api.query.mockImplementation(() => {
      calls += 1
      if (calls === 1) return Promise.resolve({ ok: true, result: model() })
      return waiting
    })
    const view = render(<SessionToolsetBar sessionId="session-a" />)
    await screen.findByTestId('session-toolset')

    view.rerender(<SessionToolsetBar sessionId="session-b" />)
    await waitFor(() => expect(screen.queryByTestId('session-toolset')).toBeNull())

    release({
      ok: true,
      result: model({ sessionId: 'session-b', toolset: ['git'], effectiveToolset: ['git'] }),
    })
    await screen.findByTestId('session-toolset')
    expect(screen.getByText('Git')).toBeTruthy()
    expect(screen.queryByText('未选择')).toBeNull()
  })

  it('能力收窄后仍允许移除失效的已选工具', async () => {
    const api = mockBridge({
      initial: model({
        toolset: ['browser'],
        effectiveToolset: [],
        staleToolset: [{ toolId: 'browser', reason: '托管浏览器安全门已关闭' }],
      }),
    })
    render(<SessionToolsetBar sessionId="session-a" />)
    await screen.findByTestId('session-toolset')
    fireEvent.click(screen.getByRole('button', { name: '选择' }))

    const browser = screen.getByRole('checkbox', { name: /浏览器/ }) as HTMLInputElement
    expect(browser.checked).toBe(true)
    expect(browser.disabled).toBe(false)
    fireEvent.click(browser)

    await waitFor(() => expect(api.command).toHaveBeenCalledTimes(1))
    expect((api.command.mock.calls[0][0] as { input: { toolset: string[] } }).input.toolset).toEqual([])
  })

  it('没有桌面桥时完全不渲染，不产生伪造的可用状态', async () => {
    render(<SessionToolsetBar sessionId="session-a" />)
    await Promise.resolve()
    expect(screen.queryByTestId('session-toolset')).toBeNull()
  })

  it('卸载时释放自己的 bridge context', async () => {
    const api = mockBridge()
    const view = render(<SessionToolsetBar sessionId="session-a" />)
    await screen.findByTestId('session-toolset')
    view.unmount()
    await waitFor(() => expect(api.close).toHaveBeenCalledWith('ctx-1'))
  })

  it('显示实例与隔离队列容量，并在达到上限时标出过载', async () => {
    mockBridge({
      initial: model({
        capacity: {
          toolInstances: { used: 1, limit: 1, perToolLimit: 1 },
          terminalInstances: { used: 0, limit: 8 },
          browserTabs: { used: 0, limit: 8 },
          eventQueue: { used: 2, limit: 2 },
          overloaded: true,
        },
      }),
    })
    render(<SessionToolsetBar sessionId="session-a" />)
    await screen.findByTestId('session-toolset')

    const capacity = screen.getByTestId('session-capacity')
    expect(capacity.textContent).toBe('实例 1/1 · 队列 2/2')
    expect(capacity.getAttribute('data-overloaded')).toBe('true')
    expect(capacity.getAttribute('style')).toContain('color')
  })
})