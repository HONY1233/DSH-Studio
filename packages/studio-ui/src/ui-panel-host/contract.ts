/**
 * 面板契约 —— 所有面板只通过这份声明进入工作台。
 *
 * 三条来自 omp 的经验，写进类型而不是文档：
 * 1) `widthTiers` 让面板按**容器宽度**换版式，禁止读 window.innerWidth；
 * 2) `keepAlive` 决定移出可见区域时是否保活（终端要保、设置页不用）；
 * 3) `scope` 决定切会话时是否重建（跟会话 / 跟工作区 / 全局）。
 */

import type { ReactNode } from 'react'

import type { PanelSize } from './size.js'

export type { PanelSize } from './size.js'

/** 面板可落位的区域。center 只对非会话内容开放。 */
export type PanelRegion = 'left' | 'center' | 'right' | 'bottom' | 'float'

/** 归属维度：决定切会话时内容是否重建。 */
export type PanelScope =
  /** 绑定当前会话：切会话换内容（terminal / changes / context）。 */
  | 'session'
  /** 绑定工作区：跨会话共享（files / git）。 */
  | 'workspace'
  /** 全局单例（settings / jobs）。 */
  | 'global'

export interface LocalizedText {
  readonly zh: string
  readonly en: string
}

export interface PanelRenderProps {
  readonly panelId: string
  /** 多实例 id，形如 `files@2`；持久化与 React key 都用它。 */
  readonly instanceId: string
  /** 当前是否可见。keepAlive 的隐藏面板会拿到 false 但保持挂载。 */
  readonly active: boolean
  /** 宿主给的真实尺寸与档位；面板据此换版式。 */
  readonly size: PanelSize
}

export interface PanelContribution {
  /** 稳定 id，进持久化键，发布后不得改名。 */
  readonly id: string
  readonly title: LocalizedText
  readonly scope: PanelScope
  /** 允许出现的区域；空数组表示只能由代码打开，不进"添加面板"菜单。 */
  readonly regions: readonly PanelRegion[]
  /** 允许开多个实例（如 Files 可同时看两个目录）。 */
  readonly multi: boolean
  readonly defaultRegion: PanelRegion
  /** 最小尺寸，吸附分屏的可行性判据。 */
  readonly minSize?: { readonly w: number; readonly h: number }
  /** 版式档位阈值（容器宽度，升序，首项必须为 0）。 */
  readonly widthTiers?: readonly number[]
  /** 移出可见区域时是否保留挂载与订阅。 */
  readonly keepAlive: boolean
  readonly render: (props: PanelRenderProps) => ReactNode
}

export interface ContractIssue {
  readonly code:
    | 'empty-id'
    | 'bad-id'
    | 'no-regions'
    | 'duplicate-region'
    | 'default-not-in-regions'
    | 'bad-tiers'
    | 'bad-min-size'
    | 'multi-instance-in-id'
    | 'no-render'
  readonly message: string
}

const ID_PATTERN = /^[a-z][a-z0-9-]*$/

/**
 * 注册前校验。返回空数组才允许注册；
 * 每条都是"会在运行期炸"的问题，不是风格建议。
 */
export function validateContribution(c: PanelContribution): ContractIssue[] {
  const issues: ContractIssue[] = []

  if (!c.id) issues.push({ code: 'empty-id', message: 'panel id 不能为空' })
  else if (!ID_PATTERN.test(c.id)) {
    issues.push({
      code: 'bad-id',
      message: `panel id 必须是 kebab-case 且不含 ':' 或 '@'（持久化键分隔符）：${c.id}`,
    })
  }

  if (c.regions.length === 0) {
    issues.push({ code: 'no-regions', message: 'regions 为空时面板永远无法显示；请至少给一个区域' })
  }
  if (new Set(c.regions).size !== c.regions.length) {
    issues.push({ code: 'duplicate-region', message: 'regions 有重复项' })
  }
  if (c.regions.length > 0 && !c.regions.includes(c.defaultRegion)) {
    issues.push({
      code: 'default-not-in-regions',
      message: `defaultRegion(${c.defaultRegion}) 不在 regions 内`,
    })
  }

  if (c.widthTiers) {
    const tiers = c.widthTiers
    const ascending = tiers.every((t, i) => i === 0 || t > (tiers[i - 1] ?? 0))
    if (tiers[0] !== 0 || !ascending) {
      issues.push({ code: 'bad-tiers', message: 'widthTiers 必须从 0 开始且严格升序' })
    }
  }

  if (c.minSize && (c.minSize.w <= 0 || c.minSize.h <= 0)) {
    issues.push({ code: 'bad-min-size', message: 'minSize 必须为正数' })
  }

  if (!c.multi && c.id.includes('@')) {
    issues.push({ code: 'multi-instance-in-id', message: "单实例面板的 id 不应包含 '@'" })
  }

  if (typeof c.render !== 'function') {
    issues.push({ code: 'no-render', message: '缺少 render' })
  }

  return issues
}
