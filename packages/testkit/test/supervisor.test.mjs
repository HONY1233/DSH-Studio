/**
 * supervisor 单测。
 *
 * 分两层：
 *   - 纯函数：启动行解析、脱敏、退避、spawn 计划构造、行分割（不碰进程）
 *   - 生命周期：用 fixture 进程模拟 `dsh web` 的真实行为（打印启动行 + /connect 换 Cookie，
 *     并接受 SIGTERM），验证 start → ready → stop 全链路。
 *
 * 为什么不用真 DSH：真 DSH 依赖 WSL + 模型 Key + 十几秒冷启动，不适合放进单测。
 * fixture 只复现 supervisor 依赖的三个契约：启动行、connect 302、可被 SIGTERM 终止。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SupervisorState,
  backoffDelay,
  buildSpawnPlan,
  connectUrl,
  cookieFromSetCookie,
  cookieSecrets,
  createLineReader,
  createSupervisor,
  parseLaunchLine,
  redact,
  shellQuote,
  stripAnsi,
} from '@dsh-studio/dsh-gateway'

// ───────────────────────────── 启动行解析 ─────────────────────────────

test('parseLaunchLine：实测格式（DSH 0.2.2-rc.5 原样输出）', () => {
  const found = parseLaunchLine(
    'dsh web: http://127.0.0.1:3099/?token=8bunm71mx_nN36wWtz9CThKr2Wq6f4G_dbc9EGcbBHk',
  )
  assert.ok(found)
  assert.equal(found.port, 3099)
  assert.equal(found.host, '127.0.0.1')
  assert.equal(found.token, '8bunm71mx_nN36wWtz9CThKr2Wq6f4G_dbc9EGcbBHk')
  assert.equal(found.url.split('/?')[0], 'http://127.0.0.1:3099')
})

test('parseLaunchLine：带 ANSI 颜色码也能解析', () => {
  const found = parseLaunchLine(
    '\u001b[32mdsh web:\u001b[0m \u001b[36mhttp://127.0.0.1:51234/?token=abcdefgh12345678\u001b[0m',
  )
  assert.ok(found)
  assert.equal(found.port, 51234)
  assert.equal(found.token, 'abcdefgh12345678')
})

test('parseLaunchLine：localhost 与 [::1] 都接受', () => {
  assert.equal(parseLaunchLine('http://localhost:8080/?token=abcdefgh12345678')?.port, 8080)
  assert.equal(parseLaunchLine('http://[::1]:8081/?token=abcdefgh12345678')?.port, 8081)
})

test('parseLaunchLine：query 顺序变化不影响', () => {
  const found = parseLaunchLine('http://127.0.0.1:3000/?foo=1&token=abcdefgh12345678&bar=2')
  assert.ok(found)
  assert.equal(found.token, 'abcdefgh12345678')
})

test('parseLaunchLine：以下情况必须返回 null（防误抓）', () => {
  // 无 token
  assert.equal(parseLaunchLine('dsh web: http://127.0.0.1:3099/'), null)
  // https 不是我们的形态
  assert.equal(parseLaunchLine('https://127.0.0.1:3099/?token=abcdefgh12345678'), null)
  // 外网地址绝不能当成本机运行时
  assert.equal(parseLaunchLine('http://10.0.0.5:3099/?token=abcdefgh12345678'), null)
  // token 太短，多半是别的参数
  assert.equal(parseLaunchLine('http://127.0.0.1:3099/?token=abc'), null)
  // 端口非法
  assert.equal(parseLaunchLine('http://127.0.0.1:0/?token=abcdefgh12345678'), null)
  assert.equal(parseLaunchLine('http://127.0.0.1:70000/?token=abcdefgh12345678'), null)
  // 无关日志
  assert.equal(parseLaunchLine('[info] plugin tree loaded'), null)
  assert.equal(parseLaunchLine(''), null)
})

test('stripAnsi 清干净，不留残码', () => {
  assert.equal(stripAnsi('\u001b[1;31mred\u001b[0m'), 'red')
})

// ───────────────────────────── 脱敏 ─────────────────────────────

test('redact：显式 secret 全部替换', () => {
  const token = 'abcdefgh12345678'
  const out = redact(`url?token=${token} and again ${token}`, [token])
  assert.ok(!out.includes(token))
  assert.equal(out.match(/<redacted>/g).length, 2)
})

test('redact：兜底正则覆盖漏报名单的 token', () => {
  const out = redact('POST /api?token=zzzzzzzzzzzzzzzzzz')
  assert.ok(!out.includes('zzzzzzzzzzzzzzzzzz'))
  assert.ok(out.includes('token=<redacted>'))
})

test('redact：短串不替换（避免把正常单词打碎）', () => {
  assert.equal(redact('hello abc world', ['abc']), 'hello abc world')
})

// ───────────────────────────── connect / Cookie ─────────────────────────────

test('connectUrl：必须带 interactions=none', () => {
  const url = connectUrl('http://127.0.0.1:3099', 'tok123456789012')
  const parsed = new URL(url)
  assert.equal(parsed.pathname, '/connect')
  assert.equal(parsed.searchParams.get('token'), 'tok123456789012')
  assert.equal(parsed.searchParams.get('interactions'), 'none')
})

test('cookieFromSetCookie：只留 name=value，丢掉响应侧属性', () => {
  const cookie = cookieFromSetCookie([
    'dsh_session=abc123; Path=/; HttpOnly; SameSite=Lax',
    'other=x; Max-Age=3600',
  ])
  assert.equal(cookie, 'dsh_session=abc123; other=x')
})

test('cookieFromSetCookie：异常输入不抛错', () => {
  assert.equal(cookieFromSetCookie([]), '')
  assert.equal(cookieFromSetCookie(null), '')
  assert.equal(cookieFromSetCookie(['garbage-without-equals']), '')
})

test('cookieSecrets：抽出所有可脱敏的 value', () => {
  const values = cookieSecrets('dsh_session=abc12345; other=xy')
  assert.deepEqual(values, ['abc12345'])
})

// ───────────────────────────── 退避 ─────────────────────────────

test('backoffDelay：指数增长且被 maxMs 夹住', () => {
  const cfg = { baseMs: 1000, factor: 2, maxMs: 30000, jitter: 0, random: () => 0.5 }
  assert.equal(backoffDelay(1, cfg), 1000)
  assert.equal(backoffDelay(2, cfg), 2000)
  assert.equal(backoffDelay(3, cfg), 4000)
  assert.equal(backoffDelay(4, cfg), 8000)
  assert.equal(backoffDelay(5, cfg), 16000)
  assert.equal(backoffDelay(6, cfg), 30000)
  assert.equal(backoffDelay(99, cfg), 30000)
})

test('backoffDelay：jitter 不越界', () => {
  const cfg = { baseMs: 1000, factor: 2, maxMs: 5000, jitter: 0.5 }
  for (let i = 0; i < 200; i += 1) {
    const delay = backoffDelay(4, cfg)
    assert.ok(delay >= 0 && delay <= 5000, `delay=${delay} 越界`)
  }
})

test('backoffDelay：非法 attempt 不产生 NaN', () => {
  assert.equal(Number.isNaN(backoffDelay(0, { jitter: 0 })), false)
  assert.equal(Number.isNaN(backoffDelay('x', { jitter: 0 })), false)
})

// ───────────────────────────── spawn 计划 ─────────────────────────────

test('shellQuote：安全字符不加引号，其他加单引号并转义', () => {
  assert.equal(shellQuote('dsh'), 'dsh')
  assert.equal(shellQuote('--profile'), '--profile')
  assert.equal(shellQuote('/usr/local/bin/dsh'), '/usr/local/bin/dsh')
  assert.equal(shellQuote('a b'), "'a b'")
  assert.equal(shellQuote("it's"), `'it'\\''s'`)
})

test('buildSpawnPlan：WSL 模式经 wsl.exe 转发，且不带 --trusted-host', () => {
  const plan = buildSpawnPlan({ distro: 'ubuntu', platform: 'win32' })
  assert.equal(plan.file, 'wsl.exe')
  assert.deepEqual(plan.args.slice(0, 4), ['-d', 'ubuntu', '-e', 'bash'])
  assert.equal(plan.args[4], '-c')
  assert.equal(plan.wrappedBy, 'wsl')
  // 用 -c 不用 -lc：login shell 会加载 rc 文件污染 stdout
  assert.ok(!plan.args.includes('-lc'))
  assert.ok(plan.args[5].includes('--profile web'))
  assert.ok(!plan.args[5].includes('trusted-host'))
  assert.ok(plan.args[5].includes('--no-open'))
})

test('buildSpawnPlan：非 WSL 模式直接 spawn，env 走 child env', () => {
  const plan = buildSpawnPlan({
    distro: null,
    command: '/fake/dsh',
    args: ['--profile', 'web'],
    env: { FOO: 'bar' },
    launchId: 'L1',
  })
  assert.equal(plan.file, '/fake/dsh')
  assert.deepEqual(plan.args, ['--profile', 'web'])
  assert.equal(plan.env.FOO, 'bar')
  assert.equal(plan.env.DSH_STUDIO_LAUNCH_ID, 'L1')
  assert.equal(plan.wrappedBy, null)
})

test('buildSpawnPlan：WSL 模式下 env 必须写进命令前缀（宿主 env 不过边界）', () => {
  const plan = buildSpawnPlan({ distro: 'ubuntu', platform: 'linux', launchId: 'L2' })
  assert.equal(plan.env && Object.keys(plan.env).length, 0)
  assert.ok(plan.args[5].startsWith('DSH_STUDIO_LAUNCH_ID=L2 '))
})

test('buildSpawnPlan：matchPattern 足以区分不同 profile', () => {
  const plan = buildSpawnPlan({ distro: 'ubuntu', args: ['--profile', 'web', '--port', '0'] })
  assert.ok(plan.matchPattern.includes('--profile web'))
})

// ───────────────────────────── 行分割 ─────────────────────────────

test('createLineReader：跨 chunk 的半行能拼回来', () => {
  const lines = []
  const reader = createLineReader((line) => lines.push(line))
  reader.push('dsh web: http://127.0.0.1:3')
  assert.deepEqual(lines, [])
  reader.push('099/?token=abcdefgh12345678\n')
  assert.equal(lines.length, 1)
  assert.ok(lines[0].includes('token=abcdefgh12345678'))
})

test('createLineReader：一次多行 + CRLF', () => {
  const lines = []
  const reader = createLineReader((line) => lines.push(line))
  reader.push('a\r\nb\nc\n')
  assert.deepEqual(lines, ['a', 'b', 'c'])
})

test('createLineReader：flush 吐出残留，空行不回调', () => {
  const lines = []
  const reader = createLineReader((line) => lines.push(line))
  reader.push('tail-without-newline')
  reader.flush()
  assert.deepEqual(lines, ['tail-without-newline'])
  reader.push('\n\n')
  assert.equal(lines.length, 1)
})

// ───────────────────────────── 生命周期（fixture 进程） ─────────────────────────────

/**
 * fixture：模拟 dsh web 的最小行为。
 * - 监听随机端口，向 stdout 打印与真实格式一致的启动行
 * - /connect 返回 302 + Set-Cookie
 * - 收到 SIGTERM 后自行退出
 */
