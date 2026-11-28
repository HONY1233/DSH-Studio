import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ControlError,
  DRAG_THRESHOLD_PX,
  assertContentAttachmentPreserved,
  assertDropCommitAllowed,
  assertWorkbenchRegistryInvariants,
  acquireToolLease,
  applyLayoutOp,
  bindDraftWorkspaceToSession,
  beginWorkbenchDrag,
  cancelWorkbenchDrag,
  commitLayoutOp,
  compactWorkbenchLayout,
  createContentAttachment,
  createConversationWorkspace,
  createFloat,
  createIdMint,
  createLayoutHistory,
  createLayoutTemplate,
  createPane,
  createSessionLease,
  createSplit,
  createTab,
  createToolInstance,
  createWindowRef,
  createWorkbenchLayout,
  createWorkbenchLayoutStore,
  createWorkbenchRegistry,
  describeWorkbenchDragPreview,
  keyboardWorkbenchDrag,
  listTabs,
  migrateWorkbenchSnapshot,
  moveWorkbenchDrag,
  moveToolInstance,
  normalizeSizes,
  putConversationWorkspace,
  putToolInstance,
  redoLayout,
  releaseToolLease,
  releaseWorkbenchDrag,
  restoreWindowGeometry,
  selectPinnedFloats,
  undoLayout,
  validateRect,
  validateWorkbenchLayout,
} from '../../workbench-core/src/index.js'

const NOW = '2026-11-28T00:00:00.000Z'
const RECT = { x: 10, y: 20, w: 640, h: 480 }

function tab(id, instanceId = id, kind = 'panel') {
  return createTab({ id, kind, contentId: instanceId, instanceId })
}

function memoryIo(initial = new Map()) {
  const files = new Map(initial)
  const state = { failAtomic: false, failCopy: false }
  const missing = (path) => Object.assign(new Error(`missing: ${path}`), { code: 'ENOENT' })
  return {
    files,
    state,
    read(path) {
      if (!files.has(path)) throw missing(path)
      return files.get(path)
    },
    atomicWrite(tempPath, path, text) {
      if (state.failAtomic) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
      files.set(path, text)
      files.delete(tempPath)
    },
    copy(source, target) {
      if (state.failCopy) throw Object.assign(new Error('copy failed'), { code: 'EIO' })
      if (!files.has(source)) throw missing(source)
      files.set(target, files.get(source))
    },
    remove(path) {
      files.delete(path)
    },
  }
}

function owner(kind, id, hostId = 'host-a', windowId = 'window-a') {
  return { kind, id, hostId, windowId }
}

function workspace(ownerRef, id = 'draft-1') {
  return createConversationWorkspace({
    owner: ownerRef,
    document: { draftId: id, contentBlocks: [], revision: 0, queueLocal: [] },
    toolset: ['terminal'],
    runtimeCapabilities: { runtimeVersion: 'fixture', control: {}, tools: { terminal: { available: true } }, observedAt: NOW },
  })
}

test('X2.1 IDs, WindowRef and schema validation are deterministic and fail closed', () => {
  const left = createIdMint('fixture')
  const right = createIdMint('fixture')
  assert.deepEqual(
    [left.pane(), left.split(), left.tab(), left.float(), left.window(), left.lease()],
    [right.pane(), right.split(), right.tab(), right.float(), right.window(), right.lease()],
  )
  assert.deepEqual(createWindowRef({ windowId: 'window-a', hostId: 'host-a' }), {
    windowId: 'window-a', hostId: 'host-a', host: 'internal',
  })
  assert.throws(() => createWindowRef({ windowId: '', hostId: 'host-a' }), ControlError)
  assert.throws(() => validateRect({ x: NaN, y: 0, w: 10, h: 10 }), ControlError)
  assert.throws(() => validateRect({ x: 0, y: 0, w: 0, h: 10 }), ControlError)
  assert.throws(() => createPane('pane-a', [tab('tab-a'), tab('tab-a')]), ControlError)
  assert.throws(() => createSplit('split-a', 'row', [createPane('pane-a')], [1]), ControlError)
})

