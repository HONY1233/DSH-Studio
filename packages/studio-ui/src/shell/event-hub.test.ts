import { describe, expect, it, vi } from 'vitest'

import { DerivedCache } from '../session-derived/cache.js'
import type { DerivedModel } from '../session-derived/model.js'
import type { RawEventEntry, RawSessionEventWindow } from './event-adapter.js'
import { SessionEventHub } from './event-hub.js'

/** 数折叠次数的模型：apply 一次 +1。 */
const counter: DerivedModel<{ n: number }> = {
  key: 'counter',
  initial: () => ({ n: 0 }),
  apply: (state) => ({ n: state.n + 1 }),
}

function ev(seq: number, type = 'user/message'): RawEventEntry {
  return { type: 'event', event: { type, seq, time: 1000, data: { content: 'x' } } }
}

/** 可变窗口的假 source：`set()` 模拟 Host 推送一次变更。 */
function makeSource(entries: RawEventEntry[], revision = 1) {
  let window: RawSessionEventWindow = {
    entries,
    hasMore: false,
    revision,
    change: { kind: 'replace', entries },
  }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => window,
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    /** 追加一条并发通知（模拟 append 变更）。 */
    append(entry: RawEventEntry) {
      const nextEntries = [...window.entries, entry]
      window = {
        entries: nextEntries,
        hasMore: false,
        revision: window.revision + 1,
        change: { kind: 'append', entries: [entry] },
      }
      for (const fn of [...listeners]) fn()
    },
    /** 向上加载更早的历史（prepend）：窗口向前扩展。 */
    prepend(older: RawEventEntry[]) {
      const nextEntries = [...older, ...window.entries]
      window = {
        entries: nextEntries,
        hasMore: false,
        revision: window.revision + 1,
        change: { kind: 'prepend', entries: older },
      }
      for (const fn of [...listeners]) fn()
    },
    /** 通知一次但窗口内容不变（模拟重投）。 */
    republish() {
      for (const fn of [...listeners]) fn()
    },
    get listenerCount() {
      return listeners.size
    },
  }
}

function setup(entries: RawEventEntry[] = [ev(1), ev(2), ev(3)]) {
  const cache = new DerivedCache()
  const handle = cache.acquire('s1', counter)
  const hub = new SessionEventHub({ cache })
  const source = makeSource(entries)
  return { cache, handle, hub, source }
}

describe('SessionEventHub 订阅共享', () => {
  it('第一个视图挂载时折一次', () => {
    const { cache, hub, source } = setup()
    hub.attach('s1', source)
    expect(cache.stats().applies).toBe(3)
    expect(source.listenerCount).toBe(1)
  })

  it('第二个视图共享同一订阅，不重复折叠', () => {
    const { cache, hub, source } = setup()
    hub.attach('s1', source)
    hub.attach('s1', source)

    expect(cache.stats().applies).toBe(3)
    expect(source.listenerCount).toBe(1)
    expect(hub.countOf('s1')).toBe(2)
  })

  it('全部 detach 后订阅解除', () => {
    const { hub, source } = setup()
    const a = hub.attach('s1', source)
    const b = hub.attach('s1', source)
    a()
    expect(source.listenerCount).toBe(1)
    b()
    expect(source.listenerCount).toBe(0)
    expect(hub.size).toBe(0)
  })

  it('detach 幂等，重复调用不会把计数减成负数', () => {
    const { hub, source } = setup()
    const detach = hub.attach('s1', source)
    detach()
    detach()
    expect(source.listenerCount).toBe(0)
  })
})

