/**
 * 第三轮真机探测：输入框 → `session.prompt` 全链路。
 *
 * **这是唯一有写操作的一轮**：为了不污染用户已有的对话，它先点「新建会话」
 * 创建一个空会话，在**新会话**里发一条测试消息。
 *
 * Phase A  输入框存在且可输入、发送按钮初始禁用
 * Phase B  新建会话 → 输入文本 → 发送按钮变可用
 * Phase C  点发送 → 等 Host 回推 durable `user/message` → 检查
 *          · **目标会话的可见 pane** 里 user 消息 +1
 *          · 输入框已清空、没有错误提示
 *
 * 统计必须**按 pane 且只看可见的**：保活的隐藏标签也在 DOM 里（`hidden` 而非卸载），
 * 全局 `querySelectorAll` 会把它们算进去 —— 第一版就是这样得到"多了 4 条"的假信号。
 *
 * 注意：本机没配 DEEPSEEK_API_KEY 时助手那条会报错（`llm-deepseek: no API key`）。
 * 那是环境问题，不影响本轮判据 —— 要验的是**输入 → 送达 Host → 回显**这一段。
 *
 * 用法：PowerShell 里清 ELECTRON_RUN_AS_NODE 后
 *   & electron.exe probe-workbench-v3.cjs "<url>"
 */

const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const OUT_DIR = 'F:/workbuddy data/tmp/studio-probe'
const LOG = path.join(OUT_DIR, 'probe-v3.log')

function log(msg) {
  const line = typeof msg === 'string' ? msg : JSON.stringify(msg, null, 1)
  try {
    fs.appendFileSync(LOG, line + '\n')
  } catch {
    /* 忽略 */
  }
  console.log(line)
}

const url = process.argv[2]
fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(LOG, '')
log('[boot] ' + new Date().toISOString())

if (!url) {
  log('[FATAL] 缺少 url')
  app.quit()
  process.exit(2)
}

app.commandLine.appendSwitch('disable-gpu')

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 900, show: false })
  win.webContents.on('console-message', (_e, level, message) => {
    const text = String(message)
    if (/\[studio\]|\[lease\]|Uncaught|TypeError|ReferenceError/i.test(text)) {
      log(`[console:${level}] ${text.slice(0, 260)}`)
    }
  })
  const run = (code) => win.webContents.executeJavaScript(code)

  try {
    await win.loadURL(url)
    log('[load] ok')
    await new Promise((r) => setTimeout(r, 11000))

    const baseline = await run(`(() => {
      const q = (s) => document.querySelector(s)
      const input = q('[data-testid="studio-composer-input"]')
      const send = q('[data-testid="studio-composer-send"]')
      const pane = q('[data-testid="session-pane"]')
      return {
        hasComposer: !!q('[data-testid="studio-composer"]'),
        inputDisabled: input ? input.disabled : null,
        inputPlaceholder: input ? input.placeholder : null,
        sendDisabled: send ? send.disabled : null,
        sessionId: pane ? pane.getAttribute('data-session-id') : null,
      }
    })()`)
    log('[phaseA] ' + JSON.stringify(baseline))

    // ── Phase B：新建会话 → 输入文本 ─────────────────────────────
    const typed = await run(`(async () => {
      const visible = (el) => el.offsetParent !== null
      const newBtn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('新建会话'))
      if (!newBtn) return { fatal: '找不到新建会话按钮' }
      newBtn.click()
      await new Promise((r) => setTimeout(r, 2500))

      const inputs = Array.from(document.querySelectorAll('[data-testid="studio-composer-input"]'))
      const input = inputs.find(visible) || inputs[inputs.length - 1]
      if (!input) return { fatal: '新建后仍没有输入框' }

      // React 受控组件必须走原生 setter + input 事件，否则 DOM value 变了但状态没变
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(input, 'studio 输入框自检：这条消息来自 probe')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 250))

      const send = Array.from(document.querySelectorAll('[data-testid="studio-composer-send"]')).find(visible)
      const pane = Array.from(document.querySelectorAll('[data-testid="session-pane"]')).find(visible)

      return {
        value: input.value,
        sendDisabledAfterType: send ? send.disabled : null,
        activeSession: pane ? pane.getAttribute('data-session-id') : null,
        tabCount: document.querySelectorAll('[role="tab"]').length,
        visiblePanes: Array.from(document.querySelectorAll('[data-testid="session-pane"]')).filter(visible).length,
      }
    })()`)
    log('[phaseB] ' + JSON.stringify(typed))

    // ── Phase C：发送并等回显 ───────────────────────────────────
    const sent = await run(`(async () => {
      const visible = (el) => el.offsetParent !== null
      const send = Array.from(document.querySelectorAll('[data-testid="studio-composer-send"]')).find(visible)
      if (!send) return { fatal: '找不到发送按钮' }
      const targetPane = Array.from(document.querySelectorAll('[data-testid="session-pane"]')).find(visible)
      const targetId = targetPane ? targetPane.getAttribute('data-session-id') : null

      const snapPanes = () => Array.from(document.querySelectorAll('[data-testid="session-pane"]'))
        .filter(visible)
        .map((el) => ({
          sessionId: el.getAttribute('data-session-id'),
          users: el.querySelectorAll('[data-role="user"]').length,
          systems: el.querySelectorAll('[data-role="system"]').length,
          assistants: el.querySelectorAll('[data-role="assistant"]').length,
          userTexts: Array.from(el.querySelectorAll('[data-role="user"]'))
            .map((n) => (n.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 46)),
        }))

      const before = snapPanes()
      send.click()
      await new Promise((r) => setTimeout(r, 4500))
      const after = snapPanes()

      const inputs = Array.from(document.querySelectorAll('[data-testid="studio-composer-input"]')).filter(visible)
      const errs = Array.from(document.querySelectorAll('[data-testid="studio-composer-error"]')).filter(visible)

      return {
        targetSession: targetId,
        before,
        after,
        inputValue: inputs.length ? inputs[0].value : null,
        error: errs.length ? (errs[0].textContent || '').trim() : null,
        hasLive: !!document.querySelector('[data-testid="conversation-live"]'),
      }
    })()`)
    log('[phaseC] ' + JSON.stringify(sent))

    const targetBefore = (sent.before || []).find((p) => p.sessionId === sent.targetSession)
    const targetAfter = (sent.after || []).find((p) => p.sessionId === sent.targetSession)
    const delivered = !!targetAfter && targetAfter.userTexts.some((t) => t.includes('studio 输入框自检'))
    const syntheticHidden = targetAfter ? targetAfter.users < 4 : false;
    const cleared = sent.inputValue === ''
    log(
      '[verdict] ' +
        (delivered && cleared ? 'PASS' : 'FAIL') +
        ` (送达=${delivered} 输入框已清空=${cleared} 折叠注入=${syntheticHidden} users=${targetAfter ? targetAfter.users : '?'})`,
    )

    await new Promise((r) => setTimeout(r, 1200))
    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(OUT_DIR, 'workbench-v3.png'), image.toPNG())
    log('[shot] workbench-v3.png')
  } catch (error) {
    log('[FATAL] ' + String(error && (error.stack || error.message || error)))
  } finally {
    app.quit()
  }
})
