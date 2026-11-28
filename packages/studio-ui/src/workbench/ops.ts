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

import { reduceWindowLifecycle, type WindowLifecycleOp } from '@dsh-studio/workbench-core/window-lifecycle'

import {
  type FloatNode,
  type LayoutNode,
  type MinimizedRecord,
  type PaneId,
  type PaneNode,
  type PinLevel,
  type Rect,
  type RegionId,
  type RegionSizes,
  type SplitId,
  type SplitNode,
  type Tab,
  type TabHost,
  type TabHostRef,
  type TabId,
  type WorkbenchLayout,
  ensureWorkbenchRegions,
  findParentSplit,
  findPane,
  findTabHost,
  isPane,
  mapPanes,
  normalizeSizes,
  regionEntries,
  replaceNode,
  workbenchIds,
} from './layout.js'

/** 单个逆操作，或一段按执行顺序排列的复合逆操作。 */
export type Inverse = LayoutOp | readonly LayoutOp[]

export type LayoutOp =
  // ---- 格内标签
  | { readonly kind: 'insertTab'; readonly pane: PaneId; readonly tab: Tab; readonly index?: number }
  | { readonly kind: 'insertRegionTab'; readonly region: RegionId; readonly pane?: PaneId; readonly tab: Tab; readonly index?: number }
  | { readonly kind: 'removeTab'; readonly pane: PaneId; readonly tabId: TabId }
  /** pane / region / float 之间原子移动；同宿主时只重排。 */
  | {
      readonly kind: 'transferTab'
      readonly from: TabHostRef
      readonly to: TabHostRef
      readonly tabId: TabId
      readonly index?: number
    }
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
  /** 从任意 tab 宿主原子创建浮窗。 */
  | {
      readonly kind: 'floatTab'
      readonly from: TabHostRef
      readonly tabId: TabId
      readonly floatId: string
      readonly rect: Rect
      readonly pin?: PinLevel
    }
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
  | {
      readonly kind: 'moveFloatGroup'
      readonly groupId: string
      readonly moves: readonly { readonly floatId: string; readonly rect: Rect }[]
    }
  | { readonly kind: 'raiseFloat'; readonly floatId: string }
  | { readonly kind: 'reorderFloats'; readonly order: readonly string[] }
  | { readonly kind: 'setPin'; readonly floatId: string; readonly pin: PinLevel }
  | { readonly kind: 'setLocked'; readonly floatId: string; readonly locked?: boolean }
  | { readonly kind: 'setFloatGroup'; readonly floatId: string; readonly groupId?: string }
  | { readonly kind: 'groupFloats'; readonly groupId: string; readonly floatIds: readonly string[] }
  | { readonly kind: 'ungroupFloat'; readonly floatId: string }
  | { readonly kind: 'closeFloatTab'; readonly floatId: string; readonly tabId: TabId }
  | { readonly kind: 'activateFloatTab'; readonly floatId: string; readonly tabId: TabId }
  | { readonly kind: 'minimize'; readonly floatId: string; readonly x: number; readonly y: number }
  | { readonly kind: 'unminimize'; readonly floatId: string }
  // ---- 恢复原语（复合逆操作使用，也可被"整理布局"直接调用）
  | { readonly kind: 'setPaneTabs'; readonly pane: PaneId; readonly tabs: readonly Tab[]; readonly activeTab?: TabId }
  | { readonly kind: 'setHostTabs'; readonly host: TabHostRef; readonly tabs: readonly Tab[]; readonly activeTab?: TabId }
  | { readonly kind: 'replaceRegions'; readonly regions?: WorkbenchLayout['regions'] }
  | { readonly kind: 'replaceRegionSizes'; readonly regionSizes?: RegionSizes }
  | { readonly kind: 'restoreMinimized'; readonly minimized: readonly MinimizedRecord[] }
  | { readonly kind: 'resizeRegion'; readonly region: RegionId; readonly sizes?: number }
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

function assertHost(layout: WorkbenchLayout, ref: TabHostRef): TabHost {
  const host = findTabHost(layout, ref)
  if (!host) throw new OpError(`${ref.kind} host not found: ${ref.id}`)
  return host
}

function assertRegion(layout: WorkbenchLayout, region: RegionId): PaneNode {
  const pane = layout.regions?.[region]
  if (!pane) throw new OpError(`region not found: ${region}`)
  return pane
}

function sameHost(a: TabHostRef, b: TabHostRef): boolean {
  return a.kind === b.kind && a.id === b.id
}

