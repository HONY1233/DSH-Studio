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
  makeTab,
  type WorkbenchLayout,
} from '../workbench/index.js'
import { placeOps, type Placement, type PlacementIds } from './placement.js'

function harness(placement: Placement, ratio?: number) {
  const mint = createMint('t')
  const layout = emptyLayout(mint.pane())
  const ids: PlacementIds = { pane: mint.pane(), split: mint.split(), floatId: mint.float() }
  const tab = makeTab(mint.tab(), { kind: 'panel', contentId: 'p', instanceId: 'p' })
  const basePane = (layout.root as { id: string }).id
  const ops = placeOps(placement, { pane: basePane as never, tab, ids })
  const { next } = applyOps(layout, ops)
  void ratio
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

  it('right 切成 row：左边原格、右边新格，新格带 tab', () => {
    const { next, tab } = harness('right')
    expect(shape(next.root)).toEqual(['row', 'pane(0)', 'pane(1)'])
    const right = next.root.kind === 'split' ? next.root.children[1] : undefined
    expect(right?.kind === 'pane' && right.tabs[0]?.id).toBe(tab.id)
    expect(next.floats).toHaveLength(0)
  })

  it('left 把新格放在前面', () => {
    const { next, tab } = harness('left')
    expect(shape(next.root)).toEqual(['row', 'pane(1)', 'pane(0)'])
    const first = next.root.kind === 'split' ? next.root.children[0] : undefined
    expect(first?.kind === 'pane' && first.tabs[0]?.id).toBe(tab.id)
  })

  it('bottom 切成 column', () => {
    const { next } = harness('bottom')
    expect(shape(next.root)).toEqual(['column', 'pane(0)', 'pane(1)'])
  })

  it('float 先把 tab 插进格、再浮起来（浮窗里有且只有一个 tab）', () => {
    const { next, tab } = harness('float')
    expect(shape(next.root)).toBe('pane(0)')
    expect(next.floats).toHaveLength(1)
    expect(next.floats[0]?.tabs.map((t) => t.id)).toEqual([tab.id])
    // 浮窗矩形给了默认值，不是 0×0（否则真机上会缩成一个点）
    const rect = next.floats[0]?.rect
    expect(rect && rect.w).toBeGreaterThan(200)
    expect(rect && rect.h).toBeGreaterThan(200)
  })

  it('四种区域互不干扰：连续放两次右侧会得到三格', () => {
    const mint = createMint('t')
    const start = emptyLayout(mint.pane())
    const mk = (contentId: string) => makeTab(mint.tab(), { kind: 'panel', contentId, instanceId: contentId })
    // 切完第一次之后根节点已经变成 split，不能再拿 root.id 当 pane 用
    const firstPaneId = (node: WorkbenchLayout['root']): string =>
      node.kind === 'pane' ? node.id : firstPaneId(node.children[0]!)

    const first = applyOps(
      start,
      placeOps('right', {
        pane: firstPaneId(start.root) as never,
        tab: mk('a'),
        ids: { pane: mint.pane(), split: mint.split(), floatId: mint.float() },
      }),
    ).next
    // 第二次以"现在的第一格"为基准再切一刀
    const second = applyOps(
      first,
      placeOps('right', {
        pane: firstPaneId(first.root) as never,
        tab: mk('b'),
        ids: { pane: mint.pane(), split: mint.split(), floatId: mint.float() },
      }),
    ).next

    expect(shape(second.root)).toEqual(['row', ['row', 'pane(0)', 'pane(1)'], 'pane(1)'])
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
