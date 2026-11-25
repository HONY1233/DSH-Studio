/**
 * spike：验证第三方 UI 插件是否真的进入浏览器 boot graph。
 *
 * 装配成功（--dump-config 能看到 row）不等于浏览器会加载它。
 * 这个脚本起真服务，带 Cookie 取首页，检查 window.__DSH_BOOT__ 里有没有我们的包。
 *
 * 用法：node packages/testkit/scripts/boot-check.mjs [profile] [packageName]
 */

import { createSupervisor } from '@dsh-studio/dsh-gateway'

const profile = process.argv[2] ?? 'ui-spike'
const packageName = process.argv[3] ?? 'dsh-studio-ui-spike'

const sup = createSupervisor({
  distro: process.platform === 'win32' ? 'ubuntu' : null,
  args: ['--profile', profile, '--port', '0', '--host', '127.0.0.1', '--no-open'],
  launchTimeoutMs: 120_000,
})

sup.on('state', ({ from, to }) => console.log(`[state] ${from} → ${to}`))
sup.on('error', (e) => console.error(`[error] ${e.code}: ${e.what}`))

let exitCode = 1
try {
  const info = await sup.start()
  console.log(`ready: ${info.base}`)

  const res = await fetch(`${info.base}/`, {
    headers: { cookie: info.cookie },
  })
  const html = await res.text()
  console.log(`GET / → ${res.status}, ${html.length} bytes`)

  const bootIdx = html.indexOf('__DSH_BOOT__')
  console.log(`__DSH_BOOT__ 位置: ${bootIdx}`)

  if (bootIdx >= 0) {
    const snippet = html.slice(bootIdx, bootIdx + 900)
    console.log('--- boot 片段 ---')
    console.log(snippet)
    console.log('--- 片段结束 ---')
  } else {
    // boot graph 可能在外部脚本里，扫一遍所有 script src
    const srcs = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1])
    console.log('外部脚本:', srcs.slice(0, 10))
  }

  const inBoot = html.includes(packageName)
  console.log(`\n结论: boot graph ${inBoot ? '包含' : '不包含'} ${packageName}`)
  if (inBoot) exitCode = 0
} catch (error) {
  console.error('[FATAL]', error?.message ?? error)
} finally {
  await sup.stop()
}

process.exit(exitCode)
