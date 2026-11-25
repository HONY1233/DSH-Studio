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
  type TabId,
  type TabRef,
  type WorkbenchLayout,
  applyOp,
  applyOps,
  createMint,
  emptyLayout,
  findPane,
  makeTab,
  WorkbenchHistory,
} from '../workbench/index.js'

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
  readonly mint: ReturnType<typeof createMint>
}

export function createWorkbenchController(initial: WorkbenchLayout): WorkbenchController {
  const mint = createMint('wb')
  const history = new WorkbenchHistory(20)
  const listeners = new Set<() => void>()
  let state = initial

  const notify = (): void => {
    for (const listener of listeners) listener()
  }

  const commit = (next: WorkbenchLayout, label: string, before: WorkbenchLayout): void => {
    if (next === state) return
    state = next
    history.push({ label, before, after: next })
    notify()
  }

  const controller: WorkbenchController = {
    mint,
    getState: () => state,
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
      const next = history.undo(state)
      if (!next) return false
      state = next
      notify()
      return true
    },
    redo() {
      const next = history.redo(state)
      if (!next) return false
      state = next
      notify()
      return true
    },
    canUndo: () => history.canUndo,
    canRedo: () => history.canRedo,
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
      controller.dispatch({ kind: 'insertTab', pane: target, tab }, 'open')
      return tab.id
    },
  }

  return controller
}

/** 测试与演示用的空工作台。 */
export function createEmptyController(): WorkbenchController {
  const m = createMint('seed')
  return createWorkbenchController(emptyLayout(m.pane()))
}
