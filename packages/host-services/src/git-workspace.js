/**
 * Workspace-scoped Git service.
 *
 * The desktop passes the native form of the WSL workspace; the test runner can
 * pass a real temporary repository. Git paths are normalized, kept inside the
 * workspace prefix and passed with literalspecs so a renderer cannot inject
 * pathspec magic or stage files outside its workspace.
 *
 * `revision` is a snapshot fingerprint (HEAD, raw porcelain output and the
 * worktree stat of every changed path). Destructive commands (discard) require
 * the caller's expected revision and fail with CONFLICT instead of acting on
 * stale state.
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { lstat, rm } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const GIT = process.env.GIT_BIN ?? 'git'

export const GIT_WORKSPACE_SCHEMA_VERSION = 1
export const DEFAULT_MAX_DIFF_BYTES = 2 * 1024 * 1024
export const DEFAULT_MAX_STATUS_BYTES = 16 * 1024 * 1024

const MAX_PATHS = 1000
const MAX_LOG_LIMIT = 200
const MAX_LOG_SKIP = 1_000_000
const MAX_COMMIT_MESSAGE = 10_000
const CONFLICT_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])

function failure(code, message, details) {
  const error = new Error(message)
  error.code = code
  if (details !== undefined) error.details = details
  return error
}

function invalid(message) {
  return failure('INVALID_ARGUMENT', message)
}

/** Repository-relative path with no traversal, drive, ADS, pathspec magic or `.git`. */
function normalizeRelative(input) {
  if (typeof input !== 'string') throw invalid('Git 路径必须是字符串')
  if (input.includes('\0')) throw invalid('Git 路径不能包含 NUL')
  const slashed = input.replaceAll('\\', '/')
  if (!slashed || slashed === '.') throw invalid('Git 路径不能为空')
  if (slashed.startsWith('/') || /^[A-Za-z]:/.test(slashed) || slashed.startsWith('~')) {
    throw invalid('Git 路径必须是仓库相对路径')
  }
  const segments = slashed.split('/').filter((segment) => segment !== '' && segment !== '.')
  if (segments.length === 0) throw invalid('Git 路径不能为空')
  if (segments.some((segment) => segment === '..')) throw invalid('Git 路径不能包含 ..')
  if (segments.some((segment) => segment.includes(':') || segment === '.git')) {
    throw invalid('Git 路径包含不允许的段')
  }
  return segments.join('/')
}

function normalizePaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) throw invalid('至少需要一个 Git 路径')
  if (paths.length > MAX_PATHS) throw invalid(`一次最多操作 ${MAX_PATHS} 个 Git 路径`)
  const unique = []
  for (const value of paths) {
    const path = normalizeRelative(value)
    if (!unique.includes(path)) unique.push(path)
  }
  return unique
}

function firstLine(value) {
  return String(value ?? '').split('\n').map((line) => line.trim()).find(Boolean) ?? ''
}

function normalizeOid(input) {
  if (typeof input !== 'string' || !/^[0-9a-f]{4,64}$/i.test(input)) {
    throw invalid('提交 OID 必须是 4 到 64 位十六进制字符')
  }
  return input.toLowerCase()
}

function normalizeLogOptions(options = {}) {
  const limit = options?.limit === undefined ? 40 : options.limit
  const skip = options?.skip === undefined ? 0 : options.skip
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LOG_LIMIT) {
    throw invalid(`Git 日志 limit 必须是 1 到 ${MAX_LOG_LIMIT} 的整数`)
  }
  if (!Number.isSafeInteger(skip) || skip < 0 || skip > MAX_LOG_SKIP) {
    throw invalid(`Git 日志 skip 必须是 0 到 ${MAX_LOG_SKIP} 的整数`)
  }
  return { limit, skip }
}

function normalizeCommitMessage(input) {
  if (typeof input !== 'string') throw invalid('提交信息必须是字符串')
  const value = input.trim()
  if (!value) throw invalid('提交信息不能为空')
  if (value.includes('\0')) throw invalid('提交信息不能包含 NUL')
  if (value.length > MAX_COMMIT_MESSAGE) throw invalid(`提交信息不能超过 ${MAX_COMMIT_MESSAGE} 个字符`)
  return value
}

