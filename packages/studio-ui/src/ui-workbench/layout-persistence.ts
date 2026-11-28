/**
 * Native workbench layout persistence (X4.2).
 *
 * Storage is injected so the same controller can run against localStorage in
 * the renderer or an atomic host adapter later. A snapshot is replaced with a
 * single storage write; the previous good snapshot is backed up first.
 */

import {
  type FloatNode,
  type LayoutNode,
  type PaneNode,
  type PinLevel,
  type Rect,
  type RegionId,
  type RegionSizes,
  type SplitNode,
  type Tab,
  type WorkbenchLayout,
  type WorkbenchRegions,
  REGION_IDS,
  ensureWorkbenchRegions,
} from '../workbench/index.js'

export const WORKBENCH_LAYOUT_STORAGE_FORMAT = 'dsh-studio-workbench-layout'
export const WORKBENCH_LAYOUT_STORAGE_VERSION = 1

export interface LayoutPersistenceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface PersistedWorkbenchLayout {
  readonly format: typeof WORKBENCH_LAYOUT_STORAGE_FORMAT
  readonly version: typeof WORKBENCH_LAYOUT_STORAGE_VERSION
  readonly revision: number
  readonly savedAt: string | null
  readonly layout: WorkbenchLayout
}

export interface LayoutPersistenceReport {
  readonly recovered: boolean
  readonly corruption: string | null
  readonly migrations: readonly string[]
}

export interface WorkbenchLayoutPersistence {
  save(layout: WorkbenchLayout): PersistedWorkbenchLayout
  snapshot(): PersistedWorkbenchLayout | null
  report(): LayoutPersistenceReport
}

export type LayoutPersistenceErrorCode = 'conflict' | 'corrupt' | 'storage'

export class LayoutPersistenceError extends Error {
  constructor(
    readonly code: LayoutPersistenceErrorCode,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message)
    this.name = 'LayoutPersistenceError'
  }
}

const PIN_LEVELS: readonly PinLevel[] = ['none', 'workspace', 'app', 'window', 'windowTop']

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isRect(value: unknown): value is Rect {
  return isRecord(value)
    && isFiniteNumber(value.x)
    && isFiniteNumber(value.y)
    && isFiniteNumber(value.w)
    && isFiniteNumber(value.h)
    && value.w >= 0
    && value.h >= 0
}

function isTab(value: unknown): value is Tab {
  if (!isRecord(value) || !isId(value.id) || !isRecord(value.ref)) return false
  const ref = value.ref
  return (ref.kind === 'conversation' || ref.kind === 'panel')
    && isId(ref.contentId)
    && isId(ref.instanceId)
    && (value.title === undefined || typeof value.title === 'string')
}

function isPane(value: unknown): value is PaneNode {
  if (!isRecord(value) || value.kind !== 'pane' || !isId(value.id) || !Array.isArray(value.tabs)) return false
  if (!value.tabs.every(isTab)) return false
  return value.activeTab === undefined || (isId(value.activeTab) && value.tabs.some((tab) => tab.id === value.activeTab))
}

function isSplit(value: unknown): value is SplitNode {
  if (!isRecord(value) || value.kind !== 'split' || !isId(value.id)) return false
  if (value.axis !== 'row' && value.axis !== 'column') return false
  if (!Array.isArray(value.children) || value.children.length === 0 || !value.children.every(isLayoutNode)) return false
  return Array.isArray(value.sizes)
    && value.sizes.length === value.children.length
    && value.sizes.every(isFiniteNumber)
    && value.sizes.every((size) => size >= 0)
    && Math.abs(value.sizes.reduce((sum, size) => sum + size, 0) - 1) < 1e-6
}

function isLayoutNode(value: unknown): value is LayoutNode {
  return isPane(value) || isSplit(value)
}

function isRegions(value: unknown): value is WorkbenchRegions {
  return isRecord(value) && REGION_IDS.every((region) => isPane(value[region]))
}

function isRegionSizes(value: unknown): value is RegionSizes {
  return isRecord(value)
    && Object.keys(value).every((key) => REGION_IDS.includes(key as RegionId))
    && REGION_IDS.every((region) => value[region] === undefined
      || (isFiniteNumber(value[region]) && (value[region] as number) >= 0))
}

function isFloat(value: unknown): value is FloatNode {
  if (!isRecord(value) || value.kind !== 'float' || !isId(value.id) || !isRect(value.rect)) return false
  if (!PIN_LEVELS.includes(value.pin as PinLevel) || !Array.isArray(value.tabs) || !value.tabs.every(isTab)) return false
  if (value.groupId !== undefined && !isId(value.groupId)) return false
  if (value.locked !== undefined && typeof value.locked !== 'boolean') return false
  return value.activeTab === undefined || (isId(value.activeTab) && value.tabs.some((tab) => tab.id === value.activeTab))
}

