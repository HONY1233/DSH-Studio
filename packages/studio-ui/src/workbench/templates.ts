/**
 * 布局模板 —— 六个预设，对应 omp 的布局选择器。
 * 模板应用 = 一次 `replaceRoot` 意图（撤销即回到上一份 root），
 * 所以这里只负责 **构造**，不负责历史。
 */

import {
  emptyPane,
  type LayoutNode,
  type PaneId,
  type SplitId,
  type Tab,
} from './layout.js'

export type TemplateId =
  | 'columns-2'
  | 'columns-2to1'
  | 'columns-3'
  | 'left-stack-right'
  | 'left-right-stack'
  | 'quad'

export interface TemplateSpec {
  readonly id: TemplateId
  readonly label: { readonly zh: string; readonly en: string }
  /** 该模板最多承载的窗口数；超出的 tab 追加到最后一个格。 */
  readonly slots: number
}

export const TEMPLATES: readonly TemplateSpec[] = [
  { id: 'columns-2', label: { zh: '左右各半', en: 'Two columns' }, slots: 2 },
  { id: 'columns-2to1', label: { zh: '左宽右窄 2:1', en: 'Two columns 2:1' }, slots: 2 },
  { id: 'columns-3', label: { zh: '三列', en: 'Three columns' }, slots: 3 },
  { id: 'left-stack-right', label: { zh: '左侧上下 + 右半', en: 'Left stack + right' }, slots: 3 },
  { id: 'left-right-stack', label: { zh: '左半 + 右侧上下', en: 'Left + right stack' }, slots: 3 },
  { id: 'quad', label: { zh: '四宫格', en: 'Quad' }, slots: 4 },
]

export interface TemplateMint {
  pane(index: number): PaneId
  split(index: number): SplitId
}

/** 按顺序切分 tab，最后一个格承接剩余全部。 */
function chunk(tabs: readonly Tab[], slots: number): Tab[][] {
  const out: Tab[][] = Array.from({ length: slots }, () => [])
  tabs.forEach((tab, i) => {
    const idx = Math.min(i, slots - 1)
    out[idx]?.push(tab)
  })
  return out
}

function paneOf(id: PaneId, tabs: readonly Tab[]): LayoutNode {
  const base = emptyPane(id)
  const active = tabs[tabs.length - 1]
  return active ? { ...base, tabs: [...tabs], activeTab: active.id } : base
}

/**
 * 构造模板树。
 * 空槽保留为空 pane —— 渲染层会折叠，但用户接下来拖入的窗口有落点。
 */
export function buildTemplate(id: TemplateId, tabs: readonly Tab[], mint: TemplateMint): LayoutNode {
  const spec = TEMPLATES.find((t) => t.id === id)
  if (!spec) throw new Error(`unknown template: ${id}`)
  const groups = chunk(tabs, spec.slots)

  switch (id) {
    case 'columns-2':
      return {
        kind: 'split',
        id: mint.split(0),
        axis: 'row',
        children: [paneOf(mint.pane(0), groups[0] ?? []), paneOf(mint.pane(1), groups[1] ?? [])],
        sizes: [0.5, 0.5],
      }

    case 'columns-2to1':
      return {
        kind: 'split',
        id: mint.split(0),
        axis: 'row',
        children: [paneOf(mint.pane(0), groups[0] ?? []), paneOf(mint.pane(1), groups[1] ?? [])],
        sizes: [0.66, 0.34],
      }

    case 'columns-3':
      return {
        kind: 'split',
        id: mint.split(0),
        axis: 'row',
        children: [
          paneOf(mint.pane(0), groups[0] ?? []),
          paneOf(mint.pane(1), groups[1] ?? []),
          paneOf(mint.pane(2), groups[2] ?? []),
        ],
        sizes: [1 / 3, 1 / 3, 1 / 3],
      }

    case 'left-stack-right':
      return {
        kind: 'split',
        id: mint.split(0),
        axis: 'row',
        children: [
          {
            kind: 'split',
            id: mint.split(1),
            axis: 'column',
            children: [paneOf(mint.pane(0), groups[0] ?? []), paneOf(mint.pane(1), groups[1] ?? [])],
            sizes: [0.5, 0.5],
          },
          paneOf(mint.pane(2), groups[2] ?? []),
        ],
        sizes: [0.5, 0.5],
      }

    case 'left-right-stack':
      return {
        kind: 'split',
        id: mint.split(0),
        axis: 'row',
        children: [
          paneOf(mint.pane(0), groups[0] ?? []),
          {
            kind: 'split',
            id: mint.split(1),
            axis: 'column',
            children: [paneOf(mint.pane(1), groups[1] ?? []), paneOf(mint.pane(2), groups[2] ?? [])],
            sizes: [0.5, 0.5],
          },
        ],
        sizes: [0.5, 0.5],
      }

    case 'quad':
      return {
        kind: 'split',
        id: mint.split(0),
        axis: 'row',
        children: [
          {
            kind: 'split',
            id: mint.split(1),
            axis: 'column',
            children: [paneOf(mint.pane(0), groups[0] ?? []), paneOf(mint.pane(1), groups[1] ?? [])],
            sizes: [0.5, 0.5],
          },
          {
            kind: 'split',
            id: mint.split(2),
            axis: 'column',
            children: [paneOf(mint.pane(2), groups[2] ?? []), paneOf(mint.pane(3), groups[3] ?? [])],
            sizes: [0.5, 0.5],
          },
        ],
        sizes: [0.5, 0.5],
      }
  }
}

/** 模板选择器只开放当前空间放得下的项（含最小分区约束）。 */
export function eligibleTemplates(work: { w: number; h: number }, minCell = { w: 360, h: 280 }): TemplateId[] {
  return TEMPLATES.filter((t) => {
    const cols = t.id === 'columns-3' ? 3 : t.slots === 4 ? 2 : 2
    const rows = t.id === 'quad' || t.id.startsWith('left') ? 2 : 1
    return work.w / cols >= minCell.w && work.h / rows >= minCell.h
  }).map((t) => t.id)
}
