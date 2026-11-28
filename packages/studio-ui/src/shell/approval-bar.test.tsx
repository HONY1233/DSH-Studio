// @vitest-environment jsdom
/**
 * X4.5 renderer 侧审批归属：
 * - 打开上下文时用 `interaction.list` 补回已挂起的审批；
 * - 只接收本会话的 `interaction.required`；
 * - 按钮给出显式 decision，失败时保留卡片并展示真实错误。
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSyncExternalStore, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ApprovalSummary } from '../ui-session-views/session-view-store.js'
import { SessionViewStore } from '../ui-session-views/session-view-store.js'
import { SessionApprovalBar } from './approval-bar.js'

interface MockApi {
  openContext: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  query: ReturnType<typeof vi.fn>
  command: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
}

function approval(overrides: Partial<ApprovalSummary> = {}): ApprovalSummary {
  return {
    interactionId: 'approval-1',
    sessionId: 'session-a',
    leaseGeneration: 1,
    title: 'Tool approval',
    kind: 'approval',
    approvalType: 'command',
    detail: { command: 'rm -rf build' },
    status: 'pending',
    ...overrides,
  }
}

function mockBridge(options: {
  list?: ApprovalSummary[]
  receipt?: (request: { requestId: string; input: Record<string, unknown> }) => unknown
} = {}): MockApi & { emit: (event: unknown) => void } {
  let listeners: Array<(event: unknown) => void> = []
  const api: MockApi = {
    openContext: vi.fn(async () => 'ctx-1'),
    close: vi.fn(async () => {}),
    query: vi.fn(async () => ({ ok: true, queryName: 'interaction.list', result: { approvals: options.list ?? [] } })),
    subscribe: vi.fn((_scope, listener: (event: unknown) => void) => {
      listeners.push(listener)
      return () => { listeners = listeners.filter((item) => item !== listener) }
    }),
    command: vi.fn(async (request: { requestId: string; commandName: string; input: Record<string, unknown> }) => {
      const receipt = options.receipt?.(request)
      queueMicrotask(() => {
        for (const listener of listeners) {
          listener({
            kind: 'command.receipt',
            receipt: {
              requestId: request.requestId,
              ...(receipt ?? { status: 'completed', result: {} }),
            },
          })
        }
      })
      return { requestId: request.requestId, status: 'accepted' }
    }),
  }
  ;(globalThis as unknown as { dshStudio?: MockApi }).dshStudio = api
  return {
    ...api,
    emit(event: unknown) {
      for (const listener of listeners) listener(event)
    },
  }
}

function Harness(props: { store: SessionViewStore; sessionId: string; active?: boolean }): ReactNode {
  const owner = { kind: 'session' as const, id: props.sessionId }
  const subscribe = (listener: () => void) => props.store.subscribe(listener)
  const getSnapshot = () => props.store.getProjection(owner).approvals
  const approvals = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return (
    <SessionApprovalBar
      sessionId={props.sessionId}
      store={props.store}
      approvals={approvals}
      active={props.active ?? true}
    />
  )
}

afterEach(() => {
  cleanup()
  delete (globalThis as unknown as { dshStudio?: MockApi }).dshStudio
})

describe('SessionApprovalBar', () => {
  it('打开会话时补回已挂起审批，并用显式 allow 响应', async () => {
    const api = mockBridge({ list: [approval()] })
    const store = new SessionViewStore()
    render(<Harness store={store} sessionId="session-a" />)

    const card = await screen.findByTestId('session-approvals')
    expect(card.getAttribute('data-active')).toBe('true')
    expect(screen.getByText('rm -rf build')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '允许一次' }))
    await waitFor(() => expect(api.command).toHaveBeenCalledTimes(1))
    const request = api.command.mock.calls[0][0] as { commandName: string; input: Record<string, unknown> }
    expect(request.commandName).toBe('interaction.respond')
    expect(request.input).toEqual({
      interactionId: 'approval-1',
      leaseGeneration: 1,
      decision: 'submit',
      value: true,
    })

    await waitFor(() => expect(screen.queryByTestId('session-approvals')).toBeNull())
    expect(store.getProjection({ kind: 'session', id: 'session-a' }).approvals[0].status).toBe('submitted')
  })

  it('拒绝显式发送 value=false，不把未知决定默认成允许', async () => {
    const api = mockBridge({ list: [approval()] })
    const store = new SessionViewStore()
    render(<Harness store={store} sessionId="session-a" />)
    await screen.findByTestId('session-approvals')

    fireEvent.click(screen.getByRole('button', { name: '拒绝' }))
    await waitFor(() => expect(api.command).toHaveBeenCalledTimes(1))
    const request = api.command.mock.calls[0][0] as { input: Record<string, unknown> }
    expect(request.input.decision).toBe('submit')
    expect(request.input.value).toBe(false)
  })

  it('非活动标签只展示不可操作', async () => {
    mockBridge({ list: [approval()] })
    const store = new SessionViewStore()
    render(<Harness store={store} sessionId="session-a" active={false} />)
    await screen.findByTestId('session-approvals')

    for (const name of ['允许一次', '拒绝', '取消']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
    }
    expect(screen.getByText('切到该标签后可操作')).toBeTruthy()
  })

  it('只接收本会话的 required，并在 resolved 后移除卡片', async () => {
    const api = mockBridge()
    const store = new SessionViewStore()
    render(<Harness store={store} sessionId="session-a" />)
    await waitFor(() => expect(api.subscribe).toHaveBeenCalledTimes(1))

    api.emit({
      kind: 'interaction.required',
      interaction: approval({ interactionId: 'foreign', sessionId: 'session-b' }),
    })
    expect(store.getProjection({ kind: 'session', id: 'session-b' }).approvals).toHaveLength(0)

    api.emit({ kind: 'interaction.required', interaction: approval({ interactionId: 'own' }) })
    await screen.findByTestId('session-approvals')
    expect(screen.getByText('Tool approval')).toBeTruthy()

    api.emit({ kind: 'interaction.resolved', interactionId: 'own', leaseGeneration: 1, outcome: 'cancelled' })
    await waitFor(() => expect(screen.queryByTestId('session-approvals')).toBeNull())
    expect(store.getProjection({ kind: 'session', id: 'session-a' }).approvals[0].status).toBe('cancelled')
  })

  it('提交失败时保留卡片并展示 Host 错误', async () => {
    mockBridge({
      list: [approval()],
      receipt: () => ({ status: 'failed', error: { code: 'FAILED_PRECONDITION', message: 'interaction lease mismatch' } }),
    })
    const store = new SessionViewStore()
    render(<Harness store={store} sessionId="session-a" />)
    await screen.findByTestId('session-approvals')

    fireEvent.click(screen.getByRole('button', { name: '允许一次' }))
    await screen.findByText('interaction lease mismatch')
    expect(screen.getByTestId('session-approvals')).toBeTruthy()
    expect(store.getProjection({ kind: 'session', id: 'session-a' }).approvals[0].status).toBe('pending')
  })
})