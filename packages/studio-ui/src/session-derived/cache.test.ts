import { describe, expect, it, vi } from 'vitest'

import { DerivedCache } from './cache.js'
import { createConversationModel } from './conversation.js'
import type { DerivedEntry, DerivedModel } from './model.js'

function clock() {
  let now = 0
  return () => (now += 1)
}

function countingModel(key = 'count'): DerivedModel<number> {
  return { key, initial: () => 0, apply: (state) => state + 1 }
}

const entry = (seq: number, type = 'tick'): DerivedEntry => ({ seq, type })

describe('单次折叠', () => {
  it('同一会话的两个视图只折一遍', () => {
    const cache = new DerivedCache()
    const model = countingModel()

    const a = cache.acquire('s1', model)
    const b = cache.acquire('s1', model)
    cache.ingest('s1', [entry(1), entry(2), entry(3)])

    expect(cache.stats().applies).toBe(3)
    expect(a.state().value).toBe(3)
    expect(b.state().value).toBe(3)
    // 同一份快照对象：React 的 useSyncExternalStore 靠身份判变化
    expect(a.state()).toBe(b.state())
  })

  it('两个视图各自 release 后，缓存仍然留着结果', () => {
    const cache = new DerivedCache()
    const model = countingModel()

    const a = cache.acquire('s1', model)
    cache.ingest('s1', [entry(1)])
    a.release()

    expect(cache.refCount('s1', 'count')).toBe(0)
    expect(cache.peek('s1', 'count')?.value).toBe(1)
    expect(cache.stats().sessions).toBe(1)
  })

  it('重新 acquire 命中缓存，不需要重折（needsReplay=false）', () => {
    const cache = new DerivedCache()
    const model = countingModel()

    cache.acquire('s1', model).release()
    cache.ingest('s1', [entry(1), entry(2)])

    const again = cache.acquire('s1', model)
    expect(again.needsReplay).toBe(false)
    expect(again.state().applied).toBe(2)
    expect(cache.stats().hits).toBe(1)
  })
})

describe('就绪与未知', () => {
  it('没吃到事件时状态是 unknown，不是空', () => {
    const cache = new DerivedCache()
    const handle = cache.acquire('s1', createConversationModel())

    expect(handle.state().status).toBe('unknown')
    expect(handle.state().lastSeq).toBe(-1)
    expect(handle.state().value.messages.toArray()).toEqual([])
  })

  it('折叠过一条就变 ready', () => {
    const cache = new DerivedCache()
    const handle = cache.acquire('s1', createConversationModel())
    cache.ingest('s1', [{ seq: 1, type: 'turn/start' }])

    expect(handle.state().status).toBe('ready')
    expect(handle.state().applied).toBe(1)
  })

  it('没有消费者时 ingest 整批丢弃，也不建会话', () => {
    const cache = new DerivedCache()
    const result = cache.ingest('ghost', [entry(1)])

    expect(result.ignored).toBe(true)
    expect(result.folded).toBe(0)
    expect(cache.stats().sessions).toBe(0)
  })
})

describe('去重与乱序', () => {
  it('重复投递同一批不再折叠', () => {
    const cache = new DerivedCache()
    const handle = cache.acquire('s1', countingModel())
    const batch = [entry(1), entry(2)]

    cache.ingest('s1', batch)
    const second = cache.ingest('s1', batch)

    expect(second.folded).toBe(0)
    expect(second.skipped).toBe(2)
    expect(handle.state().value).toBe(2)
  })

  it('乱序批次也能正确折叠', () => {
    const cache = new DerivedCache()
    const handle = cache.acquire('s1', countingModel())
    cache.ingest('s1', [entry(3), entry(1), entry(2)])

    expect(handle.state().value).toBe(3)
    expect(handle.state().lastSeq).toBe(3)
  })

  it('跨越重复部分只折新增的', () => {
    const cache = new DerivedCache()
    const handle = cache.acquire('s1', countingModel())
    cache.ingest('s1', [entry(1), entry(2)])
    cache.ingest('s1', [entry(2), entry(3), entry(4)])

    expect(handle.state().value).toBe(4)
  })
})

describe('晚加入的模型', () => {
  it('标 needsReplay，回放历史后自己补齐，老 slot 不重复折', () => {
    const cache = new DerivedCache()
    const conversation = createConversationModel()
    const early = cache.acquire('s1', conversation)

    cache.ingest('s1', [
      { seq: 1, type: 'turn/start' },
      { seq: 2, type: 'user/message', data: { text: '你好' } },
      { seq: 3, type: 'turn/end' },
    ])

    const counter = countingModel('later')
    const late = cache.acquire('s1', counter)
    expect(late.needsReplay).toBe(true)

    const replay = cache.ingest('s1', [
      { seq: 1, type: 'turn/start' },
      { seq: 2, type: 'user/message', data: { text: '你好' } },
      { seq: 3, type: 'turn/end' },
    ])

    expect(replay.folded).toBe(3)
    expect(late.state().value).toBe(3)
    // 老 slot 一条都没多吃
    expect(early.state().applied).toBe(3)
    expect(early.state().value.messages.length).toBe(1)
  })
})

