/**
 * 真机探测：思考过程渲染 + steer 真截断。
 *
 * Phase R（思考过程）：发一条需要想一下的问题，等流式里出现思考切换按钮 →
 *   记录"思考区默认收起"，点开 → 思考原文非空 → 作答正文照常出现。
 *   之所以能验：studio profile 的默认模型加了 `reasoningEffort: max`
 *   （`probe-diag-chunks` 已确认窗口里真有 `reasoning-delta`）。
 *
 * Phase S（steer 截断）：发一个必然要写很久的任务 → 等正文开始输出 1 秒后
 *   **Ctrl+Enter** 塞一条新指令 → 判据是"第一条助手回复远没有写完目标"
 *   （数到 3000 却没到 3000）+ 出现了新指令的产出。
 */

const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const url = process.argv[2]
const OUT = 'F:\\workbuddy data\\tmp\\studio-probe'
const LOG = path.join(OUT, 'probe-v14.log')

fs.mkdirSync(OUT, { recursive: true })
try {
  fs.unlinkSync(LOG)
} catch {}

const log = (line) => fs.appendFileSync(LOG, line + '\n', 'utf8')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PRELUDE = [
  '  const visible = (el) => !!el && (el.getClientRects().length > 0 || el.offsetParent !== null)',
  '  const all = (id) => Array.from(document.querySelectorAll("[data-testid=\\"" + id + "\\"]")).filter(visible)',
  '  const one = (id) => all(id)[0]',
  '  const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms))',
  '  const type = (text) => {',
  '    const input = one("studio-composer-input")',
  '    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set',
  '    setter.call(input, text)',
  '    input.dispatchEvent(new Event("input", { bubbles: true }))',
  '    return input',
  '  }',
]

const REASONING = [
  '(async () => {',
  ...PRELUDE,
  '  type("一个农夫有 17 只鸡，每只鸡每天下 3 个蛋，连续 23 天一共多少个蛋？请算出来，只回复数字。")',
  '  await sleepMs(200)',
  '  const send = one("studio-composer-send")',
  '  if (!send || send.disabled) return { fatal: "send disabled" }',
  '  send.click()',
  '',
  '  let sawToggle = false',
  '  let hiddenByDefault = null',
  '  let reasoningChars = 0',
  '  for (let i = 0; i < 600; i += 1) {',
  '    await sleepMs(100)',
  '    const toggle = one("conversation-live-reasoning-toggle")',
  '    if (toggle) {',
  '      if (!sawToggle) {',
  '        sawToggle = true',
  '        // 默认应当是收起的：切换按钮在、正文容器不在',
  '        hiddenByDefault = one("conversation-live-reasoning") === undefined',
  '        toggle.click()',
  '      }',
  '      const body = one("conversation-live-reasoning")',
  '      const len = body ? (body.textContent || "").length : 0',
  '      if (len > reasoningChars) reasoningChars = len',
  '      // 已经拿到足够样本就收工',
  '      if (reasoningChars > 20 && !one("studio-composer-stop")) break',
  '    }',
  '  }',
  '',
  '  // 等落定，读最终正文',
  '  for (let i = 0; i < 120; i += 1) {',
  '    await sleepMs(150)',
  '    if (!one("studio-composer-stop")) break',
  '  }',
  '  const pane = all("session-pane")[0]',
  '  const assistant = pane ? Array.from(pane.querySelectorAll("[data-role=\\"assistant\\"]")) : []',
  '  const finalText = assistant.length ? (assistant[assistant.length - 1].textContent || "").trim() : ""',
  '  return {',
  '    sawToggle, hiddenByDefault, reasoningChars,',
  '    assistantCount: assistant.length,',
  '    finalHead: finalText.slice(0, 60),',
  '    hasAnswer: /4341|1,?173/.test(finalText.replace(/[\\s,]/g, "")) || finalText.length > 0,',
  '  }',
  '})()',
].join('\n')