const FIXTURE_SOURCE = `
const http = require('node:http')
const FIXTURE_TOKEN = 'fixtureTOKEN1234567890'
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/connect')) {
    res.writeHead(302, { location: '/', 'set-cookie': 'dsh_session=COOKIEVALUE998877; Path=/; HttpOnly' })
    res.end()
    return
  }
  res.writeHead(200); res.end('ok')
})
server.listen(0, '127.0.0.1', () => {
  const port = server.address().port
  console.log('starting plugin tree...')
  console.log('dsh web: http://127.0.0.1:' + port + '/?token=' + FIXTURE_TOKEN)
})
process.on('SIGTERM', () => { server.close(); process.exit(0) })
`

function fixtureSupervisor(overrides = {}) {
  return createSupervisor({
    distro: null,
    command: process.execPath,
    args: ['-e', FIXTURE_SOURCE],
    launchTimeoutMs: 10_000,
    connectTimeoutMs: 5_000,
    stopGraceMs: 2_000,
    stableMs: 1_000,
    autoRestart: false,
    ...overrides,
  })
}

test('createSupervisor：start → ready → stop 全链路', async () => {
  const sup = fixtureSupervisor()
  const logs = []
  sup.on('log', ({ line }) => logs.push(line))

  try {
    const info = await sup.start()
    assert.equal(sup.state, SupervisorState.ready)
    assert.ok(info.port > 0)
    assert.equal(info.base, `http://127.0.0.1:${info.port}`)
    assert.equal(info.cookie, 'dsh_session=COOKIEVALUE998877')

    // 日志必须脱敏：fixture 打印过 token
    const flat = logs.join('\n')
    assert.ok(!flat.includes('fixtureTOKEN1234567890'), '日志里泄露了 token')
    assert.ok(flat.includes('token=<redacted>') || flat.includes('<redacted>'))
    // 普通日志照常保留，不能把有用信息一起吞掉
    assert.ok(flat.includes('starting plugin tree'))
  } finally {
    await sup.stop()
  }
  assert.equal(sup.state, SupervisorState.stopped)
  assert.equal(sup.info, null)
})

