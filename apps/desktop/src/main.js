import { app, BrowserWindow, Menu, WebContentsView, dialog, ipcMain, screen, session, shell, webContents } from 'electron'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import * as nodePty from 'node-pty'
import { RuntimeClient } from '@dsh-studio/runtime-client'
import { gitChanges, gitDiff, listDirectory, listSessions, readSessionEvents, readTextFile } from '@dsh-studio/host-services'
import { createStudioBridge } from './studio-bridge.js'
import { createFileDraftStore } from './draft-store.js'
import { createTerminalService } from './terminal-service.js'
import { createNativeWindowService, installNativeWindowIpc } from './native-window-service.js'
import { createNativeWindowFileStorage } from './native-window-file-storage.js'
import {
  browserPartitionForWorkspace,
  createExternalUrlHandler,
  createExternalUrlIpcHandler,
  createMainIpcGuard,
  createPermissionGuards,
  isAllowedFrameNavigation,
  isTrustedRendererUrl,
  normalizeBrowserBounds,
  normalizeBrowserUrl,
  readNavigationDetails,
  resolveTrustedRendererUrl,
  shouldBlockDevToolsInput,
} from './browser-security.js'

const spawnPty = nodePty.spawn ?? nodePty.default?.spawn

const here = dirname(fileURLToPath(import.meta.url))
// 没有显式指定渲染层地址时优先加载构建产物：桌面快捷方式不需要先起 dev server。
// 这样双击快捷方式 = 直接打开 Studio；开发时仍可用 DSH_RENDERER_URL 指向 Vite。
const distIndex = resolve(here, '../../renderer-omp/dist/index.html')
const distHref = existsSync(distIndex) ? pathToFileURL(distIndex).href : undefined
const rendererUrl = resolveTrustedRendererUrl(process.env.DSH_RENDERER_URL, distHref, {
  allowDevelopmentFallback: !app.isPackaged,
})
const devToolsEnabled = !app.isPackaged || process.env.DSH_DEVTOOLS === '1'

let sessionSeq = 0
const sessionIds = []
function createSessionId() {
  const id = `desktop-${Date.now().toString(36)}-${++sessionSeq}`
  sessionIds.push(id)
  return id
}
createSessionId()

const runtime = new RuntimeClient({
  recordPath: process.env.DSH_RECORD_FRAMES === '1'
    ? (process.env.DSH_RECORD_PATH ?? resolve(here, '../../../logs/desktop-frames.jsonl'))
    : null,
  cwd: process.env.DSH_CWD ?? '/mnt/f/projects/dsh-studio',
  provider: process.env.DSH_PROVIDER ?? 'deepseek-official',
  model: process.env.DSH_MODEL ?? 'deepseek-flash',
})

let mainWindow = null
let serverInfo = null
let nativeWindows = null
let removeNativeWindowIpc = null
let nativeWindowStartupError = null
const nativeContentUrl = pathToFileURL(resolve(here, 'native-content.html')).href
const nativeWindowStorageKey = 'dsh.studio.native-windows.v1'

function broadcastNativeWindows(windows, error = nativeWindowStartupError) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('workbench:windows:state', {
    windows,
    error: error ? (error instanceof Error ? error.message : String(error)) : null,
  })
}

// OMP-contract bridge consumed by the forked renderer (`apps/renderer-omp`).
// `host` 里放需要 electron 能力（文件管理器、目录选择、回收站）的回调，
// 桥本身仍然不 import electron，测试可以直接构造桥。
const studioBridge = createStudioBridge({
  runtime,
  cwd: runtime.options.cwd,
  emit: (event) => broadcast('studio:event', event),
  host: {
    draftStore: createFileDraftStore(resolve(app.getPath('userData'), 'studio-drafts.json')),
    showItem: (target) => shell.showItemInFolder(target),
    openPath: async (target) => {
      const error = await shell.openPath(target)
      if (error) throw new Error(error)
    },
    pickDirectory: async () => {
      const options = { title: '选择工作区文件夹', properties: ['openDirectory', 'createDirectory'] }
      const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options)
      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
    trash: (targets) => Promise.all(targets.map((target) => shell.trashItem(target))),
  },
})

