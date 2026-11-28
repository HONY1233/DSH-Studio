import { describe, expect, it } from 'vitest'

import {
  ToolTransferError,
  beginToolTransfer,
  requiresExclusiveChoice,
  resolveToolTransfer,
  type ToolTransferRequest,
} from './exclusive-transfer.js'

function request(overrides: {
  concurrency?: 'shared-read' | 'exclusive' | 'stateless'
  from?: string
  to?: string
} = {}): ToolTransferRequest {
  return {
    source: {
      instanceId: 'terminal-1',
      toolId: 'terminal',
      sessionId: overrides.from ?? 'session-a',
      concurrency: overrides.concurrency ?? 'exclusive',
      hostId: 'dsh-desktop',
      windowId: 'studio-main',
    },
    target: { sessionId: overrides.to ?? 'session-b' },
  }
}

describe('beginToolTransfer', () => {
  it('跨会话独占工具只进入确认阶段，不产生默认 action', () => {
    const state = beginToolTransfer(request())
    expect(state.phase).toBe('prompt')
    if (state.phase !== 'prompt') throw new Error('expected prompt')
    expect(state.options).toEqual(['move', 'new'])
    expect(state.defaultDecision).toBe('cancel')
    expect(state.copyByDefault).toBe(false)
    expect('action' in state).toBe(false)
    expect(requiresExclusiveChoice(request())).toBe(true)
  })

  it('同会话独占工具直接 move，不打扰用户', () => {
    const state = beginToolTransfer(request({ to: 'session-a' }))
    expect(state.phase).toBe('direct')
    if (state.phase !== 'direct') throw new Error('expected direct')
    expect(state.reason).toBe('same-session')
    expect(state.action).toEqual({
      kind: 'tool.transfer',
      mode: 'move',
      instanceId: 'terminal-1',
      toolId: 'terminal',
      fromSessionId: 'session-a',
      toSessionId: 'session-a',
    })
    expect(requiresExclusiveChoice(request({ to: 'session-a' }))).toBe(false)
  })

  it('shared-read / stateless 工具跨会话不需要独占确认', () => {
    for (const concurrency of ['shared-read', 'stateless'] as const) {
      const state = beginToolTransfer(request({ concurrency }))
      expect(state.phase).toBe('direct')
      if (state.phase !== 'direct') throw new Error('expected direct')
      expect(state.reason).toBe('non-exclusive')
      expect(state.action.mode).toBe('move')
      expect(requiresExclusiveChoice(request({ concurrency }))).toBe(false)
    }
  })

  it('非法请求 fail closed', () => {
    const bad = request() as unknown as { source: { concurrency: string } }
    bad.source.concurrency = 'copy'
    expect(() => beginToolTransfer(bad as unknown as ToolTransferRequest)).toThrow(ToolTransferError)
    expect(() => beginToolTransfer({
      source: { instanceId: '', toolId: 'terminal', sessionId: 'a', concurrency: 'exclusive' },
      target: { sessionId: 'b' },
    })).toThrow('instanceId')
    expect(() => beginToolTransfer({
      source: { instanceId: 'x', toolId: 'terminal', sessionId: 'a', concurrency: 'exclusive' },
      target: { sessionId: '' },
    })).toThrow('target.sessionId')
  })
})

describe('resolveToolTransfer', () => {
  it('明确选择「移动并改归属」才产生 move action', () => {
    const state = resolveToolTransfer(beginToolTransfer(request()), 'move')
    expect(state.phase).toBe('resolved')
    if (state.phase !== 'resolved') throw new Error('expected resolved')
    expect(state.decision).toBe('move')
    expect(state.action.mode).toBe('move')
    expect(state.action.toSessionId).toBe('session-b')
    expect(state.action.newInstanceId).toBeUndefined()
  })

  it('「创建新实例」必须带全新的 instanceId，且源实例不被改写', () => {
    const pending = beginToolTransfer(request())
    expect(() => resolveToolTransfer(pending, 'new')).toThrow('newInstanceId')
    expect(() => resolveToolTransfer(pending, 'new', { newInstanceId: 'terminal-1' })).toThrow('不能与源实例相同')

    const resolved = resolveToolTransfer(pending, 'new', { newInstanceId: 'terminal-2' })
    expect(resolved.phase).toBe('resolved')
    if (resolved.phase !== 'resolved') throw new Error('expected resolved')
    expect(resolved.decision).toBe('new')
    expect(resolved.action).toEqual({
      kind: 'tool.transfer',
      mode: 'new',
      instanceId: 'terminal-1',
      toolId: 'terminal',
      fromSessionId: 'session-a',
      toSessionId: 'session-b',
      newInstanceId: 'terminal-2',
    })
    if (pending.phase !== 'prompt') throw new Error('expected prompt')
    expect(pending.source.instanceId).toBe('terminal-1')
  })

  it('取消不产生任何转移 action', () => {
    const state = resolveToolTransfer(beginToolTransfer(request()), 'cancel')
    expect(state.phase).toBe('cancelled')
    expect('action' in state).toBe(false)
    if (state.phase !== 'cancelled') throw new Error('expected cancelled')
    expect(state.reason).toBe('user')
  })

  it('copy 不是合法决策，且原状态保持不变', () => {
    const pending = beginToolTransfer(request())
    expect(() => resolveToolTransfer(pending, 'copy' as never)).toThrow(ToolTransferError)
    expect(pending.phase).toBe('prompt')
  })

  it('只有 prompt 可以确认；direct / cancelled 不能补投票', () => {
    const direct = beginToolTransfer(request({ to: 'session-a' }))
    expect(() => resolveToolTransfer(direct, 'move')).toThrow('只有等待确认')
    const cancelled = resolveToolTransfer(beginToolTransfer(request()), 'cancel')
    expect(() => resolveToolTransfer(cancelled, 'move')).toThrow('只有等待确认')
  })
})