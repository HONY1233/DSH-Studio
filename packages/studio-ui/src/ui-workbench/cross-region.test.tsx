// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createMint,
  emptyLayout,
  findPane,
  findTabHost,
  makeTab,
  type PaneId,
  type Rect,
  type RegionId,
  type Tab,
  type TabHostRef,
  type TabId,
} from '../workbench/index.js'

import { createWorkbenchController, type WorkbenchController } from './controller.js'
import { createWorkbenchLabels } from './labels.js'
import { WorkbenchView } from './workbench-view.js'

const labels = createWorkbenchLabels('zh')
const REGIONS = ['sidebar', 'right', 'bottom'] as const

const REGION_POINT: Readonly<Record<RegionId, { x: number; y: number }>> = {
  sidebar: { x: 100, y: 400 },
  right: { x: 1000, y: 400 },
  bottom: { x: 600, y: 700 },
}

const REGION_RECT: Readonly<Record<RegionId, Rect>> = {
  sidebar: { x: 0, y: 0, w: 220, h: 800 },
  right: { x: 980, y: 0, w: 220, h: 800 },
  bottom: { x: 220, y: 620, w: 760, h: 180 },
}

function domRect(rect: Rect): DOMRect {
  return {
    x: rect.x,
    y: rect.y,
    left: rect.x,
    top: rect.y,
    right: rect.x + rect.w,
    bottom: rect.y + rect.h,
    width: rect.w,
    height: rect.h,
    toJSON() {},
  }
}

function setupController() {
  return createWorkbenchController(emptyLayout(createMint('cross-region').pane()))
}

function renderView(controller: WorkbenchController, extra: Partial<Parameters<typeof WorkbenchView>[0]> = {}) {
  return render(
    <WorkbenchView
      controller={controller}
      labels={labels}
      resolveTitle={(tab: Tab) => tab.title ?? tab.ref.contentId}
      renderContent={(tab) => <div data-testid={`content-${tab.ref.contentId}`}>{tab.title}</div>}
      viewport={{ x: 0, y: 0, w: 1200, h: 800 }}
      {...extra}
    />,
  )
}

function seedTab(controller: WorkbenchController, contentId: string, where: 'pane' | RegionId = 'pane'): Tab {
  const tab = makeTab(controller.mint.tab(), { kind: 'panel', contentId, instanceId: contentId }, contentId)
  if (where === 'pane') {
    const pane = controller.focusedPane()
    if (!pane) throw new Error('no main pane')
    controller.dispatch({ kind: 'insertTab', pane, tab })
  } else {
    controller.dispatch({ kind: 'insertRegionTab', region: where, tab })
  }
  return tab
}

function seedFloat(controller: WorkbenchController, contentId: string, floatId: string): Tab {
  const tab = seedTab(controller, contentId)
  const pane = controller.focusedPane()
  if (!pane) throw new Error('no main pane')
  controller.dispatch({
    kind: 'floatTab',
    from: { kind: 'pane', id: pane },
    tabId: tab.id,
    floatId,
    rect: { x: 760, y: 180, w: 320, h: 320 },
  })
  return tab
}

function mockTarget(element: Element, rect: Rect): void {
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => element) })
  Object.defineProperty(element, 'getBoundingClientRect', { configurable: true, value: () => domRect(rect) })
}

function targetRegion(region: RegionId): void {
  const element = document.querySelector(`[data-region="${region}"]`)
  if (!element) throw new Error(`missing region: ${region}`)
  mockTarget(element, REGION_RECT[region])
}

function dragTab(tab: Tab, point: { x: number; y: number }): HTMLElement | null {
  const source = document.querySelector<HTMLElement>(`[role="tab"][data-tab-id="${tab.id}"]`)
  if (!source) throw new Error(`missing tab: ${tab.id}`)
  fireEvent.pointerDown(source, { button: 0, clientX: 300, clientY: 300 })
  fireEvent.pointerMove(window, { clientX: point.x, clientY: point.y })
  const preview = document.querySelector<HTMLElement>('[data-drag-preview]')
  expect(preview).not.toBeNull()
  fireEvent.pointerUp(window)
  return preview
}

