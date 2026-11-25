import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
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
  normalizeExternalSystemUrl,
  readNavigationDetails,
  resolveTrustedRendererUrl,
  shouldBlockDevToolsInput,
} from '../../../apps/desktop/src/browser-security.js'

for (const raw of ['javascript:alert(1)', 'data:text/html,<h1>x</h1>', 'file:///C:/Windows/win.ini', 'custom://danger', 'https://user:pass@example.com', 'https://example.com/\nfoo', '']) {
  test(`browser URL is rejected: ${JSON.stringify(raw)}`, () => {
    assert.equal(normalizeBrowserUrl(raw).ok, false)
  })
}

test('bare hosts normalize to HTTPS and explicit HTTP remains HTTP', () => {
  assert.deepEqual(normalizeBrowserUrl(' example.com/path '), { ok: true, url: 'https://example.com/path' })
  assert.deepEqual(normalizeBrowserUrl('http://localhost:5174/'), { ok: true, url: 'http://localhost:5174/' })
})

test('system-browser targets require explicit HTTP(S) or a structurally valid mailto URL', () => {
  assert.equal(normalizeExternalSystemUrl('https://example.com/path?q=1#top'), 'https://example.com/path?q=1#top')
  assert.equal(normalizeExternalSystemUrl('http://127.0.0.1:5174/'), 'http://127.0.0.1:5174/')
  assert.equal(normalizeExternalSystemUrl('mailto:probe@example.com?subject=DSH%20Studio'), 'mailto:probe@example.com?subject=DSH%20Studio')
  for (const raw of [
    'example.com', 'javascript:alert(1)', 'data:text/html,x', 'file:///C:/Windows/win.ini',
    'custom://danger', 'https://user:pass@example.com/', 'https://example.com/\nfoo',
    'https://example.com\\@evil.test/', 'mailto:', `mailto:probe@example.com?subject=${'x'.repeat(2100)}`,
  ]) assert.equal(normalizeExternalSystemUrl(raw), null, raw)
})

test('external popup handler opens only safe OS targets and never creates an Electron window', async () => {
  const opened = []
  const handler = createExternalUrlHandler(async (url) => { opened.push(url) })
  assert.deepEqual(handler({ url: 'https://example.com/clicked' }), { action: 'deny' })
  assert.deepEqual(handler({ url: 'javascript:alert(1)' }), { action: 'deny' })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(opened, ['https://example.com/clicked'])
})

test('external IPC revalidates sender and payload before calling the OS browser', async () => {
  const opened = []
  const trusted = { sender: 'main' }
  const handler = createExternalUrlIpcHandler(event => {
    if (event !== trusted) {
      const error = new Error('untrusted sender')
      error.code = 'PERMISSION_DENIED'
      throw error
    }
  }, async (url) => { opened.push(url) })
  await handler(trusted, { url: 'mailto:probe@example.com' })
  assert.deepEqual(opened, ['mailto:probe@example.com'])
  assert.throws(() => handler({}, { url: 'https://example.com/' }), error => error.code === 'PERMISSION_DENIED')
  assert.throws(() => handler(trusted, { url: 'file:///C:/Windows/win.ini' }), error => error.code === 'INVALID_EXTERNAL_URL')
})

test('packaged mode refuses the development renderer fallback when dist is missing', () => {
  assert.throws(() => resolveTrustedRendererUrl(undefined, undefined, { allowDevelopmentFallback: false }), /refusing the development server fallback/)
  assert.throws(() => resolveTrustedRendererUrl('https://evil.example/', undefined, { allowDevelopmentFallback: false }), /loopback/)
})

test('renderer entry accepts only exact file or loopback development URLs', () => {
  const dist = 'file:///F:/projects/dsh-studio/apps/renderer-omp/dist/index.html'
  assert.equal(resolveTrustedRendererUrl(undefined, dist), dist)
  assert.equal(resolveTrustedRendererUrl('http://127.0.0.1:5174', undefined), 'http://127.0.0.1:5174/')
  assert.throws(() => resolveTrustedRendererUrl('https://evil.example/', dist), /loopback/)
  assert.throws(() => resolveTrustedRendererUrl('file:///F:/tmp/index.html', dist), /Untrusted file/)
  assert.throws(() => resolveTrustedRendererUrl('javascript:alert(1)', dist), /Unsupported/)
})

