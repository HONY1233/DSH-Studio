/**
 * 控制器 —— 把「纯状态机 + 历史 + 订阅」包成一个 React 可用的小对象。
 *
 * 刻意不放进 `workbench` 包：那个包必须零 React、零订阅模型，
 * 才能在 Node 里回放。这里只是它的一层薄壳。
 */

import {
  type LayoutOp,
  type PaneId,
  type Tab,
  type TabHostRef,
  type TabId,
  type TabRef,
  type WorkbenchLayout,
  allTabs,
  applyOp,
  applyOps,
  createMint,
  emptyLayout,
  ensureWorkbenchRegions,
  findPane,
  makeTab,
  regionEntries,
  workbenchIds,
  WorkbenchHistory,
} from '../workbench/index.js'

import { assertTabCountCapacity, createWorkbenchLimits, type WorkbenchLimits } from '@dsh-studio/workbench-core'

import {
  createLayoutPersistence,
  type CreateLayoutPersistenceOptions,
  type LayoutPersistenceReport,
  type WorkbenchLayoutPersistence,
} from './layout-persistence.js'

/**
 * The subset of a ControlError this UI actually shows. Keeping it structural
 * avoids re-exporting the Node-side error class into the browser bundle.
 */
export interface WorkbenchLimitError {
  readonly code: string
  readonly message: string
  readonly details?: Readonly<Record<string, unknown>>
}

export interface WorkbenchControllerOptions {
  /** 在状态与历史提交前同步保存；失败时本次操作取消。 */
  readonly persistence?: Pick<WorkbenchLayoutPersistence, 'save'>
  readonly onPersistenceError?: (error: unknown) => void
  readonly onPersistenceSaved?: () => void
  /** X4.6 view cap. Only additions are checked; closing a tab always works. */
  readonly limits?: Partial<WorkbenchLimits>
}

export interface WorkbenchController {
  getState(): WorkbenchLayout
  subscribe(listener: () => void): () => void
  dispatch(op: LayoutOp, label?: string): void
  dispatchMany(ops: readonly LayoutOp[], label: string): void
  undo(): boolean
  redo(): boolean
  canUndo(): boolean
  canRedo(): boolean
  /** 在焦点格（缺省第一个格）里打开一个内容，返回新 tab id。 */
  open(ref: TabRef, pane?: PaneId): TabId
  /** 当前焦点格；没有焦点时取第一个格。 */
  focusedPane(): PaneId | undefined
  /** 当前焦点 tab 宿主（pane / region pane / float）；split 焦点回退到第一个 pane。 */
  focusedHost(): TabHostRef | undefined
  /** 最近一次因达到 view 上限被取消的操作；成功提交后清空。 */
  limitError(): WorkbenchLimitError | null
  clearLimitError(): void
  readonly limits: WorkbenchLimits
  readonly mint: ReturnType<typeof createMint>
}

