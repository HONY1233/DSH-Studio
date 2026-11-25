// @vitest-environment jsdom
/**
 * 落位记忆。
 *
 * 重点是**坏数据不能连累启动**：这份数据存在 localStorage 里，会被旧版本、
 * 手改、并发标签页写坏。读到不合法的值必须当成"没记忆"，
 * 而不是把一个非法区域名喂给布局操作（那会直接抛 OpError、面板打不开）。
 */

import { describe, expect, it } from 'vitest'

import { browserStorage, isPlacement, PlacementMemory, type PlacementStorage } from './placement-memory.js'

function fakeStorage(initial: Record<string, string> = {}): PlacementStorage & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value
    },
  }
}

describe('PlacementMemory', () => {
  it('记住之后能读回来', () => {
    const memory = new PlacementMemory()
    memory.remember('state', 'bottom')
    expect(memory.get('state')).toBe('bottom')
    expect(memory.get('never')).toBeUndefined()
  })

  it('写入存储，新实例能读到（模拟重启客户端）', () => {
    const storage = fakeStorage()
    new PlacementMemory(storage).remember('state', 'float')
    const reloaded = new PlacementMemory(storage)
    expect(reloaded.get('state')).toBe('float')
  })

  it('重复写同一个值不产生新的存储写入', () => {
    const storage = fakeStorage()
    let writes = 0
    const counted: PlacementStorage = {
      getItem: storage.getItem,
      setItem: (key, value) => {
        writes += 1
        storage.setItem(key, value)
      },
    }
    const memory = new PlacementMemory(counted)
    memory.remember('state', 'right')
    memory.remember('state', 'right')
    expect(writes).toBe(1)
  })

  it('forget 之后回到"没有记忆"，且从存储里也消失', () => {
    const storage = fakeStorage()
    const memory = new PlacementMemory(storage)
    memory.remember('state', 'left')
    memory.forget('state')
    expect(memory.get('state')).toBeUndefined()
    expect(new PlacementMemory(storage).get('state')).toBeUndefined()
  })

  it('存储里是坏 JSON 时当作没记忆，不抛错', () => {
    const storage = fakeStorage({ 'studio.panel-placement.v1': '{not json' })
    const memory = new PlacementMemory(storage)
    expect(memory.get('state')).toBeUndefined()
    // 仍然能正常写入并读出
    memory.remember('state', 'right')
    expect(memory.get('state')).toBe('right')
  })

  it('存储里是不认识的区域名时丢弃那一条，但保留合法的', () => {
    const storage = fakeStorage({
      'studio.panel-placement.v1': JSON.stringify({ a: 'diagonal', b: 'float', c: 42 }),
    })
    const memory = new PlacementMemory(storage)
    expect(memory.get('a')).toBeUndefined()
    expect(memory.get('b')).toBe('float')
    expect(memory.get('c')).toBeUndefined()
  })

  it('setItem 抛异常（配额满/隐私模式）不影响内存里的记忆', () => {
    const storage: PlacementStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    const memory = new PlacementMemory(storage)
    expect(() => memory.remember('state', 'bottom')).not.toThrow()
    expect(memory.get('state')).toBe('bottom')
  })

  it('getItem 抛异常时按空开始', () => {
    const storage: PlacementStorage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {},
    }
    expect(() => new PlacementMemory(storage)).not.toThrow()
    expect(new PlacementMemory(storage).snapshot()).toEqual({})
  })

  it('非法 placement 不写入', () => {
    const memory = new PlacementMemory()
    // @ts-expect-error 故意传非法值
    memory.remember('state', 'diagonal')
    expect(memory.snapshot()).toEqual({})
  })

  it('clear 清空全部记忆', () => {
    const memory = new PlacementMemory()
    memory.remember('a', 'left')
    memory.remember('b', 'right')
    memory.clear()
    expect(memory.snapshot()).toEqual({})
  })

  it('isPlacement 白名单校验', () => {
    for (const ok of ['center', 'left', 'right', 'bottom', 'float']) expect(isPlacement(ok)).toBe(true)
    for (const bad of ['', 'Center', 'top', null, undefined, 1]) expect(isPlacement(bad)).toBe(false)
  })

  it('browserStorage 在 jsdom 里能拿到，拿不到时返回 undefined（不抛）', () => {
    // jsdom 提供 localStorage
    expect(browserStorage()).toBeDefined()
    const original = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked')
      },
    })
    expect(browserStorage()).toBeUndefined()
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: original })
  })
})
