import { describe, expect, it } from 'vitest'

import type { PanelContribution } from './contract.js'
import { validateContribution } from './contract.js'

function base(over: Partial<PanelContribution> = {}): PanelContribution {
  return {
    id: 'terminal',
    title: { zh: '终端', en: 'Terminal' },
    scope: 'session',
    regions: ['bottom', 'right'],
    multi: false,
    defaultRegion: 'bottom',
    widthTiers: [0, 520, 900],
    keepAlive: true,
    render: () => null,
    ...over,
  }
}

describe('validateContribution', () => {
  it('合法声明没有 issue', () => {
    expect(validateContribution(base())).toHaveLength(0)
  })

  it('id 不能为空', () => {
    expect(validateContribution(base({ id: '' }))[0]?.code).toBe('empty-id')
  })

  it('id 不能含持久化分隔符', () => {
    const codes = validateContribution(base({ id: 'files@2' })).map((i) => i.code)
    expect(codes).toContain('bad-id')
    expect(codes).toContain('multi-instance-in-id')
  })

  it('regions 为空会被拒绝', () => {
    expect(validateContribution(base({ regions: [] })).map((i) => i.code)).toContain('no-regions')
  })

  it('默认区域必须在允许区域内', () => {
    const codes = validateContribution(base({ regions: ['right'], defaultRegion: 'bottom' })).map((i) => i.code)
    expect(codes).toContain('default-not-in-regions')
  })

  it('档位必须从 0 开始且升序', () => {
    expect(validateContribution(base({ widthTiers: [200, 400] })).map((i) => i.code)).toContain('bad-tiers')
    expect(validateContribution(base({ widthTiers: [0, 900, 520] })).map((i) => i.code)).toContain('bad-tiers')
  })

  it('最小尺寸必须为正', () => {
    expect(validateContribution(base({ minSize: { w: 0, h: 100 } })).map((i) => i.code)).toContain('bad-min-size')
  })
})