/** 与 withTabs 不同：activeTab 缺省时真正删除该字段，保证快照级精确撤销。 */
function replaceHostTabs(host: TabHost, tabs: readonly Tab[], activeTab?: TabId): TabHost {
  const { activeTab: _activeTab, ...rest } = host
  return activeTab === undefined ? { ...rest, tabs } : { ...rest, tabs, activeTab }
}

function mapHost(layout: WorkbenchLayout, ref: TabHostRef, next: TabHost): WorkbenchLayout {
  if (ref.kind === 'pane') {
    return { ...layout, root: mapPanes(layout.root, (pane) => pane.id === ref.id ? next as PaneNode : pane) }
  }
  if (ref.kind === 'float') {
    return { ...layout, floats: layout.floats.map((float) => float.id === ref.id ? next as FloatNode : float) }
  }
  const entry = regionEntries(layout).find(([, pane]) => pane.id === ref.id)
  if (!entry || !layout.regions) throw new OpError(`region host not found: ${ref.id}`)
  const [region] = entry
  return { ...layout, regions: { ...layout.regions, [region]: next as PaneNode } }
}

function withRegionsFor(layout: WorkbenchLayout, refs: readonly TabHostRef[]): {
  readonly layout: WorkbenchLayout
  readonly added: boolean
} {
  const added = !layout.regions && refs.some((ref) => ref.kind === 'region')
  return { layout: added ? ensureWorkbenchRegions(layout) : layout, added }
}

function snapshotHost(layout: WorkbenchLayout, ref: TabHostRef): LayoutOp {
  const host = assertHost(layout, ref)
  return { kind: 'setHostTabs', host: ref, tabs: host.tabs, ...(host.activeTab === undefined ? {} : { activeTab: host.activeTab }) }
}

