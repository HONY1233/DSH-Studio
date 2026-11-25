/**
 * 布局操作 —— 每个 op 都是纯函数式变换，并返回**恰好能撤销它**的逆操作。
 *
 * 三条原则：
 * - op 是数据，不是函数。id 由意图层预先 mint 好塞进 payload，因此
 *   `applyOps(layout, ops)` 可以在 Node 里无依赖回放。
 * - 逆操作在 op **执行前**捕获——执行后旧值已经不存在了。
 * - 一次手势 = 一次 intent = 一条历史记录。拖动过程中只预览，松手才落 op。
 *
 * 逆操作可以是**数组**（复合撤销）。数组内部顺序即执行顺序；每一步之间
 * 不允许出现「同一个 TabId 同时在两处」的**可见**状态（纯函数，中间态不对外）。
 */

import {
  type FloatNode,
  type LayoutNode,
  type PaneId,
  type PaneNode,
  type PinLevel,
  type Rect,
  type SplitId,
  type SplitNode,
  type Tab,
  type TabId,
  type WorkbenchLayout,
  findParentSplit,
  findPane,
  isPane,
  mapPanes,
  normalizeSizes,
  replaceNode,
} from './layout.js'

/** 单个逆操作，或一段按执行顺序排列的复合逆操作。 */
export type Inverse = LayoutOp | readonly LayoutOp[]

export type LayoutOp =
  // ---- 格内标签
  | { readonly kind: 'insertTab'; readonly pane: PaneId; readonly tab: Tab; readonly index?: number }
  | { readonly kind: 'removeTab'; readonly pane: PaneId; readonly tabId: TabId }
  | { readonly kind: 'moveTab'
      readonly from: PaneId
      readonly to: PaneId
      readonly tabId: TabId
      readonly index?: number }
  /** 切换格内活动标签（不动顺序、不跨格）。 */
  | { readonly kind: 'activateTab'; readonly pane: PaneId; readonly tabId: TabId }
  // ---- 结构
  | {
      readonly kind: 'split'
      readonly pane: PaneId
      readonly axis: 'row' | 'column'
      readonly at: 'before' | 'after'
      readonly newPane: PaneId
      readonly newSplit: SplitId
      readonly seed?: Tab
      readonly ratio?: number
    }
  | { readonly kind: 'insertPaneAt'; readonly parent: SplitId; readonly index: number; readonly pane: PaneNode }
  | { readonly kind: 'removePane'; readonly pane: PaneId }
  | { readonly kind: 'resize'; readonly split: SplitId; readonly sizes: readonly number[] }
  /** 合并：把 from 的全部标签按序并入 into，然后移除 from 的格。 */
  | { readonly kind: 'mergePanes'; readonly from: PaneId; readonly into: PaneId; readonly index?: number }
  // ---- 浮窗
  | {
      readonly kind: 'float'
      readonly pane: PaneId
      readonly tabId: TabId
      readonly floatId: string
      readonly rect: Rect
      readonly pin?: PinLevel
    }
  | {
      readonly kind: 'floatTabs'
      readonly pane: PaneId
      readonly tabIds: readonly TabId[]
      readonly floatId: string
      readonly rect: Rect
      readonly pin?: PinLevel
    }
  | {
      readonly kind: 'redock'
      readonly floatId: string
      readonly pane: PaneId
      readonly tabId?: TabId
      readonly index?: number
    }
  | { readonly kind: 'moveFloat'; readonly floatId: string; readonly rect: Rect }
  | { readonly kind: 'setPin'; readonly floatId: string; readonly pin: PinLevel }
  | { readonly kind: 'closeFloatTab'; readonly floatId: string; readonly tabId: TabId }
  | { readonly kind: 'activateFloatTab'; readonly floatId: string; readonly tabId: TabId }
  | { readonly kind: 'minimize'; readonly floatId: string; readonly x: number; readonly y: number }
  | { readonly kind: 'unminimize'; readonly floatId: string }
  // ---- 恢复原语（复合逆操作使用，也可被"整理布局"直接调用）
  | { readonly kind: 'setPaneTabs'; readonly pane: PaneId; readonly tabs: readonly Tab[]; readonly activeTab?: TabId }
  | { readonly kind: 'setFloatTabs'; readonly floatId: string; readonly tabs: readonly Tab[]; readonly activeTab?: TabId }
  | { readonly kind: 'addFloat'; readonly float: FloatNode; readonly index?: number }
  | { readonly kind: 'removeFloat'; readonly floatId: string }
  /** 把树中某个节点（pane 或 split）整体替换成给定节点；合并/收缩的精准撤销靠它。 */
  | { readonly kind: 'replaceNodeAt'; readonly target: string; readonly node: LayoutNode }
  // ---- 全局
  | { readonly kind: 'focus'; readonly id?: string }
  | { readonly kind: 'replaceRoot'; readonly root: LayoutNode; readonly floats?: readonly FloatNode[] }

