/**
 * 诊断：直接数事件窗口里的条目类型，确认折叠没有漏消息。
 *
 * 起因：v9 里那个会话显示 1 条 user、0 条 assistant。要么会话本来就只有一问，
 * 要么折叠漏了 —— 必须区分，不能猜。
 */

const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const url = process.argv[2]
const OUT = 'F:\\workbuddy data\\tmp\\studio-probe'
const LOG = path.join(OUT, 'probe-diag.log')

try {
  fs.unlinkSync(LOG)
} catch {}

const log = (line) => fs.appendFileSync(LOG, line + '\n', 'utf8')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PROBE = [
  '(async () => {',
  '  const visible = (el) => el && el.offsetParent !== null',
  '  const byId = (id) => Array.from(document.querySelectorAll("[data-testid=\\"" + id + "\\"]")).find(visible)',
  '  for (let i = 0; i < 50; i += 1) {',
  '    await new Promise((r) => setTimeout(r, 200))',
  '    if (byId("conversation-body") || byId("conversation-empty")) break',
  '  }',
  '',
  '  const dbg = window.__STUDIO_DEBUG__',
  '  const pane = Array.from(document.querySelectorAll("[data-testid=\\"session-pane\\"]")).find(visible)',
  '  const activeId = pane ? pane.getAttribute("data-session-id") : null',
  '',
  '  const lease = dbg.inspect().find((l) => String(l.target) === String(activeId))',
  '  if (!lease || !lease.binding) return { fatal: "no lease", activeId }',
  '',
  '  const es = lease.binding.eventSource',
  '  const win = es && typeof es.getSnapshot === "function" ? es.getSnapshot() : null',
  '  if (!win) return { fatal: "no window" }',
  '',
  '  const types = {}',
  '  for (const e of win.entries) {',
  '    const t = e.event ? e.event.type : "non-event"',
  '    types[t] = (types[t] || 0) + 1',
  '  }',
  '',
  '  // user/message 的 source.kind 分布（决定 synthetic 判定）',
  '  const userKinds = {}',
  '  for (const e of win.entries) {',
  '    if (!e.event || e.event.type !== "user/message") continue',
  '    const k = (e.event.data && e.event.data.source && e.event.data.source.kind) || "unknown"',
  '    userKinds[k] = (userKinds[k] || 0) + 1',
  '  }',
  '',
  '  const derived = dbg.stats()',
  '  return {',
  '    sessionId: activeId ? String(activeId).slice(-12) : null,',
  '    entryCount: win.entries.length,',
  '    hasMore: win.hasMore,',
  '    types,',
  '    userKinds,',
  '    domMessages: (byId("conversation-body") || {}).getAttribute ? byId("conversation-body").getAttribute("data-messages") : null,',
  '    domAssistant: pane ? pane.querySelectorAll("[data-role=\\"assistant\\"]").length : -1,',
  '    foldStats: derived,',
  '  }',
  '})()',
].join('\n')

async function main() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })
  await win.loadURL(url)
  await sleep(3500)
  const result = await win.webContents.executeJavaScript(PROBE, true)
  log('[result] ' + JSON.stringify(result, null, 1))
  await sleep(300)
  win.destroy()
  app.quit()
}

app.whenReady().then(() =>
  main().catch((error) => {
    log('[fatal] ' + (error && error.stack ? error.stack : String(error)))
    app.quit()
  }),
)