test('createSupervisor：重复 start 返回同一个 ready 结果', async () => {
  const sup = fixtureSupervisor()
  try {
    const [a, b] = await Promise.all([sup.start(), sup.start()])
    assert.equal(a.port, b.port)
    assert.equal(sup.state, SupervisorState.ready)
  } finally {
    await sup.stop()
  }
})

test('createSupervisor：refreshCookie 能换出新 Cookie', async () => {
  const sup = fixtureSupervisor()
  try {
    const first = await sup.start()
    const next = await sup.refreshCookie()
    assert.equal(next, first.cookie)
    assert.equal(sup.info.cookie, next)
  } finally {
    await sup.stop()
  }
})

test('createSupervisor：启动行超时后能给出可读错误并不留进程', async () => {
  const sup = createSupervisor({
    distro: null,
    command: process.execPath,
    // 只打日志，永不打印启动行
    args: ['-e', "console.log('no launch line here'); setInterval(() => {}, 1000)"],
    launchTimeoutMs: 400,
    autoRestart: false,
  })

  const errors = []
  sup.on('error', (e) => errors.push(e))

  await assert.rejects(() => sup.start())
  assert.equal(sup.state, SupervisorState.failed)
  assert.ok(errors.length >= 1)
  // 三段式文案必须齐全
  const first = errors[0]
  assert.ok(first.what && first.why && first.todo, '错误必须带 what/why/todo')

  await sup.stop()
})