describe('SessionEventHub 防重折（真机踩过的那个 bug）', () => {
  it('搬家重挂载但 revision 未变 → 不重折', () => {
    const { cache, hub, source } = setup()
    const detach = hub.attach('s1', source)
    expect(cache.stats().applies).toBe(3)

    // React 卸载再挂载：detach 到 0，然后立刻 attach
    detach()
    hub.attach('s1', source)

    // 关键断言：没有多折一次（真机上这里会从 20 变 40）
    expect(cache.stats().applies).toBe(3)
    expect(source.listenerCount).toBe(1)
  })

  it('revision 变了就要折', () => {
    const { cache, hub, source } = setup()
    hub.attach('s1', source)
    expect(cache.stats().applies).toBe(3)

    // 窗口前进了一版（append 一条），但没有订阅者时漏掉了那次通知
    source.append(ev(4))
    expect(cache.stats().applies).toBe(4)

    // 重新 attach 时 revision 已经变了 —— 不该再补折（已经通过订阅收到过）
    hub.attach('s1', source)
    expect(cache.stats().applies).toBe(4)
  })

  it('追加时增量折叠，不整窗重折', () => {
    const { cache, hub, source } = setup()
    hub.attach('s1', source)
    source.append(ev(4))
    source.append(ev(5))

    expect(cache.stats().applies).toBe(5)
    expect(cache.stats().skippedEntries).toBe(0)
  })

  it('重复通知（重投）不增加折叠次数', () => {
    const { cache, hub, source } = setup()
    hub.attach('s1', source)
    const before = cache.stats().applies
    source.republish()
    expect(cache.stats().applies).toBe(before)
  })

  it('向上加载历史（窗口向前扩展）→ 必须重折，且结果完整', () => {
    // 先是 seq 5..7（打开会话时只拿到最近的几条）
    const { cache, hub, source } = setup([ev(5), ev(6), ev(7)])
    const handle = cache.acquire('s1', counter)
    hub.attach('s1', source)
    expect(handle.state().value.n).toBe(3)

    // Host 补上更早的 1..4（prepend）
    source.prepend([ev(1), ev(2), ev(3), ev(4)])

    // 折叠只支持 seq 递增，所以这里必须 reset 后整窗重折
    expect(handle.state().value.n).toBe(7)
    expect(hub.progressOf('s1')).toEqual({ min: 1, max: 7 })
  })

  it('模型支持 prepend 时走增量：只折新增的旧页，不重折已折条数', () => {
    // 不用 setup()：它预置了一个不支持拼接的 counter 槽，任何槽回退都会让
    // 整个会话退回全窗重折（这是预期行为），那样就测不出增量路径了。
    const merging: DerivedModel<{ n: number }> = {
      key: 'merging',
      initial: () => ({ n: 0 }),
      apply: (state) => ({ n: state.n + 1 }),
      prepend: (older, current) => ({ n: older.n + current.n }),
    }
    const cache = new DerivedCache()
    const handle = cache.acquire('s1', merging)
    const hub = new SessionEventHub({ cache })
    const source = makeSource([ev(5), ev(6), ev(7)])
    hub.attach('s1', source)
    expect(handle.state().value.n).toBe(3)
    const appliesBefore = cache.stats().applies

    source.prepend([ev(1), ev(2), ev(3), ev(4)])

    expect(handle.state().value.n).toBe(7)
    // 关键：只多了 4 次（旧页），不是又折 7 条
    expect(cache.stats().applies).toBe(appliesBefore + 4)
    expect(hub.progressOf('s1')).toEqual({ min: 1, max: 7 })
  })
})

describe('SessionEventHub 边界', () => {
  it('没有 source 时 attach 返回空 disposer，不抛错', () => {
    const cache = new DerivedCache()
    const hub = new SessionEventHub({ cache })
    const detach = hub.attach('s1', undefined)
    expect(() => detach()).not.toThrow()
    expect(hub.size).toBe(0)
  })

  it('getSnapshot 抛错时不炸，只告警', () => {
    const cache = new DerivedCache()
    cache.acquire('s1', counter)
    const hub = new SessionEventHub({ cache })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bad = {
      getSnapshot: () => {
        throw new Error('closed')
      },
      subscribe: () => () => {},
    }

    expect(() => hub.attach('s1', bad)).not.toThrow()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('dispose 解掉所有订阅', () => {
    const { hub, source } = setup()
    hub.attach('s1', source)
    hub.dispose()
    expect(source.listenerCount).toBe(0)
    expect(hub.size).toBe(0)
  })
})
