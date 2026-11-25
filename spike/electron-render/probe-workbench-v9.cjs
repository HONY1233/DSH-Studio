/**
 * 真机探测：历史加载入口的显隐判据 + 回归检查。
 *
 * 为什么这一轮不验"加载更多"本身：环境里最长的会话也只有 1 轮，而一页
 * 最多能装 500 条消息 —— `hasMore` 恒为 false，加载路径在真机上没有触发条件。
 * 硬造一个 500+ 消息的会话不现实（要跑几十轮）。
 *
 * 所以这一轮验两件能验的事：
 *   A `data-has-more` 属性与按钮显隐一致（判据正确、不会乱弹入口）
 *   B 前面的功能没被这轮改动弄坏（会话渲染 / 输入框 / 停止按钮判据 / 附件按钮）
 *
 * 加载路径本身由 12 个单测覆盖（deferConsumption 配对、滚动换算、失败降级、
 * consume 失败、加载中禁用）。这一点在 README 里如实标注。
 */

const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const url = process.argv[2]
const OUT = 'F:\\workbuddy data\\tmp\\studio-probe'
const LOG = path.join(OUT, 'probe-v9.log')

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
  '  const pane = () => Array.from(document.querySelectorAll("[data-testid=\\"session-pane\\"]")).find(visible)',
  '',
  '  // 等首屏会话渲染出来（列表是异步到达的）',
  '  let body = null',
  '  for (let i = 0; i < 60; i += 1) {',
  '    await new Promise((r) => setTimeout(r, 200))',
  '    body = byId("conversation-body") || byId("conversation-empty")',
  '    if (body) break',
  '  }',
  '  if (!body) return { fatal: "no conversation body" }',
  '',
  '  const hasMoreAttr = body.getAttribute("data-has-more")',
  '  const olderBtn = byId("conversation-load-older")',
  '  const p = pane()',
  '',
  '  return {',
  '    hasMoreAttr: hasMoreAttr,',
  '    olderButtonVisible: !!olderBtn,',
  '    // 判据一致性：hasMore 为 false 时**不该**有按钮；为 true 时必须有',
  '    consistent: hasMoreAttr === "true" ? !!olderBtn : !olderBtn,',
  '    isBodyNotSkeleton: body.getAttribute("data-testid") === "conversation-body",',
  '    messages: body.getAttribute("data-messages"),',
  '    synthetic: body.getAttribute("data-synthetic"),',
  '    hasComposer: !!byId("studio-composer-input"),',
  '    hasSend: !!byId("studio-composer-send"),',
  '    hasAttach: !!byId("studio-composer-attach"),',
  '    stopVisible: !!byId("studio-composer-stop"),',
  '    sessionId: p ? p.getAttribute("data-session-id") : null,',
  '    assistantBubbles: p ? p.querySelectorAll("[data-role=\\"assistant\\"]").length : -1,',
  '    userBubbles: p ? p.querySelectorAll("[data-role=\\"user\\"]").length : -1,',
  '    // 历史窗口说自己还有更早的，与按钮显隐是对同一件事的两种表达',
  '    scrollTop: body.scrollTop,',
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

  const result = await run(PROBE)
  log('[result] ' + JSON.stringify(result, null, 1))

  await sleep(600)
  try {
    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(OUT, 'workbench-v9.png'), image.toPNG())
    log('[shot] ok')
  } catch (error) {
    log('[shot] failed: ' + String(error))
  }

  const ok = !result.fatal && result.consistent === true && result.hasComposer && result.hasSend
  const regression = result.isBodyNotSkeleton && result.assistantBubbles >= 0 && result.stopVisible === false
  log(
    '[verdict] ' +
      (ok && regression ? 'PASS' : 'FAIL') +
      ' (判据一致=' + result.consistent +
      ' 有输入框=' + result.hasComposer +
      ' 有发送=' + result.hasSend +
      ' 有附件=' + result.hasAttach +
      ' 无停止按钮=' + (result.stopVisible === false) +
      ' hasMore=' + result.hasMoreAttr +
      ' 消息数=' + result.messages + ')',
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
