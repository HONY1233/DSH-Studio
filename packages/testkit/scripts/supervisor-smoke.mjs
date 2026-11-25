/**
 * supervisor 真机冒烟。
 *
 * 单测用的是 fixture 进程，只能证明逻辑；这个脚本证明「对着真 DSH 也成立」：
 *   spawn → 抓启动行 → /connect 换 Cookie → 用该 Cookie 真调一次 /api
 *
 * 跑法（Windows 宿主，DSH 在 WSL 内）：
 *   node packages/testkit/scripts/supervisor-smoke.mjs
 *   node packages/testkit/scripts/supervisor-smoke.mjs --distro ubuntu
 *
 * 注意：会真的启动一个 dsh web 进程，结束时 shutdown 掉。不消耗模型额度
 * （不调 prompt，只调 session/list）。
 */

import { buildArgs, checkArgs, createSupervisor, formatArgProblems } from '@dsh-studio/dsh-gateway'

const argv = process.argv.slice(2)
const distroArg = argv.indexOf('--distro')
const distro = distroArg >= 0 ? argv[distroArg + 1] : process.platform === 'win32' ? 'ubuntu' : null

const sup = createSupervisor({
  distro,
  launchTimeoutMs: 120_000,
  connectTimeoutMs: 20_000,
})

let launchLineSeen = false
sup.on('state', ({ from, to, reason }) => {
  console.log(`[state] ${from} → ${to}${reason ? ` (${reason})` : ''}`)
})
sup.on('log', ({ stream, line }) => {
  if (line.includes('token=')) launchLineSeen = true
  console.log(`[${stream}] ${line}`)
})
sup.on('error', (e) => {
  console.error(`[error] ${e.code}`)
  console.error(`        发生了什么: ${e.what}`)
  console.error(`        为什么:     ${e.why}`)
  console.error(`        能做什么:   ${e.todo}`)
})

const startedAt = Date.now()
let exitCode = 1

try {
  const info = await sup.start()
  const elapsed = Date.now() - startedAt

  console.log('\n===== supervisor ready =====')
  console.log(`耗时:     ${elapsed}ms`)
  console.log(`base:     ${info.base}`)
  console.log(`port:     ${info.port}`)
  console.log(`cookie:   ${info.cookie ? '已获得' : '缺失'}`)
  console.log(`pid:      ${info.pid}`)
  console.log(`日志脱敏: ${launchLineSeen ? 'PASS（token 已被替换）' : '未检测到含 token 的日志行'}`)

  // 关键验证：supervisor 交出的 { base, cookie } 必须能直接当凭证用。
  // args 交给 descriptor 生成：session/list 的参数名是 `_request` 而不是 `request`，
  // 手写必然踩坑（HTTP 200 + gateway/arguments-invalid）。
  const args = buildArgs('session/list', {})
  const precheck = checkArgs('session/list', args)
  console.log('\n===== 参数预检 =====')
  console.log(`args: ${JSON.stringify(args)}`)
  console.log(`预检: ${precheck.ok ? 'PASS' : `FAIL — ${formatArgProblems(precheck.problems)}`}`)

  const res = await fetch(`${info.base}/api/session/list`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: info.cookie,
      // 绝不设 Origin：loopback 的 Host 本身就能过 trust fence
    },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: 'smoke-1',
      method: 'session/list',
      payload: { args },
    }),
  })

  const raw = await res.text()
  console.log('\n===== API 冒烟 =====')
  console.log(`POST /api/session/list → ${res.status}`)
  let parsed = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    /* 401/403 是纯文本，不是 JSON */
  }
  if (parsed) {
    console.log(`ok: ${parsed.result?.ok}`)
    if (parsed.result?.error) {
      console.log(`error: ${JSON.stringify(parsed.result.error).slice(0, 400)}`)
    }
    const items = parsed.result?.value?.items
    if (Array.isArray(items)) console.log(`会话数: ${items.length}`)
  } else {
    console.log(`body(非 JSON): ${raw.slice(0, 200)}`)
  }

  const apiOk = res.status === 200 && parsed?.result?.ok === true
  console.log(`\n结论: ${apiOk ? 'PASS — supervisor 交出的凭证可直接调用 API' : 'FAIL — 凭证或寻址有问题'}`)
  if (apiOk) exitCode = 0
} catch (error) {
  console.error('\n[FATAL]', error?.message ?? error)
  if (error?.code) console.error(`        code: ${error.code}`)
} finally {
  const stopAt = Date.now()
  await sup.stop()
  console.log(`\n[stop] 用时 ${Date.now() - stopAt}ms，最终状态: ${sup.state}`)
}

process.exit(exitCode)