function hostTabs(controller: WorkbenchController, host: TabHostRef): readonly string[] {
  return findTabHost(controller.getState(), host)?.tabs.map((tab) => tab.id) ?? []
}

afterEach(() => {
  Reflect.deleteProperty(document, 'elementFromPoint')
})

describe('跨区域指针拖放', () => {
  it.each(REGIONS)('主区标签拖入 %s，固定区域直接接收', (region) => {
    const controller = setupController()
    const tab = seedTab(controller, 'A')
    renderView(controller)
    targetRegion(region)

    const preview = dragTab(tab, REGION_POINT[region])
    expect(preview?.getAttribute('data-drag-preview')).toBe('zone')
    expect(preview?.style.left).toBe(`${REGION_RECT[region].x}px`)
    expect(preview?.style.top).toBe(`${REGION_RECT[region].y}px`)

    const state = controller.getState()
    expect(state.regions?.[region]?.tabs.map((item) => item.id)).toEqual([tab.id])
    expect(findPane(state.root, state.root.id as PaneId)?.tabs).toEqual([])
    expect(state.focused).toBe(state.regions?.[region]?.id)
  })

  it('固定区域标签可以拖回完全没有主区标签的空主区', () => {
    const controller = setupController()
    const tab = seedTab(controller, 'A', 'sidebar')
    renderView(controller)
    const target = document.querySelector('[data-empty-main-host="true"]')
    if (!target) throw new Error('missing empty main host')
    mockTarget(target, { x: 220, y: 0, w: 760, h: 620 })

    dragTab(tab, { x: 600, y: 300 })

    const state = controller.getState()
    expect(state.regions?.sidebar.tabs).toEqual([])
    expect(findPane(state.root, state.root.id as PaneId)?.tabs.map((item) => item.id)).toEqual([tab.id])
    expect(document.querySelector('[data-empty-main-host="true"]')).toBeNull()
  })

  it.each(REGIONS.flatMap((from) => REGIONS.filter((to) => to !== from).map((to) => [from, to] as const)))(
    '%s 与 %s 之间可直接互拖，不改变主区结构',
    (from, to) => {
      const controller = setupController()
      const tab = seedTab(controller, 'A', from)
      const rootBefore = controller.getState().root
      renderView(controller)
      targetRegion(to)

      dragTab(tab, REGION_POINT[to])

      const state = controller.getState()
      expect(state.regions?.[from]?.tabs).toEqual([])
      expect(state.regions?.[to]?.tabs.map((item) => item.id)).toEqual([tab.id])
      expect(state.root).toBe(rootBefore)
    },
  )

  it.each(['pane', 'sidebar'] as const)('%s 标签可并入已有浮窗', (from) => {
    const controller = setupController()
    const tab = seedTab(controller, 'A', from)
    const targetTab = seedFloat(controller, 'B', 'target-float')
    renderView(controller)
    const target = document.querySelector('[data-float-id="target-float"]')
    if (!target) throw new Error('missing target float')
    mockTarget(target, { x: 760, y: 180, w: 320, h: 320 })

    dragTab(tab, { x: 900, y: 300 })

    const float = controller.getState().floats.find((item) => item.id === 'target-float')
    expect(float?.tabs.map((item) => item.id)).toEqual([targetTab.id, tab.id])
    expect(float?.activeTab).toBe(tab.id)
    expect(hostTabs(controller, { kind: from === 'pane' ? 'pane' : 'region', id: from === 'pane' ? controller.getState().root.id : controller.getState().regions!.sidebar.id })).toEqual([])
  })

  it.each([
    ['pane', 'pane'],
    ['sidebar', 'region'],
    ['float', 'float'],
  ] as const)('浮窗标签可拖到 %s 目标并关闭空源浮窗', (from, targetKind) => {
    const controller = setupController()
    const tab = from === 'float' ? seedFloat(controller, 'A', 'source-float') : seedTab(controller, 'A', from)
    if (targetKind === 'float') seedFloat(controller, 'B', 'target-float')
    renderView(controller)

    if (targetKind === 'pane') {
      const target = document.querySelector('[data-pane-id][data-host-kind="pane"]')
      if (!target) throw new Error('missing main pane')
      mockTarget(target, { x: 220, y: 0, w: 760, h: 620 })
    } else if (targetKind === 'region') {
      targetRegion('right')
    } else {
      const target = document.querySelector('[data-float-id="target-float"]')
      if (!target) throw new Error('missing target float')
      mockTarget(target, { x: 760, y: 180, w: 320, h: 320 })
    }

    dragTab(tab, targetKind === 'region' ? REGION_POINT.right : targetKind === 'float' ? { x: 900, y: 300 } : { x: 600, y: 300 })

    const state = controller.getState()
    const targetHost: TabHostRef = targetKind === 'pane'
      ? { kind: 'pane', id: state.root.id }
      : targetKind === 'region'
        ? { kind: 'region', id: state.regions!.right.id }
        : { kind: 'float', id: 'target-float' }
    expect(hostTabs(controller, targetHost)).toContain(tab.id)
    if (from === 'float') expect(state.floats.some((float) => float.id === 'source-float')).toBe(false)
  })

  it.each(['pane', 'sidebar'] as const)('%s 标签拖到空白处只创建一个新浮窗', (from) => {
    const controller = setupController()
    const tab = seedTab(controller, 'A', from)
    renderView(controller)
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => document.body) })

    dragTab(tab, { x: 600, y: 400 })

    const floats = controller.getState().floats
    expect(floats).toHaveLength(1)
    expect(floats[0]?.tabs.map((item) => item.id)).toEqual([tab.id])
  })

  it('一次跨区拖放只提交一次、保存一次，并只产生一条可撤销历史', () => {
    const save = vi.fn()
    const initial = emptyLayout(createMint('single-commit').pane())
    if (initial.root.kind !== 'pane') throw new Error('expected pane')
    const tab = makeTab('single-tab' as TabId, { kind: 'panel', contentId: 'A', instanceId: 'A' }, 'A')
    const controller = createWorkbenchController({
      ...initial,
      root: { ...initial.root, tabs: [tab], activeTab: tab.id },
    }, { persistence: { save } })
    renderView(controller)
    const before = controller.getState()
    const dispatch = vi.spyOn(controller, 'dispatch')
    const dispatchMany = vi.spyOn(controller, 'dispatchMany')
    save.mockClear()
    targetRegion('sidebar')

    dragTab(tab, REGION_POINT.sidebar)

    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ kind: 'transferTab', tabId: tab.id }), 'transfer-tab')
    expect(dispatchMany).not.toHaveBeenCalled()
    expect(save).toHaveBeenCalledTimes(1)
    expect(controller.canUndo()).toBe(true)
    expect(controller.undo()).toBe(true)
    expect(controller.getState()).toStrictEqual(before)
    expect(controller.canUndo()).toBe(false)
  })

  it('主区→侧栏→右栏保持同一正文 DOM、输入、焦点、选区和滚动', () => {
    const controller = setupController()
    const tab = seedTab(controller, 'A')
    renderView(controller, {
      renderContent: () => (
        <div>
          <input aria-label="region-draft" defaultValue="初始" />
          <div data-testid="region-scroller" style={{ height: 40, overflow: 'auto' }}>
            <div style={{ height: 200 }}>long content</div>
          </div>
        </div>
      ),
    })
    const input = screen.getByLabelText('region-draft') as HTMLInputElement
    const scroller = screen.getByTestId('region-scroller') as HTMLDivElement
    input.value = '跨区草稿'
    input.focus()
    input.setSelectionRange(1, 2)
    scroller.scrollTop = 37

    targetRegion('sidebar')
    dragTab(tab, REGION_POINT.sidebar)
    expect(screen.getByLabelText('region-draft')).toBe(input)
    expect(document.activeElement).toBe(input)

    targetRegion('right')
    dragTab(tab, REGION_POINT.right)

    expect(controller.getState().regions?.right.tabs.map((item) => item.id)).toEqual([tab.id])
    expect(screen.getByLabelText('region-draft')).toBe(input)
    expect(input.value).toBe('跨区草稿')
    expect(document.activeElement).toBe(input)
    expect(input.selectionStart).toBe(1)
    expect(input.selectionEnd).toBe(2)
    expect(scroller.scrollTop).toBe(37)
  })

  it('跨区拖动取消不改变布局、历史或正文宿主', () => {
    const controller = setupController()
    const tab = seedTab(controller, 'A')
    renderView(controller)
    const before = controller.getState()
    const source = document.querySelector(`[role="tab"][data-tab-id="${tab.id}"]`)!
    targetRegion('right')

    fireEvent.pointerDown(source, { button: 0, clientX: 300, clientY: 300 })
    fireEvent.pointerMove(window, REGION_POINT.right)
    expect(document.querySelector('[data-drag-preview="zone"]')).not.toBeNull()
    fireEvent.pointerCancel(window)

    expect(controller.getState()).toBe(before)
    expect(controller.getState().regions?.right.tabs).toEqual([])
    expect(document.querySelector('[data-drag-preview]')).toBeNull()
  })
})

