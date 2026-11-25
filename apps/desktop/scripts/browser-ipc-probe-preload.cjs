const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('__browserSecurityProbe', {
  invoke: () => ipcRenderer.invoke('browser-security:probe'),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', { url }),
})