function isWorkbenchLayout(value: unknown): value is WorkbenchLayout {
  if (!isRecord(value) || value.version !== 2 || !isLayoutNode(value.root)) return false
  if (!Array.isArray(value.floats) || !value.floats.every(isFloat) || !Array.isArray(value.minimized)) return false
  if (value.regions !== undefined && !isRegions(value.regions)) return false
  if (value.regionSizes !== undefined && !isRegionSizes(value.regionSizes)) return false
  if (value.focused !== undefined && !isId(value.focused)) return false
  const floatIds = new Set(value.floats.map((float) => float.id))
  if (floatIds.size !== value.floats.length) return false
  const minimizedIds = new Set<string>()
  for (const item of value.minimized) {
    if (!isRecord(item) || !isId(item.floatId) || !floatIds.has(item.floatId) || minimizedIds.has(item.floatId)) return false
    minimizedIds.add(item.floatId)
    if (!isFiniteNumber(item.x) || !isFiniteNumber(item.y)) return false
  }

  // node / region pane / float / tab 共享同一个 id 命名空间。
  const ids = new Set<string>()
  const claim = (id: string): void => {
    if (ids.has(id)) throw new Error(`duplicate id: ${id}`)
    ids.add(id)
  }
  const visit = (node: LayoutNode): void => {
    claim(node.id)
    if (node.kind === 'pane') {
      node.tabs.forEach((tab) => claim(tab.id))
      return
    }
    node.children.forEach(visit)
  }
  try {
    visit(value.root)
    if (value.regions) {
      for (const region of REGION_IDS) {
        const pane = value.regions[region]
        claim(pane.id)
        pane.tabs.forEach((tab) => claim(tab.id))
      }
    }
    for (const float of value.floats) {
      claim(float.id)
      float.tabs.forEach((tab) => claim(tab.id))
    }
  } catch {
    return false
  }
  return true
}

function restoreRegions(layout: WorkbenchLayout, migrations: readonly string[]): {
  layout: WorkbenchLayout
  migrations: string[]
} {
  if (layout.regions) return { layout, migrations: [...migrations] }
  return { layout: ensureWorkbenchRegions(layout), migrations: [...migrations, 'v2-default-regions'] }
}

function parseJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    throw new LayoutPersistenceError('corrupt', `${label} 不是合法 JSON`)
  }
}

function parseSnapshot(raw: string): { snapshot: PersistedWorkbenchLayout; migrations: string[] } {
  const value = parseJson(raw, 'workbench layout')
  if (isRecord(value) && value.format === WORKBENCH_LAYOUT_STORAGE_FORMAT) {
    if (value.version !== WORKBENCH_LAYOUT_STORAGE_VERSION) {
      throw new LayoutPersistenceError('corrupt', `不支持的 workbench storage version: ${String(value.version)}`)
    }
    if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0) {
      throw new LayoutPersistenceError('corrupt', 'workbench revision 无效')
    }
    if (value.savedAt !== null && typeof value.savedAt !== 'string') {
      throw new LayoutPersistenceError('corrupt', 'workbench savedAt 无效')
    }
    if (!isWorkbenchLayout(value.layout)) {
      throw new LayoutPersistenceError('corrupt', 'workbench layout 结构无效')
    }
    const restored = restoreRegions(value.layout, [])
    return {
      snapshot: {
        format: WORKBENCH_LAYOUT_STORAGE_FORMAT,
        version: WORKBENCH_LAYOUT_STORAGE_VERSION,
        revision: value.revision as number,
        savedAt: value.savedAt as string | null,
        layout: restored.layout,
      },
      migrations: restored.migrations,
    }
  }
  // Migrate the earlier bare layout / preset envelope without inventing a revision.
  if (isWorkbenchLayout(value)) {
    const restored = restoreRegions(value, ['bare-layout-to-snapshot-v1'])
    return {
      snapshot: {
        format: WORKBENCH_LAYOUT_STORAGE_FORMAT,
        version: WORKBENCH_LAYOUT_STORAGE_VERSION,
        revision: 0,
        savedAt: null,
        layout: restored.layout,
      },
      migrations: restored.migrations,
    }
  }
  if (isRecord(value) && value.version === 2 && isWorkbenchLayout(value.layout)) {
    const restored = restoreRegions(value.layout, ['preset-layout-to-snapshot-v1'])
    return {
      snapshot: {
        format: WORKBENCH_LAYOUT_STORAGE_FORMAT,
        version: WORKBENCH_LAYOUT_STORAGE_VERSION,
        revision: 0,
        savedAt: null,
        layout: restored.layout,
      },
      migrations: restored.migrations,
    }
  }
  throw new LayoutPersistenceError('corrupt', 'workbench layout 格式或版本不受支持')
}

function serialize(snapshot: PersistedWorkbenchLayout): string {
  return JSON.stringify(snapshot)
}