function broadcast(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function isMainSender(event) {
  return Boolean(
    mainWindow
    && !mainWindow.isDestroyed()
    && event?.sender === mainWindow.webContents
    && event?.senderFrame === mainWindow.webContents.mainFrame
    && isTrustedRendererUrl(event.senderFrame.url, rendererUrl),
  )
}

const requireMainSender = createMainIpcGuard(isMainSender)

ipcMain.handle('shell:open-external', createExternalUrlIpcHandler(
  requireMainSender,
  (url) => shell.openExternal(url),
))

runtime.on('state', ({ state, detail }) => broadcast('runtime:state', { state, detail }))
// 运行时状态变化同步给 OMP 契约桥（连接状态、重连都由它转成 runtime.changed）。
runtime.on('state', () => studioBridge.notifyRuntime())
runtime.on('stderr', (line) => broadcast('runtime:stderr', line))
runtime.on('notification', ({ method, params }) => {
  // Every session the runtime knows is forwarded; the renderer owns which tabs exist.
  broadcast('runtime:notification', { method, params })
  if (method === 'session.event') studioBridge.onSessionEvent(params)
  if (method === 'session.status') studioBridge.onStatus(params)
  if (method === 'subagent.started') studioBridge.onSubagentStarted(params)
  if (method === 'subagent.finished') studioBridge.onSubagentFinished(params)
})
runtime.on('request', ({ requestId, method, params, expiresAt }) => {
  if (method === 'approval/request') {
    // The OMP-contract bridge routes this only to contexts that own the session.
    studioBridge.onApprovalRequest({ requestId, params, respond: (result) => runtime.respondRequest(requestId, result) })
  }
  // The native renderer keeps multiple sessions in one trusted main frame and
  // displays only the active session's request.
  broadcast('runtime:request', { requestId, method, params, expiresAt })
})
runtime.on('request-settled', (event) => {
  addLog('info', 'approval', `${event.requestId} ${event.reason}`)
  studioBridge.onRequestSettled(event)
  broadcast('runtime:request-settled', event)
})

// ---- 日志：把 wire 帧 / stderr / 状态变化收进环形缓冲，供日志面板查看 ----

const LOG_LIMIT = 2000
const logEntries = []
let logSeq = 0

function compact(value, max = 320) {
  if (value === undefined) return ''
  let text
  try {
    text = JSON.stringify(value)
  } catch {
    text = String(value)
  }
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function summarizeFrame(dir, frame) {
  if (frame.method && frame.id !== undefined) return `? ${frame.method} ${compact(frame.params)}`
  if (frame.method) {
    if (frame.method === 'session.event') {
      const type = frame.params?.event?.type ?? 'event'
      return `• ${frame.method} ${type}`
    }
    return `• ${frame.method} ${compact(frame.params)}`
  }
  if (frame.error) return `! ${frame.id ?? ''} ${frame.error.message} ${compact(frame.error.data)}`
  return `← ${frame.id ?? ''} ${compact(frame.result)}`
}

function addLog(level, source, text) {
  const entry = { id: ++logSeq, ts: Date.now(), level, source, text }
  logEntries.push(entry)
  if (logEntries.length > LOG_LIMIT) logEntries.shift()
  broadcast('logs:append', entry)
}

runtime.on('frame', ({ dir, frame }) => {
  const failed = Boolean(frame?.error)
  addLog(failed ? 'error' : 'info', dir === 'out' ? 'send' : 'recv', summarizeFrame(dir, frame))
})
runtime.on('stderr', (line) => addLog(/\berror\b/i.test(line) ? 'error' : 'warn', 'stderr', line))
runtime.on('state', ({ state, detail }) => {
  addLog(state === 'failed' || state === 'exited' ? 'error' : 'info', 'state', `${state}${detail ? ` · ${detail}` : ''}`)
})

ipcMain.handle('logs:tail', (event) => {
  requireMainSender(event)
  return logEntries.slice(-800)
})

ipcMain.handle('logs:clear', (event) => {
  requireMainSender(event)
  logEntries.length = 0
  return true
})

ipcMain.handle('runtime:info', (event) => {
  requireMainSender(event)
  return {
    sessionId: sessionIds[0],
    sessionIds: [...sessionIds],
    state: runtime.state,
    serverInfo,
    cwd: runtime.options.cwd,
    provider: runtime.options.provider,
    model: runtime.options.model,
  }
})

ipcMain.handle('runtime:create-session', (event) => {
  requireMainSender(event)
  return { sessionId: createSessionId() }
})

ipcMain.handle('sessions:list', (event) => {
  requireMainSender(event)
  return listSessions()
})

ipcMain.handle('files:list', (event, relativePath) => {
  requireMainSender(event)
  return listDirectory(runtime.options.cwd, relativePath)
})

ipcMain.handle('files:read', (event, relativePath) => {
  requireMainSender(event)
  return readTextFile(runtime.options.cwd, relativePath)
})

ipcMain.handle('git:changes', (event) => {
  requireMainSender(event)
  return gitChanges(runtime.options.cwd)
})

ipcMain.handle('git:diff', (event, path, staged) => {
  requireMainSender(event)
  return gitDiff(runtime.options.cwd, path, staged)
})

ipcMain.handle('sessions:open', async (event, sessionId) => {
  requireMainSender(event)
  if (!sessionIds.includes(sessionId)) {
    await runtime.resume(sessionId)
    sessionIds.push(sessionId)
  }
  return { sessionId, events: await readSessionEvents(sessionId) }
})

ipcMain.handle('runtime:query', async (event, sessionId, text) => {
  requireMainSender(event)
  if (!sessionIds.includes(sessionId)) throw new Error(`unknown session: ${sessionId}`)
  return runtime.query(sessionId, text)
})

// ---- 终端（PTY）：每个窗口一个 WSL 登录 shell ----

const TERMINAL = {
  distro: process.env.DSH_TERMINAL_DISTRO ?? 'Ubuntu',
  user: process.env.DSH_TERMINAL_USER ?? 'qtt199',
  // 用 Windows 路径作 spawn cwd，wsl.exe 会把它映射成 /mnt/f/...
  cwd: process.env.DSH_TERMINAL_CWD ?? resolve(here, '../../..'),
}
const TERMINAL_SCROLLBACK_LIMIT = 64 * 1024
const OMP_TERMINAL_MAX_SESSIONS = 8

function sendTerminal(ownerId, channel, payload) {
  const target = webContents.fromId(ownerId)
  if (target && !target.isDestroyed()) target.send(channel, payload)
}

const terminalService = createTerminalService({
  spawn: spawnPty,
  distro: TERMINAL.distro,
  user: TERMINAL.user,
  cwd: TERMINAL.cwd,
  maxSessions: OMP_TERMINAL_MAX_SESSIONS,
  scrollbackLimit: TERMINAL_SCROLLBACK_LIMIT,
  onData: (entry, data) => {
    sendTerminal(entry.ownerId, 'terminal:data', data)
    sendTerminal(entry.ownerId, OMP_TERMINAL.data, { id: entry.id, data, bytes: Buffer.byteLength(data, 'utf8') })
  },
  onExit: (entry, event) => {
    sendTerminal(entry.ownerId, 'terminal:exit', { exitCode: event?.exitCode ?? 0 })
    sendTerminal(entry.ownerId, OMP_TERMINAL.exit, { id: entry.id })
  },
})

function terminalInfo(entry) {
  return {
    alive: Boolean(entry?.term),
    pid: entry?.pid ?? null,
    scrollback: entry?.buffer ?? '',
    ...TERMINAL,
  }
}

ipcMain.handle('terminal:start', (event) => {
  requireMainSender(event)
  const entry = terminalService.createNative(event.sender.id)
  return terminalInfo(entry)
})

ipcMain.handle('terminal:write', (event, data) => {
  requireMainSender(event)
  return terminalService.write(`native-${event.sender.id}`, event.sender.id, data)
})

ipcMain.handle('terminal:resize', (event, cols, rows) => {
  requireMainSender(event)
  return terminalService.resize(`native-${event.sender.id}`, event.sender.id, cols, rows)
})

ipcMain.handle('terminal:kill', (event) => {
  requireMainSender(event)
  return terminalService.dispose(`native-${event.sender.id}`, event.sender.id)
})

// ---- OMP 终端契约（多会话）：forked renderer 的 TerminalPane 走这套通道 ----
// 形状对齐 apps/desktop/src/terminal-shared.ts 的 OmpStudioTerminalApi；
// 只实现 create/write/resize/dispose 与 data/exit 两个事件，不实现录制与 tmux。

const OMP_TERMINAL = {
  create: 'omp-studio:desktop:terminal-create',
  write: 'omp-studio:desktop:terminal-write',
  resize: 'omp-studio:desktop:terminal-resize',
  dispose: 'omp-studio:desktop:terminal-dispose',
  data: 'omp-studio:desktop:terminal-data',
  exit: 'omp-studio:desktop:terminal-exit',
}

function parseOmpTerminalId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(value)) throw new Error('invalid terminal id')
  return value
}

