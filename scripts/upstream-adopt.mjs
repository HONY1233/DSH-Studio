/**
 * 按文件采纳上游改动。
 *
 * 约束（与 sync-config.json 一致）：
 *   1. 只采纳显式列出的文件，不做整目录覆盖。
 *   2. 已登记在 dsh-overlay.json 的文件默认拒绝覆盖，必须 --force 且说明原因。
 *   3. 采纳后写回清单，保留可追溯性。
 *
 * 用法：
 *   node scripts/upstream-adopt.mjs --files src/styles/motion.css --reason "同步上游动效修复" --dry-run
 *   node scripts/upstream-adopt.mjs --files a.ts,b.tsx --reason "..."
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
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
const reason = arg('reason', '')
const files = arg('files', '').split(',').map((row) => row.trim()).filter(Boolean)
const dryRun = hasFlag('dry-run')
const force = hasFlag('force')

if (files.length === 0) {
  console.error('[adopt] 必须用 --files 指定要采纳的文件（相对渲染层根目录）')
  process.exit(2)
}
if (!reason) {
  console.error('[adopt] 必须用 --reason 说明为什么采纳')
  process.exit(2)
}
if (!existsSync(upstreamDir)) {
  console.error('[adopt] 没有上游快照，先运行 scripts/upstream-fetch.ps1')
  process.exit(2)
}

function detectRendererRoot(dir) {
  for (const candidate of [join(dir, 'apps', 'renderer-omp'), join(dir, 'apps', 'renderer'), dir]) {
    if (existsSync(join(candidate, 'src', 'main.tsx'))) return candidate
  }
  return null
}

const upstreamRoot = detectRendererRoot(upstreamDir)
if (!upstreamRoot) {
  console.error('[adopt] 上游快照里找不到 src/main.tsx')
  process.exit(2)
}

let manifest = { files: [] }
if (existsSync(manifestPath)) manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.files = Array.isArray(manifest.files) ? manifest.files : []

const byPath = new Map(manifest.files.map((row) => [row.path, row]))
const adoptedAt = new Date().toISOString()
const results = []

for (const rel of files) {
  const normalized = rel.replaceAll('\\', '/').replace(/^\.?\//, '')
  const source = join(upstreamRoot, normalized)
  const target = join(localDir, normalized)
  const repoRelative = relative(ROOT, target).replaceAll('\\', '/')

  if (!existsSync(source) || statSync(source).isDirectory()) {
    results.push({ file: normalized, status: 'missing-upstream' })
    continue
  }
  const existing = byPath.get(repoRelative)
  if (existing && !force) {
    results.push({ file: normalized, status: 'registered-skip', id: existing.id })
    continue
  }

  const bytes = statSync(source).size
  if (dryRun) {
    results.push({ file: normalized, status: 'dry-run', bytes })
    continue
  }

  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(source, target)
  const entry = {
    id: existing?.id ?? `A${String(manifest.files.length + 1).padStart(3, '0')}`,
    path: repoRelative,
    upstreamPath: normalized,
    kind: 'adopt',
    reason,
    adoptedAt,
  }
  if (existing) Object.assign(existing, entry)
  else manifest.files.push(entry)
  byPath.set(repoRelative, entry)
  results.push({ file: normalized, status: 'adopted', bytes })
}

if (!dryRun) writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

const label = (status) => ({
  'missing-upstream': '上游没有该文件',
  'registered-skip': '已在清单，需 --force 才覆盖',
  'dry-run': '预演，未写入',
  adopted: '已采纳',
})[status] ?? status

for (const row of results) console.log(`[adopt] ${row.status === 'adopted' ? '✓' : '·'} ${row.file} · ${label(row.status)}${row.bytes ? ` · ${row.bytes} B` : ''}`)
const failed = results.filter((row) => row.status === 'missing-upstream').length
console.log(`\n[adopt] 共 ${results.length} 个：采纳 ${results.filter((r) => r.status === 'adopted').length}，跳过 ${results.length - results.filter((r) => r.status === 'adopted').length}`)
if (failed > 0) console.error(`[adopt] ${failed} 个文件在上游不存在，请检查路径`)
process.exit(failed > 0 ? 1 : 0)
