import { describe, expect, it } from 'vitest'

import { isWideTier, sizeOf, tierOf } from './size.js'

const TIERS = [0, 520, 900]

describe('tierOf', () => {
  it('未声明档位时恒为 0', () => {
    expect(tierOf(0)).toBe(0)
    expect(tierOf(2000)).toBe(0)
  })

  it('按下界命中：正好等于阈值算下一档', () => {
    expect(tierOf(519, TIERS)).toBe(0)
    expect(tierOf(520, TIERS)).toBe(1)
    expect(tierOf(899, TIERS)).toBe(1)
    expect(tierOf(900, TIERS)).toBe(2)
  })

  it('超宽仍停在最高档', () => {
    expect(tierOf(4000, TIERS)).toBe(2)
  })

  it('零宽（首帧未测量）落在最低档', () => {
    expect(tierOf(0, TIERS)).toBe(0)
  })
})

describe('sizeOf / isWideTier', () => {
  it('尺寸与档位一起产出', () => {
    expect(sizeOf(600, 400, TIERS)).toEqual({ width: 600, height: 400, tier: 1 })
  })

  it('宽版判定只看档位', () => {
    expect(isWideTier(sizeOf(300, 400, TIERS))).toBe(false)
    expect(isWideTier(sizeOf(1000, 400, TIERS))).toBe(true)
  })
})
