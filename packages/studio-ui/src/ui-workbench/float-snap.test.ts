import { describe, expect, it } from 'vitest'

import { clampFloatRect, moveFloatRects, nextMinimizedPosition, snapFloatAt } from './float-snap.js'

const viewport = { x: 0, y: 0, w: 1200, h: 800 }

describe('snapFloatAt', () => {
  it('边缘返回半屏，角落优先返回四象限', () => {
    expect(snapFloatAt({ x: 8, y: 300 }, viewport)?.region).toBe('left')
    expect(snapFloatAt({ x: 1192, y: 300 }, viewport)?.region).toBe('right')
    expect(snapFloatAt({ x: 500, y: 8 }, viewport)?.region).toBe('top')
    expect(snapFloatAt({ x: 500, y: 792 }, viewport)?.region).toBe('bottom')
    expect(snapFloatAt({ x: 8, y: 8 }, viewport)?.region).toBe('topLeft')
    expect(snapFloatAt({ x: 1192, y: 792 }, viewport)?.region).toBe('bottomRight')
  })

  it('阈值外不吸附，负坐标视口使用相同几何', () => {
    expect(snapFloatAt({ x: 100, y: 100 }, viewport)).toBeNull()
    const shifted = { x: -1200, y: -200, w: 1200, h: 800 }
    expect(snapFloatAt({ x: -1192, y: 100 }, shifted)?.rect).toEqual({ x: -1200, y: -200, w: 600, h: 800 })
  })
})

describe('clampFloatRect', () => {
  it('把浮窗限制在视口内并处理浮窗大于视口', () => {
    expect(clampFloatRect({ x: -50, y: 900, w: 300, h: 200 }, viewport)).toEqual({ x: 0, y: 600, w: 300, h: 200 })
    expect(clampFloatRect({ x: -50, y: -50, w: 1400, h: 900 }, viewport)).toEqual({ x: 0, y: 0, w: 1200, h: 800 })
  })
})

describe('moveFloatRects', () => {
  it('整组应用同一位移并保持相对位置', () => {
    const moved = moveFloatRects(
      [
        { id: 'a', rect: { x: 100, y: 100, w: 300, h: 200 } },
        { id: 'b', rect: { x: 150, y: 140, w: 300, h: 200 } },
      ],
      { x: 50, y: 40 },
      viewport,
    )
    expect(moved.a).toEqual({ x: 150, y: 140, w: 300, h: 200 })
    expect(moved.b).toEqual({ x: 200, y: 180, w: 300, h: 200 })
  })

  it('越界时钳制整组边界而不是拉散相对位置', () => {
    const moved = moveFloatRects(
      [
        { id: 'a', rect: { x: 900, y: 600, w: 300, h: 200 } },
        { id: 'b', rect: { x: 950, y: 640, w: 300, h: 200 } },
      ],
      { x: 500, y: 500 },
      viewport,
    )
    expect(moved.a).toEqual({ x: 850, y: 560, w: 300, h: 200 })
    expect(moved.b).toEqual({ x: 900, y: 600, w: 300, h: 200 })
  })
})

describe('nextMinimizedPosition', () => {
  it('跳过已占用胶囊并从底部向上排布', () => {
    const first = nextMinimizedPosition(viewport, [])
    const second = nextMinimizedPosition(viewport, [first])
    expect(first).toEqual({ x: 16, y: 752 })
    expect(second).toEqual({ x: 164, y: 752 })
  })

  it('当前行放满后换到下一列', () => {
    const occupied = Array.from({ length: 7 }, () => ({ x: 16, y: 752 }))
    const position = nextMinimizedPosition(viewport, occupied)
    expect(position.x).toBe(164)
    expect(position.y).toBe(752)
  })
})
