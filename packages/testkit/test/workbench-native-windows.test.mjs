import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'
import { createNativeWindowTicketBroker } from '../../../apps/desktop/src/native-window-security.js'
import { createNativeWindowService, installNativeWindowIpc } from '../../../apps/desktop/src/native-window-service.js'
import { createNativeWindowFileStorage } from '../../../apps/desktop/src/native-window-file-storage.js'
import { decodeNativeWindowState, encodeNativeWindowState, restoreNativeGeometry } from '../../../apps/desktop/src/native-window-state.js'

const CONTENT_URL = 'file:///home/qtt19/projects/DSH-Studio/apps/desktop/src/native-content.html'
const DISPLAYS = [
  { id: 'primary', workArea: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
  { id: 'left', workArea: { x: -1600, y: -200, width: 1600, height: 900 }, scaleFactor: 1.5 },
]

function nativeEvent(contents, url = CONTENT_URL) {
  contents.mainFrame.url = url
  return { sender: contents, senderFrame: contents.mainFrame }
}

class FakeContents extends EventEmitter {
  constructor(id) {
    super()
    this.id = id
    this.url = ''
    this.destroyed = false
    this.loadCount = 0
    this.sent = []
    this.mainFrame = { url: CONTENT_URL }
    this.navigationHistory = { canGoBack: () => false, canGoForward: () => false }
  }
  isDestroyed() { return this.destroyed }
  loadURL(url) {
    this.loadCount += 1
    this.url = url
    this.mainFrame.url = url
    this.emit('did-finish-load')
    return Promise.resolve()
  }
  send(channel, payload) { this.sent.push({ channel, payload }) }
  setWindowOpenHandler(handler) { this.openHandler = handler }
  close() { this.destroyed = true; this.emit('destroyed') }
  closeDevTools() { this.devToolsClosed = true }
}

class FakeContentView extends EventEmitter {
  constructor() { super(); this.children = []; this.adds = 0; this.removes = 0 }
  addChildView(view) { this.adds += 1; if (!this.children.includes(view)) this.children.push(view) }
  removeChildView(view) { this.removes += 1; this.children = this.children.filter((item) => item !== view) }
}

class FakeView {
  constructor(options) { this.options = options; FakeView.instances.push(this); this.webContents = new FakeContents(FakeView.nextId++); this.bounds = null }
  setBounds(bounds) { this.bounds = { ...bounds } }
  setBackgroundColor(color) { this.background = color }
}
FakeView.nextId = 1
FakeView.instances = []

class FakeWindow extends EventEmitter {
  constructor(options) {
    super()
    FakeWindow.instances.push(this)
    this.options = options
    this.destroyed = false
    this.hidden = !options.show
    this.focused = false
    this.minimized = false
    this.maximized = false
    this.alwaysOnTop = false
    this.contentView = new FakeContentView()
    this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height }
    this.calls = []
  }
  isDestroyed() { return this.destroyed }
  getContentBounds() { return { x: 100, y: 50, width: 1000, height: 700 } }
  getBounds() { return { ...this.bounds } }
  getNormalBounds() { return { ...this.bounds } }
  setBounds(bounds) { this.bounds = { ...bounds }; this.emit('move'); this.emit('resize') }
  show() { this.hidden = false; this.calls.push('show') }
  hide() { this.hidden = true; this.calls.push('hide') }
  focus() { this.focused = true; this.calls.push('focus') }
  minimize() { this.minimized = true; this.emit('minimize') }
  maximize() { this.maximized = true; this.emit('maximize') }
  restore() { this.minimized = false; this.maximized = false; this.emit('restore') }
  setAlwaysOnTop(value) { this.alwaysOnTop = value }
  close() { this.destroyed = true; this.emit('closed') }
}
FakeWindow.instances = []

class FakeSession extends EventEmitter {
  constructor() { super(); this.permissionCheck = null; this.permissionRequest = null }
  setPermissionCheckHandler(handler) { this.permissionCheck = handler }
  setPermissionRequestHandler(handler) { this.permissionRequest = handler }
}

class FakeScreen extends EventEmitter {
  constructor(displays = DISPLAYS) { super(); this.displays = displays }
  getAllDisplays() { return this.displays }
  getDisplayMatchingRect(rect) {
    return this.displays.find((display) => rect.x >= display.workArea.x && rect.x < display.workArea.x + display.workArea.width)
      ?? this.displays[0]
  }
}

