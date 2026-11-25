/**
 * 真机探测：工具调用渲染 + 流式思考过程 + 流式工具调用预览。
 *
 * 做法：发一条**必然触发工具**的提示（让它读 package.json），全程每 100ms 采样，
 * 记录三样东西在时间上的出现顺序：
 *   streaming 预览（tool-call-delta 拼装中）
 *   → durable 的 tool/call（落库）
 *   → tool/result 合并（状态变 done/error）
 * 同时观察思考过程开关。
 *
 * 判据：
 *   A 出现过流式工具预览，或至少出现过 durable 的 tool-call（不同模型可能不发 delta）
 *   B 最终有 tool-call chip，且状态不是 running（要么 done 要么 error）
 *   C 展开后能看到参数或结果
 *   D 思考过程开关出现过（模型支持 reasoning 时），且默认收起
 */

const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const url = process.argv[2]
const OUT = 'F:\\workbuddy data\\tmp\\studio-probe'
const LOG = path.join(OUT, 'probe-v10.log')

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
  '  const all = (id) => Array.from(document.querySelectorAll("[data-testid=\\"" + id + "\\"]")).filter(visible)',
  '  const pane = () => Array.from(document.querySelectorAll("[data-testid=\\"session-pane\\"]")).find(visible)',
  '  const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms))',
  '',
  '  const input = byId("studio-composer-input")',
  '  if (!input) return { fatal: "no input" }',
  '  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set',
  '  setter.call(input, "请依次做三件事：1) 读 package.json 前 8 行；2) 列出 src 目录下有哪些文件；3) 读一下 tsconfig.json。每一步都必须真的调用工具，最后简短总结。")',
  '  input.dispatchEvent(new Event("input", { bubbles: true }))',
  '  await sleepMs(300)',
  '',
  '  const send = byId("studio-composer-send")',
  '  if (!send || send.disabled) return { fatal: "send disabled" }',
  '  send.click()',
  '',
  '  const timeline = []',
  '  let sawLiveTool = false',
  '  let sawReasoningToggle = false',
  '  let lastKey = ""',
  '',
  '  for (let i = 0; i < 2000; i += 1) {',
  '    await sleepMs(100)',
  '    const t = i * 100',
  '    const chips = all("tool-call").map((el) => ({',
  '      name: (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 60),',
  '      status: el.getAttribute("data-status"),',
  '    }))',
  '    const hasLive = !!byId("conversation-live")',
  '    const hasReasoning = !!byId("conversation-live-reasoning-toggle")',
  '    const stopVisible = !!byId("studio-composer-stop")',
  '    if (hasReasoning) sawReasoningToggle = true',
  '    // 流式预览：出现在 conversation-live 内部且状态是 running',
  '    if (hasLive && chips.some((c) => c.status === "running")) sawLiveTool = true',
  '',
  '    const key = JSON.stringify({ chips, hasLive, hasReasoning, stopVisible })',
  '    if (key !== lastKey) {',
  '      timeline.push({ t, chipCount: chips.length, statuses: chips.map((c) => c.status), hasLive, hasReasoning, stopVisible })',
  '      lastKey = key',
  '    }',
  '',
  '    // 收工条件：停止按钮消失（turn 结束）且至少有过的采样记录',
  '    if (!stopVisible && t > 3000 && chips.length > 0) break',
  '    if (!stopVisible && t > 45000) break',
  '  }',
  '',
  '  // 等一拍让最终状态落定',
  '  await sleepMs(800)',
  '',
  '  const chips = all("tool-call")',
  '  const first = chips[0]',
  '  let detailText = null',
  '  if (first) {',
  '    const btn = first.querySelector("button")',
  '    if (btn) {',
  '      btn.click()',
  '      await sleepMs(200)',
  '      const detail = first.querySelector("[data-testid=\\"tool-call-detail\\"]")',
  '      detailText = detail ? (detail.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 200) : null',
  '      btn.click()',
  '    }',
  '  }',
  '',
  '  const p = pane()',
  '  return {',
  '    sawLiveTool,',
  '    sawReasoningToggle,',
  '    timeline: timeline.slice(0, 40),',
  '    finalChips: chips.map((el) => ({',
  '      status: el.getAttribute("data-status"),',
  '      text: (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 80),',
  '    })),',
  '    detailText,',
  '    assistantText: p ? (p.querySelector("[data-role=\\"assistant\\"]") || { textContent: "" }).textContent.replace(/\\s+/g, " ").trim().slice(0, 200) : null,',
  '    composerError: (() => { const e = byId("studio-composer-error"); return e ? (e.textContent || "").trim() : null })(),',
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

  // 新建会话，避免污染已有对话
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

  await sleep(600)
  try {
    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(OUT, 'workbench-v10.png'), image.toPNG())
    log('[shot] ok')
  } catch (error) {
    log('[shot] failed: ' + String(error))
  }

  const hasChip = Array.isArray(result.finalChips) && result.finalChips.length > 0
  const settledStatus = hasChip && result.finalChips.every((c) => c.status !== 'running')
  const detailVisible = typeof result.detailText === 'string' && result.detailText.length > 0
  const noError = !result.composerError

  log(
    '[verdict] ' +
      (hasChip && settledStatus && detailVisible && noError ? 'PASS' : 'FAIL') +
      ' (有tool-chip=' + hasChip +
      ' 状态已定=' + settledStatus +
      ' 详情可看=' + detailVisible +
      ' 出现流式工具预览=' + result.sawLiveTool +
      ' 出现思考开关=' + result.sawReasoningToggle +
      ' 无错误=' + noError + ')',
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
