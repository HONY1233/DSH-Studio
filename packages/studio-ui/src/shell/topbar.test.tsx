// @vitest-environment jsdom
/**
 * 顶栏面板菜单 —— 重点是「放哪」这一段。
 *
 * 三条产品判断都落在这里：
 * 1) 点面板名 = 按 `defaultRegion` 打开，**一次点击**走完常用路径；
 * 2) 「放哪」只列面板 `regions` 里声明过的区域 —— 面板自己说不能去左边，
 *    菜单就不该给它这个选项（否则点下去要么报错要么偷偷改到别处）；
 * 3) 展开是互斥的，关掉菜单必须重置 —— 否则下次打开还挂着上一次的子菜单。
 */

import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { PanelContribution } from '../ui-panel-host/contract.js'
import { PanelRegistry } from '../ui-panel-host/registry.js'
import { defaultTopbarLabels, StudioTopbar } from './topbar.js'

function panel(id: string, zh: string, over: Partial<PanelContribution> = {}): PanelContribution {
  return {
    id,
    title: { zh, en: zh },
    scope: 'global',
    regions: ['right', 'float'],
    multi: false,
    defaultRegion: 'right',
    keepAlive: false,
    render: () => null,
    ...over,
  }
}

function setup(
  contributions: PanelContribution[] = [panel('state', '工作台状态'), panel('info', '会话信息')],
) {
  const registry = new PanelRegistry()
  for (const c of contributions) registry.register(c)
  const onOpenPanel = vi.fn()
  render(<StudioTopbar panels={registry} onOpenPanel={onOpenPanel} />)
  fireEvent.click(screen.getByTestId('studio-panel-menu-button'))
  return { registry, onOpenPanel }
}

describe('StudioTopbar 面板菜单', () => {
  it('点面板名按默认区域打开（不传 placement）', () => {
    const { onOpenPanel } = setup()
    fireEvent.click(screen.getAllByTestId('studio-panel-menu-item')[0]!)
    expect(onOpenPanel).toHaveBeenCalledWith('state')
    // 一次点击就够，不该弹二级菜单
    expect(screen.queryByTestId('studio-panel-regions')).toBeNull()
  })

  it('只列该面板声明过的区域', () => {
    setup()
    fireEvent.click(screen.getAllByTestId('studio-panel-region-toggle')[0]!)
    const regions = screen.getByTestId('studio-panel-regions')
    const labels = within(regions)
      .getAllByTestId('studio-panel-region')
      .map((el) => el.textContent)
    expect(labels).toEqual(['右侧', '浮窗'])
    // 没声明「左侧」，就不该出现
    expect(labels).not.toContain('左侧')
  })

  it('点区域把 placement 传出去', () => {
    const { onOpenPanel } = setup()
    fireEvent.click(screen.getAllByTestId('studio-panel-region-toggle')[0]!)
    fireEvent.click(screen.getAllByTestId('studio-panel-region')[0]!)
    expect(onOpenPanel).toHaveBeenCalledWith('state', 'right')

    // 浮窗那次
    fireEvent.click(screen.getByTestId('studio-panel-menu-button'))
    fireEvent.click(screen.getAllByTestId('studio-panel-region-toggle')[0]!)
    const chips = screen.getAllByTestId('studio-panel-region')
    fireEvent.click(chips[1]!)
    expect(onOpenPanel).toHaveBeenLastCalledWith('state', 'float')
  })

  it('展开是互斥的：展开第二个，第一个自动收起', () => {
    setup()
    fireEvent.click(screen.getAllByTestId('studio-panel-region-toggle')[0]!)
    fireEvent.click(screen.getAllByTestId('studio-panel-region-toggle')[1]!)
    expect(screen.getAllByTestId('studio-panel-regions')).toHaveLength(1)
    const toggle = screen.getAllByTestId('studio-panel-region-toggle')[1]!
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
  })

  it('再点一次 ▾ 收起', () => {
    setup()
    const toggle = screen.getAllByTestId('studio-panel-region-toggle')[0]!
    fireEvent.click(toggle)
    expect(screen.queryByTestId('studio-panel-regions')).not.toBeNull()
    fireEvent.click(screen.getAllByTestId('studio-panel-region-toggle')[0]!)
    expect(screen.queryByTestId('studio-panel-regions')).toBeNull()
  })

  it('关掉菜单再打开，不残留上次的展开状态', () => {
    setup()
    fireEvent.click(screen.getAllByTestId('studio-panel-region-toggle')[0]!)
    // 再点菜单按钮：关闭
    fireEvent.click(screen.getByTestId('studio-panel-menu-button'))
    expect(screen.queryByTestId('studio-panel-menu')).toBeNull()
    // 再打开
    fireEvent.click(screen.getByTestId('studio-panel-menu-button'))
    expect(screen.queryByTestId('studio-panel-regions')).toBeNull()
  })

  it('空注册表给一句人话，不是空菜单', () => {
    setup([])
    expect(screen.getByTestId('studio-panel-menu').textContent).toContain(defaultTopbarLabels.empty)
  })

  it('aria-expanded 跟随菜单开关', () => {
    setup()
    expect(screen.getByTestId('studio-panel-menu-button').getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByTestId('studio-panel-menu-button'))
    expect(screen.getByTestId('studio-panel-menu-button').getAttribute('aria-expanded')).toBe('false')
  })

  it('只声明浮窗的面板：菜单里只有「浮窗」一个选项', () => {
    setup([panel('only-float', '只浮窗', { regions: ['float'], defaultRegion: 'float' })])
    fireEvent.click(screen.getByTestId('studio-panel-region-toggle'))
    expect(screen.getAllByTestId('studio-panel-region').map((el) => el.textContent)).toEqual(['浮窗'])
  })
})

