import { describe, expect, it } from 'vitest'

import {
  type PaneId,
  type PaneNode,
  type SplitId,
  type TabHostRef,
  type TabId,
  type WorkbenchLayout,
  allTabs,
  compact,
  createMint,
  emptyLayout,
  ensureWorkbenchRegions,
  findTabHost,
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

  it('raiseFloat 把浮窗移到顶层且撤销恢复原顺序', () => {
    const { layout, p1, ids } = seedThree()
    let floated = layout
    for (let index = 0; index < ids.length; index += 1) {
      floated = applyOp(floated, {
        kind: 'floatTabs',
        pane: p1,
        tabIds: [ids[index] as TabId],
        floatId: `f${index + 1}`,
        rect: { x: 10 + index * 20, y: 10 + index * 20, w: 400, h: 300 },
      }).next
    }
    expect(floated.floats.map((float) => float.id)).toEqual(['f1', 'f2', 'f3'])

    const raised = applyOp(floated, { kind: 'raiseFloat', floatId: 'f1' })
    expect(raised.next.floats.map((float) => float.id)).toEqual(['f2', 'f3', 'f1'])
    expect(raised.next.focused).toBe('f1')
    expect(applyInverse(raised.next, raised.inverse).floats.map((float) => float.id)).toEqual(['f1', 'f2', 'f3'])
  })

  it('reorderFloats 拒绝缺失、重复或未知浮窗', () => {
    const { layout, p1, ids } = seedThree()
    let floated = layout
    for (let index = 0; index < 2; index += 1) {
      floated = applyOp(floated, {
        kind: 'floatTabs',
        pane: p1,
        tabIds: [ids[index] as TabId],
        floatId: `f${index + 1}`,
        rect: { x: 10 + index * 20, y: 10 + index * 20, w: 400, h: 300 },
      }).next
    }
    expect(() => applyOp(floated, { kind: 'reorderFloats', order: [] })).toThrow(/length mismatch/)
    expect(() => applyOp(floated, { kind: 'reorderFloats', order: ['f1', 'f1'] })).toThrow(/duplicates/)
    expect(() => applyOp(floated, { kind: 'reorderFloats', order: ['f1', 'missing'] })).toThrow(/not found/)
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

describe('分组、锁定与 Pin', () => {
  function seedFloats() {
    const base = seed()
    const mint = createMint('group')
    let layout = base.layout
    const ids: TabId[] = [base.tab]
    for (const [index, name] of ['files', 'git'].entries()) {
      const id = mint.tab()
      ids.push(id)
      layout = applyOp(layout, { kind: 'insertTab', pane: base.p1, tab: makeTab(id, ref(name)) }).next
      layout = applyOp(layout, {
        kind: 'floatTabs',
        pane: base.p1,
        tabIds: [id],
        floatId: `g${index + 1}`,
        rect: { x: 10 + index * 30, y: 20 + index * 40, w: 300, h: 200 },
      }).next
    }
    return { layout, p1: base.p1, ids }
  }

  it('分组与取消分组都可逆', () => {
    const { layout } = seedFloats()
    const grouped = applyOp(layout, { kind: 'groupFloats', groupId: 'group-1', floatIds: ['g1', 'g2'] })
    expect(grouped.next.floats.map((float) => float.groupId)).toEqual(['group-1', 'group-1'])
    const undone = applyInverse(grouped.next, grouped.inverse)
    expect(sameLayout(undone, layout)).toBe(true)

    const ungrouped = applyOp(grouped.next, { kind: 'ungroupFloat', floatId: 'g1' })
    expect(ungrouped.next.floats[0]?.groupId).toBeUndefined()
    expect(ungrouped.next.floats[1]?.groupId).toBe('group-1')
    expect(sameLayout(applyInverse(ungrouped.next, ungrouped.inverse), grouped.next)).toBe(true)
  })

  it('整组移动保持相对位置并作为一条历史撤销', () => {
    const { layout } = seedFloats()
    const grouped = applyOp(layout, { kind: 'groupFloats', groupId: 'group-1', floatIds: ['g1', 'g2'] }).next
    const moved = applyOp(grouped, {
      kind: 'moveFloatGroup',
      groupId: 'group-1',
      moves: [
        { floatId: 'g1', rect: { x: 110, y: 120, w: 300, h: 200 } },
        { floatId: 'g2', rect: { x: 140, y: 160, w: 300, h: 200 } },
      ],
    })
    expect(moved.next.floats.map((float) => float.rect.x)).toEqual([110, 140])
    expect(moved.next.floats[1]!.rect.x - moved.next.floats[0]!.rect.x).toBe(30)
    expect(sameLayout(applyInverse(moved.next, moved.inverse), grouped)).toBe(true)
  })

  it('locked 禁止单窗和整组移动，解锁后可移动', () => {
    const { layout } = seedFloats()
    const grouped = applyOp(layout, { kind: 'groupFloats', groupId: 'group-1', floatIds: ['g1', 'g2'] }).next
    const locked = applyOp(grouped, { kind: 'setLocked', floatId: 'g2', locked: true })
    expect(sameLayout(applyInverse(locked.next, locked.inverse), grouped)).toBe(true)
    expect(() => applyOp(locked.next, {
      kind: 'moveFloat',
      floatId: 'g2',
      rect: { x: 0, y: 0, w: 300, h: 200 },
    })).toThrow(/locked/)
    expect(() => applyOp(locked.next, {
      kind: 'moveFloatGroup',
      groupId: 'group-1',
      moves: [
        { floatId: 'g1', rect: { x: 100, y: 100, w: 300, h: 200 } },
        { floatId: 'g2', rect: { x: 130, y: 140, w: 300, h: 200 } },
      ],
    })).toThrow(/locked/)
  })

  it('五档 Pin 切换可逆', () => {
    const { layout } = seedFloats()
    for (const pin of ['workspace', 'app', 'window', 'windowTop', 'none'] as const) {
      const changed = applyOp(layout, { kind: 'setPin', floatId: 'g1', pin })
      expect(changed.next.floats[0]?.pin).toBe(pin)
      expect(sameLayout(applyInverse(changed.next, changed.inverse), layout)).toBe(true)
    }
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

describe('X4.2 fixed regions and generic hosts', () => {
  function hostSeed() {
    const pane = (name: string): PaneNode => ({
      kind: 'pane',
      id: `${name}-pane` as PaneId,
      tabs: [
        makeTab(`${name}-a` as TabId, ref(`${name}-a`)),
        makeTab(`${name}-b` as TabId, ref(`${name}-b`)),
      ],
      activeTab: `${name}-b` as TabId,
    })
    const root = pane('main')
    const regions = { sidebar: pane('sidebar'), right: pane('right'), bottom: pane('bottom') }
    const float = {
      kind: 'float' as const,
      id: 'float-host',
      rect: { x: 10, y: 20, w: 400, h: 300 },
      pin: 'none' as const,
      tabs: [
        makeTab('float-a' as TabId, ref('float-a')),
        makeTab('float-b' as TabId, ref('float-b')),
      ],
      activeTab: 'float-b' as TabId,
    }
    const layout: WorkbenchLayout = {
      version: 2,
      root,
      regions,
      floats: [float],
      minimized: [{ floatId: float.id, x: 700, y: 500 }],
      focused: root.id,
      regionSizes: { sidebar: 220 },
    }
    const hosts: TabHostRef[] = [
      { kind: 'pane', id: root.id },
      { kind: 'region', id: regions.sidebar.id },
      { kind: 'region', id: regions.right.id },
      { kind: 'region', id: regions.bottom.id },
      { kind: 'float', id: float.id },
    ]
    return { layout, hosts }
  }

  it('ensureWorkbenchRegions keeps legacy layouts optional and avoids default-id collisions', () => {
    const rootId = 'region-sidebar' as PaneId
    const legacy: WorkbenchLayout = {
      ...emptyLayout(rootId),
      root: {
        kind: 'pane',
        id: rootId,
        tabs: [makeTab('region-right' as TabId, ref('legacy'))],
        activeTab: 'region-right' as TabId,
      },
    }
    expect(legacy.regions).toBeUndefined()
    const ensured = ensureWorkbenchRegions(legacy)
    expect(ensured.regions?.sidebar.id).toBe('region-sidebar-2')
    expect(ensured.regions?.right.id).toBe('region-right-2')
    expect(ensured.regions?.bottom.id).toBe('region-bottom')
    expect(legacy.regions).toBeUndefined()
    expect(ensureWorkbenchRegions(ensured)).toBe(ensured)
  })

  it('allTabs/sameLayout include regions, while compact never removes or compacts them', () => {
    const { layout } = hostSeed()
    const withRegionTab = applyOp(layout, {
      kind: 'insertRegionTab',
      region: 'sidebar',
      pane: layout.regions!.sidebar.id,
      tab: makeTab('extra' as TabId, ref('extra')),
    }).next
    expect(allTabs(withRegionTab).map((tab) => tab.id)).toEqual([
      'main-a', 'main-b', 'sidebar-a', 'sidebar-b', 'extra', 'right-a', 'right-b',
      'bottom-a', 'bottom-b', 'float-a', 'float-b',
    ])
    const compacted = compact(withRegionTab, layout.root.id as PaneId)
    expect(compacted.regions).toBe(withRegionTab.regions)
    expect(sameLayout(withRegionTab, { ...withRegionTab, focused: 'elsewhere' })).toBe(true)
    expect(sameLayout(withRegionTab, layout)).toBe(false)
  })

  it('covers all 25 directed transfers across pane/sidebar/right/bottom/float, including self', () => {
    const { layout, hosts } = hostSeed()
    for (const from of hosts) {
      for (const to of hosts) {
        const source = findTabHost(layout, from)!
        const target = findTabHost(layout, to)!
        const moving = source.tabs[1]!
        const result = applyOp(layout, { kind: 'transferTab', from, to, tabId: moving.id, index: 0 })
        const same = from.kind === to.kind && from.id === to.id
        const nextSource = findTabHost(result.next, from)!
        const nextTarget = findTabHost(result.next, to)!
        expect(nextSource.tabs.map((tab) => tab.id), `${from.kind}:${from.id} -> ${to.kind}:${to.id}`)
          .toEqual(same ? [moving.id, source.tabs[0]!.id] : [source.tabs[0]!.id])
        expect(nextTarget.tabs.map((tab) => tab.id)).toEqual(
          same ? [moving.id, source.tabs[0]!.id] : [moving.id, ...target.tabs.map((tab) => tab.id)],
        )
        expect(nextTarget.activeTab).toBe(moving.id)
        expect(nextSource.activeTab).toBe(same ? moving.id : source.tabs[0]!.id)
        expect(result.next.focused).toBe(to.id)
        const ids = allTabs(result.next).map((tab) => tab.id)
        expect(ids).toHaveLength(10)
        expect(new Set(ids).size).toBe(10)
        expect(applyInverse(result.next, result.inverse)).toStrictEqual(layout)
      }
    }
  })

  it('transfer preserves a non-moving source active tab and focuses the destination', () => {
    const { layout, hosts } = hostSeed()
    const source = hosts[0]!
    const target = hosts[1]!
    const adjusted: WorkbenchLayout = {
      ...layout,
      root: {
        kind: 'pane',
        id: source.id as PaneId,
        tabs: findTabHost(layout, source)!.tabs,
        activeTab: 'main-a' as TabId,
      },
    }
    const moved = applyOp(adjusted, {
      kind: 'transferTab', from: source, to: target, tabId: 'main-b' as TabId, index: 1,
    })
    expect(findTabHost(moved.next, source)!.activeTab).toBe('main-a')
    expect(findTabHost(moved.next, target)!.activeTab).toBe('main-b')
    expect(findTabHost(moved.next, target)!.tabs.map((tab) => tab.id)).toEqual(['sidebar-a', 'main-b', 'sidebar-b'])
    expect(moved.next.focused).toBe(target.id)
    expect(applyInverse(moved.next, moved.inverse)).toStrictEqual(adjusted)
  })

  it('same-host transfer clamps the index and restores exact order/active/focus', () => {
    const { layout, hosts } = hostSeed()
    const host = hosts[0]!
    const first = findTabHost(layout, host)!.tabs[0]!
    const moved = applyOp(layout, { kind: 'transferTab', from: host, to: host, tabId: first.id, index: 99 })
    expect(findTabHost(moved.next, host)!.tabs.map((tab) => tab.id)).toEqual(['main-b', 'main-a'])
    expect(moved.next.focused).toBe(host.id)
    expect(applyInverse(moved.next, moved.inverse)).toStrictEqual(layout)
  })

  it('same-host transfer treats the raw drop index as insertion before that tab', () => {
    const { layout, hosts } = hostSeed()
    const host = hosts[0]!
    const first = findTabHost(layout, host)!.tabs[0]!
    const withThird = applyOp(layout, {
      kind: 'insertTab',
      pane: host.id as PaneId,
      tab: makeTab('main-c' as TabId, ref('main-c')),
    }).next
    const moved = applyOp(withThird, {
      kind: 'transferTab', from: host, to: host, tabId: first.id, index: 2,
    })
    expect(findTabHost(moved.next, host)!.tabs.map((tab) => tab.id)).toEqual(['main-b', 'main-a', 'main-c'])
    expect(applyInverse(moved.next, moved.inverse)).toStrictEqual(withThird)
  })

  it('transfer closes a last-tab source float and restores its order and minimized record exactly', () => {
    const { layout } = hostSeed()
    const float = layout.floats[0]!
    const single: WorkbenchLayout = {
      ...layout,
      floats: [{ ...float, tabs: [float.tabs[0]!], activeTab: float.tabs[0]!.id }],
    }
    const moved = applyOp(single, {
      kind: 'transferTab',
      from: { kind: 'float', id: float.id },
      to: { kind: 'region', id: layout.regions!.right.id },
      tabId: float.tabs[0]!.id,
    })
    expect(moved.next.floats).toEqual([])
    expect(moved.next.minimized).toEqual([])
    expect(applyInverse(moved.next, moved.inverse)).toStrictEqual(single)
  })

  it('floatTab creates a pinned float from each of the five host kinds with exact inverse', () => {
    const { layout, hosts } = hostSeed()
    for (const [index, from] of hosts.entries()) {
      const source = findTabHost(layout, from)!
      const moving = source.tabs[1]!
      const result = applyOp(layout, {
        kind: 'floatTab',
        from,
        tabId: moving.id,
        floatId: `new-float-${index}`,
        rect: { x: 100 + index, y: 120 + index, w: 500, h: 360 },
        pin: 'window',
      })
      expect(findTabHost(result.next, from)!.tabs.map((tab) => tab.id)).toEqual([source.tabs[0]!.id])
      expect(result.next.floats.at(-1)).toMatchObject({
        id: `new-float-${index}`,
        pin: 'window',
        activeTab: moving.id,
        tabs: [{ id: moving.id }],
      })
      expect(result.next.focused).toBe(`new-float-${index}`)
      expect(applyInverse(result.next, result.inverse)).toStrictEqual(layout)
    }
  })

  it('floatTab from the last tab of a minimized float removes and precisely restores that float', () => {
    const { layout } = hostSeed()
    const float = layout.floats[0]!
    const single: WorkbenchLayout = {
      ...layout,
      floats: [{ ...float, tabs: [float.tabs[0]!], activeTab: float.tabs[0]!.id }],
    }
    const result = applyOp(single, {
      kind: 'floatTab',
      from: { kind: 'float', id: float.id },
      tabId: float.tabs[0]!.id,
      floatId: 'replacement-float',
      rect: { x: 1, y: 2, w: 300, h: 200 },
    })
    expect(result.next.floats.map((node) => node.id)).toEqual(['replacement-float'])
    expect(result.next.minimized).toEqual([])
    expect(applyInverse(result.next, result.inverse)).toStrictEqual(single)
    expect(() => applyOp(layout, {
      kind: 'floatTab',
      from: { kind: 'pane', id: layout.root.id },
      tabId: 'main-a' as TabId,
      floatId: float.id,
      rect: float.rect,
    })).toThrow(/already exists/)
  })

  it('resizeRegion updates/removes sizes and has an exact inverse', () => {
    const { layout } = hostSeed()
    const resized = applyOp(layout, { kind: 'resizeRegion', region: 'sidebar', sizes: 280 })
    expect(resized.next.regionSizes).toEqual({ sidebar: 280 })
    expect(applyInverse(resized.next, resized.inverse)).toStrictEqual(layout)
    const cleared = applyOp(resized.next, { kind: 'resizeRegion', region: 'sidebar' })
    expect(cleared.next.regionSizes).toBeUndefined()
    expect(applyInverse(cleared.next, cleared.inverse)).toStrictEqual(resized.next)
    expect(() => applyOp(layout, { kind: 'resizeRegion', region: 'right', sizes: -1 })).toThrow(/non-negative/)
  })
})
