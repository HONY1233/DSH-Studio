import { describe, expect, it } from 'vitest'

import {
  MIN_CELL,
  bands,
  canDock,
  canSplit,
  clampRect,
  pickZone,
  snapZones,
  sticky,
} from './snap.js'

const WORK = { x: 0, y: 0, w: 1200, h: 800 }

describe('bands', () => {
  it('常规宽度落在 omp 实测区间内', () => {
    const b = bands(WORK)
    expect(b.edge).toBeGreaterThanOrEqual(64)
    expect(b.edge).toBeLessThanOrEqual(112)
    expect(b.cornerW).toBeGreaterThanOrEqual(112)
    expect(b.cornerW).toBeLessThanOrEqual(192)
    expect(b.top).toBeGreaterThanOrEqual(48)
    expect(b.top).toBeLessThanOrEqual(72)
  })

  it('极窄工作区被下限夹住', () => {
    const b = bands({ x: 0, y: 0, w: 400, h: 300 })
    expect(b.edge).toBe(64)
    expect(b.cornerW).toBe(112)
  })

  it('超大工作区被上限夹住', () => {
    const b = bands({ x: 0, y: 0, w: 4000, h: 2400 })
    expect(b.edge).toBe(112)
    expect(b.cornerW).toBe(192)
    expect(b.top).toBe(72)
  })
})

describe('snapZones', () => {
  it('按住修饰键时不产生任何落区', () => {
    expect(snapZones(WORK, { modifierPaused: true })).toHaveLength(0)
  })

  it('四角优先于边缘，顺序即优先级', () => {
    const zones = snapZones(WORK)
    expect(zones[0]?.kind).toBe('corner')
    const firstEdge = zones.findIndex((z) => z.kind === 'edge')
    const lastCorner = zones.map((z) => z.kind).lastIndexOf('corner')
    expect(lastCorner).toBeLessThan(firstEdge)
  })

  it('空间不足时角落落区被剔除，但不影响边缘', () => {
    // 800×400：半屏 400×400 放得下，但四分之一只有 400×200（高度不足）。
    const small = { x: 0, y: 0, w: 800, h: 400 }
    const zones = snapZones(small)
    expect(zones.some((z) => z.kind === 'corner')).toBe(false)
    expect(zones.some((z) => z.kind === 'edge')).toBe(true)
  })

  it('宽度不足以分两栏时保留顶部与底部落区', () => {
    const narrow = { x: 0, y: 0, w: 500, h: 600 }
    const zones = snapZones(narrow)
    expect(zones.map((z) => z.kind)).toEqual(['top', 'bottom'])
  })

  it('底部边缘命中下半屏停靠区', () => {
    const zones = snapZones(WORK)
    expect(pickZone({ x: 600, y: 780 }, zones)?.dest).toEqual({ to: 'edge', region: 'bottom' })
    expect(pickZone({ x: 600, y: 780 }, zones)?.rect).toEqual({ x: 0, y: 400, w: 1200, h: 400 })
  })

  it('面板最小尺寸大于分区时该落区消失', () => {
    const zones = snapZones(WORK, { minSize: { w: 700, h: 100 } })
    expect(zones.every((z) => z.rect.w >= 700)).toBe(true)
  })

  it('落区几何与目标一致', () => {
    const zones = snapZones(WORK)
    const left = zones.find((z) => z.region === 'left')
    expect(left?.rect).toEqual({ x: 0, y: 0, w: 600, h: 800 })
    const tl = zones.find((z) => z.corner === 'tl')
    expect(tl?.rect).toEqual({ x: 0, y: 0, w: 600, h: 400 })
  })
})

describe('pickZone', () => {
  it('左上角落命中角落落区', () => {
    const zones = snapZones(WORK)
    expect(pickZone({ x: 20, y: 20 }, zones)?.corner).toBe('tl')
  })

  it('中部空白不命中', () => {
    const zones = snapZones(WORK)
    expect(pickZone({ x: 600, y: 400 }, zones)).toBeUndefined()
  })

  it('左边缘中段命中左半屏', () => {
    const zones = snapZones(WORK)
    expect(pickZone({ x: 30, y: 400 }, zones)?.dest).toEqual({ to: 'edge', region: 'left' })
  })
})

describe('sticky 预览保持', () => {
  const zones = snapZones(WORK)

  it('刚离开热区 24px 内仍保持上一落区', () => {
    const prev = pickZone({ x: 30, y: 400 }, zones)
    expect(prev?.dest).toEqual({ to: 'edge', region: 'left' })
    // 左边缘热区宽 96px；110 已出界但在 24px 缓冲内。
    const held = sticky(prev, { x: 110, y: 400 }, zones, 24)
    expect(held?.dest).toEqual(prev?.dest)
  })

  it('远离热区后不再保持', () => {
    const prev = pickZone({ x: 30, y: 400 }, zones)
    expect(sticky(prev, { x: 600, y: 400 }, zones, 24)).toBeUndefined()
  })

  it('越过缓冲带后切换', () => {
    const prev = pickZone({ x: 30, y: 400 }, zones)
    // 右边缘热区从 1104px 起（工作区 1200 − 96）。
    const moved = sticky(prev, { x: 1150, y: 400 }, zones, 24)
    expect(moved?.region).toBe('right')
  })

  it('更靠前的落区优先（角落吃掉边缘）', () => {
    const prev = pickZone({ x: 1150, y: 400 }, zones)
    const switched = sticky(prev, { x: 1150, y: 20 }, zones, 24)
    expect(switched?.corner).toBe('tr')
  })
})

describe('可行性判据', () => {
  it('小于最小分区不允许停靠', () => {
    expect(canDock({ x: 0, y: 0, w: 300, h: 900 })).toBe(false)
    expect(canDock({ x: 0, y: 0, w: MIN_CELL.w, h: MIN_CELL.h })).toBe(true)
  })

  it('面板自带最小尺寸时以更大者为准', () => {
    const rect = { x: 0, y: 0, w: 500, h: 400 }
    expect(canDock(rect)).toBe(true)
    expect(canDock(rect, { w: 600, h: 100 })).toBe(false)
  })

  it('半格放不下就不能再分栏', () => {
    expect(canSplit({ x: 0, y: 0, w: 1200, h: 800 }, 'row')).toBe(true)
    expect(canSplit({ x: 0, y: 0, w: 700, h: 800 }, 'row')).toBe(false)
    expect(canSplit({ x: 0, y: 0, w: 700, h: 800 }, 'column')).toBe(true)
  })
})

describe('clampRect', () => {
  const viewport = { x: 0, y: 0, w: 1000, h: 700 }

  it('越界浮窗被推回视口', () => {
    expect(clampRect({ x: 900, y: 650, w: 300, h: 200 }, viewport)).toEqual({
      x: 700,
      y: 500,
      w: 300,
      h: 200,
    })
  })

  it('比视口大的浮窗按视口尺寸绘制', () => {
    expect(clampRect({ x: -100, y: -100, w: 2000, h: 1400 }, viewport)).toEqual({
      x: 0,
      y: 0,
      w: 1000,
      h: 700,
    })
  })
})