function clampSize(value, fallback, min, max) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) return fallback
  return value
}

ipcMain.handle(OMP_TERMINAL.create, (event, input = {}) => {
  requireMainSender(event)
  const cols = clampSize(input.cols, 80, 2, 500)
  const rows = clampSize(input.rows, 24, 1, 200)
  const script = typeof input.command?.text === 'string' ? input.command.text : null
  const entry = terminalService.create({ ownerId: event.sender.id, kind: 'omp', cols, rows, script })
  return { id: entry.id, name: entry.metadata.name, cwd: entry.metadata.cwd }
})

ipcMain.handle(OMP_TERMINAL.write, (event, id, data) => {
  requireMainSender(event)
  return terminalService.write(parseOmpTerminalId(id), event.sender.id, data)
})

ipcMain.handle(OMP_TERMINAL.resize, (event, id, cols, rows) => {
  requireMainSender(event)
  return terminalService.resize(parseOmpTerminalId(id), event.sender.id, cols, rows)
})

ipcMain.handle(OMP_TERMINAL.dispose, (event, id) => {
  requireMainSender(event)
  return terminalService.dispose(parseOmpTerminalId(id), event.sender.id)
})

// ---- 浏览器面板：WebContentsView 叠在渲染层预留的区域上 ----

let browserView = null
let browserAttached = false
let browserBounds = null
let browserCleanup = null

