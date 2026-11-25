/**
 * `ChunkedList.update` —— 工具调用要"结果合并回原记录"，必须有原地替换能力。
 *
 * 重点断言两件事：**结构共享**（只复制命中的那块）与**原实例不变**。
 */

import { describe, expect, it } from 'vitest'

import { ChunkedList } from './chunked.js'

const CHUNK = ChunkedList.CHUNK_SIZE

/** 通过反射拿到内部块表，用于断言"哪些块被复制了"。 */
function chunksOf<T>(list: ChunkedList<T>): readonly (readonly T[])[] {
  return (list as unknown as { chunks: readonly (readonly T[])[] }).chunks
}

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i)

describe('ChunkedList.update', () => {
  it('替换指定下标的值', () => {
    const list = ChunkedList.of(['a', 'b', 'c'])
    const next = list.update(1, 'B')
    expect(next.toArray()).toEqual(['a', 'B', 'c'])
    expect(next.length).toBe(3)
  })

  it('原实例不受影响（真不可变）', () => {
    const list = ChunkedList.of(['a', 'b'])
    list.update(0, 'X')
    expect(list.toArray()).toEqual(['a', 'b'])
  })

  it('越界与非法下标返回自身', () => {
    const list = ChunkedList.of([1, 2])
    expect(list.update(-1, 9)).toBe(list)
    expect(list.update(2, 9)).toBe(list)
    expect(list.update(1.5, 9)).toBe(list)
    expect(list.update(Number.NaN, 9)).toBe(list)
  })

  it('值不变时返回自身（避免无谓重渲染）', () => {
    const list = ChunkedList.of([{ v: 1 }])
    const same = list.get(0)
    expect(list.update(0, same as { v: number })).toBe(list)
  })

  it('只复制命中的那一块，其余块整块共享', () => {
    const list = ChunkedList.of(range(CHUNK * 3))
    const next = list.update(1, 999)

    const before = chunksOf(list)
    const after = chunksOf(next)

    expect(after[0]).not.toBe(before[0]) // 命中的块
    expect(after[1]).toBe(before[1]) // 未命中的块继续共享
    expect(after[2]).toBe(before[2])
    expect(before[0]).toHaveLength(CHUNK) // 原块没被改长
    expect(after[0]).toHaveLength(CHUNK)
  })

  it('跨块下标都能正确定位', () => {
    const list = ChunkedList.of(range(CHUNK * 2 + 5))
    expect(list.update(0, -1).get(0)).toBe(-1)
    expect(list.update(CHUNK, -2).get(CHUNK)).toBe(-2)
    expect(list.update(CHUNK * 2 + 4, -3).get(CHUNK * 2 + 4)).toBe(-3)
  })

  it('更新后 toArray 缓存刷新（不会读到旧的展开结果）', () => {
    const list = ChunkedList.of([1, 2, 3])
    expect(list.toArray()).toEqual([1, 2, 3]) // 先 materialize 一次，填上缓存
    const next = list.update(0, 42)
    expect(next.toArray()).toEqual([42, 2, 3])
  })

  it('连续更新同一块不破坏其它块', () => {
    let list = ChunkedList.of(range(CHUNK * 2))
    list = list.update(3, 300)
    list = list.update(4, 400)
    expect(list.get(3)).toBe(300)
    expect(list.get(4)).toBe(400)
    expect(list.get(CHUNK)).toBe(CHUNK)
    expect(list.length).toBe(CHUNK * 2)
  })

  it('长度为 0 的列表 update 无效', () => {
    const empty = ChunkedList.empty<number>()
    expect(empty.update(0, 1)).toBe(empty)
  })
})