describe('固定区域尺寸调整', () => {
  function separator(region: RegionId): HTMLElement {
    const bar = document.querySelector(`[data-region="${region}"]`)
    const element = region === 'right' ? bar?.previousElementSibling : bar?.nextElementSibling
    if (!(element instanceof HTMLElement) || element.getAttribute('role') !== 'separator') {
      throw new Error(`missing separator: ${region}`)
    }
    Object.defineProperty(element, 'setPointerCapture', { configurable: true, value: vi.fn() })
    Object.defineProperty(element.parentElement!, 'getBoundingClientRect', {
      configurable: true,
      value: () => domRect({ x: 0, y: 0, w: 1200, h: 800 }),
    })
    return element
  }

  it('指针预览不写状态，松手只提交一次尺寸并支持撤销', () => {
    const controller = setupController()
    renderView(controller)
    const before = controller.getState()
    const dispatch = vi.spyOn(controller, 'dispatch')
    const handle = separator('sidebar')

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 220, clientY: 100 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 280, clientY: 100 })
    expect(handle.getAttribute('aria-valuenow')).toBe('280')
    expect(controller.getState()).toBe(before)
    expect(dispatch).not.toHaveBeenCalled()

    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 280, clientY: 100 })
    expect(controller.getState().regionSizes?.sidebar).toBe(280)
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(controller.undo()).toBe(true)
    expect(controller.getState()).toStrictEqual(before)
  })

  it.each(['pointercancel', 'lostpointercapture'] as const)('%s 丢弃尺寸预览且不提交', (kind) => {
    const controller = setupController()
    renderView(controller)
    const before = controller.getState()
    const handle = separator('right')

    fireEvent.pointerDown(handle, { button: 0, pointerId: 2, clientX: 980, clientY: 100 })
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: 920, clientY: 100 })
    expect(handle.getAttribute('aria-valuenow')).toBe('320')
    if (kind === 'pointercancel') fireEvent.pointerCancel(handle, { pointerId: 2 })
    else fireEvent.lostPointerCapture(handle, { pointerId: 2 })

    expect(controller.getState()).toBe(before)
    expect(handle.getAttribute('aria-valuenow')).toBe('260')
  })

  it.each([
    ['sidebar', 'ArrowRight', 230],
    ['right', 'ArrowLeft', 270],
    ['bottom', 'ArrowUp', 190],
  ] as const)('%s 键盘 %s 按正确方向调整尺寸', (region, key, expected) => {
    const controller = setupController()
    renderView(controller)

    fireEvent.keyDown(separator(region), { key })

    expect(controller.getState().regionSizes?.[region]).toBe(expected)
    expect(controller.undo()).toBe(true)
  })

  it('Shift 使用大步长，双击恢复默认尺寸', () => {
    const controller = setupController()
    renderView(controller)
    const handle = separator('sidebar')

    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true })
    expect(controller.getState().regionSizes?.sidebar).toBe(260)
    fireEvent.doubleClick(handle)
    expect(controller.getState().regionSizes).toBeUndefined()
  })

  it('键盘尺寸同样钳制在父容器对应维度的 60%', () => {
    const controller = setupController()
    renderView(controller)
    const handle = separator('sidebar')

    for (let index = 0; index < 20; index += 1) {
      fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true })
    }

    expect(controller.getState().regionSizes?.sidebar).toBe(720)
  })
})
