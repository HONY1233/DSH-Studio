import { randomUUID } from 'node:crypto'
import { reduceWindowLifecycle } from '@dsh-studio/workbench-core'
import { isTrustedRendererUrl, readNavigationDetails, shouldBlockDevToolsInput } from './browser-security.js'
import { createNativeWindowTicketBroker } from './native-window-security.js'
import {
  decodeNativeWindowState,
  encodeNativeWindowState,
  normalizeNativeRect,
  normalizeNativeWindowState,
  restoreNativeGeometry,
} from './native-window-state.js'

function invalid(message = 'Invalid native window request') {
  const error = new Error(message)
  error.code = 'INVALID_ARGUMENT'
  return error
}

function missing(windowId) {
  const error = new Error(`Unknown native window: ${windowId}`)
  error.code = 'NOT_FOUND'
  return error
}

function publicState(record) {
  return {
    ...record.state,
    geometry: { ...record.state.geometry },
    destroyed: record.window.isDestroyed(),
  }
}

export function createNativeWindowService({
  BrowserWindow,
  WebContentsView,
  screen,
  session,
  contentUrl,
  preloadPath,
  storage,
  storageKey,
  getMainWindow = () => null,
  now = Date.now,
  schedule = (callback) => setTimeout(callback, 80),
  onChange = () => {},
  id = () => randomUUID(),
  devToolsEnabled = false,
} = {}) {
  if (typeof BrowserWindow !== 'function' || typeof WebContentsView !== 'function') throw new Error('Native window factories are required')
  if (typeof screen?.getAllDisplays !== 'function') throw new Error('screen.getAllDisplays is required')
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') throw new Error('Native window storage is required')
  if (typeof contentUrl !== 'string' || typeof preloadPath !== 'string') throw new Error('Native content configuration is required')

  const records = new Map()
  const transition = (record, op) => {
    const [state] = reduceWindowLifecycle([record.state], op)
    if (state) record.state = state
  }
  const broker = createNativeWindowTicketBroker({ contentUrl, now })
  let loaded = false
  let restoreError = null
  let persistError = null
  let pendingPersist = null
  let displayCleanup = null
  const rejectDownload = (event) => event.preventDefault()
  if (session?.on) session.on('will-download', rejectDownload)
  if (session?.setPermissionCheckHandler) session.setPermissionCheckHandler(() => false)
  if (session?.setPermissionRequestHandler) session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))

  const displays = () => screen.getAllDisplays()
  const emit = () => onChange([...records.values()].filter((record) => !record.window.isDestroyed()).map(publicState), persistError)

  const persistNow = () => {
    if (restoreError) return
    if (pendingPersist !== null) {
      clearTimeout(pendingPersist)
      pendingPersist = null
    }
    const windows = [...records.values()].filter((record) => !record.closing && !record.window.isDestroyed()).map((record) => record.state)
    try {
      storage.setItem(storageKey, encodeNativeWindowState(windows, new Date(now()).toISOString()))
      persistError = null
    } catch (error) {
      // Never discard a usable window because its optional state snapshot failed.
      persistError = error
      onChange([...records.values()].filter((record) => !record.window.isDestroyed()).map(publicState), error)
    }
    emit()
  }

  const schedulePersist = () => {
    if (pendingPersist !== null) clearTimeout(pendingPersist)
    pendingPersist = schedule(persistNow)
  }

  const removeAttachment = (record) => {
    const host = record.attachedTo
    if (record.hostCleanup) {
      record.hostCleanup()
      record.hostCleanup = null
    }
    if (host?.contentView && !host.isDestroyed()) host.contentView.removeChildView(record.view)
    record.attachedTo = null
  }

  const captureGeometry = (record) => {
    if (record.window.isDestroyed() || record.state.maximized || record.state.minimized) return
    const bounds = record.window.getNormalBounds()
    const normalized = normalizeNativeRect(bounds)
    if (!normalized) return
    const display = screen.getDisplayMatchingRect
      ? screen.getDisplayMatchingRect(normalized)
      : displays().find((item) => {
        const area = item.workArea
        return normalized.x < area.x + area.width && normalized.x + normalized.width > area.x
          && normalized.y < area.y + area.height && normalized.y + normalized.height > area.y
      })
    record.state = {
      ...record.state,
      geometry: { ...normalized, displayId: display?.id ?? record.state.geometry.displayId },
    }
  }

  const syncAttachedBounds = (record) => {
    if (!record.attachedTo || !record.attachedRect || record.view.webContents.isDestroyed()) return
    record.view.setBounds({ ...record.attachedRect })
  }

  const observeWindow = (record) => {
    const win = record.window
    const view = record.view
    const wc = view.webContents
    const listeners = []
    const listen = (emitter, name, listener) => {
      emitter.on(name, listener)
      listeners.push([emitter, name, listener])
    }
    const geometryChanged = () => {
      captureGeometry(record)
      syncAttachedBounds(record)
      if (!record.attachedTo && !win.isDestroyed()) view.setBounds({
        x: 0,
        y: 0,
        width: win.getContentBounds().width,
        height: win.getContentBounds().height,
      })
      schedulePersist()
    }
    listen(win, 'move', geometryChanged)
    listen(win, 'resize', geometryChanged)
    listen(win, 'maximize', () => {
      transition(record, { kind: 'maximize', id: record.state.id })
      schedulePersist()
    })
    listen(win, 'unmaximize', () => {
      transition(record, { kind: 'restore', id: record.state.id })
      captureGeometry(record)
      schedulePersist()
    })
    listen(win, 'minimize', () => {
      transition(record, { kind: 'minimize', id: record.state.id })
      schedulePersist()
    })
    listen(win, 'restore', () => {
      transition(record, { kind: 'restore', id: record.state.id })
      captureGeometry(record)
      schedulePersist()
    })
    listen(wc, 'did-finish-load', () => {
      if (record.closing || wc.isDestroyed()) return
      const ticket = broker.issue(record.state.id, wc.id)
      wc.send('workbench:window:ticket', { windowId: record.state.id, ticket })
    })
    listen(wc, 'will-navigate', (eventOrDetails, legacyUrl) => {
      const navigation = readNavigationDetails(eventOrDetails, legacyUrl, true)
      if (!isTrustedRendererUrl(navigation.url, contentUrl)) navigation.event?.preventDefault?.()
    })
    listen(wc, 'will-redirect', (eventOrDetails, legacyUrl) => {
      const navigation = readNavigationDetails(eventOrDetails, legacyUrl, true)
      if (!isTrustedRendererUrl(navigation.url, contentUrl)) navigation.event?.preventDefault?.()
    })
    listen(wc, 'will-frame-navigate', (eventOrDetails, legacyUrl, legacyIsMainFrame) => {
      const navigation = readNavigationDetails(eventOrDetails, legacyUrl, legacyIsMainFrame)
      if (!isTrustedRendererUrl(navigation.url, contentUrl)) navigation.event?.preventDefault?.()
    })
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    listen(wc, 'will-attach-webview', (event) => event.preventDefault())
    listen(wc, 'render-process-gone', () => {
      broker.revokeWindow(record.state.id)
      if (!win.isDestroyed()) win.close()
    })
    listen(wc, 'devtools-opened', () => {
      if (!devToolsEnabled) wc.closeDevTools()
    })
    listen(wc, 'before-input-event', (event, input) => {
      if (!shouldBlockDevToolsInput(input, devToolsEnabled)) return
      event.preventDefault()
      if (input.type === 'keyDown') wc.closeDevTools()
    })
    listen(win, 'closed', () => dispose(record.state.id))
    record.cleanup = () => {
      for (const [emitter, name, listener] of listeners) emitter.removeListener(name, listener)
      broker.revokeWindow(record.state.id)
    }
  }

  async function create(input = {}) {
    if (restoreError) throw restoreError
    if (records.size >= 128) throw invalid('Too many native windows')
    const title = typeof input?.title === 'string' && input.title.trim() ? input.title.trim().slice(0, 128) : 'DSH Native Content'
    const requested = normalizeNativeRect(input?.geometry)
    const geometry = requested
      ? restoreNativeGeometry(requested, displays())
      : restoreNativeGeometry({ x: 120, y: 100, width: 760, height: 560, displayId: null }, displays())
    const windowId = input?.id ?? id()
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(windowId) || records.has(windowId)) throw invalid('Invalid or duplicate native window id')
    const state = normalizeNativeWindowState({
      id: windowId,
      title,
      geometry,
      maximized: false,
      minimized: false,
      topmost: false,
      attachedTo: null,
    })
    if (!state) throw invalid('Invalid native window state')
    const win = new BrowserWindow({
      x: geometry.x,
      y: geometry.y,
      width: geometry.width,
      height: geometry.height,
      minWidth: 320,
      minHeight: 240,
      title,
      backgroundColor: '#0f1115',
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    const view = new WebContentsView({
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        session,
      },
    })
    view.setBackgroundColor('#0f1115')
    win.contentView.addChildView(view)
    view.setBounds({ x: 0, y: 0, width: geometry.width, height: geometry.height })
    const record = { state, window: win, view, attachedTo: null, attachedRect: null, closing: false, cleanup: null }
    records.set(windowId, record)
    observeWindow(record)
    try {
      await view.webContents.loadURL(contentUrl)
      if (record.closing || win.isDestroyed()) return null
      if (state.topmost) win.setAlwaysOnTop(true)
      if (state.minimized) win.minimize()
      else {
        win.show()
        win.focus()
      }
      schedulePersist()
      emit()
      return publicState(record)
    } catch (error) {
      dispose(windowId)
      throw error
    }
  }

  function dispose(windowId, { persist = true } = {}) {
    const record = records.get(windowId)
    if (!record) return false
    if (record.closing) return true
    record.closing = true
    removeAttachment(record)
    record.cleanup?.()
    record.cleanup = null
    const dependents = [...records.values()]
      .filter((item) => item.state.id !== windowId && item.state.attachedTo === windowId)
      .map((item) => item.state.id)
    const survivors = reduceWindowLifecycle([...records.values()].map((item) => item.state), { kind: 'close', id: windowId })
    for (const state of survivors) {
      const survivor = records.get(state.id)
      if (survivor) transition(survivor, { kind: 'put', window: state })
    }
    records.delete(windowId)
    for (const dependentId of dependents) detach(dependentId)
    if (!record.view.webContents.isDestroyed()) record.view.webContents.close({ waitForBeforeUnload: false })
    if (!record.window.isDestroyed()) record.window.close()
    if (persist) schedulePersist()
    return true
  }

  function requireRecord(windowId) {
    const record = records.get(windowId)
    if (!record || record.window.isDestroyed()) throw missing(windowId)
    return record
  }

  function control(windowId, action) {
    const record = requireRecord(windowId)
    if (!record.window.isDestroyed()) record.window[action]()
    emit()
    return publicState(record)
  }

  function attach(windowId, hostRef, rect) {
    const record = requireRecord(windowId)
    const bounds = normalizeNativeRect(rect)
    if (!bounds) throw invalid('Invalid content bounds')
    let host = null
    let attachedTo = null
    if (hostRef?.kind === 'main') {
      host = getMainWindow()
      attachedTo = 'main'
    } else if (hostRef?.kind === 'native' && typeof hostRef.windowId === 'string') {
      host = requireRecord(hostRef.windowId).window
      if (hostRef.windowId === windowId) throw invalid('A native window cannot host itself')
      attachedTo = hostRef.windowId
    } else {
      throw invalid('Invalid native content host')
    }
    if (!host || host.isDestroyed()) throw missing('host')
    const hostChanged = record.attachedTo !== host
    if (hostChanged) {
      removeAttachment(record)
      host.contentView.addChildView(record.view)
      record.attachedTo = host
      const sync = () => syncAttachedBounds(record)
      record.hostCleanup = () => host.removeListener('resize', sync)
      host.on('resize', sync)
    }
    transition(record, { kind: 'attach', id: windowId, attachedTo })
    const content = host.getContentBounds()
    const width = Math.min(bounds.width, Math.max(1, content.width))
    const height = Math.min(bounds.height, Math.max(1, content.height))
    const nextRect = {
      x: Math.round(Math.max(0, Math.min(bounds.x - content.x, content.width - width))),
      y: Math.round(Math.max(0, Math.min(bounds.y - content.y, content.height - height))),
      width,
      height,
    }
    const changed = !record.attachedRect || Object.keys(nextRect).some((key) => record.attachedRect[key] !== nextRect[key])
    record.attachedRect = nextRect
    if (changed) syncAttachedBounds(record)
    if (attachedTo === 'main' && !record.state.minimized) record.window.hide()
    else if (attachedTo !== 'main' && !record.state.minimized) {
      record.window.show()
      record.window.focus()
    }
    if (changed || hostChanged) schedulePersist()
    emit()
    return publicState(record)
  }

  function detach(windowId) {
    const record = requireRecord(windowId)
    removeAttachment(record)
    transition(record, { kind: 'detach', id: windowId })
    const size = record.window.getContentBounds()
    record.view.setBounds({ x: 0, y: 0, width: size.width, height: size.height })
    if (!record.state.minimized) record.window.show()
    schedulePersist()
    emit()
    return publicState(record)
  }

  async function restore() {
    if (loaded) return
    loaded = true
    let saved
    try {
      saved = decodeNativeWindowState(storage.getItem(storageKey))
    } catch (error) {
      restoreError = error
      throw error
    }
    for (const state of saved) {
      if (state.attachedTo !== null && state.attachedTo !== 'main' && !saved.some((item) => item.id === state.attachedTo)) {
        state.attachedTo = null
      }
      await create({ id: state.id, title: state.title, geometry: state.geometry })
      const record = records.get(state.id)
      if (!record) continue
      record.state = { ...record.state, maximized: state.maximized, minimized: state.minimized, topmost: state.topmost, attachedTo: state.attachedTo }
      if (state.topmost) record.window.setAlwaysOnTop(true)
      if (state.maximized) record.window.maximize()
      if (state.minimized) record.window.minimize()
      else record.window.show()
      if (state.attachedTo === 'main') attach(state.id, { kind: 'main' }, record.state.geometry)
    }
    persistNow()
    emit()
  }

  function ensureVisible(windowId) {
    const record = requireRecord(windowId)
    const geometry = restoreNativeGeometry(record.state.geometry, displays())
    record.state = { ...record.state, geometry }
    record.window.setBounds({ x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height })
    if (!record.attachedTo) {
      const content = record.window.getContentBounds()
      record.view.setBounds({ x: 0, y: 0, width: content.width, height: content.height })
    }
    schedulePersist()
    emit()
    return publicState(record)
  }

  return {
    broker,
    create,
    restore,
    list: () => [...records.values()].filter((record) => !record.window.isDestroyed()).map(publicState),
    get: (windowId) => publicState(requireRecord(windowId)),
    attach,
    detach,
    detachAllFromMain() {
      for (const record of records.values()) {
        if (record.state.attachedTo === 'main') detach(record.state.id)
      }
    },
    ensureVisible,
    bounds: (windowId, rect) => attach(windowId, { kind: 'main' }, rect),
    control,
    minimize: (windowId) => control(windowId, 'minimize'),
    maximize: (windowId) => control(windowId, 'maximize'),
    restoreWindow: (windowId) => control(windowId, 'restore'),
    focus: (windowId) => {
      const record = requireRecord(windowId)
      record.window.show()
      record.window.focus()
      return publicState(record)
    },
    close: (windowId) => dispose(windowId),
    setTopmost: (windowId, topmost) => {
      const record = requireRecord(windowId)
      if (typeof topmost !== 'boolean') throw invalid('topmost must be boolean')
      transition(record, { kind: 'setTopmost', id: windowId, topmost })
      record.window.setAlwaysOnTop(topmost)
      schedulePersist()
      emit()
      return publicState(record)
    },
    persistenceError: () => persistError,
    watchDisplays() {
      displayCleanup?.()
      displayCleanup = null
      if (typeof screen?.on !== 'function') return () => {}
      const changed = () => {
        for (const windowId of records.keys()) {
          try {
            ensureVisible(windowId)
          } catch {
            // A concurrently destroyed window is cleaned up by its closed event.
          }
        }
      }
      screen.on('display-metrics-changed', changed)
      screen.on('display-added', changed)
      screen.on('display-removed', changed)
      displayCleanup = () => {
        screen.removeListener('display-metrics-changed', changed)
        screen.removeListener('display-added', changed)
        screen.removeListener('display-removed', changed)
      }
      return () => {
        displayCleanup?.()
        displayCleanup = null
      }
    },
    flush: persistNow,
    disposeAll() {
      displayCleanup?.()
      displayCleanup = null
      for (const windowId of [...records.keys()]) dispose(windowId, { persist: false })
      if (pendingPersist !== null) clearTimeout(pendingPersist)
      pendingPersist = null
      session?.removeListener?.('will-download', rejectDownload)
      if (session && typeof session.setPermissionCheckHandler === 'function') session.setPermissionCheckHandler(null)
      if (session && typeof session.setPermissionRequestHandler === 'function') session.setPermissionRequestHandler(null)
      emit()
    },
  }
}

