/**
 * 布局持久化 —— 键设计决定了数据会不会串。
 *
 * 三条硬规则（omp 出过 P0 的地方）：
 * 1) 真实与预览用不同前缀，同一份代码不得跨前缀读写；
 * 2) 指纹不匹配就丢弃布局、保留预设，回退默认；
 * 3) 布局里找不到的面板 id 静默剔除，不清空整份布局。
 */

import {
  type PaneId,
  type Tab,
  type WorkbenchLayout,
  emptyLayout,
  emptyPane,
} from './layout.js'
import { buildTemplate, type TemplateId, type TemplateMint } from './templates.js'

export interface StorageScope {
  readonly hostId: string
  readonly workspaceId: string
  readonly sessionId?: string
  /** 开发预览：只读覆盖，永不写回真实键。 */
  readonly preview?: boolean
}

const ROOT = 'dsh.workbench.v2'
const ROOT_PREVIEW = 'dsh.workbench.dev.v2'

export function storageKey(scope: StorageScope): string {
  const base = scope.preview ? ROOT_PREVIEW : ROOT
  const parts = [scope.hostId, scope.workspaceId, scope.sessionId ?? '~']
  // 会话 id 可能带路径分隔符，全部编码，避免键碰撞。
  return `${base}:${parts.map((p) => encodeURIComponent(p)).join(':')}`
}

export function presetsKey(preview = false): string {
  return `${preview ? ROOT_PREVIEW : ROOT}.presets`
}

export interface PersistedWorkbench {
  readonly version: 2
  readonly layout: WorkbenchLayout
  readonly savedAt: number
  /** 面板/插件集合指纹；变化即视为旧布局失效。 */
  readonly fingerprint: string
}

/** djb2：稳定、无依赖、跨运行一致。 */
export function fingerprintOf(ids: readonly string[]): string {
  const sorted = [...ids].sort()
  let h = 5381
  for (const s of sorted) {
    for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
    h = ((h << 5) + h + 0x1f) >>> 0
  }
  return h.toString(36)
}

export function encode(layout: WorkbenchLayout, fingerprint: string, now = Date.now()): PersistedWorkbench {
  return { version: 2, layout, savedAt: now, fingerprint }
}

export interface DecodeDeps {
  /** 当前仍注册的面板实例 id；用来剔除已卸载面板。 */
  readonly aliveInstances: (instanceId: string) => boolean
}

/**
 * 解码。任何结构性问题都退化成 `undefined`（调用方回退默认布局），
 * 但单个失效 tab 只会被剔除，不影响整份布局。
 */
export function decode(raw: unknown, expected: string, deps: DecodeDeps): WorkbenchLayout | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const rec = raw as Partial<PersistedWorkbench>
  if (rec.version !== 2 || rec.fingerprint !== expected) return undefined
  const layout = rec.layout
  if (!layout || layout.version !== 2 || !layout.root) return undefined

  const prune = <T extends { readonly ref: { readonly instanceId: string } }>(tabs: readonly T[]): T[] =>
    tabs.filter((t) => deps.aliveInstances(t.ref.instanceId))

  const walk = (node: WorkbenchLayout['root']): WorkbenchLayout['root'] => {
    if (node.kind === 'pane') {
      const tabs = prune(node.tabs)
      const active = tabs.some((t) => t.id === node.activeTab) ? node.activeTab : tabs[tabs.length - 1]?.id
      return active === undefined
        ? { kind: 'pane', id: node.id, tabs }
        : { kind: 'pane', id: node.id, tabs, activeTab: active }
    }
    return { ...node, children: node.children.map(walk) }
  }

  const floats = layout.floats.map((f) => {
    const tabs = prune(f.tabs)
    const active = tabs.some((t) => t.id === f.activeTab) ? f.activeTab : tabs[tabs.length - 1]?.id
    return active === undefined ? { ...f, tabs } : { ...f, tabs, activeTab: active }
  })

  return {
    version: 2,
    root: walk(layout.root),
    floats: floats.filter((f) => f.tabs.length > 0),
    ...(layout.focused === undefined ? {} : { focused: layout.focused }),
    minimized: (layout.minimized ?? []).filter((m) => floats.some((f) => f.id === m.floatId)),
  }
}

// ---------------------------------------------------------------- 出厂预设

export type FactoryPresetId = 'default' | 'focus' | 'debug'

export interface FactoryPreset {
  readonly id: FactoryPresetId
  readonly label: { readonly zh: string; readonly en: string }
  readonly template: TemplateId
}

export const FACTORY_PRESETS: readonly FactoryPreset[] = [
  { id: 'default', label: { zh: '默认', en: 'Default' }, template: 'columns-2' },
  { id: 'focus', label: { zh: '专注', en: 'Focus' }, template: 'columns-2to1' },
  { id: 'debug', label: { zh: '调试', en: 'Debug' }, template: 'left-right-stack' },
]

/** 出厂预设只决定"从哪开始"，不保存具体身份；应用后由用户拖动决定细节。 */
export function buildFactoryPreset(
  id: FactoryPresetId,
  tabs: readonly Tab[],
  mint: TemplateMint,
): WorkbenchLayout {
  const preset = FACTORY_PRESETS.find((p) => p.id === id) ?? FACTORY_PRESETS[0]
  const root = buildTemplate(preset?.template ?? 'columns-2', tabs, mint)
  return { version: 2, root, floats: [], minimized: [] }
}

/** 空工作台：一个空 pane，用于"主区空态"。 */
export function blankLayout(pane: PaneId): WorkbenchLayout {
  return { ...emptyLayout(pane), root: emptyPane(pane) }
}
