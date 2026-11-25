/**
 * 端口适配层的类型级测试 —— 只测「真实契约 → 我们的端口」这一步。
 *
 * 这里能验的：参数映射、binding 归一化、错误的降级形态。
 * 这里**验不了**的：`ctx.sessions` 在运行时到底什么样（只能在真机看）。
 * 所以断言都写成「形状」而不是「行为」，形状不对时错误信息直接指向该改哪一行。
 */

import { describe, expect, it, vi } from 'vitest'

import { createSessionPort, toBinding, type RawSessionBinding, type SessionsFace } from './client.js'

/** 造一条真实形状的 binding。 */
function rawBinding(sessionId = 's1', extra: Partial<RawSessionBinding> = {}): RawSessionBinding {
  return {
    sessionId,
    session: { fake: 'session' },
    eventSource: { fake: 'events' },
    ctx: { fake: 'ctx' },
    ...extra,
  }
}

interface Harness {
  readonly face: SessionsFace
  readonly retainCalls: { target: string; options: { source: string; signal?: AbortSignal } }[]
  readonly releaseCount: () => number
}

function makeFace(options: { throwOnRetain?: unknown } = {}): Harness {
  const retainCalls: Harness['retainCalls'] = []
  let releases = 0
  const face: SessionsFace = {
    retain(target, opts) {
      if (options.throwOnRetain !== undefined) throw options.throwOnRetain
      retainCalls.push({ target, options: opts })
      return {
        sessionId: target,
        binding: rawBinding(target),
        ready: Promise.resolve(rawBinding(target)),
        release() {
          releases += 1
        },
      }
    },
  }
  return { face, retainCalls, releaseCount: () => releases }
}

describe('toBinding 归一化', () => {
  it('保留四个真实字段，丢掉其它', () => {
    const binding = toBinding({
      sessionId: 'abc',
      session: 1,
      eventSource: 2,
      ctx: 3,
      extra: 4,
    } as RawSessionBinding)
    expect(binding).toEqual({
      sessionId: 'abc',
      openState: 'ready',
      session: 1,
      eventSource: 2,
      scope: 3,
    })
  })

  it('缺字段时不写 undefined 键（形状稳定，便于断言）', () => {
    const binding = toBinding({ sessionId: 'abc' })
    expect(Object.keys(binding).sort()).toEqual(['openState', 'sessionId'])
  })
})

describe('createSessionPort', () => {
  it('retain 只透传 source，不夹带 connection / facets', () => {
    const { face, retainCalls } = makeFace()
    const port = createSessionPort(face)

    port.retain('s1', { source: 'workbench:pane' })

    expect(retainCalls).toHaveLength(1)
    expect(retainCalls[0]?.target).toBe('s1')
    expect(retainCalls[0]?.options).toEqual({ source: 'workbench:pane' })
  })

  it('signal 有则透传', () => {
    const { face, retainCalls } = makeFace()
    const port = createSessionPort(face)
    const controller = new AbortController()

    port.retain('s1', { source: 'workbench:pane', signal: controller.signal })

    expect(retainCalls[0]?.options.signal).toBe(controller.signal)
  })

  it('同步 binding 与 ready 都归一化', async () => {
    const { face } = makeFace()
    const port = createSessionPort(face)

    const ref = port.retain('s1', { source: 'workbench:pane' })

    expect(ref.binding?.sessionId).toBe('s1')
    expect(ref.binding?.eventSource).toEqual({ fake: 'events' })
    await expect(ref.ready).resolves.toMatchObject({ sessionId: 's1', openState: 'ready' })
  })

  it('release 透传到底层', () => {
    const h = makeFace()
    const port = createSessionPort(h.face)

    const ref = port.retain('s1', { source: 'workbench:pane' })
    ref.release()

    expect(h.releaseCount()).toBe(1)
  })

  it('retain 同步抛错 → 返回已拒绝的 ready，不把异常漏进渲染', async () => {
    const onError = vi.fn()
    const { face } = makeFace({ throwOnRetain: new Error('会话不存在') })
    const port = createSessionPort(face, { onError })

    const ref = port.retain('ghost', { source: 'workbench:pane' })

    await expect(ref.ready).rejects.toThrow('会话不存在')
    expect(ref.binding).toBeUndefined()
    expect(onError).toHaveBeenCalledWith('ghost', expect.any(Error))
    // release 仍可安全调用（dsh 那边根本没 retain 成功）
    expect(() => ref.release()).not.toThrow()
  })

  it('retain 抛非 Error → 包成 Error', async () => {
    const { face } = makeFace({ throwOnRetain: 'boom' })
    const port = createSessionPort(face)

    await expect(port.retain('s1', { source: 'workbench:pane' }).ready).rejects.toThrow('boom')
  })

  it('retainInfo 读快照，而不是直接返回 ObservableSnapshot', () => {
    const face: SessionsFace = {
      retain: () => ({
        sessionId: 's1',
        binding: rawBinding(),
        ready: Promise.resolve(rawBinding()),
        release: () => {},
      }),
      retainInfo: (id) => ({
        getSnapshot: () =>
          id === 's1' ? { referenceCount: 2, retainedBy: { 'workbench:pane': 2 } } : { referenceCount: 0 },
      }),
    }
    const port = createSessionPort(face)

    expect(port.retainInfo?.('s1')).toEqual({ referenceCount: 2, retainedBy: { 'workbench:pane': 2 } })
    expect(port.retainInfo?.('s2')).toEqual({ referenceCount: 0 })
  })

  it('retainInfo 缺省或抛错时返回 undefined，不炸调用方', () => {
    const noInfo: SessionsFace = {
      retain: () => ({
        sessionId: 's1',
        binding: rawBinding(),
        ready: Promise.resolve(rawBinding()),
        release: () => {},
      }),
    }
    expect(createSessionPort(noInfo).retainInfo?.('s1')).toBeUndefined()

    const throwing: SessionsFace = {
      ...noInfo,
      retainInfo: () => ({
        getSnapshot: () => {
          throw new Error('closed')
        },
      }),
    }
    expect(createSessionPort(throwing).retainInfo?.('s1')).toBeUndefined()
  })
})
