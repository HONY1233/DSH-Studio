// @vitest-environment jsdom
/**
 * G3 门禁：面板正文只能有一个根元素。
 *
 * 这条必须在运行时查 —— 静态分析看不到 `render` 返回的是几个兄弟块。
 * 断言的是"会告警"和"不该告警"，两边都要有，否则改坏了没人知道。
 */

import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PanelContribution } from './contract.js'
import { MULTIPLE_ROOTS_HINT, PanelHost } from './host.js'

function contribution(body: ReactNode, overrides: Partial<PanelContribution> = {}): PanelContribution {
  return {
    id: 'demo',
    title: { zh: '示例', en: 'Demo' },
    scope: 'global',
    regions: ['right'],
    defaultRegion: 'right',
    multi: false,
    keepAlive: true,
    render: () => body,
    ...overrides,
  }
}

function mount(c: PanelContribution, active = true) {
  return render(<PanelHost contribution={c} instanceId="demo@1" active={active} />)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('G3 面板根元素唯一', () => {
  it('单个根元素不告警', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mount(contribution(<div data-testid="only">x</div>))
    expect(warn).not.toHaveBeenCalled()
  })

  it('两个兄弟块告警，并说清后果', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mount(
      contribution(
        <>
          <div>头部</div>
          <div>正文</div>
        </>,
      ),
    )

    expect(warn).toHaveBeenCalledTimes(1)
    const message = String(warn.mock.calls[0]?.[0])
    expect(message).toContain('panel-host')
    expect(message).toContain('demo')
    expect(message).toContain(MULTIPLE_ROOTS_HINT)
  })

  it('多个根元素只告警一次（不刷屏）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { rerender } = mount(
      contribution(
        <>
          <div>a</div>
          <div>b</div>
        </>,
      ),
    )
    rerender(<PanelHost contribution={contribution(<><div>a</div><div>b</div></>)} instanceId="demo@1" active />)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('纯文本不算根元素', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mount(contribution('只有一段文字'))
    expect(warn).not.toHaveBeenCalled()
  })

  it('不保活且不可见时不渲染、也不告警', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { container } = mount(
      contribution(
        <>
          <div>a</div>
          <div>b</div>
        </>,
        { keepAlive: false },
      ),
      false,
    )
    expect(container.querySelector('[data-panel-id]')).toBeNull()
    expect(warn).not.toHaveBeenCalled()
  })
})
