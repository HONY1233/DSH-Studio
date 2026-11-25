/**
 * 真机探测：工具结果「展开全文」+ 多图相册翻页。
 *
 * Phase T（工具结果全文）：
 *   让模型真的去 read_file 一个大文件（result 远超 400 字符）→ 等 chip 变 done
 *   → 展开 chip → 记录结果区文字长度（应约 400）→ 点「展开全文」→ 长度必须显著变长
 *   且按钮变成「收起全文」。
 *
 * Phase G（多图相册）：一次消息贴两张图 → 等两个缩略图 → 点第一张 →
 *   遮罩里计数应为 1 / 2 → 按 → 应变成 2 / 2 且图片换了 → Esc 关闭。
 *
 * 两段各用新对话，互不影响。
 */

const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const url = process.argv[2]
const OUT = 'F:\\workbuddy data\\tmp\\studio-probe'
const LOG = path.join(OUT, 'probe-v12.log')

fs.mkdirSync(OUT, { recursive: true })
try {
  fs.unlinkSync(LOG)
} catch {}

const log = (line) => fs.appendFileSync(LOG, line + '\n', 'utf8')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const TOOL_FULL = [
  '(async () => {',
  '  const visible = (el) => !!el && (el.getClientRects().length > 0 || el.offsetParent !== null)',
  '  const all = (id) => Array.from(document.querySelectorAll("[data-testid=\\"" + id + "\\"]")).filter(visible)',
  '  const one = (id) => all(id)[0]',
  '  const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms))',
  '',
  '  const input = one("studio-composer-input")',
  '  if (!input) return { fatal: "no input" }',
  '  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set',
  '  setter.call(input, "请用 read_file 工具读取 packages/studio-ui/src/shell/conversation-body.tsx 的完整内容，然后把文件原文贴出来。必须真的调用工具，不要凭记忆写。")',
  '  input.dispatchEvent(new Event("input", { bubbles: true }))',
  '  await sleepMs(200)',
  '  const send = one("studio-composer-send")',
  '  if (!send || send.disabled) return { fatal: "send disabled" }',
  '  send.click()',
  '',
  '  // 等出现一个已完成的工具 chip',
  '  let chip = null',
  '  const seen = []',
  '  for (let i = 0; i < 240; i += 1) {',
  '    await sleepMs(250)',
  '    const chips = all("tool-call")',
  '    const statuses = chips.map((c) => c.getAttribute("data-status"))',
  '    if (statuses.length && JSON.stringify(statuses) !== JSON.stringify(seen)) seen.push(statuses.join(","))',
  '    const done = chips.find((c) => {',
  '      const st = c.getAttribute("data-status")',
  '      return st === "done" || st === "error"',
  '    })',
  '    if (done) { chip = done; break }',
  '  }',
  '  if (!chip) return { fatal: "no finished tool chip", seen }',
  '',
  '  // 展开 chip：chip 本身是个 button',
  '  const trigger = chip.querySelector("button") || chip',
  '  trigger.click()',
  '  await sleepMs(300)',
  '  const detail = chip.querySelector("[data-testid=\\"tool-call-detail\\"]")',
  '  if (!detail) return { fatal: "detail not rendered", seen }',
  '  const pres = Array.from(detail.querySelectorAll("pre"))',
  '  const resultPre = pres[pres.length - 1]',
  '  const beforeChars = resultPre ? (resultPre.textContent || "").length : -1',
  '  const toggleBefore = chip.querySelector("[data-testid=\\"tool-call-result-toggle\\"]")',
  '  const toggleTextBefore = toggleBefore ? (toggleBefore.textContent || "").trim() : null',
  '',
  '  if (!toggleBefore) {',
  '    return { fatal: "no expand toggle", beforeChars, toolStatus: chip.getAttribute("data-status"), seen }',
  '  }',
  '',
  '  toggleBefore.click()',
  '  await sleepMs(400)',
  '  const presAfter = Array.from(detail.querySelectorAll("pre"))',
  '  const resultPreAfter = presAfter[presAfter.length - 1]',
  '  const afterChars = resultPreAfter ? (resultPreAfter.textContent || "").length : -1',
  '  const toggleAfter = chip.querySelector("[data-testid=\\"tool-call-result-toggle\\"]")',
  '  const toggleTextAfter = toggleAfter ? (toggleAfter.textContent || "").trim() : null',
  '  const clippedNote = chip.querySelector("[data-testid=\\"tool-call-result-clipped\\"]")',
  '  const errorShown = chip.querySelector("[data-testid=\\"tool-call-error\\"]")',
  '',
  '  return {',
  '    toolStatus: chip.getAttribute("data-status"),',
  '    beforeChars, afterChars, toggleTextBefore, toggleTextAfter,',
  '    clippedNote: clippedNote ? (clippedNote.textContent || "").trim().slice(0, 60) : null,',
  '    hasErrorLine: !!errorShown,',
  '    chipCount: all("tool-call").length,',
  '    seen,',
  '  }',
  '})()',
].join('\n')

