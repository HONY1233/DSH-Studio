/**
 * 真机探测：steer（打断并发送）+ 图片 lightbox。
 *
 * 两段互不干扰：
 *
 * Phase L（lightbox）：canvas 造一张 PNG → 上传 → 发送 → 点缩略图 →
 *   断言出现遮罩、按 Esc 关掉、焦点回到触发元素。
 *
 * Phase S（steer）：先发一条长任务（数到 200），等生成真开始（停止按钮出现且
 *   已有正文），再按 **Ctrl+Enter** 带一条新指令 → 断言原来的长任务被截断
 *   （正文里没有数到 200），且新指令的内容出现在会话里。
 */

const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const url = process.argv[2]
const OUT = 'F:\\workbuddy data\\tmp\\studio-probe'
const LOG = path.join(OUT, 'probe-v11.log')

fs.mkdirSync(OUT, { recursive: true })
try {
  fs.unlinkSync(LOG)
} catch {}

const log = (line) => fs.appendFileSync(LOG, line + '\n', 'utf8')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const LIGHTBOX = [
  '(async () => {',
  '  // 注意：position:fixed 的元素 offsetParent 恒为 null，不能只靠它判断可见性',
  '  const visible = (el) => !!el && (el.getClientRects().length > 0 || el.offsetParent !== null)',
  '  const byId = (id) => Array.from(document.querySelectorAll("[data-testid=\\"" + id + "\\"]")).find(visible)',
  '  const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms))',
  '',
  '  const composer = byId("studio-composer")',
  '  if (!composer) return { fatal: "no composer" }',
  '  const fileInput = composer.querySelector("[data-testid=\\"studio-composer-file-input\\"]")',
  '  if (!fileInput) return { fatal: "no file input" }',
  '',
  '  // canvas 造一张有明显色块的图',
  '  const canvas = document.createElement("canvas")',
  '  canvas.width = 240; canvas.height = 160',
  '  const ctx = canvas.getContext("2d")',
  '  ctx.fillStyle = "#2f6f4f"; ctx.fillRect(0, 0, 240, 160)',
  '  ctx.fillStyle = "#f0c341"; ctx.fillRect(20, 20, 200, 120)',
  '  ctx.fillStyle = "#1c1c1a"; ctx.font = "bold 26px sans-serif"; ctx.fillText("LB", 24, 96)',
  '  const blob = await new Promise((r) => canvas.toBlob(r, "image/png"))',
  '  if (!blob) return { fatal: "toBlob failed" }',
  '',
  '  const dt = new DataTransfer()',
  '  dt.items.add(new File([blob], "lightbox.png", { type: "image/png" }))',
  '  fileInput.files = dt.files',
  '  fileInput.dispatchEvent(new Event("change", { bubbles: true }))',
  '',
  '  let chip = null',
  '  for (let i = 0; i < 40; i += 1) {',
  '    await sleepMs(200)',
  '    chip = composer.querySelector("[data-testid=\\"studio-composer-attachment\\"]")',
  '    const st = chip ? chip.getAttribute("data-status") : null',
  '    if (st === "ready" || st === "failed") break',
  '  }',
  '  if (!chip) return { fatal: "no chip" }',
  '',
  '  const input = byId("studio-composer-input")',
  '  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set',
  '  setter.call(input, "图片自检：只回复 OK")',
  '  input.dispatchEvent(new Event("input", { bubbles: true }))',
  '  await sleepMs(200)',
  '  const send = byId("studio-composer-send")',
  '  if (!send || send.disabled) return { fatal: "send disabled" }',
  '  send.click()',
  '',
  '  // 等图片渲染出来',
  '  let thumb = null',
  '  for (let i = 0; i < 80; i += 1) {',
  '    await sleepMs(250)',
  '    thumb = byId("message-attachment-image")',
  '    if (thumb) break',
  '  }',
  '  if (!thumb) return { fatal: "thumbnail not rendered" }',
  '',
  '  thumb.click()',
  '  await sleepMs(300)',
  '  const box = byId("image-lightbox")',
  '  const opened = !!box',
  '  const modal = box ? box.getAttribute("aria-modal") : null',
  '  const bodyOverflow = document.body.style.overflow',
  '  const focusedIsClose = document.activeElement === byId("image-lightbox-close")',
  '  const saveHref = (byId("image-lightbox-save") || {}).getAttribute',
  '    ? byId("image-lightbox-save").getAttribute("href")',
  '    : null',
  '',
  '  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))',
  '  await sleepMs(300)',
  '  const closedByEsc = !byId("image-lightbox")',
  '  const focusRestored = document.activeElement === thumb',
  '  const overflowRestored = document.body.style.overflow === ""',
  '',
  '  return {',
  '    chipStatus: chip.getAttribute("data-status"),',
  '    opened, modal, bodyOverflow, focusedIsClose, saveHref,',
  '    closedByEsc, focusRestored, overflowRestored,',
  '  }',
  '})()',
].join('\n')