describe('换代与丢弃', () => {
  it('generation 变化时旧派生整份作废', () => {
    const cache = new DerivedCache()
    const model = countingModel()

    const first = cache.acquire('s1', model, { generation: 1 })
    cache.ingest('s1', [entry(1), entry(2)])
    expect(first.state().value).toBe(2)

    const second = cache.acquire('s1', model, { generation: 2 })
    expect(second.state().status).toBe('unknown')
    expect(second.state().applied).toBe(0)
    expect(second.generation).toBe(2)
  })

  it('resetGenerations 丢掉不匹配的会话', () => {
    const cache = new DerivedCache()
    const model = countingModel()
    cache.acquire('s1', model, { generation: 1 }).release()
    cache.acquire('s2', model, { generation: 2 }).release()

    const dropped = cache.resetGenerations(2)
    expect(dropped).toEqual(['s1'])
    expect(cache.stats().sessions).toBe(1)
  })

  it('drop 会通知 onEvict', () => {
    const onEvict = vi.fn()
    const cache = new DerivedCache({ onEvict })
    cache.acquire('s1', countingModel()).release()

    cache.drop('s1')
    expect(onEvict).toHaveBeenCalledWith('s1', 'dropped')
  })
})

describe('LRU 淘汰', () => {
  it('容量满了淘汰最久未用的会话', () => {
    const cache = new DerivedCache({ capacity: 2, now: clock() })
    const model = countingModel()

    cache.acquire('s1', model).release()
    cache.acquire('s2', model).release()
    cache.acquire('s3', model)

    expect(cache.stats().sessions).toBe(2)
    expect(cache.peek('s1', 'count')).toBeUndefined()
    expect(cache.peek('s2', 'count')).toBeDefined()
    expect(cache.stats().evicted).toBe(1)
  })

  it('有引用在身的会话不被淘汰，宁可超容量', () => {
    const cache = new DerivedCache({ capacity: 1, now: clock() })
    const model = countingModel()

    const a = cache.acquire('s1', model)
    const b = cache.acquire('s2', model)

    expect(cache.stats().sessions).toBe(2)
    expect(cache.stats().blockedEvictions).toBeGreaterThan(0)
    a.release()
    b.release()
  })

  it('pinned 的会话不参与淘汰，被淘汰的是更老的普通会话', () => {
    const cache = new DerivedCache({ capacity: 2, now: clock() })
    const model = countingModel()

    cache.acquire('s1', model, { pinned: true }).release()
    cache.acquire('s2', model).release()
    cache.acquire('s3', model).release()

    expect(cache.stats().sessions).toBe(2)
    expect(cache.peek('s1', 'count')).toBeDefined()
    expect(cache.peek('s2', 'count')).toBeUndefined()
    expect(cache.peek('s3', 'count')).toBeDefined()
  })

  it('释放之后容量超了会立刻收口', () => {
    const cache = new DerivedCache({ capacity: 1, now: clock() })
    const model = countingModel()

    const a = cache.acquire('s1', model)
    const b = cache.acquire('s2', model)
    expect(cache.stats().sessions).toBe(2)

    a.release()
    b.release()

    expect(cache.stats().sessions).toBe(1)
  })
})

describe('变更通知', () => {
  it('折出新内容时通知一次', () => {
    const cache = new DerivedCache()
    const listener = vi.fn()
    cache.acquire('s1', countingModel())
    cache.subscribe(listener)

    cache.ingest('s1', [entry(1), entry(2)])
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('全部是重复时不通知（否则重投会引发无谓重渲染）', () => {
    const cache = new DerivedCache()
    const handle = cache.acquire('s1', countingModel())
    cache.ingest('s1', [entry(1)])

    const listener = vi.fn()
    cache.subscribe(listener)
    cache.ingest('s1', [entry(1)])
    expect(listener).not.toHaveBeenCalled()
    handle.release()
  })

  it('退订后不再通知', () => {
    const cache = new DerivedCache()
    cache.acquire('s1', countingModel())
    const listener = vi.fn()
    const off = cache.subscribe(listener)
    off()

    cache.ingest('s1', [entry(1)])
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('收口', () => {
  it('release 幂等', () => {
    const cache = new DerivedCache()
    const handle = cache.acquire('s1', countingModel())
    handle.release()
    handle.release()
    expect(cache.refCount('s1', 'count')).toBe(0)
  })

  it('configure 缩小容量会立刻淘汰', () => {
    const cache = new DerivedCache({ capacity: 3, now: clock() })
    const model = countingModel()
    for (const id of ['s1', 's2', 's3']) cache.acquire(id, model).release()

    cache.configure({ capacity: 1 })
    expect(cache.stats().sessions).toBe(1)
  })

  it('stats 把 slot 数算对', () => {
    const cache = new DerivedCache()
    cache.acquire('s1', countingModel('a')).release()
    cache.acquire('s1', countingModel('b')).release()
    cache.acquire('s2', countingModel('a')).release()

    expect(cache.stats()).toMatchObject({ sessions: 2, slots: 3, misses: 3 })
  })
})