/** Internal floats adapt their side-car minimization records to XC-01. */
function reduceFloatLifecycle(layout: WorkbenchLayout, op: WindowLifecycleOp): WorkbenchLayout {
  const projected = layout.floats.map((float) => ({
    id: float.id,
    minimized: layout.minimized.some((item) => item.floatId === float.id),
  }))
  const reduced = reduceWindowLifecycle(projected, op)
  const byId = new Map(reduced.map((state) => [state.id, state]))
  const floats = layout.floats.filter((float) => byId.has(float.id))
  let minimized = layout.minimized.filter((item) => byId.get(item.floatId)?.minimized === true)
  if (op.kind === 'minimize') {
    if (typeof op.x !== 'number' || typeof op.y !== 'number' || !Number.isFinite(op.x) || !Number.isFinite(op.y)) {
      throw new OpError('minimize requires finite capsule coordinates')
    }
    const state = byId.get(op.id)
    if (state?.minimized && !minimized.some((item) => item.floatId === op.id)) {
      minimized = [...minimized, { floatId: op.id, x: op.x, y: op.y }]
    }
  }
  return { ...layout, floats, minimized }
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
  return active === undefined ? { ...float, tabs, activeTab: undefined } : { ...float, tabs, activeTab: active }
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

    case 'insertRegionTab': {
      const prepared = withRegionsFor(layout, [{ kind: 'region', id: op.pane ?? op.region }])
      const region = assertRegion(prepared.layout, op.region)
      if (op.pane !== undefined && op.pane !== region.id) throw new OpError(`region pane mismatch: ${op.region}`)
      const index = Math.max(0, Math.min(op.index ?? region.tabs.length, region.tabs.length))
      const tabs = [...region.tabs]
      tabs.splice(index, 0, op.tab)
      const host: TabHostRef = { kind: 'region', id: region.id }
      const next = mapHost(prepared.layout, host, replaceHostTabs(region, tabs, op.tab.id))
      const inverse: LayoutOp[] = [
        snapshotHost(prepared.layout, host),
        ...(prepared.added ? [{ kind: 'replaceRegions' } as LayoutOp] : []),
        { kind: 'focus', id: prepared.layout.focused },
      ]
      return { next: { ...next, focused: region.id }, inverse }
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

    case 'transferTab': {
      const prepared = withRegionsFor(layout, [op.from, op.to])
      const from = assertHost(prepared.layout, op.from)
      const to = assertHost(prepared.layout, op.to)
      const srcIndex = from.tabs.findIndex((tab) => tab.id === op.tabId)
      if (srcIndex < 0) throw new OpError(`tab not in source host: ${op.tabId}`)
      const tab = from.tabs[srcIndex] as Tab
      const fromSnapshot = snapshotHost(prepared.layout, op.from)
      const toSnapshot = snapshotHost(prepared.layout, op.to)
      const rest = from.tabs.filter((item) => item.id !== op.tabId)
      const sourceActive = from.activeTab === op.tabId ? activeAfterRemoval(from.tabs, op.tabId) : from.activeTab
      const targetLength = sameHost(op.from, op.to) ? rest.length : to.tabs.length
      const requested = op.index ?? targetLength
      // targetIndex 指向移除源标签前的列表；同宿主移除后要左移一位，
      // 才能与跨宿主的“插到该标签之前”语义保持一致。
      const adjusted = sameHost(op.from, op.to) && srcIndex < requested ? requested - 1 : requested
      const target = Math.max(0, Math.min(adjusted, targetLength))
      const targetTabs = [...rest]
      targetTabs.splice(target, 0, tab)

      let next = sameHost(op.from, op.to)
        ? mapHost(prepared.layout, op.from, replaceHostTabs(from, targetTabs, op.tabId))
        : mapHost(mapHost(prepared.layout, op.from, replaceHostTabs(from, rest, sourceActive)), op.to,
            replaceHostTabs(to, [...to.tabs.slice(0, target), tab, ...to.tabs.slice(target)], op.tabId))
      // 与 redock 一致：浮窗最后一个 tab 离开时关闭浮窗，并记住精确恢复位置/胶囊状态。
      const closeSourceFloat = !sameHost(op.from, op.to) && op.from.kind === 'float' && rest.length === 0
      const sourceFloatIndex = op.from.kind === 'float'
        ? prepared.layout.floats.findIndex((float) => float.id === op.from.id)
        : -1
      if (closeSourceFloat) {
        next = {
          ...next,
          floats: next.floats.filter((float) => float.id !== op.from.id),
          minimized: next.minimized.filter((item) => item.floatId !== op.from.id),
        }
      }
      next = { ...next, focused: op.to.id }

      const inverse: LayoutOp[] = sameHost(op.from, op.to)
        ? [fromSnapshot]
        : [
            toSnapshot,
            ...(closeSourceFloat ? [{ kind: 'addFloat', float: from as FloatNode, index: sourceFloatIndex } as LayoutOp] : []),
            fromSnapshot,
          ]
      if (closeSourceFloat) inverse.push({ kind: 'restoreMinimized', minimized: prepared.layout.minimized })
      if (prepared.added) inverse.push({ kind: 'replaceRegions' })
      inverse.push({ kind: 'focus', id: prepared.layout.focused })
      return { next, inverse }
    }

    case 'floatTab': {
      const prepared = withRegionsFor(layout, [op.from])
      const from = assertHost(prepared.layout, op.from)
      const srcIndex = from.tabs.findIndex((tab) => tab.id === op.tabId)
      if (srcIndex < 0) throw new OpError(`tab not in source host: ${op.tabId}`)
      if (workbenchIds(prepared.layout).has(op.floatId)) throw new OpError(`float id already exists: ${op.floatId}`)
      const tab = from.tabs[srcIndex] as Tab
      const rest = from.tabs.filter((item) => item.id !== op.tabId)
      const sourceActive = from.activeTab === op.tabId ? activeAfterRemoval(from.tabs, op.tabId) : from.activeTab
      const closeSourceFloat = op.from.kind === 'float' && rest.length === 0
      const sourceFloatIndex = op.from.kind === 'float'
        ? prepared.layout.floats.findIndex((float) => float.id === op.from.id)
        : -1
      let next = mapHost(prepared.layout, op.from, replaceHostTabs(from, rest, sourceActive))
      if (closeSourceFloat) {
        next = {
          ...next,
          floats: next.floats.filter((float) => float.id !== op.from.id),
          minimized: next.minimized.filter((item) => item.floatId !== op.from.id),
        }
      }
      const float: FloatNode = {
        kind: 'float',
        id: op.floatId,
        rect: op.rect,
        pin: op.pin ?? 'none',
        tabs: [tab],
        activeTab: tab.id,
      }
      next = { ...next, floats: [...next.floats, float], focused: op.floatId }
      const inverse: LayoutOp[] = [
        { kind: 'removeFloat', floatId: op.floatId },
        ...(closeSourceFloat ? [{ kind: 'addFloat', float: from as FloatNode, index: sourceFloatIndex } as LayoutOp] : []),
        snapshotHost(prepared.layout, op.from),
      ]
      if (closeSourceFloat) inverse.push({ kind: 'restoreMinimized', minimized: prepared.layout.minimized })
      if (prepared.added) inverse.push({ kind: 'replaceRegions' })
      inverse.push({ kind: 'focus', id: prepared.layout.focused })
      return { next, inverse }
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
      const floats = rest.length === 0
        ? layout.floats
        : layout.floats.map((f) =>
            f.id === float.id
              ? withFloatTabs(f, [...rest], f.activeTab === tabId ? rest[rest.length - 1]?.id : f.activeTab)
              : f,
          )
      let next: WorkbenchLayout = {
        ...layout,
        root,
        floats: rest.length === 0
          ? reduceFloatLifecycle(layout, { kind: 'close', id: float.id }).floats
          : floats,
        focused: op.pane,
      }
      if (rest.length === 0) next = { ...next, minimized: next.minimized.filter((item) => item.floatId !== float.id) }

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
        next,
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
          next: reduceFloatLifecycle(layout, { kind: 'close', id: float.id }),
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
      if (float.locked) throw new OpError(`locked float cannot move: ${op.floatId}`)
      return {
        next: {
          ...layout,
          floats: layout.floats.map((f) => (f.id === op.floatId ? { ...f, rect: op.rect } : f)),
        },
        inverse: { kind: 'moveFloat', floatId: op.floatId, rect: float.rect },
      }
    }

    case 'moveFloatGroup': {
      const members = layout.floats.filter((float) => float.groupId === op.groupId)
      if (members.length < 2) throw new OpError(`float group not found: ${op.groupId}`)
      if (op.moves.length !== members.length) throw new OpError('float group move length mismatch')
      if (new Set(op.moves.map((move) => move.floatId)).size !== op.moves.length) {
        throw new OpError('float group move contains duplicates')
      }
      const byId = new Map(members.map((float) => [float.id, float]))
      for (const move of op.moves) {
        const member = byId.get(move.floatId)
        if (!member) throw new OpError(`float not in group: ${move.floatId}`)
        if (member.locked) throw new OpError(`locked float cannot move: ${move.floatId}`)
      }
      const rects = new Map(op.moves.map((move) => [move.floatId, move.rect]))
      return {
        next: {
          ...layout,
          floats: layout.floats.map((float) =>
            float.groupId === op.groupId ? { ...float, rect: rects.get(float.id) ?? float.rect } : float,
          ),
        },
        inverse: {
          kind: 'moveFloatGroup',
          groupId: op.groupId,
          moves: members.map((float) => ({ floatId: float.id, rect: float.rect })),
        },
      }
    }

    case 'raiseFloat': {
      const float = assertFloat(layout, op.floatId)
      const order = layout.floats.map((f) => f.id)
      const index = order.indexOf(op.floatId)
      if (index === order.length - 1) {
        return {
          next: layout.focused === op.floatId ? layout : { ...layout, focused: op.floatId },
          inverse: { kind: 'reorderFloats', order },
        }
      }
      const floats = [...layout.floats]
      floats.splice(index, 1)
      floats.push(float)
      return {
        next: { ...layout, floats, focused: op.floatId },
        inverse: { kind: 'reorderFloats', order },
      }
    }

    case 'reorderFloats': {
      if (op.order.length !== layout.floats.length) throw new OpError('float order length mismatch')
      const byId = new Map(layout.floats.map((float) => [float.id, float]))
      if (new Set(op.order).size !== op.order.length) throw new OpError('float order contains duplicates')
      const floats = op.order.map((id) => {
        const float = byId.get(id)
        if (!float) throw new OpError(`float not found: ${id}`)
        return float
      })
      return {
        next: { ...layout, floats },
        inverse: { kind: 'reorderFloats', order: layout.floats.map((float) => float.id) },
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

    case 'setLocked': {
      const float = assertFloat(layout, op.floatId)
      const { locked: _locked, ...rest } = float
      const nextFloat = op.locked === undefined ? rest : { ...rest, locked: op.locked }
      return {
        next: {
          ...layout,
          floats: layout.floats.map((f) => (f.id === op.floatId ? nextFloat : f)),
        },
        inverse: {
          kind: 'setLocked',
          floatId: op.floatId,
          ...(float.locked === undefined ? {} : { locked: float.locked }),
        },
      }
    }

    case 'setFloatGroup': {
      const float = assertFloat(layout, op.floatId)
      const { groupId: _previousGroup, ...rest } = float
      const nextFloat = op.groupId === undefined ? rest : { ...rest, groupId: op.groupId }
      return {
        next: { ...layout, floats: layout.floats.map((f) => (f.id === op.floatId ? nextFloat : f)) },
        inverse: {
          kind: 'setFloatGroup',
          floatId: op.floatId,
          ...(float.groupId === undefined ? {} : { groupId: float.groupId }),
        },
      }
    }

    case 'groupFloats': {
      if (op.floatIds.length < 2) throw new OpError('groupFloats needs at least two floats')
      if (new Set(op.floatIds).size !== op.floatIds.length) throw new OpError('groupFloats contains duplicates')
      const members = op.floatIds.map((id) => assertFloat(layout, id))
      if (members.some((float) => float.groupId !== undefined)) throw new OpError('float is already grouped')
      const previous = members.map((float) => ({ kind: 'setFloatGroup' as const, floatId: float.id }))
      return {
        next: {
          ...layout,
          floats: layout.floats.map((float) =>
            op.floatIds.includes(float.id) ? { ...float, groupId: op.groupId } : float,
          ),
        },
        inverse: previous,
      }
    }

    case 'ungroupFloat': {
      const float = assertFloat(layout, op.floatId)
      return applyOp(layout, { kind: 'setFloatGroup', floatId: op.floatId })
    }

    case 'minimize': {
      const float = assertFloat(layout, op.floatId)
      const prev = layout.minimized.find((m) => m.floatId === op.floatId)
      const next = reduceFloatLifecycle(layout, { kind: 'minimize', id: float.id, x: op.x, y: op.y })
      const inverse: LayoutOp = prev
        ? { kind: 'minimize', floatId: op.floatId, x: prev.x, y: prev.y }
        : { kind: 'unminimize', floatId: op.floatId }
      return { next, inverse }
    }

    case 'unminimize': {
      const float = assertFloat(layout, op.floatId)
      const prev = layout.minimized.find((m) => m.floatId === op.floatId)
      if (!prev) throw new OpError(`not minimized: ${op.floatId}`)
      return {
        next: reduceFloatLifecycle(layout, { kind: 'restore', id: float.id }),
        inverse: { kind: 'minimize', floatId: op.floatId, x: prev.x, y: prev.y },
      }
    }

    case 'setHostTabs': {
      const host = assertHost(layout, op.host)
      const inverse = snapshotHost(layout, op.host)
      return {
        next: mapHost(layout, op.host, replaceHostTabs(host, [...op.tabs], op.activeTab)),
        inverse,
      }
    }

    case 'replaceRegions': {
      const { regions: _regions, ...rest } = layout
      return {
        next: op.regions === undefined ? rest : { ...rest, regions: op.regions },
        inverse: { kind: 'replaceRegions', ...(layout.regions === undefined ? {} : { regions: layout.regions }) },
      }
    }

    case 'replaceRegionSizes': {
      const { regionSizes: _sizes, ...rest } = layout
      return {
        next: op.regionSizes === undefined ? rest : { ...rest, regionSizes: op.regionSizes },
        inverse: {
          kind: 'replaceRegionSizes',
          ...(layout.regionSizes === undefined ? {} : { regionSizes: layout.regionSizes }),
        },
      }
    }

    case 'restoreMinimized': {
      return { next: { ...layout, minimized: op.minimized }, inverse: { kind: 'restoreMinimized', minimized: layout.minimized } }
    }

    case 'resizeRegion': {
      assertRegion(layout, op.region)
      if (op.sizes !== undefined && (!Number.isFinite(op.sizes) || op.sizes < 0)) {
        throw new OpError('region size must be a finite non-negative number')
      }
      const sizes = { ...layout.regionSizes }
      if (op.sizes === undefined) delete sizes[op.region]
      else sizes[op.region] = op.sizes
      const { regionSizes: _previousSizes, ...rest } = layout
      const next = Object.keys(sizes).length === 0 ? rest : { ...rest, regionSizes: sizes }
      return { next, inverse: { kind: 'replaceRegionSizes', ...(layout.regionSizes === undefined ? {} : { regionSizes: layout.regionSizes }) } }
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
        next: reduceFloatLifecycle(layout, { kind: 'close', id: float.id }),
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
      const { focused: _focused, ...rest } = layout
      return {
        next: op.id === undefined ? rest : { ...rest, focused: op.id },
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

  /** 预览栈顶但不改变历史；持久化失败时调用方仍可原样重试。 */
  peekUndo(): Intent | undefined {
    return this.done[this.done.length - 1]
  }

  peekRedo(): Intent | undefined {
    return this.undone[this.undone.length - 1]
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