const GALLERY = [
  '(async () => {',
  '  const visible = (el) => !!el && (el.getClientRects().length > 0 || el.offsetParent !== null)',
  '  const all = (id) => Array.from(document.querySelectorAll("[data-testid=\\"" + id + "\\"]")).filter(visible)',
  '  const one = (id) => all(id)[0]',
  '  const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms))',
  '',
  '  const composer = one("studio-composer")',
  '  if (!composer) return { fatal: "no composer" }',
  '  const fileInput = composer.querySelector("[data-testid=\\"studio-composer-file-input\\"]")',
  '',
  '  // 造两张颜色明显不同的图，方便肉眼核对换页',
  '  const make = async (label, bg, fg) => {',
  '    const canvas = document.createElement("canvas")',
  '    canvas.width = 240; canvas.height = 160',
  '    const ctx = canvas.getContext("2d")',
  '    ctx.fillStyle = bg; ctx.fillRect(0, 0, 240, 160)',
  '    ctx.fillStyle = fg; ctx.font = "bold 64px sans-serif"; ctx.fillText(label, 80, 105)',
  '    const blob = await new Promise((r) => canvas.toBlob(r, "image/png"))',
  '    return blob ? new File([blob], label + ".png", { type: "image/png" }) : null',
  '  }',
  '',
  '  const f1 = await make("A", "#2f6f4f", "#ffffff")',
  '  const f2 = await make("B", "#8a3b2e", "#ffffff")',
  '  if (!f1 || !f2) return { fatal: "toBlob failed" }',
  '',
  '  const upload = async (file) => {',
  '    const dt = new DataTransfer()',
  '    dt.items.add(file)',
  '    fileInput.files = dt.files',
  '    fileInput.dispatchEvent(new Event("change", { bubbles: true }))',
  '  }',
  '',
  '  await upload(f1)',
  '  for (let i = 0; i < 40; i += 1) {',
  '    await sleepMs(200)',
  '    const chips = Array.from(composer.querySelectorAll("[data-testid=\\"studio-composer-attachment\\"]"))',
  '    if (chips.length >= 1 && chips[0].getAttribute("data-status") === "ready") break',
  '  }',
  '  await upload(f2)',
  '  let readyChips = 0',
  '  for (let i = 0; i < 40; i += 1) {',
  '    await sleepMs(200)',
  '    const chips = Array.from(composer.querySelectorAll("[data-testid=\\"studio-composer-attachment\\"]"))',
  '    readyChips = chips.filter((c) => c.getAttribute("data-status") === "ready").length',
  '    if (readyChips >= 2) break',
  '  }',
  '',
  '  const input = one("studio-composer-input")',
  '  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set',
  '  setter.call(input, "相册自检：只回复 OK")',
  '  input.dispatchEvent(new Event("input", { bubbles: true }))',
  '  await sleepMs(200)',
  '  const send = one("studio-composer-send")',
  '  if (!send || send.disabled) return { fatal: "send disabled", readyChips }',
  '  send.click()',
  '',
  '  // 等两个缩略图',
  '  let thumbs = []',
  '  for (let i = 0; i < 120; i += 1) {',
  '    await sleepMs(250)',
  '    thumbs = all("message-attachment-image")',
  '    if (thumbs.length >= 2) break',
  '  }',
  '  if (thumbs.length < 2) return { fatal: "need 2 thumbnails", thumbs: thumbs.length, readyChips }',
  '',
  '  thumbs[0].click()',
  '  await sleepMs(350)',
  '  const box = one("image-lightbox")',
  '  if (!box) return { fatal: "lightbox not opened", thumbs: thumbs.length }',
  '  const counterEl = box.querySelector("[data-testid=\\"image-lightbox-counter\\"]")',
  '  const counterBefore = counterEl ? (counterEl.textContent || "").replace(/\\s+/g, "") : null',
  '  const imgBefore = box.querySelector("img") ? box.querySelector("img").getAttribute("src") : null',
  '',
  '  window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }))',
  '  await sleepMs(300)',
  '  const boxAfter = one("image-lightbox")',
  '  const counterAfterEl = boxAfter ? boxAfter.querySelector("[data-testid=\\"image-lightbox-counter\\"]") : null',
  '  const counterAfter = counterAfterEl ? (counterAfterEl.textContent || "").replace(/\\s+/g, "") : null',
  '  const imgAfter = boxAfter && boxAfter.querySelector("img") ? boxAfter.querySelector("img").getAttribute("src") : null',
  '',
  '  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))',
  '  await sleepMs(300)',
  '  const closed = !one("image-lightbox")',
  '',
  '  return {',
  '    thumbs: thumbs.length, readyChips,',
  '    counterBefore, counterAfter,',
  '    imgChanged: !!imgBefore && !!imgAfter && imgBefore !== imgAfter,',
  '    closed,',
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
        '  const visible = (el) => !!el && (el.getClientRects().length > 0 || el.offsetParent !== null)',
        '  const btn = Array.from(document.querySelectorAll("button")).find(',
        '    (b) => visible(b) && /新对话|新建/.test(b.textContent || ""),',
        '  )',
        '  if (btn) btn.click()',
        '  return !!btn',
        '})()',
      ].join('\n'),
    )

  // ── Phase T：工具结果全文 ────────────────────────────────────
  await newConversation()
  await sleep(2500)
  const tool = await run(TOOL_FULL)
  log('[tool] ' + JSON.stringify(tool, null, 1))

  await sleep(400)
  try {
    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(OUT, 'workbench-v12-tool-full.png'), image.toPNG())
    log('[shot] tool ok')
  } catch (error) {
    log('[shot] tool failed: ' + String(error))
  }

  // ── Phase G：多图相册 ───────────────────────────────────────
  await newConversation()
  await sleep(2500)
  const gallery = await run(GALLERY)
  log('[gallery] ' + JSON.stringify(gallery, null, 1))

  await sleep(400)
  try {
    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(OUT, 'workbench-v12-gallery.png'), image.toPNG())
    log('[shot] gallery ok')
  } catch (error) {
    log('[shot] gallery failed: ' + String(error))
  }

  // 工具全文生效 = 默认是短预览 + 点开后显著变长 + 按钮变成"收起"
  const toolOk =
    typeof tool.beforeChars === 'number' &&
    typeof tool.afterChars === 'number' &&
    tool.beforeChars > 0 &&
    tool.beforeChars <= 420 &&
    tool.afterChars > tool.beforeChars + 200 &&
    typeof tool.toggleTextBefore === 'string' &&
    tool.toggleTextBefore.indexOf('展开全文') === 0 &&
    tool.toggleTextAfter === '收起全文'

  // 相册生效 = 打开时计数对、按 → 换页且图片真的换了、Esc 能关
  const galleryOk =
    gallery.thumbs >= 2 &&
    gallery.counterBefore === '1/2' &&
    gallery.counterAfter === '2/2' &&
    gallery.imgChanged === true &&
    gallery.closed === true

  log(
    '[verdict] ' +
      (toolOk && galleryOk ? 'PASS' : 'FAIL') +
      ' (工具全文=' + toolOk + ' 预览字数=' + tool.beforeChars + ' 展开后=' + tool.afterChars +
      ' 相册=' + galleryOk + ' 计数=' + gallery.counterBefore + '→' + gallery.counterAfter +
      ' 换图=' + gallery.imgChanged + ')',
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
