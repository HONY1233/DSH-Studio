/**
 * Desktop smoke check over the Chromium DevTools Protocol.
 * Requires the app to be started with `--remote-debugging-port=9333`.
 *
 *   node packages/testkit/scripts/cdp-smoke.mjs [--prompt "只回复 pong"]
 *
 * Prints the rendered runtime status and, when `--prompt` is given, drives one
 * turn through the preload API and reports the resulting bubbles.
 */
const args = process.argv.slice(2)
const port = process.env.DSH_CDP_PORT ?? '9333'
const promptIndex = args.indexOf('--prompt')
const prompt = promptIndex >= 0 ? args[promptIndex + 1] : null
const throughUi = args.includes('--ui')

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = targets.find((target) => target.type === 'page' && target.url.startsWith('http://127.0.0.1:5173'))
if (!page) {
  console.error('renderer page not found:', targets.map((target) => target.url))
  process.exit(1)
}

const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let nextId = 0
const pending = new Map()
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  const waiter = pending.get(message.id)
  if (!waiter) return
  pending.delete(message.id)
  waiter(message)
})

function send(method, params = {}) {
  const id = ++nextId
  return new Promise((resolve) => {
    pending.set(id, resolve)
    socket.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (response.error) throw new Error(JSON.stringify(response.error))
  return response.result?.result?.value
}

const statusBefore = await evaluate(`({
  status: document.querySelector('.chip.status')?.textContent,
  dot: document.querySelector('.dot')?.dataset.state,
  disabled: document.querySelector('textarea')?.disabled,
  chips: [...document.querySelectorAll('.chip')].map((el) => el.textContent),
})`)
console.log('[ui]', JSON.stringify(statusBefore))

if (prompt) {
  if (throughUi) {
    await evaluate(`(() => {
      const textarea = document.querySelector('textarea')
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(textarea, ${JSON.stringify(prompt)})
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      const button = [...document.querySelectorAll('button')].find((el) => el.textContent === '发送')
      button.click()
      return true
    })()`)
  } else {
    await evaluate(`(() => {
      const tab = document.querySelector('.tab.active')
      return window.dsh.query(tab.title, ${JSON.stringify(prompt)})
    })()`)
  }
  await new Promise((resolve) => setTimeout(resolve, 8000))
  const after = await evaluate(`({
    bubbles: [...document.querySelectorAll('.bubble')].map((el) => ({
      role: el.querySelector('.role')?.textContent,
      text: el.querySelector('.text')?.textContent?.slice(0, 160),
    })),
    notices: [...document.querySelectorAll('.notice')].map((el) => el.textContent),
    running: !!document.querySelector('.thinking'),
  })`)
  console.log('[ui]', JSON.stringify(after, null, 2))
}

if (args.includes('--multi')) {
  const typeAndSend = async (text) => {
    await evaluate(`(() => {
      const textarea = document.querySelector('textarea')
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(textarea, ${JSON.stringify(text)})
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      ;[...document.querySelectorAll('button')].find((el) => el.textContent === '发送').click()
      return true
    })()`)
    await new Promise((resolve) => setTimeout(resolve, 4000))
  }

  await evaluate(`[...document.querySelectorAll('.tab.new')][0].click()`)
  await new Promise((resolve) => setTimeout(resolve, 500))
  await typeAndSend('/plan off')
  const secondTab = await evaluate(`({
    tabs: [...document.querySelectorAll('.tab:not(.new)')].map((el) => el.textContent),
    active: document.querySelector('.tab.active')?.title,
    bubbles: [...document.querySelectorAll('.bubble .text')].map((el) => el.textContent),
    notices: [...document.querySelectorAll('.notice')].map((el) => el.textContent),
  })`)

  await evaluate(`document.querySelectorAll('.tab:not(.new)')[0].click()`)
  await new Promise((resolve) => setTimeout(resolve, 800))
  const firstTab = await evaluate(`({
    active: document.querySelector('.tab.active')?.title,
    bubbles: [...document.querySelectorAll('.bubble .text')].map((el) => el.textContent),
    notices: [...document.querySelectorAll('.notice')].map((el) => el.textContent),
  })`)

  console.log('[multi]', JSON.stringify({ secondTab, firstTab }, null, 2))
}

if (args.includes('--recent')) {
  await evaluate(`[...document.querySelectorAll('.tab.recent')][0].click()`)
  await new Promise((resolve) => setTimeout(resolve, 1500))
  const listed = await evaluate(`({
    items: [...document.querySelectorAll('.recent-item')].map((el) => ({
      title: el.querySelector('.recent-title')?.textContent,
      meta: el.querySelector('.recent-meta')?.textContent,
    })),
  })`)
  console.log('[recent]', JSON.stringify(listed, null, 2))

  const target = args[args.indexOf('--recent') + 1]
  if (target) {
    await evaluate(`(() => {
      const hit = document.querySelector('.recent-item[data-session-id=' + JSON.stringify(${JSON.stringify(target)}) + ']')
        ?? [...document.querySelectorAll('.recent-item')].find((el) => el.textContent.includes(${JSON.stringify(target)}))
      if (!hit) return false
      hit.click()
      return true
    })()`)
    await new Promise((resolve) => setTimeout(resolve, 4000))
    const opened = await evaluate(`({
      tabs: [...document.querySelectorAll('.tab:not(.new):not(.recent)')].map((el) => el.getAttribute('title')),
      bubbles: [...document.querySelectorAll('.bubble')].map((el) => ({
        role: el.querySelector('.role')?.textContent,
        text: el.querySelector('.text')?.textContent?.slice(0, 120),
      })),
      notices: [...document.querySelectorAll('.notice')].map((el) => el.textContent),
    })`)
    console.log('[recent-open]', JSON.stringify(opened, null, 2))
  }
}

if (args.includes('--files')) {
  const header = await evaluate(`document.querySelector('.panel-head strong')?.textContent ?? null`)
  if (!header || !header.includes('工作区文件')) {
    await evaluate(`[...document.querySelectorAll('.chip.action')].find((el) => el.textContent === '文件').click()`)
  }
  await new Promise((resolve) => setTimeout(resolve, 1800))
  const tree = await evaluate(`({
    root: [...document.querySelectorAll('.node-row:not(.file) .node-name')].map((el) => el.textContent),
    files: [...document.querySelectorAll('.node-row.file .node-name')].map((el) => el.textContent).slice(0, 12),
  })`)
  console.log('[files]', JSON.stringify(tree, null, 2))

  const target = args[args.indexOf('--files') + 1]
  if (target) {
    await evaluate(`(() => {
      const hit = [...document.querySelectorAll('.node-row.file')].find((el) => el.textContent.includes(${JSON.stringify(target)}))
      if (!hit) return false
      hit.click()
      return true
    })()`)
    await new Promise((resolve) => setTimeout(resolve, 2000))
    const preview = await evaluate(`({
      head: document.querySelector('.preview-head')?.textContent,
      sample: document.querySelector('.preview pre')?.textContent?.slice(0, 200),
      note: document.querySelector('.preview-note')?.textContent,
    })`)
    console.log('[files-open]', JSON.stringify(preview, null, 2))
  }
}

if (args.includes('--changes')) {
  const header = await evaluate(`document.querySelector('.panel-head strong')?.textContent ?? null`)
  if (!header || !header.startsWith('变更')) {
    await evaluate(`[...document.querySelectorAll('.chip.action')].find((el) => el.textContent === '变更').click()`)
  }
  await new Promise((resolve) => setTimeout(resolve, 2500))
  const list = await evaluate(`({
    rows: [...document.querySelectorAll('.change-row')].map((el) => el.textContent).slice(0, 15),
    empty: document.querySelector('.change-list .panel-note')?.textContent,
    error: document.querySelector('.panel-error')?.textContent,
  })`)
  console.log('[changes]', JSON.stringify(list, null, 2))

  if (!list.empty && !list.error) {
    await evaluate(`document.querySelectorAll('.change-row')[0]?.click()`)
    await new Promise((resolve) => setTimeout(resolve, 2000))
    const diff = await evaluate(`({
      head: document.querySelector('.preview-head')?.textContent,
      sample: document.querySelector('.preview pre')?.textContent?.slice(0, 240),
    })`)
    console.log('[changes-diff]', JSON.stringify(diff, null, 2))
  }
}

if (args.includes('--terminal')) {
  await send('Page.bringToFront')
  const header = await evaluate(`document.querySelector('.panel-head strong')?.textContent ?? null`)
  if (!header || !header.startsWith('终端')) {
    await evaluate(`[...document.querySelectorAll('.chip.action')].find((el) => el.textContent === '终端').click()`)
  }
  await new Promise((resolve) => setTimeout(resolve, 3000))
  const started = await evaluate(`({
    head: document.querySelector('.panel-head strong')?.textContent,
    error: document.querySelector('.panel-error')?.textContent ?? null,
    rows: document.querySelectorAll('.xterm-rows > div').length,
  })`)
  console.log('[terminal]', JSON.stringify(started, null, 2))

  // 走 preload → IPC → PTY → 回传 → xterm 的完整链路
  const wrote = await evaluate(`window.dsh.terminalWrite("printf 'TERM%s\\\\n' _OK\\n")`)
  await new Promise((resolve) => setTimeout(resolve, 1500))
  // 窗口被系统判定为隐藏时 Chromium 会停掉 xterm 的绘制，这时读缓冲区验证数据链路。
  const screen = await evaluate(`(() => {
    const term = window.__term
    const buffer = term
      ? Array.from({ length: term.rows }, (_, i) => term.buffer.active.getLine(i)?.translateToString(true)).join('\\n')
      : ''
    return {
      wrote: ${JSON.stringify(wrote)},
      visibility: document.visibilityState,
      dom: document.querySelector('.xterm-rows')?.innerText ?? '',
      buffer,
      cols: term?.cols ?? null,
      rows: term?.rows ?? null,
    }
  })()`)
  console.log('[terminal-echo]', JSON.stringify({ ...screen, buffer: screen.buffer.slice(0, 400) }, null, 2))
  const saw = `${screen.dom}\n${screen.buffer}`.includes('TERM_OK')
  console.log('[terminal-assert]', saw ? 'PASS' : 'FAIL', 'saw TERM_OK')

  const resized = await evaluate(`window.dsh.terminalResize(90, 26)`)
  await new Promise((resolve) => setTimeout(resolve, 800))
  const afterResize = await evaluate(`({
    ok: ${JSON.stringify(resized)},
    error: document.querySelector('.panel-error')?.textContent ?? null,
    cols: window.__term?.cols ?? null,
    rows: window.__term?.rows ?? null,
    still: (window.__term ? Array.from({ length: window.__term.rows }, (_, i) => window.__term.buffer.active.getLine(i)?.translateToString(true)).join('\\n') : '').includes('TERM_OK'),
  })`)
  console.log('[terminal-resize]', JSON.stringify(afterResize, null, 2))
  const resizedOk = resized && resized.cols === 90 && resized.rows === 26
  console.log('[terminal-resize-assert]', resizedOk ? 'PASS' : 'FAIL', 'pty cols/rows = 90/26')

  // 关掉面板再打开：PTY 不重启，靠主进程回放缓冲恢复画面
  await evaluate(`[...document.querySelectorAll('.panel-actions button')].find((el) => el.textContent === '关闭').click()`)
  await new Promise((resolve) => setTimeout(resolve, 600))
  await evaluate(`[...document.querySelectorAll('.chip.action')].find((el) => el.textContent === '终端').click()`)
  await new Promise((resolve) => setTimeout(resolve, 1800))
  const reopened = await evaluate(`(() => {
    const term = window.__term
    const buffer = term
      ? Array.from({ length: term.rows }, (_, i) => term.buffer.active.getLine(i)?.translateToString(true)).join('\\n')
      : ''
    return { head: document.querySelector('.panel-head strong')?.textContent, sawScrollback: buffer.includes('TERM_OK') }
  })()`)
  console.log('[terminal-reopen]', JSON.stringify(reopened, null, 2))
  console.log('[terminal-reopen-assert]', reopened.sawScrollback ? 'PASS' : 'FAIL', 'scrollback replayed after reopen')
}

if (args.includes('--browser')) {
  await send('Page.bringToFront')
  const header = await evaluate(`document.querySelector('.panel-head strong')?.textContent ?? null`)
  if (!header || !header.startsWith('浏览器')) {
    await evaluate(`[...document.querySelectorAll('.chip.action')].find((el) => el.textContent === '浏览器').click()`)
  }
  await new Promise((resolve) => setTimeout(resolve, 2500))
  const shown = await evaluate(`window.dsh.browserState()`)
  console.log('[browser]', JSON.stringify(shown, null, 2))

  const dataUrl = 'data:text/html,<title>BROWSER_OK</title><h1>BROWSER_OK</h1>'
  const navigated = await evaluate(`window.dsh.browserNavigate(${JSON.stringify(dataUrl)})`)
  await new Promise((resolve) => setTimeout(resolve, 2000))
  const after = await evaluate(`(() => window.dsh.browserState().then((state) => ({
    state,
    head: document.querySelector('.panel-head strong')?.textContent,
    address: document.querySelector('.browser-bar input')?.value,
    error: document.querySelector('.panel-error')?.textContent ?? null,
  })))()`)
  console.log('[browser-open]', JSON.stringify(after, null, 2))
  const ok = after.state.attached && after.state.title === 'BROWSER_OK' &&
    after.state.bounds?.width > 100 && after.state.bounds?.height > 100
  console.log('[browser-assert]', ok ? 'PASS' : 'FAIL', 'attached + title + bounds')
  console.log('[browser-navigated-url]', navigated.url)
}

if (args.includes('--logs')) {
  const header = await evaluate(`document.querySelector('.panel-head strong')?.textContent ?? null`)
  if (!header || !header.startsWith('日志')) {
    await evaluate(`[...document.querySelectorAll('.chip.action')].find((el) => el.textContent === '日志').click()`)
  }
  await new Promise((resolve) => setTimeout(resolve, 1200))
  await evaluate(`window.dsh.logsClear()`)
  await new Promise((resolve) => setTimeout(resolve, 400))

  // 用原生命令造一轮流量，不花模型额度
  await evaluate(`(() => {
    const tab = document.querySelector('.tab.active')
    return window.dsh.query(tab.title, '/plan off')
  })()`)
  await new Promise((resolve) => setTimeout(resolve, 2500))

  const rows = await evaluate(`({
    count: document.querySelectorAll('.log-row').length,
    texts: [...document.querySelectorAll('.log-row')].map((el) => el.textContent).slice(0, 10),
    head: document.querySelector('.panel-head strong')?.textContent,
  })`)
  console.log('[logs]', JSON.stringify(rows, null, 2))
  const hasRequest = rows.texts.some((text) => text.includes('session/query'))
  const hasEvent = rows.texts.some((text) => text.includes('session.event'))
  console.log('[logs-assert]', rows.count >= 2 && hasRequest && hasEvent ? 'PASS' : 'FAIL', 'wire frames recorded')

  const filtered = await evaluate(`(() => {
    const input = document.querySelector('.log-bar input')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, 'zzz-not-exist')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await new Promise((resolve) => setTimeout(resolve, 500))
  const empty = await evaluate(`({
    sent: ${JSON.stringify(filtered)},
    count: document.querySelectorAll('.log-row').length,
    note: document.querySelector('.log-list .panel-note')?.textContent ?? null,
  })`)
  console.log('[logs-filter]', JSON.stringify(empty, null, 2))
  console.log('[logs-filter-assert]', empty.count === 0 ? 'PASS' : 'FAIL', 'filter hides all rows')
}

socket.close()
