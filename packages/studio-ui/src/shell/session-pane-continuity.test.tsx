// @vitest-environment jsdom
/** X4.5 断线重连可见性：会话状态行必须直接投影 hub 的连续性判定。 */

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { EventContinuity } from './event-hub.js'
import { SessionPane } from './session-pane.js'

vi.mock('./conversation-body.js', () => ({
  ConversationBody: () => null,
  defaultConversationLabels: {},
}))
vi.mock('./composer.js', () => ({
  Composer: () => null,
  defaultComposerLabels: {},
}))
vi.mock('./toolset-bar.js', () => ({ SessionToolsetBar: () => null }))
vi.mock('./approval-bar.js', () => ({ SessionApprovalBar: () => null }))
vi.mock('../ui-session-views/use-session-view.js', () => ({
  useOwnerSessionView: () => ({
    store: {},
    projection: { approvals: [], usage: null, tools: { instances: [], layout: null, leases: [] } },
    dispatchDraft: () => ({ changed: false, revision: 0, draft: null }),
  }),
}))

function hubWith(state: { value: EventContinuity; listeners: Set<() => void> }) {
  return {
    subscribeWindow(listener: () => void) {
      state.listeners.add(listener)
      return () => { state.listeners.delete(listener) }
    },
    continuityOf: () => state.value,
  }
}

afterEach(cleanup)

describe('SessionPane continuity', () => {
  it('shows gap/conflict/overflow from the hub and recovers to complete', () => {
    const state = { value: 'gap' as EventContinuity, listeners: new Set<() => void>() }
    const hub = hubWith(state)
    const cache = {
      acquire: () => ({ state: () => ({ value: { streaming: false } }), release: () => {} }),
      subscribe: () => () => {},
    }
    render(
      <SessionPane
        sessionId="session-a"
        active
        cache={cache as never}
        hub={hub as never}
      />,
    )
    const row = screen.getByTestId('session-continuity')
    expect(row.getAttribute('data-state')).toBe('gap')
    expect(row.textContent).toBe('连接：事件缺口')

    act(() => {
      state.value = 'buffer-overflow'
      for (const listener of state.listeners) listener()
    })
    expect(row.getAttribute('data-state')).toBe('buffer-overflow')
    expect(row.textContent).toBe('连接：缓冲溢出')

    act(() => {
      state.value = 'complete'
      for (const listener of state.listeners) listener()
    })
    expect(row.getAttribute('data-state')).toBe('complete')
    expect(row.getAttribute('style') ?? '').not.toContain('color')
  })
})