function browserState() {
  const wc = browserView?.webContents
  const destroyed = !wc || wc.isDestroyed()
  return {
    attached: browserAttached,
    url: destroyed ? '' : wc.getURL(),
    title: destroyed ? '' : wc.getTitle(),
    loading: destroyed ? false : wc.isLoading(),
    canGoBack: destroyed ? false : wc.navigationHistory.canGoBack(),
    canGoForward: destroyed ? false : wc.navigationHistory.canGoForward(),
    bounds: browserBounds,
  }
}

function broadcastBrowserState() {
  broadcast('browser:state', browserState())
}

function disposeBrowserView() {
  const view = browserView
  if (!view) return
  if (browserAttached && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.contentView.removeChildView(view)
  }
  browserAttached = false
  browserCleanup?.()
  browserCleanup = null
  const wc = view.webContents
  if (!wc.isDestroyed()) wc.close({ waitForBeforeUnload: false })
  if (browserView === view) browserView = null
  browserBounds = null
}

function ensureBrowserView() {
  if (browserView && !browserView.webContents.isDestroyed()) return browserView
  if (browserView) disposeBrowserView()
  const partition = browserPartitionForWorkspace(sessionIds[0], false)
  const isolatedSession = session.fromPartition(partition)
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      session: isolatedSession,
    },
  })
  browserView = view
  view.setBackgroundColor('#12151b')
  const wc = view.webContents
  const listeners = []
  const listen = (name, listener) => {
    wc.on(name, listener)
    listeners.push([name, listener])
  }
  const rejectNavigation = (event, url, isMainFrame = true) => {
    if (isAllowedFrameNavigation(url, wc.getURL(), isMainFrame)) return
    event.preventDefault()
  }
  const permissionGuards = createPermissionGuards()
  const rejectDownload = (event) => {
    event.preventDefault()
  }
  isolatedSession.setPermissionCheckHandler(permissionGuards.check)
  isolatedSession.setPermissionRequestHandler(permissionGuards.request)
  isolatedSession.on('will-download', rejectDownload)
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  listen('will-navigate', (eventOrDetails, legacyUrl) => {
    const navigation = readNavigationDetails(eventOrDetails, legacyUrl, true)
    rejectNavigation(navigation.event, navigation.url, navigation.isMainFrame)
  })
  listen('will-frame-navigate', (eventOrDetails, legacyUrl, legacyIsMainFrame) => {
    const navigation = readNavigationDetails(eventOrDetails, legacyUrl, legacyIsMainFrame)
    rejectNavigation(navigation.event, navigation.url, navigation.isMainFrame)
  })
  listen('will-redirect', (eventOrDetails, legacyUrl, _legacyIsInPlace, legacyIsMainFrame) => {
    const navigation = readNavigationDetails(eventOrDetails, legacyUrl, legacyIsMainFrame)
    rejectNavigation(navigation.event, navigation.url, navigation.isMainFrame)
  })
  listen('will-attach-webview', (event) => event.preventDefault())
  listen('devtools-opened', () => {
    if (!devToolsEnabled) wc.closeDevTools()
  })
  listen('before-input-event', (event, input) => {
    if (!shouldBlockDevToolsInput(input, devToolsEnabled)) return
    event.preventDefault()
    if (input.type === 'keyDown') wc.closeDevTools()
  })
  for (const event of ['did-navigate', 'did-navigate-in-page', 'page-title-updated', 'did-start-loading', 'did-stop-loading']) {
    listen(event, broadcastBrowserState)
  }
  listen('render-process-gone', () => disposeBrowserView())
  listen('destroyed', () => {
    if (browserView !== view) return
    for (const [name, listener] of listeners) wc.removeListener(name, listener)
    isolatedSession.removeListener('will-download', rejectDownload)
    isolatedSession.setPermissionCheckHandler(null)
    isolatedSession.setPermissionRequestHandler(null)
    browserCleanup = null
    browserView = null
    browserAttached = false
    browserBounds = null
  })
  browserCleanup = () => {
    for (const [name, listener] of listeners) wc.removeListener(name, listener)
    isolatedSession.removeListener('will-download', rejectDownload)
    isolatedSession.setPermissionCheckHandler(null)
    isolatedSession.setPermissionRequestHandler(null)
  }
  return view
}