test('X2.2 tab/split/float/minimize/group operations are pure and preserve content', () => {
  const initial = createWorkbenchLayout(createPane('pane-a'))
  const initialJson = JSON.stringify(initial)
  const tabA = tab('tab-a', 'files@1')
  const tabB = tab('tab-b', 'terminal@1')
  let layout = applyLayoutOp(initial, { kind: 'insertTab', paneId: 'pane-a', tab: tabA }).next
  layout = applyLayoutOp(layout, { kind: 'insertTab', paneId: 'pane-a', tab: tabB }).next
  layout = applyLayoutOp(layout, {
    kind: 'splitPane', paneId: 'pane-a', axis: 'row', at: 'after', newPaneId: 'pane-b', newSplitId: 'split-a', ratio: 0.4,
  }).next
  layout = applyLayoutOp(layout, { kind: 'moveTab', fromPaneId: 'pane-a', toPaneId: 'pane-b', tabId: 'tab-b', index: 0 }).next
  layout = applyLayoutOp(layout, {
    kind: 'floatTabs', paneId: 'pane-b', tabIds: ['tab-b'], floatId: 'float-a', rect: RECT, pin: 'workspace', workspaceId: 'workspace-a',
  }).next
  layout = applyLayoutOp(layout, { kind: 'minimizeFloat', floatId: 'float-a', x: 30, y: 40 }).next
  assert.equal(layout.floats[0].minimized, true)
  assert.deepEqual(layout.minimized[0], { floatId: 'float-a', x: 30, y: 40, host: 'internal' })
  layout = applyLayoutOp(layout, { kind: 'restoreFloat', floatId: 'float-a' }).next
  assert.equal(layout.floats[0].minimized, false)

  layout = applyLayoutOp(layout, { kind: 'insertTab', paneId: 'pane-b', tab: tab('tab-c', 'browser@1') }).next
  layout = applyLayoutOp(layout, {
    kind: 'floatTabs', paneId: 'pane-b', tabIds: ['tab-c'], floatId: 'float-b', rect: { ...RECT, x: 100 }, pin: 'application',
  }).next
  layout = applyLayoutOp(layout, { kind: 'groupFloats', floatIds: ['float-a', 'float-b'], groupId: 'group-a' }).next
  assert.equal(layout.floats.every((float) => float.groupId === 'group-a'), true)
  assert.equal(new Set(listTabs(layout).map((item) => item.id)).size, 3)
  assert.equal(JSON.stringify(initial), initialJson, 'reducer mutated its input')
  validateWorkbenchLayout(layout)
})

test('X2.3 normalize/compact are idempotent and undo/redo restores exact shape with monotonic revision', () => {
  const sizes = normalizeSizes([0, 2, 4])
  assert.equal(Math.abs(sizes.reduce((sum, value) => sum + value, 0) - 1) < 1e-12, true)
  assert.equal(sizes.every((value) => value > 0), true)

  let layout = createLayoutTemplate('split-row', { paneId: 'pane-a', secondPaneId: 'pane-b' })
  layout = applyLayoutOp(layout, { kind: 'insertTab', paneId: 'pane-a', tab: tab('tab-a') }).next
  const compacted = compactWorkbenchLayout(layout, 'pane-empty')
  assert.equal(compacted.root.kind, 'pane')
  assert.deepEqual(compactWorkbenchLayout(compacted, 'pane-empty'), compacted)

  let history = createLayoutHistory(createWorkbenchLayout(createPane('pane-a')))
  history = commitLayoutOp(history, { kind: 'insertTab', paneId: 'pane-a', tab: tab('tab-a') })
  history = commitLayoutOp(history, { kind: 'insertTab', paneId: 'pane-a', tab: tab('tab-b') })
  const beforeUndo = history.present
  const beforeUndoShape = JSON.stringify({ root: beforeUndo.root, floats: beforeUndo.floats, minimized: beforeUndo.minimized })
  history = undoLayout(history)
  assert.equal(history.present.revision > beforeUndo.revision, true)
  history = undoLayout(history)
  history = redoLayout(history)
  history = redoLayout(history)
  assert.equal(JSON.stringify({ root: history.present.root, floats: history.present.floats, minimized: history.present.minimized }), beforeUndoShape)
})