export function createWorkbenchController(initial: WorkbenchLayout, options: WorkbenchControllerOptions = {}): WorkbenchController {
  const baseMint = createMint('wb')
  const normalizedInitial = ensureWorkbenchRegions(initial)
  const usedIds = workbenchIds(normalizedInitial)
  const unique = <T extends string>(next: () => T): T => {
    let id = next()
    while (usedIds.has(id)) id = next()
    usedIds.add(id)
    return id
  }
  const mint = {
    pane: () => unique(baseMint.pane),
    split: () => unique(baseMint.split),
    tab: () => unique(baseMint.tab),
    float: () => unique(baseMint.float),
  }
  const history = new WorkbenchHistory(20)
  const listeners = new Set<() => void>()
  const limits = createWorkbenchLimits(options.limits)
  let state = normalizedInitial
  let lastLimitError: WorkbenchLimitError | null = null

  const notify = (): void => {
    for (const listener of listeners) listener()
  }

  const persist = (next: WorkbenchLayout): boolean => {
    if (!options.persistence) return true
    try {
      options.persistence.save(next)
      options.onPersistenceSaved?.()
      return true
    } catch (error) {
      options.onPersistenceError?.(error)
      return false
    }
  }

  const commit = (next: WorkbenchLayout, label: string, before: WorkbenchLayout): void => {
    if (next === state) return
    if (allTabs(next).length > allTabs(state).length) {
      try {
        assertTabCountCapacity(allTabs(state).length, limits)
      } catch (error) {
        lastLimitError = error as WorkbenchLimitError
        notify()
        return
      }
    }
    if (!persist(next)) return
    lastLimitError = null
    state = next
    workbenchIds(next).forEach((id) => usedIds.add(id))
    history.push({ label, before, after: next })
    notify()
  }

  const controller: WorkbenchController = {
    mint,
    limits,
    getState: () => state,
    limitError: () => lastLimitError,
    clearLimitError() {
      if (!lastLimitError) return
      lastLimitError = null
      notify()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispatch(op, label = op.kind) {
      const before = state
      const { next } = applyOp(state, op)
      commit(next, label, before)
    },
    dispatchMany(ops, label) {
      if (ops.length === 0) return
      const before = state
      const { next } = applyOps(state, ops)
      commit(next, label, before)
    },
    undo() {
      const intent = history.peekUndo()
      if (!intent || !persist(intent.before)) return false
      const next = history.undo(state)
      if (!next) return false
      state = next
      lastLimitError = null
      notify()
      return true
    },
    redo() {
      const intent = history.peekRedo()
      if (!intent || !persist(intent.after)) return false
      const next = history.redo(state)
      if (!next) return false
      state = next
      lastLimitError = null
      notify()
      return true
    },
    canUndo: () => history.canUndo,
    canRedo: () => history.canRedo,
    focusedHost() {
      const focused = state.focused
      if (focused) {
        if (findPane(state.root, focused as PaneId)) return { kind: 'pane', id: focused }
        if (regionEntries(state).some(([, pane]) => pane.id === focused)) return { kind: 'region', id: focused }
        if (state.floats.some((float) => float.id === focused)) return { kind: 'float', id: focused }
      }
      const walk = (node: WorkbenchLayout['root']): PaneId | undefined =>
        node.kind === 'pane' ? node.id : node.children.map(walk).find((id): id is PaneId => id !== undefined)
      const pane = walk(state.root)
      return pane === undefined ? undefined : { kind: 'pane', id: pane }
    },
    focusedPane() {
      const focused = state.focused
      if (focused) {
        const hit = findPane(state.root, focused as PaneId)
        if (hit) return hit.id
      }
      const walk = (node: WorkbenchLayout['root']): PaneId | undefined =>
        node.kind === 'pane' ? node.id : node.children.map(walk).find((id): id is PaneId => id !== undefined)
      return walk(state.root)
    },
    open(ref, pane) {
      const target = pane ?? controller.focusedPane()
      if (!target) throw new Error('workbench 没有可用的格')
      const tab: Tab = makeTab(mint.tab(), ref)
      const before = state
      lastLimitError = null
      controller.dispatch({ kind: 'insertTab', pane: target, tab }, 'open')
      if (state === before) {
        if (lastLimitError) throw lastLimitError
        throw new Error('workbench layout 未保存，打开操作已取消')
      }
      return tab.id
    },
  }

  return controller
}

/** 测试与演示用的空工作台。 */
export function createEmptyController(options: { readonly limits?: Partial<WorkbenchLimits> } = {}): WorkbenchController {
  const m = createMint('seed')
  return createWorkbenchController(emptyLayout(m.pane()), options)
}

export interface PersistentWorkbenchControllerOptions extends CreateLayoutPersistenceOptions {
  readonly onPersistenceError?: (error: unknown) => void
  readonly onPersistenceSaved?: () => void
  readonly limits?: Partial<WorkbenchLimits>
}

export interface PersistentWorkbenchControllerSession {
  readonly controller: WorkbenchController
  readonly persistence: WorkbenchLayoutPersistence | null
  readonly report: LayoutPersistenceReport
  /** 启动时损坏/不可读会明确暴露，且不会自动覆盖原始存储。 */
  readonly initialError: unknown
}

/** 同步恢复布局；没有快照时创建空工作台。存储故障时保留可见错误并禁用保存。 */
export function createPersistentWorkbenchController(
  options: PersistentWorkbenchControllerOptions,
): PersistentWorkbenchControllerSession {
  let persistence: WorkbenchLayoutPersistence | null = null
  let initial: WorkbenchLayout | undefined
  let initialError: unknown = null
  let report: LayoutPersistenceReport = { recovered: false, corruption: null, migrations: [] }
  try {
    persistence = createLayoutPersistence(options)
    initial = persistence.snapshot()?.layout
    report = persistence.report()
  } catch (error) {
    initialError = error
  }
  const seed = createMint('restore')
  const controller = createWorkbenchController(initial ?? emptyLayout(seed.pane()), {
    ...(persistence ? { persistence } : {}),
    ...(options.limits ? { limits: options.limits } : {}),
    ...(options.onPersistenceError ? { onPersistenceError: options.onPersistenceError } : {}),
    ...(options.onPersistenceSaved ? { onPersistenceSaved: options.onPersistenceSaved } : {}),
  })
  return { controller, persistence, report, initialError }
}