/** `%D` decoration → contract refs. Remote names disambiguate branches like `feat/x`. */
function parseDecorations(decorate, remotes) {
  return String(decorate ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const current = item === 'HEAD' || item.startsWith('HEAD -> ')
      const trimmed = item.replace(/^HEAD -> /, '')
      if (trimmed === 'HEAD') return { name: 'HEAD', kind: 'head', current: true }
      if (trimmed.startsWith('tag: ')) return { name: trimmed.slice(5), kind: 'tag', current: false }
      const kind = remotes.some((remote) => trimmed.startsWith(`${remote}/`)) ? 'remote' : 'local'
      return { name: trimmed, kind, current }
    })
}

/** Upstream ahead/behind and merge base. Missing upstream is a normal detached state, not an error. */
async function trackingOf(root) {
  const upstream = await runGit(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
    .then((result) => result.stdout.trim() || undefined)
    .catch(() => undefined)
  if (!upstream) return { ahead: 0, behind: 0 }
  const counts = await runGit(root, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])
    .then((result) => result.stdout.trim().split(/\s+/).map((value) => Number(value) || 0))
    .catch(() => [0, 0])
  const mergeBaseOid = await runGit(root, ['merge-base', 'HEAD', '@{upstream}'])
    .then((result) => result.stdout.trim() || undefined)
    .catch(() => undefined)
  return {
    upstream,
    ahead: counts[0] ?? 0,
    behind: counts[1] ?? 0,
    ...(mergeBaseOid ? { mergeBaseOid } : {}),
  }
}

async function stashCountOf(root) {
  const { stdout } = await runGit(root, ['stash', 'list', '--format=%gd']).catch(() => ({ stdout: '' }))
  return stdout.split('\n').filter(Boolean).length
}

async function commitParents(root, oid) {
  const { stdout } = await runGit(root, ['rev-list', '--parents', '-n', '1', oid])
  const [, ...parents] = stdout.trim().split(/\s+/).filter(Boolean)
  return parents
}

async function resolveCommit(root, oid) {
  return runGit(root, ['rev-parse', '--verify', `${oid}^{commit}`])
    .then((result) => result.stdout.trim())
    .catch(() => {
      throw failure('NOT_FOUND', `提交不存在：${oid}`)
    })
}

/** `git worktree list --porcelain` blocks. Paths stay raw; IDs are assigned by the service. */
export function parseWorktreeList(output) {
  const rows = []
  let row
  const flush = () => {
    if (row) rows.push(row)
    row = undefined
  }
  for (const line of String(output ?? '').replaceAll('\r\n', '\n').split('\n')) {
    if (!line) {
      flush()
      continue
    }
    const space = line.indexOf(' ')
    const key = space === -1 ? line : line.slice(0, space)
    const value = space === -1 ? '' : line.slice(space + 1)
    if (key === 'worktree') {
      flush()
      row = { path: value }
      continue
    }
    if (!row) continue
    switch (key) {
      case 'HEAD':
        row.headOid = value
        break
      case 'branch':
        row.branch = value.replace(/^refs\/heads\//, '')
        break
      case 'bare':
        row.bare = true
        break
      case 'detached':
        row.detached = true
        break
      case 'locked':
        row.locked = true
        if (value) row.lockReason = value
        break
      case 'prunable':
        row.prunable = true
        if (value) row.pruneReason = value
        break
      default:
        break
    }
  }
  flush()
  return rows
}

/** `git diff --name-status -z` / `git show --name-status -z` tokens. */
function parseNameStatus(output) {
  const tokens = String(output ?? '').split('\0')
  const rows = []
  for (let index = 0; index < tokens.length;) {
    const token = tokens[index]
    if (!token) {
      index += 1
      continue
    }
    const code = token[0]
    if (code === 'R' || code === 'C') {
      const originalPath = normalizeOutputPath(tokens[index + 1])
      const path = normalizeOutputPath(tokens[index + 2])
      index += 3
      if (!path) break
      rows.push({
        path,
        status: code === 'R' ? 'renamed' : 'copied',
        ...(originalPath ? { originalPath } : {}),
      })
      continue
    }
    const path = normalizeOutputPath(tokens[index + 1])
    index += 2
    if (!path) break
    const status = code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified'
    rows.push({ path, status })
  }
  return rows
}

function gitCommandError(error) {
  const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : ''
  const stdout = typeof error?.stdout === 'string' ? error.stdout.trim() : ''
  const message = [stderr, stdout].filter(Boolean).join('\n') || String(error?.message ?? error)
  if (error?.code === 'ENOENT') return failure('NOT_FOUND', '找不到 Git 可执行文件')
  if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return failure('INTERNAL', 'Git 输出超过上限，操作已中止')
  }
  if (/not a git repository/i.test(message)) return failure('NOT_FOUND', '当前工作区不是 Git 仓库')
  if (/unknown revision|bad revision|pathspec .*did not match|did not match any files/i.test(message)) {
    return failure('NOT_FOUND', `Git 路径不存在：${firstLine(message)}`)
  }
  if (/nothing to commit|no changes added to commit/i.test(message)) {
    return failure('FAILED_PRECONDITION', '没有可提交的暂存改动')
  }
  if (/(?:pre-commit|commit-msg|prepare-commit-msg|post-commit) hook|hook .* (?:failed|exited)|\bhusky\b/i.test(message)) {
    return failure('FAILED_PRECONDITION', `Git hook 拒绝了提交：${firstLine(message)}`)
  }
  if (/unable to auto-detect email address|please tell me who you are/i.test(message)) {
    return failure('FAILED_PRECONDITION', 'Git 未配置提交身份，请先设置 user.name 和 user.email')
  }
  if (/gpg failed|signing failed|failed to sign|secret key not available/i.test(message)) {
    return failure('FAILED_PRECONDITION', '提交签名失败；未自动改用未签名提交')
  }
  if (/index\.lock|another git process/i.test(message)) {
    return failure('CONFLICT', 'Git 索引正被另一个进程占用，请稍后重试')
  }
  if (/permission denied/i.test(message)) return failure('PERMISSION_DENIED', 'Git 没有权限修改该路径')
  return failure('INTERNAL', `Git 命令失败：${firstLine(message)}`)
}

