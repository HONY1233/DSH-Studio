import { describe, expect, it } from 'vitest'

import {
  type PaneId,
  type SplitId,
  type TabId,
  type WorkbenchLayout,
  compact,
  createMint,
  emptyLayout,
  makeTab,
  panes,
  sameLayout,
  view,
} from './layout.js'
import { WorkbenchHistory, applyInverse, applyOp, applyOps, type LayoutOp } from './ops.js'

const ref = (contentId: string) => ({ kind: 'panel' as const, contentId, instanceId: contentId })

/** 两格布局：p1 里一个 tab，p2 空。 */
function seed(): { layout: WorkbenchLayout; p1: PaneId; p2: PaneId; split: SplitId; tab: TabId } {
  const mint = createMint('t')
  const p1 = mint.pane()
  const p2 = mint.pane()
  const split = mint.split()
  const initial = emptyLayout(p1)
  const { next } = applyOp(initial, {
    kind: 'split',
    pane: p1,
    axis: 'row',
    at: 'after',
    newPane: p2,
    newSplit: split,
  })
  const tab = mint.tab()
  const withTab = applyOp(next, {
    kind: 'insertTab',
    pane: p1,
    tab: makeTab(tab, ref('terminal')),
  }).next
  return { layout: withTab, p1, p2, split, tab }
}

/** 两格都有内容，便于测合并。 */
function seedBoth(): { layout: WorkbenchLayout; p1: PaneId; p2: PaneId; split: SplitId; t1: TabId; t2: TabId } {
  const base = seed()
  const mint = createMint('u')
  const t2 = mint.tab()
  const layout = applyOp(base.layout, {
    kind: 'insertTab',
    pane: base.p2,
    tab: makeTab(t2, ref('files')),
  }).next
  return { layout, p1: base.p1, p2: base.p2, split: base.split, t1: base.tab, t2 }
}

describe('applyOp 逆操作', () => {
  it('insertTab / removeTab 互为逆操作', () => {
    const { layout, p2 } = seed()
    const mint = createMint('x')
    const tab = makeTab(mint.tab(), ref('files'))

    const added = applyOp(layout, { kind: 'insertTab', pane: p2, tab })
    expect(panes(added.next.root)[1]?.tabs).toHaveLength(1)

    const removed = applyInverse(added.next, added.inverse)
    expect(sameLayout(removed, layout)).toBe(true)
  })

  it('removeTab 的逆操作能恢复到原位置', () => {
    const { layout, p1, tab } = seed()
    const removed = applyOp(layout, { kind: 'removeTab', pane: p1, tabId: tab })
    expect(panes(removed.next.root)[0]?.tabs).toHaveLength(0)

    const restored = applyInverse(removed.next, removed.inverse)
    expect(panes(restored.root)[0]?.tabs[0]?.id).toBe(tab)
  })

  it('同格内重排后撤销回到原顺序', () => {
    const { layout, p1, tab } = seed()
    const mint = createMint('y')
    const extra = makeTab(mint.tab(), ref('git'))
    const two = applyOp(layout, { kind: 'insertTab', pane: p1, tab: extra }).next

    const moved = applyOp(two, { kind: 'moveTab', from: p1, to: p1, tabId: extra.id, index: 0 })
    expect(panes(moved.next.root)[0]?.tabs[0]?.id).toBe(extra.id)

    const back = applyInverse(moved.next, moved.inverse)
    expect(panes(back.root)[0]?.tabs.map((t) => t.id)).toEqual([tab, extra.id])
  })

  it('跨格移动后撤销回到原格末位', () => {
    const { layout, p1, p2, tab } = seed()
    const moved = applyOp(layout, { kind: 'moveTab', from: p1, to: p2, tabId: tab })
    expect(panes(moved.next.root)[0]?.tabs).toHaveLength(0)
    expect(panes(moved.next.root)[1]?.tabs[0]?.id).toBe(tab)

    const back = applyInverse(moved.next, moved.inverse)
    expect(panes(back.root)[0]?.tabs[0]?.id).toBe(tab)
  })

  it('空 pane 可以移除，撤销后回到原索引', () => {
    const { layout, p2 } = seed()
    const removed = applyOp(layout, { kind: 'removePane', pane: p2 })
    expect(view(removed.next, p2).root.kind).toBe('pane')

    const back = applyInverse(removed.next, removed.inverse)
    expect(sameLayout(back, layout)).toBe(true)
  })

  it('非空 pane 不允许移除', () => {
    const { layout, p1 } = seed()
    expect(() => applyOp(layout, { kind: 'removePane', pane: p1 })).toThrow(/not empty/)
  })

  it('resize 撤销回到旧比例', () => {
    const { layout, split } = seed()
    const resized = applyOp(layout, { kind: 'resize', split, sizes: [0.8, 0.2] })
    expect((resized.next.root as unknown as { sizes: number[] }).sizes[0]).toBeCloseTo(0.8, 5)

    const back = applyInverse(resized.next, resized.inverse)
    expect((back.root as unknown as { sizes: number[] }).sizes[0]).toBeCloseTo(0.5, 5)
  })
})

