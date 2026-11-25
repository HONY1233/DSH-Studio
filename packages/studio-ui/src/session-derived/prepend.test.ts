// @vitest-environment node
/**
 * 增量前插（向上加载历史）。
 *
 * 以前的做法是 `reset` + 整窗重折：窗口向前扩展时，把已经折过的 5000 条再折一遍。
 * 现在拆成两件事验证：
 *
 * 1) **拼接本身对不对**（`ChunkedList.concat`）—— 块边界最容易出错，
 *    取下标换算错一位就会让消息错位，而错位在界面上表现为"顺序怪怪的"，
 *    极难归因。
 * 2) **缓存与模型的分工**：缓存负责去重（`seq >= firstSeq` 丢掉）与失败回退，
 *    模型负责"拼不了就说拼不了"。
 */

import { describe, expect, it } from 'vitest'

import { DerivedCache } from './cache.js'
import { ChunkedList } from './chunked.js'
import { createConversationModel, type ConversationState } from './conversation.js'
import type { DerivedEntry, DerivedModel } from './model.js'

describe('ChunkedList.concat', () => {
  it('小列表拼接保持顺序与长度', () => {
    const a = ChunkedList.of([1, 2, 3])
    const b = ChunkedList.of([4, 5])
    const merged = a.concat(b)
    expect(merged.toArray()).toEqual([1, 2, 3, 4, 5])
    expect(merged.length).toBe(5)
    // 原实例不受影响
    expect(a.toArray()).toEqual([1, 2, 3])
  })

  it('跨块边界拼接后 get() 每一位都对（块不变量被守住）', () => {
    const size = ChunkedList.CHUNK_SIZE
    // 故意让左边末块只填 10 个，右边又是两块多 —— 逼出"填满末块再续块"的分支
    const left = ChunkedList.of(Array.from({ length: size + 10 }, (_, i) => `L${i}`))
    const right = ChunkedList.of(Array.from({ length: size * 2 + 7 }, (_, i) => `R${i}`))
    const merged = left.concat(right)

    expect(merged.length).toBe(left.length + right.length)
    for (let i = 0; i < merged.length; i += 1) {
      const expected = i < left.length ? `L${i}` : `R${i - left.length}`
      expect(merged.get(i)).toBe(expected)
    }
    expect(merged.toArray()).toEqual([...left.toArray(), ...right.toArray()])
  })

  it('末块恰好装满时走纯块表拼接', () => {
    const size = ChunkedList.CHUNK_SIZE
    const left = ChunkedList.of(Array.from({ length: size }, (_, i) => i))
    const right = ChunkedList.of(Array.from({ length: size }, (_, i) => 1000 + i))
    const merged = left.concat(right)
    expect(merged.length).toBe(size * 2)
    expect(merged.get(size - 1)).toBe(size - 1)
    expect(merged.get(size)).toBe(1000)
    expect(merged.get(size * 2 - 1)).toBe(1000 + size - 1)
  })

  it('空列表参与拼接是恒等操作', () => {
    const a = ChunkedList.of([1, 2])
    const empty = ChunkedList.empty<number>()
    expect(a.concat(empty)).toBe(a)
    expect(empty.concat(a)).toBe(a)
  })

  it('拼接后还能继续 append / update（不破坏后续操作）', () => {
    const size = ChunkedList.CHUNK_SIZE
    const merged = ChunkedList.of(Array.from({ length: size + 3 }, (_, i) => i)).concat(
      ChunkedList.of([999]),
    )
    const appended = merged.append(1234)
    expect(appended.length).toBe(size + 5)
    expect(appended.last()).toBe(1234)
    const updated = appended.update(0, -1)
    expect(updated.get(0)).toBe(-1)
    expect(updated.get(1)).toBe(1)
  })
})

/** 只数条目的模型，用来验证缓存层的去重与回退。 */
function countingModel(key = 'count'): DerivedModel<number> {
  return { key, initial: () => 0, apply: (state) => state + 1 }
}

const tick = (seq: number): DerivedEntry => ({ seq, type: 'tick' })

