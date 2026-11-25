/**
 * 第四轮真机探测：附件上传 → 带 receipt 发送。
 *
 * Phase A  `ctx.fileUpload` 是否可用（软依赖，缺了只会禁用入口）
 * Phase B  在页面里构造 File 塞进 input → 等上传 → chip 应变 ready
 * Phase C  带附件发送 → 目标 pane 里出现我们发的文字
 *
 * 附件在消息正文里的渲染**还没做**（`textOfBlocks` 只取文本块），所以本轮
 * 只验"上传成功 + 送达"，不验"气泡里能看到缩略图"。
 *
 * **本轮同样有写操作**：新建空会话 + 一个 probe.txt 附件。
 *
 * 用法：PowerShell 里清 ELECTRON_RUN_AS_NODE 后
 *   & electron.exe probe-workbench-v4.cjs "<url>"
 */

const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const OUT_DIR = 'F:/workbuddy data/tmp/studio-probe'
const LOG = path.join(OUT_DIR, 'probe-v4.log')

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
      log(`[console:${level}] ${text.slice(0, 300)}`)
    }
  })
  const run = (code) => win.webContents.executeJavaScript(code)

  try {
    await win.loadURL(url)
    log('[load] ok')
    await new Promise((r) => setTimeout(r, 11000))

    const phaseA = await run(`(() => {
      const attach = document.querySelector('[data-testid="studio-composer-attach"]')
      const hasFileInput = !!document.querySelector('[data-testid="studio-composer-file-input"]')
      return {
        hasAttachButton: !!attach,
        attachDisabled: attach ? attach.disabled : null,
        attachTitle: attach ? attach.title : null,
        hasFileInput,
      }
    })()`)
    log('[phaseA] ' + JSON.stringify(phaseA))

    // ── Phase B：新建会话 → 构造文件 → 上传 ─────────────────────
    const phaseB = await run(`(async () => {
      const visible = (el) => el.offsetParent !== null
      const newBtn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('新建会话'))
      if (!newBtn) return { fatal: '找不到新建会话按钮' }
      newBtn.click()
      await new Promise((r) => setTimeout(r, 2500))

      // file input 自身带 hidden 属性，永远 offsetParent === null —— 不能按它自己找可见性，
      // 必须挂到「可见的那个 composer」下面去找。否则会塞进保活的隐藏标签（踩过）。
      const composer = Array.from(document.querySelectorAll('[data-testid="studio-composer"]')).find(visible)
      if (!composer) return { fatal: '找不到可见的输入区' }
      const input = composer.querySelector('[data-testid="studio-composer-file-input"]')
      if (!input) return { fatal: '找不到文件输入' }

      const dt = new DataTransfer()
      dt.items.add(new File(['probe payload\\n'], 'probe.txt', { type: 'text/plain' }))
      input.files = dt.files
      input.dispatchEvent(new Event('change', { bubbles: true }))

      // 最多等 6 秒，轮询 chip 状态
      let chip = null
      for (let i = 0; i < 30; i += 1) {
        await new Promise((r) => setTimeout(r, 200))
        chip = composer.querySelector('[data-testid="studio-composer-attachment"]')
        const status = chip ? chip.getAttribute('data-status') : null
        if (status === 'ready' || status === 'failed') break
      }

      const err = Array.from(document.querySelectorAll('[data-testid="studio-composer-error"]')).find(visible)
      const pane = Array.from(document.querySelectorAll('[data-testid="session-pane"]')).find(visible)

      const allChips = Array.from(document.querySelectorAll('[data-testid="studio-composer-attachment"]'))
      const composers = Array.from(document.querySelectorAll('[data-testid="studio-composer"]'))
      return {
        diagnostics: {
          composerCount: composers.length,
          visibleComposers: composers.filter(visible).length,
          chips: allChips.map((c) => ({
            status: c.getAttribute('data-status'),
            visible: visible(c),
            offsetParent: c.offsetParent === null ? 'null' : 'ok',
            text: (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50),
          })),
          fileInputCount: document.querySelectorAll('[data-testid="studio-composer-file-input"]').length,
        },
        chipCount: composer.querySelectorAll('[data-testid="studio-composer-attachment"]').length,
        chipStatus: chip ? chip.getAttribute('data-status') : null,
        chipText: chip ? (chip.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) : null,
        composerError: err ? (err.textContent || '').trim() : null,
        activeSession: pane ? pane.getAttribute('data-session-id') : null,
      }
    })()`)
    log('[phaseB] ' + JSON.stringify(phaseB))

    // ── Phase C：带附件发送 ─────────────────────────────────────
    const phaseC = await run(`(async () => {
      const visible = (el) => el.offsetParent !== null
      const input = Array.from(document.querySelectorAll('[data-testid="studio-composer-input"]')).find(visible)
      if (!input) return { fatal: '找不到输入框' }
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(input, '附件自检：这条带一个 probe.txt')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 250))

      const send = Array.from(document.querySelectorAll('[data-testid="studio-composer-send"]')).find(visible)
      if (!send) return { fatal: '找不到发送按钮' }
      const sendDisabled = send.disabled
      send.click()
      await new Promise((r) => setTimeout(r, 5000))

      const pane = Array.from(document.querySelectorAll('[data-testid="session-pane"]')).find(visible)
      const inputs = Array.from(document.querySelectorAll('[data-testid="studio-composer-input"]')).filter(visible)
      const err = Array.from(document.querySelectorAll('[data-testid="studio-composer-error"]')).find(visible)
      const users = pane ? Array.from(pane.querySelectorAll('[data-role="user"]')) : []

      return {
        sendDisabledBeforeClick: sendDisabled,
        users: users.length,
        userTexts: users.map((n) => (n.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60)),
        inputValue: inputs.length ? inputs[0].value : null,
        attachmentsLeft: (() => {
          const c = Array.from(document.querySelectorAll('[data-testid="studio-composer"]')).find(visible)
          return c ? c.querySelectorAll('[data-testid="studio-composer-attachment"]').length : -1
        })(),
        error: err ? (err.textContent || '').trim() : null,
      }
    })()`)
    log('[phaseC] ' + JSON.stringify(phaseC))

    const uploaded = phaseB.chipStatus === 'ready'
    const delivered = Array.isArray(phaseC.userTexts) && phaseC.userTexts.some((t) => t.includes('附件自检'))
    const cleared = phaseC.inputValue === '' && phaseC.attachmentsLeft === 0
    log(
      '[verdict] ' +
        (uploaded && delivered && cleared ? 'PASS' : 'FAIL') +
        ` (上传=${uploaded} 送达=${delivered} 清空=${cleared})`,
    )

    await new Promise((r) => setTimeout(r, 1200))
    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(OUT_DIR, 'workbench-v4.png'), image.toPNG())
    log('[shot] workbench-v4.png')
  } catch (error) {
    log('[FATAL] ' + String(error && (error.stack || error.message || error)))
  } finally {
    app.quit()
  }
})
