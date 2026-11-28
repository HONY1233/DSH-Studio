const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dsh', {
  info: () => ipcRenderer.invoke('runtime:info'),
  createSession: () => ipcRenderer.invoke('runtime:create-session'),
  query: (sessionId, text) => ipcRenderer.invoke('runtime:query', sessionId, text),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  openSession: (sessionId) => ipcRenderer.invoke('sessions:open', sessionId),
  listDir: (relativePath) => ipcRenderer.invoke('files:list', relativePath),
  readFile: (relativePath) => ipcRenderer.invoke('files:read', relativePath),
  gitChanges: () => ipcRenderer.invoke('git:changes'),
  gitDiff: (path, staged) => ipcRenderer.invoke('git:diff', path, staged),
  respondRequest: (requestId, result) => ipcRenderer.invoke('runtime:respond-request', requestId, result),
  terminalStart: () => ipcRenderer.invoke('terminal:start'),
  terminalWrite: (data) => ipcRenderer.invoke('terminal:write', data),
  terminalResize: (cols, rows) => ipcRenderer.invoke('terminal:resize', cols, rows),
  terminalKill: () => ipcRenderer.invoke('terminal:kill'),
  onTerminalData: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('terminal:data', listener)
    return () => ipcRenderer.removeListener('terminal:data', listener)
  },
  onTerminalExit: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('terminal:exit', listener)
    return () => ipcRenderer.removeListener('terminal:exit', listener)
  },
  // Browser IPC intentionally stays unexposed until the X5/XG5 browser gate.
  logsTail: () => ipcRenderer.invoke('logs:tail'),
  logsClear: () => ipcRenderer.invoke('logs:clear'),
  onLogAppend: (callback) => {
    const listener = (_event, entry) => callback(entry)
    ipcRenderer.on('logs:append', listener)
    return () => ipcRenderer.removeListener('logs:append', listener)
  },
  onState: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('runtime:state', listener)
    return () => ipcRenderer.removeListener('runtime:state', listener)
  },
  onReady: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('runtime:ready', listener)
    return () => ipcRenderer.removeListener('runtime:ready', listener)
  },
  onNotification: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('runtime:notification', listener)
    return () => ipcRenderer.removeListener('runtime:notification', listener)
  },
  onRequest: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('runtime:request', listener)
    return () => ipcRenderer.removeListener('runtime:request', listener)
  },
  onRequestSettled: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('runtime:request-settled', listener)
    return () => ipcRenderer.removeListener('runtime:request-settled', listener)
  },
  onStderr: (callback) => {
    const listener = (_event, line) => callback(line)
    ipcRenderer.on('runtime:stderr', listener)
    return () => ipcRenderer.removeListener('runtime:stderr', listener)
  },
})

// Narrow main-renderer port for X3 native windows. It never returns Electron
// handles, URLs, tickets, or raw IPC; native child frames use a separate preload.
contextBridge.exposeInMainWorld('dshWorkbench', Object.freeze({
  createNativeWindow: (options) => ipcRenderer.invoke('workbench:window:create', options),
  listNativeWindows: () => ipcRenderer.invoke('workbench:window:list'),
  attachNativeWindow: (windowId, host, rect) => ipcRenderer.invoke('workbench:window:attach', windowId, host, rect),
  detachNativeWindow: (windowId) => ipcRenderer.invoke('workbench:window:detach', windowId),
  setNativeWindowBounds: (windowId, rect) => ipcRenderer.invoke('workbench:window:bounds', windowId, rect),
  focusNativeWindow: (windowId) => ipcRenderer.invoke('workbench:window:focus', windowId),
  minimizeNativeWindow: (windowId) => ipcRenderer.invoke('workbench:window:minimize-main', windowId),
  maximizeNativeWindow: (windowId) => ipcRenderer.invoke('workbench:window:maximize-main', windowId),
  restoreNativeWindow: (windowId) => ipcRenderer.invoke('workbench:window:restore-main', windowId),
  setNativeWindowTopmost: (windowId, value) => ipcRenderer.invoke('workbench:window:topmost', windowId, value),
  closeNativeWindow: (windowId) => ipcRenderer.invoke('workbench:window:close-main', windowId),
  onNativeWindowsChanged: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('workbench:windows:state', listener)
    return () => ipcRenderer.removeListener('workbench:windows:state', listener)
  },
}))

// Strict system-browser opening for renderer links. Main revalidates the URL;
// this bridge never exposes a generic Electron window or shell primitive.
contextBridge.exposeInMainWorld('ompStudioChrome', {
  openUrl: (payload) => ipcRenderer.invoke('shell:open-external', payload),
})

// ---- OMP Studio contract bridge（apps/renderer-omp 使用）----
// 与 `dsh` 分开暴露：这是 omp-studio 的 OmpStudioDesktopApi 形状，
// 渲染层只看到语义 query/command，不接触任何通道名。
contextBridge.exposeInMainWorld('dshStudio', {
  openContext: (scope) => ipcRenderer.invoke('studio:open-context', scope),
  bootstrap: (contextId) => ipcRenderer.invoke('studio:bootstrap', contextId),
  query: (request, contextId) => ipcRenderer.invoke('studio:query', request, contextId),
  command: (request, contextId) => ipcRenderer.invoke('studio:command', request, contextId),
  subscribe: (_scope, listener, contextId) => {
    const onEvent = (_event, event) => {
      // 每个对话上下文只消费自己的事件；没有 contextId 的事件（连接状态等）广播给所有人。
      if (contextId !== undefined && event?.contextId !== undefined && event.contextId !== contextId) return
      listener(event)
    }
    ipcRenderer.on('studio:event', onEvent)
    return () => ipcRenderer.removeListener('studio:event', onEvent)
  },
  close: (contextId) => ipcRenderer.invoke('studio:close', contextId),
})

// renderer-omp 的 TerminalPane 读取 `globalThis.ompStudioTerminal`（多会话 PTY）。
contextBridge.exposeInMainWorld('ompStudioTerminal', {
  create: (size) => ipcRenderer.invoke('omp-studio:desktop:terminal-create', size ?? {}),
  write: (id, data) => ipcRenderer.invoke('omp-studio:desktop:terminal-write', id, data),
  resize: (id, cols, rows) => ipcRenderer.invoke('omp-studio:desktop:terminal-resize', id, cols, rows),
  dispose: (id) => ipcRenderer.invoke('omp-studio:desktop:terminal-dispose', id),
  onData: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('omp-studio:desktop:terminal-data', listener)
    return () => ipcRenderer.removeListener('omp-studio:desktop:terminal-data', listener)
  },
  onExit: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('omp-studio:desktop:terminal-exit', listener)
    return () => ipcRenderer.removeListener('omp-studio:desktop:terminal-exit', listener)
  },
})
