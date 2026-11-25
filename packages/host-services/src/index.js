/**
 * Host-side access to the DSH runtime's on-disk state.
 *
 * The runtime lives in WSL, so everything here goes through the `\\wsl.localhost`
 * share. Kept free of Electron so the testkit can read sessions directly.
 */
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const GIT = process.env.GIT_BIN ?? 'git'

const WSL_HOME = process.env.DSH_WSL_HOME ?? '\\\\wsl.localhost\\Ubuntu\\home\\qtt199'
const WSL_HOME_POSIX = process.env.DSH_WSL_HOME_POSIX ?? '/home/qtt199'

/** Translate a runtime-side POSIX path into a Windows path (`/mnt/c` or the WSL home share). */
export function uncFromWsl(posixPath) {
  const drive = /^\/mnt\/([a-z])\/(.*)$/i.exec(posixPath)
  if (drive) return `${drive[1].toUpperCase()}:\\${drive[2].replaceAll('/', '\\')}`
  if (!posixPath.startsWith(WSL_HOME_POSIX)) throw new Error(`path outside known roots: ${posixPath}`)
  const rest = posixPath.slice(WSL_HOME_POSIX.length).replaceAll('/', '\\')
  return rest ? `${WSL_HOME}${rest}` : WSL_HOME
}

/** Reject traversal so the panel can never escape the workspace root. */
function safeJoin(rootPosix, relativePath = '') {
  const relative = relativePath.replaceAll('\\', '/').replace(/^\/+/, '')
  if (relative.split('/').some((segment) => segment === '..')) throw new Error(`invalid path: ${relativePath}`)
  return relative ? `${rootPosix.replace(/\/$/, '')}/${relative}` : rootPosix
}

export function sessionsRoot() {
  return join(WSL_HOME, '.dsh', 'sessions')
}

function projectionCachePath(sessionId) {
  return join(WSL_HOME, '.dsh', 'storages', 'session_projcache', 'sessions', `${sessionId}.json`)
}

/**
 * One directory level of the workspace, directories first.
 * `rootPosix` is the runtime working directory (WSL path).
 */
