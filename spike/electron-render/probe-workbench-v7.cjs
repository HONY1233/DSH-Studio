/**
 * 真机探测：停止按钮（第二轮）。
 *
 * 上一轮（v6）抓到 stop 按钮出现，但 400ms 后截图时它已经消失，而且没有
 * assistant 消息 —— 说明 running 只持续了很短时间。不能再靠"看到按钮再截图"
 * 这种慢路径，必须**在同一段脚本里完成采样 + 点击**，同时把会话快照的
 * 全部生命周期字段记下来，才能判断到底发生了什么。
 *
 * 采样走 `__STUDIO_DEBUG__.inspect()` → `LeaseView.binding.session`
 * → `getSnapshot()`，字段名逐字来自 `contract/snapshot.d.ts`。
 */

const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const url = process.argv[2]
const OUT = 'F:\\workbuddy data\\tmp\\studio-probe'
const LOG = path.join(OUT, 'probe-v7.log')

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

  await win.loadURL(url)
  await sleep(3500)
  const run = (code) => win.webContents.executeJavaScript(code, true)

  // 新建会话
  await run(`(() => {
    const visible = (el) => el && el.offsetParent !== null
    const btn = Array.from(document.querySelectorAll('button')).find(
      (b) => visible(b) && /新对话|新建/.test(b.textContent || ''),
    )
    if (btn) btn.click()
    return !!btn
  })()`)
  await sleep(2500)

  // 发送 + 高频采样 + 抓到 running 立刻点停止，全程一次 executeJavaScript
  const result = await run(`(async () => {
    const visible = (el) => el && el.offsetParent !== null
    const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms))
    const dbg = window.__STUDIO_DEBUG__

    const sessionSnapshot = () => {
      try {
        const dbgLeases = dbg.inspect()
        // 必须按**当前可见会话**匹配：inspect() 返回所有保活的租约，
        // 取第一个会读到别的会话（上一轮就踩了这个：读到的 blank:false 其实是旧会话）。
        const pane = Array.from(document.querySelectorAll('[data-testid="session-pane"]')).find(visible)
        const activeId = pane ? pane.getAttribute('data-session-id') : null
        for (const lease of dbgLeases) {
          if (activeId !== null && lease.target !== activeId) continue
          const session = lease && lease.binding && lease.binding.session
          if (session && typeof session.getSnapshot === 'function') {
            const s = session.getSnapshot()
            return {
              target: String(lease.target).slice(-12),
              running: s.running === true,
              awaitingFirstTurn: s.awaitingFirstTurn === true,
              blank: s.blank === true,
              openState: s.openState,
              promptError: s.promptError ? (s.promptError.message || JSON.stringify(s.promptError)).slice(0, 160) : null,
              lastAgentError: s.lastAgentError ? String(s.lastAgentError).slice(0, 160) : null,
              pending: Array.isArray(s.pendingSubmissions) ? s.pendingSubmissions.length : -1,
            }
          }
        }
        return { noBinding: true, activeId: activeId ? String(activeId).slice(-12) : null, leaseCount: dbgLeases.length }
      } catch (error) {
        return { probeError: String(error) }
      }
    }

    const stopBtn = () => Array.from(document.querySelectorAll('[data-testid="studio-composer-stop"]')).find(visible)
    const sendBtn = () => Array.from(document.querySelectorAll('[data-testid="studio-composer-send"]')).find(visible)

    const input = Array.from(document.querySelectorAll('[data-testid="studio-composer-input"]')).find(visible)
    if (!input) return { fatal: '找不到输入框' }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(input, '请从 1 数到 200，每行只写一个数字，不要任何解释。')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await sleepMs(200)

    const before = sessionSnapshot()
    const send = sendBtn()
    if (!send || send.disabled) return { fatal: '发送按钮不可用' }
    send.click()

    // 高频采样：每 50ms 一次，最多 60 秒
    //
    // 停止按钮现在由**折叠事件流**驱动（`streaming`），不再依赖 `snapshot.running`
    // （真机实测那个布尔值 50ms 后就落回 false，而 turn 还在输出）。
    // 所以判据用「按钮本身是否还在」，而不看快照。
    //
    // 抓到按钮后**再等 1.5 秒**才点：既避开"turn 还没真正开始"的空窗，
    // 也顺带证明按钮不会在生成过程中消失。
    const timeline = []
    let runningSeenAt = null
    let buttonFirstSeenAt = null
    let buttonStillThereAfterWait = null
    let clickedAt = null
    let clickOutcome = null
    let beforeClickAssistant = ''
    let lastKey = ''
    const WAIT_BEFORE_CLICK_MS = 1500

    for (let i = 0; i < 1200; i += 1) {
      await sleepMs(50)
      const t = i * 50
      const snap = sessionSnapshot()
      const key = JSON.stringify(snap)
      if (key !== lastKey) {
        timeline.push({ t, ...snap })
        lastKey = key
      }

      const paneNow = Array.from(document.querySelectorAll('[data-testid="session-pane"]')).find(visible)
      const assistantTextNow = paneNow
        ? Array.from(paneNow.querySelectorAll('[data-role="assistant"], [data-testid="conversation-live"]'))
            .map((n) => (n.textContent || '').trim())
            .join(' ')
        : ''

      if (snap.running === true && runningSeenAt === null) runningSeenAt = t
      const stopNow = stopBtn()
      if (stopNow && buttonFirstSeenAt === null) buttonFirstSeenAt = t

      if (buttonFirstSeenAt !== null && clickedAt === null && t >= buttonFirstSeenAt + WAIT_BEFORE_CLICK_MS) {
        const stop = stopBtn()
        buttonStillThereAfterWait = !!stop
        if (stop) {
          clickedAt = t
          beforeClickAssistant = assistantTextNow.slice(0, 300)
          const sendAtClick = sendBtn()
          stop.click()
          clickOutcome = {
            sendExistsAtClick: !!sendAtClick,
            sendDisabledAtClick: sendAtClick ? sendAtClick.disabled : null,
            assistantCharsBeforeClick: assistantTextNow.length,
            stopTextAtClick: (stop.textContent || '').trim(),
            waitedMs: t - buttonFirstSeenAt,
          }
        }
      }

      // 点过之后等按钮消失
      if (clickedAt !== null && !stopBtn() && t > clickedAt + 200) break
      if (buttonFirstSeenAt === null && t > 20000) break
      if (clickedAt !== null && t > clickedAt + 10000) break
    }

    const pane = Array.from(document.querySelectorAll('[data-testid="session-pane"]')).find(visible)
    return {
      before,
      timeline: timeline.slice(0, 40),
      runningSeenAt,
      buttonFirstSeenAt,
      buttonStillThereAfterWait,
      clickedAt,
      clickOutcome,
      beforeClickAssistant,
      final: sessionSnapshot(),
      stopStillVisible: !!stopBtn(),
      assistantBubbles: pane ? pane.querySelectorAll('[data-role="assistant"]').length : -1,
      userBubbles: pane ? pane.querySelectorAll('[data-role="user"]').length : -1,
      // 中断成功的旁证：助手正文远没有数到 200（被截断）
      assistantText: pane
        ? (pane.querySelector('[data-role="assistant"]') || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim().slice(0, 260)
        : null,
      hasLive: !!(pane && pane.querySelector('[data-testid="conversation-live"]')),
      composerError: (() => {
        const errs = Array.from(document.querySelectorAll('[data-testid="studio-composer-error"]')).filter(visible)
        return errs.length ? (errs[0].textContent || '').trim() : null
      })(),
    }
  })()`)

  log('[result] ' + JSON.stringify(result, null, 1))

  await sleep(500)
  try {
    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(OUT, 'workbench-v7.png'), image.toPNG())
    log('[shot] ok')
  } catch (error) {
    log('[shot] failed: ' + String(error))
  }

  const appeared = result.buttonFirstSeenAt !== null
  // 关键：按钮在生成过程中**持续存在**，不是一个 50ms 的瞬态
  const persisted = result.buttonStillThereAfterWait === true
  const clicked = result.clickedAt !== null && result.clickOutcome !== null
  // 生成确实开始了：点之前已有 assistant 正文/流式内容
  const generatingStarted = !!result.clickOutcome && result.clickOutcome.assistantCharsBeforeClick > 0
  const disappeared = result.stopStillVisible === false
  const noError = result.composerError === null
  const lastAgentErrorGone = !!result.final && result.final.lastAgentError === null
  // 截断证据：最终正文里没有数到 200
  const truncated = (() => {
    const text = result.assistantText || ''
    return text.length > 0 && !/\b200\b/.test(text)
  })()

  log(
    '[verdict] ' +
      (appeared && persisted && clicked && generatingStarted && disappeared && noError && lastAgentErrorGone
        ? 'PASS'
        : 'FAIL') +
      ` (出现=${appeared} 持续存在=${persisted} 点到=${clicked} 点前已在生成=${generatingStarted}` +
      ` 点后消失=${disappeared} 无错误=${noError} 无agent错误=${lastAgentErrorGone}` +
      ` 疑似截断=${truncated} 点前正文字数=${result.clickOutcome ? result.clickOutcome.assistantCharsBeforeClick : 'n/a'})`,
  )

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