test('renderer identity ignores hash routing but not path, query, origin, or credentials', () => {
  const expected = 'http://127.0.0.1:5174/?fixture=1'
  assert.equal(isTrustedRendererUrl('http://127.0.0.1:5174/?fixture=1#/settings', expected), true)
  for (const candidate of [
    'http://127.0.0.1:5174/?fixture=2#/settings',
    'http://127.0.0.1:5174/other?fixture=1',
    'http://localhost:5174/?fixture=1',
    'http://127.0.0.1:5175/?fixture=1',
    'https://127.0.0.1:5174/?fixture=1',
    'file:///F:/projects/dsh-studio/apps/renderer-omp/dist/index.html',
  ]) assert.equal(isTrustedRendererUrl(candidate, expected), false, candidate)
})

test('main-frame navigation is HTTP(S) only and subframes are same-origin or about:blank', () => {
  const current = 'https://example.com/app'
  assert.equal(isAllowedFrameNavigation('https://example.com/next', current, true), true)
  assert.equal(isAllowedFrameNavigation('file:///tmp/x', current, true), false)
  assert.equal(isAllowedFrameNavigation('https://example.com/frame', current, false), true)
  assert.equal(isAllowedFrameNavigation('about:blank', current, false), true)
  assert.equal(isAllowedFrameNavigation('https://evil.example/frame', current, false), false)
  assert.equal(isAllowedFrameNavigation('data:text/html,x', current, false), false)
})

test('workspace partitions are opaque, non-default, and optionally persistent', () => {
  assert.equal(browserPartitionForWorkspace('workspace-1_A', false), 'dsh-workspace-workspace-1_A')
  assert.equal(browserPartitionForWorkspace('workspace-1_A', true), 'persist:dsh-workspace-workspace-1_A')
  for (const value of ['', '../escape', 'persist:default', 'a'.repeat(129), null]) {
    assert.throws(() => browserPartitionForWorkspace(value), /Invalid opaque workspace ID/)
  }
})

test('browser bounds reject non-finite, empty, and oversized rectangles while allowing negative DIP coordinates', () => {
  assert.deepEqual(normalizeBrowserBounds({ x: -1920, y: -120, width: 800.4, height: 600.6 }), { x: -1920, y: -120, width: 800, height: 601 })
  for (const rect of [null, {}, { x: NaN, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 0, height: 10 }, { x: 0, y: 0, width: 20_000, height: 10 }, { x: 40_000, y: 0, width: 10, height: 10 }]) {
    assert.equal(normalizeBrowserBounds(rect), null)
  }
})

test('permission checks and requests fail closed without triggering the OS prompt', () => {
  const guards = createPermissionGuards()
  assert.equal(guards.check(), false)
  let answer = 'unset'
  guards.request({}, 'camera', value => { answer = value })
  assert.equal(answer, false)
})

test('production DevTools shortcuts are blocked and explicit development mode still works', () => {
  assert.equal(shouldBlockDevToolsInput({ type: 'keyDown', key: 'F12' }, false), true)
  assert.equal(shouldBlockDevToolsInput({ type: 'keyDown', key: 'I', control: true, shift: true }, false), true)
  assert.equal(shouldBlockDevToolsInput({ type: 'keyDown', key: 'I', meta: true, shift: true }, false), true)
  assert.equal(shouldBlockDevToolsInput({ type: 'keyDown', key: 'F12' }, true), false)
  assert.equal(shouldBlockDevToolsInput({ type: 'keyUp', key: 'R', control: true }, false), false)
})

test('IPC guard rejects foreign contents, child frames, and untrusted URLs with PERMISSION_DENIED', () => {
  const main = { url: 'http://127.0.0.1:5174/' }
  const frame = { url: main.url }
  const event = { sender: main, senderFrame: frame }
  const guard = createMainIpcGuard(value => value === event)
  assert.doesNotThrow(() => guard(event))
  for (const rejected of [undefined, { sender: {}, senderFrame: frame }, { sender: main, senderFrame: {} }]) {
    assert.throws(() => guard(rejected), error => error.code === 'PERMISSION_DENIED')
  }
})

