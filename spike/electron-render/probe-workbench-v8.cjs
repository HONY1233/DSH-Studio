/**
 * 真机探测：停止按钮（第三轮，重写为无嵌套模板字符串的版本）。
 *
 * 前两轮的教训：
 * 1) v6 抓到按钮出现，但 400ms 后截图时它已经消失 —— 采样太慢；
 * 2) v7 发现 `snapshot.running` 在 turn 开始 50ms 后就落回 false，而 turn
 *    还在继续输出（assistant 已写到 69 行）。**它是 Host 投影的布尔值，不是
 *    "正在生成"的可靠信号**。所以停止按钮的判据改成折叠事件流得出的 `streaming`。
 *
 * 这一轮的判据（全部基于 DOM，不看快照）：
 *   A 停止按钮出现
 *   B 等 1.5 秒后它**仍在**（证明不是 50ms 瞬态）
 *   C 点击后它消失
 *   D 点击前助手正文已有内容（生成真的开始了）
 *   E 最终正文没数到 200（截断生效）
 *   F 没有错误提示
 */

const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const url = process.argv[2]
const OUT = 'F:\\workbuddy data\\tmp\\studio-probe'
const LOG = path.join(OUT, 'probe-v8.log')

fs.mkdirSync(OUT, { recursive: true })
try {
  fs.unlinkSync(LOG)
} catch {}

const log = (line) => fs.appendFileSync(LOG, line + '\n', 'utf8')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 注入到页面里执行的采样脚本。全用单引号拼接，避免与外层模板字符串冲突。 */
const PROBE = [
  '(async () => {',
  '  const visible = (el) => el && el.offsetParent !== null',
  '  const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms))',
  '  const byId = (id) => Array.from(document.querySelectorAll("[data-testid=\\"" + id + "\\"]")).find(visible)',
  '  const pane = () => Array.from(document.querySelectorAll("[data-testid=\\"session-pane\\"]")).find(visible)',
  '',
  '  const input = byId("studio-composer-input")',
  '  if (!input) return { fatal: "no input" }',
  '  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set',
  '  setter.call(input, "请从 1 数到 200，每行只写一个数字，不要任何解释。")',
  '  input.dispatchEvent(new Event("input", { bubbles: true }))',
  '  await sleepMs(250)',
  '',
  '  const send = byId("studio-composer-send")',
  '  if (!send || send.disabled) return { fatal: "send disabled" }',
  '  send.click()',
  '',
  '  const text = () => {',
  '    const p = pane()',
  '    if (!p) return ""',
  '    return Array.from(p.querySelectorAll("[data-role=\\"assistant\\"], [data-testid=\\"conversation-live\\"]"))',
  '      .map((n) => (n.textContent || "").trim()).join(" ")',
  '  }',
  '',
  '  let firstSeen = null',
  '  let stillThere = null',
  '  let clickedAt = null',
  '  let charsBefore = 0',
  '  let stopTextAtClick = null',
  '  let sendAtClick = null',
  '',
  '  for (let i = 0; i < 1200; i += 1) {',
  '    await sleepMs(50)',
  '    const t = i * 50',
  '    const stop = byId("studio-composer-stop")',
  '    if (stop && firstSeen === null) firstSeen = t',
  '',
  '    if (firstSeen !== null && clickedAt === null && t >= firstSeen + 1500) {',
  '      const s = byId("studio-composer-stop")',
  '      stillThere = !!s',
  '      if (s) {',
  '        const bodyBefore = text()',
  '        charsBefore = bodyBefore.length',
  '        const sb = byId("studio-composer-send")',
  '        sendAtClick = sb ? sb.disabled : null',
  '        stopTextAtClick = (s.textContent || "").trim()',
  '        clickedAt = t',
  '        s.click()',
  '      }',
  '    }',
  '',
  '    if (clickedAt !== null && !byId("studio-composer-stop") && t > clickedAt + 200) break',
  '    if (firstSeen === null && t > 20000) break',
  '    if (clickedAt !== null && t > clickedAt + 12000) break',
  '  }',
  '',
  '  const p = pane()',
  '  const errEl = byId("studio-composer-error")',
  '  return {',
  '    firstSeen,',
  '    stillThere,',
  '    clickedAt,',
  '    charsBefore,',
  '    sendAtClick,',
  '    stopTextAtClick,',
  '    stopVisibleNow: !!byId("studio-composer-stop"),',
  '    hasLive: !!(p && p.querySelector("[data-testid=\\"conversation-live\\"]"))',
  '    ,userBubbles: p ? p.querySelectorAll("[data-role=\\"user\\"]").length : -1',
  '    ,assistantBubbles: p ? p.querySelectorAll("[data-role=\\"assistant\\"]").length : -1',
  '    ,assistantText: p ? (p.querySelector("[data-role=\\"assistant\\"]") || { textContent: "" }).textContent.replace(/\\s+/g, " ").trim().slice(0, 300) : null',
  '    ,composerError: errEl ? (errEl.textContent || "").trim() : null',
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
  await sleep(3500)
  const run = (code) => win.webContents.executeJavaScript(code, true)

  // 新建干净会话
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

  await sleep(500)
  try {
    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(OUT, 'workbench-v8.png'), image.toPNG())
    log('[shot] ok')
  } catch (error) {
    log('[shot] failed: ' + String(error))
  }

  const appeared = result.firstSeen !== null
  const persisted = result.stillThere === true
  const clicked = result.clickedAt !== null
  const generatingStarted = result.charsBefore > 0
  const disappeared = result.stopVisibleNow === false
  const noError = !result.composerError
  const body = result.assistantText || ''
  const truncated = body.length > 0 && !/(^|\D)200(\D|$)/.test(body)

  const pass = appeared && persisted && clicked && generatingStarted && disappeared && noError
  log(
    '[verdict] ' +
      (pass ? 'PASS' : 'FAIL') +
      ' (出现=' + appeared +
      ' 持续存在=' + persisted +
      ' 点到=' + clicked +
      ' 点前已生成=' + generatingStarted +
      ' 点后消失=' + disappeared +
      ' 无错误=' + noError +
      ' 截断=' + truncated +
      ' 点前字数=' + result.charsBefore + ')',
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