function applyBrowserBounds(rect) {
  const bounds = normalizeBrowserBounds(rect)
  if (!bounds || !browserView || !mainWindow || mainWindow.isDestroyed()) return false
  browserBounds = bounds
  browserView.setBounds(browserBounds)
  return true
}

ipcMain.handle('browser:show', (event, rect) => {
  requireMainSender(event)
  if (!normalizeBrowserBounds(rect)) throw new Error('invalid browser bounds')
  const view = ensureBrowserView()
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (!browserAttached) {
      mainWindow.contentView.addChildView(view)
      browserAttached = true
    }
    applyBrowserBounds(rect)
    const wc = view.webContents
    if (!wc.getURL()) wc.loadURL('https://example.com')
  }
  return browserState()
})

ipcMain.handle('browser:bounds', (event, rect) => {
  requireMainSender(event)
  if (!applyBrowserBounds(rect)) throw new Error('invalid browser bounds')
  return browserState()
})

ipcMain.handle('browser:hide', (event) => {
  requireMainSender(event)
  if (browserView && browserAttached && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.contentView.removeChildView(browserView)
    browserAttached = false
  }
  return browserState()
})

ipcMain.handle('browser:navigate', async (event, raw) => {
  requireMainSender(event)
  const normalized = normalizeBrowserUrl(raw)
  if (!normalized.ok) throw new Error(normalized.reason)
  await ensureBrowserView().webContents.loadURL(normalized.url)
  return browserState()
})

