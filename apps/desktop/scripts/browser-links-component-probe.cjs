const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const { app, BrowserWindow, ipcMain, screen, webContents } = require('electron')
const {
  createExternalUrlIpcHandler,
  createMainIpcGuard,
  isTrustedRendererUrl,
  readNavigationDetails,
} = require('../src/browser-security.js')

app.disableHardwareAcceleration()

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitUntil(predicate, timeoutMs = 5000) {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started >= timeoutMs) return false
    await wait(25)
  }
  return true
}

async function run() {
  const probeUrl = process.env.DSH_LINK_COMPONENT_PROBE_URL
  assert.ok(probeUrl, 'DSH_LINK_COMPONENT_PROBE_URL is required')
  const parsed = new URL(probeUrl)
  assert.equal(parsed.protocol, 'http:')
  assert.ok(parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')

  const preload = path.join(__dirname, '../src/preload.cjs')
  const host = new BrowserWindow({
    show: true,
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: false },
  })
  const opened = []
  const navigationEvents = []
  const requireMain = createMainIpcGuard(event => Boolean(
    event?.sender === host.webContents
    && event?.senderFrame === host.webContents.mainFrame
    && isTrustedRendererUrl(event.senderFrame.url, probeUrl),
  ))
  ipcMain.handle('shell:open-external', createExternalUrlIpcHandler(requireMain, async url => {
    opened.push(url)
  }))
  host.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  for (const eventName of ['will-navigate', 'will-frame-navigate']) {
    host.webContents.on(eventName, (eventOrDetails, legacyUrl, legacyIsMainFrame) => {
      const navigation = readNavigationDetails(eventOrDetails, legacyUrl, legacyIsMainFrame)
      navigationEvents.push({ event: eventName, url: navigation.url, isMainFrame: navigation.isMainFrame })
      if (!isTrustedRendererUrl(navigation.url, probeUrl)) navigation.event.preventDefault()
    })
  }

  await host.loadURL(probeUrl)
  assert.equal(await host.webContents.executeJavaScript('globalThis.__linkProbe?.ready === true'), true)
  navigationEvents.length = 0
  const initial = await host.webContents.executeJavaScript(`({
    reactVersion: globalThis.__linkProbe.reactVersion,
    bridgeType: typeof globalThis.ompStudioChrome?.openUrl,
    unsafeTag: document.querySelector('.bad-probe').tagName,
    unsafeHref: document.querySelector('.bad-probe').getAttribute('href'),
  })`)
  assert.equal(initial.bridgeType, 'function')
  assert.equal(initial.unsafeTag, 'SPAN')
  assert.equal(initial.unsafeHref, null)

  host.setAlwaysOnTop(true)
  host.show()
  host.focus()
  await wait(100)

  const click = async selector => {
    const rect = await host.webContents.executeJavaScript(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)})
      const r = element.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })()`)
    const content = host.getContentBounds()
    const point = screen.dipToScreenPoint({ x: content.x + rect.x, y: content.y + rect.y })
    const x = Math.round(point.x)
    const y = Math.round(point.y)
    const script = `
      Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DshReactProbeMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
'@;
      [DshReactProbeMouse]::SetCursorPos(${x}, ${y});
      Start-Sleep -Milliseconds 40;
      [DshReactProbeMouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero);
      Start-Sleep -Milliseconds 40;
      [DshReactProbeMouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero);
    `
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 10000 })
    await wait(150)
  }

  const contentsBefore = webContents.getAllWebContents().length
  await click('.safe-probe')
  assert.equal(await host.webContents.executeJavaScript('globalThis.__linkProbe.clicks.safe?.trusted === true'), true)
  assert.equal(await waitUntil(() => opened.includes('https://example.com/react-safe')), true)

  await click('.mailto-probe')
  assert.equal(await host.webContents.executeJavaScript('globalThis.__linkProbe.clicks.mailto?.trusted === true'), true)
  assert.equal(await waitUntil(() => opened.includes('mailto:react@example.com?subject=DSH%20Studio')), true)

  const openedBeforeUnsafe = opened.length
  await click('.bad-probe')
  assert.equal(await host.webContents.executeJavaScript('globalThis.__linkProbe.clicks.bad?.trusted === true'), true)
  assert.equal(opened.length, openedBeforeUnsafe)

  await click('.custom-probe')
  assert.equal(await host.webContents.executeJavaScript('globalThis.__linkProbe.clicks.custom?.trusted === true && globalThis.__linkProbe.customPrevented === true'), true)
  assert.equal(opened.length, openedBeforeUnsafe, 'caller-controlled link was not opened twice')
  assert.equal(webContents.getAllWebContents().length, contentsBefore)
  assert.deepEqual(navigationEvents, [])

  const result = {
    reactVersion: initial.reactVersion,
    bridgeType: initial.bridgeType,
    unsafeTag: initial.unsafeTag,
    unsafeHref: initial.unsafeHref,
    opened,
    clicks: await host.webContents.executeJavaScript('globalThis.__linkProbe.clicks'),
    callerPreventedDefault: await host.webContents.executeJavaScript('globalThis.__linkProbe.customPrevented'),
    navigationEvents,
    createdWindows: webContents.getAllWebContents().length - contentsBefore,
  }

  ipcMain.removeHandler('shell:open-external')
  host.destroy()
  return result
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
