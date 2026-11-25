// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { ChunkedList } from './chunked.js'

const CHUNK = ChunkedList.CHUNK_SIZE

/** 测试里偷看内部块表 —— 结构共享是本类唯一的存在理由，必须直接断言。 */
function chunksOf<T>(list: ChunkedList<T>): readonly (readonly T[])[] {
  return (list as unknown as { chunks: readonly (readonly T[])[] }).chunks
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i)
}

describe('基本行为', () => {
  it('空列表', () => {
    const list = ChunkedList.empty<number>()
    expect(list.length).toBe(0)
    expect(list.isEmpty).toBe(true)
    expect(list.toArray()).toEqual([])
    expect(list.first()).toBeUndefined()
    expect(list.last()).toBeUndefined()
    expect([...list]).toEqual([])
  })

  it('append 保持顺序与长度', () => {
    let list = ChunkedList.empty<string>()
    for (const word of ['a', 'b', 'c']) list = list.append(word)

    expect(list.length).toBe(3)
    expect(list.toArray()).toEqual(['a', 'b', 'c'])
    expect(list.get(0)).toBe('a')
    expect(list.get(2)).toBe('c')
    expect(list.first()).toBe('a')
    expect(list.last()).toBe('c')
  })

  it('越界与非法索引返回 undefined，不抛', () => {
    const list = ChunkedList.of([1, 2])
    expect(list.get(-1)).toBeUndefined()
    expect(list.get(2)).toBeUndefined()
    expect(list.get(1.5)).toBeUndefined()
    expect(list.get(Number.NaN)).toBeUndefined()
  })

  it('at 支持负索引', () => {
    const list = ChunkedList.of(['x', 'y', 'z'])
    expect(list.at(-1)).toBe('z')
    expect(list.at(-3)).toBe('x')
    expect(list.at(-4)).toBeUndefined()
  })

  it('append 不修改原列表（不可变）', () => {
    const a = ChunkedList.of([1, 2])
    const b = a.append(3)
    expect(a.toArray()).toEqual([1, 2])
    expect(b.toArray()).toEqual([1, 2, 3])
  })
})

describe('结构共享（这个类的存在理由）', () => {
  it('跨块追加时，之前所有块整块共享', () => {
    const full = ChunkedList.of(range(CHUNK))
    const next = full.append(CHUNK)

    const before = chunksOf(full)
    const after = chunksOf(next)

    expect(before).toHaveLength(1)
    expect(after).toHaveLength(2)
    // 关键断言：第一个块是同一个对象，没有被复制。
    expect(after[0]).toBe(before[0])
  })

  it('块内追加时，只有末块被替换，前面的块原样共享', () => {
    const list = ChunkedList.of(range(CHUNK + 5)) // 末块 5 条，不满
    const grown = list.append(999)

    const before = chunksOf(list)
    const after = chunksOf(grown)

    expect(after[0]).toBe(before[0])
    expect(after[1]).not.toBe(before[1])
    expect(before[1]).toHaveLength(5)
    expect(after[1]).toHaveLength(6)
  })

  it('末块已满时开新块，旧块全部共享（不做重排）', () => {
    const list = ChunkedList.of(range(CHUNK * 2))
    const grown = list.append(CHUNK * 2)

    const before = chunksOf(list)
    const after = chunksOf(grown)

    expect(after).toHaveLength(3)
    expect(after[0]).toBe(before[0])
    expect(after[1]).toBe(before[1])
    expect(after[2]).toHaveLength(1)
  })

  it('一万次追加后块数只为 ceil(n / CHUNK)，不会块块复制', () => {
    let list = ChunkedList.empty<number>()
    for (let i = 0; i < 10_000; i += 1) list = list.append(i)

    expect(list.length).toBe(10_000)
    expect(chunksOf(list)).toHaveLength(Math.ceil(10_000 / CHUNK))
    // 除末块外每块都是满的
    const chunks = chunksOf(list)
    for (let i = 0; i < chunks.length - 1; i += 1) expect(chunks[i]).toHaveLength(CHUNK)
  })
})

