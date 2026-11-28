/**
 * Workbench 布局模型 —— 纯数据结构，零 React、零 DOM。
 *
 * 两条约定，后面所有文件都依赖它们：
 *
 * 1) **存储树忠实**：`WorkbenchLayout.root` 允许存在空 pane 与单子节点 split。
 *    结构不会被自动"收缩"，因为收缩会毁掉逆操作。
 * 2) **渲染树派生**：`view(layout)` 负责折叠空 pane、提升单子节点、修正比例。
 *    渲染层只看 `view()` 的结果，永远不直接读 `root`。
 */

export type PaneId = string & { readonly __pane: unique symbol }
export type SplitId = string & { readonly __split: unique symbol }
export type TabId = string & { readonly __tab: unique symbol }
export type RegionId = 'sidebar' | 'right' | 'bottom'

export interface Rect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export interface Size {
  readonly w: number
  readonly h: number
}

export interface Point {
  readonly x: number
  readonly y: number
}

export type ContentKind = 'conversation' | 'panel'

/** 内容身份：kind + contentId。同一个 contentId 允许多个 tab（多实例面板 / 同会话多窗口）。 */
export interface TabRef {
  readonly kind: ContentKind
  readonly contentId: string
  /** 面板实例 id，如 `files@2`；会话 tab 用 `session:<id>`。持久化与 key 都用它。 */
  readonly instanceId: string
}

export interface Tab {
  readonly id: TabId
  readonly ref: TabRef
  /** 缺省时由内容自己提供标题；这里只存用户改过的名字。 */
  readonly title?: string
}

export interface PaneNode {
  readonly kind: 'pane'
  readonly id: PaneId
  readonly tabs: readonly Tab[]
  readonly activeTab?: TabId
}

export interface WorkbenchRegions {
  readonly sidebar: PaneNode
  readonly right: PaneNode
  readonly bottom: PaneNode
}

/** sidebar/right 保存宽度，bottom 保存高度；缺省值由渲染层决定。 */
export type RegionSizes = Readonly<Partial<Record<RegionId, number>>>

/** 所有可放 tab 的宿主。region 的 id 是对应 PaneNode.id，不是 sidebar/right/bottom 键。 */
export interface TabHostRef {
  readonly kind: 'pane' | 'region' | 'float'
  readonly id: string
}

export type TabHost = PaneNode | FloatNode

export interface SplitNode {
  readonly kind: 'split'
  readonly id: SplitId
  readonly axis: 'row' | 'column'
  readonly children: readonly LayoutNode[]
  /** 与 children 等长，和为 1。 */
  readonly sizes: readonly number[]
}

export type LayoutNode = PaneNode | SplitNode

/** Pin 五档：none 随会话布局；workspace 换工作区隐藏；app 跨会话保留；window 独立窗口；windowTop 独立窗口置顶。 */
export type PinLevel = 'none' | 'workspace' | 'app' | 'window' | 'windowTop'

export interface FloatNode {
  readonly kind: 'float'
  readonly id: string
  readonly rect: Rect
  readonly pin: PinLevel
  /** 同组浮窗作为一个整体拖动；组 id 持久化在布局里。 */
  readonly groupId?: string
  /** 锁定只禁止移动/拖动，不妨碍关闭、最小化或改 Pin。 */
  readonly locked?: boolean
  readonly tabs: readonly Tab[]
  readonly activeTab?: TabId
}

export interface MinimizedRecord {
  /** 浮窗 id。胶囊位置按浮窗记录，而不是按 tab。 */
  readonly floatId: string
  readonly x: number
  readonly y: number
}

export interface WorkbenchLayout {
  readonly version: 2
  readonly root: LayoutNode
  /** X4.2 固定区域。旧 v2 可缺省；恢复/保存时由 ensureWorkbenchRegions 补齐。 */
  readonly regions?: WorkbenchRegions
  /** 固定区域的用户尺寸；不参与主区 split 的 compact。 */
  readonly regionSizes?: RegionSizes
  /** 自底向上。 */
  readonly floats: readonly FloatNode[]
  /** 焦点可以是 pane / region pane / split / float 的 id。 */
  readonly focused?: string
  readonly minimized: readonly MinimizedRecord[]
}

