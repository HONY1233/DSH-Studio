/**
 * 真机探测：停止按钮。
 *
 * 难点是**抓到 running=true 的窗口**。做法是发一条明确要求长输出的提示
 * （数到 50），生成过程会持续十几秒，足够轮询到停止按钮出现。
 *
 * 判据：
 *   1. 生成中停止按钮出现，且发送按钮仍可用（排队能力没被夺走）
 *   2. 点击后按钮进入「停止中…」并禁用
 *   3. running 落回 false 后按钮消失
 *   4. 没有出现错误提示
 *
 * 这一轮是写操作：新建一个会话，不碰已有对话。
 */

const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const url = process.argv[2]
const OUT = 'F:\\workbuddy data\\tmp\\studio-probe'
const LOG = path.join(OUT, 'probe-v6.log')

fs.mkdirSync(OUT, { recursive: true })
try {
  fs.unlinkSync(LOG)
} catch {}

const log = (line) => fs.appendFileSync(LOG, line + '\n', 'utf8')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })

  win.webContents.on('console-message', (_e, level, message) => {
    if (/studio|Error|Uncaught/i.test(message)) log(`[console:${level}] ${message}`)
  })

  await win.loadURL(url)
  await sleep(3500)
  const run = (code) => win.webContents.executeJavaScript(code, true)

  // ── 新建干净会话 ────────────────────────────────────────────
  await run(`(() => {
    const visible = (el) => el && el.offsetParent !== null
    const btn = Array.from(document.querySelectorAll('button')).find(
      (b) => visible(b) && /新对话|新建/.test(b.textContent || ''),
    )
    if (btn) btn.click()
    return !!btn
  })()`)
  await sleep(2500)

  // ── 发一条长任务，制造 running 窗口 ─────────────────────────
  const started = await run(`(async () => {
    const visible = (el) => el && el.offsetParent !== null
    const input = Array.from(document.querySelectorAll('[data-testid="studio-composer-input"]')).find(visible)
    if (!input) return { fatal: '找不到输入框' }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(input, '请从 1 数到 50，每行只写一个数字，不要任何解释。')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 200))

    const send = Array.from(document.querySelectorAll('[data-testid="studio-composer-send"]')).find(visible)
    if (!send || send.disabled) return { fatal: '发送按钮不可用' }
    send.click()
    return { clicked: true }
  })()`)
  log('[start] ' + JSON.stringify(started))

  // ── 轮询 running 窗口 ──────────────────────────────────────
  const during = await run(`(async () => {
    const visible = (el) => el && el.offsetParent !== null
    const stopBtn = () => Array.from(document.querySelectorAll('[data-testid="studio-composer-stop"]')).find(visible)
    const sendBtn = () => Array.from(document.querySelectorAll('[data-testid="studio-composer-send"]')).find(visible)

    let appeared = null
    for (let i = 0; i < 100; i += 1) {
      await new Promise((r) => setTimeout(r, 100))
      const stop = stopBtn()
      if (stop) {
        appeared = {
          stopText: (stop.textContent || '').trim(),
          stopDisabled: stop.disabled,
          sendExists: !!sendBtn(),
          sendDisabledAtThatMoment: sendBtn() ? sendBtn().disabled : null,
        }
        break
      }
    }
    return { appeared, elapsedHint: 'polled up to 10s' }
  })()`)
  log('[during] ' + JSON.stringify(during))

  if (!during.appeared) {
    log('[verdict] FAIL (10 秒内没抓到 running 窗口)')
    await sleep(300)
    win.destroy()
    app.quit()
    return
  }

  // 截图：生成中（带停止按钮）
  await sleep(400)
  try {
    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(OUT, 'workbench-v6-running.png'), image.toPNG())
    log('[shot] running ok')
  } catch (error) {
    log('[shot] running failed: ' + String(error))
  }

  // ── 点停止 ────────────────────────────────────────────────
  const clicked = await run(`(async () => {
    const visible = (el) => el && el.offsetParent !== null
    const stop = Array.from(document.querySelectorAll('[data-testid="studio-composer-stop"]')).find(visible)
    if (!stop) return { fatal: '停止按钮已消失' }
    stop.click()
    await new Promise((r) => setTimeout(r, 250))
    const after = Array.from(document.querySelectorAll('[data-testid="studio-composer-stop"]')).find(visible)
    return {
      textRightAfterClick: after ? (after.textContent || '').trim() : null,
      disabledRightAfterClick: after ? after.disabled : null,
    }
  })()`)
  log('[click] ' + JSON.stringify(clicked))

  // ── 等 running 落回 false ─────────────────────────────────
  const settled = await run(`(async () => {
    const visible = (el) => el && el.offsetParent !== null
    const start = Date.now()
    for (let i = 0; i < 120; i += 1) {
      await new Promise((r) => setTimeout(r, 150))
      const stop = Array.from(document.querySelectorAll('[data-testid="studio-composer-stop"]')).find(visible)
      if (!stop) {
        const errs = Array.from(document.querySelectorAll('[data-testid="studio-composer-error"]')).filter(visible)
        const pane = Array.from(document.querySelectorAll('[data-testid="session-pane"]')).find(visible)
        return {
          clearedAfterMs: Date.now() - start,
          error: errs.length ? (errs[0].textContent || '').trim() : null,
          sessionId: pane ? pane.getAttribute('data-session-id') : null,
          assistantBubbles: pane ? pane.querySelectorAll('[data-role="assistant"]').length : -1,
          liveVisible: !!(pane && pane.querySelector('[data-testid="conversation-live"]')),
        }
      }
    }
    return { clearedAfterMs: null, timeout: true }
  })()`)
  log('[settled] ' + JSON.stringify(settled))

  await sleep(600)
  try {
    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(OUT, 'workbench-v6-stopped.png'), image.toPNG())
    log('[shot] stopped ok')
  } catch (error) {
    log('[shot] stopped failed: ' + String(error))
  }

  const appeared = during.appeared
  const showedStopping = clicked.textRightAfterClick === '停止中…' && clicked.disabledRightAfterClick === true
  const queueKept = appeared.sendExists === true
  const cleared = settled.clearedAfterMs !== null
  const noError = !settled.error

  log(
    '[verdict] ' +
      (queueKept && showedStopping && cleared && noError ? 'PASS' : 'FAIL') +
      ` (出现=${!!appeared} 排队保留=${queueKept} 停止中=${showedStopping} 已落定=${cleared} 无错误=${noError})` +
      (cleared ? ` 落定耗时=${settled.clearedAfterMs}ms` : ''),
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