export async function listDirectory(rootPosix, relativePath = '', limit = 300) {
  const target = uncFromWsl(safeJoin(rootPosix, relativePath))
  const entries = await readdir(target, { withFileTypes: true })
  const rows = []
  for (const entry of entries) {
    if (rows.length >= limit) break
    const childRelative = relativePath ? `${relativePath.replace(/\/$/, '')}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      rows.push({ name: entry.name, path: childRelative, type: 'dir' })
      continue
    }
    let size = 0
    try {
      size = (await stat(join(target, entry.name))).size
    } catch {
      size = 0
    }
    rows.push({ name: entry.name, path: childRelative, type: 'file', size })
  }
  return rows.sort((left, right) => {
    if (left.type !== right.type) return left.type === 'dir' ? -1 : 1
    return left.name.localeCompare(right.name)
  })
}

/** Read a text file for preview; binary and oversized files are reported, not dumped. */
export async function readTextFile(rootPosix, relativePath, maxBytes = 512 * 1024) {
  const target = uncFromWsl(safeJoin(rootPosix, relativePath))
  const info = await stat(target)
  if (info.size > maxBytes) return { path: relativePath, size: info.size, mtimeMs: info.mtimeMs, tooLarge: true, text: '' }
  const buffer = await readFile(target)
  if (buffer.subarray(0, 8192).includes(0)) return { path: relativePath, size: info.size, mtimeMs: info.mtimeMs, binary: true, text: '' }
  return { path: relativePath, size: info.size, mtimeMs: info.mtimeMs, text: buffer.toString('utf8') }
}

/**
 * Working-tree status for the workspace, parsed from `git status -z`.
 * Rename entries expose `from` alongside the new `path`.
 */
export async function gitChanges(rootPosix) {
  const cwd = uncFromWsl(rootPosix)
  const { stdout } = await execFileAsync(GIT, ['status', '--porcelain=v1', '-z'], {
    cwd,
    maxBuffer: 8 * 1024 * 1024,
  })
  const tokens = stdout.split('\0')
  const rows = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token) continue
    const indexCode = token[0]
    const worktreeCode = token[1]
    const path = token.slice(3)
    if (indexCode === 'R' || indexCode === 'C') {
      const from = tokens[index + 1] ?? null
      index += 1
      rows.push({ path, from, index: indexCode, worktree: worktreeCode })
      continue
    }
    rows.push({ path, index: indexCode, worktree: worktreeCode })
  }
  return rows
}

/** Unified diff for one path; `staged` compares the index instead of the worktree. */
export async function gitDiff(rootPosix, path, staged = false) {
  const cwd = uncFromWsl(rootPosix)
  const args = ['diff', '--no-color']
  if (staged) args.push('--cached')
  args.push('--', path)
  const { stdout } = await execFileAsync(GIT, args, { cwd, maxBuffer: 8 * 1024 * 1024 })
  return stdout
}

/**
 * Enumerate persisted sessions, newest first. Metadata comes from the runtime's
 * projection cache (title, cwd, creation time); the log itself stays untouched.
 */
export async function listSessions() {
  const root = sessionsRoot()
  if (!existsSync(root)) return []
  const sessions = []
  for (const bucket of await readdir(root, { withFileTypes: true })) {
    if (!bucket.isDirectory()) continue
    const bucketPath = join(root, bucket.name)
    for (const entry of await readdir(bucketPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const meta = await readProjectionCache(entry.name)
      sessions.push({ id: entry.name, workspace: bucket.name, ...meta })
    }
  }
  return sessions.sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
}

/**
 * 永久删除一个持久化会话：会话目录 + 投影缓存。
 * DSH SDK 没有会话删除接口，历史页的删除只能落到磁盘；
 * 运行中的会话可能仍被进程持有，但磁盘记录已移除。
 */
export async function deleteSession(sessionId) {
  const id = String(sessionId ?? '')
  if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error('非法的会话 ID')
  const root = sessionsRoot()
  let removed = 0
  if (existsSync(root)) {
    for (const bucket of await readdir(root, { withFileTypes: true })) {
      if (!bucket.isDirectory()) continue
      const target = join(root, bucket.name, id)
      if (existsSync(target)) {
        await rm(target, { recursive: true, force: true })
        removed += 1
      }
    }
  }
  const cache = projectionCachePath(id)
  if (existsSync(cache)) {
    await rm(cache, { force: true })
    removed += 1
  }
  return { removed }
}

async function readProjectionCache(sessionId) {
  try {
    const cache = JSON.parse(await readFile(projectionCachePath(sessionId), 'utf8'))
    const identity = cache?.record?.identity ?? {}
    const title = cache?.record?.rows?.title?.val
    return {
      cwd: identity.cwd ?? null,
      createdAt: identity.createdAt ?? null,
      title: typeof title === 'string' ? title : (title?.title ?? null),
    }
  } catch {
    return {}
  }
}

/**
 * Read the durable session log and return its raw events, oldest first.
 * The file is zstd-compressed JSONL, one event envelope per line.
 */
// ---- skills ---------------------------------------------------------------

/** 技能名规则，与 `@deepseek-ai/dsh-skill` 的 SKILL_NAME 一致。 */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * DSH 文件系统技能根目录，按加载优先级从高到低排列。
 * 对齐 `@deepseek-ai/dsh-skill-filesystem` 的默认根目录与 rank。
 */
export function skillRoots(projectRoot, extras = {}) {
  const roots = []
  const project = typeof projectRoot === 'string' ? projectRoot.replace(/\/+$/, '') : ''
  if (project) {
    roots.push({ path: `${project}/.dsh/skills`, source: 'project-dsh', scope: 'workspace', label: '项目 · .dsh', rank: 100 })
    roots.push({ path: `${project}/.agents/skills`, source: 'project-agents', scope: 'workspace', label: '项目 · .agents', rank: 200 })
  }
  // profile 里声明的自定义目录（rank 300），与 DSH 的 dsh-skill-filesystem 一致。
  for (const [index, dir] of (extras.customSkillDirs ?? []).entries()) {
    roots.push({ path: String(dir).replace(/\/+$/, ''), source: 'custom', scope: 'global', label: `自定义 · ${index + 1}`, rank: 300 })
  }
  roots.push({ path: `${WSL_HOME_POSIX}/.dsh/skills`, source: 'user-dsh', scope: 'global', label: '用户 · .dsh', rank: 400, skipSystem: true })
  roots.push({ path: `${WSL_HOME_POSIX}/.agents/skills`, source: 'user-agents', scope: 'global', label: '用户 · .agents', rank: 500 })
  if (extras.bundledSkillDir) {
    roots.push({ path: String(extras.bundledSkillDir).replace(/\/+$/, ''), source: 'bundled', scope: 'global', label: '内置技能', rank: 600 })
  }
  return roots
}

/**
 * 扫描技能目录并解析 frontmatter。同名技能按 rank 保留优先级最高的一份，
 * 被覆盖或解析失败的条目只进 warnings（不向渲染层暴露绝对路径）。
 */
export async function scanSkills(projectRoot, extras = {}) {
  const winners = new Map()
  const conflicted = new Set()
  const warnings = []
  for (const root of skillRoots(projectRoot, extras)) {
    const rows = await readSkillRoot(root, warnings)
    for (const row of rows) {
      const existing = winners.get(row.name)
      if (existing === undefined) {
        winners.set(row.name, row)
        continue
      }
      conflicted.add(row.name)
      const winner = existing.rank <= row.rank ? existing : row
      const loser = winner === existing ? row : existing
      winners.set(row.name, winner)
      warnings.push(`技能 ${row.name}：${loser.label} 的版本被 ${winner.label} 覆盖`)
    }
  }
  const skills = [...winners.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((row) => ({ ...row, conflict: conflicted.has(row.name) }))
  return { skills, warnings }
}

async function readSkillRoot(root, warnings) {
  let target
  try {
    target = uncFromWsl(root.path)
  } catch {
    return []
  }
  if (!existsSync(target)) return []
  let entries
  try {
    entries = await readdir(target, { withFileTypes: true })
  } catch (error) {
    warnings.push(`${root.label}：目录读取失败（${error.code ?? 'ERROR'}）`)
    return []
  }
  const rows = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (root.skipSystem && entry.name === '.system') continue
    const directory = entry.isDirectory()
    if (!directory && !(entry.isFile() && entry.name.endsWith('.md'))) continue
    const filePath = directory ? `${root.path}/${entry.name}/SKILL.md` : `${root.path}/${entry.name}`
    let text
    try {
      text = await readFile(uncFromWsl(filePath), 'utf8')
    } catch (error) {
      // 目录里没有 SKILL.md 是常见情况（例如普通子目录），不算警告。
      if (directory && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) continue
      warnings.push(`${root.label}/${entry.name}：读取失败（${error.code ?? 'ERROR'}）`)
      continue
    }
    const fields = parseSkillFrontmatter(text)
    const name = typeof fields.name === 'string' ? fields.name : ''
    const description = typeof fields.description === 'string' ? fields.description : ''
    if (!name || !description) {
      warnings.push(`${root.label}/${entry.name}：frontmatter 需要 name 与 description`)
      continue
    }
    if (!SKILL_NAME.test(name)) {
      warnings.push(`${root.label}/${entry.name}：技能名 “${name}” 不合规（需 kebab-case）`)
      continue
    }
    const whenToUse = typeof fields.whenToUse === 'string' ? fields.whenToUse : ''
    rows.push({
      name,
      description,
      ...(whenToUse ? { whenToUse } : {}),
      source: root.source,
      scope: root.scope,
      label: root.label,
      rank: root.rank,
      path: filePath,
      modelInvocable: frontmatterBoolean(fields['disable-model-invocation']) !== true,
      userInvocable: frontmatterBoolean(fields['user-invocable']) !== false,
    })
  }
  return rows
}

/** 只取 YAML frontmatter（两行 `---` 之间）并做最小键值解析。 */
function parseSkillFrontmatter(text) {
  const normalized = String(text).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) return {}
  const lines = normalized.slice(4).split('\n')
  const end = lines.findIndex((line) => line.trim() === '---')
  if (end < 0) return {}
  return parseSimpleYaml(lines.slice(0, end))
}

/** 支持 `key: value`、引号标量与 `>`/`|` 折叠块；技能 frontmatter 只需要这些。 */
function parseSimpleYaml(lines) {
  const fields = {}
  let key = null
  let block = []
  const flush = () => {
    if (key !== null && block.length > 0) fields[key] = block.join(' ').trim()
    key = null
    block = []
  }
  for (const raw of lines) {
    if (key !== null && /^[ \t]/.test(raw)) {
      block.push(raw.trim())
      continue
    }
    flush()
    const match = /^([A-Za-z][A-Za-z0-9_-]*):(?:[ \t]+(.*))?$/.exec(raw)
    if (!match) continue
    const [, name, value] = match
    if (value === undefined || value === '' || value === '>' || value === '|' || value === '>-' || value === '|-') {
      key = name
      continue
    }
    fields[name] = unquoteScalar(value)
  }
  flush()
  return fields
}

function unquoteScalar(value) {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n')
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'")
  }
  const comment = trimmed.search(/[ \t]#/)
  return (comment >= 0 ? trimmed.slice(0, comment) : trimmed).trim()
}

function frontmatterBoolean(value) {
  if (value === undefined) return undefined
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  const text = String(value).toLowerCase()
  if (text === 'true' || text === 'yes' || text === 'on') return true
  if (text === 'false' || text === 'no' || text === 'off') return false
  return undefined
}

// ---- 系统文件（本机路径，供文件浏览器与编辑器使用）----------------------

/** Windows 用户主目录；系统文件面板的默认起点。 */
const SYSTEM_HOME = process.env.DSH_SYSTEM_HOME ?? homedir()

/** 把渲染层给的路径换算成本机可访问的路径：WSL POSIX 走 UNC，其余原样。 */
export function toSystemPath(input) {
  const text = String(input ?? '').replace(/^file:\/\//i, '')
  if (!text) throw new Error('路径为空')
  if (/^[A-Za-z]:[\\/]/.test(text) || text.startsWith('\\\\')) return text
  if (text === '~') return SYSTEM_HOME
  if (text.startsWith('~/')) return join(SYSTEM_HOME, text.slice(2))
  if (text.startsWith('/')) return uncFromWsl(text)
  return resolve(SYSTEM_HOME, text)
}

/** 常见扩展名的 MIME；编辑器只关心文本/图片/二进制三类。 */
function mimeOf(filePath) {
  const ext = filePath.slice(filePath.lastIndexOf('.') + 1).toLowerCase()
  const table = {
    md: 'text/markdown', markdown: 'text/markdown', json: 'application/json',
    js: 'text/javascript', mjs: 'text/javascript', cjs: 'text/javascript',
    ts: 'text/plain', tsx: 'text/plain', jsx: 'text/plain',
    css: 'text/css', html: 'text/html', yml: 'text/yaml', yaml: 'text/yaml',
    txt: 'text/plain', log: 'text/plain', sh: 'text/x-shellscript',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon',
    pdf: 'application/pdf', zip: 'application/zip',
  }
  return table[ext] ?? 'application/octet-stream'
}

/** 版本号取 mtime+size，写入时用它做乐观并发校验。 */
function fileVersion(info) {
  return `${Math.round(info.mtimeMs)}:${info.size}`
}

/** 本机文件的读模型（SystemFileInfo），`displayPath` 保留渲染层传入的写法。 */
async function systemFileInfo(target, displayPath) {
  const info = await stat(target)
  return {
    path: displayPath,
    id: displayPath,
    name: basename(target) || displayPath,
    mime: mimeOf(target),
    size: info.size,
    version: fileVersion(info),
    writable: true,
  }
}

/** 常用位置与盘符；不存在的目录不返回，避免面板出现死链接。 */
export async function systemPlaces() {
  const quick = []
  for (const [kind, label, sub] of [
    ['home', '主目录', ''],
    ['desktop', '桌面', 'Desktop'],
    ['downloads', '下载', 'Downloads'],
    ['documents', '文档', 'Documents'],
    ['pictures', '图片', 'Pictures'],
  ]) {
    const path = sub ? join(SYSTEM_HOME, sub) : SYSTEM_HOME
    if (existsSync(path)) quick.push({ kind, label, path })
  }
  const volumes = []
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZAB') {
    const path = `${letter}:\\`
    try {
      const info = await statfs(path)
      volumes.push({
        path,
        label: `${letter}:`,
        ready: true,
        totalBytes: info.bsize * info.blocks,
        freeBytes: info.bsize * info.bavail,
      })
    } catch {
      // 未挂载的盘符直接跳过。
    }
  }
  return { platform: 'win32', separator: '\\', home: SYSTEM_HOME, quick, volumes, trash: true }
}

/** 面包屑：`C:\Users\x` 或 `\\wsl.localhost\Ubuntu\home\x`。 */
function segmentsOf(displayPath) {
  if (displayPath.startsWith('\\\\')) {
    const parts = displayPath.replace(/^\\\\/, '').split('\\').filter(Boolean)
    const segments = [{ path: `\\\\${parts[0] ?? ''}\\${parts[1] ?? ''}`, label: parts[1] ?? '' }]
    let current = segments[0].path
    for (const part of parts.slice(2)) {
      current = `${current}\\${part}`
      segments.push({ path: current, label: part })
    }
    return segments
  }
  const parts = displayPath.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean)
  if (parts.length === 0) return []
  const segments = [{ path: `${parts[0]}\\`, label: parts[0] }]
  let current = segments[0].path
  for (const part of parts.slice(1)) {
    current = current.endsWith('\\') ? `${current}${part}` : `${current}\\${part}`
    segments.push({ path: current, label: part })
  }
  return segments
}

function systemParent(displayPath) {
  if (/^[A-Za-z]:\\?$/.test(displayPath) || /^\\\\[^\\]+\\[^\\]+\\?$/.test(displayPath)) return null
  const parent = dirname(displayPath.replace(/[\\/]+$/, ''))
  return parent === displayPath ? null : parent
}

/**
 * 一层目录。`rootPosix` 是运行时工作区，命中时附带 workspace 身份，
 * 让文件浏览器把条目折算回工作区相对路径。
 */
export async function listSystem(displayPath, options = {}) {
  const target = toSystemPath(displayPath)
  const entries = []
  const dirents = await readdir(target, { withFileTypes: true })
  for (const entry of dirents) {
    if (!options.showHidden && entry.name.startsWith('.')) continue
    const childDisplay = displayPath.endsWith('\\') || displayPath.endsWith('/')
      ? `${displayPath}${entry.name}`
      : `${displayPath}${sep}${entry.name}`
    const row = {
      name: entry.name,
      path: childDisplay,
      type: entry.isDirectory() ? 'dir' : 'file',
      hidden: entry.name.startsWith('.'),
      ...(entry.isSymbolicLink() ? { link: true } : {}),
    }
    if (!entry.isDirectory()) {
      try {
        const info = await stat(`${target}${sep}${entry.name}`)
        row.size = info.size
        row.mtimeMs = Math.round(info.mtimeMs)
      } catch {
        row.denied = true
      }
    }
    entries.push(row)
  }
  entries.sort((left, right) => {
    if (left.type !== right.type) return left.type === 'dir' ? -1 : 1
    return left.name.localeCompare(right.name)
  })
  let workspace
  if (options.rootPosix && options.workspaceId) {
    try {
      const root = uncFromWsl(options.rootPosix)
      if (target.toLowerCase().startsWith(root.toLowerCase())) {
        const rest = target.slice(root.length).replace(/^[\\/]+/, '').split(sep).join('/')
        workspace = { workspaceId: options.workspaceId, relativePath: rest }
      }
    } catch {
      /* 工作区不在已知根目录，不附身份 */
    }
  }
  return {
    path: displayPath,
    parent: systemParent(displayPath),
    segments: segmentsOf(displayPath),
    entries,
    truncated: false,
    ...(workspace ? { workspace } : {}),
  }
}

/** 单文件元信息。 */
export async function inspectSystemFile(displayPath) {
  return systemFileInfo(toSystemPath(displayPath), displayPath)
}

/** 文本读取：二进制与超大文件明确报错，不返回半个文件。 */
export async function readSystemText(displayPath, maxBytes = 1024 * 1024) {
  const target = toSystemPath(displayPath)
  const info = await stat(target)
  if (info.size > maxBytes) throw new Error(`文件过大（${info.size} 字节），超过编辑器上限`)
  const buffer = await readFile(target)
  if (buffer.subarray(0, 8192).includes(0) && !(buffer[0] === 0xff && buffer[1] === 0xfe)) {
    throw new Error('这是二进制文件，无法按文本打开')
  }
  let text
  let encoding = 'utf8'
  let bom = false
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    text = buffer.subarray(2).toString('utf16le')
    encoding = 'utf16le'
    bom = true
  } else {
    bom = buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf
    text = (bom ? buffer.subarray(3) : buffer).toString('utf8')
  }
  return {
    file: await systemFileInfo(target, displayPath),
    text,
    encoding,
    bom,
    lineEnding: text.includes('\r\n') ? 'crlf' : 'lf',
  }
}

/** 图片预览用的定长分块（base64）。 */
export async function readSystemChunk(displayPath, offset = 0, length = 16 * 1024) {
  const target = toSystemPath(displayPath)
  const info = await stat(target)
  const start = Math.max(0, Math.min(Number(offset) || 0, info.size))
  const size = Math.max(0, Math.min(Number(length) || 0, info.size - start))
  const handle = await readFile(target)
  const slice = handle.subarray(start, start + size)
  return { data: slice.toString('base64'), bytes: slice.length }
}

/** 文本写入：expectedVersion 不一致时返回冲突而不是覆盖别人的修改。 */
export async function writeSystemText(displayPath, input = {}) {
  const target = toSystemPath(displayPath)
  let current
  try {
    current = await systemFileInfo(target, displayPath)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (current && input.expectedVersion && input.expectedVersion !== current.version) {
    return { saved: false, conflict: true, file: current }
  }
  let text = String(input.text ?? '')
  if (input.lineEnding === 'crlf') text = text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')
  const encoding = input.encoding === 'utf16le' ? 'utf16le' : 'utf8'
  let buffer = Buffer.from(text, encoding)
  if (input.bom) {
    const prefix = encoding === 'utf16le' ? Buffer.from([0xff, 0xfe]) : Buffer.from([0xef, 0xbb, 0xbf])
    buffer = Buffer.concat([prefix, buffer])
  }
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, buffer)
  return { saved: true, file: await systemFileInfo(target, displayPath) }
}

/** 新建目录，返回新路径。 */
export async function createSystemDirectory(parentDisplay, name) {
  if (!name || /[\\/]/.test(name)) throw new Error('目录名不能包含路径分隔符')
  const target = join(toSystemPath(parentDisplay), name)
  await mkdir(target, { recursive: false })
  const separator = parentDisplay.endsWith('\\') ? '' : '\\'
  return { path: `${parentDisplay}${separator}${name}` }
}

/** 重命名（同目录内）。 */
export async function renameSystemEntry(displayPath, name) {
  if (!name || /[\\/]/.test(name)) throw new Error('名称不能包含路径分隔符')
  const target = toSystemPath(displayPath)
  const next = join(dirname(target), name)
  await rename(target, next)
  const separator = displayPath.includes('/') && !displayPath.includes('\\') ? '/' : '\\'
  const base = displayPath.slice(0, displayPath.length - basename(displayPath).length).replace(/[\\/]$/, '')
  return { path: `${base}${separator}${name}` }
}

// ---- 凭证（DSH 的 ~/.dsh/.credentials.yaml）--------------------------------

const CREDENTIALS_WIN = join(WSL_HOME, '.dsh', '.credentials.yaml')

/** 只解析 `refs:` 段的键名，绝不读取值。 */
function refNamesFrom(text) {
  const names = []
  let inRefs = false
  for (const line of String(text).split(/\r?\n/)) {
    if (/^refs:\s*$/.test(line)) {
      inRefs = true
      continue
    }
    if (/^\S/.test(line)) inRefs = false
    if (!inRefs) continue
    const match = /^\s{2}([A-Za-z_][A-Za-z0-9_]*):/.exec(line)
    if (match) names.push(match[1])
  }
  return names
}

/** 当前已配置的凭证引用名（不含值）。 */
export async function credentialRefNames() {
  try {
    return refNamesFrom(await readFile(CREDENTIALS_WIN, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

/** 读取某个凭证引用的值。只在主进程内部使用，绝不返回给渲染层。 */
export async function credentialRefValue(ref) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)) throw new Error('非法的凭证名')
  let text = ''
  try {
    text = await readFile(CREDENTIALS_WIN, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
  let inRefs = false
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (/^refs:\s*$/.test(line)) {
      inRefs = true
      continue
    }
    if (/^\S/.test(line)) inRefs = false
    if (!inRefs) continue
    const match = new RegExp(`^\\s{2}${ref}:\\s*(.*)$`).exec(line)
    if (!match) continue
    const raw = match[1].trim()
    if (raw.startsWith('"') && raw.endsWith('"')) {
      try {
        return JSON.parse(raw)
      } catch {
        return raw.slice(1, -1)
      }
    }
    if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1)
    return raw
  }
  return null
}

/**
 * 写入一条凭证引用，保留文件里其他条目与注释。
 * 只做行级替换：DSH 自己写这个文件时也走同样的注释保留策略。
 */
export async function setCredentialRef(ref, value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)) throw new Error('凭证名必须是 POSIX 标识符')
  if (typeof value !== 'string' || value.length === 0) throw new Error('凭证值不能为空')
  let text = ''
  try {
    text = await readFile(CREDENTIALS_WIN, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const line = `  ${ref}: ${JSON.stringify(value)}`
  const lines = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n')
  if (text.length === 0) lines.length = 0
  if (!lines.includes('version: 1') && !lines.some((row) => /^version:/.test(row))) lines.unshift('version: 1')
  const refsIndex = lines.findIndex((row) => /^refs:\s*$/.test(row))
  if (refsIndex < 0) {
    lines.push('refs:', line)
  } else {
    let end = refsIndex + 1
    let replaced = false
    while (end < lines.length && (/^\s{2,}/.test(lines[end]) || lines[end].trim() === '')) {
      if (new RegExp(`^\\s{2}${ref}:`).test(lines[end])) {
        lines[end] = line
        replaced = true
      }
      end += 1
    }
    if (!replaced) lines.splice(refsIndex + 1, 0, line)
  }
  await mkdir(dirname(CREDENTIALS_WIN), { recursive: true })
  await writeFile(CREDENTIALS_WIN, `${lines.join('\n')}\n`, { mode: 0o600 })
  await ensureCredentialMode()
  return refNamesFrom(lines.join('\n'))
}

/** 删除一条凭证引用；`refs:` 段保留为空。 */
export async function unsetCredentialRef(ref) {
  let text
  try {
    text = await readFile(CREDENTIALS_WIN, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((row) => !new RegExp(`^\\s{2}${ref}:`).test(row))
  await writeFile(CREDENTIALS_WIN, lines.join('\n'), { mode: 0o600 })
  await ensureCredentialMode()
  return refNamesFrom(lines.join('\n'))
}

/**
 * Windows 侧新建的文件拿不到 WSL 的 0600 位；DSH 启动时会拒绝组/其他人可读的
 * 凭证文件，所以写完立刻在 WSL 里补一次 chmod。
 */
async function ensureCredentialMode() {
  try {
    await execFileAsync('wsl.exe', ['-e', 'bash', '-lc', 'chmod 600 ~/.dsh/.credentials.yaml'], { timeout: 15_000 })
  } catch {
    /* 权限修正失败不阻断保存；下次 DSH 启动会给出明确提示 */
  }
}

// ---- Git 写入与提交 -------------------------------------------------------

/** 每个路径的新增/删除行数；二进制文件标记为空。 */
export async function gitNumstat(rootPosix) {
  const cwd = uncFromWsl(rootPosix)
  const { stdout } = await execFileAsync(GIT, ['diff', '--numstat', '--'], { cwd, maxBuffer: 8 * 1024 * 1024 })
  return stdout
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const [added, removed, ...rest] = line.split('\t')
      return {
        path: rest.join('\t'),
        added: added === '-' ? 0 : Number(added) || 0,
        removed: removed === '-' ? 0 : Number(removed) || 0,
        binary: added === '-',
      }
    })
}

export async function gitHead(rootPosix) {
  try {
    const { stdout } = await execFileAsync(GIT, ['rev-parse', 'HEAD'], { cwd: uncFromWsl(rootPosix) })
    return stdout.trim()
  } catch {
    return null
  }
}

/** 暂存指定路径（含未跟踪文件）。 */
export async function gitStage(rootPosix, paths) {
  if (!Array.isArray(paths) || paths.length === 0) return
  await execFileAsync(GIT, ['add', '--', ...paths], { cwd: uncFromWsl(rootPosix), maxBuffer: 8 * 1024 * 1024 })
}

/** 创建提交，返回 sha 与 subject。 */
export async function gitCommit(rootPosix, { paths = [], subject, body = [], amend = false, noVerify = false }) {
  if (!subject || !subject.trim()) throw new Error('提交信息不能为空')
  const cwd = uncFromWsl(rootPosix)
  await gitStage(rootPosix, paths)
  const args = ['commit']
  if (amend) args.push('--amend')
  if (noVerify) args.push('--no-verify')
  args.push('-m', subject)
  for (const paragraph of Array.isArray(body) ? body : [body]) {
    if (paragraph) args.push('-m', String(paragraph))
  }
  await execFileAsync(GIT, args, { cwd, maxBuffer: 8 * 1024 * 1024 })
  const sha = (await execFileAsync(GIT, ['rev-parse', 'HEAD'], { cwd })).stdout.trim()
  const parent = (await execFileAsync(GIT, ['rev-parse', 'HEAD^'], { cwd }).catch(() => ({ stdout: '' }))).stdout.trim()
  return { sha, subject: subject.trim(), parent: parent || null }
}

/** 技能名 → 磁盘路径，供“在文件管理器中显示”。 */
export async function skillPathByName(projectRoot, name) {
  const { skills } = await scanSkills(projectRoot)
  const row = skills.find((item) => item.name === name)
  return row ? row.path : null
}

/** skill 根目录的 Windows 路径；`user` 对应用户级 .dsh/skills。 */
export async function skillRootPath(projectRoot, scope = 'user') {
  const roots = skillRoots(projectRoot)
  const row = scope === 'project'
    ? roots.find((item) => item.scope === 'workspace' && item.source === 'project-dsh')
    : roots.find((item) => item.source === 'user-dsh')
  return row ? uncFromWsl(row.path) : null
}

export async function readSessionEvents(sessionId) {
  const root = sessionsRoot()
  if (!existsSync(root)) return []
  for (const bucket of await readdir(root, { withFileTypes: true })) {
    if (!bucket.isDirectory()) continue
    const logPath = join(root, bucket.name, sessionId, 'session.v4.jsonl.zstd')
    if (!existsSync(logPath)) continue
    const text = zstdDecompressSync(await readFile(logPath)).toString('utf8')
    return text
      .split('\n')
      .filter((line) => line.trim())
      .flatMap((line) => {
        try {
          return [JSON.parse(line)]
        } catch {
          return []
        }
      })
  }
  return []
}

// DSH 资产索引（插件树 / 内置命令 / 工具 / MCP / profile 摘要）。
export * from './dsh-assets.js'

// DSH 运行时模型目录（llm-deepseek 的内置模型表）。
export * from './dsh-models.js'

// ---- 会话运行时状态 -------------------------------------------------------

/** Real SDK usage arrives on assistant/message; retain turn/end as a compatibility fallback. */
export function usageFromSessionEvent(type, data = {}) {
  if (type === 'assistant/message') return data?.usage ?? data?.result?.usage ?? null
  if (type === 'turn/end') return data?.usage ?? data?.result?.usage ?? null
  return null
}

/**
 * 从持久化事件流折叠出会话的运行时状态。
 *
 * DSH SDK 没有独立的 state API，这些状态只存在于事件里：权限预设、沙箱模式、
 * 审批策略、模型与请求参数、命令历史、轮次、用量、目标。缺什么就留 null，
 * 界面据此显示"本会话没有设置"，而不是编造默认值。
 */
export async function readSessionRuntimeState(sessionId) {
  if (!sessionId) return foldSessionRuntimeEvents(sessionId, [])
  return foldSessionRuntimeEvents(sessionId, await readSessionEvents(sessionId))
}

/** Fold an already-decoded event stream; kept separate from disk I/O for replay tests. */
export function foldSessionRuntimeEvents(sessionId, events = []) {
  const state = {
    sessionId,
    createdAt: null,
    cwd: null,
    title: null,
    permissionPreset: null,
    sandboxMode: null,
    approvalPolicy: null,
    provider: null,
    model: null,
    contextWindow: null,
    reasoningEffort: null,
    maxTokens: null,
    goal: null,
    turnCount: 0,
    userMessageCount: 0,
    compactionCount: 0,
    usage: null,
    lastError: null,
    commands: [],
    eventCount: 0,
  }
  if (!sessionId) return state
  state.eventCount = events.length
  const commands = new Map()
  for (const row of events) {
    const type = row?.type
    const data = row?.data ?? {}
    const usage = usageFromSessionEvent(type, data)
    // assistant/message is authoritative. turn/end is compatibility input and
    // must not overwrite usage already observed for the same turn.
    if (usage && (type !== 'turn/end' || state.usage === null)) state.usage = usage
    switch (type) {
      case 'session':
        state.createdAt = row.createdAt ?? null
        state.cwd = row.cwd ?? null
        break
      case 'permission/preset':
        state.permissionPreset = data.preset ?? null
        break
      case 'sandbox/mode':
        state.sandboxMode = data.mode ?? null
        break
      case 'approval/policy':
        state.approvalPolicy = data.policy ?? data.mode ?? null
        break
      case 'model/selection':
        state.provider = data.provider ?? state.provider
        state.model = data.model ?? data.selector ?? null
        break
      case 'session/title':
        state.title = data.title ?? data.value ?? null
        break
      case 'request/context':
        state.provider = data.provider ?? state.provider
        state.model = data.model ?? state.model
        state.contextWindow = data.contextWindow ?? state.contextWindow
        break
      case 'request/header': {
        const config = data?.header?.config
        if (config) {
          state.provider = config.provider ?? state.provider
          state.model = config.model ?? state.model
          state.reasoningEffort = config.reasoningEffort ?? state.reasoningEffort
          state.maxTokens = config.maxTokens ?? state.maxTokens
        }
        break
      }
      case 'user/message':
        // 系统注入的 user 消息（系统提示、时间、技能清单）不算用户发言。
        // surfaceOp 在事件顶层，不在 data 里。
        if (data?.source?.kind === 'user' && (row.surfaceOp ?? data?.surfaceOp) === 'append') state.userMessageCount += 1
        break
      case 'turn/start':
        state.turnCount += 1
        break
      case 'turn/end': {
        // usage 已在 assistant/message 到达时摄入；失败轮次保持既有值。
        const failure = data?.reason?.error ?? data?.reason?.failure
        if (failure?.message) state.lastError = { message: String(failure.message), code: failure.code ?? null }
        break
      }
      case 'compaction/done':
      case 'compaction/end':
        state.compactionCount += 1
        break
      case 'command/run': {
        const key = data.id ?? data.commandId ?? `c${commands.size}`
        commands.set(key, {
          name: data.name ?? data.command ?? '',
          // DSH 的 command/run 用 args 存斜杠命令后的文本，不是 input。
          input: String(data.input ?? data.rawInput ?? data.args ?? '').trim().slice(0, 200),
          status: 'running',
          time: row.time ?? null,
        })
        break
      }
      case 'command/done': {
        const key = data.id ?? data.commandId
        const entry = key === undefined ? undefined : commands.get(key)
        if (entry) {
          entry.status = data.ok === false || data.kind === 'error' ? 'failed' : 'done'
          if (typeof data.text === 'string') entry.text = data.text.slice(0, 200)
        }
        break
      }
      default:
        // 目标状态由 goal 插件写事件；前缀稳定，按前缀收集即可。
        if (typeof type === 'string' && type.startsWith('goal/')) {
          state.goal = data.goal ?? data.text ?? data.value ?? JSON.stringify(data).slice(0, 200)
        }
    }
  }
  state.commands = [...commands.values()].slice(-20)
  return state
}