export const REGION_IDS = ['sidebar', 'right', 'bottom'] as const
export const DEFAULT_REGION_IDS: Readonly<Record<RegionId, PaneId>> = {
  sidebar: 'region-sidebar' as PaneId,
  right: 'region-right' as PaneId,
  bottom: 'region-bottom' as PaneId,
}

/** 最小分栏比例，防止某一格被拖成 0 像素。 */
export const MIN_RATIO = 0.12

// ---------------------------------------------------------------- 构造

let counter = 0

/** 确定性 id：同样顺序调用得到同样的 id，回放可复现。 */
export function createMint(prefix = 'wb'): {
  pane(): PaneId
  split(): SplitId
  tab(): TabId
  float(): string
} {
  const next = () => `${prefix}-${(counter += 1)}`
  return {
    pane: () => next() as PaneId,
    split: () => next() as SplitId,
    tab: () => next() as TabId,
    float: () => next(),
  }
}

export function emptyPane(id: PaneId): PaneNode {
  return { kind: 'pane', id, tabs: [] }
}

export function emptyLayout(paneId: PaneId): WorkbenchLayout {
  return { version: 2, root: emptyPane(paneId), floats: [], minimized: [] }
}

/**
 * 在内存中补上 X4.2 固定区域，不修改传入对象。默认 id 已被旧数据占用时顺延，
 * 避免迁移制造重复 node/tab id。已经有 regions 的布局原样返回。
 */
export function ensureWorkbenchRegions(layout: WorkbenchLayout): WorkbenchLayout {
  if (layout.regions) return layout
  const used = workbenchIds(layout)
  const paneFor = (region: RegionId): PaneNode => {
    const base = DEFAULT_REGION_IDS[region]
    let id = base
    let suffix = 2
    while (used.has(id)) id = `${base}-${suffix++}` as PaneId
    used.add(id)
    return emptyPane(id)
  }
  return {
    ...layout,
    regions: {
      sidebar: paneFor('sidebar' as RegionId),
      right: paneFor('right' as RegionId),
      bottom: paneFor('bottom' as RegionId),
    },
  }
}

export function makeTab(id: TabId, ref: TabRef, title?: string): Tab {
  return title === undefined ? { id, ref } : { id, ref, title }
}

// ---------------------------------------------------------------- 查询

export function isPane(node: LayoutNode): node is PaneNode {
  return node.kind === 'pane'
}

export function findPane(root: LayoutNode, id: PaneId): PaneNode | undefined {
  if (isPane(root)) return root.id === id ? root : undefined
  for (const child of root.children) {
    const hit = findPane(child, id)
    if (hit) return hit
  }
  return undefined
}

export function findParentSplit(root: LayoutNode, childId: string): SplitNode | undefined {
  if (isPane(root)) return undefined
  if (root.children.some((c) => c.id === childId)) return root
  for (const child of root.children) {
    const hit = findParentSplit(child, childId)
    if (hit) return hit
  }
  return undefined
}

/** 遍历所有 pane（含空 pane）。 */
export function panes(root: LayoutNode): PaneNode[] {
  if (isPane(root)) return [root]
  return root.children.flatMap(panes)
}

/** 固定区域条目；空区域也保留，且不经过 compact。 */
export function regionEntries(layout: WorkbenchLayout): readonly (readonly [RegionId, PaneNode])[] {
  if (!layout.regions) return []
  return REGION_IDS.map((id) => [id, layout.regions![id]] as const)
}

export function findTabHost(layout: WorkbenchLayout, ref: TabHostRef): TabHost | undefined {
  if (ref.kind === 'pane') return findPane(layout.root, ref.id as PaneId)
  if (ref.kind === 'float') return layout.floats.find((float) => float.id === ref.id)
  return regionEntries(layout).find(([, pane]) => pane.id === ref.id)?.[1]
}

/** 所有 id（node/region pane/float/tab）的集合，用于迁移与 mint 防冲突。 */
export function workbenchIds(layout: WorkbenchLayout): Set<string> {
  const ids = new Set<string>()
  const visit = (node: LayoutNode): void => {
    ids.add(node.id)
    if (isPane(node)) node.tabs.forEach((tab) => ids.add(tab.id))
    else node.children.forEach(visit)
  }
  visit(layout.root)
  regionEntries(layout).forEach(([, pane]) => {
    ids.add(pane.id)
    pane.tabs.forEach((tab) => ids.add(tab.id))
  })
  layout.floats.forEach((float) => {
    ids.add(float.id)
    float.tabs.forEach((tab) => ids.add(tab.id))
  })
  return ids
}

