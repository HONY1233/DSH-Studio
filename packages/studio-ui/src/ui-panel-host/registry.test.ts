import { describe, expect, it } from 'vitest'

import type { PanelContribution } from './contract.js'
import { PanelContractError, PanelRegistry } from './registry.js'

function panel(id: string, over: Partial<PanelContribution> = {}): PanelContribution {
  return {
    id,
    title: { zh: id, en: id },
    scope: 'session',
    regions: ['right'],
    multi: false,
    defaultRegion: 'right',
    keepAlive: false,
    render: () => null,
    ...over,
  }
}

describe('PanelRegistry', () => {
  it('注册后可查询与列举', () => {
    const reg = new PanelRegistry()
    reg.register(panel('terminal'))
    reg.register(panel('changes'))
    expect(reg.size).toBe(2)
    expect(reg.has('terminal')).toBe(true)
    expect(reg.ids()).toEqual(['changes', 'terminal'])
  })

  it('非法声明在注册当场抛错并带上全部 issue', () => {
    const reg = new PanelRegistry()
    let error: unknown
    try {
      reg.register(panel('Bad Id', { regions: [], defaultRegion: 'right' }))
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(PanelContractError)
    const issues = (error as PanelContractError).issues.map((i) => i.code)
    expect(issues).toContain('bad-id')
    expect(issues).toContain('no-regions')
  })

  it('重复 id 被拒绝，不会静默覆盖', () => {
    const reg = new PanelRegistry()
    reg.register(panel('terminal'))
    expect(() => reg.register(panel('terminal'))).toThrow(/已被占用/)
    expect(reg.size).toBe(1)
  })

  it('disposer 释放后可以重新注册同 id', () => {
    const reg = new PanelRegistry()
    const dispose = reg.register(panel('terminal'))
    dispose()
    expect(reg.has('terminal')).toBe(false)
    expect(() => reg.register(panel('terminal'))).not.toThrow()
  })

  it('旧的 disposer 不会误删新注册的同 id 面板', () => {
    const reg = new PanelRegistry()
    const oldDispose = reg.register(panel('terminal'))
    oldDispose()
    const fresh = panel('terminal')
    reg.register(fresh)
    oldDispose()
    expect(reg.get('terminal')).toBe(fresh)
  })

  it('disposer 幂等', () => {
    const reg = new PanelRegistry()
    const dispose = reg.register(panel('terminal'))
    dispose()
    expect(() => dispose()).not.toThrow()
    expect(reg.size).toBe(0)
  })
})
