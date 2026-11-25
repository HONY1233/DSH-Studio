/**
 * 尺寸档位 —— 纯函数优先，React hook 单独一个文件，
 * 这样契约与档位逻辑可以在 Node 里测，不需要 DOM。
 */

export interface PanelSize {
  readonly width: number
  readonly height: number
  /** widthTiers 命中的下标；未声明 widthTiers 时恒为 0。 */
  readonly tier: number
}

/** 命中宽度档位：返回最后一个 `<= width` 的阈值下标。 */
export function tierOf(width: number, tiers: readonly number[] = []): number {
  if (tiers.length === 0) return 0
  let hit = 0
  for (let i = 0; i < tiers.length; i += 1) {
    if (width >= (tiers[i] ?? Number.POSITIVE_INFINITY)) hit = i
  }
  return hit
}

export function sizeOf(width: number, height: number, tiers: readonly number[] = []): PanelSize {
  return { width, height, tier: tierOf(width, tiers) }
}

/**
 * omp 的规则：面板按**自身容器宽度**换版式，不按窗口宽度。
 * 同一个面板被拉宽（浮窗最大化 / 侧栏加宽）就该切宽版，
 * 缩回窄格就回到紧凑版式，且这个切换不得写回布局偏好。
 */
export function isWideTier(size: PanelSize): boolean {
  return size.tier > 0
}
