/**
 * 第二轮真机探测：面板菜单 + 拖拽落区。
 *
 * 这两件事 jsdom 都验不了：
 * - 菜单要真实点击并观察 React 提交后的 DOM；
 * - 拖拽要真实的 `getBoundingClientRect`，而吸附热区是按主区**实测宽度**算的
 *   （`edge = clamp(w*0.08, 64, 112)`），jsdom 里全是 0。
 *
 * Phase A  首屏基线
 * Phase B  点「面板」按钮 → 菜单出现 → 点第一个面板 → 工作台多一个标签
 * Phase C  把会话标签拖到主区左边缘（y 取中线，避开上下角落热区）
 *          → 期望 pane 数 2，且左边那个是新会话格
 *
 * 用法：PowerShell 里清 ELECTRON_RUN_AS_NODE 后
 *   & electron.exe probe-workbench-v2.cjs "<url>"
 */

const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const OUT_DIR = 'F:/workbuddy data/tmp/studio-probe'
const LOG = path.join(OUT_DIR, 'probe-v2.log')

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
      const qa = (s) => Array.from(document.querySelectorAll(s))
      return {
        applies: window.__STUDIO_DEBUG__.stats().applies,
        tabs: qa('[role="tab"]').length,
        panes: qa('[data-pane-id]').length,
        panelIds: qa('[data-panel-id]').map(n => n.getAttribute('data-panel-id')),
        hasTopbar: !!document.querySelector('[data-testid="studio-topbar"]'),
        hasMenuButton: !!document.querySelector('[data-testid="studio-panel-menu-button"]'),
        hasLive: qa('[data-testid="conversation-live"]').length,
        liveAttr: qa('[data-testid="conversation-body"]').map(n => n.getAttribute('data-live')),
      }
    })()`)
    log('[phaseA] ' + JSON.stringify(baseline))

    // ── Phase B：面板菜单 ─────────────────────────────────────────
    const menu = await run(`(async () => {
      const btn = document.querySelector('[data-testid="studio-panel-menu-button"]')
      if (!btn) return { fatal: '找不到面板按钮' }
      btn.click()
      await new Promise(r => setTimeout(r, 300))
      const panel = document.querySelector('[data-testid="studio-panel-menu"]')
      const items = Array.from(document.querySelectorAll('[data-testid="studio-panel-menu-item"]'))
      const names = items.map(n => (n.textContent || '').trim())
      if (items.length === 0) return { opened: !!panel, items: 0, names }
      const before = document.querySelectorAll('[role="tab"]').length
      items[0].click()
      await new Promise(r => setTimeout(r, 800))
      return {
        opened: !!panel,
        items: items.length,
        names,
        menuClosedAfterPick: !document.querySelector('[data-testid="studio-panel-menu"]'),
        tabsBefore: before,
        tabsAfter: document.querySelectorAll('[role="tab"]').length,
        panelHosts: Array.from(document.querySelectorAll('[data-panel-id]')).map(n => n.getAttribute('data-panel-id')),
        panelHostVisible: (() => {
          const el = document.querySelector('[data-panel-id]')
          return el ? el.getAttribute('data-active') : null
        })(),
      }
    })()`)
    log('[phaseB] ' + JSON.stringify(menu))

    // ── Phase C：拖拽落区 ────────────────────────────────────────
    const drag = await run(`(async () => {
      const shell = document.querySelector('[data-testid="workbench"]')
      const host = shell && shell.children[1]
      if (!host) return { fatal: '找不到主区容器' }
      const hostRect = host.getBoundingClientRect()

      // 找第一个会话标签（避开刚打开的面板标签）
      const tab = Array.from(document.querySelectorAll('[role="tab"]'))
        .find(n => !n.closest('[data-testid^="tab-strip"]') ? false : true)
      const target = tab || document.querySelector('[role="tab"]')
      if (!target) return { fatal: '没有标签可拖' }
      const tabRect = target.getBoundingClientRect()

      const mk = (type, x, y, buttons) => new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0, buttons,
      })

      const startX = tabRect.left + tabRect.width / 2
      const startY = tabRect.top + tabRect.height / 2
      // 左边缘热区：x 距左边 20px；y 取主区中线（避开上下角落热区 cornerH）
      const dropX = hostRect.left + 20
      const dropY = hostRect.top + hostRect.height / 2

      const panesBefore = document.querySelectorAll('[data-pane-id]').length
      target.dispatchEvent(mk('pointerdown', startX, startY, 1))
      await new Promise(r => setTimeout(r, 60))
      // 先走一小步超过 6px 阈值，再走到目标（模拟真实拖动轨迹）
      window.dispatchEvent(mk('pointermove', startX + 20, startY + 20, 1))
      await new Promise(r => setTimeout(r, 60))
      window.dispatchEvent(mk('pointermove', dropX, dropY, 1))
      await new Promise(r => setTimeout(r, 120))
      const preview = document.querySelector('[data-drag-preview]')
      window.dispatchEvent(mk('pointerup', dropX, dropY, 0))
      await new Promise(r => setTimeout(r, 600))

      return {
        hostRect: { x: Math.round(hostRect.left), y: Math.round(hostRect.top), w: Math.round(hostRect.width), h: Math.round(hostRect.height) },
        dropAt: { x: Math.round(dropX), y: Math.round(dropY) },
        previewKind: preview ? preview.getAttribute('data-drag-preview') : null,
        panesBefore,
        panesAfter: document.querySelectorAll('[data-pane-id]').length,
        tabsAfter: document.querySelectorAll('[role="tab"]').length,
        paneTabCounts: Array.from(document.querySelectorAll('[data-pane-id]')).map(p => p.querySelectorAll('[role="tab"]').length),
        paneRects: Array.from(document.querySelectorAll('[data-pane-id]')).map((p) => {
          const r = p.getBoundingClientRect()
          return { x: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) }
        }),
        splitSizes: (() => {
          const st = window.__STUDIO_DEBUG__.controller.getState()
          return st.root.kind === 'split' ? st.root.sizes.map(v => Math.round(v * 100) / 100) : null
        })(),
        // 拖拽分屏会让会话视图卸载重挂 —— hub 的进度判断必须让它不重折
        appliesAfter: window.__STUDIO_DEBUG__.stats().applies,
        progress: window.__STUDIO_DEBUG__.hub.progressOf(
          document.querySelector('[data-testid="conversation-body"]').getAttribute('data-session-id'),
        ),
      }
    })()`)
    log('[phaseC] ' + JSON.stringify(drag))

    const splitWorked = drag.panesAfter === 2
    const menuWorked = menu.items > 0 && menu.tabsAfter === menu.tabsBefore + 1
    const noRefold = drag.appliesAfter === baseline.applies
    log(
      '[verdict] ' +
        (menuWorked && splitWorked && noRefold ? 'PASS' : 'FAIL') +
        ` (菜单=${menuWorked} 拖拽分屏=${splitWorked} 不重折=${noRefold} applies ${baseline.applies}→${drag.appliesAfter})`,
    )

    await new Promise((r) => setTimeout(r, 1800))
    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(OUT_DIR, 'workbench-v2.png'), image.toPNG())
    log('[shot] workbench-v2.png')
  } catch (error) {
    log('[FATAL] ' + String(error && (error.stack || error.message || error)))
  } finally {
    app.quit()
  }
})