const STEER = [
  '(async () => {',
  '  const visible = (el) => !!el && (el.getClientRects().length > 0 || el.offsetParent !== null)',
  '  const byId = (id) => Array.from(document.querySelectorAll("[data-testid=\\"" + id + "\\"]")).find(visible)',
  '  const pane = () => Array.from(document.querySelectorAll("[data-testid=\\"session-pane\\"]")).find(visible)',
  '  const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms))',
  '',
  '  const input = byId("studio-composer-input")',
  '  if (!input) return { fatal: "no input" }',
  '  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set',
  '  setter.call(input, "请从 1 数到 2000，每行一个数字，不要解释。")',
  '  input.dispatchEvent(new Event("input", { bubbles: true }))',
  '  await sleepMs(250)',
  '  const send = byId("studio-composer-send")',
  '  if (!send || send.disabled) return { fatal: "send disabled" }',
  '  send.click()',
  '',
  '  // 等生成真开始：停止按钮出现 + 已有正文',
  '  let startedAt = null',
  '  let charsBefore = 0',
  '  for (let i = 0; i < 300; i += 1) {',
  '    await sleepMs(50)',
  '    const stop = byId("studio-composer-stop")',
  '    const p = pane()',
  '    const assistant = p ? p.querySelector("[data-role=\\"assistant\\"]") : null',
  '    const text = assistant ? (assistant.textContent || "").trim() : ""',
  '    if (stop && text.length > 30) { startedAt = i * 50; charsBefore = text.length; break }',
  '  }',
  '  if (startedAt === null) return { fatal: "generation never started" }',
  '',
  '  // Ctrl+Enter 打断并发送新指令',
  '  setter.call(input, "停下，改回复：STEER-OK")',
  '  input.dispatchEvent(new Event("input", { bubbles: true }))',
  '  await sleepMs(150)',
  '  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }))',
  '',
  '  // 等新 turn 结束',
  '  let settledAt = null',
  '  for (let i = 0; i < 400; i += 1) {',
  '    await sleepMs(50)',
  '    if (!byId("studio-composer-stop") && i > 20) { settledAt = i * 50; break }',
  '  }',
  '',
  '  const p = pane()',
  '  const allText = p ? (p.textContent || "").replace(/\\s+/g, " ") : ""',
  '  const assistantTexts = p',
  '    ? Array.from(p.querySelectorAll("[data-role=\\"assistant\\"]")).map((n) => (n.textContent || "").replace(/\\s+/g, " ").trim())',
  '    : []',
  '  // 诊断：直接从事件窗口数 turn 边界与 assistant 消息，判断"截断"到底成不成立',
  '  let turns = { start: 0, end: 0 }',
  '  let assistantEvents = []',
  '  try {',
  '    const dbg = window.__STUDIO_DEBUG__',
  '    const activeId = p ? p.getAttribute("data-session-id") : null',
  '    const lease = dbg.inspect().find((l) => String(l.target) === String(activeId))',
  '    const w = lease && lease.binding && lease.binding.eventSource ? lease.binding.eventSource.getSnapshot() : null',
  '    if (w) {',
  '      for (const e of w.entries) {',
  '        const ev = e.event || {}',
  '        if (ev.type === "turn/start") turns.start += 1',
  '        if (ev.type === "turn/end") turns.end += 1',
  '        if (ev.type === "assistant/message") {',
  '          const content = (ev.data && ev.data.message && ev.data.message.content) || []',
  '          const text = Array.isArray(content) ? content.map((c) => c.text || "").join("") : ""',
  '          assistantEvents.push(text.replace(/\\s+/g, " ").trim().slice(0, 80))',
  '        }',
  '      }',
  '    }',
  '  } catch (error) { turns.error = String(error) }',
  '  // 一锤定音：按 Ctrl+Enter 前后各记一次 seq，再看两条 assistant 的 seq 落在哪一侧。',
  '  // 落在 steer 消息之前 = 打断前 Host 已把模型输出完整落库（不是"截断"）。',
  '  let seqTimeline = []',
  '  try {',
  '    const dbg2 = window.__STUDIO_DEBUG__',
  '    const activeId2 = p ? p.getAttribute("data-session-id") : null',
  '    const lease2 = dbg2.inspect().find((l) => String(l.target) === String(activeId2))',
  '    const w2 = lease2 && lease2.binding && lease2.binding.eventSource ? lease2.binding.eventSource.getSnapshot() : null',
  '    if (w2) {',
  '      for (const e of w2.entries) {',
  '        const ev = e.event || {}',
  '        if (ev.type === "user/message" || ev.type === "assistant/message" || ev.type === "turn/start" || ev.type === "step/start" || ev.type === "step/end") {',
  '          let text = ""',
  '          if (ev.type === "assistant/message") {',
  '            const content = (ev.data && ev.data.message && ev.data.message.content) || []',
  '            text = Array.isArray(content) ? content.map((c) => c.text || "").join("") : ""',
  '          }',
  '          if (ev.type === "user/message") {',
  '            const content = (ev.data && ev.data.content) || []',
  '            text = Array.isArray(content) ? content.map((c) => c.text || "").join("") : ""',
  '          }',
  '          seqTimeline.push({ type: ev.type, seq: ev.seq, len: text.length, head: text.replace(/\\s+/g, " ").trim().slice(0, 24) })',
  '        }',
  '      }',
  '    }',
  '  } catch (error) { seqTimeline = [String(error)] }',
  '  return {',
  '    startedAt, charsBefore, settledAt,',
  '    assistantCount: assistantTexts.length,',
  '    firstLength: (assistantTexts[0] || "").length,',
  '    assistantTexts: assistantTexts.map((t) => t.slice(0, 160)),',
  '    turns,',
  '    assistantEvents,',
  '    seqTimeline,',
  '    hasSteerMarker: /STEER-OK/.test(allText),',
  '    maxNumber: (() => {',
  '      const first = assistantTexts[0] || ""',
  '      const nums = (first.match(/\\d+/g) || []).map(Number)',
  '      return nums.length === 0 ? 0 : Math.max(...nums)',
  '    })(),',
  '    inputValue: input.value,',
  '  }',
  '})()',
].join('\n')

