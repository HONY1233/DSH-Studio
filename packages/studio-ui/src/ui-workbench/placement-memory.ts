/**
 * 落位记忆：面板上次被放到哪，下次就还放哪。
 *
 * 为什么值得记：右栏放「会话信息」、底部放「工作台状态」这种习惯一旦形成，
 * 每次打开都要重新选一次位置纯属折磨；而且**选错位置比选错面板更容易让人烦**，
 * 因为它会把你已经摆好的布局挤歪。
 *
 * 三条边界：
 *
 * 1) **记忆只是"下一次的默认值"**，不是布局的一部分。真正的布局状态在
 *    `WorkbenchLayout` 里；这里记的是"用户偏好"，两者不能互相推导。
 * 2) **存不下就当没记过**。localStorage 在隐私模式/配额满时会抛异常，
 *    记忆功能挂了不该让面板打不开。
 * 3) **只认白名单值**。存储里可能留着旧版本写进去的字符串 —— 读到不认识的值
 *    必须当成"没有记忆"，而不是把一个非法区域喂给布局操作（那会直接抛 OpError）。
 */

import type { Placement } from './placement.js'

const STORAGE_KEY = 'studio.panel-placement.v1'

const VALID: ReadonlySet<string> = new Set<Placement>(['center', 'left', 'right', 'bottom', 'float'])

/** 只用到这两个方法，方便测试注入假存储。 */
export interface PlacementStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function isPlacement(value: unknown): value is Placement {
  return typeof value === 'string' && VALID.has(value)
}

export class PlacementMemory {
  private readonly storage: PlacementStorage | undefined
  private map: Record<string, Placement>

  constructor(storage?: PlacementStorage) {
    this.storage = storage
    this.map = readMap(storage)
  }

  /** 记住这个面板放哪。同一个值重复写入不会产生新的存储写入。 */
  remember(panelId: string, placement: Placement): void {
    if (!isPlacement(placement)) return
    if (this.map[panelId] === placement) return
    this.map = { ...this.map, [panelId]: placement }
    this.flush()
  }

  get(panelId: string): Placement | undefined {
    const value = this.map[panelId]
    return isPlacement(value) ? value : undefined
  }

  /** 忘掉一个面板的记忆（菜单里的「默认」）。 */
  forget(panelId: string): void {
    if (!(panelId in this.map)) return
    const next = { ...this.map }
    delete next[panelId]
    this.map = next
    this.flush()
  }

  /** 全部忘掉（调试/重置用）。 */
  clear(): void {
    if (Object.keys(this.map).length === 0) return
    this.map = {}
    this.flush()
  }

  /** 只读快照，测试与调试面板用。 */
  snapshot(): Readonly<Record<string, Placement>> {
    return { ...this.map }
  }

  private flush(): void {
    if (!this.storage) return
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.map))
    } catch {
      // 配额满 / 隐私模式：记忆失效可以接受，面板打不开不可接受。
    }
  }
}

function readMap(storage?: PlacementStorage): Record<string, Placement> {
  if (!storage) return {}
  let raw: string | null = null
  try {
    raw = storage.getItem(STORAGE_KEY)
  } catch {
    return {}
  }
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, Placement> = {}
    for (const [panelId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isPlacement(value)) out[panelId] = value
    }
    return out
  } catch {
    // 坏数据（手改过、旧版本写坏了）：当作没记忆，不要连累启动。
    return {}
  }
}

/** 取浏览器 localStorage；拿不到（SSR / 被策略禁用）就返回 undefined。 */
export function browserStorage(): PlacementStorage | undefined {
  try {
    const storage = globalThis.localStorage
    if (!storage) return undefined
    // 有些环境 getItem 会直接抛（iframe + 第三方 cookie 限制），探一次更稳。
    storage.getItem(STORAGE_KEY)
    return storage
  } catch {
    return undefined
  }
}