describe("StudioTopbar 落位记忆", () => {
  it("菜单显示下次会放哪，记忆与否用颜色/属性区分", () => {
    const registry = new PanelRegistry()
    registry.register(panel("state", "工作台状态"))
    render(
      <StudioTopbar
        panels={registry}
        onOpenPanel={vi.fn()}
        regionOf={() => ({ placement: "bottom", remembered: true })}
      />,
    )
    fireEvent.click(screen.getByTestId("studio-panel-menu-button"))
    const hint = screen.getByTestId("studio-panel-region-hint")
    expect(hint.textContent).toBe("底部")
    expect(hint.getAttribute("data-remembered")).toBe("true")
  })

  it("记下来时该区域被高亮，并多一个「默认」出口", () => {
    const registry = new PanelRegistry()
    registry.register(panel("state", "工作台状态"))
    render(
      <StudioTopbar
        panels={registry}
        onOpenPanel={vi.fn()}
        regionOf={() => ({ placement: "right", remembered: true })}
      />,
    )
    fireEvent.click(screen.getByTestId("studio-panel-menu-button"))
    fireEvent.click(screen.getAllByTestId("studio-panel-region-toggle")[0]!)
    const chips = screen.getAllByTestId("studio-panel-region")
    expect(chips[0]!.getAttribute("data-current")).toBe("true")
    expect(screen.getByTestId("studio-panel-region-reset")).toBeDefined()
  })

  it("没有记忆时不高亮、也没有「默认」按钮", () => {
    const registry = new PanelRegistry()
    registry.register(panel("state", "工作台状态"))
    render(
      <StudioTopbar
        panels={registry}
        onOpenPanel={vi.fn()}
        regionOf={() => ({ placement: "right", remembered: false })}
      />,
    )
    fireEvent.click(screen.getByTestId("studio-panel-menu-button"))
    fireEvent.click(screen.getAllByTestId("studio-panel-region-toggle")[0]!)
    expect(screen.getAllByTestId("studio-panel-region")[0]!.getAttribute("data-current")).toBeNull()
    expect(screen.queryByTestId("studio-panel-region-reset")).toBeNull()
  })

  it("点「默认」= 明确不记忆（清掉旧记忆）", () => {
    const registry = new PanelRegistry()
    registry.register(panel("state", "工作台状态"))
    const onOpenPanel = vi.fn()
    render(
      <StudioTopbar
        panels={registry}
        onOpenPanel={onOpenPanel}
        regionOf={() => ({ placement: "float", remembered: true })}
      />,
    )
    fireEvent.click(screen.getByTestId("studio-panel-menu-button"))
    fireEvent.click(screen.getAllByTestId("studio-panel-region-toggle")[0]!)
    fireEvent.click(screen.getByTestId("studio-panel-region-reset"))
    expect(onOpenPanel).toHaveBeenCalledWith("state", undefined, { remember: false })
  })
})