async function runGit(cwd, args, options = {}) {
  try {
    return await execFileAsync(GIT, ['--literal-pathspecs', ...args], {
      cwd,
      maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
      windowsHide: true,
    })
  } catch (error) {
    throw gitCommandError(error)
  }
}

function normalizeOutputPath(value) {
  return String(value ?? '').replaceAll('\\', '/')
}

function stateOf(code) {
  switch (code) {
    case ' ':
      return 'unmodified'
    case '?':
      return 'untracked'
    case '!':
      return 'ignored'
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    case 'U':
      return 'conflicted'
    case 'M':
    case 'T':
      return 'modified'
    default:
      return 'modified'
  }
}

/** Parse `git status --porcelain=v1 -z`; rename/copy entries carry the old path next. */
export function parseGitStatus(output) {
  const tokens = String(output ?? '').split('\0')
  const rows = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token || token.length < 4) continue
    const xy = token.slice(0, 2)
    if (xy === '!!') continue
    let path = normalizeOutputPath(token.slice(3))
    let originalPath
    if (xy[0] === 'R' || xy[0] === 'C') {
      originalPath = normalizeOutputPath(tokens[index + 1])
      index += 1
    }
    const conflicted = CONFLICT_CODES.has(xy)
    if (xy === '??') {
      rows.push({ path, index: 'unmodified', worktree: 'untracked', conflicted: false })
      continue
    }
    rows.push({
      path,
      ...(originalPath ? { originalPath } : {}),
      index: conflicted ? 'conflicted' : stateOf(xy[0]),
      worktree: conflicted ? 'conflicted' : stateOf(xy[1]),
      conflicted,
    })
  }
  return rows
}

function prefixOf(info) {
  return info.workspacePrefix ? `${info.workspacePrefix}/` : ''
}

function withinWorkspace(info, path) {
  if (!info.workspacePrefix) return true
  return path === info.workspacePrefix || path.startsWith(prefixOf(info))
}

function assertWithinWorkspace(info, path) {
  if (!withinWorkspace(info, path)) throw invalid('Git 路径不在当前工作区内')
}

function hasPath(info, path) {
  return withinWorkspace(info, path)
}

function operationOf(gitDir) {
  const probes = [
    ['MERGE_HEAD', 'merge'],
    ['rebase-merge', 'rebase'],
    ['rebase-apply', 'rebase'],
    ['CHERRY_PICK_HEAD', 'cherry-pick'],
    ['REVERT_HEAD', 'revert'],
  ]
  for (const [name, operation] of probes) {
    if (existsSync(join(gitDir, name))) return operation
  }
  return undefined
}