function storageError(message: string, error: unknown): LayoutPersistenceError {
  const details = isRecord(error) ? { code: error.code, message: error.message } : { message: String(error) }
  return new LayoutPersistenceError('storage', message, details)
}

export interface CreateLayoutPersistenceOptions {
  readonly storage: LayoutPersistenceStorage
  readonly key: string
  readonly now?: () => string
}

export function createLayoutPersistence(options: CreateLayoutPersistenceOptions): WorkbenchLayoutPersistence {
  if (!options || !isRecord(options.storage)
    || typeof options.storage.getItem !== 'function'
    || typeof options.storage.setItem !== 'function') {
    throw new LayoutPersistenceError('storage', 'workbench persistence 需要 getItem/setItem 存储适配器')
  }
  if (!isId(options.key)) throw new LayoutPersistenceError('storage', 'workbench persistence key 不能为空')
  const now = options.now ?? (() => new Date().toISOString())
  if (typeof now !== 'function') throw new LayoutPersistenceError('storage', 'now() 必须是函数')
  const backupKey = `${options.key}.bak`
  let current: PersistedWorkbenchLayout | null = null
  let currentRaw: string | null = null
  let observedPrimaryRaw: string | null = null
  let report: LayoutPersistenceReport = { recovered: false, corruption: null, migrations: [] }

  const read = (key: string): string | null => {
    try {
      return options.storage.getItem(key)
    } catch (error) {
      throw storageError(`读取 workbench 存储失败: ${key}`, error)
    }
  }

  const load = (): void => {
    const primaryRaw = read(options.key)
    observedPrimaryRaw = primaryRaw
    if (primaryRaw !== null) {
      try {
        const parsed = parseSnapshot(primaryRaw)
        current = parsed.snapshot
        currentRaw = primaryRaw
        report = { recovered: false, corruption: null, migrations: parsed.migrations }
        return
      } catch (error) {
        const corruption = error instanceof LayoutPersistenceError ? error.message : String(error)
        try {
          const backupRaw = read(backupKey)
          if (backupRaw === null) throw new LayoutPersistenceError('corrupt', 'workbench 备份不存在')
          const parsed = parseSnapshot(backupRaw)
          current = parsed.snapshot
          currentRaw = backupRaw
          report = { recovered: true, corruption, migrations: parsed.migrations }
          return
        } catch (backupError) {
          throw new LayoutPersistenceError('corrupt', `workbench 主存储损坏且备份不可用: ${corruption}`, {
            backupError: backupError instanceof Error ? backupError.message : String(backupError),
          })
        }
      }
    }
    const backupRaw = read(backupKey)
    if (backupRaw !== null) {
      try {
        const parsed = parseSnapshot(backupRaw)
        current = parsed.snapshot
        currentRaw = backupRaw
        report = { recovered: true, corruption: 'workbench 主存储缺失', migrations: parsed.migrations }
        return
      } catch (error) {
        throw new LayoutPersistenceError('corrupt', 'workbench 主存储缺失且备份损坏', {
          cause: error instanceof Error ? error.message : String(error),
        })
      }
    }
    current = null
    currentRaw = null
    report = { recovered: false, corruption: null, migrations: [] }
  }

  load()

  return {
    snapshot: () => current,
    report: () => report,
    save(layout) {
      if (!isWorkbenchLayout(layout)) throw new LayoutPersistenceError('corrupt', '拒绝保存无效 workbench layout')
      const savedLayout = ensureWorkbenchRegions(layout)
      const actualRaw = read(options.key)
      if (actualRaw !== observedPrimaryRaw) {
        let actualRevision: number | null = null
        if (actualRaw !== null) {
          try {
            actualRevision = parseSnapshot(actualRaw).snapshot.revision
          } catch {
            actualRevision = null
          }
        }
        throw new LayoutPersistenceError('conflict', 'workbench revision 冲突，拒绝覆盖其他窗口的布局', {
          expectedRevision: current?.revision ?? -1,
          actualRevision,
        })
      }
      const snapshot: PersistedWorkbenchLayout = {
        format: WORKBENCH_LAYOUT_STORAGE_FORMAT,
        version: WORKBENCH_LAYOUT_STORAGE_VERSION,
        revision: (current?.revision ?? -1) + 1,
        savedAt: now(),
        layout: savedLayout,
      }
      const nextRaw = serialize(snapshot)
      if (currentRaw !== null) {
        try {
          options.storage.setItem(backupKey, currentRaw)
        } catch (error) {
          throw storageError('备份当前 workbench 失败；未写入新布局', error)
        }
      }
      try {
        options.storage.setItem(options.key, nextRaw)
      } catch (error) {
        throw storageError('原子写入 workbench 失败；当前布局未被替换', error)
      }
      current = snapshot
      currentRaw = nextRaw
      observedPrimaryRaw = nextRaw
      report = { recovered: false, corruption: null, migrations: [] }
      return snapshot
    },
  }
}