export function installNativeWindowIpc({ ipcMain, service, requireMainSender }) {
  const mainHandler = (name, handler) => ipcMain.handle(`workbench:window:${name}`, (event, ...args) => {
    requireMainSender(event)
    return handler(event, ...args)
  })
  const contentHandler = (name, handler) => ipcMain.handle(`workbench:window:${name}`, (event, ...args) => {
    service.broker.requireClaimed(event, args[0])
    return handler(...args)
  })

  mainHandler('create', (_event, input) => service.create(input))
  mainHandler('list', () => service.list())
  mainHandler('attach', (_event, windowId, host, rect) => service.attach(windowId, host, rect))
  mainHandler('detach', (_event, windowId) => service.detach(windowId))
  mainHandler('bounds', (_event, windowId, rect) => service.bounds(windowId, rect))
  mainHandler('focus', (_event, windowId) => service.focus(windowId))
  mainHandler('topmost', (_event, windowId, value) => service.setTopmost(windowId, value))
  ipcMain.handle('workbench:window:close-main', (event, windowId) => {
    requireMainSender(event)
    return service.close(windowId)
  })
  for (const [channel, action] of [['minimize', 'minimize'], ['maximize', 'maximize'], ['restore', 'restoreWindow']]) {
    ipcMain.handle(`workbench:window:${channel}-main`, (event, windowId) => {
      requireMainSender(event)
      return service[action](windowId)
    })
  }

  ipcMain.handle('workbench:window:claim', (event, windowId, ticket) => service.broker.consume(event, windowId, ticket))
  contentHandler('minimize', (windowId) => service.minimize(windowId))
  contentHandler('maximize', (windowId) => service.maximize(windowId))
  contentHandler('restore', (windowId) => service.restoreWindow(windowId))
  contentHandler('close', (windowId) => service.close(windowId))

  return () => {
    for (const name of ['create', 'list', 'attach', 'detach', 'bounds', 'focus', 'topmost', 'close-main', 'minimize-main', 'maximize-main', 'restore-main', 'claim', 'minimize', 'maximize', 'restore', 'close']) {
      ipcMain.removeHandler(`workbench:window:${name}`)
    }
  }
}