function fixture({ raw = null, displays = DISPLAYS, screenEvents = true, session = null } = {}) {
  const values = new Map(raw === null ? [] : [['state', raw]])
  const writes = []
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); writes.push(value) },
  }
  const screen = new FakeScreen(displays)
  if (!screenEvents) {
    screen.on = () => screen
    screen.removeListener = () => screen
  }
  let nextId = 1
  const service = createNativeWindowService({
    BrowserWindow: FakeWindow,
    WebContentsView: FakeView,
    screen,
    session,
    contentUrl: CONTENT_URL,
    preloadPath: '/narrow/preload.cjs',
    storage,
    storageKey: 'state',
    getMainWindow: () => mainWindow,
    id: () => `native-${nextId++}`,
    schedule: (callback) => { callback(); return 1 },
    now: () => Date.parse('2026-11-28T00:00:00.000Z'),
  })
  const mainWindow = new FakeWindow({ x: 100, y: 50, width: 1000, height: 700, show: true })
  return { service, storage, values, writes, screen, mainWindow }
}

function recordOf(service, id) {
  return service.list().find((item) => item.id === id)
}

test('X3.8 native tickets bind contents, main frame, exact URL, window and expire once', () => {
  let time = 1_000
  const broker = createNativeWindowTicketBroker({ contentUrl: CONTENT_URL, now: () => time, ttlMs: 100 })
  const contents = new FakeContents(10)
  const ticket = broker.issue('window-a', contents.id)
  assert.equal(broker.pendingCount(), 1)
  assert.throws(() => broker.consume({ ...nativeEvent(contents), senderFrame: {} }, 'window-a', ticket), (error) => error.code === 'INVALID_TICKET')
  assert.throws(() => broker.consume(nativeEvent(contents, `${CONTENT_URL}?untrusted=1`), 'window-a', ticket), (error) => error.code === 'INVALID_TICKET')
  assert.throws(() => broker.consume(nativeEvent(new FakeContents(99)), 'window-a', ticket), (error) => error.code === 'INVALID_TICKET')
  assert.throws(() => broker.consume(nativeEvent(contents), 'window-b', ticket), (error) => error.code === 'INVALID_TICKET')
  assert.equal(broker.consume(nativeEvent(contents), 'window-a', ticket).windowId, 'window-a')
  assert.throws(() => broker.consume(nativeEvent(contents), 'window-a', ticket), (error) => error.code === 'INVALID_TICKET')
  assert.equal(broker.requireClaimed(nativeEvent(contents), 'window-a').contentsId, 10)
  const second = new FakeContents(11)
  const expiring = broker.issue('window-b', second.id)
  time += 101
  assert.throws(() => broker.consume(nativeEvent(second), 'window-b', expiring), (error) => error.code === 'INVALID_TICKET')
  broker.revokeWindow('window-a')
  assert.throws(() => broker.requireClaimed(nativeEvent(contents), 'window-a'), (error) => error.code === 'UNCLAIMED_CONTENT')
})

test('X3.7/X3.9 creation uses a sandboxed narrow view and attach/detach never reloads content', async () => {
  const { service, mainWindow } = fixture()
  const state = await service.create({ title: 'Native host' })
  const nativeWindow = FakeWindow.instances.find((item) => item.options.title === 'Native host')
  assert.equal(state.title, 'Native host')
  const nativeView = FakeView.instances.at(-1)
  assert.equal(nativeView.options.webPreferences.preload, '/narrow/preload.cjs')
  assert.equal(nativeView.options.webPreferences.contextIsolation, true)
  assert.equal(nativeView.options.webPreferences.nodeIntegration, false)
  assert.equal(nativeView.options.webPreferences.sandbox, true)
  assert.equal(nativeWindow.options.webPreferences.preload, undefined)
  const ticketEvent = state
  assert.equal('ticket' in ticketEvent, false)
  assert.equal('webContents' in ticketEvent, false)
  assert.equal(service.broker.pendingCount(), 1)

  const contents = nativeWindow.contentView.children[0].webContents

  service.attach(state.id, { kind: 'main' }, { x: 260, y: 170, width: 640, height: 480 })
  assert.equal(mainWindow.contentView.children.length, 1)
  assert.equal(mainWindow.contentView.adds, 1)
  assert.deepEqual(mainWindow.contentView.children[0].bounds, { x: 160, y: 120, width: 640, height: 480 })
  service.attach(state.id, { kind: 'main' }, { x: 260, y: 170, width: 640, height: 480 })
  assert.equal(mainWindow.contentView.adds, 1, 'unchanged bounds must not detach/reattach')
  assert.equal(mainWindow.contentView.children[0].webContents, contents)

  const ticket = contents.sent.find((item) => item.channel === 'workbench:window:ticket').payload.ticket
  service.broker.consume(nativeEvent(contents), state.id, ticket)
  service.detach(state.id)
  assert.equal(mainWindow.contentView.children.length, 0)
  assert.equal(contents.loadCount, 1, 'detach must preserve the loaded page')
  assert.equal(service.broker.requireClaimed(nativeEvent(contents), state.id).contentsId, contents.id)
  service.attach(state.id, { kind: 'main' }, { x: 260, y: 170, width: 640, height: 480 })
  service.detachAllFromMain()
  assert.equal(service.get(state.id).attachedTo, null)
  assert.equal(mainWindow.contentView.children.length, 0)
  service.disposeAll()
})

