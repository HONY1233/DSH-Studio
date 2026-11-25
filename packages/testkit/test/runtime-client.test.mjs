import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import { parseControlCapabilities, redactFrame, RuntimeClient } from '@dsh-studio/runtime-client'

class FakeRuntimeProcess extends EventEmitter {
  constructor({ exitOnShutdown = true } = {}) {
    super()
    this.stdin = new PassThrough()
    this.stdout = new PassThrough()
    this.stderr = new PassThrough()
    this.stdin.setEncoding('utf8')
    this.stdout.setEncoding('utf8')
    this.stderr.setEncoding('utf8')
    this.exitCode = null
    this.signalCode = null
    this.killed = false
    this.exitOnShutdown = exitOnShutdown
    this.stdin.on('data', (line) => {
      const frame = JSON.parse(line)
      if (frame.method === 'shutdown') {
        this.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: {} })}\n`)
        if (this.exitOnShutdown) setTimeout(() => {
          this.exitCode = 0
          this.emit('exit', 0, null)
        }, 15)
      }
    })
  }
  kill() { this.killed = true; return true }
}

function runtimeHarness(options = {}) {
  const processes = []
  const client = new RuntimeClient({
    ...options,
    spawnProcess: () => {
      const child = new FakeRuntimeProcess(options)
      processes.push(child)
      queueMicrotask(() => child.emit('spawn'))
      return child
    },
  })
  return { client, processes }
}

function clientWithWire(options = {}) {
  const client = new RuntimeClient(options)
  const writes = []
  client.child = { stdin: { writable: true, write: (line) => writes.push(line) } }
  return { client, writes }
}

function receiveRequest(client, frame) {
  client.onLine(JSON.stringify(frame))
}

test('server requests survive the microtask and respond exactly once', () => {
  const { client, writes } = clientWithWire()
  let request
  client.on('request', (value) => { request = value })
  receiveRequest(client, {
    jsonrpc: '2.0', id: 91, method: 'approval/request', params: { sessionId: 's1' },
  })

  assert.ok(request.requestId)
  assert.equal(request.expiresAt > Date.now(), true)
  assert.equal(client.respondRequest(request.requestId, { outcome: 'allowed-once' }), true)
  assert.equal(client.respondRequest(request.requestId, { outcome: 'allowed-once' }), false)
  assert.equal(writes.length, 1)
  assert.deepEqual(JSON.parse(writes[0]), {
    jsonrpc: '2.0', id: 91, result: { outcome: 'allowed-once' },
  })
})

test('unanswered server requests time out as cancelled and emit one audit event', async () => {
  const { client, writes } = clientWithWire({ serverRequestTimeoutMs: 10 })
  const settled = []
  client.on('request-settled', (event) => settled.push(event))
  receiveRequest(client, {
    jsonrpc: '2.0', id: 92, method: 'approval/request', params: { sessionId: 's1' },
  })

  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.deepEqual(JSON.parse(writes[0]).result, { outcome: 'cancelled' })
  assert.equal(settled.length, 1)
  assert.equal(settled[0].reason, 'timed-out')
  assert.equal(client.serverRequests.size, 0)
})

test('diagnostic frames redact credentials but preserve token usage fields', () => {
  const input = {
    method: 'session/query',
    params: {
      apiKey: 'sk-1234567890abcdef',
      authorization: 'Bearer abc.def.ghi',
      text: 'password=hunter2',
    },
    usage: {
      inputTokens: 120,
      outputTokens: 18,
      cachedInputTokens: 12,
      reasoningTokens: 4,
      contextTokens: 900,
      maxTokens: 4096,
    },
  }
  const redacted = redactFrame(input)
  assert.equal(redacted.params.apiKey, '[REDACTED]')
  assert.equal(redacted.params.authorization, '[REDACTED]')
  assert.equal(redacted.params.text, 'password=[REDACTED]')
  assert.deepEqual(redacted.usage, input.usage)
  assert.equal(input.params.apiKey, 'sk-1234567890abcdef', 'redaction must not mutate the wire payload')
})

test('spawn error cleans up the failed generation and allows a restart', async () => {
  const processes = []
  let fail = true
  const client = new RuntimeClient({
    spawnProcess: () => {
      const child = new FakeRuntimeProcess()
      processes.push(child)
      queueMicrotask(() => {
        if (fail) {
          fail = false
          child.emit('error', new Error('spawn failed'))
        } else child.emit('spawn')
      })
      return child
    },
  })

  await assert.rejects(client.start(), /spawn failed/)
  assert.equal(client.child, null)
  assert.equal(client.state, 'failed')
  await client.start()
  assert.equal(client.child, processes[1])
  await client.stop()
  assert.equal(client.child, null)
})

test('stdin errors fail closed without an uncaught exception or pending-request leak', async () => {
  const { client, processes } = runtimeHarness()
  await client.start()
  const pending = client.request('test/blocked', {})
  const assertion = assert.rejects(pending, /EPIPE/)
  processes[0].stdin.emit('error', new Error('EPIPE'))
  await assertion
  assert.equal(client.state, 'failed')
  assert.equal(client.child, null)
  assert.equal(client.pending.size, 0)
  assert.equal(processes[0].killed, true)
})

test('a late exit from an old generation cannot clear a restarted child', async () => {
  const { client, processes } = runtimeHarness()
  await client.start()
  processes[0].stdin.emit('error', new Error('EPIPE'))
  await client.start()
  assert.equal(client.child, processes[1])

  processes[0].emit('exit', 1, null)
  assert.equal(client.child, processes[1])
  assert.equal(client.state, 'starting')
  await client.stop()
})

test('old child stdout, stderr, and approval responses cannot cross a Runtime generation', async () => {
  const { client, processes } = runtimeHarness()
  await client.start()
  const old = processes[0]
  const notifications = []
  const stderr = []
  client.on('notification', (value) => notifications.push(value))
  client.on('stderr', (value) => stderr.push(value))
  let oldApproval
  client.on('request', (value) => { oldApproval = value })
  old.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: 71, method: 'approval/request', params: { sessionId: 'old' } })}\n`)
  assert.ok(oldApproval)
  old.stdout.write('{"jsonrpc":"2.0","method":"session.event","params":')
  old.stderr.write('old-partial')
  old.stdin.emit('error', new Error('EPIPE'))
  await client.start()
  const current = processes[1]
  const writes = []
  current.stdin.on('data', (line) => writes.push(JSON.parse(line)))