test('X2.4 five Pin levels project correctly across workspace and application scopes', () => {
  const pins = ['none', 'workspace', 'application', 'window', 'topmost']
  const floats = pins.map((pin, index) => createFloat({
    id: `float-${pin}`,
    rect: { ...RECT, x: index * 20 },
    pin,
    host: pin === 'window' || pin === 'topmost' ? 'native' : 'internal',
    workspaceId: pin === 'workspace' ? 'workspace-a' : undefined,
    tabs: [tab(`tab-${pin}`)],
  }))
  const layout = createWorkbenchLayout(createPane('pane-a'), floats)
  assert.deepEqual(selectPinnedFloats(layout, { workspaceId: 'workspace-a', scope: 'workspace' }).floats.map((item) => item.pin), ['none', 'workspace'])
  assert.deepEqual(selectPinnedFloats(layout, { workspaceId: 'workspace-b', scope: 'workspace' }).floats.map((item) => item.pin), ['none'])
  assert.deepEqual(selectPinnedFloats(layout, { workspaceId: 'workspace-b', scope: 'application' }).floats.map((item) => item.pin), ['application', 'window', 'topmost'])
})

test('X2.5/X2.6 drag threshold, live preview, pointer commit, cancel/blur and keyboard semantics', () => {
  const source = { hostId: 'host-a', windowId: 'window-a', content: { instanceId: 'files@1', kind: 'panel' } }
  const target = { hostId: 'host-a', paneId: 'pane-a', edge: 'right' }
  const attachment = createContentAttachment({
    documentKey: 'doc-files', attachToken: 'attach-1', value: '中文输入', selectionStart: 1, selectionEnd: 3, scrollTop: 12, imeComposition: true,
  })
  let drag = beginWorkbenchDrag({ source, start: { x: 0, y: 0 }, target, attachment })
  drag = moveWorkbenchDrag(drag, { x: DRAG_THRESHOLD_PX, y: 0 })
  assert.equal(drag.phase, 'pending')
  drag = moveWorkbenchDrag(drag, { x: DRAG_THRESHOLD_PX + 1, y: 0 })
  assert.equal(drag.phase, 'dragging')
  assert.equal(describeWorkbenchDragPreview(drag).kind, 'live-content')
  assert.deepEqual(describeWorkbenchDragPreview(drag).attachment, attachment)
  const committed = releaseWorkbenchDrag(drag)
  assert.equal(committed.phase, 'committed')
  assert.equal(committed.intent.mode, 'move')

  const cancelled = cancelWorkbenchDrag(drag, 'blur')
  assert.equal(cancelled.phase, 'cancelled')
  assert.equal(cancelled.intent, null)
  assert.deepEqual(cancelled.attachment, attachment)

  let keyboard = beginWorkbenchDrag({ source, start: { x: 0, y: 0 }, target, attachment })
  keyboard = keyboardWorkbenchDrag(keyboard, 'Enter')
  assert.equal(keyboard.phase, 'dragging')
  keyboard = keyboardWorkbenchDrag(keyboard, 'ArrowRight', { ...target, edge: 'center' })
  keyboard = keyboardWorkbenchDrag(keyboard, 'Enter')
  assert.equal(keyboard.phase, 'committed')

  const locked = beginWorkbenchDrag({ source, start: { x: 0, y: 0 }, target, attachment, locked: true })
  assert.throws(() => moveWorkbenchDrag(locked, { x: 20, y: 0 }), (error) => error.code === 'CONFLICT')
})

test('X2.7 attachment contract rejects rebuilt documents or lost IME/selection/scroll state', () => {
  const before = createContentAttachment({
    documentKey: 'doc-a', attachToken: 'token-a', value: 'hello', selectionStart: 2, selectionEnd: 4, scrollTop: 10, scrollLeft: 3,
  })
  assert.equal(assertContentAttachmentPreserved(before, { ...before }), true)
  assert.throws(() => assertContentAttachmentPreserved(before, { ...before, attachToken: 'token-b' }), (error) => error.code === 'CONFLICT')
  assert.throws(() => assertContentAttachmentPreserved(before, { ...before, selectionStart: 0 }), (error) => error.code === 'CONFLICT')
})

