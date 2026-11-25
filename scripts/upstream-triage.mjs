/**
 * 上游差异分类（只读）。
 *
 * 对比 `upstream/omp-studio` 与本地 fork，把文件分成五类：
 *   identical           两边一致
 *   local-modified      两边不同，且已在 dsh-overlay.json 登记
 *   unregistered-delta  两边不同，但清单里没有（要么补登记，要么采纳上游）
 *   ours-only           只有本地有（DSH 新增）
 *   upstream-only       只有上游有（尚未采纳）
 *
 * 用法：
 *   node scripts/upstream-triage.mjs
 *   node scripts/upstream-triage.mjs --json
 *   node scripts/upstream-triage.mjs --strict   # 存在未登记差异时退出 1
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const hasFlag = (name) => process.argv.includes(`--${name}`)
const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`)
  if (at < 0) return fallback
  const value = process.argv[at + 1]
  return value && !value.startsWith('--') ? value : fallback
}

const upstreamDir = resolve(ROOT, arg('upstream', 'upstream/omp-studio'))
const localDir = resolve(ROOT, arg('local', 'apps/renderer-omp'))
const manifestPath = resolve(ROOT, arg('manifest', 'dsh-overlay.json'))

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'coverage', '.screenshots'])
const SOURCE_RE = /\.(ts|tsx|css|json|md)$/i

function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const path = join(dir, name)
    let info
    try {
      info = statSync(path)
    } catch {
      continue
    }
    if (info.isDirectory()) walk(path, base, out)
    else if (SOURCE_RE.test(name)) out.push(relative(base, path).replaceAll('\\', '/'))
  }
  return out
}

function sha1(path) {
  return createHash('sha1').update(readFileSync(path)).digest('hex')
}

/** 上游仓库结构未知：优先 apps/renderer-omp，其次 apps/renderer，再退回自身。 */
function detectRendererRoot(dir) {
  for (const candidate of [join(dir, 'apps', 'renderer-omp'), join(dir, 'apps', 'renderer'), dir]) {
    if (existsSync(join(candidate, 'src', 'main.tsx'))) return candidate
  }
  const stack = [{ dir, depth: 0 }]
  while (stack.length > 0) {
    const { dir: current, depth } = stack.pop()
    if (existsSync(join(current, 'src', 'main.tsx'))) return current
    if (depth >= 3) continue
    for (const name of readdirSync(current)) {
      if (SKIP_DIRS.has(name)) continue
      const child = join(current, name)
      try {
        if (statSync(child).isDirectory()) stack.push({ dir: child, depth: depth + 1 })
      } catch {
        /* 跳过不可读目录 */
      }
    }
  }
  return null
}

if (!existsSync(upstreamDir)) {
  console.log(`[triage] 没有上游快照：${relative(ROOT, upstreamDir) || upstreamDir}`)
  console.log('[triage] 先运行 scripts/upstream-fetch.ps1（支持 -Tarball 离线包或 -RepoUrl 镜像）')
  process.exit(0)
}

const upstreamRoot = detectRendererRoot(upstreamDir)
if (!upstreamRoot) {
  console.log(`[triage] 上游快照还没有内容：${relative(ROOT, upstreamDir) || upstreamDir} 只有占位文件`)
  console.log('[triage] 先运行 scripts/upstream-fetch.ps1（支持 -Tarball 离线包或 -RepoUrl 镜像）')
  process.exit(0)
}

let upstreamMeta = { version: 'unknown', commit: null }
const metaPath = join(upstreamDir, 'UPSTREAM.json')
if (existsSync(metaPath)) {
  try {
    upstreamMeta = { ...upstreamMeta, ...JSON.parse(readFileSync(metaPath, 'utf8')) }
  } catch {
    /* 元数据坏了不影响比对 */
  }
}

let manifest = { files: [] }
if (existsSync(manifestPath)) {
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    console.error(`[triage] 无法解析清单：${relative(ROOT, manifestPath)}`)
    process.exit(1)
  }
}
const registered = new Set((manifest.files ?? []).map((row) => row.path))

const upstreamFiles = walk(upstreamRoot)
const localFiles = walk(localDir)
const upstreamSet = new Set(upstreamFiles)
const localSet = new Set(localFiles)

const report = {
  upstream: { version: upstreamMeta.version, commit: upstreamMeta.commit, root: relative(ROOT, upstreamRoot) },
  local: { root: relative(ROOT, localDir) },
  counts: { upstream: upstreamFiles.length, local: localFiles.length },
  identical: [],
  localModified: [],
  unregisteredDelta: [],
  oursOnly: [],
  upstreamOnly: [],
}

for (const file of localFiles) {
  if (!upstreamSet.has(file)) {
    report.oursOnly.push(file)
    continue
  }
  let same = false
  try {
    same = sha1(join(upstreamRoot, file)) === sha1(join(localDir, file))
  } catch {
    same = false
  }
  if (same) {
    report.identical.push(file)
    continue
  }
  const localPath = join(localDir, file).replaceAll('\\', '/')
  const relativeLocal = relative(ROOT, localPath).replaceAll('\\', '/')
  if (registered.has(relativeLocal)) report.localModified.push(file)
  else report.unregisteredDelta.push(file)
}
for (const file of upstreamFiles) {
  if (!localSet.has(file)) report.upstreamOnly.push(file)
}

const printList = (label, rows) => {
  console.log(`\n${label} (${rows.length})`)
  for (const row of rows.slice(0, 20)) console.log(`  ${row}`)
  if (rows.length > 20) console.log(`  … 其余 ${rows.length - 20} 个见 --json`)
}

if (hasFlag('json')) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`[triage] 上游 ${report.upstream.version} @ ${report.upstream.commit ?? 'commit 未记录'}`)
  console.log(`[triage] 上游根 ${report.upstream.root} · 本地根 ${report.local.root}`)
  console.log(`[triage] 文件数：上游 ${report.counts.upstream} / 本地 ${report.counts.local}`)
  console.log(`[triage] identical ${report.identical.length} · local-modified ${report.localModified.length} · unregistered-delta ${report.unregisteredDelta.length} · ours-only ${report.oursOnly.length} · upstream-only ${report.upstreamOnly.length}`)
  printList('local-modified（已登记，采纳前需人工确认）', report.localModified)
  printList('unregistered-delta（需补登记或评估采纳）', report.unregisteredDelta)
  printList('upstream-only（可评估采纳）', report.upstreamOnly)
  if (!report.upstream.commit) console.log('\n[triage] 提示：UPSTREAM.json 还没有记录 commit，建议补上以便复现比对。')
}

if (hasFlag('strict') && report.unregisteredDelta.length > 0) {
  console.error(`\n[triage] FAIL · ${report.unregisteredDelta.length} 个文件两边不同但未登记`)
  process.exit(1)
}