ipcMain.handle('browser:back', (event) => {
  requireMainSender(event)
  const wc = browserView?.webContents
  if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
  return browserState()
})

ipcMain.handle('browser:forward', (event) => {
  requireMainSender(event)
  const wc = browserView?.webContents
  if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
  return browserState()
})

ipcMain.handle('browser:reload', (event) => {
  requireMainSender(event)
  browserView?.webContents.reload()
  return browserState()
})

ipcMain.handle('browser:state', (event) => {
  requireMainSender(event)
  return browserState()
})

ipcMain.handle('runtime:respond-request', (event, requestId, result) => {
  requireMainSender(event)
  return runtime.respondRequest(requestId, result)
})

// ---- OMP contract bridge：供移植后的 omp-studio 渲染层使用 ----

// 每个对话窗口一个上下文：openContext 返回的 contextId 用于隔离“当前会话”。
ipcMain.handle('studio:open-context', (event, scope) => {
  requireMainSender(event)
  return studioBridge.openContext(scope)
})

ipcMain.handle('studio:bootstrap', (event, contextId) => {
  requireMainSender(event)
  return studioBridge.bootstrap(contextId)
})

ipcMain.handle('studio:query', async (event, request, contextId) => {
  requireMainSender(event)
  try {
    return { ok: true, queryName: request.queryName, result: await studioBridge.query(request.queryName, request.input, contextId) }
  } catch (error) {
    return { ok: false, queryName: request.queryName, error: { code: error.code ?? 'INTERNAL', message: error.message ?? String(error) } }
  }
})

ipcMain.handle('studio:command', (event, request, contextId) => {
  requireMainSender(event)
  return studioBridge.command(request, contextId)
})

ipcMain.handle('studio:close', (event, contextId) => {
  requireMainSender(event)
  return studioBridge.closeContext(contextId)
})

// ---- 原生壳：全中文菜单（默认隐藏，Alt 唤出）----

function installMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        ...(devToolsEnabled ? [{ label: '开发者工具', accelerator: 'F12', role: 'toggleDevTools' }] : []),
        { type: 'separator' },
        { label: '退出', role: 'quit' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '全选', role: 'selectAll' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '实际大小', role: 'resetZoom' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { type: 'separator' },
        { label: '全屏', role: 'togglefullscreen' },
        {
          label: '显示/隐藏菜单栏',
          accelerator: 'Alt+M',
          click: (_item, win) => {
            if (win) win.setMenuBarVisibility(!win.isMenuBarVisible())
          },
        },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '关于 DSH Studio', click: () => app.showAboutPanel() },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f1115',
    title: 'DSH Studio',
    // 壳菜单默认隐藏（Alt 可临时唤出），Windows 上不再常驻一行英文菜单。
    autoHideMenuBar: process.env.DSH_SHOW_MENU !== '1',
    webPreferences: {
      preload: resolve(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  const wc = mainWindow.webContents
  wc.setWindowOpenHandler(createExternalUrlHandler(
    (url) => shell.openExternal(url),
    (error) => console.error('[studio] external URL open failed:', error),
  ))
  wc.on('will-navigate', (eventOrDetails, legacyUrl) => {
    const navigation = readNavigationDetails(eventOrDetails, legacyUrl, true)
    if (!isTrustedRendererUrl(navigation.url, rendererUrl)) navigation.event.preventDefault()
  })
  wc.on('will-redirect', (eventOrDetails, legacyUrl, _legacyIsInPlace, legacyIsMainFrame) => {
    const navigation = readNavigationDetails(eventOrDetails, legacyUrl, legacyIsMainFrame)
    if (!isTrustedRendererUrl(navigation.url, rendererUrl)) navigation.event.preventDefault()
  })
  wc.on('will-frame-navigate', (eventOrDetails, legacyUrl, legacyIsMainFrame) => {
    const navigation = readNavigationDetails(eventOrDetails, legacyUrl, legacyIsMainFrame)
    if (navigation.isMainFrame) {
      if (!isTrustedRendererUrl(navigation.url, rendererUrl)) navigation.event.preventDefault()
    } else if (!isAllowedFrameNavigation(navigation.url, wc.getURL(), false)) {
      navigation.event.preventDefault()
    }
  })
  wc.on('devtools-opened', () => {
    if (!devToolsEnabled) wc.closeDevTools()
  })
  wc.on('before-input-event', (event, input) => {
    if (!shouldBlockDevToolsInput(input, devToolsEnabled)) return
    event.preventDefault()
    if (input.type === 'keyDown') wc.closeDevTools()
  })
  await mainWindow.loadURL(rendererUrl)
  const ownerId = mainWindow.webContents.id
  // 窗口意外消失时留下线索（file:// 模式排障用）。
  mainWindow.on('closed', () => console.log('[studio] main window closed'))
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.log(`[studio] renderer gone: ${details.reason} (${details.exitCode})`)
    terminalService.disposeOwner(ownerId)
  })
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.log(`[studio] load failed: ${code} ${description} ${url}`)
  })
  if (process.env.DSH_SHOW_MENU !== '1') {
    // Windows 上 autoHideMenuBar 只在部分场景生效，显式隐藏一次；按 Alt 可临时唤出。
    mainWindow.setAutoHideMenuBar(true)
    mainWindow.setMenuBarVisibility(false)
  }
  mainWindow.on('closed', () => {
    terminalService.disposeOwner(ownerId)
    disposeBrowserView()
    nativeWindows?.detachAllFromMain()
    mainWindow = null
  })
}

async function bootRuntime() {
  try {
    await runtime.start()
    const info = await runtime.initialize()
    serverInfo = info
    studioBridge.setServerInfo(info)
    studioBridge.notifyRuntime()
    broadcast('runtime:ready', info)
  } catch (error) {
    broadcast('runtime:state', { state: 'failed', detail: error.message })
  }
}

app.whenReady().then(async () => {
  app.setName('DSH Studio')
  app.setAboutPanelOptions({
    applicationName: 'DSH Studio',
    applicationVersion: app.getVersion(),
    copyright: 'DSH Studio · DeepSeek Harness 工作台',
  })
  installMenu()
  await createWindow()
  nativeWindows = createNativeWindowService({
    BrowserWindow,
    WebContentsView,
    screen,
    session: session.fromPartition('dsh-native-content-v1'),
    contentUrl: nativeContentUrl,
    preloadPath: resolve(here, 'native-content-preload.cjs'),
    storage: createNativeWindowFileStorage(resolve(app.getPath('userData'), 'native-windows.json')),
    storageKey: nativeWindowStorageKey,
    getMainWindow: () => mainWindow,
    devToolsEnabled,
    onChange: broadcastNativeWindows,
  })
  removeNativeWindowIpc = installNativeWindowIpc({ ipcMain, service: nativeWindows, requireMainSender })
  try {
    await nativeWindows.restore()
  } catch (error) {
    nativeWindowStartupError = error
    console.error('[studio] native window restore failed:', error)
    broadcastNativeWindows([], error)
  }
  nativeWindows.watchDisplays()
  await bootRuntime()
}).catch((error) => {
  console.error('[studio] boot failed:', error)
  app.exit(1)
})

app.on('window-all-closed', () => {
  app.quit()
})

let quitting = false
app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  void (async () => {
    terminalService.disposeAll()
    disposeBrowserView()
    nativeWindows?.flush()
    nativeWindows?.disposeAll()
    removeNativeWindowIpc?.()
    removeNativeWindowIpc = null
    try {
      await runtime.stop()
    } catch (error) {
      console.error('[studio] runtime shutdown failed:', error)
    } finally {
      app.quit()
    }
  })()
})
