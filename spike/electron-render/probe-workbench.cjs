/**
 * 工作台真机探测：加载 DSH 客户端页面，检查我们的插件是否真的挂上了。
 *
 * 与 shot.cjs（P0 左栏验证）的区别：那个只看 `.studio-sidebar`；
 * 这个要回答「工作台是否接管了 main 区」，以及**为什么没接管**。
 *
 * 用法（WSL 里调 Windows 的 electron）：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     spike/electron-render/probe-workbench.cjs "<url>" <outPng>
 *
 * 三个必须记住的坑（P0 踩过）：
 * 1) `ELECTRON_RUN_AS_NODE` 必须清空，否则以纯 Node 运行、app 为 undefined；
 * 2) 不要给带空格的路径参数（静默 exit 127），输出路径写死在脚本里；
 * 3) GUI 模式吞 stdout，日志一律写文件。
 */

const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const OUT_DIR = 'F:/workbuddy data/tmp/studio-probe'
const LOG = path.join(OUT_DIR, 'probe.log')

function log(msg) {
  const line = String(msg)
  try {
    fs.appendFileSync(LOG, line + '\n')
  } catch {
    /* 忽略 */
  }
  console.log(line)
}

const url = process.argv[2]
const outPng = process.argv[3] || path.join(OUT_DIR, 'workbench.png')

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(LOG, '')
log('[boot] ' + new Date().toISOString())
log('[boot] url=' + String(url).slice(0, 90))

if (!url) {
  log('[FATAL] 缺少 url')
  app.quit()
  process.exit(2)
}

app.commandLine.appendSwitch('disable-gpu')

const consoleLines = []

app.whenReady().then(async () => {
  log('[boot] app ready')
  const win = new BrowserWindow({ width: 1440, height: 900, show: false })

  win.webContents.on('console-message', (_event, level, message) => {
    const text = String(message)
    // 只留我们自己的日志与错误，避免被官方几十条 info 淹没
    if (/\[studio\]|\[lease\]|error|Error|warning|Warning/i.test(text)) {
      const line = `[console:${level}] ${text.slice(0, 300)}`
      consoleLines.push(line)
      log(line)
    }
  })

  win.webContents.on('render-process-gone', (_e, details) => {
    log('[render-gone] ' + JSON.stringify(details))
  })
  win.webContents.on('did-fail-load', (_e, code, desc, validatedUrl) => {
    log(`[did-fail-load] ${code} ${desc} ${String(validatedUrl).slice(0, 80)}`)
  })

  try {
    await win.loadURL(url)
    log('[load] ok')

    // 首屏要等 boot graph 串行加载 + 会话列表拉一次；11s 是 P0 实测的余量。
    await new Promise((resolve) => setTimeout(resolve, 11000))

    const probe = await win.webContents.executeJavaScript(`(() => {
      const q = (sel) => document.querySelector(sel)
      const qa = (sel) => Array.from(document.querySelectorAll(sel))
      const text = (el) => (el ? (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 240) : null)

      const sidebar = q('[data-testid="studio-sidebar"]')
      const workbench = q('[data-testid="workbench"]')
      const items = qa('[data-testid="sidebar-item"]')
      const bodies = qa('[data-testid="conversation-body"]')
      const skeletons = qa('[data-testid="conversation-skeleton"]')
      const empties = qa('[data-testid="conversation-empty"]')
      const strips = qa('[data-testid="tab-strip-workbench"]')
      const tabs = qa('[role="tab"]')

      return {
        title: document.title,
        // 左栏
        hasStudioSidebar: !!sidebar,
        sidebarItems: items.length,
        sidebarFirst: items.length ? items[0].getAttribute('data-session-id') : null,
        sidebarActive: items.filter((n) => n.getAttribute('data-active') === 'true').length,
        sidebarText: text(sidebar),
        // 主区
        hasWorkbench: !!workbench,
        workbenchEmpty: workbench ? workbench.getAttribute('data-empty') : null,
        tabCount: tabs.length,
        bodyCount: bodies.length,
        skeletonCount: skeletons.length,
        emptyCount: empties.length,
        messageCount: qa('[data-testid="msg"], [data-role]').length,
        firstBodyText: bodies.length ? text(bodies[0]) : null,
        firstBodySession: bodies.length ? bodies[0].getAttribute('data-session-id') : null,
        // 兜底：官方对话面板是否还在
        hasOfficialConversation: !!q('[data-slot="main.conversation"]'),
        bodyLen: (document.body.innerText || '').length,
        bodyHead: (document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 200),
      }
    })()`)

    log('[probe] ' + JSON.stringify(probe, null, 1))

    fs.mkdirSync(path.dirname(outPng), { recursive: true })
    const image = await win.webContents.capturePage()
    fs.writeFileSync(outPng, image.toPNG())
    log('[shot] ' + outPng)

    const pass = probe.hasStudioSidebar && probe.hasWorkbench
    log('[verdict] ' + (pass ? 'PASS' : 'FAIL'))
    log('[console-total] ' + consoleLines.length)
  } catch (error) {
    log('[FATAL] ' + String(error && (error.stack || error.message || error)))
  } finally {
    app.quit()
  }
})
