/**
 * 图片字节缓存的纯逻辑测试（不需要 DOM 渲染）。
 *
 * 核心断言是「同一张图只读一次」—— 这是跨视图共享的依据：
 * 同会话开两个窗口、或者拖拽分屏让子树重挂时，读取次数都不能增加。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MessageAttachment } from '../session-derived/conversation.js'
import { AttachmentImageCache, asAttachmentReader, type AttachmentReaderLike } from './attachment-images.js'

const IMAGE: MessageAttachment = {
  kind: 'image',
  attachmentId: 'sha256-abc',
  mediaType: 'image/png',
  bytes: 2048,
  width: 640,
  height: 480,
  name: 'shot.png',
}

function fakeReader(result?: () => Promise<unknown>): { reader: AttachmentReaderLike; calls: string[] } {
  const calls: string[] = []
  const reader: AttachmentReaderLike = {
    readAttachment: async (attachment) => {
      calls.push(attachment.attachmentId)
      const value = (await (result ? result() : Promise.resolve({ kind: 'ok' }))) as
        | { kind: 'ok' }
        | { kind: 'fail'; message: string }
        | { kind: 'throw'; error: unknown }
      if (value.kind === 'fail') return { ok: false, error: { message: value.message } }
      if (value.kind === 'throw') throw value.error
      return { ok: true, value: { data: new Uint8Array([1, 2, 3]) } }
    },
  }
  return { reader, calls }
}

/** jsdom 没有 createObjectURL；用计数器确认真的调用了。 */
function stubObjectUrl(): () => number {
  let count = 0
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => {
      count += 1
      return `blob:mock-${count}`
    }),
  })
  return () => count
}

/** 让挂起的 promise 链跑完。 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('AttachmentImageCache', () => {
  beforeEach(() => {
    stubObjectUrl()
  })

  it('读取成功后进入 ready 并给出 blob URL', async () => {
    const cache = new AttachmentImageCache()
    const { reader, calls } = fakeReader()
    cache.ensure(reader, IMAGE)
    await flush()

    expect(calls).toEqual(['sha256-abc'])
    expect(cache.stateOf('sha256-abc')).toEqual({ status: 'ready', url: 'blob:mock-1' })
  })

  it('同一张图只读一次（跨视共享）', async () => {
    const cache = new AttachmentImageCache()
    const { reader, calls } = fakeReader()

    // 两个视图各自 ensure（相当于两个窗口同时挂载）
    cache.ensure(reader, IMAGE)
    cache.ensure(reader, IMAGE)
    await flush()
    // 之后再 ensure 也不重读
    cache.ensure(reader, IMAGE)
    await flush()

    expect(calls).toHaveLength(1)
  })

  it('并发 ensure 只发一次请求（inflight 去重）', async () => {
    const cache = new AttachmentImageCache()
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const calls: string[] = []
    const reader: AttachmentReaderLike = {
      readAttachment: async (attachment) => {
        calls.push(attachment.attachmentId)
        await gate
        return { ok: true, value: { data: new Uint8Array([9]) } }
      },
    }

    cache.ensure(reader, IMAGE)
    cache.ensure(reader, IMAGE)
    cache.ensure(reader, IMAGE)
    expect(calls).toHaveLength(1)

    release?.()
    await flush()
    expect(cache.stateOf('sha256-abc')?.status).toBe('ready')
  })

  it('读取被拒绝（ok:false）降级为 failed 并带上原因', async () => {
    const cache = new AttachmentImageCache()
    const { reader } = fakeReader(async () => ({ kind: 'fail', message: '附件已被清理' }))
    cache.ensure(reader, IMAGE)
    await flush()

    expect(cache.stateOf('sha256-abc')).toEqual({ status: 'failed', error: '附件已被清理' })
  })

  it('读取抛错也降级，不产生未处理拒绝', async () => {
    const cache = new AttachmentImageCache()
    const { reader } = fakeReader(async () => ({ kind: 'throw', error: new Error('网络断了') }))
    cache.ensure(reader, IMAGE)
    await flush()

    expect(cache.stateOf('sha256-abc')).toEqual({ status: 'failed', error: '网络断了' })
  })

  it('没有 reader 时直接 failed（而不是永远 loading）', () => {
    const cache = new AttachmentImageCache()
    cache.ensure(undefined, IMAGE)
    expect(cache.stateOf('sha256-abc')?.status).toBe('failed')
  })

  it('失败后再次 ensure 会重试（权限可能恢复）', async () => {
    const cache = new AttachmentImageCache()
    const { reader, calls } = fakeReader(async () => ({ kind: 'fail', message: '临时失败' }))
    cache.ensure(reader, IMAGE)
    await flush()
    expect(calls).toHaveLength(1)

    cache.ensure(reader, IMAGE)
    await flush()
    expect(calls).toHaveLength(2)
  })

  it('非图片附件不发起读取', () => {
    const cache = new AttachmentImageCache()
    const { reader, calls } = fakeReader()
    cache.ensure(reader, { kind: 'file', attachmentId: 'sha256-def', name: 'a.txt', bytes: 3 })
    expect(calls).toHaveLength(0)
    expect(cache.stateOf('sha256-def')).toBeUndefined()
  })

  it('状态变化通知订阅者，内容不变不再通知', async () => {
    const cache = new AttachmentImageCache()
    const listener = vi.fn()
    cache.subscribe(listener)
    const { reader } = fakeReader()

    cache.ensure(reader, IMAGE)
    await flush()
    const afterFirst = listener.mock.calls.length
    expect(afterFirst).toBeGreaterThan(0)

    // 已 ready，再 ensure 是空操作，不该再通知
    cache.ensure(reader, IMAGE)
    await flush()
    expect(listener).toHaveBeenCalledTimes(afterFirst)
  })

  it('退订后不再通知', () => {
    const cache = new AttachmentImageCache()
    const listener = vi.fn()
    const off = cache.subscribe(listener)
    off()
    cache.ensure(undefined, IMAGE)
    expect(listener).not.toHaveBeenCalled()
  })

  it('clear 后状态归零，可重新读取', async () => {
    const cache = new AttachmentImageCache()
    const { reader, calls } = fakeReader()
    cache.ensure(reader, IMAGE)
    await flush()

    cache.clear()
    expect(cache.stateOf('sha256-abc')).toBeUndefined()

    cache.ensure(reader, IMAGE)
    await flush()
    expect(calls).toHaveLength(2)
  })
})

describe('asAttachmentReader', () => {
  it('认得带 readAttachment 的对象', () => {
    const { reader } = fakeReader()
    expect(asAttachmentReader(reader)).toBe(reader)
  })

  it('认不出普通对象 / undefined / 只有 prompt 的会话面', () => {
    expect(asAttachmentReader(undefined)).toBeUndefined()
    expect(asAttachmentReader({})).toBeUndefined()
    expect(asAttachmentReader({ prompt: () => {} })).toBeUndefined()
  })
})
