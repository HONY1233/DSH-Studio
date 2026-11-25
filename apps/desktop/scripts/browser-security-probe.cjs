const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { readFileSync } = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { app, BrowserWindow, WebContentsView, ipcMain, screen, session, webContents } = require('electron')
const {
  browserPartitionForWorkspace,
  createExternalUrlHandler,
  createExternalUrlIpcHandler,
  createMainIpcGuard,
  createPermissionGuards,
  isAllowedFrameNavigation,
  isTrustedRendererUrl,
  readNavigationDetails,
  shouldBlockDevToolsInput,
} = require('../src/browser-security.js')

app.disableHardwareAcceleration()
// Provide a deterministic Chromium media device so the installed permission
// handler is exercised even on hosts without a physical microphone or camera.
app.commandLine.appendSwitch('use-fake-device-for-media-stream')

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitUntil(predicate, timeoutMs = 1500) {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started >= timeoutMs) return false
    await wait(25)
  }
  return true
}

function isProcessAlive(pid) {
  const output = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true })
  return output.split(/\r?\n/u).some(line => line.startsWith(`"electron.exe","${pid}",`))
}

async function run() {
  const partitionA = browserPartitionForWorkspace('probe-a', false)
  const partitionB = browserPartitionForWorkspace('probe-b', false)
  const sessionA = session.fromPartition(partitionA)
  const sessionB = session.fromPartition(partitionB)
  assert.notEqual(sessionA, sessionB)
  assert.notEqual(sessionA, session.defaultSession)
  assert.notEqual(sessionB, session.defaultSession)

  const html = `<!doctype html><meta charset="utf-8"><title>browser probe</title><body>probe</body>`
  const ipcHtml = `<!doctype html><meta charset="utf-8"><title>foreign IPC probe</title><iframe src="/ipc-frame"></iframe>`
  for (const current of [sessionA, sessionB, session.defaultSession]) {
    await current.protocol.handle('https', request => {
      const url = new URL(request.url)
      if (url.hostname === 'browser.test' && url.pathname === '/redirect') {
        return new Response(null, { status: 302, headers: { location: 'https://evil.test/redirected' } })
      }
      if (url.hostname === 'browser.test' && url.pathname.startsWith('/ipc')) {
        return new Response(ipcHtml, { headers: { 'content-type': 'text/html' } })
      }
      return new Response(html, { headers: { 'content-type': 'text/html' } })
    })
  }

  const host = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } })
  const view = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, session: sessionA } })
  host.contentView.addChildView(view)
  view.setBounds({ x: 0, y: 0, width: 800, height: 600 })
  const wc = view.webContents
  const guards = createPermissionGuards()
  sessionA.setPermissionCheckHandler(guards.check)
  sessionA.setPermissionRequestHandler(guards.request)

  let blockedFrames = 0
  let blockedMain = 0
  let blockedRedirects = 0
  let schemeHandlerDispatches = 0
  let downloads = 0
  let preventedDownloads = 0
  let deniedPopups = 0
  let devtoolsOpenedCount = 0
  let hostHideShowCycles = 0
  const mainNavigationEvents = []
  const frameNavigationEvents = []
  const onFrame = (eventOrDetails, legacyUrl, legacyIsMainFrame) => {
    const navigation = readNavigationDetails(eventOrDetails, legacyUrl, legacyIsMainFrame)
    frameNavigationEvents.push({ url: navigation.url, isMainFrame: navigation.isMainFrame, detailsObject: typeof eventOrDetails?.url === 'string', probeDispatch: eventOrDetails?.probeDispatch ?? null })
    if (!isAllowedFrameNavigation(navigation.url, wc.getURL(), navigation.isMainFrame)) {
      if (eventOrDetails?.probeDispatch === 'scheme') schemeHandlerDispatches += 1
      else blockedFrames += 1
      navigation.event.preventDefault()
    }
  }
  const onMain = (eventOrDetails, legacyUrl) => {
    const navigation = readNavigationDetails(eventOrDetails, legacyUrl, true)
    mainNavigationEvents.push({ url: navigation.url, isMainFrame: navigation.isMainFrame, detailsObject: typeof eventOrDetails?.url === 'string', probeDispatch: eventOrDetails?.probeDispatch ?? null })
    const parsed = new URL(navigation.url)
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'browser.test') {
      blockedMain += 1
      navigation.event.preventDefault()
    }
  }
  const onRedirect = (eventOrDetails, legacyUrl, _legacyIsInPlace, legacyIsMainFrame) => {
    const navigation = readNavigationDetails(eventOrDetails, legacyUrl, legacyIsMainFrame)
    const parsed = new URL(navigation.url)
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'browser.test') {
      blockedRedirects += 1
      navigation.event.preventDefault()
    }
  }
  const onDownload = event => {
    downloads += 1
    event.preventDefault()
    preventedDownloads += 1
  }
  const onBeforeInput = (event, input) => {
    if (shouldBlockDevToolsInput(input, false)) event.preventDefault()
  }
  const onDevToolsOpened = () => {
    devtoolsOpenedCount += 1
    wc.closeDevTools()
  }
  wc.on('will-frame-navigate', onFrame)
  wc.on('will-navigate', onMain)
  wc.on('will-redirect', onRedirect)
  wc.on('devtools-opened', onDevToolsOpened)
  wc.on('before-input-event', onBeforeInput)
  sessionA.on('will-download', onDownload)
  wc.setWindowOpenHandler(() => {
    deniedPopups += 1
    return { action: 'deny' }
  })

  await wc.loadURL('https://browser.test/')
  const globals = await wc.executeJavaScript(`({
    requireType: typeof require,
    processType: typeof process,
    dshType: typeof window.dsh,
    dshStudioType: typeof window.dshStudio,
    contextIsolation: window.dsh === undefined,
  })`)
  assert.equal(globals.requireType, 'undefined')
  assert.equal(globals.processType, 'undefined')
  assert.equal(globals.dshType, 'undefined')
  assert.equal(globals.dshStudioType, 'undefined')

  await wc.loadURL('https://browser.test/redirect').catch(() => {})
  await wait(150)
  assert.ok(blockedRedirects >= 1, `cross-origin redirects blocked: ${blockedRedirects}`)
  await wc.loadURL('https://browser.test/')

  await wc.executeJavaScript(`document.cookie = "probe=workspace-a"; localStorage.setItem("probe", "workspace-a"); document.body.insertAdjacentHTML("beforeend", '<a id="bad" href="file:///C:/Windows/win.ini">bad</a><a id="remote" href="https://evil.test/remote" style="position:fixed;left:20px;top:20px">remote</a><iframe src="https://evil.test/frame"></iframe><a id="download" download href="data:text/plain,probe">download</a>'); document.getElementById("bad").click(); document.getElementById("download").click(); window.open("https://evil.test/popup")`)
  await wc.executeJavaScript('location.href = "file:///F:/projects/dsh-studio/apps/desktop/scripts/does-not-exist.html"').catch(() => {})
  await wait(100)
  await wc.executeJavaScript('location.href = "data:text/html,<title>blocked</title>"').catch(() => {})
  await wait(100)
  await wc.executeJavaScript('location.href = "https://evil.test/remote"').catch(() => {})
  await wait(600)
  assert.equal(wc.getURL(), 'https://browser.test/')
  assert.ok(blockedMain >= 1, `real remote main-frame navigation reached the installed handler: ${blockedMain}; main=${JSON.stringify(mainNavigationEvents)}; frame=${JSON.stringify(frameNavigationEvents)}`)
  // Chromium may reject dangerous locations before Electron emits navigation events.
  // Dispatch the real installed handlers separately; this proves handler behavior,
  // not that a real Chromium navigation reached those handlers.
  for (const dangerous of ['file:///C:/Windows/win.ini', 'data:text/html,blocked', 'javascript:alert(1)', 'custom://danger']) {
    let prevented = false
    const delivered = wc.emit('will-frame-navigate', { probeDispatch: 'scheme', preventDefault() { prevented = true } }, dangerous, true)
    assert.equal(delivered, true, dangerous)
    assert.equal(prevented, true, dangerous)
  }
  assert.equal(schemeHandlerDispatches, 4)
  assert.ok(blockedFrames >= 1, `cross-origin frames blocked: ${blockedFrames}`)
  assert.ok(downloads >= 1 && preventedDownloads === downloads, `downloads prevented: ${preventedDownloads}/${downloads}`)
  assert.ok(deniedPopups >= 1, `popups denied: ${deniedPopups}`)
  assert.equal(webContents.getAllWebContents().filter(item => item !== wc && item !== host.webContents).length, 0)

  for (let cycle = 0; cycle < 3; cycle += 1) {
    host.hide()
    host.show()
    await wait(50)
    assert.equal(wc.isDestroyed(), false)
    assert.equal(wc.getURL(), 'https://browser.test/')
    hostHideShowCycles += 1
  }

  const mediaResult = await wc.executeJavaScript(`navigator.mediaDevices.getUserMedia({ audio: true }).then(() => "granted", error => error.name)`).catch(error => error.message)
  assert.notEqual(mediaResult, 'granted')

  const workspaceBStorage = await (async () => {
    const other = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, session: sessionB } })
    host.contentView.addChildView(other)
    await other.webContents.loadURL('https://browser.test/')
    const value = await other.webContents.executeJavaScript('({ cookie: document.cookie, local: localStorage.getItem("probe") })')
    other.webContents.close()
    return value
  })()
  assert.deepEqual(workspaceBStorage, { cookie: '', local: null })

  const defaultStorage = await (async () => {
    const other = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } })
    host.contentView.addChildView(other)
    await other.webContents.loadURL('https://browser.test/')
    const value = await other.webContents.executeJavaScript('({ cookie: document.cookie, local: localStorage.getItem("probe") })')
    other.webContents.close()
    return value
  })()
  assert.deepEqual(defaultStorage, { cookie: '', local: null })

  wc.openDevTools()
  assert.equal(await waitUntil(() => devtoolsOpenedCount >= 1 && !wc.isDevToolsOpened()), true)
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'F12' })
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'F12' })
  assert.equal(await waitUntil(() => !wc.isDevToolsOpened()), true)
  wc.closeDevTools()
  wc.removeListener('will-frame-navigate', onFrame)
  wc.removeListener('will-navigate', onMain)
  wc.removeListener('will-redirect', onRedirect)
  wc.removeListener('before-input-event', onBeforeInput)
  wc.removeListener('devtools-opened', onDevToolsOpened)
  sessionA.removeListener('will-download', onDownload)
  sessionA.setPermissionCheckHandler(null)
  sessionA.setPermissionRequestHandler(null)
  const listenerCount = wc.listenerCount('will-frame-navigate')
  host.contentView.removeChildView(view)
  wc.once('render-process-gone', () => wc.close())
  wc.forcefullyCrashRenderer()
  await wait(300)
  assert.equal(wc.isDestroyed(), true)
  assert.equal(listenerCount, 0)

  const pageServer = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(readFileSync(path.join(__dirname, 'browser-ipc-probe.html')))
  })
  await new Promise((resolveListen, rejectListen) => {
    pageServer.once('error', rejectListen)
    pageServer.listen(0, '127.0.0.1', resolveListen)
  })
  const trustedEntry = `http://127.0.0.1:${pageServer.address().port}/`
  const preload = path.join(__dirname, 'browser-ipc-probe-preload.cjs')
  const ipcHost = new BrowserWindow({
    show: true,
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: false },
  })
  let blockedMainWindowNavigations = 0
  let mainWindowHandlerDispatches = 0
  const mainWindowNavigationEvents = []
  const externalOpened = []
  const externalOpenErrors = []
  ipcHost.webContents.setWindowOpenHandler(createExternalUrlHandler(
    (url) => { externalOpened.push(url); return Promise.resolve() },
    (error) => externalOpenErrors.push(String(error)),
  ))
  ipcHost.webContents.on('will-navigate', (eventOrDetails, legacyUrl) => {
    const navigation = readNavigationDetails(eventOrDetails, legacyUrl, true)
    mainWindowNavigationEvents.push({ event: 'will-navigate', url: navigation.url, isMainFrame: navigation.isMainFrame })
    if (!isTrustedRendererUrl(navigation.url, trustedEntry)) {
      if (eventOrDetails?.probeDispatch === 'main-window') mainWindowHandlerDispatches += 1
      else blockedMainWindowNavigations += 1
      navigation.event.preventDefault()
    }
  })
  ipcHost.webContents.on('will-frame-navigate', (eventOrDetails, legacyUrl, legacyIsMainFrame) => {
    const navigation = readNavigationDetails(eventOrDetails, legacyUrl, legacyIsMainFrame)
    mainWindowNavigationEvents.push({ event: 'will-frame-navigate', url: navigation.url, isMainFrame: navigation.isMainFrame })
    const allowed = navigation.isMainFrame
      ? isTrustedRendererUrl(navigation.url, trustedEntry)
      : isAllowedFrameNavigation(navigation.url, ipcHost.webContents.getURL(), false)
    if (!allowed) {
      if (navigation.isMainFrame && eventOrDetails?.probeDispatch === 'main-window') mainWindowHandlerDispatches += 1
      else if (navigation.isMainFrame) blockedMainWindowNavigations += 1
      navigation.event.preventDefault()
    }
  })
  const requireTrustedMain = createMainIpcGuard(event => Boolean(
    event?.sender === ipcHost.webContents
    && event?.senderFrame === ipcHost.webContents.mainFrame
    && isTrustedRendererUrl(event.senderFrame.url, trustedEntry),
  ))
  ipcMain.handle('browser-security:probe', event => {
    requireTrustedMain(event)
    return { ok: true }
  })
  ipcMain.handle('shell:open-external', createExternalUrlIpcHandler(
    requireTrustedMain,
    (url) => { externalOpened.push(url); return Promise.resolve() },
  ))
  const foreign = new WebContentsView({
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: true,
      sandbox: true,
      session: sessionB,
    },
  })
  ipcHost.contentView.addChildView(foreign)
  await ipcHost.loadURL(trustedEntry)
  await foreign.webContents.loadURL('https://browser.test/ipc')
  ipcHost.setAlwaysOnTop(true)
  ipcHost.show()
  ipcHost.focus()
  await wait(100)
  const click = async (id) => {
    const rect = await ipcHost.webContents.executeJavaScript(`(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`)
    const content = ipcHost.getContentBounds()
    const point = screen.dipToScreenPoint({ x: content.x + rect.x, y: content.y + rect.y })
    const x = Math.round(point.x), y = Math.round(point.y)
    const script = `
      Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DshProbeMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
'@;
      [DshProbeMouse]::SetCursorPos(${x}, ${y});
      Start-Sleep -Milliseconds 40;
      [DshProbeMouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero);
      Start-Sleep -Milliseconds 40;
      [DshProbeMouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero);
    `
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 10000 })
    await wait(120)
    return ipcHost.webContents.executeJavaScript(`window.__probeClicks?.[${JSON.stringify(id)}]?.trusted === true`)
  }
  const contentsBeforeClicks = webContents.getAllWebContents().length
  const safeClickTrusted = await click('safe-external')
  assert.equal(safeClickTrusted, true, 'safe external link received a trusted Chromium mouse click')
  assert.equal(await waitUntil(() => externalOpened.includes('https://example.com/from-real-click')), true, `safe external click did not reach OS handler: ${JSON.stringify({ externalOpened, mainWindowNavigationEvents })}`)
  assert.equal(mainWindowNavigationEvents.some(item => item.url === 'https://example.com/from-real-click'), false, 'safe external click stayed out of main-window navigation')
  const openedBeforeBadClick = externalOpened.length
  await click('bad-external')
  assert.equal(externalOpened.length, openedBeforeBadClick, 'dangerous external scheme did not reach the OS browser')
  const ipcClickTrusted = await click('ipc-external')
  assert.equal(ipcClickTrusted, true, 'IPC external button received a trusted Chromium mouse click')
  assert.equal(await waitUntil(() => externalOpened.includes('mailto:probe@example.com?subject=DSH%20Studio')), true)
  const invalidExternalIpc = await ipcHost.webContents.executeJavaScript(`window.__browserSecurityProbe.openExternal('file:///C:/Windows/win.ini').then(() => 'allowed', error => error.message)`)
  assert.match(invalidExternalIpc, /External URL is not allowed/u)
  assert.equal(webContents.getAllWebContents().length, contentsBeforeClicks, 'external links did not create Electron windows')
  const externalLinksCreatedWindows = webContents.getAllWebContents().length - contentsBeforeClicks
  assert.deepEqual(externalOpenErrors, [])
  const trustedIpc = await ipcHost.webContents.executeJavaScript('window.__browserSecurityProbe.invoke()')
  assert.deepEqual(trustedIpc, { ok: true })
  const foreignIpc = await foreign.webContents.executeJavaScript('window.__browserSecurityProbe.invoke().then(() => "allowed", error => error.message)')
  assert.match(foreignIpc, /Privileged IPC requires the trusted main renderer frame/)
  const foreignExternalIpc = await foreign.webContents.executeJavaScript(`window.__browserSecurityProbe.openExternal('https://example.com/foreign').then(() => 'allowed', error => error.message)`)
  assert.match(foreignExternalIpc, /Privileged IPC requires the trusted main renderer frame/)
  await wait(150)
  const childIpc = await foreign.webContents.executeJavaScript('document.querySelector("iframe").contentWindow.__browserSecurityProbe.invoke().then(() => "allowed", error => error.message)')
  assert.match(childIpc, /Privileged IPC requires the trusted main renderer frame/)
  await ipcHost.webContents.executeJavaScript('location.href = "https://evil.test/main-renderer"').catch(() => {})
  await wait(200)
  assert.equal(ipcHost.webContents.getURL(), trustedEntry)
  assert.ok(blockedMainWindowNavigations >= 1, `real main-window remote navigation reached the installed handler: ${blockedMainWindowNavigations}`)
  for (const eventName of ['will-navigate', 'will-frame-navigate']) {
    let prevented = false
    const delivered = ipcHost.webContents.emit(eventName, { probeDispatch: 'main-window', preventDefault() { prevented = true } }, 'https://evil.test/main-renderer', true)
    assert.equal(delivered, true, eventName)
    assert.equal(prevented, true, eventName)
  }
  assert.equal(mainWindowHandlerDispatches, 2)
  ipcMain.removeHandler('browser-security:probe')
  ipcMain.removeHandler('shell:open-external')
  foreign.webContents.close()
  ipcHost.destroy()

  const resourceCycles = []
  assert.equal(await waitUntil(() => webContents.getAllWebContents().every(item => item === host.webContents), 5000), true)
  const baselineContents = webContents.getAllWebContents().length
  for (let cycle = 0; cycle < 3; cycle += 1) {
    const isolatedSession = session.fromPartition(browserPartitionForWorkspace(`resource-${cycle}`, false))
    await isolatedSession.protocol.handle('https', () => new Response(html, { headers: { 'content-type': 'text/html' } }))
    const resourceView = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, session: isolatedSession } })
    host.contentView.addChildView(resourceView)
    const resourceContents = resourceView.webContents
    const navigationListener = () => {}
    resourceContents.on('will-frame-navigate', navigationListener)
    isolatedSession.setPermissionCheckHandler(() => false)
    isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    await resourceContents.loadURL('https://browser.test/')
    const rendererPid = resourceContents.getOSProcessId()
    assert.ok(rendererPid > 0 && isProcessAlive(rendererPid), `live renderer PID before close: ${rendererPid}`)
    assert.equal(resourceContents.listenerCount('will-frame-navigate'), 1)
    host.contentView.removeChildView(resourceView)
    resourceContents.removeListener('will-frame-navigate', navigationListener)
    isolatedSession.setPermissionCheckHandler(null)
    isolatedSession.setPermissionRequestHandler(null)
    resourceContents.close({ waitForBeforeUnload: false })
    const cleaned = await waitUntil(() => resourceContents.isDestroyed() && !isProcessAlive(rendererPid), 5000)
    assert.equal(cleaned, true, `BrowserView OS resources cleaned after cycle ${cycle}; pid=${rendererPid}`)
    assert.equal(resourceContents.listenerCount('will-frame-navigate'), 0)
    assert.equal(webContents.getAllWebContents().length, baselineContents)
    resourceCycles.push({ rendererPid, destroyed: resourceContents.isDestroyed(), processAlive: isProcessAlive(rendererPid), listenerCount: resourceContents.listenerCount('will-frame-navigate') })
  }

  host.destroy()
  await new Promise((resolveClose) => pageServer.close(resolveClose))

  return {
    electron: process.versions.electron,
    partitionA,
    partitionB,
    globals,
    blockedMain,
    mainNavigationEvents,
    frameNavigationEvents,
    blockedFrames,
    blockedRedirects,
    schemeHandlerDispatches,
    downloads,
    preventedDownloads,
    mediaResult,
    deniedPopups,
    devtoolsOpenedCount,
    hostHideShowCycles,
    workspaceBStorage,
    defaultStorage,
    blockedMainWindowNavigations,
    mainWindowHandlerDispatches,
    trustedIpc,
    externalOpened,
    externalOpenErrors,
    mainWindowNavigationEvents,
    safeClickTrusted,
    ipcClickTrusted,
    invalidExternalIpcRejected: invalidExternalIpc.includes('External URL is not allowed'),
    foreignExternalIpcRejected: !foreignExternalIpc.includes('allowed'),
    externalLinksCreatedWindows,
    foreignIpcRejected: !foreignIpc.includes('allowed'),
    childIpcRejected: !childIpc.includes('allowed'),
    resourceCycles,
    destroyed: wc.isDestroyed(),
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