test('X3.10 restores geometry/state and reclamps windows after a display is removed', async () => {
  const saved = {
    id: 'native-saved',
    title: 'Saved',
    geometry: { x: -5000, y: -4000, width: 700, height: 500, displayId: 'removed' },
    maximized: true,
    minimized: false,
    topmost: true,
    attachedTo: null,
  }
  const raw = encodeNativeWindowState([saved], '2026-11-28T00:00:00.000Z')
  const { service, screen } = fixture({ raw })
  await service.restore()
  const restored = service.get('native-saved')
  assert.equal(restored.geometry.displayId, 'primary')
  assert.ok(restored.geometry.x >= 0 && restored.geometry.y >= 0)
  assert.equal(restored.maximized, true)
  assert.equal(restored.topmost, true)
  assert.equal(service.list().length, 1)

  screen.displays = [{ id: 'only', workArea: { x: 0, y: 0, width: 1280, height: 720 }, scaleFactor: 1 }]
  service.watchDisplays()
  screen.emit('display-removed', {}, DISPLAYS[1])
  const visible = service.get('native-saved')
  assert.equal(visible.geometry.displayId, 'only')
  assert.ok(visible.geometry.x >= 0 && visible.geometry.y >= 0)
  assert.ok(visible.geometry.x + visible.geometry.width <= 1280)
  assert.ok(visible.geometry.y + visible.geometry.height <= 720)
  service.disposeAll()
})

test('X3.10 corrupt persisted state is visible and is never overwritten by a new window', async () => {
  const { service, writes, values } = fixture({ raw: '{truncated' })
  await assert.rejects(service.restore(), /corrupt|refusing/i)
  await assert.rejects(service.create(), /corrupt|refusing/i)
  service.flush()
  assert.equal(writes.length, 0)
  assert.equal(values.get('state'), '{truncated')
})

test('X3.10 native controls and close clean up views and persisted records', async () => {
  const { service, values } = fixture()
  const state = await service.create()
  service.minimize(state.id)
  service.maximize(state.id)
  service.restoreWindow(state.id)
  service.setTopmost(state.id, true)
  assert.equal(service.get(state.id).topmost, true)
  service.close(state.id)
  assert.deepEqual(service.list(), [])
  assert.deepEqual(decodeNativeWindowState(values.get('state')), [])
  const natural = await service.create({ title: 'Natural close' })
  FakeWindow.instances.find((item) => item.options.title === 'Natural close').close()
  assert.deepEqual(service.list(), [])
  assert.deepEqual(decodeNativeWindowState(values.get('state')), [])
})

test('X3.8 IPC keeps main commands privileged and native commands ticket-bound', async () => {
  const { service } = fixture()
  const handlers = new Map()
  const ipcMain = { handle: (name, handler) => handlers.set(name, handler), removeHandler: (name) => handlers.delete(name) }
  const trusted = { id: 1 }
  const cleanup = installNativeWindowIpc({ ipcMain, service, requireMainSender: (event) => { if (event !== trusted) throw new Error('denied') } })
  assert.throws(() => handlers.get('workbench:window:create')({}, {}), /denied/)
  const state = await handlers.get('workbench:window:create')(trusted, { title: 'IPC' })
  assert.throws(() => handlers.get('workbench:window:minimize')(nativeEvent(new FakeContents(999)), state.id), (error) => error.code === 'UNCLAIMED_CONTENT')
  const nativeWindow = FakeWindow.instances.find((item) => item.options.title === 'IPC')
  const contents = nativeWindow.contentView.children[0].webContents
  const ticket = contents.sent.find((item) => item.channel === 'workbench:window:ticket').payload.ticket
  service.broker.consume(nativeEvent(contents), state.id, ticket)
  assert.equal(handlers.get('workbench:window:minimize')(nativeEvent(contents), state.id).minimized, true)
  cleanup()
  assert.equal(handlers.size, 0)
  service.disposeAll()
})

