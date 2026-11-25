import { describe, expect, it, vi } from 'vitest'

import { DerivedCache } from './cache.js'
import { createConversationModel } from './conversation.js'
import type { DerivedEntry, DerivedModel } from './model.js'
import { DEFAULT_BUDGET, drainEntries } from './pump.js'

function countingModel(): DerivedModel<number> {
  return { key: 'count', initial: () => 0, apply: (state) => state + 1 }
}

function history(count: number): DerivedEntry[] {
  return Array.from({ length: count }, (_, i) => ({ seq: i + 1, type: 'tick' }))
}

describe('分片回放', () => {
  it('500 条按 budget=100 分 5 轮折完，结果与一次折完一致', async () => {
    const cache = new DerivedCache()
    const handle = cache.acquire('s1', countingModel())

    const result = await drainEntries(cache, 's1', history(500), { budget: 100 })

    expect(result.rounds).toBe(5)
    expect(result.folded).toBe(500)
    expect(result.stopped).toBe(false)
    expect(handle.state().value).toBe(500)
  })

  it('budget 大于总数时只转一轮', async () => {
    const cache = new DerivedCache()
    cache.acquire('s1', countingModel())

    const result = await drainEntries(cache, 's1', history(50), { budget: 1000 })
    expect(result.rounds).toBe(1)
  })

  it('每轮之间让出一次（最后一轮不让）', async () => {
    const cache = new DerivedCache()
    cache.acquire('s1', countingModel())
    const yieldTo = vi.fn(async () => {})

    const result = await drainEntries(cache, 's1', history(300), { budget: 100, yieldTo })

    expect(result.rounds).toBe(3)
    expect(yieldTo).toHaveBeenCalledTimes(2)
  })

  it('默认预算是 200', async () => {
    const cache = new DerivedCache()
    cache.acquire('s1', countingModel())
    const result = await drainEntries(cache, 's1', history(DEFAULT_BUDGET * 2))
    expect(result.rounds).toBe(2)
  })
})

describe('中途取消', () => {
  it('shouldStop 为真时立刻停，已折的保留', async () => {
    const cache = new DerivedCache()
    const handle = cache.acquire('s1', countingModel())

    let stopped = false
    const result = await drainEntries(cache, 's1', history(500), {
      budget: 100,
      yieldTo: async () => {
        stopped = true
      },
      shouldStop: () => stopped,
    })

    expect(result.stopped).toBe(true)
    expect(result.rounds).toBe(1)
    expect(result.remaining).toBe(400)
    expect(handle.state().value).toBe(100)
  })

  it('停下后继续喂剩余部分能补齐，且不重复折', async () => {
    const cache = new DerivedCache()
    const handle = cache.acquire('s1', countingModel())
    const all = history(500)

    let stopped = false
    const first = await drainEntries(cache, 's1', all, {
      budget: 100,
      yieldTo: async () => {
        stopped = true
      },
      shouldStop: () => stopped,
    })
    expect(first.remaining).toBe(400)

    const rest = all.slice(all.length - first.remaining)
    const second = await drainEntries(cache, 's1', rest, { budget: 100 })

    expect(second.folded).toBe(400)
    expect(handle.state().value).toBe(500)
  })

  it('重复回放同一批不会重复折', async () => {
    const cache = new DerivedCache()
    const handle = cache.acquire('s1', countingModel())
    const all = history(300)

    await drainEntries(cache, 's1', all, { budget: 100 })
    const again = await drainEntries(cache, 's1', all, { budget: 100 })

    expect(again.folded).toBe(0)
    expect(handle.state().value).toBe(300)
  })
})

describe('边界', () => {
  it('空历史不转', async () => {
    const cache = new DerivedCache()
    cache.acquire('s1', countingModel())
    const result = await drainEntries(cache, 's1', [])
    expect(result).toMatchObject({ rounds: 0, folded: 0, remaining: 0 })
  })

  it('没有消费者时整批丢弃，只转一轮', async () => {
    const cache = new DerivedCache()
    const result = await drainEntries(cache, 'ghost', history(100), { budget: 10 })
    expect(result.rounds).toBe(1)
    expect(result.ignored).toBe(true)
    expect(cache.stats().sessions).toBe(0)
  })

  it('大会话折完消息顺序正确（端到端）', async () => {
    const cache = new DerivedCache()
    const handle = cache.acquire('s1', createConversationModel())

    const entries: DerivedEntry[] = []
    let seq = 1
    for (let turn = 1; turn <= 60; turn += 1) {
      entries.push({ seq: seq++, type: 'turn/start' })
      entries.push({ seq: seq++, type: 'user/message', data: { text: `问 ${turn}` } })
      entries.push({ seq: seq++, type: 'assistant/message', data: { text: `答 ${turn}` } })
      entries.push({ seq: seq++, type: 'turn/end' })
    }

    await drainEntries(cache, 's1', entries, { budget: 25 })

    const state = handle.state().value
    expect(state.turns).toBe(60)
    expect(state.messages.length).toBe(120)
    expect(state.messages.first()?.text).toBe('问 1')
    expect(state.messages.last()?.text).toBe('答 60')
    expect(state.streaming).toBe(false)
  })
})