export interface OpResult {
  readonly next: WorkbenchLayout
  readonly inverse: Inverse
}

export class OpError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OpError'
  }
}

const asList = (inverse: Inverse): readonly LayoutOp[] =>
  Array.isArray(inverse) ? (inverse as readonly LayoutOp[]) : [inverse as LayoutOp]

function assertPane(layout: WorkbenchLayout, id: PaneId): PaneNode {
  const pane = findPane(layout.root, id)
  if (!pane) throw new OpError(`pane not found: ${id}`)
  return pane
}

function assertFloat(layout: WorkbenchLayout, id: string): FloatNode {
  const node = layout.floats.find((f) => f.id === id)
  if (!node) throw new OpError(`float not found: ${id}`)
  return node
}

function activeAfterRemoval(tabs: readonly Tab[], removed: TabId, fallback?: TabId): TabId | undefined {
  const idx = tabs.findIndex((t) => t.id === removed)
  const rest = tabs.filter((t) => t.id !== removed)
  if (rest.length === 0) return undefined
  const next = rest[Math.min(idx, rest.length - 1)]
  return next?.id ?? fallback
}

function withTabs(pane: PaneNode, tabs: Tab[], activeTab?: TabId): PaneNode {
  const active = activeTab ?? tabs[tabs.length - 1]?.id
  return active === undefined ? { kind: 'pane', id: pane.id, tabs } : { ...pane, tabs, activeTab: active }
}

function withFloatTabs(float: FloatNode, tabs: Tab[], activeTab?: TabId): FloatNode {
  const active = activeTab ?? tabs[tabs.length - 1]?.id
  return active === undefined
    ? { kind: 'float', id: float.id, rect: float.rect, pin: float.pin, tabs }
    : { ...float, tabs, activeTab: active }
}

function findSplit(root: LayoutNode, id: SplitId): SplitNode {
  const walk = (node: LayoutNode): SplitNode | undefined => {
    if (isPane(node)) return undefined
    if (node.id === id) return node
    for (const child of node.children) {
      const hit = walk(child)
      if (hit) return hit
    }
    return undefined
  }
  const hit = walk(root)
  if (!hit) throw new OpError(`split not found: ${id}`)
  return hit
}

function findNode(root: LayoutNode, id: string): LayoutNode | undefined {
  if (root.id === id) return root
  if (isPane(root)) return undefined
  for (const child of root.children) {
    const hit = findNode(child, id)
    if (hit) return hit
  }
  return undefined
}

// ---------------------------------------------------------------- 主入口