  old.stdout.write('"sessionId":"old","event":{"seq":999}}}\n')
  old.stderr.write('-stale\n')
  assert.equal(oldApproval.respond({ outcome: 'allowed-once' }), false)
  current.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'session.event', params: { sessionId: 'new' } })}\n`)
  current.stderr.write('current-stderr\n')
  assert.deepEqual(notifications, [{ method: 'session.event', params: { sessionId: 'new' } }])
  assert.deepEqual(stderr, ['current-stderr'])
  assert.deepEqual(writes, [])
  await client.stop()
})

test('a response from an old child cannot settle a request in the restarted generation', async () => {
  const { client, processes } = runtimeHarness()
  await client.start()
  const old = processes[0]
  const oldRequest = client.request('test/old', {})
  const oldRejected = assert.rejects(oldRequest, /EPIPE/)
  old.stdin.emit('error', new Error('EPIPE'))
  await oldRejected
  await client.start()
  const current = processes[1]

  let settled = false
  const request = client.request('test/current', {}).then((value) => {
    settled = true
    return value
  })
  await new Promise((resolve) => setImmediate(resolve))
  old.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: 'req_2', result: { owner: 'old' } })}\n`)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(settled, false)
  current.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: 'req_2', result: { owner: 'current' } })}\n`)
  assert.deepEqual(await request, { owner: 'current' })
  await client.stop()
})

test('stop waits for the runtime process to exit and closes its recording', async () => {
  const root = join(process.cwd(), 'packages', 'testkit', '.tmp')
  mkdirSync(root, { recursive: true })
  const dir = mkdtempSync(join(root, 'runtime-stop-'))
  try {
    const { client, processes } = runtimeHarness({ recordPath: join(dir, 'frames.jsonl') })
    await client.start()
    assert.ok(client.record)
    await client.stop()
    assert.equal(processes[0].exitCode, 0)
    assert.equal(client.child, null)
    assert.equal(client.record, null)
    assert.equal(client.state, 'exited')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

const CONTROL_DESCRIPTOR = Object.freeze({
  protocolVersion: 1,
  methods: Object.freeze([
    'session/turn.cancel', 'session/turn.steer', 'session/queue.enqueue', 'session/queue.list',
    'session/queue.cancel', 'session/draft.get', 'session/draft.put',
  ]),
  requestReplay: 'runtime-process',
  requestReplayLimit: 2048,
  queue: Object.freeze({ source: 'agent-inbox', target: 'next-turn', revision: 'session-seq' }),
  drafts: Object.freeze({ durability: 'runtime-process' }),
  eventAttribution: 'best-effort-runtime-process',
})

test('optional Runtime control capabilities are preserved only when explicit and valid', () => {
  assert.equal(parseControlCapabilities({ serverInfo: {} }), null)
  const parsed = parseControlCapabilities({ capabilities: { sessionControl: CONTROL_DESCRIPTOR } })
  assert.deepEqual(parsed, CONTROL_DESCRIPTOR)
  assert.equal(Object.isFrozen(parsed), true)
  assert.equal(Object.isFrozen(parsed.methods), true)
  for (const mutate of [
    (value) => { value.protocolVersion = 2 },
    (value) => { value.methods = ['session/query'] },
    (value) => { value.methods = ['session/queue.list', 'session/queue.list'] },
    (value) => { value.requestReplayLimit = 0 },
    (value) => { value.requestReplayLimit = 2049 },
    (value) => { value.queue.source = 'local' },
    (value) => { value.extra = true },
  ]) {
    const descriptor = structuredClone(CONTROL_DESCRIPTOR)
    mutate(descriptor)
    assert.throws(() => parseControlCapabilities({ capabilities: { sessionControl: descriptor } }), /invalid sessionControl/)
  }
})

test('control wrappers fail closed before the wire unless the current Runtime advertises the exact method', async () => {
  const { client } = clientWithWire()
  let calls = 0
  client.request = async () => { calls += 1; return { ok: true } }
  for (const invoke of [
    () => client.cancelTurn('s1', 'r1'),
    () => client.steerTurn('s1', 'r2', [], { turnId: 1 }),
    () => client.enqueue('s1', 'r3', []),
    () => client.listQueue('s1'),
    () => client.cancelQueued('s1', 'r4', 'q1'),
    () => client.getDraft('s1', 'd1'),
    () => client.putDraft('s1', 'd1', 'r5', 0, []),
  ]) {
    await assert.rejects(invoke(), (error) => error.code === 'CONTROL_UNSUPPORTED')
  }
  assert.equal(calls, 0)
  client.controlCapabilities = { ...CONTROL_DESCRIPTOR, methods: ['session/queue.list'] }
  await client.listQueue('s1')
  await assert.rejects(client.enqueue('s1', 'r3', []), (error) => error.code === 'CONTROL_UNSUPPORTED')
  assert.equal(calls, 1)
})

test('all seven client control wrappers forward exact additive methods and parameters', async () => {
  const { client } = clientWithWire()
  client.controlCapabilities = CONTROL_DESCRIPTOR
  const calls = []
  client.request = async (method, params) => { calls.push({ method, params }); return { ok: true } }
  const blocks = [{ type: 'text', text: 'instruction' }]

  await client.cancelTurn('s1', 'r1', { turnId: 4, reason: 'user' })
  await client.steerTurn('s1', 'r2', blocks, { turnId: 4 })
  await client.enqueue('s1', 'r3', blocks, { clientDraftId: 'd1' })
  await client.listQueue('s1')
  await client.cancelQueued('s1', 'r4', 'q1')
  await client.getDraft('s1', 'd1')
  await client.putDraft('s1', 'd1', 'r5', 2, blocks)

  assert.deepEqual(calls, [
    { method: 'session/turn.cancel', params: { sessionId: 's1', requestId: 'r1', turnId: 4, reason: 'user' } },
    { method: 'session/turn.steer', params: { sessionId: 's1', requestId: 'r2', turnId: 4, contentBlocks: blocks } },
    { method: 'session/queue.enqueue', params: { sessionId: 's1', requestId: 'r3', contentBlocks: blocks, clientDraftId: 'd1' } },
    { method: 'session/queue.list', params: { sessionId: 's1' } },
    { method: 'session/queue.cancel', params: { sessionId: 's1', requestId: 'r4', queuedItemId: 'q1' } },
    { method: 'session/draft.get', params: { sessionId: 's1', draftId: 'd1' } },
    { method: 'session/draft.put', params: { sessionId: 's1', draftId: 'd1', requestId: 'r5', expectedRevision: 2, contentBlocks: blocks } },
  ])
  assert.equal(calls.some(call => call.method === 'session/query' || call.method === 'session/prompt'), false)
})

test('control capabilities never survive a process generation or malformed handshake', async () => {
  const { client, processes } = runtimeHarness()
  await client.start()
  client.controlCapabilities = CONTROL_DESCRIPTOR
  processes[0].stdin.emit('error', new Error('EPIPE'))
  assert.equal(client.controlCapabilities, null)
  await client.start()
  assert.equal(client.controlCapabilities, null)

  const request = client.request.bind(client)
  client.request = async (method, params) => {
    assert.equal(method, 'initialize')
    assert.deepEqual(params, { cwd: client.options.cwd, provider: client.options.provider, model: client.options.model, approvalRequests: true })
    return { serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' }, capabilities: { sessionControl: CONTROL_DESCRIPTOR } }
  }
  assert.deepEqual(await client.initialize(), { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' })
  assert.deepEqual(client.controlCapabilities, CONTROL_DESCRIPTOR)

  client.request = async () => ({
    serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' },
    capabilities: { sessionControl: { ...CONTROL_DESCRIPTOR, protocolVersion: 2 } },
  })
  await assert.rejects(client.initialize(), /invalid sessionControl/)
  assert.equal(client.controlCapabilities, null)
  client.request = request
  await client.stop()
})

test('stop times out explicitly instead of claiming a still-running process was closed', async () => {
  const { client, processes } = runtimeHarness({ exitOnShutdown: false, stopTimeoutMs: 10 })
  await client.start()
  await assert.rejects(client.stop(), /did not exit within 10ms/)
  assert.equal(client.child, null)
  assert.equal(client.state, 'failed')
  assert.equal(client.record, null)
  assert.equal(processes[0].killed, true)
})

test('recording is opt-in, redacted and size-limited', () => {
  const root = join(process.cwd(), 'packages', 'testkit', '.tmp')
  mkdirSync(root, { recursive: true })
  const dir = mkdtempSync(join(root, 'runtime-client-'))
  const path = join(dir, 'frames.jsonl')
  try {
    const { client } = clientWithWire()
    client.recordFrame('in', { method: 'test', params: { secret: 'not-for-disk' } })
    assert.deepEqual(readdirSync(dir), [])

    const recording = clientWithWire({ recordPath: path, recordMaxBytes: 220 })
    recording.client.openRecord(path)
    recording.client.recordFrame('in', { method: 'test', params: { secret: 'not-for-disk' } })
    for (let index = 0; index < 4; index += 1) {
      recording.client.recordFrame('out', { method: 'test', params: { text: `row-${index}` } })
    }
    recording.client.closeRecord()

    const files = readdirSync(dir)
    assert.ok(files.length > 1, 'small record limit should rotate the file')
    const recorded = files.map((name) => readFileSync(join(dir, name), 'utf8')).join('')
    assert.equal(recorded.includes('not-for-disk'), false)
    assert.ok(recorded.includes('[REDACTED]'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