const STEER = [
  '(async () => {',
  ...PRELUDE,
  '  type("请从 1 数到 3000，每行只写一个数字，不要任何解释。")',
  '  await sleepMs(200)',
  '  const send = one("studio-composer-send")',
  '  if (!send || send.disabled) return { fatal: "send disabled" }',
  '  send.click()',
  '',
  '  // 等"真的在输出正文"（不是只有思考），再给 1 秒让它多写一点',
  '  let sawStop = false',
  '  let textAtClick = 0',
  '  let steered = false',
  '  const startedAt = Date.now()',
  '  for (let i = 0; i < 600; i += 1) {',
  '    await sleepMs(50)',
  '    const stop = one("studio-composer-stop")',
  '    if (stop) sawStop = true',
  '    const pane = all("session-pane")[0]',
  '    const live = one("conversation-live")',
  '    const liveText = live ? (live.textContent || "") : ""',
  '    if (sawStop && liveText.replace(/[^0-9]/g, "").length > 8) {',
  '      if (textAtClick === 0) textAtClick = liveText.length',
  '      // 已经输出一段正文 → 再等 1 秒后 steer',
  '      await sleepMs(1000)',
  '      const input = one("studio-composer-input")',
  '      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set',
  '      setter.call(input, "停下，改回复：STEER-OK")',
  '      input.dispatchEvent(new Event("input", { bubbles: true }))',
  '      await sleepMs(150)',
  '      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }))',
  '      steered = true',
  '      break',
  '    }',
  '    if (!stop && i > 40) break',
  '  }',
  '',
  '  // 等落定',
  '  for (let i = 0; i < 400; i += 1) {',
  '    await sleepMs(100)',
  '    if (!one("studio-composer-stop")) break',
  '  }',
  '  const settleMs = Date.now() - startedAt',
  '',
  '  const pane = all("session-pane")[0]',
  '  const assistants = pane ? Array.from(pane.querySelectorAll("[data-role=\\"assistant\\"]")) : []',
  '  const texts = assistants.map((n) => (n.textContent || "").replace(/\\s+/g, " ").trim())',
  '  const nums = (texts[0] || "").match(/\\d+/g) || []',
  '  const maxNumber = nums.length ? Math.max(...nums.map(Number)) : 0',
  '',
  '  return {',
  '    sawStop, steered, textAtClick, settleMs,',
  '    assistantCount: assistants.length,',
  '    firstLength: (texts[0] || "").length,',
  '    maxNumber,',
  '    hasSteerMarker: texts.some((t) => t.indexOf("STEER-OK") >= 0),',
  '    inputValue: one("studio-composer-input").value,',
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
  await sleep(5000)
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

  await newConversation()
  await sleep(2500)
  const reasoning = await run(REASONING)
  log('[reasoning] ' + JSON.stringify(reasoning, null, 1))

  await sleep(400)
  try {
    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(OUT, 'workbench-v14-reasoning.png'), image.toPNG())
    log('[shot] reasoning ok')
  } catch (error) {
    log('[shot] reasoning failed: ' + String(error))
  }

  await newConversation()
  await sleep(2500)
  const steer = await run(STEER)
  log('[steer] ' + JSON.stringify(steer, null, 1))

  await sleep(400)
  try {
    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(OUT, 'workbench-v14-steer.png'), image.toPNG())
    log('[shot] steer ok')
  } catch (error) {
    log('[shot] steer failed: ' + String(error))
  }

  const reasoningOk =
    reasoning.sawToggle === true &&
    reasoning.hiddenByDefault === true &&
    typeof reasoning.reasoningChars === 'number' &&
    reasoning.reasoningChars > 20

  // 真截断的证据：第一条回复没数到 3000，且新指令有了产出
  const steerOk =
    steer.steered === true &&
    steer.hasSteerMarker === true &&
    typeof steer.maxNumber === 'number' &&
    steer.maxNumber > 0 &&
    steer.maxNumber < 3000

  log(
    '[verdict] ' +
      (reasoningOk && steerOk ? 'PASS' : 'FAIL') +
      ' (思考过程=' + reasoningOk + ' 思考字数=' + reasoning.reasoningChars +
      ' 默认收起=' + reasoning.hiddenByDefault +
      ' | steer=' + steerOk + ' 最大数字=' + steer.maxNumber +
      ' 首条长度=' + steer.firstLength + ' 落定=' + steer.settleMs + 'ms)',
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
