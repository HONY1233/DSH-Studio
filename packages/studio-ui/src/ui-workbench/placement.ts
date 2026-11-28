/**
 * 面板落位：把「用户选的区域」翻译成一串可撤销的布局操作。
 *
 * left/right/bottom 是 X4.2 的固定区域宿主，直接插 tab，不再用 split 冒充侧栏。
 * center 仍插入当前主区格；float 用一条原子 floatTab 从任意宿主创建浮窗。
 */

import {
  type LayoutOp,
  type PaneId,
  type Rect,
  type SplitId,
  type Tab,
  type WorkbenchLayout,
} from '../workbench/index.js'

/** 用户能选的落位。与 `PanelRegion` 同名，但这里是"我要放哪"的动作，不是面板的声明。 */
export type Placement = 'center' | 'left' | 'right' | 'bottom' | 'float'

/** 浮窗初始矩形：稍微偏离中心，避免正好盖住输入框。 */
export const DEFAULT_FLOAT_RECT: Rect = { x: 140, y: 96, w: 560, h: 440 }

export interface PlacementIds {
  /** 新切出来的格 id（`center` / `float` 用不到）。 */
  readonly pane: PaneId
  /** 新切出来的 split 节点 id；固定区域用不到，保留以兼容旧调用方。 */
  readonly split: SplitId
  /** 恢复出的自定义区域 id；缺省使用 region-sidebar/right/bottom。 */
  readonly regions?: WorkbenchLayout['regions']
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

    case 'left':
    case 'right':
    case 'bottom': {
      const region = placement === 'left' ? 'sidebar' : placement
      return [{
        kind: 'insertRegionTab',
        region,
        tab,
        ...(ids.regions ? { pane: ids.regions[region].id } : {}),
      }]
    }

    case 'float':
      // 新 tab 先入主格，再用原子 op 浮出；两步仍由 dispatchMany 合成一条历史。
      return [
        { kind: 'insertTab', pane, tab },
        {
          kind: 'floatTab',
          from: { kind: 'pane', id: pane },
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
