/**
 * 工作台深层探测：验证真机上「同一会话两个窗口只 retain 一次」这条核心承诺。
 *
 * 分三个阶段，每阶段都读 `window.__STUDIO_DEBUG__` 的真实状态：
 *   Phase 1  首屏：左栏/主区是否接管、消息 role 分布、当前引用计数
 *   Phase 2  同一会话再开一个标签：引用计数应变 2，**底层 retain 仍是 1 条**
 *   Phase 3  关掉两个标签：宽限期后引用归零，折叠结果仍留在缓存
 *
 * 判据来自 `docs/composition.md` 的验收表（A/B/C 三条），只是这次跑在真机上。
 *
 * 用法：
 *   powershell: $env:ELECTRON_RUN_AS_NODE=$null; & electron.exe probe-workbench-deep.cjs <url>
 */

const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const OUT_DIR = 'F:/workbuddy data/tmp/studio-probe'
const LOG = path.join(OUT_DIR, 'probe-deep.log')

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

    // ── Phase 1：首屏 ────────────────────────────────────────────
    const phase1 = await run(`(() => {
      const dbg = window.__STUDIO_DEBUG__
      if (!dbg) return { fatal: '缺少 __STUDIO_DEBUG__：插件没跑到末尾' }
      const roles = {}
      for (const node of document.querySelectorAll('[data-role]')) {
        const role = node.getAttribute('data-role')
        roles[role] = (roles[role] || 0) + 1
      }
      const bodies = Array.from(document.querySelectorAll('[data-testid="conversation-body"]'))
      return {
        hasSidebar: !!document.querySelector('[data-testid="studio-sidebar"]'),
        sidebarItems: document.querySelectorAll('[data-testid="sidebar-item"]').length,
        hasWorkbench: !!document.querySelector('[data-testid="workbench"]'),
        tabCount: document.querySelectorAll('[role="tab"]').length,
        bodyCount: bodies.length,
        roles,
        messageTotal: Object.values(roles).reduce((a, b) => a + b, 0),
        sessions: dbg.inspect().map(s => ({
          target: String(s.target).slice(-12),
          refCount: s.refCount,
          generation: s.generation,
          status: s.status,
          sources: s.sources,
        })),
        leaseSize: dbg.leases.size,
        derived: dbg.stats(),
        activeSession: bodies.length ? bodies[0].getAttribute('data-session-id') : null,
      }
    })()`)
    log('[phase1] ' + JSON.stringify(phase1))

    const sessionId = phase1.activeSession
    if (!sessionId) {
      log('[verdict] FAIL —— 没有打开的会话，无法验证多视图')
      app.quit()
      return
    }

    // ── Phase 2：同一会话再开一个标签 ──────────────────────────
    const phase2 = await run(`(async () => {
      const dbg = window.__STUDIO_DEBUG__
      const sid = ${JSON.stringify(sessionId)}
      const before = { leases: dbg.inspect(), stats: dbg.stats() }
      dbg.controller.open({ kind: 'conversation', contentId: sid, instanceId: 'session:' + sid })
      await new Promise(r => setTimeout(r, 1200))
      const after = { leases: dbg.inspect(), stats: dbg.stats() }
      return {
        tabs: document.querySelectorAll('[role="tab"]').length,
        bodies: document.querySelectorAll('[data-testid="conversation-body"]').length,
        refCountBefore: before.leases.map(s => s.refCount),
        refCountAfter: after.leases.map(s => s.refCount),
        leaseSizeBefore: before.leases.length,
        leaseSizeAfter: after.leases.length,
        appliesBefore: before.stats.applies,
        appliesAfter: after.stats.applies,
        sessionsAfter: after.leases.map(s => ({ target: String(s.target).slice(-12), refCount: s.refCount, sources: s.sources })),
      }
    })()`)
    log('[phase2] ' + JSON.stringify(phase2))

    // 两个标签的样子先留一张，关光之后就只能看到空态了
    const twoTabShot = await win.webContents.capturePage()
    fs.writeFileSync(path.join(OUT_DIR, 'workbench-two-tabs.png'), twoTabShot.toPNG())
    log('[shot] workbench-two-tabs.png')

    // ── Phase 3：关掉所有标签，看宽限期后是否归零 ────────────────
    const phase3 = await run(`(async () => {
      const dbg = window.__STUDIO_DEBUG__
      const snap = () => {
        const st = dbg.controller.getState()
        const ps = []
        const walk = (n) => { if (n.kind === 'pane') ps.push({ id: n.id, tabs: n.tabs.map(t => t.id) }); else n.children.forEach(walk) }
        walk(st.root)
        return {
          panes: ps,
          domTabs: document.querySelectorAll('[role="tab"]').length,
          domBodies: document.querySelectorAll('[data-testid="conversation-body"]').length,
          leaseSize: dbg.leases.size,
          refCounts: dbg.inspect().map(s => s.refCount),
          hubSize: dbg.hub.size,
        }
      }
      const trace = { before: snap() }
      const targets = []
      const collect = (n) => { if (n.kind === 'pane') n.tabs.forEach(t => targets.push({ pane: n.id, tabId: t.id })); else n.children.forEach(collect) }
      collect(dbg.controller.getState().root)
      for (const it of targets) {
        try { dbg.controller.dispatch({ kind: 'removeTab', pane: it.pane, tabId: it.tabId }) }
        catch (e) { trace.error = String(e) }
      }
      trace.afterRemove = snap()
      await new Promise(r => setTimeout(r, 1500))
      trace.afterWait = snap()
      return {
        targets: targets.length,
        trace,
        empty: document.querySelector('[data-testid="workbench"]').getAttribute('data-empty'),
        backdrop: !!document.querySelector('[data-testid="workspace-backdrop"]'),
        cachedSessions: dbg.stats().sessions,
      }
    })()`)
    log('[phase3] ' + JSON.stringify(phase3))

    // 判定：同会话两标签 → refCount 2 但 leaseSize 仍 1（不是 2 条 retain）
    const singleRetain = phase2.leaseSizeAfter === 1 && (phase2.refCountAfter[0] || 0) >= 2
    const noRefold = phase2.appliesAfter === phase2.appliesBefore
    const releasedOnClose = phase3.trace.afterWait.leaseSize === 0
    log(
      '[verdict] ' +
        (phase1.hasWorkbench && singleRetain && noRefold && releasedOnClose ? 'PASS' : 'FAIL') +
        ` (单条retain=${singleRetain} 不重折=${noRefold} 关闭即释放=${releasedOnClose})`,
    )

    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(OUT_DIR, 'workbench-deep.png'), image.toPNG())
    log('[shot] workbench-deep.png')
  } catch (error) {
    log('[FATAL] ' + String(error && (error.stack || error.message || error)))
  } finally {
    app.quit()
  }
})