/** 遍历所有 tab，含固定区域和浮窗。 */
export function allTabs(layout: WorkbenchLayout): Tab[] {
  const inTree = panes(layout.root).flatMap((p) => p.tabs)
  const inRegions = regionEntries(layout).flatMap(([, pane]) => pane.tabs)
  return [...inTree, ...inRegions, ...layout.floats.flatMap((f) => f.tabs)]
}

// ---------------------------------------------------------------- 不可变改写

export function mapPanes(node: LayoutNode, fn: (pane: PaneNode) => PaneNode): LayoutNode {
  if (isPane(node)) return fn(node)
  const children = node.children.map((c) => mapPanes(c, fn))
  return children.every((c, i) => c === node.children[i]) ? node : { ...node, children }
}

export function replaceNode(root: LayoutNode, id: string, next: LayoutNode): LayoutNode {
  if (root.id === id) return next
  if (isPane(root)) return root
  const children = root.children.map((c) => replaceNode(c, id, next))
  return children.every((c, i) => c === root.children[i]) ? root : { ...root, children }
}

// ---------------------------------------------------------------- 派生视图

/**
 * 结构收缩：折叠空 pane、提升单子节点、清理 0 子节点 split、比例归一。
 *
 * 这是**显式**动作，不是每步 op 的副作用——存储树保持忠实，撤销才精确。
 * 调用时机只有三个：保存前、切换会话/工作区前、用户点"整理布局"。
 * 不变量：`compact` 幂等，且 `view(x) === compact(x)`。
 */
export function compactNode(node: LayoutNode, seed: PaneId): LayoutNode {
  if (isPane(node)) return node

  const indexed = node.children.map((child, i) => ({
    child: compactNode(child, seed),
    size: node.sizes[i] ?? 1,
  }))
  const nonEmpty = indexed.filter((x) => !(isPane(x.child) && x.child.tabs.length === 0))
  // 一个 split 里最多保留一个空 pane 作为渲染占位（主区空态）。
  const kept = nonEmpty.length > 0 ? nonEmpty : indexed.slice(0, 1)

  if (kept.length === 0) return emptyPane(seed)
  if (kept.length === 1) return kept[0]?.child as LayoutNode

  return {
    ...node,
    children: kept.map((x) => x.child),
    sizes: normalizeSizes(kept.map((x) => x.size)),
  }
}

export function compact(layout: WorkbenchLayout, seed: PaneId): WorkbenchLayout {
  return { ...layout, root: compactNode(layout.root, seed) }
}

/** 渲染视图 = 结构收缩。保留独立名字，因为两者的调用语义不同。 */
export function viewNode(node: LayoutNode, seed: PaneId): LayoutNode {
  return compactNode(node, seed)
}

export function view(layout: WorkbenchLayout, seed: PaneId): WorkbenchLayout {
  return compact(layout, seed)
}

/** 把比例归一化并夹到 MIN_RATIO 以上。 */
export function normalizeSizes(sizes: readonly number[]): number[] {
  const safe = sizes.map((s) => (Number.isFinite(s) && s > 0 ? s : 0))
  const sum = safe.reduce((a, b) => a + b, 0)
  if (sum <= 0) return safe.map(() => 1 / safe.length)
  const scaled = safe.map((s) => Math.max(MIN_RATIO, s / sum))
  const total = scaled.reduce((a, b) => a + b, 0)
  return scaled.map((s) => s / total)
}

/**
 * 结构等价：忽略对象身份与瞬时焦点，只看**可见布局形态**（根、浮窗、胶囊）。
 * 焦点是交互状态，撤销后是否恢复焦点由调用方单独断言。
 */
export function sameLayout(a: WorkbenchLayout, b: WorkbenchLayout): boolean {
  const seed = (isPane(a.root) ? a.root.id : (panes(a.root)[0]?.id ?? a.root.id)) as PaneId
  const shape = (layout: WorkbenchLayout) => {
    const v = view(layout, seed)
    return { root: v.root, regions: v.regions, regionSizes: v.regionSizes, floats: v.floats, minimized: v.minimized }
  }
  return JSON.stringify(shape(a)) === JSON.stringify(shape(b))
}