async function inspectRepository(cwd) {
  try {
    const { stdout: rootText } = await runGit(cwd, ['rev-parse', '--show-toplevel'])
    const root = resolve(rootText.trim())
    if (!root) throw failure('NOT_FOUND', '当前工作区不是 Git 仓库')
    const { stdout: gitDirText } = await runGit(cwd, ['rev-parse', '--git-dir'])
    const gitDir = resolve(cwd, gitDirText.trim())
    const headOid = await runGit(cwd, ['rev-parse', '--verify', 'HEAD'])
      .then((result) => result.stdout.trim() || null)
      .catch(() => null)
    const branch = await runGit(cwd, ['symbolic-ref', '--short', '-q', 'HEAD'])
      .then((result) => normalizeOutputPath(result.stdout.trim()) || null)
      .catch(() => null)
    const relativeRoot = relative(root, resolve(cwd)).replaceAll(sep, '/')
    const workspacePrefix = relativeRoot && relativeRoot !== '.' && !relativeRoot.startsWith('../') && relativeRoot !== '..'
      ? relativeRoot.replace(/^\.\//, '')
      : undefined
    return {
      isRepository: true,
      root,
      gitDir,
      headOid,
      branch,
      detached: Boolean(headOid && !branch),
      unborn: !headOid,
      ...(workspacePrefix ? { workspacePrefix } : {}),
      ...(operationOf(gitDir) ? { operation: operationOf(gitDir) } : {}),
    }
  } catch (error) {
    return {
      isRepository: false,
      unavailableReason: error?.message || '当前工作区不是 Git 仓库',
    }
  }
}

async function snapshotOf(cwd) {
  const info = await inspectRepository(cwd)
  if (!info.isRepository) {
    const revision = `git:${createHash('sha256').update('not-a-repository').digest('hex')}`
    return { info, changes: [], revision }
  }
  const { stdout } = await runGit(info.root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    maxBuffer: DEFAULT_MAX_STATUS_BYTES,
  })
  const changes = parseGitStatus(stdout).filter((row) => hasPath(info, row.path))
  const fingerprints = []
  for (const row of changes) {
    const target = resolve(info.root, ...row.path.split('/'))
    const file = await lstat(target).catch(() => null)
    // Do not use the index mtime: `git status` may refresh its stat cache and
    // make two identical reads produce different revisions. Worktree stats
    // still catch content edits that leave the porcelain state unchanged.
    fingerprints.push(`${row.path}\0${row.index}\0${row.worktree}\0${file ? `${Math.round(file.mtimeMs)}:${file.size}` : 'missing'}`)
  }
  const revision = `git:${createHash('sha256')
    .update(`head:${info.headOid ?? 'unborn'}\nstatus:${stdout}\nworktree:${fingerprints.join('\n')}`)
    .digest('hex')}`
  return { info, changes, revision }
}

function truncateUtf8(value, maxBytes) {
  const buffer = Buffer.from(value)
  if (buffer.length <= maxBytes) return value
  return buffer.subarray(0, maxBytes).toString('utf8')
}

function assertWritable(snapshot, paths) {
  for (const path of paths) {
    const row = snapshot.changes.find((change) => change.path === path)
    if (row?.conflicted) throw failure('CONFLICT', `请先解决冲突：${path}`)
  }
}

