/**
 * One resource ledger for every desktop PTY (native panes and OMP panes).
 * The registry owns process lifetime; renderers only receive opaque ids.
 */
export function createTerminalService({
  spawn,
  distro,
  user,
  cwd,
  maxSessions = 8,
  scrollbackLimit = 64 * 1024,
  onData = () => {},
  onExit = () => {},
}) {
  const entries = new Map()
  let sequence = 0

  function createNative(ownerId) {
    const id = `native-${ownerId}`
    const existing = entries.get(id)
    if (existing) return existing
    return create({ id, ownerId, kind: 'native', cols: 100, rows: 30, script: null })
  }

  function create({ ownerId, kind = 'omp', cols = 80, rows = 24, script = null, id }) {
    if (typeof spawn !== 'function') throw new Error('node-pty 未能加载，终端不可用')
    if (kind === 'omp' && countKind('omp') >= maxSessions) {
      throw new Error(`终端数量已达上限（${maxSessions}）`)
    }
    const terminalId = id ?? `term-${Date.now().toString(36)}-${++sequence}`
    const args = ['-d', distro, '-u', user, '--', 'bash', '-l']
    const term = spawn('wsl.exe', script === null ? args : [...args, '-c', script], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      useConpty: true,
    })
    const entry = {
      id: terminalId,
      ownerId,
      kind,
      term,
      pid: term.pid,
      buffer: '',
      metadata: { cwd, name: script === null ? 'bash' : 'script' },
    }
    entries.set(terminalId, entry)
    term.onData((data) => {
      // A killed PTY can flush data or emit exit after the same opaque id has
      // been reused. Only the current ledger generation may deliver callbacks.
      if (entries.get(terminalId) !== entry) return
      entry.buffer = (entry.buffer + data).slice(-scrollbackLimit)
      onData(entry, data)
    })
    term.onExit((event) => {
      if (entries.get(terminalId) !== entry) return
      entries.delete(terminalId)
      onExit(entry, event)
    })
    return entry
  }

  function countKind(kind) {
    let count = 0
    for (const entry of entries.values()) if (entry.kind === kind) count += 1
    return count
  }

  function owned(id, ownerId) {
    const entry = entries.get(id)
    return entry?.ownerId === ownerId ? entry : null
  }

  function write(id, ownerId, data) {
    const entry = owned(id, ownerId)
    if (!entry) return false
    if (typeof data !== 'string' || data.length > 65_536) throw new Error('terminal write: invalid data')
    entry.term.write(data)
    return true
  }

  function resize(id, ownerId, cols, rows) {
    const entry = owned(id, ownerId)
    if (!entry) return false
    const nextCols = clampSize(cols, 80, 2, 500)
    const nextRows = clampSize(rows, 24, 1, 200)
    entry.term.resize(nextCols, nextRows)
    return { cols: nextCols, rows: nextRows }
  }

  function dispose(id, ownerId) {
    const entry = owned(id, ownerId)
    if (!entry) return false
    entries.delete(id)
    entry.term.kill()
    return true
  }

  function disposeOwner(ownerId) {
    let disposed = 0
    for (const entry of [...entries.values()]) {
      if (entry.ownerId !== ownerId) continue
      entries.delete(entry.id)
      entry.term.kill()
      disposed += 1
    }
    return disposed
  }

  function disposeAll() {
    const count = entries.size
    for (const entry of entries.values()) entry.term.kill()
    entries.clear()
    return count
  }

  return {
    createNative,
    create,
    get: (id) => entries.get(id) ?? null,
    getNative: (ownerId) => entries.get(`native-${ownerId}`) ?? null,
    list: () => [...entries.values()],
    size: () => entries.size,
    write,
    resize,
    dispose,
    disposeOwner,
    disposeAll,
  }
}

function clampSize(value, fallback, min, max) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) return fallback
  return value
}
