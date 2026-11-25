#!/usr/bin/env node
/**
 * P0 基准：在引入任何 Rust/native 模块之前，先量出当前 JS 实现的热点。
 *
 * 覆盖三条会被原生实现替换的链路：
 *   1. session.read  —— zstd 解压 + JSONL 解析（host-services，主进程同步阻塞）
 *   2. dir.walk      —— 逐层 readdir + stat（资源管理器）
 *   3. git.status    —— git status --porcelain 子进程
 *
 * 用法：
 *   node packages/testkit/scripts/bench-session.mjs
 *   node packages/testkit/scripts/bench-session.mjs --json
 *   node packages/testkit/scripts/bench-session.mjs --iterations 20 --session <id>
 *   $env:DSH_WORKSPACE='/mnt/f/projects/dsh-studio'  # 覆盖工作区
 *
 * 判定线：P95 > 50ms 记为 SLOW，是 P1 值得做原生模块的信号。
 */
import { existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  gitChanges,
  listDirectory,
  listSessions,
  readSessionEvents,
  sessionsRoot,
} from '../../host-services/src/index.js'

const SKIP_DIRS = new Set(['node_modules', '.git', '.screenshots', 'dist', 'out', '.cache'])
const SLOW_MS = 50

function argValue(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  return value === undefined || value.startsWith('--') ? fallback : value
}

const jsonOnly = process.argv.includes('--json')
const sessionOverride = argValue('session', undefined)
const iterations = Number(argValue('iterations', '10')) || 10
const maxWalkFiles = Number(argValue('max-files', '5000')) || 5000

const repoRootWindows = resolve(import.meta.dirname, '../../..')
const workspacePosix = process.env.DSH_WORKSPACE ?? toPosix(repoRootWindows)

function toPosix(windowsPath) {
  const drive = /^([A-Za-z]):\\(.*)$/.exec(windowsPath)
  if (drive) return `/mnt/${drive[1].toLowerCase()}/${drive[2].replaceAll('\\', '/')}`
  return windowsPath.replaceAll('\\', '/')
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

function round(ms) {
  return Number(ms.toFixed(2))
}

async function measure(label, fn, runs = iterations) {
  // 预热一次，避免把首次 JIT / 冷缓存算进分位数。
  await fn()
  const samples = []
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now()
    await fn()
    samples.push(performance.now() - started)
  }
  samples.sort((left, right) => left - right)
  return {
    label,
    runs,
    min: round(samples[0] ?? 0),
    p50: round(percentile(samples, 50)),
    p95: round(percentile(samples, 95)),
    max: round(samples.at(-1) ?? 0),
  }
}

