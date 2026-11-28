/**
 * 面板落位：区域 → 布局操作。
 *
 * 这里**不用桩**：直接把 `placeOps` 的产物喂给真实的 `applyOps`，然后检查树形状。
 * 理由是这一层最容易出错的地方正是"操作序列能不能真的被应用"——只断言操作字面量
 * 会漏掉"split 找不到 pane""float 时 tab 不在格里"这类不变量。
 */

import { describe, expect, it } from 'vitest'

import {
  applyOps,
  createMint,
  emptyLayout,
  ensureWorkbenchRegions,
  makeTab,
  type WorkbenchLayout,
} from '../workbench/index.js'
import { placeOps, type Placement, type PlacementIds } from './placement.js'

function harness(placement: Placement) {
  const mint = createMint('t')
  const layout = emptyLayout(mint.pane())
  const ids: PlacementIds = { pane: mint.pane(), split: mint.split(), floatId: mint.float() }
  const tab = makeTab(mint.tab(), { kind: 'panel', contentId: 'p', instanceId: 'p' })
  const basePane = (layout.root as { id: string }).id
  const ops = placeOps(placement, { pane: basePane as never, tab, ids })
  const { next } = applyOps(layout, ops)
  return { layout, next, tab, ids, basePane }
}

/** 把树摊平成 [轴, 子节点 kind...]，方便断言形状。 */
function shape(node: WorkbenchLayout['root']): unknown {
  if (node.kind === 'pane') return `pane(${node.tabs.length})`
  return [node.axis, ...node.children.map(shape)]
}

describe('placeOps', () => {
  it('center 只插进当前格，不切分', () => {
    const { next, tab } = harness('center')
    expect(shape(next.root)).toBe('pane(1)')
    expect(next.root.kind === 'pane' && next.root.tabs[0]?.id).toBe(tab.id)
    expect(next.floats).toHaveLength(0)
  })

  it('right 直接插入固定 right 区域，不切主区', () => {
    const { next, tab } = harness('right')
    expect(shape(next.root)).toBe('pane(0)')
    expect(next.regions?.right.tabs[0]?.id).toBe(tab.id)
    expect(next.regions?.sidebar.tabs).toHaveLength(0)
    expect(next.regions?.bottom.tabs).toHaveLength(0)
    expect(next.floats).toHaveLength(0)
  })

  it('left 直接插入固定 sidebar 区域', () => {
    const { next, tab } = harness('left')
    expect(shape(next.root)).toBe('pane(0)')
    expect(next.regions?.sidebar.tabs[0]?.id).toBe(tab.id)
  })

  it('bottom 直接插入固定 bottom 区域', () => {
    const { next, tab } = harness('bottom')
    expect(shape(next.root)).toBe('pane(0)')
    expect(next.regions?.bottom.tabs[0]?.id).toBe(tab.id)
  })

  it('float 先插进格、再原子浮起来（浮窗里有且只有一个 tab）', () => {
    const { next, tab } = harness('float')
    expect(shape(next.root)).toBe('pane(0)')
    expect(next.floats).toHaveLength(1)
    expect(next.floats[0]?.tabs.map((t) => t.id)).toEqual([tab.id])
    // 浮窗矩形给了默认值，不是 0×0（否则真机上会缩成一个点）
    const rect = next.floats[0]?.rect
    expect(rect && rect.w).toBeGreaterThan(200)
    expect(rect && rect.h).toBeGreaterThan(200)
  })

  it('连续放两次右侧进入同一固定区域，主区始终不 split', () => {
    const mint = createMint('t')
    const pane = mint.pane()
    const start = emptyLayout(pane)
    const mk = (contentId: string) => makeTab(mint.tab(), { kind: 'panel', contentId, instanceId: contentId })
    const ids = (): PlacementIds => ({ pane: mint.pane(), split: mint.split(), floatId: mint.float() })

    const first = applyOps(start, placeOps('right', { pane, tab: mk('a'), ids: ids() })).next
    const second = applyOps(first, placeOps('right', {
      pane,
      tab: mk('b'),
      ids: { ...ids(), regions: first.regions },
    })).next

    expect(shape(second.root)).toBe('pane(0)')
    expect(second.regions?.right.tabs.map((tab) => tab.ref.contentId)).toEqual(['a', 'b'])
  })

  it('尊重恢复出的自定义 region pane id', () => {
    const mint = createMint('custom')
    const pane = mint.pane()
    const base = ensureWorkbenchRegions(emptyLayout(pane))
    const regions = {
      sidebar: { ...base.regions!.sidebar, id: mint.pane() },
      right: { ...base.regions!.right, id: mint.pane() },
      bottom: { ...base.regions!.bottom, id: mint.pane() },
    }
    const tab = makeTab(mint.tab(), { kind: 'panel', contentId: 'p', instanceId: 'p' })
    const { next } = applyOps(
      { ...base, regions },
      placeOps('right', {
        pane,
        tab,
        ids: { pane: mint.pane(), split: mint.split(), floatId: mint.float(), regions },
      }),
    )
    expect(next.regions?.right.id).toBe(regions.right.id)
    expect(next.regions?.right.tabs[0]?.id).toBe(tab.id)
  })

  it('返回值永远非空，且 center 恰好一条操作', () => {
    const mint = createMint('t')
    const tab = makeTab(mint.tab(), { kind: 'panel', contentId: 'p', instanceId: 'p' })
    const ids: PlacementIds = { pane: mint.pane(), split: mint.split(), floatId: mint.float() }
    for (const placement of ['center', 'left', 'right', 'bottom', 'float'] as const) {
      expect(placeOps(placement, { pane: 'p1' as never, tab, ids }).length).toBeGreaterThan(0)
    }
    expect(placeOps('center', { pane: 'p1' as never, tab, ids })).toHaveLength(1)
  })
})
