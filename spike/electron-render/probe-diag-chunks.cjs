/**
 * 诊断：真机的 transient 里到底有哪些 chunk.type。
 *
 * 背景：思考过程（`reasoning-delta`）在 haiku-5-5 与 minimax-m3 两个模型上都没
 * 出现开关。不能猜"模型不支持"—— 先把窗口里真实出现过的 chunk 类型数出来。
 *
 * 采样直接读 `lease.binding.eventSource` 的窗口，统计尾部 transient 段里
 * `data.chunk.type` 的分布，并记录 attemptId 的切换次数（切换会清空累计）。
 */

const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const url = process.argv[2]
const OUT = 'F:\\workbuddy data\\tmp\\studio-probe'
const LOG = path.join(OUT, 'probe-diag-chunks.log')

fs.mkdirSync(OUT, { recursive: true })
try {
  fs.unlinkSync(LOG)
} catch {}

const log = (line) => fs.appendFileSync(LOG, line + '\n', 'utf8')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PROBE = [
  '(async () => {',
  '  const visible = (el) => el && el.offsetParent !== null',
  '  const byId = (id) => Array.from(document.querySelectorAll("[data-testid=\\"" + id + "\\"]")).find(visible)',
  '  const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms))',
  '',
  '  const dbg = window.__STUDIO_DEBUG__',
  '  const windowOf = () => {',
  '    const pane = Array.from(document.querySelectorAll("[data-testid=\\"session-pane\\"]")).find(visible)',
  '    const activeId = pane ? pane.getAttribute("data-session-id") : null',
  '    const lease = dbg.inspect().find((l) => String(l.target) === String(activeId))',
  '    if (!lease || !lease.binding || !lease.binding.eventSource) return null',
  '    return lease.binding.eventSource.getSnapshot()',
  '  }',
  '',
  '  const input = byId("studio-composer-input")',
  '  if (!input) return { fatal: "no input" }',
  '  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set',
  '  setter.call(input, "先仔细思考一下：包管理器 lockfile 有哪几种格式，各自优缺点是什么？想清楚再回答，回答要简短。")',
  '  input.dispatchEvent(new Event("input", { bubbles: true }))',
  '  await sleepMs(300)',
  '',
  '  const send = byId("studio-composer-send")',
  '  if (!send || send.disabled) return { fatal: "send disabled" }',
  '  send.click()',
  '',
  '  const chunkTypes = {}      // 全局累计见过的 chunk.type',
  '  const eventTypes = {}      // 全局累计见过的 transient event.type',
  '  const attemptIds = new Set()',
  '  let maxTailLength = 0',
  '  let latestTailTypes = []',
  '  let latestEntryTypes = []',
  '  let hasEntryButNoChunk = 0',
  '',
  '  for (let i = 0; i < 900; i += 1) {',
  '    await sleepMs(50)',
  '    const w = windowOf()',
  '    if (!w) continue',
  '    // 尾部连续 transient 段（与 readLiveStream 的取法一致）',
  '    const tail = []',
  '    for (let k = w.entries.length - 1; k >= 0; k -= 1) {',
  '      const e = w.entries[k]',
  '      if (!e || e.type !== "transient") break',
  '      tail.push(e)',
  '    }',
  '    tail.reverse()',
  '    if (tail.length > maxTailLength) maxTailLength = tail.length',
  '    if (tail.length === 0) continue',
  '',
  '    const types = []',
  '    for (const e of tail) {',
  '      const ev = e.event || {}',
  '      eventTypes[ev.type] = (eventTypes[ev.type] || 0) + 1',
  '      const d = ev.data || {}',
  '      if (d.attemptId !== undefined) attemptIds.add(String(d.attemptId))',
  '      const c = d.chunk',
  '      if (!c) { hasEntryButNoChunk += 1; types.push("(no-chunk)"); continue }',
  '      chunkTypes[c.type] = (chunkTypes[c.type] || 0) + 1',
  '      types.push(c.type)',
  '    }',
  '    latestTailTypes = types.slice(-12)',
  '    latestEntryTypes = tail.slice(-6).map((e) => (e.event || {}).type)',
  '  }',
  '',
  '  return {',
  '    chunkTypes,',
  '    eventTypes,',
  '    attemptCount: attemptIds.size,',
  '    maxTailLength,',
  '    hasEntryButNoChunk,',
  '    latestTailTypes,',
  '    latestEntryTypes,',
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
  await sleep(4000)
  const run = (code) => win.webContents.executeJavaScript(code, true)

  await run(
    [
      '(() => {',
      '  const visible = (el) => el && el.offsetParent !== null',
      '  const btn = Array.from(document.querySelectorAll("button")).find(',
      '    (b) => visible(b) && /新对话|新建/.test(b.textContent || ""),',
      '  )',
      '  if (btn) btn.click()',
      '  return !!btn',
      '})()',
    ].join('\n'),
  )
  await sleep(2500)

  const result = await run(PROBE)
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
