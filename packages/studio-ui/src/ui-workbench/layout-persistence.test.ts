import { describe, expect, it, vi } from 'vitest'

import {
  type PaneId,
  type Tab,
  type WorkbenchLayout,
  createMint,
  emptyLayout,
  ensureWorkbenchRegions,
  makeTab,
} from '../workbench/index.js'

import {
  createEmptyController,
  createPersistentWorkbenchController,
  createWorkbenchController,
} from './controller.js'
import {
  LayoutPersistenceError,
  createLayoutPersistence,
  type LayoutPersistenceStorage,
} from './layout-persistence.js'

const KEY = 'dsh.workbench.test'

function fakeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  const storage: LayoutPersistenceStorage & { failKey?: string; values: Map<string, string> } = {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (storage.failKey === key) throw new Error(`injected failure: ${key}`)
      values.set(key, value)
    },
  }
  return storage
}

function tab(id: string): Tab {
  return makeTab(id as Tab['id'], { kind: 'panel', contentId: id, instanceId: id }, id)
}

function insert(controller: ReturnType<typeof createEmptyController>, id: string): void {
  const pane = controller.focusedPane()
  if (!pane) throw new Error('no pane')
  controller.dispatch({ kind: 'insertTab', pane, tab: tab(id) })
}

describe('workbench layout persistence', () => {
  it('save/restore round-trip includes group, lock and Pin fields', () => {
    const storage = fakeStorage()
    const persistence = createLayoutPersistence({ storage, key: KEY, now: () => '2026-11-28T00:00:00.000Z' })
    const controller = createWorkbenchController(emptyLayout(createMint('p').pane()), { persistence })
    insert(controller, 'a')
    const pane = controller.focusedPane()!
    const state = controller.getState()
    if (state.root.kind !== 'pane') throw new Error('expected pane')
    const a = state.root.tabs[0]!
    controller.dispatch({
      kind: 'floatTabs',
      pane,
      tabIds: [a!.id],
      floatId: 'f1',
      rect: { x: 10, y: 20, w: 400, h: 300 },
      pin: 'windowTop',
    })
    controller.dispatch({ kind: 'setLocked', floatId: 'f1', locked: true })
    controller.dispatch({ kind: 'setFloatGroup', floatId: 'f1', groupId: 'g1' })

    const restored = createLayoutPersistence({ storage, key: KEY })
    expect(restored.snapshot()?.revision).toBe(3)
    expect(restored.snapshot()?.layout).toEqual(controller.getState())
    expect(restored.snapshot()?.layout.floats[0]).toMatchObject({
      groupId: 'g1',
      locked: true,
      pin: 'windowTop',
    })
  })

  it('stale controller conflicts instead of overwriting another window', () => {
    const storage = fakeStorage()
    const first = createLayoutPersistence({ storage, key: KEY })
    const second = createLayoutPersistence({ storage, key: KEY })
    const onError = vi.fn()
    const a = createWorkbenchController(emptyLayout(createMint('a').pane()), { persistence: first })
    const b = createWorkbenchController(emptyLayout(createMint('b').pane()), { persistence: second, onPersistenceError: onError })

    insert(a, 'from-a')
    const before = b.getState()
    insert(b, 'from-b')

    expect(b.getState()).toBe(before)
    expect(b.canUndo()).toBe(false)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'conflict' }))
    expect(first.snapshot()?.layout).toEqual(a.getState())
  })

  it('main write failure preserves old snapshot and does not commit controller state/history', () => {
    const storage = fakeStorage()
    const persistence = createLayoutPersistence({ storage, key: KEY })
    const controller = createWorkbenchController(emptyLayout(createMint('f').pane()), { persistence })
    insert(controller, 'saved')
    const before = controller.getState()
    const rawBefore = storage.getItem(KEY)
    storage.failKey = KEY

    insert(controller, 'rejected')

    expect(controller.getState()).toBe(before)
    expect(controller.canUndo()).toBe(true)
    expect(storage.getItem(KEY)).toBe(rawBefore)
    expect(persistence.snapshot()?.layout).toEqual(before)
  })

  it('backup failure aborts before touching the primary snapshot', () => {
    const storage = fakeStorage()
    const persistence = createLayoutPersistence({ storage, key: KEY })
    const controller = createWorkbenchController(emptyLayout(createMint('b').pane()), { persistence })
    insert(controller, 'saved')
    const before = controller.getState()
    const rawBefore = storage.getItem(KEY)
    storage.failKey = `${KEY}.bak`

    insert(controller, 'rejected')

    expect(controller.getState()).toBe(before)
    expect(storage.getItem(KEY)).toBe(rawBefore)
  })

  it('corrupt primary recovers the previous good backup and can save again', () => {
    const storage = fakeStorage()
    const persistence = createLayoutPersistence({ storage, key: KEY })
    const controller = createWorkbenchController(emptyLayout(createMint('r').pane()), { persistence })
    insert(controller, 'kept')
    const kept = controller.getState()
    insert(controller, 'newer')
    storage.values.set(KEY, '{broken')

    const recovered = createLayoutPersistence({ storage, key: KEY })
    expect(recovered.snapshot()?.layout).toEqual(kept)
    expect(recovered.report()).toMatchObject({ recovered: true })

    const next = { ...kept, focused: kept.root.id }
    recovered.save(next)
    expect(recovered.snapshot()?.layout).toEqual(next)
    expect(createLayoutPersistence({ storage, key: KEY }).snapshot()?.layout).toEqual(next)
  })

  it('corrupt primary and backup stay visible and are not overwritten automatically', () => {
    const storage = fakeStorage({ [KEY]: '{broken', [`${KEY}.bak`]: 'also broken' })
    const onError = vi.fn()
    const session = createPersistentWorkbenchController({ storage, key: KEY, onPersistenceError: onError })

    expect(session.persistence).toBeNull()
    expect(session.initialError).toBeInstanceOf(LayoutPersistenceError)
    insert(session.controller, 'unsaved')
    expect(storage.getItem(KEY)).toBe('{broken')
    expect(storage.getItem(`${KEY}.bak`)).toBe('also broken')
  })

  it('migrates a bare legacy v2 layout, adds default regions, and saves the new format', () => {
    const mint = createMint('m')
    const layout = emptyLayout(mint.pane())
    const storage = fakeStorage({ [KEY]: JSON.stringify(layout) })
    const persistence = createLayoutPersistence({ storage, key: KEY })
    const restored = persistence.snapshot()!
    expect(restored.revision).toBe(0)
    expect(restored.layout.root).toEqual(layout.root)
    expect(restored.layout.regions).toMatchObject({
      sidebar: { id: 'region-sidebar', tabs: [] },
      right: { id: 'region-right', tabs: [] },
      bottom: { id: 'region-bottom', tabs: [] },
    })
    expect(persistence.report().migrations).toEqual(['bare-layout-to-snapshot-v1', 'v2-default-regions'])

    persistence.save(restored.layout)
    const raw = JSON.parse(storage.getItem(KEY)!) as { layout: WorkbenchLayout }
    expect(raw.layout.regions).toEqual(restored.layout.regions)
    expect(raw.layout.version).toBe(2)
    expect(createLayoutPersistence({ storage, key: KEY }).report().migrations).toEqual([])
  })

  it('restored IDs cannot collide with newly minted tabs after reload', () => {
    const existing = new Set(Array.from({ length: 1000 }, (_, index) => `wb-${index + 1}`))
    const restoredTabs = Array.from(existing, (id) => tab(id))
    const paneId = 'wb-1000' as PaneId
    const layout = {
      ...emptyLayout(paneId),
      root: { kind: 'pane' as const, id: paneId, tabs: restoredTabs, activeTab: restoredTabs[restoredTabs.length - 1]?.id },
    }
    const controller = createWorkbenchController(layout)
    for (let index = 0; index < 50; index += 1) {
      const id = controller.mint.tab()
      expect(existing.has(id)).toBe(false)
      existing.add(id)
    }
  })

  it('undo and redo are persisted, and failed undo leaves history retryable', () => {
    const storage = fakeStorage()
    const persistence = createLayoutPersistence({ storage, key: KEY })
    const controller = createWorkbenchController(emptyLayout(createMint('u').pane()), { persistence })
    insert(controller, 'tab')
    expect(createLayoutPersistence({ storage, key: KEY }).snapshot()?.layout).toEqual(controller.getState())

    storage.failKey = KEY
    expect(controller.undo()).toBe(false)
    expect(controller.canUndo()).toBe(true)
    storage.failKey = undefined
    expect(controller.undo()).toBe(true)
    expect(createLayoutPersistence({ storage, key: KEY }).snapshot()?.layout).toEqual(controller.getState())

    expect(controller.redo()).toBe(true)
    expect(createLayoutPersistence({ storage, key: KEY }).snapshot()?.layout).toEqual(controller.getState())
  })

  it('accepts an old snapshot envelope without regions and migrates only the layout shape', () => {
    const legacy = emptyLayout(createMint('envelope').pane())
    const storage = fakeStorage({
      [KEY]: JSON.stringify({
        format: 'dsh-studio-workbench-layout',
        version: 1,
        revision: 7,
        savedAt: null,
        layout: legacy,
      }),
    })
    const persistence = createLayoutPersistence({ storage, key: KEY })
    expect(persistence.snapshot()).toMatchObject({ revision: 7, layout: { version: 2, regions: expect.any(Object) } })
    expect(persistence.report().migrations).toEqual(['v2-default-regions'])
  })

  it('round-trips region tabs and sizes without reporting a migration', () => {
    const mint = createMint('regions')
    const initial = ensureWorkbenchRegions(emptyLayout(mint.pane()))
    const layout: WorkbenchLayout = {
      ...initial,
      regions: {
        ...initial.regions!,
        sidebar: { ...initial.regions!.sidebar, tabs: [tab('sidebar-tab')], activeTab: 'sidebar-tab' as Tab['id'] },
      },
      regionSizes: { sidebar: 240, right: 300, bottom: 180 },
    }
    const storage = fakeStorage()
    const persistence = createLayoutPersistence({ storage, key: KEY })
    persistence.save(layout)
    const restored = createLayoutPersistence({ storage, key: KEY })
    expect(restored.snapshot()?.layout).toEqual(layout)
    expect(restored.report().migrations).toEqual([])
  })

  it('rejects region/node/tab id collisions and invalid region sizes', () => {
    const rootId = createMint('ids').pane()
    const initial = ensureWorkbenchRegions(emptyLayout(rootId))
    const rootTab = tab('root-tab')
    const base: WorkbenchLayout = {
      ...initial,
      root: { kind: 'pane', id: rootId, tabs: [rootTab], activeTab: rootTab.id },
    }
    const sharedTab = tab('shared-tab')
    const floatId = initial.regions!.right.id
    const invalid: WorkbenchLayout[] = [
      { ...base, regions: { ...base.regions!, sidebar: { ...base.regions!.sidebar, id: rootId } } },
      { ...base, regions: { ...base.regions!, sidebar: { ...base.regions!.sidebar, id: floatId } } },
      {
        ...base,
        regions: {
          ...base.regions!,
          sidebar: { ...base.regions!.sidebar, tabs: [sharedTab], activeTab: sharedTab.id },
          right: { ...base.regions!.right, tabs: [sharedTab], activeTab: sharedTab.id },
        },
      },
      {
        ...base,
        regions: {
          ...base.regions!,
          sidebar: {
            ...base.regions!.sidebar,
            tabs: [makeTab(rootTab.id, rootTab.ref)],
            activeTab: rootTab.id,
          },
        },
      },
      {
        ...base,
        floats: [{
          kind: 'float', id: floatId, rect: { x: 0, y: 0, w: 100, h: 100 }, pin: 'none', tabs: [],
        }],
      },
      { ...base, floats: [{ kind: 'float', id: rootTab.id, rect: { x: 0, y: 0, w: 100, h: 100 }, pin: 'none', tabs: [] }] },
      { ...base, regionSizes: { sidebar: -1 } },
      { ...base, regionSizes: { unknown: 10 } as never },
    ]
    for (const layout of invalid) {
      const storage = fakeStorage({ [KEY]: JSON.stringify(layout) })
      expect(() => createLayoutPersistence({ storage, key: KEY })).toThrow(LayoutPersistenceError)
    }
  })

  it('migration avoids default region ids already used by legacy nodes', () => {
    const legacy: WorkbenchLayout = {
      ...emptyLayout('region-sidebar' as PaneId),
      root: { kind: 'pane', id: 'region-sidebar' as PaneId, tabs: [], activeTab: undefined },
    }
    const storage = fakeStorage({ [KEY]: JSON.stringify(legacy) })
    const restored = createLayoutPersistence({ storage, key: KEY }).snapshot()!.layout
    expect(restored.regions?.sidebar.id).toBe('region-sidebar-2')
    const ids = [
      restored.root.id,
      ...Object.values(restored.regions!).map((pane) => pane.id),
      ...restored.floats.map((float) => float.id),
    ]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('controller reserves region/float ids and tabs, exposes focusedHost, and undoes/redoes transfer', () => {
    const rootId = createMint('controller').pane()
    const initial = ensureWorkbenchRegions(emptyLayout(rootId))
    const state: WorkbenchLayout = {
      ...initial,
      root: { kind: 'pane', id: rootId, tabs: [tab('main-tab')], activeTab: 'main-tab' as Tab['id'] },
      regions: {
        ...initial.regions!,
        sidebar: {
          ...initial.regions!.sidebar,
          tabs: [tab('wb-1001')],
          activeTab: 'wb-1001' as Tab['id'],
        },
      },
      floats: [{
        kind: 'float', id: 'wb-1002', rect: { x: 0, y: 0, w: 200, h: 200 }, pin: 'none',
        tabs: [tab('wb-1003')], activeTab: 'wb-1003' as Tab['id'],
      }],
    }
    const controller = createWorkbenchController(state)
    for (let index = 0; index < 20; index += 1) {
      expect(['wb-1001', 'wb-1002', 'wb-1003']).not.toContain(controller.mint.tab())
    }
    const before = controller.getState()
    const regionHost = { kind: 'region' as const, id: before.regions!.sidebar.id }
    controller.dispatch({ kind: 'transferTab', from: { kind: 'pane', id: before.root.id }, to: regionHost, tabId: 'main-tab' as Tab['id'] })
    const after = controller.getState()
    expect(controller.focusedHost()).toEqual(regionHost)
    expect(controller.undo()).toBe(true)
    expect(controller.getState()).toStrictEqual(before)
    expect(controller.redo()).toBe(true)
    expect(controller.getState()).toStrictEqual(after)
    controller.dispatch({ kind: 'focus', id: 'wb-1002' })
    expect(controller.focusedHost()).toEqual({ kind: 'float', id: 'wb-1002' })
  })
})
