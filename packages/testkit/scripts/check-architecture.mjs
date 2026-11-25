#!/usr/bin/env node
/**
 * 架构约束检查（不依赖任何第三方包）。
 *
 * 规则沿用 omp-studio：
 * - `electron` 只能出现在 apps/desktop；
 * - `react` / `react-dom` 只能出现在 apps/renderer；
 * - 渲染层与 contract 不允许碰 Node 内建模块；
 * - 渲染层只能经 preload（window.dsh）访问主进程能力，不直接 import runtime-client / host-services。
 *
 * 用法：node packages/testkit/scripts/check-architecture.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(import.meta.dirname, '../../..')

export const RULES = [
  {
    name: 'apps/renderer',
    dirs: ['apps/renderer/src'],
    builtins: true,
    forbid: [
      ['electron', '渲染层不能直接用 electron，走 preload 暴露的 window.dsh'],
      ['@dsh-studio/runtime-client', '渲染层不能直连运行时，走 window.dsh'],
      ['@dsh-studio/host-services', '渲染层不能直接读文件/Git，走 window.dsh'],
    ],
  },
  {
    name: 'packages/contract',
    dirs: ['packages/contract/src'],
    builtins: true,
    forbid: [
      ['electron', 'contract 必须是纯读模型'],
      ['react', 'contract 不能依赖渲染框架'],
    ],
  },
  {
    name: 'packages/runtime-client',
    dirs: ['packages/runtime-client/src'],
    builtins: false,
    forbid: [
      ['electron', 'runtime-client 只在主进程使用，不需要 electron'],
      ['react', 'runtime-client 不能依赖渲染框架'],
    ],
  },
  {
    name: 'packages/host-services',
    dirs: ['packages/host-services/src'],
    builtins: false,
    forbid: [
      ['electron', 'host-services 由主进程调用，不直接依赖 electron'],
      ['react', 'host-services 不能依赖渲染框架'],
    ],
  },
  {
    name: 'packages/studio-ui',
    dirs: ['packages/studio-ui/src'],
    builtins: true,
    forbid: [
      ['electron', 'studio-ui 是宿主渲染插件，只能经注入端口访问主进程'],
      ['@dsh-studio/runtime-client', 'studio-ui 不能直连运行时，必须经 SessionPort'],
      ['@dsh-studio/host-services', 'studio-ui 不能直接读文件/Git，必须经面板端口'],
    ],
  },
  {
    name: 'packages/workbench-core',
    dirs: ['packages/workbench-core/src'],
    builtins: true,
    forbid: [
      ['electron', 'workbench-core 是纯状态核心，不能依赖 Electron'],
      ['react', 'workbench-core 不能依赖 React'],
      ['react-dom', 'workbench-core 不能依赖 React DOM'],
      ['@dsh-studio/runtime-client', 'workbench-core 不能直连运行时，控制执行器必须由宿主注入'],
      ['@dsh-studio/host-services', 'workbench-core 不能直接读文件/Git，IO 必须由宿主注入'],
    ],
  },
  {
    name: 'apps/desktop',
    dirs: ['apps/desktop/src'],
    builtins: false,
    forbid: [
      ['react', '主进程不能渲染 React'],
      ['react-dom', '主进程不能渲染 React'],
    ],
  },
  {
    name: 'apps/renderer-omp',
    dirs: ['apps/renderer-omp/src'],
    builtins: false,
    forbid: [
      ['electron', '移植的渲染层同样只能走 preload 暴露的 window.dshStudio'],
      ['@dsh-studio/runtime-client', '渲染层不能直连运行时，走 window.dshStudio'],
      ['@dsh-studio/host-services', '渲染层不能直接读文件/Git，走 window.dshStudio'],
    ],
  },
]

const NODE_BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'cluster', 'console', 'crypto', 'dgram',
  'dns', 'events', 'fs', 'http', 'http2', 'https', 'module', 'net', 'os', 'path',
  'perf_hooks', 'process', 'punycode', 'querystring', 'readline', 'repl',
  'stream', 'string_decoder', 'timers', 'tls', 'tty', 'url', 'util', 'v8', 'vm',
  'worker_threads', 'zlib',
])

const SPECIFIER_RE = /(?:from\s*|import\s*|require\(\s*)['"]([^'"]+)['"]/g

function listFiles(dir) {
  const absolute = join(ROOT, dir)
  let out = []
  let entries
  try {
    entries = readdirSync(absolute)
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(absolute, entry)
    const info = statSync(full)
    if (info.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue
      out = out.concat(listFiles(join(dir, entry)))
    } else if (/\.(jsx?|cjs|mjs|ts|tsx)$/.test(entry)) {
      out.push(join(dir, entry))
    }
  }
  return out
}

function matches(specifier, name) {
  return specifier === name || specifier.startsWith(`${name}/`)
}

function isBuiltin(specifier) {
  if (specifier.startsWith('node:')) return true
  return NODE_BUILTINS.has(specifier.split('/')[0])
}

export function violationsInText(file, text, rules = RULES) {
  const violations = []
  for (const rule of rules) {
    for (const match of text.matchAll(SPECIFIER_RE)) {
      const specifier = match[1]
      const line = text.slice(0, match.index).split('\n').length
      if (rule.builtins && isBuiltin(specifier)) {
        violations.push({ file, line, reason: `不能 import Node 内建模块 "${specifier}"` })
        continue
      }
      for (const [name, reason] of rule.forbid) {
        if (matches(specifier, name)) violations.push({ file, line, reason })
      }
    }
  }
  return violations
}

function main() {
  const violations = []
  let scanned = 0

  for (const rule of RULES) {
    for (const file of listFiles(rule.dirs[0]).map((path) => path.replace(/\\/g, '/'))) {
      scanned += 1
      const text = readFileSync(join(ROOT, file), 'utf8')
      violations.push(...violationsInText(file, text, [rule]))
    }
  }

  if (violations.length > 0) {
    console.error(`[arch] FAIL · ${violations.length} 处越界（扫描 ${scanned} 个文件）`)
    for (const item of violations) {
      console.error(`  ${item.file}:${item.line}  ${item.reason}`)
    }
    process.exit(1)
  }

  console.log(`[arch] PASS · 扫描 ${scanned} 个文件，${RULES.length} 组规则`)
  for (const rule of RULES) {
    console.log(`  ${rule.name}: ${rule.forbid.map(([name]) => `禁 ${name}`).join('、')}`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