test('X2.8 cross-host drop rejects exclusive owner conflicts before commit', () => {
  const instance = createToolInstance({
    instanceId: 'terminal@1', toolId: 'terminal', owner: owner('session', 'session-a'), state: 'ready',
  })
  const lease = createSessionLease({
    leaseId: 'lease-a', instanceId: 'terminal@1', owner: owner('session', 'session-a'), hostId: 'host-a', windowId: 'window-a', acquiredAt: NOW,
  })
  const source = { hostId: 'host-a', windowId: 'window-a', content: { instanceId: 'terminal@1', kind: 'panel' } }
  const drag = beginWorkbenchDrag({
    source,
    start: { x: 0, y: 0 },
    target: { hostId: 'host-b', paneId: 'pane-b' },
    attachment: createContentAttachment({ documentKey: 'doc-terminal', attachToken: 'attach-terminal' }),
  })
  const dragging = moveWorkbenchDrag(drag, { x: 20, y: 0 })
  assert.throws(
    () => assertDropCommitAllowed(dragging, { hosts: [{ hostId: 'host-a' }, { hostId: 'host-b' }], toolInstances: [instance], leases: [lease] }),
    (error) => error.code === 'CONFLICT',
  )
})

test('X2.9 migration, revision conflict, atomic failure and backup recovery preserve layout', () => {
  const migrated = migrateWorkbenchSnapshot({
    version: 0,
    root: { kind: 'pane', id: 'pane-a', tabs: [] },
    floats: [],
    minimized: [],
  })
  assert.equal(migrated.layout.schemaVersion, 1)
  assert.deepEqual(migrated.migrations, ['legacy-unversioned-to-v1'])
  assert.throws(() => migrateWorkbenchSnapshot({ format: 'dsh-workbench-layout', version: 99 }), (error) => error.code === 'CORRUPT_RECORD')

  const io = memoryIo()
  const store = createWorkbenchLayoutStore({ io, filePath: 'layout.json', now: () => NOW })
  assert.equal(store.load().snapshot, null)
  const revision0 = createWorkbenchLayout(createPane('pane-a'))
  store.save(revision0, { expectedRevision: 0 })
  const revision1 = applyLayoutOp(revision0, { kind: 'insertTab', paneId: 'pane-a', tab: tab('tab-a') }).next
  store.save(revision1, { expectedRevision: 0 })
  assert.throws(() => store.save(revision1, { expectedRevision: 0 }), (error) => error.code === 'CONFLICT')

  const revision2 = applyLayoutOp(revision1, { kind: 'insertTab', paneId: 'pane-a', tab: tab('tab-b') }).next
  io.state.failAtomic = true
  assert.throws(() => store.save(revision2, { expectedRevision: 1 }), (error) => error.code === 'STORAGE_FAILED')
  assert.equal(store.snapshot().layout.revision, 1)
  assert.equal(JSON.parse(io.read('layout.json')).layout.revision, 1)
  io.state.failAtomic = false

  io.files.set('layout.json', '{truncated')
  const recovered = createWorkbenchLayoutStore({ io, filePath: 'layout.json', now: () => NOW })
  const report = recovered.load()
  assert.equal(report.recovered, true)
  assert.equal(report.snapshot.layout.revision, 1)
})

test('X2.10 geometry rejects invalid rects and restores negative-coordinate displays safely', () => {
  const displays = [
    { id: 'primary', workArea: { x: 0, y: 0, w: 1920, h: 1080 }, scaleFactor: 1 },
    { id: 'left', workArea: { x: -1600, y: -200, w: 1600, h: 900 }, scaleFactor: 1.5 },
  ]
  assert.throws(() => validateRect({ x: 0, y: 0, w: Number.POSITIVE_INFINITY, h: 10 }), ControlError)
  const exact = restoreWindowGeometry({ x: -1500, y: -100, w: 800, h: 600, displayId: 'left' }, displays)
  assert.equal(exact.displayId, 'left')
  assert.equal(exact.scaleFactor, 1.5)
  const missing = restoreWindowGeometry({ x: -1500, y: -100, w: 800, h: 600, displayId: 'removed' }, displays)
  assert.equal(missing.displayId, 'left')
  assert.equal(missing.reason, 'best-intersection')
  const invalid = restoreWindowGeometry({ x: NaN, y: 0, w: 800, h: 600, displayId: 'left' }, displays)
  assert.equal(invalid.displayId, 'primary')
  assert.equal(invalid.reason, 'invalid-rect')
  assert.equal(invalid.rect.x >= 0 && invalid.rect.y >= 0, true)
})