test('createSupervisor：命令不存在时给出 transport 错误', async () => {
  const sup = createSupervisor({
    distro: null,
    command: process.platform === 'win32' ? 'definitely-not-a-command.exe' : 'definitely-not-a-command',
    args: [],
    launchTimeoutMs: 2_000,
    autoRestart: false,
  })
  // 故意不监听 'error' 事件：EventEmitter 对 error 是特殊事件，没有监听器时会直接 throw。
  // supervisor 必须自行兜底，否则消费方一次疏忽就能把主进程带崩。
  const logs = []
  sup.on('log', ({ line }) => logs.push(line))

  await assert.rejects(() => sup.start())
  assert.ok([SupervisorState.failed, SupervisorState.stopped].includes(sup.state))
  assert.ok(sup.lastError, '没监听 error 时也应能从 lastError 查到')
  assert.ok(
    logs.some((line) => line.includes('[error]')),
    '没人接的 error 应降级到日志流，不能静默丢弃',
  )
  await sup.stop()
})

test('createSupervisor：stop 幂等，重复调用不挂死', async () => {
  const sup = fixtureSupervisor()
  await sup.start()
  await Promise.all([sup.stop(), sup.stop()])
  await sup.stop()
  assert.equal(sup.state, SupervisorState.stopped)
})

test('createSupervisor：dispose 后 start 直接拒绝', async () => {
  const sup = fixtureSupervisor()
  await sup.start()
  await sup.dispose()
  await assert.rejects(() => sup.start(), /销毁/)
})
