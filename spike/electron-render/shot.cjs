/**
 * 截图 + DOM 探测。不依赖 stdout（Electron GUI 模式下会被吞），日志写文件。
 *
 * 用法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     spike/electron-render/shot.cjs <url> <outPng>
 *
 * 注意：ELECTRON_RUN_AS_NODE 必须清空，否则 Electron 以纯 Node 运行、app 为 undefined。
 */

const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const LOG = 'F:/workbuddy data/tmp/spike-shot/run.log'

function log(msg) {
  const line = String(msg)
  try {
    fs.appendFileSync(LOG, line + '\n')
  } catch {
    /* 日志失败不影响主流程 */
  }
  console.log(line)
}

const url = process.argv[2]
const outPng = process.argv[3] || 'F:/workbuddy data/tmp/spike-shot/studio-sidebar.png'

fs.mkdirSync(path.dirname(LOG), { recursive: true })
fs.writeFileSync(LOG, '')
log('[boot] url=' + String(url).slice(0, 70))

if (!url) {
  log('[FATAL] 缺少 url')
  app.quit()
  process.exit(2)
}

app.commandLine.appendSwitch('disable-gpu')

app.whenReady().then(async () => {
  log('[boot] app ready')
  const win = new BrowserWindow({ width: 1280, height: 820, show: false })

  win.webContents.on('console-message', (_event, _level, message) => {
    const text = String(message)
    if (/studio-ui|spike|error/i.test(text)) log('[console] ' + text.slice(0, 240))
  })
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    log('[did-fail-load] ' + code + ' ' + desc)
  })

  try {
    await win.loadURL(url)
    log('[load] ok')
    await new Promise((resolve) => setTimeout(resolve, 11000))

    const probe = await win.webContents.executeJavaScript(`(() => {
      const sidebar = document.querySelector('.studio-sidebar')
      const slotSidebar = document.querySelector('[data-slot="sidebar"]')
      return {
        title: document.title,
        hasStudioSidebar: !!sidebar,
        sidebarText: sidebar ? (sidebar.innerText || '').slice(0, 160) : null,
        itemCount: document.querySelectorAll('.studio-item').length,
        slotSidebarChildren: slotSidebar ? slotSidebar.children.length : -1,
        bodyLen: (document.body.innerText || '').length,
      }
    })()`)

    log('[probe] ' + JSON.stringify(probe))

    fs.mkdirSync(path.dirname(outPng), { recursive: true })
    const image = await win.webContents.capturePage()
    fs.writeFileSync(outPng, image.toPNG())
    log('[shot] ' + outPng)
    log('[verdict] ' + (probe.hasStudioSidebar ? 'PASS' : 'FAIL'))
  } catch (error) {
    log('[FATAL] ' + String(error && (error.stack || error.message || error)))
  } finally {
    app.quit()
  }
})