test('X2.11 workspace/tool/lease invariants and draft-to-session migration are atomic', () => {
  let registry = createWorkbenchRegistry()
  const ownerA = owner('session', 'session-a')
  registry = putConversationWorkspace(registry, workspace(ownerA))
  registry = putToolInstance(registry, createToolInstance({
    instanceId: 'terminal@1', toolId: 'terminal', owner: ownerA, state: 'ready',
  }))
  registry = acquireToolLease(registry, {
    leaseId: 'lease-a', instanceId: 'terminal@1', owner: ownerA, hostId: 'host-a', windowId: 'window-a', acquiredAt: NOW,
  })
  assert.equal(assertWorkbenchRegistryInvariants(registry), true)
  assert.throws(() => acquireToolLease(registry, {
    leaseId: 'lease-b', instanceId: 'terminal@1', owner: owner('session', 'session-b'), hostId: 'host-b', windowId: 'window-b', acquiredAt: NOW,
  }), (error) => error.code === 'CONFLICT')
  registry = releaseToolLease(registry, 'lease-a', NOW)
  registry = putConversationWorkspace(registry, workspace(owner('session', 'session-b')))
  registry = moveToolInstance(registry, {
    instanceId: 'terminal@1', toOwner: owner('session', 'session-b'), toHostId: 'host-b', toWindowId: 'window-b', mode: 'move', now: NOW,
  })
  assert.equal(registry.toolInstances['terminal@1'].owner.id, 'session-b')
  assert.equal(assertWorkbenchRegistryInvariants(registry), true)

  let drafts = createWorkbenchRegistry()
  drafts = putConversationWorkspace(drafts, workspace(owner('draft', 'draft-a')))
  drafts = putToolInstance(drafts, createToolInstance({
    instanceId: 'files@draft', toolId: 'files', owner: owner('draft', 'draft-a'), state: 'ready',
  }))
  drafts = bindDraftWorkspaceToSession(drafts, {
    draftId: 'draft-a', sessionId: 'session-new', hostId: 'host-a', windowId: 'window-a',
  })
  assert.equal(drafts.workspaces['draft:draft-a'], undefined)
  assert.equal(drafts.workspaces['session:session-new'].toolInstances[0].owner.id, 'session-new')
  assert.equal(drafts.toolInstances['files@draft'].owner.id, 'session-new')
  assert.equal(assertWorkbenchRegistryInvariants(drafts), true)
})

test('XB-03 property: 100 deterministic replays never duplicate or lose live content', () => {
  function replay() {
    const mint = createIdMint('replay')
    let layout = createWorkbenchLayout(createPane(mint.pane()))
    const paneId = layout.root.id
    for (let index = 0; index < 20; index += 1) {
      const id = mint.tab()
      layout = applyLayoutOp(layout, { kind: 'insertTab', paneId, tab: tab(id, `instance-${index}`) }).next
    }
    for (let index = 0; index < 10; index += 1) {
      const id = mint.tab()
      layout = applyLayoutOp(layout, {
        kind: 'splitPane', paneId, axis: index % 2 === 0 ? 'row' : 'column', at: 'after', newPaneId: mint.pane(), newSplitId: mint.split(), ratio: 0.5,
      }).next
      layout = applyLayoutOp(layout, { kind: 'insertTab', paneId, tab: tab(id, `split-instance-${index}`) }).next
    }
    validateWorkbenchLayout(layout)
    return { layout, ids: listTabs(layout).map((item) => item.id).sort() }
  }
  const first = replay()
  for (let index = 0; index < 100; index += 1) {
    const next = replay()
    assert.deepEqual(next, first)
  }
  assert.equal(first.ids.length, 30)
  assert.equal(new Set(first.ids).size, 30)
})
