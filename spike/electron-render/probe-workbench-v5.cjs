/**
 * 真机探测：附件在消息气泡里的渲染。
 *
 * 这一轮要验证的是「发一张图 → 回显气泡里出现缩略图」，而不是只有 chip。
 * 图片用 canvas 现场生成，不依赖磁盘上的样本文件。
 *
 * 三轮：
 *   A 基础：输入框与附件按钮就位
 *   B 上传：canvas 生成 PNG → File → 塞进 file input → chip 变 ready
 *   C 回显：发送 → 等消息落定 → 出现 message-attachment-image 且 src 是 blob:
 *
 * 所有元素定位都**限定在可见 composer / 可见 pane 内**：保活的隐藏标签也在
 * DOM 里（hidden 而非卸载），全局 querySelectorAll 会给出假信号。
 */

const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const url = process.argv[2]
const OUT = 'F:\\workbuddy data\\tmp\\studio-probe'
const LOG = path.join(OUT, 'probe-v5.log')

fs.mkdirSync(OUT, { recursive: true })
try {
  fs.unlinkSync(LOG)
} catch {}

function log(line) {
  fs.appendFileSync(LOG, line + '\n', 'utf8')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, offscreen: false },
  })

  win.webContents.on('console-message', (_e, level, message) => {
    if (/studio|attachment|Error|Warning/i.test(message)) log(`[console:${level}] ${message}`)
  })

  await win.loadURL(url)
  await sleep(3500)

  const run = (code) => win.webContents.executeJavaScript(code, true)

  // ── Phase A：基础 ─────────────────────────────────────────────
  const base = await run(`(() => {
    const visible = (el) => el && el.offsetParent !== null
    const attach = Array.from(document.querySelectorAll('[data-testid="studio-composer-attach"]')).find(visible)
    return {
      hasComposer: !!Array.from(document.querySelectorAll('[data-testid="studio-composer"]')).find(visible),
      hasAttach: !!attach,
      attachDisabled: attach ? attach.disabled : null,
      hasSessionPane: !!Array.from(document.querySelectorAll('[data-testid="session-pane"]')).find(visible),
    }
  })()`)
  log('[phaseA] ' + JSON.stringify(base))

  // 新建一个干净会话，避免污染已有对话
  await run(`(() => {
    const visible = (el) => el && el.offsetParent !== null
    const btn = Array.from(document.querySelectorAll('button')).find(
      (b) => visible(b) && /新对话|新建/.test(b.textContent || ''),
    )
    if (btn) btn.click()
    return !!btn
  })()`)
  await sleep(2500)

  // ── Phase B：生成 PNG 并上传 ──────────────────────────────────
  const uploaded = await run(`(async () => {
    const visible = (el) => el && el.offsetParent !== null
    const composer = Array.from(document.querySelectorAll('[data-testid="studio-composer"]')).find(visible)
    if (!composer) return { fatal: '找不到可见 composer' }
    const input = composer.querySelector('[data-testid="studio-composer-file-input"]')
    if (!input) return { fatal: '找不到 file input' }

    // canvas 生成一张 200x140 的 PNG（带明显色块，截图里一眼能认出来）
    const canvas = document.createElement('canvas')
    canvas.width = 200
    canvas.height = 140
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#3b6ea5'
    ctx.fillRect(0, 0, 200, 140)
    ctx.fillStyle = '#f5c451'
    ctx.fillRect(20, 20, 160, 100)
    ctx.fillStyle = '#2c2c2a'
    ctx.font = 'bold 22px sans-serif'
    ctx.fillText('STUDIO', 40, 80)

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) return { fatal: 'canvas.toBlob 失败' }
    const file = new File([blob], 'probe-shot.png', { type: 'image/png' })

    const dt = new DataTransfer()
    dt.items.add(file)
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))

    // 等上传完成
    let chip = null
    let status = null
    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 200))
      chip = composer.querySelector('[data-testid="studio-composer-attachment"]')
      status = chip ? chip.getAttribute('data-status') : null
      if (status === 'ready' || status === 'failed') break
    }
    return {
      blobBytes: blob.size,
      chipStatus: status,
      chipText: chip ? (chip.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60) : null,
      attachDisabled: (() => {
        const a = Array.from(document.querySelectorAll('[data-testid="studio-composer-attach"]')).find(visible)
        return a ? a.disabled : null
      })(),
    }
  })()`)
  log('[phaseB] ' + JSON.stringify(uploaded))

  // ── Phase C：发送并等回显 ────────────────────────────────────
  const sent = await run(`(async () => {
    const visible = (el) => el && el.offsetParent !== null
    const snapshot = () => {
      const pane = Array.from(document.querySelectorAll('[data-testid="session-pane"]')).find(visible)
      if (!pane) return null
      return {
        sessionId: pane.getAttribute('data-session-id'),
        images: pane.querySelectorAll('[data-testid="message-attachment-image"]').length,
        imageSrcs: Array.from(pane.querySelectorAll('[data-testid="message-attachment-image"] img'))
          .map((img) => (img.getAttribute('src') || '').slice(0, 12)),
        chips: pane.querySelectorAll('[data-testid="message-attachment-file"]').length,
        failedChips: pane.querySelectorAll('[data-testid="message-attachment-file"][data-failed="true"]').length,
        userTexts: Array.from(pane.querySelectorAll('[data-role="user"]'))
          .map((n) => (n.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60)),
      }
    }

    const before = snapshot()

    const input = Array.from(document.querySelectorAll('[data-testid="studio-composer-input"]')).find(visible)
    if (!input) return { fatal: '找不到输入框' }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(input, '图片附件自检：这条带一张 canvas 生成的图')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 200))

    const send = Array.from(document.querySelectorAll('[data-testid="studio-composer-send"]')).find(visible)
    if (!send || send.disabled) return { fatal: '发送按钮不可用', disabled: send ? send.disabled : null }
    send.click()

    // 等图片真的渲染出来（读取字节 + blob URL 有延迟）
    let after = null
    for (let i = 0; i < 60; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      after = snapshot()
      if (after && after.images > 0) break
    }

    const errs = Array.from(document.querySelectorAll('[data-testid="studio-composer-error"]')).filter(visible)
    return {
      before,
      after,
      error: errs.length ? (errs[0].textContent || '').trim() : null,
    }
  })()`)
  log('[phaseC] ' + JSON.stringify(sent))

  // 判定先做：截图可能因为 GPU/合成器问题抛 UnknownVizError，
  // 不能因为拿不到截图就把已经拿到的结论丢掉。
  const renderedImage = !!sent.after && sent.after.images > 0
  const isBlob = !!sent.after && sent.after.imageSrcs.every((s) => s.startsWith('blob:'))
  const uploadedOk = uploaded.chipStatus === 'ready'
  const noFailure = (sent.after ? sent.after.failedChips : 1) === 0

  log(
    '[verdict] ' +
      (uploadedOk && renderedImage && isBlob && noFailure ? 'PASS' : 'FAIL') +
      ` (上传=${uploadedOk} 渲染=${renderedImage} blob=${isBlob} 无降级=${noFailure})`,
  )

  await sleep(1200)
  try {
    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(OUT, 'workbench-v5.png'), image.toPNG())
    log('[shot] ok')
  } catch (error) {
    // 截图失败不影响结论；换一次带 rect 的调用再试一遍。
    try {
      const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1400, height: 900 })
      fs.writeFileSync(path.join(OUT, 'workbench-v5.png'), image.toPNG())
      log('[shot] ok (retry)')
    } catch (retryError) {
      log('[shot] failed: ' + String(retryError))
    }
    void error
  }

  await sleep(500)
  win.destroy()
  app.quit()
}

app.whenReady().then(() =>
  main().catch((error) => {
    log('[fatal] ' + (error && error.stack ? error.stack : String(error)))
    app.quit()
  }),
)
