const assert = require('node:assert/strict')
const http = require('node:http')
const { app, BrowserWindow, WebContentsView, session } = require('electron')
const { browserPartitionForWorkspace } = require('../src/browser-security.js')

app.disableHardwareAcceleration()

const mode = process.argv[2]
const workspaceId = process.env.DSH_BROWSER_RESTART_WORKSPACE
const marker = 'dsh-persistent-restart-proof-v1'
const port = Number(process.env.DSH_BROWSER_RESTART_PORT ?? 43187)
const html = '<!doctype html><meta charset="utf-8"><title>persistent partition probe</title><body>probe</body>'
let origin = ''

async function accessStorage(currentSession, write) {
  const host = new BrowserWindow({ show: false })
  const view = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, session: currentSession } })
  host.contentView.addChildView(view)
  view.setBounds({ x: 0, y: 0, width: 800, height: 600 })
  const contents = view.webContents
  try {
    await contents.loadURL(origin)
    if (write) {
      await contents.executeJavaScript(`(() => {
        localStorage.setItem("restart-proof", ${JSON.stringify(marker)});
        sessionStorage.setItem("restart-proof", "ephemeral-only");
        document.cookie = "restart-proof=${marker}; Path=/; Max-Age=3600; SameSite=Lax";
      })()`)
    }
    return await contents.executeJavaScript(`({
      cookie: document.cookie,
      local: localStorage.getItem("restart-proof"),
      session: sessionStorage.getItem("restart-proof"),
    })`)
  } finally {
    host.contentView.removeChildView(view)
    if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false })
    host.destroy()
  }
}

async function run() {
  assert.ok(mode === 'seed' || mode === 'verify', 'mode must be seed or verify')
  assert.equal(typeof workspaceId, 'string')
  assert.ok(Number.isInteger(port) && port > 0 && port < 65536, 'invalid restart probe port')
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(html)
  })
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(port, '127.0.0.1', resolveListen)
  })
  origin = `http://127.0.0.1:${port}/`
  const lifetimeHost = new BrowserWindow({ show: false })
  const partition = browserPartitionForWorkspace(workspaceId, true)
  const persistentSession = session.fromPartition(partition)
  const controlSession = session.fromPartition(browserPartitionForWorkspace(`${workspaceId}-control`, true))
  const persistent = await accessStorage(persistentSession, mode === 'seed')
  const control = await accessStorage(controlSession, false)

  if (mode === 'seed') {
    assert.deepEqual(persistent, { cookie: `restart-proof=${marker}`, local: marker, session: 'ephemeral-only' })
  } else {
    assert.deepEqual(persistent, { cookie: `restart-proof=${marker}`, local: marker, session: null })
    assert.deepEqual(control, { cookie: '', local: null, session: null })
  }

  await persistentSession.flushStorageData()
  await controlSession.flushStorageData()
  lifetimeHost.destroy()
  await new Promise(resolveClose => server.close(resolveClose))
  return {
    mode,
    partition,
    electron: process.versions.electron,
    persistent,
    control,
    defaultPartition: persistentSession === session.defaultSession,
  }
}

app.whenReady().then(async () => {
  try {
    const result = await run()
    console.log(JSON.stringify({ ok: true, result }, null, 2))
    app.exit(0)
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.stack ?? String(error) }))
    app.exit(1)
  }
})