describe('mergePanes（取舍 1：一次手势一条 op）', () => {
  it('把 from 的标签并入 into 并移除 from', () => {
    const { layout, p1, p2, t1, t2 } = seedBoth()
    const merged = applyOp(layout, { kind: 'mergePanes', from: p1, into: p2 })

    expect(merged.next.root.kind).toBe('pane')
    const tabs = panes(merged.next.root).flatMap((p) => p.tabs).map((t) => t.id)
    expect(tabs).toEqual([t2, t1])
    expect(merged.next.focused).toBe(p2)
  })

  it('合并可以指定插入位置', () => {
    const { layout, p1, p2, t1, t2 } = seedBoth()
    const merged = applyOp(layout, { kind: 'mergePanes', from: p1, into: p2, index: 0 })
    const tabs = panes(merged.next.root).flatMap((p) => p.tabs).map((t) => t.id)
    expect(tabs).toEqual([t1, t2])
  })

  it('逆操作恢复到合并前，标签不重复不丢失', () => {
    const { layout, p1, p2 } = seedBoth()
    const merged = applyOp(layout, { kind: 'mergePanes', from: p1, into: p2 })
    const back = applyInverse(merged.next, merged.inverse)

    expect(sameLayout(back, layout)).toBe(true)
    const ids = panes(back.root).flatMap((p) => p.tabs).map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('不允许把格合并到自己', () => {
    const { layout, p1 } = seedBoth()
    expect(() => applyOp(layout, { kind: 'mergePanes', from: p1, into: p1 })).toThrow(/itself/)
  })

  it('不允许合并掉根格', () => {
    const { layout, p1, p2 } = seedBoth()
    const merged = applyOp(layout, { kind: 'mergePanes', from: p1, into: p2 })
    expect(() => applyOp(merged.next, { kind: 'mergePanes', from: p2, into: merged.next.root.id as PaneId })).toThrow()
  })
})

describe('浮窗（取舍 3：多标签）', () => {
  function seedThree(): { layout: WorkbenchLayout; p1: PaneId; ids: TabId[] } {
    const base = seed()
    const mint = createMint('v')
    let layout = base.layout
    const ids: TabId[] = [base.tab]
    for (const name of ['files', 'git']) {
      const id = mint.tab()
      ids.push(id)
      layout = applyOp(layout, { kind: 'insertTab', pane: base.p1, tab: makeTab(id, ref(name)) }).next
    }
    return { layout, p1: base.p1, ids }
  }

  it('一次浮出多个标签', () => {
    const { layout, p1, ids } = seedThree()
    const floated = applyOp(layout, {
      kind: 'floatTabs',
      pane: p1,
      tabIds: [ids[1] as TabId, ids[2] as TabId],
      floatId: 'f1',
      rect: { x: 10, y: 10, w: 400, h: 300 },
    })
    expect(floated.next.floats[0]?.tabs).toHaveLength(2)
    expect(panes(floated.next.root)[0]?.tabs.map((t) => t.id)).toEqual([ids[0]])
  })

  it('多标签浮窗可以逐个收回', () => {
    const { layout, p1, ids } = seedThree()
    const floated = applyOp(layout, {
      kind: 'floatTabs',
      pane: p1,
      tabIds: [ids[0] as TabId, ids[1] as TabId],
      floatId: 'f1',
      rect: { x: 10, y: 10, w: 400, h: 300 },
    }).next

    const back1 = applyOp(floated, { kind: 'redock', floatId: 'f1', pane: p1, tabId: ids[1] })
    expect(back1.next.floats[0]?.tabs).toHaveLength(1)

    const back2 = applyOp(back1.next, { kind: 'redock', floatId: 'f1', pane: p1, tabId: ids[0] })
    expect(back2.next.floats).toHaveLength(0)
    expect(panes(back2.next.root)[0]?.tabs).toHaveLength(3)
  })

  it('收回最后一个标签时浮窗自动消失', () => {
    const { layout, p1, ids } = seedThree()
    const floated = applyOp(layout, {
      kind: 'floatTabs',
      pane: p1,
      tabIds: [ids[0] as TabId],
      floatId: 'f1',
      rect: { x: 10, y: 10, w: 400, h: 300 },
    }).next
    expect(floated.floats).toHaveLength(1)

    const docked = applyOp(floated, { kind: 'redock', floatId: 'f1', pane: p1 })
    expect(docked.next.floats).toHaveLength(0)

    const undone = applyInverse(docked.next, docked.inverse)
    expect(undone.floats).toHaveLength(1)
    expect(undone.floats[0]?.tabs[0]?.id).toBe(ids[0])
  })

  it('浮窗内关闭标签；关到空时浮窗移除', () => {
    const { layout, p1, ids } = seedThree()
    const floated = applyOp(layout, {
      kind: 'floatTabs',
      pane: p1,
      tabIds: [ids[0] as TabId, ids[1] as TabId],
      floatId: 'f1',
      rect: { x: 10, y: 10, w: 400, h: 300 },
    }).next

    const one = applyOp(floated, { kind: 'closeFloatTab', floatId: 'f1', tabId: ids[0] })
    expect(one.next.floats[0]?.tabs).toHaveLength(1)

    const none = applyOp(one.next, { kind: 'closeFloatTab', floatId: 'f1', tabId: ids[1] })
    expect(none.next.floats).toHaveLength(0)

    const restored = applyInverse(none.next, none.inverse)
    expect(restored.floats[0]?.tabs[0]?.id).toBe(ids[1])

    const backToTwo = applyInverse(restored, one.inverse)
    expect(backToTwo.floats[0]?.tabs).toHaveLength(2)
  })

  it('激活浮窗内的另一个标签，撤销回到原激活项', () => {
    const { layout, p1, ids } = seedThree()
    const floated = applyOp(layout, {
      kind: 'floatTabs',
      pane: p1,
      tabIds: [ids[0] as TabId, ids[1] as TabId],
      floatId: 'f1',
      rect: { x: 10, y: 10, w: 400, h: 300 },
    }).next
    const before = floated.floats[0]?.activeTab

    const activated = applyOp(floated, { kind: 'activateFloatTab', floatId: 'f1', tabId: ids[0] as TabId })
    expect(activated.next.floats[0]?.activeTab).toBe(ids[0])

    const back = applyInverse(activated.next, activated.inverse)
    expect(back.floats[0]?.activeTab).toBe(before)
  })

  it('移动 / Pin / 最小化都可逆', () => {
    const { layout, p1, ids } = seedThree()
    const floated = applyOp(layout, {
      kind: 'floatTabs',
      pane: p1,
      tabIds: [ids[0] as TabId],
      floatId: 'f1',
      rect: { x: 10, y: 10, w: 400, h: 300 },
    }).next

    const moved = applyOp(floated, { kind: 'moveFloat', floatId: 'f1', rect: { x: 50, y: 60, w: 500, h: 320 } })
    const pinned = applyOp(moved.next, { kind: 'setPin', floatId: 'f1', pin: 'window' })
    const minimized = applyOp(pinned.next, { kind: 'minimize', floatId: 'f1', x: 900, y: 600 })

    expect(minimized.next.minimized[0]?.x).toBe(900)
    const un = applyInverse(minimized.next, minimized.inverse)
    const unpinned = applyInverse(un, pinned.inverse)
    const unmoved = applyInverse(unpinned, moved.inverse)
    expect(unmoved.floats[0]?.rect.x).toBe(10)
    expect(unmoved.floats[0]?.pin).toBe('none')
  })
})

describe('结构收缩（取舍 2：显式 compact）', () => {
  it('移除标签后存储树保留空格，compact 才收缩', () => {
    const { layout, p1, tab } = seed()
    const removed = applyOp(layout, { kind: 'removeTab', pane: p1, tabId: tab })
    // 存储层仍是两格（忠实），只有渲染视图折叠成一格。
    expect(removed.next.root.kind).toBe('split')
    expect(view(removed.next, p1).root.kind).toBe('pane')

    const shrunk = compact(removed.next, p1)
    expect(shrunk.root.kind).toBe('pane')
  })

  it('compact 幂等', () => {
    const { layout, p1 } = seed()
    const once = compact(layout, p1)
    const twice = compact(once, p1)
    expect(JSON.stringify(once)).toBe(JSON.stringify(twice))
  })

  it('view 与 compact 结果一致', () => {
    const { layout, p1, tab } = seed()
    const removed = applyOp(layout, { kind: 'removeTab', pane: p1, tabId: tab }).next
    expect(JSON.stringify(view(removed, p1))).toBe(JSON.stringify(compact(removed, p1)))
  })

  it('全空时保留一个种子 pane 作为主区空态', () => {
    const { layout, p1, tab } = seed()
    const removed = applyOp(layout, { kind: 'removeTab', pane: p1, tabId: tab }).next
    const shrunk = compact(removed, p1)
    expect(shrunk.root.kind).toBe('pane')
    expect(panes(shrunk.root)[0]?.tabs).toHaveLength(0)
  })
})

describe('applyOps 与历史', () => {
  it('一次手势多步落定后可整体撤销', () => {
    const { layout, p2 } = seed()
    const mint = createMint('z')
    const tab = makeTab(mint.tab(), ref('changes'))
    const ops: LayoutOp[] = [
      { kind: 'insertTab', pane: p2, tab },
      { kind: 'focus', id: p2 },
    ]
    const done = applyOps(layout, ops)
    const undone = applyInverse(done.next, done.inverse)
    expect(sameLayout(undone, layout)).toBe(true)
  })

  it('复合逆操作（合并）在 applyOps 里正确展开', () => {
    const { layout, p1, p2 } = seedBoth()
    const merged = applyOp(layout, { kind: 'mergePanes', from: p1, into: p2 })
    const back = applyInverse(merged.next, merged.inverse)
    expect(sameLayout(back, layout)).toBe(true)
  })

  it('历史超过上限时丢弃最早的记录', () => {
    const { layout } = seed()
    const history = new WorkbenchHistory(3)
    let cur = layout
    for (let i = 0; i < 5; i += 1) {
      const next = applyOp(cur, { kind: 'focus', id: `f${i}` }).next
      history.push({ label: `focus ${i}`, before: cur, after: next })
      cur = next
    }
    expect(history.size).toBe(3)
    expect(history.undo(cur)?.focused).toBe('f3')
  })

  it('撤销后新的改动清空重做栈', () => {
    const { layout } = seed()
    const history = new WorkbenchHistory()
    const a = applyOp(layout, { kind: 'focus', id: 'a' }).next
    history.push({ label: 'a', before: layout, after: a })
    const undone = history.undo(a)
    expect(undone).toBeDefined()
    expect(history.canRedo).toBe(true)

    if (undone) {
      const b = applyOp(undone, { kind: 'focus', id: 'b' }).next
      history.push({ label: 'b', before: undone, after: b })
      expect(history.canRedo).toBe(false)
    }
  })
})
