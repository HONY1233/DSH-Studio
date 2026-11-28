const { contextBridge, ipcRenderer } = require('electron')

// This preload is intentionally separate from the full Studio preload. Native
// content gets no dsh/Runtime/terminal/file/shell bridge and no raw IPC access.
let ready = false
let windowId = null
const listeners = new Set()

function requireReady() {
  if (!ready || !windowId) {
    const error = new Error('Native content has not claimed its one-shot ticket')
    error.code = 'UNCLAIMED_CONTENT'
    return error
  }
  return null
}

ipcRenderer.once('workbench:window:ticket', async (_event, payload) => {
  try {
    const claim = await ipcRenderer.invoke('workbench:window:claim', payload?.windowId, payload?.ticket)
    ready = true
    windowId = claim.windowId
    for (const listener of listeners) listener(claim)
  } catch (error) {
    for (const listener of listeners) listener({ error: error?.message ?? String(error) })
  }
})

function command(name, ...args) {
  const error = requireReady()
  if (error) return Promise.reject(error)
  return ipcRenderer.invoke(`workbench:window:${name}`, windowId, ...args)
}

contextBridge.exposeInMainWorld('dshNativeContent', Object.freeze({
  onReady(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function')
    if (ready) listener({ windowId })
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  minimize: () => command('minimize'),
  maximize: () => command('maximize'),
  restore: () => command('restore'),
  close: () => command('close'),
}))