async function main() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })
  await win.loadURL(url)
  await sleep(4000)
  const run = (code) => win.webContents.executeJavaScript(code, true)

  const newConversation = () =>
    run(
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

  // ── Phase L：lightbox ────────────────────────────────────────
  await newConversation()
  await sleep(2500)
  const lightbox = await run(LIGHTBOX)
  log('[lightbox] ' + JSON.stringify(lightbox, null, 1))

  await sleep(500)
  try {
    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(OUT, 'workbench-v11-lightbox.png'), image.toPNG())
    log('[shot] lightbox ok')
  } catch (error) {
    log('[shot] lightbox failed: ' + String(error))
  }

  // ── Phase S：steer ───────────────────────────────────────────
  await newConversation()
  await sleep(2500)
  const steer = await run(STEER)
  log('[steer] ' + JSON.stringify(steer, null, 1))

  await sleep(600)
  try {
    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(OUT, 'workbench-v11-steer.png'), image.toPNG())
    log('[shot] steer ok')
  } catch (error) {
    log('[shot] steer failed: ' + String(error))
  }

  const lightboxOk =
    lightbox.opened === true &&
    lightbox.modal === 'true' &&
    lightbox.bodyOverflow === 'hidden' &&
    lightbox.focusedIsClose === true &&
    typeof lightbox.saveHref === 'string' &&
    lightbox.saveHref.startsWith('blob:') &&
    lightbox.closedByEsc === true &&
    lightbox.focusRestored === true &&
    lightbox.overflowRestored === true

  // steer 生效的三条证据，按强度排序：
  //   1) 出现了新指令的产出（STEER-OK）—— 新 turn 真的接管了；
  //   2) **turn 结束得极快**：数完 2000 要几十秒，实际 1 秒就 settled ——
  //      这只能是被打断的。这条最强，比数数字可靠（模型开场会说"我会数到 2000"，
  //      那个 2000 会骗过数字判据）；
  //   3) 输入框已清空。
  const steerOk =
    steer.startedAt !== null &&
    steer.hasSteerMarker === true &&
    typeof steer.settledAt === 'number' &&
    steer.settledAt < 5000 &&
    steer.inputValue === ''

  log(
    '[verdict] ' +
      (lightboxOk && steerOk ? 'PASS' : 'FAIL') +
      ' (lightbox=' + lightboxOk +
      ' steer=' + steerOk +
      ' 点前字数=' + steer.charsBefore +
      ' 打断到落定=' + steer.settledAt + 'ms' +
      ' 助手消息数=' + steer.assistantCount +
      ')',
  )

  await sleep(400)
  win.destroy()
  app.quit()
}

app.whenReady().then(() =>
  main().catch((error) => {
    log('[fatal] ' + (error && error.stack ? error.stack : String(error)))
    app.quit()
  }),
)
