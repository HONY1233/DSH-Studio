/**
 * Workspace-scoped filesystem service.
 *
 * Every path is resolved inside one workspace root, including symlinks: a
 * lexical `..` check alone is not enough because a symlinked directory can
 * point outside the workspace. Reads use a content hash as the optimistic
 * version, and saves stage bytes in the destination directory before an
 * atomic rename so a failed save never truncates the original file.
 *
 * The root is a native filesystem path (the desktop passes the UNC form of
 * the WSL workspace). Keeping it native lets the same service run under the
 * test runner without guessing a host-specific mount layout.
 */
import { createHash, randomBytes } from 'node:crypto'
import { link, lstat, mkdir, open, readdir, readFile, realpath, rename, rm, stat, unlink } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export const WORKSPACE_FILES_SCHEMA_VERSION = 1
export const DEFAULT_MAX_TEXT_BYTES = 1024 * 1024
export const DEFAULT_MAX_HASH_BYTES = 8 * 1024 * 1024

const TEXT_MIME = Object.freeze({
  '.md': 'text/markdown',
  '.mdx': 'text/markdown',
  '.json': 'application/json',
  '.jsonc': 'application/json',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.cjs': 'text/javascript',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.jsx': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.xml': 'application/xml',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.toml': 'application/toml',
  '.sh': 'text/x-shellscript',
  '.py': 'text/x-python',
  '.rs': 'text/rust',
  '.go': 'text/go',
  '.java': 'text/java',
  '.sql': 'text/sql',
  '.txt': 'text/plain',
  '.svg': 'image/svg+xml',
})

function failure(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function invalid(message) {
  return failure('INVALID_ARGUMENT', message)
}

function normalizeRelative(input) {
  if (typeof input !== 'string') throw invalid('文件路径必须是字符串')
  if (input.includes('\0')) throw invalid('文件路径不能包含 NUL')
  const slashed = input.replaceAll('\\', '/')
  if (slashed.startsWith('/') || /^[A-Za-z]:/.test(slashed)) throw invalid('文件路径必须是工作区相对路径')
  const segments = slashed.split('/').filter((segment) => segment !== '' && segment !== '.')
  if (segments.some((segment) => segment === '..')) throw invalid('文件路径不能包含 ..')
  // `name:stream` is an NTFS alternate data stream on Windows and never a
  // legitimate workspace entry for the editor.
  if (segments.some((segment) => segment.includes(':'))) throw invalid('文件路径不能包含冒号')
  return segments.join('/')
}

function isWithin(root, candidate) {
  const rest = relative(root, candidate)
  return rest === '' || (rest !== '..' && !rest.startsWith(`..${sep}`) && !isAbsolute(rest))
}

function mimeOf(path) {
  return TEXT_MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

function hashOf(buffer) {
  return `sha256:${createHash('sha256').update(buffer).digest('hex')}`
}

function looksBinary(buffer) {
  const utf16Bom = (buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff)
  return buffer.subarray(0, 8192).includes(0) && !utf16Bom
}

function decodeText(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: buffer.subarray(2).toString('utf16le'), encoding: 'utf16le', bom: true }
  }
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    const body = Buffer.from(buffer.subarray(2))
    body.swap16()
    return { text: body.toString('utf16le'), encoding: 'utf16be', bom: true }
  }
  const bom = buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf
  return { text: (bom ? buffer.subarray(3) : buffer).toString('utf8'), encoding: 'utf8', bom }
}

function encodeText(value, input = {}) {
  let text = String(value ?? '')
  const encoding = input.encoding === 'utf16le' || input.encoding === 'utf16be' ? input.encoding : 'utf8'
  if (input.lineEnding === 'crlf') text = text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')
  let body
  if (encoding === 'utf16le') {
    body = Buffer.from(text, 'utf16le')
  } else if (encoding === 'utf16be') {
    body = Buffer.from(text, 'utf16le')
    body.swap16()
  } else {
    body = Buffer.from(text, 'utf8')
  }
  if (input.bom === true) {
    const prefix = encoding === 'utf16le'
      ? Buffer.from([0xff, 0xfe])
      : encoding === 'utf16be'
        ? Buffer.from([0xfe, 0xff])
        : Buffer.from([0xef, 0xbb, 0xbf])
    body = Buffer.concat([prefix, body])
  }
  return { buffer: body, encoding, bom: input.bom === true, lineEnding: input.lineEnding === 'crlf' ? 'crlf' : 'lf' }
}