export function createGitWorkspace({ cwd, maxDiffBytes = DEFAULT_MAX_DIFF_BYTES } = {}) {
  if (typeof cwd !== 'string' || !cwd) throw invalid('Git 工作区路径不能为空')
  if (!Number.isSafeInteger(maxDiffBytes) || maxDiffBytes <= 0) throw invalid('maxDiffBytes 必须是正整数')
  const rootCwd = resolve(cwd)

  async function snapshot() {
    return snapshotOf(rootCwd)
  }

  async function repository() {
    const snapshotValue = await snapshot()
    if (!snapshotValue.info.isRepository) {
      return {
        isRepository: false,
        detached: false,
        unborn: true,
        ahead: 0,
        behind: 0,
        stashCount: 0,
        changes: [],
        revision: snapshotValue.revision,
        unavailableReason: snapshotValue.info.unavailableReason,
      }
    }
    const info = snapshotValue.info
    const [tracking, stashCount] = await Promise.all([trackingOf(info.root), stashCountOf(info.root)])
    return {
      isRepository: true,
      ...(info.workspacePrefix ? { workspacePrefix: info.workspacePrefix } : {}),
      ...(info.branch ? { branch: info.branch } : {}),
      ...(info.headOid ? { headOid: info.headOid } : {}),
      detached: info.detached,
      unborn: info.unborn,
      ...(tracking.upstream ? { upstream: tracking.upstream } : {}),
      ahead: tracking.ahead,
      behind: tracking.behind,
      stashCount,
      ...(info.operation ? { operation: info.operation } : {}),
      changes: snapshotValue.changes,
      revision: snapshotValue.revision,
    }
  }

  async function diff(path, target = 'working') {
    const relativePath = normalizeRelative(path)
    const targetValue = target === undefined ? 'working' : target
    if (targetValue !== 'working' && targetValue !== 'staged') {
      throw invalid('Git diff target 必须是 working 或 staged')
    }
    const snapshotValue = await snapshot()
    if (!snapshotValue.info.isRepository) throw failure('NOT_FOUND', snapshotValue.info.unavailableReason)
    assertWithinWorkspace(snapshotValue.info, relativePath)
    const change = snapshotValue.changes.find((row) => row.path === relativePath)
    const paths = change?.originalPath ? [relativePath, change.originalPath] : [relativePath]
    const args = ['diff', '--no-color', '--no-ext-diff', '--no-textconv']
    if (targetValue === 'staged') args.push('--cached')
    args.push('--', ...paths)
    const { stdout } = await runGit(snapshotValue.info.root, args, {
      maxBuffer: Math.max(maxDiffBytes * 4, 8 * 1024 * 1024),
    })
    const binary = /^Binary files .* differ$/m.test(stdout) || /^GIT binary patch$/m.test(stdout)
    const patch = binary ? '' : truncateUtf8(stdout, maxDiffBytes)
    return {
      patch,
      binary,
      truncated: !binary && Buffer.byteLength(stdout) > maxDiffBytes,
      revision: snapshotValue.revision,
    }
  }

  async function stage(paths) {
    const list = normalizePaths(paths)
    const snapshotValue = await snapshot()
    if (!snapshotValue.info.isRepository) throw failure('NOT_FOUND', snapshotValue.info.unavailableReason)
    for (const path of list) assertWithinWorkspace(snapshotValue.info, path)
    assertWritable(snapshotValue, list)
    await runGit(snapshotValue.info.root, ['add', '-A', '--', ...list])
    return { applied: true, paths: list }
  }

  async function unstage(paths) {
    const list = normalizePaths(paths)
    const snapshotValue = await snapshot()
    if (!snapshotValue.info.isRepository) throw failure('NOT_FOUND', snapshotValue.info.unavailableReason)
    for (const path of list) assertWithinWorkspace(snapshotValue.info, path)
    assertWritable(snapshotValue, list)
    const expanded = [...list]
    for (const path of list) {
      const row = snapshotValue.changes.find((change) => change.path === path)
      if (row?.originalPath && !expanded.includes(row.originalPath)) expanded.push(row.originalPath)
    }
    if (snapshotValue.info.unborn) {
      await runGit(snapshotValue.info.root, ['rm', '-r', '--cached', '--ignore-unmatch', '--', ...expanded])
    } else {
      await runGit(snapshotValue.info.root, ['reset', '-q', 'HEAD', '--', ...expanded])
    }
    return { applied: true, paths: list }
  }

  async function discard(paths, expectedRevision) {
    const list = normalizePaths(paths)
    if (typeof expectedRevision !== 'string' || !expectedRevision) {
      throw invalid('丢弃改动需要 expectedRevision')
    }
    const snapshotValue = await snapshot()
    if (!snapshotValue.info.isRepository) throw failure('NOT_FOUND', snapshotValue.info.unavailableReason)
    if (snapshotValue.revision !== expectedRevision) {
      throw failure('CONFLICT', 'Git 状态已变化；请重新读取 Changes 后再丢弃', {
        revision: snapshotValue.revision,
      })
    }
    const rows = []
    for (const path of list) {
      assertWithinWorkspace(snapshotValue.info, path)
      const row = snapshotValue.changes.find((change) => change.path === path)
      if (!row) throw failure('NOT_FOUND', `没有待丢弃的改动：${path}`)
      if (row.conflicted) throw failure('CONFLICT', `请先解决冲突：${path}`)
      rows.push(row)
    }
    const untracked = rows.filter((row) => row.index === 'unmodified' && row.worktree === 'untracked')
    const tracked = rows.filter((row) => !(row.index === 'unmodified' && row.worktree === 'untracked'))
    if (tracked.length > 0) {
      await runGit(snapshotValue.info.root, ['restore', '--worktree', '--', ...tracked.map((row) => row.path)])
    }
    for (const row of untracked) {
      const target = resolve(snapshotValue.info.root, ...row.path.split('/'))
      const rest = relative(snapshotValue.info.root, target)
      if (!rest || rest === '..' || rest.startsWith(`..${sep}`) || isAbsolute(rest)) {
        throw invalid('Git 路径不在仓库根目录内')
      }
      await rm(target, { recursive: true, force: true })
    }
    return { applied: true, paths: list }
  }

  async function log(options = {}) {
    const { limit, skip } = normalizeLogOptions(options)
    const snapshotValue = await snapshot()
    if (!snapshotValue.info.isRepository) throw failure('NOT_FOUND', snapshotValue.info.unavailableReason)
    const info = snapshotValue.info
    if (!info.headOid) return { commits: [], truncated: false, ahead: 0, behind: 0 }
    const [tracking, remotes] = await Promise.all([
      trackingOf(info.root),
      runGit(info.root, ['remote'])
        .then((result) => result.stdout.split('\n').map((name) => name.trim()).filter(Boolean))
        .catch(() => []),
    ])
    const { stdout } = await runGit(
      info.root,
      ['log', '--format=%H%x1f%P%x1f%s%x1f%an%x1f%aI%x1f%D', '-n', String(limit + 1), `--skip=${skip}`],
      { maxBuffer: 8 * 1024 * 1024 },
    )
    const rows = stdout.split('\n').filter(Boolean).map((line) => {
      const [oid, parents, subject, authorName, authorDate, decorate] = line.split('\x1f')
      return {
        oid: oid ?? '',
        parents: String(parents ?? '').split(' ').filter(Boolean),
        subject: subject ?? '',
        authorName: authorName ?? '',
        authorDate: authorDate ?? '',
        refs: parseDecorations(decorate, remotes),
      }
    })
    const truncated = rows.length > limit
    const commits = rows.slice(0, limit).map((row, index) => ({
      ...row,
      relation: index === 0 && skip === 0
        ? 'head'
        : index < tracking.ahead && skip === 0
          ? 'outgoing'
          : 'common',
    }))
    return {
      commits,
      truncated,
      ...(truncated ? { cursor: String(skip + commits.length) } : {}),
      headOid: info.headOid,
      ...(tracking.upstream ? { upstream: tracking.upstream } : {}),
      ...(tracking.mergeBaseOid ? { mergeBaseOid: tracking.mergeBaseOid } : {}),
      ahead: tracking.ahead,
      behind: tracking.behind,
    }
  }

  /**
   * Commit the current index. Hooks always run: there is deliberately no
   * `--no-verify` here. Rewriting history (amend) or bypassing hooks requires
   * a separate, explicit authorization path that the renderer cannot grant.
   */
  async function commit(message, options = {}) {
    if (options === null || typeof options !== 'object') throw invalid('提交选项必须是对象')
    for (const key of ['amend', 'noVerify', 'sign']) {
      if (options[key] !== undefined && typeof options[key] !== 'boolean') throw invalid(`${key} 必须是布尔值`)
    }
    if (options.amend === true) {
      throw failure('PERMISSION_DENIED', 'amend 会改写已有提交；当前没有单独的授权入口')
    }
    if (options.noVerify === true) {
      throw failure('PERMISSION_DENIED', '提交默认执行 Git hook；noVerify 需要单独的授权入口')
    }
    if (options.sign === true) throw failure('CAPABILITY_UNAVAILABLE', '签名提交尚未接入')
    const text = normalizeCommitMessage(message)
    let paths = []
    if (options.paths !== undefined) {
      if (!Array.isArray(options.paths)) throw invalid('提交路径必须是数组')
      if (options.paths.length > 0) paths = normalizePaths(options.paths)
    }
    const snapshotValue = await snapshot()
    if (!snapshotValue.info.isRepository) throw failure('NOT_FOUND', snapshotValue.info.unavailableReason)
    const info = snapshotValue.info
    for (const path of paths) assertWithinWorkspace(info, path)
    const conflict = snapshotValue.changes.find((change) => change.conflicted)
    if (conflict) throw failure('CONFLICT', `请先解决冲突：${conflict.path}`)
    if (paths.length > 0) {
      assertWritable(snapshotValue, paths)
      await runGit(info.root, ['add', '-A', '--', ...paths])
    }
    await runGit(info.root, ['commit', '-m', text], { maxBuffer: 8 * 1024 * 1024 })
    const oid = (await runGit(info.root, ['rev-parse', 'HEAD'])).stdout.trim()
    const parent = (await runGit(info.root, ['rev-parse', 'HEAD^']).catch(() => ({ stdout: '' }))).stdout.trim() || null
    const subject = (await runGit(info.root, ['show', '-s', '--format=%s', oid])).stdout.trim()
    return { oid, parent, subject, paths }
  }

  async function worktrees() {
    const snapshotValue = await snapshot()
    if (!snapshotValue.info.isRepository) throw failure('NOT_FOUND', snapshotValue.info.unavailableReason)
    const info = snapshotValue.info
    const { stdout } = await runGit(info.root, ['worktree', 'list', '--porcelain'], { maxBuffer: 8 * 1024 * 1024 })
    const worktrees = parseWorktreeList(stdout).map((row) => ({
      worktreeId: `wt_${createHash('sha256').update(row.path).digest('hex').slice(0, 24)}`,
      name: basename(row.path) || row.path,
      ...(row.branch ? { branch: row.branch } : {}),
      ...(row.headOid ? { headOid: row.headOid } : {}),
      current: resolve(row.path) === resolve(info.root),
      detached: row.detached === true || !row.branch,
      bare: row.bare === true,
      locked: row.locked === true,
      ...(row.lockReason ? { lockReason: row.lockReason } : {}),
      prunable: row.prunable === true,
    }))
    return { rootConfigured: true, worktrees }
  }

  async function commitChanges(oid) {
    const target = normalizeOid(oid)
    const snapshotValue = await snapshot()
    if (!snapshotValue.info.isRepository) throw failure('NOT_FOUND', snapshotValue.info.unavailableReason)
    const info = snapshotValue.info
    const resolved = await resolveCommit(info.root, target)
    const [subject, parents] = await Promise.all([
      runGit(info.root, ['show', '-s', '--format=%s', resolved]).then((result) => result.stdout.trim()),
      commitParents(info.root, resolved),
    ])
    const { stdout } = parents.length > 1
      ? await runGit(info.root, ['diff', '--name-status', '-z', '--find-renames', parents[0], resolved], { maxBuffer: 8 * 1024 * 1024 })
      : await runGit(info.root, ['show', '--name-status', '--format=', '-z', '--find-renames', resolved], { maxBuffer: 8 * 1024 * 1024 })
    const files = parseNameStatus(stdout).filter((row) => hasPath(info, row.path))
    return { oid: resolved, subject, files }
  }

  async function commitDiff(oid, path) {
    const target = normalizeOid(oid)
    const relativePath = normalizeRelative(path)
    const snapshotValue = await snapshot()
    if (!snapshotValue.info.isRepository) throw failure('NOT_FOUND', snapshotValue.info.unavailableReason)
    const info = snapshotValue.info
    assertWithinWorkspace(info, relativePath)
    const resolved = await resolveCommit(info.root, target)
    const parents = await commitParents(info.root, resolved)
    const args = parents.length === 0
      ? ['show', '--no-color', '--no-ext-diff', '--no-textconv', '--format=', resolved]
      : ['diff', '--no-color', '--no-ext-diff', '--no-textconv', parents[0], resolved]
    args.push('--', relativePath)
    const { stdout } = await runGit(info.root, args, {
      maxBuffer: Math.max(maxDiffBytes * 4, 8 * 1024 * 1024),
    })
    const binary = /^Binary files .* differ$/m.test(stdout) || /^GIT binary patch$/m.test(stdout)
    const patch = binary ? '' : truncateUtf8(stdout, maxDiffBytes)
    return {
      patch,
      binary,
      truncated: !binary && Buffer.byteLength(stdout) > maxDiffBytes,
    }
  }

  async function toolchain() {
    try {
      const { stdout } = await execFileAsync(GIT, ['--version'], { windowsHide: true })
      return { available: true, version: stdout.trim() }
    } catch (error) {
      return { available: false, unavailableReason: error?.message ?? String(error) }
    }
  }

  return Object.freeze({
    repository,
    status: repository,
    diff,
    stage,
    unstage,
    discard,
    commit,
    log,
    worktrees,
    commitChanges,
    commitDiff,
    toolchain,
  })
}