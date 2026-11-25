import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { closeSync, mkdirSync, openSync, renameSync, statSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'
import { RequestMethod, RUNTIME_SERVER_NAME } from '@dsh-studio/contract'

/**
 * Newline-delimited JSON-RPC 2.0 client for `dsh --profile sdk`.
 *
 * The runtime runs inside WSL on this machine, so the transport is a
 * `wsl.exe` child process whose stdin/stdout carry the frames. Every frame can
 * be recorded to a JSONL file for the contract-replay testkit.
 *
 * Events:
 * - `state` ({ state, detail }) — starting | ready | exited | failed
 * - `notification` ({ method, params }) — every server notification
 * - `request` ({ requestId, method, params, respond, expiresAt }) — server request
 * - `request-settled` ({ requestId, method, reason }) — response/cancel audit
 * - `stderr` (line)
 * - `frame` ({ dir, frame }) — redacted wire traffic
 */
const REDACTED = '[REDACTED]'
const CONTROL_METHODS = Object.freeze([
  'session/turn.cancel', 'session/turn.steer', 'session/queue.enqueue',
  'session/queue.list', 'session/queue.cancel', 'session/draft.get', 'session/draft.put',
])

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value, keys) {
  return record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

/** Validate the optional additive descriptor; absence always means unsupported. */
export function parseControlCapabilities(result) {
  const descriptor = result?.capabilities?.sessionControl
  if (descriptor === undefined) return null
  const queueKeys = ['source', 'target', 'revision']
  const draftKeys = ['durability']
  if (!exactKeys(descriptor, ['protocolVersion', 'methods', 'requestReplay', 'requestReplayLimit', 'queue', 'drafts', 'eventAttribution'])
    || descriptor.protocolVersion !== 1
    || !Array.isArray(descriptor.methods)
    || descriptor.methods.length === 0
    || descriptor.methods.some(method => typeof method !== 'string' || !CONTROL_METHODS.includes(method))
    || new Set(descriptor.methods).size !== descriptor.methods.length
    || descriptor.requestReplay !== 'runtime-process'
    || descriptor.requestReplayLimit !== 2048
    || !exactKeys(descriptor.queue, queueKeys)
    || descriptor.queue.source !== 'agent-inbox'
    || descriptor.queue.target !== 'next-turn'
    || descriptor.queue.revision !== 'session-seq'
    || !exactKeys(descriptor.drafts, draftKeys)
    || descriptor.drafts.durability !== 'runtime-process'
    || descriptor.eventAttribution !== 'best-effort-runtime-process') {
    throw new Error('initialize returned an invalid sessionControl capability descriptor')
  }
  return Object.freeze({
    ...descriptor,
    methods: Object.freeze([...descriptor.methods]),
    queue: Object.freeze({ ...descriptor.queue }),
    drafts: Object.freeze({ ...descriptor.drafts }),
  })
}
const SECRET_KEYS = new Set([
  'apikey', 'api_key', 'authorization', 'accesstoken', 'refreshtoken', 'sessiontoken',
  'password', 'passwd', 'secret', 'clientsecret', 'privatekey', 'credential', 'credentials',
])

/** Clone and redact diagnostic frames without changing the actual wire payload. */
export function redactFrame(frame) {
  return redactValue(frame)
}

function redactValue(value, key = '') {
  if (typeof value === 'string') return redactString(value, SECRET_KEYS.has(key.toLowerCase()))
  if (Array.isArray(value)) return value.map((item) => redactValue(item, key))
  if (!value || typeof value !== 'object') return value
  const output = {}
  for (const [childKey, childValue] of Object.entries(value)) {
    output[childKey] = SECRET_KEYS.has(childKey.toLowerCase()) ? REDACTED : redactValue(childValue, childKey)
  }
  return output
}

function redactString(text, secret = false) {
  if (secret) return REDACTED
  return text
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${REDACTED}`)
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED)
    .replace(/((?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*)[^\s,;]+/gi, `$1${REDACTED}`)
}
export class RuntimeClient extends EventEmitter {
  constructor(options = {}) {
    super()
    this.options = {
      distro: 'Ubuntu',
      user: 'qtt199',
      command: '/usr/local/bin/dsh',
      profile: 'sdk',
      cwd: '/home/qtt199/projects/dsh',
      provider: 'deepseek-official',
      model: 'deepseek-flash',
      reasoningEffort: undefined,
      maxTokens: undefined,
      approvalRequests: true,
      userQuestions: false,
      requestTimeoutMs: 120_000,
      serverRequestTimeoutMs: 300_000,
      stopTimeoutMs: 5_000,
      recordPath: null,
      recordMaxBytes: 2 * 1024 * 1024,
      spawnProcess: spawn,
      ...options,
    }
    this.state = 'stopped'
    this.controlCapabilities = null
    this.child = null
    this.pending = new Map()
    this.serverRequests = new Map()
    this.nextId = 0
    this.nextServerRequestId = 0
    this.generation = 0
    this.stdoutBuffer = ''
    this.stderrBuffer = ''
    this.record = null
    this.stderrTail = []
  }

  /** Spawn the runtime process. Resolves once the process is running. */
  start() {
    if (this.child) return Promise.resolve()
    // Capabilities belong to one Runtime process. Clear them before a new
    // generation can answer, and again if spawning that generation fails.
    this.controlCapabilities = null
    const { distro, user, command, profile, recordPath, spawnProcess } = this.options
    if (recordPath) this.openRecord(recordPath)

    this.setState('starting')
    let child
    try {
      child = spawnProcess(
        'wsl.exe',
        ['-d', distro, '-u', user, '--', 'bash', '-c', `exec ${command} --profile ${profile}`],
        { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
      )
    } catch (error) {
      this.closeRecord()
      this.setState('failed', error.message)
      return Promise.reject(error)
    }
    this.child = child
    const generation = ++this.generation
    this.stdoutBuffer = ''
    this.stderrBuffer = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      if (this.isCurrent(child, generation)) this.onStdout(chunk)
    })
    child.stderr.on('data', (chunk) => {
      if (this.isCurrent(child, generation)) this.onStderr(chunk)
    })
    // A closed runtime stdin emits an asynchronous error. Handle it so EPIPE
    // cannot crash the desktop process, and make the failed client restartable.
    child.stdin.on('error', (error) => this.failChild(child, error, true))
    child.on('spawn', () => {
      if (this.child === child) this.emit('spawned')
    })
    child.on('error', (error) => {
      if (this.child !== child) return
      this.emit('spawn-error', error)
      this.failChild(child, error, false)
    })
    child.on('exit', (code, signal) => {
      // Ignore a late exit from a previous generation after a restart.
      if (this.child !== child) return
      const detail = `runtime exited code=${code} signal=${signal}`
      this.failPending(new Error(detail))
      this.cancelAllServerRequests('runtime-exited', false)
      this.controlCapabilities = null
      this.setState('exited', detail)
      this.child = null
      this.closeRecord()
    })

    return new Promise((resolve, reject) => {
      const onSpawn = () => {
        cleanup()
        resolve()
      }
      const onError = (error) => {
        cleanup()
        reject(error)
      }
      const cleanup = () => {
        this.off('spawned', onSpawn)
        this.off('spawn-error', onError)
      }
      this.once('spawned', onSpawn)
      this.once('spawn-error', onError)
    })
  }

  /** Handshake. Returns `{ name, version }` of the runtime. */
  async initialize() {
    // A failed or malformed handshake must not retain a previous descriptor.
    this.controlCapabilities = null
    const child = this.child
    const generation = this.generation
    if (!child) throw new Error('runtime is not running')
    const { cwd, provider, model, reasoningEffort, maxTokens, approvalRequests, userQuestions } = this.options
    const params = { cwd, provider, model }
    if (reasoningEffort) params.reasoningEffort = reasoningEffort
    if (maxTokens) params.maxTokens = maxTokens
    if (approvalRequests) params.approvalRequests = true
    if (userQuestions) params.capabilities = { userQuestions: true }

    const result = await this.request(RequestMethod.initialize, params)
    if (!this.isCurrent(child, generation)) {
      throw new Error('runtime generation changed during initialize')
    }
    if (result?.serverInfo?.name !== RUNTIME_SERVER_NAME) {
      throw new Error(`unexpected runtime identity: ${JSON.stringify(result)}`)
    }
    this.controlCapabilities = parseControlCapabilities(result)
    this.setState('ready', `${result.serverInfo.name} ${result.serverInfo.version}`)
    return result.serverInfo
  }

  /** Queue one user turn. Resolves with the enqueue receipt. */
  query(sessionId, text) {
    return this.request(RequestMethod.sessionQuery, {
      sessionId,
      contentBlocks: [{ type: 'text', text }],
    })
  }

  /** Wait until the session (and managed descendants) settle. */
  wait(sessionId) {
    return this.request(RequestMethod.sessionWait, { sessionId })
  }

  /** Re-attach to a persisted session owned by no other process. */
  resume(sessionId) {
    return this.request(RequestMethod.sessionResume, { sessionId })
  }

  request(method, params, timeoutMs = this.options.requestTimeoutMs) {
    const child = this.child
    const generation = this.generation
    if (!child) return Promise.reject(new Error('runtime is not running'))
    const id = `req_${++this.nextId}`
    const frame = { jsonrpc: '2.0', id, method, params }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`request timed out after ${timeoutMs}ms: ${method}`))
      }, timeoutMs)
      this.pending.set(id, {
        child,
        generation,
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      try {
        this.write(frame, 'out', child)
      } catch (error) {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(error)
      }
    })
  }

  /** Fail closed before the wire unless this process advertised the method. */
  controlRequest(method, params) {
    if (!this.controlCapabilities?.methods.includes(method)) {
      const error = new Error(`current Runtime does not advertise ${method}`)
      error.code = 'CONTROL_UNSUPPORTED'
      return Promise.reject(error)
    }
    return this.request(method, params)
  }

  /** Accept cancellation for the current or explicitly identified turn. */
  cancelTurn(sessionId, requestId, options = {}) {
    return this.controlRequest(RequestMethod.turnCancel, {
      sessionId, requestId,
      ...(options.turnId === undefined ? {} : { turnId: options.turnId }),
      ...(options.reason === undefined ? {} : { reason: options.reason }),
    })
  }

  /** Insert an instruction at the native nearest-step boundary. */
  steerTurn(sessionId, requestId, contentBlocks, options = {}) {
    return this.controlRequest(RequestMethod.turnSteer, {
      sessionId, requestId, turnId: options.turnId, contentBlocks,
    })
  }

  enqueue(sessionId, requestId, contentBlocks, options = {}) {
    return this.controlRequest(RequestMethod.queueEnqueue, {
      sessionId, requestId, contentBlocks,
      ...(options.clientDraftId === undefined ? {} : { clientDraftId: options.clientDraftId }),
    })
  }

  listQueue(sessionId) {
    return this.controlRequest(RequestMethod.queueList, { sessionId })
  }

  cancelQueued(sessionId, requestId, queuedItemId) {
    return this.controlRequest(RequestMethod.queueCancel, { sessionId, requestId, queuedItemId })
  }

  getDraft(sessionId, draftId) {
    return this.controlRequest(RequestMethod.draftGet, { sessionId, draftId })
  }

  putDraft(sessionId, draftId, requestId, expectedRevision, contentBlocks) {
    return this.controlRequest(RequestMethod.draftPut, {
      sessionId, draftId, requestId, expectedRevision, contentBlocks,
    })
  }

  /** Answer a server request by its stable id. Repeated answers are ignored. */
  respondRequest(requestId, result) {
    const entry = this.serverRequests.get(requestId)
    if (!entry) return false
    return this.settleServerRequest(entry, result, 'responded', true)
  }

  /** Cancel a server request without ever approving it by default. */
  cancelRequest(requestId, reason = 'cancelled') {
    const entry = this.serverRequests.get(requestId)
    if (!entry) return false
    return this.settleServerRequest(entry, this.cancelResult(entry.method), reason, true)
  }

  cancelRequestsForSession(sessionId, reason = 'owner-disconnected') {
    let cancelled = 0
    for (const entry of this.serverRequests.values()) {
      if (entry.sessionId === sessionId && this.cancelRequest(entry.requestId, reason)) cancelled += 1
    }
    return cancelled
  }

  /** Respond by JSON-RPC id only while its server request owns this generation. */
  respond(id, result) {
    const entry = [...this.serverRequests.values()].find(value => value.rpcId === id)
    return entry === undefined ? false : this.respondRequest(entry.requestId, result)
  }

  async stop() {
    this.cancelAllServerRequests('shutdown')
    const child = this.child
    if (child) {
      try {
        await this.request(RequestMethod.shutdown, undefined, 5_000)
      } catch {
        child.kill()
      }
      try {
        await this.waitForChildExit(child, this.options.stopTimeoutMs)
      } catch (error) {
        // A runtime that acknowledged shutdown but never exits is still live.
        // Fail closed and terminate it rather than leaving an orphan process.
        this.failChild(child, error, true)
        throw error
      } finally {
        this.closeRecord()
      }
    } else {
      this.closeRecord()
    }
  }

  // -- internals ------------------------------------------------------------

  isCurrent(child, generation) {
    return this.child === child && this.generation === generation
  }

  setState(state, detail) {
    this.state = state
    this.emit('state', { state, detail })
  }

  fail(error) {
    this.failPending(error)
    this.cancelAllServerRequests('runtime-failed', false)
    this.controlCapabilities = null
    this.setState('failed', error.message)
  }

  failChild(child, error, terminate) {
    if (this.child !== child) return
    this.fail(error)
    this.child = null
    this.closeRecord()
    if (terminate && child.exitCode === null && !child.killed) child.kill()
  }

  waitForChildExit(child, timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer)
        child.off('exit', onExit)
        child.off('error', onError)
      }
      const onExit = () => {
        cleanup()
        resolve()
      }
      const onError = (error) => {
        cleanup()
        reject(error)
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error(`runtime did not exit within ${timeoutMs}ms`))
      }, timeoutMs)
      child.once('exit', onExit)
      child.once('error', onError)
    })
  }

  failPending(error) {
    for (const waiter of this.pending.values()) waiter.reject(error)
    this.pending.clear()
  }

  cancelAllServerRequests(reason, writeResponse = true) {
    let cancelled = 0
    for (const entry of this.serverRequests.values()) {
      if (this.settleServerRequest(entry, this.cancelResult(entry.method), reason, writeResponse)) cancelled += 1
    }
    return cancelled
  }

  cancelResult(method) {
    return method === 'approval/request' ? { outcome: 'cancelled' } : { cancelled: true }
  }

  settleServerRequest(entry, result, reason, writeResponse) {
    if (entry.settled || !this.isCurrent(entry.child, entry.generation)) return false
    entry.settled = true
    clearTimeout(entry.timer)
    this.serverRequests.delete(entry.requestId)
    if (writeResponse) this.write({ jsonrpc: '2.0', id: entry.rpcId, result }, 'out', entry.child)
    this.emit('request-settled', { requestId: entry.requestId, method: entry.method, reason })
    return true
  }

  openRecord(recordPath) {
    mkdirSync(dirname(recordPath), { recursive: true })
    try {
      if (statSync(recordPath).size >= this.options.recordMaxBytes) this.rotateRecord(recordPath)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    this.record = { path: recordPath, fd: openSync(recordPath, 'a', 0o600), bytes: this.recordSize(recordPath) }
  }

  recordSize(recordPath) {
    try {
      return statSync(recordPath).size
    } catch {
      return 0
    }
  }

  rotateRecord(recordPath) {
    const archive = `${recordPath}.${Date.now()}`
    renameSync(recordPath, archive)
  }

  closeRecord() {
    if (!this.record) return
    closeSync(this.record.fd)
    this.record = null
  }

  write(frame, dir, child = this.child) {
    if (dir === 'out') {
      if (!child || child !== this.child || !child.stdin?.writable || child.stdin.destroyed) {
        throw new Error('runtime stdin is not writable')
      }
      this.recordFrame(dir, frame)
      child.stdin.write(`${JSON.stringify(frame)}\n`)
      return
    }
    this.recordFrame(dir, frame)
  }

  recordFrame(dir, frame) {
    const redacted = redactFrame(frame)
    this.emit('frame', { dir, frame: redacted })
    if (!this.record) return
    const line = Buffer.from(`${JSON.stringify({ dir, frame: redacted })}\n`)
    if (this.record.bytes > 0 && this.record.bytes + line.length > this.options.recordMaxBytes) {
      closeSync(this.record.fd)
      this.rotateRecord(this.record.path)
      this.record.fd = openSync(this.record.path, 'a', 0o600)
      this.record.bytes = 0
    }
    writeSync(this.record.fd, line)
    this.record.bytes += line.length
  }

  onStdout(chunk) {
    this.stdoutBuffer += chunk
    for (;;) {
      const newline = this.stdoutBuffer.indexOf('\n')
      if (newline < 0) break
      const line = this.stdoutBuffer.slice(0, newline).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
      if (line) this.onLine(line)
    }
  }

  onStderr(chunk) {
    this.stderrBuffer += chunk
    for (;;) {
      const newline = this.stderrBuffer.indexOf('\n')
      if (newline < 0) break
      const line = this.stderrBuffer.slice(0, newline).replace(/\r$/, '')
      this.stderrBuffer = this.stderrBuffer.slice(newline + 1)
      if (!line.trim()) continue
      this.stderrTail.push(line)
      if (this.stderrTail.length > 50) this.stderrTail.shift()
      this.emit('stderr', line)
    }
  }

  onLine(line) {
    let frame
    try {
      frame = JSON.parse(line)
    } catch {
      this.emit('stderr', `non-json stdout: ${line}`)
      return
    }
    this.recordFrame('in', frame)
    const { id, method } = frame
    if (method && id !== undefined) {
      const requestId = `server-${++this.nextServerRequestId}`
      const timeoutMs = this.options.serverRequestTimeoutMs
      const entry = {
        requestId,
        rpcId: id,
        child: this.child,
        generation: this.generation,
        method,
        sessionId: frame.params?.sessionId ?? null,
        settled: false,
        timer: null,
      }
      const respond = (result) => this.respondRequest(requestId, result)
      entry.timer = setTimeout(() => {
        this.settleServerRequest(entry, this.cancelResult(method), 'timed-out', true)
      }, timeoutMs)
      this.serverRequests.set(requestId, entry)
      this.emit('request', {
        requestId,
        method,
        params: frame.params ?? {},
        respond,
        expiresAt: Date.now() + timeoutMs,
      })
      return
    }
    if (id !== undefined) {
      const waiter = this.pending.get(id)
      if (!waiter || !this.isCurrent(waiter.child, waiter.generation)) return
      this.pending.delete(id)
      if (frame.error) {
        const error = new Error(frame.error.message ?? 'JSON-RPC error')
        error.code = frame.error.code
        error.data = frame.error.data
        waiter.reject(error)
      } else {
        waiter.resolve(frame.result)
      }
      return
    }
    if (method) this.emit('notification', { method, params: frame.params ?? {} })
  }
}