function fileInfo(relativePath, info, version, writable) {
  return {
    schemaVersion: WORKSPACE_FILES_SCHEMA_VERSION,
    path: relativePath,
    name: basename(relativePath) || relativePath,
    mime: mimeOf(relativePath),
    size: info.size,
    version,
    writable,
    modifiedAt: new Date(info.mtimeMs).toISOString(),
  }
}

function statVersion(info) {
  return `stat:${Math.round(info.mtimeMs)}:${info.size}`
}

function assertFile(relativePath, info) {
  if (!info.isFile()) throw invalid(`不是普通文件：${relativePath || '(root)'}`)
}

function tempPathFor(target) {
  return join(dirname(target), `.${basename(target)}.dsh-${process.pid}-${randomBytes(6).toString('hex')}.tmp`)
}

async function removeQuietly(path) {
  try {
    await unlink(path)
  } catch {
    /* best effort; never masks the original failure */
  }
}

/**
 * Create a service bound to one workspace root. The constructor is lazy: it
 * does not touch the disk until a call needs the real path.
 */
export function createWorkspaceFiles({
  root,
  maxTextBytes = DEFAULT_MAX_TEXT_BYTES,
  maxHashBytes = DEFAULT_MAX_HASH_BYTES,
} = {}) {
  if (typeof root !== 'string' || root.length === 0) throw invalid('workspace root 不能为空')
  if (!Number.isSafeInteger(maxTextBytes) || maxTextBytes <= 0) throw invalid('maxTextBytes 必须是正安全整数')
  if (!Number.isSafeInteger(maxHashBytes) || maxHashBytes <= 0) throw invalid('maxHashBytes 必须是正安全整数')
  const configuredRoot = resolve(root)
  let rootRealPromise

  async function rootReal() {
    if (!rootRealPromise) {
      rootRealPromise = realpath(configuredRoot).catch((error) => {
        rootRealPromise = undefined
        throw failure('STORAGE_FAILED', `无法解析工作区根目录：${error.message}`)
      })
    }
    return rootRealPromise
  }

  async function assertInside(candidate, displayPath) {
    const rootPath = await rootReal()
    if (!isWithin(rootPath, candidate)) throw invalid(`路径越出工作区：${displayPath || '(root)'}`)
    return rootPath
  }

  async function existingTarget(relativePath) {
    const normalized = normalizeRelative(relativePath)
    const rootPath = await rootReal()
    const lexical = normalized ? resolve(rootPath, ...normalized.split('/')) : rootPath
    let canonical
    try {
      canonical = await realpath(lexical)
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
        throw failure('NOT_FOUND', `文件不存在：${normalized || '(root)'}`)
      }
      throw failure('STORAGE_FAILED', `无法解析路径 ${normalized}：${error.message}`)
    }
    await assertInside(canonical, normalized)
    const info = await lstat(canonical)
    return { normalized, rootPath, lexical, target: canonical, info }
  }

  async function writableTarget(relativePath) {
    const normalized = normalizeRelative(relativePath)
    if (!normalized) throw invalid('不能写工作区根目录')
    const rootPath = await rootReal()
    const lexical = resolve(rootPath, ...normalized.split('/'))
    if (!isWithin(rootPath, lexical)) throw invalid(`路径越出工作区：${normalized}`)
    try {
      const canonical = await realpath(lexical)
      await assertInside(canonical, normalized)
      const info = await lstat(canonical)
      return { normalized, rootPath, target: canonical, info, existed: true }
    } catch (error) {
      if (error.code !== 'NOT_FOUND' && error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error
    }
    // The final entry is missing. Its nearest existing ancestor must still
    // resolve inside the workspace; otherwise a symlinked parent escapes.
    let ancestor = dirname(lexical)
    for (;;) {
      try {
        const canonicalParent = await realpath(ancestor)
        await assertInside(canonicalParent, normalized)
        break
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error
        const parent = dirname(ancestor)
        if (parent === ancestor) throw failure('NOT_FOUND', `父目录不存在：${normalized}`)
        ancestor = parent
      }
    }
    return { normalized, rootPath, target: lexical, info: null, existed: false }
  }

  async function readCurrent(target, normalized) {
    const info = await stat(target)
    if (!info.isFile()) throw invalid(`不是普通文件：${normalized}`)
    if (info.size > maxHashBytes) {
      return { info, buffer: null, version: statVersion(info), tooLarge: true }
    }
    const buffer = await readFile(target)
    return { info, buffer, version: hashOf(buffer), tooLarge: false }
  }

  async function list(relativePath = '', { limit = 300 } = {}) {
    const normalized = normalizeRelative(relativePath)
    if (!Number.isSafeInteger(limit) || limit <= 0) throw invalid('limit 必须是正安全整数')
    const { target } = normalized ? await existingTarget(normalized) : { target: await rootReal() }
    const entries = await readdir(target, { withFileTypes: true })
    const rows = []
    for (const entry of entries) {
      if (rows.length >= limit) break
      const child = normalized ? `${normalized}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        rows.push({ type: 'dir', name: entry.name, path: child })
        continue
      }
      let size = 0
      try {
        size = (await lstat(join(target, entry.name))).size
      } catch {
        size = 0
      }
      rows.push({ type: 'file', name: entry.name, path: child, size })
    }
    rows.sort((left, right) => {
      if (left.type !== right.type) return left.type === 'dir' ? -1 : 1
      return left.name.localeCompare(right.name)
    })
    return rows
  }

  async function kind(relativePath) {
    try {
      const { info } = await existingTarget(relativePath)
      if (info.isDirectory()) return 'directory'
      return info.isFile() ? 'file' : 'missing'
    } catch (error) {
      if (error.code === 'NOT_FOUND' || error.code === 'INVALID_ARGUMENT') return 'missing'
      throw error
    }
  }

  async function inspect(relativePath) {
    const { normalized, target } = await existingTarget(relativePath)
    const info = await stat(target)
    if (info.isDirectory()) throw invalid(`不是普通文件：${normalized}`)
    assertFile(normalized, info)
    if (info.size > maxHashBytes) {
      return { ...fileInfo(normalized, info, statVersion(info), false), tooLarge: true, binary: false }
    }
    const buffer = await readFile(target)
    const binary = looksBinary(buffer)
    const writable = !binary && info.size <= maxTextBytes
    return {
      ...fileInfo(normalized, info, hashOf(buffer), writable),
      ...(binary ? { binary: true } : {}),
      ...(info.size > maxTextBytes ? { tooLarge: true } : {}),
    }
  }

  async function readText(relativePath) {
    const { normalized, target } = await existingTarget(relativePath)
    const info = await stat(target)
    assertFile(normalized, info)
    if (info.size > maxTextBytes) {
      return {
        file: fileInfo(normalized, info, statVersion(info), false),
        text: '',
        encoding: 'utf8',
        bom: false,
        lineEnding: 'lf',
        tooLarge: true,
      }
    }
    const buffer = await readFile(target)
    if (looksBinary(buffer)) {
      return {
        file: fileInfo(normalized, info, hashOf(buffer), false),
        text: '',
        encoding: 'utf8',
        bom: false,
        lineEnding: 'lf',
        binary: true,
      }
    }
    const decoded = decodeText(buffer)
    return {
      file: fileInfo(normalized, info, hashOf(buffer), true),
      text: decoded.text,
      encoding: decoded.encoding,
      bom: decoded.bom,
      lineEnding: decoded.text.includes('\r\n') ? 'crlf' : 'lf',
    }
  }

  async function readChunk(relativePath, input = {}) {
    const normalized = normalizeRelative(relativePath)
    const { target } = await existingTarget(normalized)
    const info = await stat(target)
    assertFile(normalized, info)
    const expectedVersion = input.version
    if (typeof expectedVersion !== 'string' || expectedVersion.length === 0) {
      throw invalid('读取分块需要 version')
    }
    const current = await readCurrent(target, normalized)
    if (current.version !== expectedVersion) {
      throw failure('CONFLICT', `文件已被修改：${normalized}`)
    }
    if (!current.buffer) throw invalid('文件过大，不能按分块读取')
    const offset = Number.isSafeInteger(input.offset) && input.offset >= 0 ? input.offset : 0
    const length = Number.isSafeInteger(input.length) && input.length > 0 ? input.length : 16 * 1024
    const start = Math.min(offset, current.buffer.length)
    const end = Math.min(start + length, current.buffer.length)
    return {
      data: current.buffer.subarray(start, end).toString('base64'),
      bytes: end - start,
    }
  }

  async function writeText(relativePath, input = {}) {
    const normalized = normalizeRelative(relativePath)
    if (!normalized) throw invalid('不能写工作区根目录')
    if (typeof input.expectedVersion !== 'string' || input.expectedVersion.length === 0) {
      throw invalid('保存需要 expectedVersion；新文件请使用 workspace.file.create')
    }
    const expectedVersion = input.expectedVersion
    const encoded = encodeText(input.text, input)
    if (encoded.buffer.length > maxHashBytes) throw invalid(`文件超过写入上限（${maxHashBytes} 字节）`)
    const targetInfo = await writableTarget(normalized)
    let current
    if (targetInfo.existed) {
      assertFile(normalized, targetInfo.info)
      current = await readCurrent(targetInfo.target, normalized)
      if (current.version !== expectedVersion) {
        return {
          saved: false,
          conflict: true,
          file: fileInfo(normalized, current.info, current.version, false),
        }
      }
    } else if (expectedVersion !== 'missing') {
      throw failure('CONFLICT', `文件不存在，不能用版本 ${expectedVersion} 覆盖：${normalized}`)
    }

    const temp = tempPathFor(targetInfo.target)
    let handle
    try {
      handle = await open(temp, 'wx', targetInfo.info ? targetInfo.info.mode & 0o777 : 0o644)
      await handle.writeFile(encoded.buffer)
      await handle.sync()
    } catch (error) {
      if (handle) await handle.close().catch(() => {})
      await removeQuietly(temp)
      throw failure('STORAGE_FAILED', `无法暂存文件 ${normalized}：${error.message}`)
    }
    try {
      await handle.close()
    } catch (error) {
      await removeQuietly(temp)
      throw failure('STORAGE_FAILED', `无法关闭暂存文件 ${normalized}：${error.message}`)
    }

    try {
      // Close the race between the first version check and the rename: if the
      // file changed while the temp file was written, keep the other writer.
      let verify
      try {
        const info = await stat(targetInfo.target)
        const buffer = info.size <= maxHashBytes ? await readFile(targetInfo.target) : null
        verify = buffer ? hashOf(buffer) : statVersion(info)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        verify = 'missing'
      }
      if (verify !== expectedVersion) {
        await removeQuietly(temp)
        try {
          const latest = await readCurrent(targetInfo.target, normalized)
          return {
            saved: false,
            conflict: true,
            file: fileInfo(normalized, latest.info, latest.version, false),
          }
        } catch (error) {
          if (error.code === 'NOT_FOUND') {
            throw failure('CONFLICT', `文件在保存期间被删除：${normalized}`)
          }
          throw error
        }
      }
      await rename(temp, targetInfo.target)
    } catch (error) {
      await removeQuietly(temp)
      if (error.code === 'INVALID_ARGUMENT' || error.code === 'CONFLICT' || error.code === 'STORAGE_FAILED') throw error
      throw failure('STORAGE_FAILED', `无法保存文件 ${normalized}：${error.message}`)
    }

    let info
    try {
      info = await stat(targetInfo.target)
    } catch (error) {
      throw failure('STORAGE_FAILED', `保存后无法读取文件 ${normalized}：${error.message}`)
    }
    return { saved: true, file: fileInfo(normalized, info, hashOf(encoded.buffer), true) }
  }

  async function createFile(relativePath, input = {}) {
    const normalized = normalizeRelative(relativePath)
    if (!normalized) throw invalid('文件名不能为空')
    const targetInfo = await writableTarget(normalized)
    if (targetInfo.existed) throw failure('CONFLICT', `文件已存在：${normalized}`)
    const encoded = encodeText(input.text ?? '', input)
    if (encoded.buffer.length > maxHashBytes) throw invalid(`文件超过写入上限（${maxHashBytes} 字节）`)
    const temp = tempPathFor(targetInfo.target)
    let handle
    try {
      handle = await open(temp, 'wx', 0o644)
      await handle.writeFile(encoded.buffer)
      await handle.sync()
      await handle.close()
      handle = undefined
      // `link` publishes the finished inode atomically and fails if another
      // writer created the target first; a plain rename would clobber it.
      await link(temp, targetInfo.target)
      // The target is complete even if only the temp link cannot be removed.
      await unlink(temp).catch(() => {})
    } catch (error) {
      if (handle) await handle.close().catch(() => {})
      await removeQuietly(temp)
      if (error.code === 'EEXIST') throw failure('CONFLICT', `文件已存在：${normalized}`)
      throw failure('STORAGE_FAILED', `无法新建文件 ${normalized}：${error.message}`)
    }
    return { applied: true, kind: 'file', path: normalized }
  }

  async function createDirectory(relativePath) {
    const normalized = normalizeRelative(relativePath)
    if (!normalized) throw invalid('目录名不能为空')
    const targetInfo = await writableTarget(normalized)
    if (targetInfo.existed) throw failure('CONFLICT', `路径已存在：${normalized}`)
    try {
      await mkdir(targetInfo.target)
    } catch (error) {
      if (error.code === 'EEXIST') throw failure('CONFLICT', `路径已存在：${normalized}`)
      throw failure('STORAGE_FAILED', `无法新建目录 ${normalized}：${error.message}`)
    }
    return { applied: true, kind: 'directory', path: normalized }
  }

  async function remove(relativePath) {
    const normalized = normalizeRelative(relativePath)
    if (!normalized) throw invalid('不能删除工作区根目录')
    const { lexical } = await existingTarget(normalized)
    try {
      // Remove the entry itself, not the symlink target, after its canonical
      // path was verified to stay inside the workspace.
      await rm(lexical, { recursive: false })
    } catch (error) {
      throw failure('STORAGE_FAILED', `无法删除 ${normalized}：${error.message}`)
    }
    return { applied: true, path: normalized }
  }

  async function renameEntry(relativePath, nextName) {
    const normalized = normalizeRelative(relativePath)
    if (!normalized) throw invalid('不能重命名工作区根目录')
    if (typeof nextName !== 'string' || !nextName || nextName.includes('\0') || /[\\/:]/.test(nextName)) {
      throw invalid('新名称不能包含路径分隔符或冒号')
    }
    const { lexical } = await existingTarget(normalized)
    const parent = dirname(lexical)
    const nextTarget = join(parent, nextName)
    await assertInside(nextTarget, normalized)
    try {
      await lstat(nextTarget)
      throw failure('CONFLICT', `目标已存在：${nextName}`)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    try {
      await rename(lexical, nextTarget)
    } catch (error) {
      throw failure('STORAGE_FAILED', `无法重命名 ${normalized}：${error.message}`)
    }
    const parentRelative = dirname(normalized)
    return {
      applied: true,
      path: parentRelative === '.' ? nextName : `${parentRelative}/${nextName}`,
    }
  }

  return Object.freeze({
    root: configuredRoot,
    list,
    kind,
    inspect,
    readText,
    readChunk,
    writeText,
    createFile,
    createDirectory,
    remove,
    rename: renameEntry,
  })
}