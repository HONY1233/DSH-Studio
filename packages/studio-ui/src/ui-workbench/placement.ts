/**
 * 面板落位：把「用户选的区域」翻译成一串可撤销的布局操作。
 *
 * 工作台的布局模型里**没有 "right"/"bottom" 这种区域概念** —— 只有一棵
 * split 树和一组浮窗。"左/右栏"本质上就是"把焦点格按 row 轴切一刀，新格放右边"。
 * 这一层把区域名翻译成切分参数，让 UI 只需要说人话（"放右边"）。
 *
 * 三条约定：
 *
 * 1) **区域不是布局状态，是一次性的决定**。切完之后它就是一个普通的格，可以再被
 *    拖、被合并、被关掉。工作台不记录"这个面板属于右栏"——那会引入第二个真相源。
 * 2) **`center` 只往当前格塞**，不切分。会话内容与面板都走这条路。
 * 3) **浮窗要两步**：先插进格，再浮起来。直接造 FloatNode 会绕开"tab 必须先在
 *    某个格里存在"这条不变量。
 */

import {
  type LayoutOp,
  type PaneId,
  type Rect,
  type SplitId,
  type Tab,
} from '../workbench/index.js'

/** 用户能选的落位。与 `PanelRegion` 同名，但这里是"我要放哪"的动作，不是面板的声明。 */
export type Placement = 'center' | 'left' | 'right' | 'bottom' | 'float'

/** 默认切分比例：面板通常比正文窄，右栏给 0.35；底部条给 0.4 更够用。 */
const RIGHT_RATIO = 0.35
const LEFT_RATIO = 0.35
const BOTTOM_RATIO = 0.4

/** 浮窗初始矩形：稍微偏离中心，避免正好盖住输入框。 */
export const DEFAULT_FLOAT_RECT: Rect = { x: 140, y: 96, w: 560, h: 440 }

export interface PlacementIds {
  /** 新切出来的格 id（`center` / `float` 用不到）。 */
  readonly pane: PaneId
  /** 新切出来的 split 节点 id。 */
  readonly split: SplitId
  readonly floatId: string
}

export interface PlacementContext {
  /** 基准格：从哪切。通常是焦点格。 */
  readonly pane: PaneId
  readonly tab: Tab
  readonly ids: PlacementIds
  readonly rect?: Rect
}

/**
 * 生成落位操作序列。
 *
 * 返回值**一定非空**，且对 `center` 是单条 `insertTab` —— 调用方可以无脑
 * `dispatchMany`（它内部按顺序 apply，任一步失败会整体报错）。
 */
export function placeOps(placement: Placement, ctx: PlacementContext): readonly LayoutOp[] {
  const { pane, tab, ids } = ctx

  switch (placement) {
    case 'center':
      return [{ kind: 'insertTab', pane, tab }]

    case 'right':
      return [
        {
          kind: 'split',
          pane,
          axis: 'row',
          at: 'after',
          newPane: ids.pane,
          newSplit: ids.split,
          seed: tab,
          ratio: RIGHT_RATIO,
        },
      ]

    case 'left':
      return [
        {
          kind: 'split',
          pane,
          axis: 'row',
          at: 'before',
          newPane: ids.pane,
          newSplit: ids.split,
          seed: tab,
          ratio: LEFT_RATIO,
        },
      ]

    case 'bottom':
      return [
        {
          kind: 'split',
          pane,
          axis: 'column',
          at: 'after',
          newPane: ids.pane,
          newSplit: ids.split,
          seed: tab,
          ratio: BOTTOM_RATIO,
        },
      ]

    case 'float':
      // 先落进基准格，再浮起来：浮窗里的 tab 也必须先在树上存在过。
      return [
        { kind: 'insertTab', pane, tab },
        {
          kind: 'float',
          pane,
          tabId: tab.id,
          floatId: ids.floatId,
          rect: ctx.rect ?? DEFAULT_FLOAT_RECT,
        },
      ]
  }
}

/** 区域的中文名（菜单用）。UI 可以覆盖，但默认值放在这里，两处不会漂。 */
export const PLACEMENT_LABELS: Readonly<Record<Placement, string>> = {
  center: '当前格',
  left: '左侧',
  right: '右侧',
  bottom: '底部',
  float: '浮窗',
}