export function applyOp(layout: WorkbenchLayout, op: LayoutOp): OpResult {
  switch (op.kind) {
    case 'insertTab': {
      const pane = assertPane(layout, op.pane)
      const index = Math.max(0, Math.min(op.index ?? pane.tabs.length, pane.tabs.length))
      const tabs = [...pane.tabs]
      tabs.splice(index, 0, op.tab)
      const root = mapPanes(layout.root, (p) => (p.id === op.pane ? withTabs(p, tabs, op.tab.id) : p))
      return {
        next: { ...layout, root, focused: op.pane },
        inverse: { kind: 'removeTab', pane: op.pane, tabId: op.tab.id },
      }
    }

    case 'removeTab': {
      const pane = assertPane(layout, op.pane)
      const before = pane.tabs
      if (!before.some((t) => t.id === op.tabId)) throw new OpError(`tab not in pane: ${op.tabId}`)
      const index = before.findIndex((t) => t.id === op.tabId)
      const tab = before[index] as Tab
      const active = pane.activeTab === op.tabId ? activeAfterRemoval(before, op.tabId) : pane.activeTab
      const tabs = before.filter((t) => t.id !== op.tabId)
      const root = mapPanes(layout.root, (p) => (p.id === op.pane ? withTabs(p, tabs, active) : p))
      return {
        next: { ...layout, root },
        inverse: { kind: 'insertTab', pane: op.pane, tab, index },
      }
    }

    case 'moveTab': {
      const from = assertPane(layout, op.from)
      const to = assertPane(layout, op.to)
      const srcIndex = from.tabs.findIndex((t) => t.id === op.tabId)
      if (srcIndex < 0) throw new OpError(`tab not in source pane: ${op.tabId}`)
      const tab = from.tabs[srcIndex] as Tab
      const wasActive = from.activeTab === op.tabId

      if (op.from === op.to) {
        const rest = from.tabs.filter((t) => t.id !== op.tabId)
        const target = Math.max(0, Math.min(op.index ?? rest.length, rest.length))
        const tabs = [...rest]
        tabs.splice(target, 0, tab)
        const root = mapPanes(layout.root, (p) => (p.id === op.from ? withTabs(p, tabs, op.tabId) : p))
        return {
          next: { ...layout, root, focused: op.to },
          inverse: { kind: 'moveTab', from: op.from, to: op.to, tabId: op.tabId, index: srcIndex },
        }
      }

      const fromTabs = from.tabs.filter((t) => t.id !== op.tabId)
      const fromActive = wasActive ? activeAfterRemoval(from.tabs, op.tabId) : from.activeTab
      const toIndex = Math.max(0, Math.min(op.index ?? to.tabs.length, to.tabs.length))
      const toTabs = [...to.tabs]
      toTabs.splice(toIndex, 0, tab)

      const root = mapPanes(layout.root, (p) => {
        if (p.id === op.from) return withTabs(p, fromTabs, fromActive)
        if (p.id === op.to) return withTabs(p, toTabs, op.tabId)
        return p
      })
      return {
        next: { ...layout, root, focused: op.to },
        inverse: { kind: 'moveTab', from: op.to, to: op.from, tabId: op.tabId, index: srcIndex },
      }
    }

    case 'activateTab': {
      const pane = assertPane(layout, op.pane)
      if (!pane.tabs.some((t) => t.id === op.tabId)) throw new OpError(`tab not in pane: ${op.tabId}`)
      const root = mapPanes(layout.root, (p) => (p.id === op.pane ? { ...p, activeTab: op.tabId } : p))
      return {
        next: { ...layout, root, focused: op.pane },
        inverse: {
          kind: 'setPaneTabs',
          pane: pane.id,
          tabs: pane.tabs,
          ...(pane.activeTab ? { activeTab: pane.activeTab } : {}),
        },
      }
    }

    case 'split': {
      const pane = assertPane(layout, op.pane)
      const ratio = typeof op.ratio === 'number' ? Math.min(0.88, Math.max(0.12, op.ratio)) : 0.5
      const seedTabs: Tab[] = op.seed ? [op.seed] : []
      const fresh: PaneNode = {
        kind: 'pane',
        id: op.newPane,
        tabs: seedTabs,
        ...(op.seed ? { activeTab: op.seed.id } : {}),
      }
      const children: LayoutNode[] = op.at === 'before' ? [fresh, pane] : [pane, fresh]
      const sizes = op.at === 'before' ? [ratio, 1 - ratio] : [1 - ratio, ratio]
      const split: SplitNode = { kind: 'split', id: op.newSplit, axis: op.axis, children, sizes }
      const root = replaceNode(layout.root, op.pane, split)
      return {
        next: { ...layout, root, focused: op.newPane },
        // 撤销分裂 = 把原 pane 放回去；新格若已有内容，调用方需先搬走。
        inverse: { kind: 'removePane', pane: op.newPane },
      }
    }

    case 'insertPaneAt': {
      const parent = findSplit(layout.root, op.parent)
      const index = Math.max(0, Math.min(op.index, parent.children.length))
      const children = [...parent.children]
      children.splice(index, 0, op.pane)
      const sizes = [...parent.sizes]
      sizes.splice(index, 0, 1 / Math.max(1, children.length))
      const nextSplit: SplitNode = { ...parent, children, sizes: normalizeSizes(sizes) }
      const root = replaceNode(layout.root, op.parent, nextSplit)
      return {
        next: { ...layout, root },
        inverse: { kind: 'removePane', pane: op.pane.id },
      }
    }

    case 'removePane': {
      const pane = assertPane(layout, op.pane)
      if (pane.tabs.length > 0) throw new OpError(`pane is not empty: ${op.pane}`)
      const parent = findParentSplit(layout.root, op.pane)
      if (!parent) throw new OpError('cannot remove the root pane')
      const index = parent.children.findIndex((c) => c.id === op.pane)
      const children = parent.children.filter((c) => c.id !== op.pane)
      const sizes = parent.sizes.filter((_, i) => i !== index)
      const nextSplit: SplitNode = { ...parent, children, sizes: normalizeSizes(sizes) }
      const root = replaceNode(layout.root, parent.id, nextSplit)
      const inverse: LayoutOp = { kind: 'insertPaneAt', parent: parent.id, index, pane }
      return { next: { ...layout, root }, inverse }
    }

    case 'resize': {
      const split = findSplit(layout.root, op.split)
      if (op.sizes.length !== split.children.length) throw new OpError('sizes length mismatch')
      const root = replaceNode(layout.root, op.split, { ...split, sizes: normalizeSizes(op.sizes) })
      return {
        next: { ...layout, root },
        inverse: { kind: 'resize', split: op.split, sizes: split.sizes },
      }
    }

    // 合并两个格：一次手势一条 op，不再要求 UI 先搬空再删格。
    case 'mergePanes': {
      if (op.from === op.into) throw new OpError('cannot merge a pane into itself')
      const from = assertPane(layout, op.from)
      const into = assertPane(layout, op.into)
      const parent = findParentSplit(layout.root, op.from)
      if (!parent) throw new OpError('cannot merge away the root pane')

      const index = Math.max(0, Math.min(op.index ?? into.tabs.length, into.tabs.length))
      const merged = [...into.tabs.slice(0, index), ...from.tabs, ...into.tabs.slice(index)]
      const mergedActive = from.tabs[0]?.id ?? into.activeTab
      const createdIndex = parent.children.findIndex((c) => c.id === op.from)

      // 先清空 from、再写入 into、最后摘掉 from —— 任一步之后都不会出现重复 TabId。
      const emptied = applyOp(layout, { kind: 'setPaneTabs', pane: op.from, tabs: [] }).next
      const filled = applyOp(emptied, {
        kind: 'setPaneTabs',
        pane: op.into,
        tabs: merged,
        ...(mergedActive === undefined ? {} : { activeTab: mergedActive }),
      }).next

      const parentAfter = findSplit(filled.root, parent.id)
      const remaining = parentAfter.children.filter((c) => c.id !== op.from)
      if (remaining.length === 0) throw new OpError('merge would leave the split empty')
      const remainingSizes = parentAfter.sizes.filter((_, i) => i !== createdIndex)
      // 只剩一格时直接抬升，避免留下单子节点 split（这正是"合并两格"该有的样子）。
      const collapsed = remaining.length === 1
      const finalNode: LayoutNode = collapsed
        ? (remaining[0] as LayoutNode)
        : { ...parentAfter, children: remaining, sizes: normalizeSizes(remainingSizes) }
      const next: WorkbenchLayout = {
        ...filled,
        root: replaceNode(filled.root, parent.id, finalNode),
        focused: op.into,
      }

      // 撤销：把"原父 split"整体放回去即可 —— 它同时包含 from（含原标签）与 into（含原标签）。
      // 收缩掉父节点时，落点是被抬升的那个子节点；未收缩时落点就是父节点本身。
      const target = collapsed ? (remaining[0]?.id as string) : parent.id
      return {
        next,
        inverse: { kind: 'replaceNodeAt', target, node: parent },
      }
    }

    case 'float': {
      return applyOp(layout, {
        kind: 'floatTabs',
        pane: op.pane,
        tabIds: [op.tabId],
        floatId: op.floatId,
        rect: op.rect,
        ...(op.pin === undefined ? {} : { pin: op.pin }),
      })
    }

    case 'floatTabs': {
      const pane = assertPane(layout, op.pane)
      if (op.tabIds.length === 0) throw new OpError('floatTabs needs at least one tab')
      const picked: Tab[] = []
      for (const id of op.tabIds) {
        const hit = pane.tabs.find((t) => t.id === id)
        if (!hit) throw new OpError(`tab not in pane: ${id}`)
        picked.push(hit)
      }
      const moving = new Set<string>(op.tabIds)
      const rest = pane.tabs.filter((t) => !moving.has(t.id))
      const active = pane.activeTab && moving.has(pane.activeTab) ? rest[rest.length - 1]?.id : pane.activeTab
      const root = mapPanes(layout.root, (p) => (p.id === op.pane ? withTabs(p, rest, active) : p))
      const float: FloatNode = {
        kind: 'float',
        id: op.floatId,
        rect: op.rect,
        pin: op.pin ?? 'none',
        tabs: picked,
        activeTab: picked[picked.length - 1]?.id,
      }
      return {
        next: { ...layout, root, floats: [...layout.floats, float], focused: op.floatId },
        inverse: [
          { kind: 'removeFloat', floatId: op.floatId },
          {
            kind: 'setPaneTabs',
            pane: op.pane,
            tabs: pane.tabs,
            ...(pane.activeTab ? { activeTab: pane.activeTab } : {}),
          },
        ],
      }
    }

    case 'redock': {
      const float = assertFloat(layout, op.floatId)
      const pane = assertPane(layout, op.pane)
      const tabId = op.tabId ?? float.activeTab ?? float.tabs[0]?.id
      if (!tabId) throw new OpError('float has no tab to redock')
      const tab = float.tabs.find((t) => t.id === tabId)
      if (!tab) throw new OpError(`tab not in float: ${tabId}`)

      const rest = float.tabs.filter((t) => t.id !== tabId)
      const floatIndex = layout.floats.findIndex((f) => f.id === float.id)
      const index = Math.max(0, Math.min(op.index ?? pane.tabs.length, pane.tabs.length))
      const paneTabs = [...pane.tabs]
      paneTabs.splice(index, 0, tab)
      const root = mapPanes(layout.root, (p) => (p.id === op.pane ? withTabs(p, paneTabs, tab.id) : p))
      const floats =
        rest.length === 0
          ? layout.floats.filter((f) => f.id !== float.id)
          : layout.floats.map((f) =>
              f.id === float.id
                ? withFloatTabs(f, [...rest], f.activeTab === tabId ? rest[rest.length - 1]?.id : f.activeTab)
                : f,
            )

      const restoreFloat: LayoutOp =
        rest.length === 0
          ? { kind: 'addFloat', float, index: floatIndex }
          : {
              kind: 'setFloatTabs',
              floatId: float.id,
              tabs: float.tabs,
              ...(float.activeTab ? { activeTab: float.activeTab } : {}),
            }

      return {
        next: { ...layout, root, floats, focused: op.pane },
        inverse: [
          {
            kind: 'setPaneTabs',
            pane: op.pane,
            tabs: pane.tabs,
            ...(pane.activeTab ? { activeTab: pane.activeTab } : {}),
          },
          restoreFloat,
        ],
      }
    }

    case 'closeFloatTab': {
      const float = assertFloat(layout, op.floatId)
      const index = float.tabs.findIndex((t) => t.id === op.tabId)
      if (index < 0) throw new OpError(`tab not in float: ${op.tabId}`)
      const rest = float.tabs.filter((t) => t.id !== op.tabId)
      const floatIndex = layout.floats.findIndex((f) => f.id === float.id)

      if (rest.length === 0) {
        return {
          next: { ...layout, floats: layout.floats.filter((f) => f.id !== float.id) },
          inverse: { kind: 'addFloat', float, index: floatIndex },
        }
      }
      const active = float.activeTab === op.tabId ? activeAfterRemoval(float.tabs, op.tabId) : float.activeTab
      return {
        next: {
          ...layout,
          floats: layout.floats.map((f) => (f.id === float.id ? withFloatTabs(f, [...rest], active) : f)),
        },
        inverse: {
          kind: 'setFloatTabs',
          floatId: float.id,
          tabs: float.tabs,
          ...(float.activeTab ? { activeTab: float.activeTab } : {}),
        },
      }
    }

    case 'activateFloatTab': {
      const float = assertFloat(layout, op.floatId)
      if (!float.tabs.some((t) => t.id === op.tabId)) throw new OpError(`tab not in float: ${op.tabId}`)
      const inverse: LayoutOp = {
        kind: 'setFloatTabs',
        floatId: float.id,
        tabs: float.tabs,
        ...(float.activeTab ? { activeTab: float.activeTab } : {}),
      }
      return {
        next: { ...layout, floats: layout.floats.map((f) => (f.id === float.id ? { ...f, activeTab: op.tabId } : f)) },
        inverse,
      }
    }

    case 'moveFloat': {
      const float = assertFloat(layout, op.floatId)
      return {
        next: {
          ...layout,
          floats: layout.floats.map((f) => (f.id === op.floatId ? { ...f, rect: op.rect } : f)),
        },
        inverse: { kind: 'moveFloat', floatId: op.floatId, rect: float.rect },
      }
    }

    case 'setPin': {
      const float = assertFloat(layout, op.floatId)
      return {
        next: {
          ...layout,
          floats: layout.floats.map((f) => (f.id === op.floatId ? { ...f, pin: op.pin } : f)),
        },
        inverse: { kind: 'setPin', floatId: op.floatId, pin: float.pin },
      }
    }

    case 'minimize': {
      const float = assertFloat(layout, op.floatId)
      const prev = layout.minimized.find((m) => m.floatId === op.floatId)
      const inverse: LayoutOp = prev
        ? { kind: 'minimize', floatId: op.floatId, x: prev.x, y: prev.y }
        : { kind: 'unminimize', floatId: op.floatId }
      return {
        next: {
          ...layout,
          minimized: [
            ...layout.minimized.filter((m) => m.floatId !== op.floatId),
            { floatId: float.id, x: op.x, y: op.y },
          ],
        },
        inverse,
      }
    }

    case 'unminimize': {
      const prev = layout.minimized.find((m) => m.floatId === op.floatId)
      if (!prev) throw new OpError(`not minimized: ${op.floatId}`)
      return {
        next: { ...layout, minimized: layout.minimized.filter((m) => m.floatId !== op.floatId) },
        inverse: { kind: 'minimize', floatId: op.floatId, x: prev.x, y: prev.y },
      }
    }

    case 'setPaneTabs': {
      const pane = assertPane(layout, op.pane)
      const root = mapPanes(layout.root, (p) => (p.id === op.pane ? withTabs(p, [...op.tabs], op.activeTab) : p))
      const inverse: LayoutOp = {
        kind: 'setPaneTabs',
        pane: pane.id,
        tabs: pane.tabs,
        ...(pane.activeTab ? { activeTab: pane.activeTab } : {}),
      }
      return { next: { ...layout, root }, inverse }
    }

    case 'setFloatTabs': {
      const float = assertFloat(layout, op.floatId)
      const inverse: LayoutOp = {
        kind: 'setFloatTabs',
        floatId: float.id,
        tabs: float.tabs,
        ...(float.activeTab ? { activeTab: float.activeTab } : {}),
      }
      return {
        next: {
          ...layout,
          floats: layout.floats.map((f) => (f.id === op.floatId ? withFloatTabs(f, [...op.tabs], op.activeTab) : f)),
        },
        inverse,
      }
    }

    case 'addFloat': {
      const index = Math.max(0, Math.min(op.index ?? layout.floats.length, layout.floats.length))
      const floats = [...layout.floats]
      floats.splice(index, 0, op.float)
      return {
        next: { ...layout, floats },
        inverse: { kind: 'removeFloat', floatId: op.float.id },
      }
    }

    case 'removeFloat': {
      const float = assertFloat(layout, op.floatId)
      const index = layout.floats.findIndex((f) => f.id === op.floatId)
      return {
        next: {
          ...layout,
          floats: layout.floats.filter((f) => f.id !== op.floatId),
          minimized: layout.minimized.filter((m) => m.floatId !== op.floatId),
        },
        inverse: { kind: 'addFloat', float, index },
      }
    }

    case 'replaceNodeAt': {
      const current = findNode(layout.root, op.target)
      if (!current) throw new OpError(`node not found: ${op.target}`)
      return {
        next: { ...layout, root: replaceNode(layout.root, op.target, op.node) },
        inverse: { kind: 'replaceNodeAt', target: op.target, node: current },
      }
    }

    case 'focus': {
      return {
        next: { ...layout, focused: op.id },
        inverse: { kind: 'focus', id: layout.focused },
      }
    }

    case 'replaceRoot': {
      return {
        next: { ...layout, root: op.root, floats: op.floats ?? layout.floats },
        inverse: { kind: 'replaceRoot', root: layout.root, floats: layout.floats },
      }
    }

    default: {
      const never: never = op
      throw new OpError(`unknown op: ${JSON.stringify(never)}`)
    }
  }
}