test('XC-01 closing a native host restores attached content instead of orphaning it', async () => {
  const { service } = fixture()
  const host = await service.create({ title: 'Native parent' })
  const child = await service.create({ title: 'Native child' })
  service.attach(child.id, { kind: 'native', windowId: host.id }, { x: 120, y: 90, width: 500, height: 360 })
  assert.equal(service.get(child.id).attachedTo, host.id)
  service.close(host.id)
  assert.equal(service.get(child.id).attachedTo, null)
  assert.equal(FakeWindow.instances.find((item) => item.options.title === 'Native child').hidden, false)
  assert.deepEqual(service.list().map((item) => item.id), [child.id])
  service.disposeAll()
})

test('X3.8 native contents deny permissions, popups, downloads and untrusted navigation', async () => {
  const nativeSession = new FakeSession()
  const { service } = fixture({ session: nativeSession })
  await service.create()
  const contents = FakeView.instances.at(-1).webContents
  assert.equal(nativeSession.permissionCheck(), false)
  let requested
  nativeSession.permissionRequest(contents, 'camera', (value) => { requested = value })
  assert.equal(requested, false)
  assert.deepEqual(contents.openHandler({ url: 'https://example.com' }), { action: 'deny' })
  let downloadPrevented = false
  nativeSession.emit('will-download', { preventDefault: () => { downloadPrevented = true } })
  assert.equal(downloadPrevented, true)
  let navigationPrevented = false
  contents.emit('will-navigate', { url: 'https://example.com', isMainFrame: true, preventDefault: () => { navigationPrevented = true } })
  assert.equal(navigationPrevented, true)
  let webviewPrevented = false
  contents.emit('will-attach-webview', { preventDefault: () => { webviewPrevented = true } })
  assert.equal(webviewPrevented, true)
  const input = { type: 'keyDown', key: 'F12' }
  let devtoolsPrevented = false
  contents.emit('before-input-event', { preventDefault: () => { devtoolsPrevented = true } }, input)
  assert.equal(devtoolsPrevented, true)
  assert.equal(contents.devToolsClosed, true)
  service.disposeAll()
  assert.equal(nativeSession.permissionCheck, null)
  assert.equal(nativeSession.permissionRequest, null)
})

test('X3.7 narrow preload exposes only lifecycle methods, never Studio/Runtime/terminal/raw IPC', () => {
  const exposed = []
  const ipcRenderer = new EventEmitter()
  ipcRenderer.invoke = () => Promise.resolve({ windowId: 'native-a' })
  const context = {
    require: (name) => {
      assert.equal(name, 'electron')
      return {
        contextBridge: { exposeInMainWorld: (name, api) => exposed.push({ name, api }) },
        ipcRenderer,
      }
    },
    console,
    Promise,
    Set,
    Object,
    Error,
    TypeError,
  }
  vm.runInNewContext(readFileSync(new URL('../../../apps/desktop/src/native-content-preload.cjs', import.meta.url), 'utf8'), context)
  assert.equal(exposed.length, 1)
  assert.equal(exposed[0].name, 'dshNativeContent')
  assert.deepEqual(Object.keys(exposed[0].api).sort(), ['close', 'maximize', 'minimize', 'onReady', 'restore'])
  assert.equal(Object.isFrozen(exposed[0].api), true)
})

test('X3.10 file adapter replaces the snapshot atomically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-native-window-'))
  const file = join(dir, 'nested', 'state.json')
  try {
    const storage = createNativeWindowFileStorage(file)
    assert.equal(storage.getItem(), null)
    storage.setItem('state', 'first')
    assert.equal(readFileSync(file, 'utf8'), 'first')
    storage.setItem('state', 'second')
    assert.equal(storage.getItem(), 'second')
    writeFileSync(`${file}.tmp`, 'partial')
    storage.setItem('state', 'third')
    assert.equal(storage.getItem(), 'third')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('X3.10 geometry adapter rejects invalid rectangles and supports negative DIP coordinates', () => {
  assert.equal(restoreNativeGeometry({ x: -1500, y: -100, width: 800, height: 600, displayId: 'left' }, DISPLAYS).displayId, 'left')
  const fallback = restoreNativeGeometry({ x: Number.NaN, y: 0, width: 800, height: 600, displayId: 'left' }, DISPLAYS)
  assert.equal(fallback.displayId, 'primary')
  assert.ok(fallback.x >= 0 && fallback.y >= 0)
})
