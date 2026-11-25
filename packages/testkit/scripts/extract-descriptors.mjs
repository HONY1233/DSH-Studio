#!/usr/bin/env node
/**
 * DSH Remote descriptor 提取器。
 *
 * 为什么需要它：
 * 每个 remote 方法的**参数名由自己的 descriptor 决定，没有统一规律**——
 * 实测 `session/create` 的参数叫 `request`，而 `session/list` 叫 `_request`。
 * 靠经验猜必然出错（HTTP 200 + gateway/arguments-invalid，且只在运行期暴露）。
 *
 * 所以 CommandMap 不手写参数名，而是从 DSH 自己的 descriptor 生成。
 * DSH 升级后重跑本脚本 diff 一次，就知道哪些方法签名变了。
 *
 * 必须在 **WSL 内**运行（descriptor 文件在 WSL 的 node_modules 里）：
 *   wsl -d ubuntu -e node /mnt/f/projects/dsh-studio/packages/testkit/scripts/extract-descriptors.mjs
 *
 * 可选参数：
 *   --dsh-root <path>   DSH 安装根目录
 *   --out <path>        输出路径（默认 packages/dsh-gateway/src/wire/descriptors.json）
 *   --pretty            格式化输出
 */

import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_DSH_ROOT =
  '/opt/node-v24.9.0-linux-x64/lib/node_modules/@deepseek-ai/dsh'

function parseArgs(argv) {
  const out = { dshRoot: DEFAULT_DSH_ROOT, out: null, pretty: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dsh-root') out.dshRoot = argv[++i]
    else if (arg === '--out') out.out = argv[++i]
    else if (arg === '--pretty') out.pretty = true
  }
  if (!out.out) {
    // 脚本位于 <repo>/packages/testkit/scripts/，向上三级是仓库根
    const here = dirname(new URL(import.meta.url).pathname)
    out.out = resolve(here, '../../../packages/dsh-gateway/src/wire/descriptors.json')
  }
  return out
}

/** 递归把 jsonSchema 里的 description 剥掉，只留结构。能省掉一大半体积。 */
function stripDescriptions(node, depth = 0) {
  if (depth > 12) return { $truncated: true }
  if (Array.isArray(node)) return node.map((item) => stripDescriptions(item, depth + 1))
  if (node && typeof node === 'object') {
    const next = {}
    for (const [key, value] of Object.entries(node)) {
      if (key === 'description' || key === '$comment') continue
      next[key] = stripDescriptions(value, depth + 1)
    }
    return next
  }
  return node
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const dshRoot = args.dshRoot
  const scopeDir = join(dshRoot, 'node_modules', '@deepseek-ai')

  if (!existsSync(scopeDir)) {
    console.error(`找不到 DSH 的 @deepseek-ai 目录：${scopeDir}`)
    console.error('确认 --dsh-root 是否指向 DSH 安装根目录（含 package.json 的那层）')
    process.exit(2)
  }

  let dshVersion = 'unknown'
  try {
    dshVersion = JSON.parse(readFileSync(join(dshRoot, 'package.json'), 'utf8')).version
  } catch {
    /* 版本拿不到不致命，但要留痕 */
  }

  const packages = readdirSync(scopeDir).filter((name) => name.startsWith('dsh-'))
  const endpoints = {}
  const loaded = []
  const skipped = []
  const failed = []

  for (const pkg of packages) {
    const descriptorFile = join(scopeDir, pkg, 'lib', 'typert.remote-client.js')
    if (!existsSync(descriptorFile)) {
      skipped.push(pkg)
      continue
    }

    let spec
    try {
      const mod = await import(pathToFileURL(descriptorFile).href)
      spec = mod.default?.spec
    } catch (error) {
      failed.push({ pkg, reason: error.message })
      continue
    }

    const methods = spec?.methods
    if (!methods || typeof methods !== 'object') {
      skipped.push(pkg)
      continue
    }

    let added = 0
    for (const [endpoint, entry] of Object.entries(methods)) {
      const parameters = Array.isArray(entry.parameters) ? entry.parameters : []
      const params = {}
      for (const param of parameters) {
        params[param.name] = {
          required: param.required !== false,
          schema: stripDescriptions(param.codec?.jsonSchema ?? null),
        }
      }

      // 同名 endpoint 理论上不会跨包重复；真重复了保留先出现的并记下来
      if (endpoints[endpoint]) {
        failed.push({ pkg, reason: `endpoint 重复声明：${endpoint}` })
        continue
      }

      endpoints[endpoint] = {
        package: `@deepseek-ai/${pkg}`,
        description: entry.description ?? null,
        params,
        result: stripDescriptions(entry.result?.jsonSchema ?? null),
      }
      added += 1
    }
    if (added > 0) loaded.push({ pkg, methods: added })
  }

  const payload = {
    $comment:
      'DSH remote descriptor 快照。由 packages/testkit/scripts/extract-descriptors.mjs 生成，勿手改。',
    dshVersion,
    generatedAt: new Date().toISOString(),
    endpointCount: Object.keys(endpoints).length,
    endpoints,
  }

  const json = args.pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload)
  mkdirSync(dirname(args.out), { recursive: true })
  writeFileSync(args.out, json, 'utf8')

  console.log('===== descriptor 提取结果 =====')
  console.log(`DSH 版本:   ${dshVersion}`)
  console.log(`扫描包:     ${packages.length}`)
  console.log(`带 descriptor 的包: ${loaded.length}`)
  console.log(`endpoint 数: ${Object.keys(endpoints).length}`)
  console.log(`输出:       ${args.out}`)
  console.log(`体积:       ${(json.length / 1024).toFixed(1)} KB`)
  if (failed.length) {
    console.log(`\n失败 ${failed.length} 项：`)
    for (const item of failed.slice(0, 10)) console.log(`  - ${item.pkg}: ${item.reason}`)
  }

  // 把参数名不统一的事实直接打出来，提醒后续别再靠猜
  const withParams = Object.entries(endpoints).filter(([, e]) => Object.keys(e.params).length > 0)
  const unusual = withParams.filter(([, e]) => {
    const names = Object.keys(e.params)
    return !['request', 'args'].includes(names[0]) || names[0].startsWith('_')
  })
  console.log(`\n参数名不是 \`request\`/\`args\` 的方法: ${unusual.length} 个`)
  for (const [endpoint, e] of unusual.slice(0, 12)) {
    console.log(`  ${endpoint} → ${Object.keys(e.params).join(', ')}`)
  }

  // 按命名空间汇总，便于核对 CommandMap 覆盖度
  const byNs = {}
  for (const endpoint of Object.keys(endpoints)) {
    const ns = endpoint.split('/')[0]
    byNs[ns] = (byNs[ns] ?? 0) + 1
  }
  console.log('\n命名空间分布:')
  for (const [ns, count] of Object.entries(byNs).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${ns}: ${count}`)
  }
}

main().catch((error) => {
  console.error('提取失败:', error)
  process.exit(1)
})
