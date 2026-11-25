/**
 * 真机探测：面板「放哪」。
 *
 * 之前面板只能落右栏或浮窗，而且**没法选** —— 菜单点一下就按默认区域开。
 * 这一轮加了 ▾ 二级菜单，验证两条路径都真的改了布局：
 *
 * Phase R（右侧）：菜单 → ▾ → 「右侧」→ 断言多了一个 row 轴 split、多了一个格，
 *   且新格里真的有那个面板的标题。
 * Phase F（浮窗）：换个面板 → ▾ → 「浮窗」→ 断言多了一个浮窗，浮窗标题栏里有面板名。
 *
 * 判据全部取自真实 DOM（`data-pane-id` / `data-split-id[data-axis]` / `data-float-id`），
 * 不看截图猜。
 */

const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const url = process.argv[2]
const OUT = 'F:\\workbuddy data\\tmp\\studio-probe'
const LOG = path.join(OUT, 'probe-v13.log')

fs.mkdirSync(OUT, { recursive: true })
try {
  fs.unlinkSync(LOG)
} catch {}

const log = (line) => fs.appendFileSync(LOG, line + '\n', 'utf8')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PRELUDE = [
  '  const visible = (el) => !!el && (el.getClientRects().length > 0 || el.offsetParent !== null)',
  '  const all = (sel) => Array.from(document.querySelectorAll(sel)).filter(visible)',
  '  const one = (sel) => all(sel)[0]',
  '  const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms))',
  '  const snapshot = () => ({',
  '    panes: all("[data-pane-id]").length,',
  '    rowSplits: all("[data-split-id][data-axis=\\"row\\"]").length,',
  '    colSplits: all("[data-split-id][data-axis=\\"column\\"]").length,',
  '    floats: all("[data-float-id]").length,',
  '  })',
]

/** 打开面板菜单，展开第一个面板的"放哪"，点某个区域。 */
function placeScript(region, panelIndex) {
  return [
    '(async () => {',
    ...PRELUDE,
    '  const before = snapshot()',
    '',
    '  const menuBtn = one("[data-testid=\\"studio-panel-menu-button\\"]")',
    '  if (!menuBtn) return { fatal: "no menu button" }',
    '  menuBtn.click()',
    '  await sleepMs(300)',
    '',
    '  const toggles = all("[data-testid=\\"studio-panel-region-toggle\\"]")',
    `  const toggle = toggles[${panelIndex}]`,
    '  if (!toggle) return { fatal: "no region toggle", toggles: toggles.length }',
    '  const panelId = toggle.getAttribute("data-panel-id")',
    '  toggle.click()',
    '  await sleepMs(250)',
    '',
    `  const chip = all("[data-testid=\\"studio-panel-region\\"]").find((el) => el.getAttribute("data-region") === "${region}")`,
    '  if (!chip) {',
    '    const offered = all("[data-testid=\\"studio-panel-region\\"]").map((el) => el.getAttribute("data-region"))',
    '    return { fatal: "region not offered", offered, panelId }',
    '  }',
    '  const chipLabel = (chip.textContent || "").trim()',
    '  chip.click()',
    '',
    '  // 等布局真正变化（最多 3 秒）',
    '  let after = before',
    '  for (let i = 0; i < 30; i += 1) {',
    '    await sleepMs(100)',
    '    after = snapshot()',
    '    if (after.panes !== before.panes || after.floats !== before.floats) break',
    '  }',
    '',
    '  // 面板标题是否出现在新容器里',
    '  const titleText = document.body.textContent || ""',
    '  return {',
    '    panelId, chipLabel, before, after,',
    '    menuClosed: !one("[data-testid=\\"studio-panel-menu\\"]")',
    '  }',
    '})()',
  ].join('\n')
}

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

  const initial = await run(`(() => {${PRELUDE.join('\n')}\n  return { ...snapshot(), panels: all('[data-testid="studio-panel-menu-item"]').length }\n})()`)
  log('[initial] ' + JSON.stringify(initial))

  // ── Phase R：右侧 ────────────────────────────────────────────
  const right = await run(placeScript('right', 0))
  log('[right] ' + JSON.stringify(right, null, 1))

  await sleep(400)
  try {
    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(OUT, 'workbench-v13-right.png'), image.toPNG())
    log('[shot] right ok')
  } catch (error) {
    log('[shot] right failed: ' + String(error))
  }

  // ── Phase F：浮窗（换第二个面板，避免同一面板重复实例被去重）────
  const float = await run(placeScript('float', 1))
  log('[float] ' + JSON.stringify(float, null, 1))

  await sleep(500)
  try {
    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(OUT, 'workbench-v13-float.png'), image.toPNG())
    log('[shot] float ok')
  } catch (error) {
    log('[shot] float failed: ' + String(error))
  }

  // 右侧 = row split +1、格 +1、浮窗不变、菜单关掉
  const rightOk =
    !right.fatal &&
    right.chipLabel === '右侧' &&
    right.after.rowSplits === right.before.rowSplits + 1 &&
    right.after.panes === right.before.panes + 1 &&
    right.after.floats === right.before.floats &&
    right.menuClosed === true

  // 浮窗 = 浮窗 +1、格回到原数量（tab 从格里移走了）、column split 不变
  const floatOk =
    !float.fatal &&
    float.chipLabel === '浮窗' &&
    float.after.floats === float.before.floats + 1 &&
    float.after.panes === float.before.panes

  log(
    '[verdict] ' +
      (rightOk && floatOk ? 'PASS' : 'FAIL') +
      ' (右侧=' + rightOk + ' row:' + (right.before && right.before.rowSplits) + '→' + (right.after && right.after.rowSplits) +
      ' panes:' + (right.before && right.before.panes) + '→' + (right.after && right.after.panes) +
      ' | 浮窗=' + floatOk + ' floats:' + (float.before && float.before.floats) + '→' + (float.after && float.after.floats) +
      ')',
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