describe('展开与迭代', () => {
  it('跨多块展开顺序正确', () => {
    const source = range(CHUNK * 3 + 7)
    const list = ChunkedList.of(source)
    expect(list.toArray()).toEqual(source)
  })

  it('toArray 按实例记忆（同一份 state 渲染多次不重复展开）', () => {
    const list = ChunkedList.of([1, 2, 3])
    expect(list.toArray()).toBe(list.toArray())

    // 换代后是新实例，结果更新
    const next = list.append(4)
    expect(next.toArray()).not.toBe(list.toArray())
    expect(next.toArray()).toEqual([1, 2, 3, 4])
  })

  it('toArray 返回冻结数组，防止调用方就地改坏记忆结果', () => {
    const list = ChunkedList.of([1, 2, 3])
    const array = list.toArray()
    expect(Object.isFrozen(array)).toBe(true)
    expect(() => {
      ;(array as number[]).push(4)
    }).toThrow()
    expect(list.toArray()).toEqual([1, 2, 3])
  })

  it('迭代器与 Array.from 顺序一致', () => {
    const list = ChunkedList.of(range(CHUNK + 5))
    expect(Array.from(list).length).toBe(CHUNK + 5)
    expect([...list].slice(0, 3)).toEqual([0, 1, 2])
    expect([...list].slice(-2)).toEqual([CHUNK + 3, CHUNK + 4])
  })

  it('空列表的 toArray 是共享常量', () => {
    expect(ChunkedList.empty<number>().toArray()).toBe(ChunkedList.empty<number>().toArray())
  })
})

describe('便利方法', () => {
  it('map / filter / slice 与数组语义一致', () => {
    const list = ChunkedList.of(range(10))
    const source = range(10)

    expect(list.map((v) => v * 2)).toEqual(source.map((v) => v * 2))
    expect(list.filter((v) => v % 3 === 0)).toEqual(source.filter((v) => v % 3 === 0))
    expect(list.slice(2, 5)).toEqual(source.slice(2, 5))
  })

  it('forEach 的索引正确（块边界处也不会归零）', () => {
    const list = ChunkedList.of(range(CHUNK * 2 + 3))
    const seen: number[] = []
    list.forEach((value, index) => {
      if (index % CHUNK === 0) seen.push(index)
      if (value !== index) throw new Error(`value ${value} != index ${index}`)
    })
    expect(seen).toEqual([0, CHUNK, CHUNK * 2])
  })

  it('some 命中即停', () => {
    let visited = 0
    const list = ChunkedList.of(range(100))
    const hit = list.some((v) => {
      visited += 1
      return v === 3
    })
    expect(hit).toBe(true)
    expect(visited).toBe(4)
  })

  it('appendAll 等价于逐个 append', () => {
    const list = ChunkedList.empty<number>().appendAll([1, 2, 3])
    expect(list.toArray()).toEqual([1, 2, 3])
    expect(ChunkedList.of([1]).appendAll([]).toArray()).toEqual([1])
  })

  it('toJSON 给出可序列化的数组', () => {
    expect(JSON.parse(JSON.stringify({ m: ChunkedList.of([1, 2]) }))).toEqual({ m: [1, 2] })
  })
})

describe('大列表回归（分块不能把顺序搞乱）', () => {
  it('3000 条消息逐条 append 后内容与顺序完全正确', () => {
    let list = ChunkedList.empty<number>()
    for (let i = 0; i < 3000; i += 1) list = list.append(i)

    const out = list.toArray()
    expect(out).toHaveLength(3000)
    expect(out[0]).toBe(0)
    expect(out[2999]).toBe(2999)
    for (let i = 0; i < 3000; i += 1) expect(out[i]).toBe(i)
  })

  it('先 of 再大量 append，块边界处的索引不串位', () => {
    const base = ChunkedList.of(range(CHUNK * 2 - 1)) // 末块差 1 条满
    let list = base
    for (let i = 0; i < 10; i += 1) list = list.append(1000 + i)

    expect(list.get(CHUNK * 2 - 1)).toBe(1000)
    expect(list.get(CHUNK * 2)).toBe(1001)
    expect(list.length).toBe(CHUNK * 2 + 9)
    expect(list.toArray()).toEqual([...range(CHUNK * 2 - 1), ...range(10).map((i) => 1000 + i)])
  })
})