/** 顺序应用一组 op（一次手势的多步落定），返回合并后的逆操作（按撤销顺序展开）。 */
export function applyOps(
  layout: WorkbenchLayout,
  ops: readonly LayoutOp[],
): { next: WorkbenchLayout; inverse: readonly LayoutOp[] } {
  let cur = layout
  const inverses: LayoutOp[] = []
  for (const op of ops) {
    const { next, inverse } = applyOp(cur, op)
    cur = next
    inverses.unshift(...asList(inverse))
  }
  return { next: cur, inverse: inverses }
}

/** 直接执行一段逆操作，回到 op 之前的状态。 */
export function applyInverse(layout: WorkbenchLayout, inverse: Inverse): WorkbenchLayout {
  return applyOps(layout, asList(inverse)).next
}

// ---------------------------------------------------------------- 历史

export interface Intent {
  readonly label: string
  readonly before: WorkbenchLayout
  readonly after: WorkbenchLayout
}

/** 20 步撤销栈；与编辑器/终端的 Ctrl+Z 隔离（只服务布局）。 */
export class WorkbenchHistory {
  private readonly done: Intent[] = []
  private readonly undone: Intent[] = []

  constructor(private readonly limit = 20) {}

  push(intent: Intent): void {
    this.done.push(intent)
    if (this.done.length > this.limit) this.done.shift()
    this.undone.length = 0
  }

  undo(current: WorkbenchLayout): WorkbenchLayout | undefined {
    const last = this.done.pop()
    if (!last) return undefined
    this.undone.push({ ...last, after: current })
    return last.before
  }

  redo(current: WorkbenchLayout): WorkbenchLayout | undefined {
    const last = this.undone.pop()
    if (!last) return undefined
    this.done.push({ ...last, before: current })
    return last.after
  }

  get canUndo(): boolean {
    return this.done.length > 0
  }

  get canRedo(): boolean {
    return this.undone.length > 0
  }

  get size(): number {
    return this.done.length
  }
}