test('navigation details support Electron object events without confusing isSameDocument for isMainFrame', () => {
  const event = { url: 'https://example.com/next', isSameDocument: false, isMainFrame: true, preventDefault() {} }
  assert.deepEqual(readNavigationDetails(event, 'https://ignored.example/', false), {
    event,
    url: 'https://example.com/next',
    isMainFrame: true,
  })
  const child = { ...event, isMainFrame: false }
  assert.equal(readNavigationDetails(child).isMainFrame, false)
})

test('navigation details retain the deprecated positional event contract', () => {
  const event = { preventDefault() {} }
  assert.deepEqual(readNavigationDetails(event, 'https://example.com/frame', false), {
    event,
    url: 'https://example.com/frame',
    isMainFrame: false,
  })
  assert.equal(readNavigationDetails(event, undefined, undefined).isMainFrame, false)
})

test('Main wires navigation, partition, permission, download, popup, and lifecycle controls', () => {
  const source = readFileSync(new URL('../../../apps/desktop/src/main.js', import.meta.url), 'utf8')
  for (const evidence of [
    'session.fromPartition(partition)',
    "wc.setWindowOpenHandler(() => ({ action: 'deny' }))",
    'wc.close({ waitForBeforeUnload: false })',
    "listen('will-navigate'",
    "listen('will-frame-navigate'",
    "listen('will-redirect'",
    "isolatedSession.setPermissionCheckHandler(permissionGuards.check)",
    "isolatedSession.setPermissionRequestHandler(permissionGuards.request)",
    "isolatedSession.on('will-download', rejectDownload)",
    "listen('render-process-gone', () => disposeBrowserView())",
    'disposeBrowserView()',
    'readNavigationDetails(eventOrDetails, legacyUrl, legacyIsMainFrame)',
    "ipcMain.handle('shell:open-external'",
    'createExternalUrlIpcHandler(',
    'wc.setWindowOpenHandler(createExternalUrlHandler(',
  ]) assert.ok(source.includes(evidence), evidence)
  assert.doesNotMatch(source, /ipcMain\.handle\([^\n]+, \(_event/)
  assert.doesNotMatch(source, /will-frame-navigate', \(event, url, isMainFrame\)/)
  assert.match(source, /wc\.on\('will-navigate'[\s\S]*isTrustedRendererUrl\(navigation\.url, rendererUrl\)/)
})

test('real-machine probes cover process cleanup and persistent partition restart evidence', () => {
  const resources = readFileSync(new URL('../../../apps/desktop/scripts/browser-security-probe.cjs', import.meta.url), 'utf8')
  for (const evidence of [
    'getOSProcessId()', 'tasklist', 'cycle < 3', 'waitForBeforeUnload: false', 'baselineContents',
    'SetCursorPos', 'mouse_event(0x0002', 'mouse_event(0x0004', 'safeClickTrusted', 'ipcClickTrusted',
    'createExternalUrlHandler(', 'createExternalUrlIpcHandler(', 'externalLinksCreatedWindows',
  ]) {
    assert.ok(resources.includes(evidence), evidence)
  }
  const restart = readFileSync(new URL('../../../apps/desktop/scripts/browser-partition-restart-probe.cjs', import.meta.url), 'utf8')
  for (const evidence of [
    'browserPartitionForWorkspace(workspaceId, true)',
    "mode === 'seed'",
    "mode === 'verify'",
    'Max-Age=3600',
    'sessionStorage.setItem',
    'flushStorageData()',
    'controlSession',
  ]) assert.ok(restart.includes(evidence), evidence)
})

test('Main awaits runtime shutdown before completing application quit', () => {
  const source = readFileSync(new URL('../../../apps/desktop/src/main.js', import.meta.url), 'utf8')
  assert.match(source, /app\.on\('before-quit', \(event\) => \{[\s\S]*?event\.preventDefault\(\)[\s\S]*?await runtime\.stop\(\)[\s\S]*?app\.quit\(\)/)
  assert.match(source, /allowDevelopmentFallback: !app\.isPackaged/)
})

test('preload does not expose browser IPC before the browser gate', () => {
  const source = readFileSync(new URL('../../../apps/desktop/src/preload.cjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /browser(?:Show|Hide|Bounds|Navigate|Back|Forward|Reload|State)|browser:/)
  assert.match(source, /Browser IPC intentionally stays unexposed/)
  assert.match(source, /exposeInMainWorld\('ompStudioChrome'/)
  assert.match(source, /openUrl: \(payload\) => ipcRenderer\.invoke\('shell:open-external', payload\)/)
})