/** 找到日志体积最大的会话，作为最坏情况样本。 */
async function largestSession() {
  if (sessionOverride !== undefined) {
    const sessions = await listSessions()
    const match = sessions.find((session) => session.id === sessionOverride)
    return match ?? { id: sessionOverride, workspace: null, title: null }
  }
  const root = sessionsRoot()
  if (!existsSync(root)) return null
  let best = null
  for (const bucket of await readdir(root, { withFileTypes: true })) {
    if (!bucket.isDirectory()) continue
    const bucketPath = join(root, bucket.name)
    for (const entry of await readdir(bucketPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const logPath = join(bucketPath, entry.name, 'session.v4.jsonl.zstd')
      if (!existsSync(logPath)) continue
      const bytes = (await stat(logPath)).size
      if (best === null || bytes > best.bytes) {
        best = { id: entry.name, workspace: bucket.name, bytes }
      }
    }
  }
  return best
}

/** 逐层列出目录，统计整棵树的节点数（面板懒加载的放大版基线）。 */
async function walkTree(rootPosix, options = {}) {
  const maxFiles = options.maxFiles ?? maxWalkFiles
  const queue = ['']
  let dirs = 0
  let files = 0
  while (queue.length > 0) {
    const relative = queue.shift()
    let rows
    try {
      rows = await listDirectory(rootPosix, relative, 300)
    } catch {
      continue
    }
    for (const row of rows) {
      if (row.type === 'dir') {
        if (SKIP_DIRS.has(row.name)) continue
        dirs += 1
        queue.push(row.path)
        continue
      }
      files += 1
      if (files >= maxFiles) return { dirs, files, truncated: true }
    }
  }
  return { dirs, files, truncated: false }
}

function table(rows) {
  const header = ['项目', '样本', 'min(ms)', 'P50(ms)', 'P95(ms)', 'max(ms)', '判定']
  const body = rows.map((row) => [
    row.label,
    String(row.runs),
    row.min.toFixed(2),
    row.p50.toFixed(2),
    row.p95.toFixed(2),
    row.max.toFixed(2),
    row.p95 > SLOW_MS ? 'SLOW' : 'ok',
  ])
  const widths = header.map((cell, index) => Math.max(cell.length, ...body.map((line) => line[index].length)))
  const render = (line) => line.map((cell, index) => cell.padEnd(widths[index])).join('  ')
  return [render(header), widths.map((width) => '-'.repeat(width)).join('  '), ...body.map(render)].join('\n')
}

async function main() {
  const session = await largestSession()
  const results = []

  let sessionMeta = { id: null, bytes: 0, events: 0 }
  if (session !== null) {
    const events = await readSessionEvents(session.id)
    sessionMeta = { id: session.id, bytes: session.bytes ?? 0, events: events.length }
    results.push(await measure('session.read', async () => {
      await readSessionEvents(session.id)
    }, Math.min(iterations, 20)))
  }

  let treeMeta = { dirs: 0, files: 0, truncated: false }
  if (existsSync(toWindowsFromPosix(workspacePosix))) {
    // 面板真实路径：只列一层；递归遍历作为「大范围扫描」的对照。
    results.push(await measure('dir.list(root)', async () => {
      await listDirectory(workspacePosix, '', 300)
    }))
    results.push(await measure('dir.list(packages)', async () => {
      await listDirectory(workspacePosix, 'packages', 300)
    }))

    treeMeta = await walkTree(workspacePosix)
    results.push(await measure('dir.walk', async () => {
      await walkTree(workspacePosix)
    }, Math.max(3, Math.min(iterations, 5))))

    results.push(await measure('git.status', async () => {
      await gitChanges(workspacePosix)
    }))
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    workspace: workspacePosix,
    slowThresholdMs: SLOW_MS,
    session: sessionMeta,
    tree: treeMeta,
    results,
  }

  if (jsonOnly) {
    console.log(JSON.stringify(payload, null, 2))
    return
  }

  console.log(`DSH Studio · Rust 前置基准  ${payload.generatedAt}`)
  console.log(`workspace: ${workspacePosix}`)
  if (sessionMeta.id !== null) {
    console.log(`session:   ${sessionMeta.id} · ${(sessionMeta.bytes / 1024).toFixed(1)} KB · ${sessionMeta.events} events`)
  } else {
    console.log('session:   没有找到持久化会话，跳过 session.read')
  }
  console.log(`tree:      ${treeMeta.dirs} dirs / ${treeMeta.files} files${treeMeta.truncated ? ' (截断)' : ''}`)
  console.log('')
  console.log(table(results))
  const slow = results.filter((row) => row.p95 > SLOW_MS)
  console.log('')
  console.log(slow.length === 0
    ? `结论：所有链路 P95 ≤ ${SLOW_MS}ms，暂不需要原生模块。`
    : `结论：${slow.map((row) => row.label).join('、')} 超过 ${SLOW_MS}ms，进入 P1 评估。`)
}

function toWindowsFromPosix(posixPath) {
  const drive = /^\/mnt\/([a-z])\/(.*)$/i.exec(posixPath)
  if (drive) return `${drive[1].toUpperCase()}:\\${drive[2].replaceAll('/', '\\')}`
  return posixPath
}

await main()