describe('DerivedCache.prepend', () => {
  it('把更早的一页接上去，不重折已有条目', () => {
    const cache = new DerivedCache()
    const model: DerivedModel<string> = {
      key: 'ids',
      initial: () => '',
      apply: (state, entry) => (state === '' ? `e${entry.seq}` : `${state},e${entry.seq}`),
      prepend: (older, current) => (older === '' ? current : `${older},${current}`),
    }
    cache.acquire('s', model)
    cache.ingest('s', [tick(11), tick(12)])

    const result = cache.prepend('s', [tick(8), tick(9), tick(10)])
    expect(result.fallback).toBe(false)
    expect(result.prepended).toBe(3)
    expect(cache.peek('s', 'ids')?.value).toBe('e8,e9,e10,e11,e12')
    // 已有条目没被重折：applied = 2 + 3
    expect(cache.peek('s', 'ids')?.applied).toBe(5)
  })

  it('重复投递是幂等的（seq 不小于 firstSeq 的丢掉）', () => {
    const cache = new DerivedCache()
    const model: DerivedModel<number> = {
      key: 'n',
      initial: () => 0,
      apply: (state) => state + 1,
      prepend: (older, current) => older + current,
    }
    cache.acquire('s', model)
    cache.ingest('s', [tick(11)])
    cache.prepend('s', [tick(9), tick(10)])
    expect(cache.peek('s', 'n')?.value).toBe(3)

    const again = cache.prepend('s', [tick(9), tick(10)])
    expect(again.prepended).toBe(0)
    expect(cache.peek('s', 'n')?.value).toBe(3)
  })

  it('模型没有 prepend 时报 fallback，且状态不变', () => {
    const cache = new DerivedCache()
    cache.acquire('s', countingModel())
    cache.ingest('s', [tick(11)])
    const before = cache.peek('s', 'count')?.value

    const result = cache.prepend('s', [tick(9)])
    expect(result.fallback).toBe(true)
    expect(cache.peek('s', 'count')?.value).toBe(before)
  })

  it('模型返回 undefined 时也报 fallback', () => {
    const cache = new DerivedCache()
    const model: DerivedModel<number> = {
      key: 'refuse',
      initial: () => 0,
      apply: (state) => state + 1,
      prepend: () => undefined,
    }
    cache.acquire('s', model)
    cache.ingest('s', [tick(11)])
    expect(cache.prepend('s', [tick(9)]).fallback).toBe(true)
    expect(cache.peek('s', 'refuse')?.value).toBe(1)
  })

  it('没有消费者时整批丢弃，不报错', () => {
    const cache = new DerivedCache()
    const result = cache.prepend('nobody', [tick(1)])
    expect(result.ignored).toBe(true)
    expect(result.prepended).toBe(0)
  })
})

const msg = (seq: number, text: string): DerivedEntry => ({ seq, type: 'user/message', data: { text } })
const toolCall = (seq: number, callId: string, name: string): DerivedEntry => ({
  seq,
  type: 'tool/call',
  data: { callId, name, arguments: '{}' },
})

function foldEntries(entries: readonly DerivedEntry[]): ConversationState {
  const model = createConversationModel()
  let state = model.initial()
  for (const entry of entries) state = model.apply(state, entry)
  return state
}

describe('会话模型的 prepend', () => {
  const model = createConversationModel()

  it('旧页在前、新页在后，轮数累加', () => {
    const older = foldEntries([
      { seq: 1, type: 'turn/start', data: {} },
      msg(2, '旧问题'),
      { seq: 3, type: 'turn/end', data: {} },
    ])
    const current = foldEntries([
      { seq: 10, type: 'turn/start', data: {} },
      msg(11, '新问题'),
      { seq: 12, type: 'turn/end', data: {} },
    ])
    const merged = model.prepend?.(older, current)
    expect(merged).toBeDefined()
    expect(merged?.messages.toArray().map((m) => m.text)).toEqual(['旧问题', '新问题'])
    expect(merged?.turns).toBe(2)
    expect(merged?.streaming).toBe(false)
  })

  it('当前页还有未完成的工具调用时，下标跟着后移', () => {
    const older = foldEntries([msg(1, '旧'), msg(2, '旧2')])
    const current = foldEntries([toolCall(10, 'c1', 'read_file')])
    const merged = model.prepend?.(older, current)
    expect(merged?.openCalls).toEqual({ c1: 2 })
    // 结果到达时能合并回同一条（不是孤儿）
    const withResult = model.apply(merged!, {
      seq: 11,
      type: 'tool/result',
      data: { callId: 'c1', text: '内容' },
    })
    expect(withResult.messages.length).toBe(3)
    expect(withResult.messages.get(2)?.tool?.status).toBe('done')
  })

  it('旧页有未完成调用时拒绝拼接（页边界切在调用中间）', () => {
    const older = foldEntries([toolCall(1, 'c-old', 'grep')])
    const current = foldEntries([msg(10, '新')])
    expect(model.prepend?.(older, current)).toBeUndefined()
  })

  it('streaming 只看当前段（旧页的 turn 早已结束）', () => {
    const older = foldEntries([{ seq: 1, type: 'turn/start', data: {} }])
    const current = foldEntries([{ seq: 10, type: 'turn/end', data: {} }])
    const merged = model.prepend?.(older, current)
    expect(merged?.streaming).toBe(false)
  })

  it('两份都不认识的类型合并去重', () => {
    const older = foldEntries([{ seq: 1, type: 'weird/a', data: {} }])
    const current = foldEntries([
      { seq: 10, type: 'weird/a', data: {} },
      { seq: 11, type: 'weird/b', data: {} },
    ])
    const merged = model.prepend?.(older, current)
    expect(merged?.unknownTypes).toEqual(['weird/a', 'weird/b'])
  })
})
