import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStudioBridge, mcpServerRecords, skillRecords } from '../../../apps/desktop/src/studio-bridge.js'

const CWD = '/mnt/f/projects/dsh-studio'

function harness(resume = async () => {}, controls = false) {
  const events = []
  const queries = []
  const calls = []
  const runtime = {
    state: 'ready',
    options: { cwd: CWD },
    resume,
    query: async (sessionId, text) => { queries.push({ sessionId, text }); return { messageId: 'm1' } },
    ...(controls ? {
      controlCapabilities: CONTROL_DESCRIPTOR,
      steerTurn: async (...args) => { calls.push(['steer', ...args]); return { status: 'accepted', effectiveTurnId: args[3].turnId } },
      enqueue: async (...args) => { calls.push(['enqueue', ...args]); return { status: 'accepted', queuedItemId: 'q-new', position: 2, revision: 12, target: 'next-turn', state: 'admitted' } },
      cancelTurn: async (...args) => { calls.push(['cancel', ...args]); return { status: 'accepted', state: 'cancelling' } },
      listQueue: async (...args) => { calls.push(['list', ...args]); return { sessionId: args[0], revision: 12, source: 'agent-inbox', target: 'next-turn', items: [{ queuedItemId: 'q-new', position: 2, contentBlocks: [{ type: 'text', text: 'queued' }, { type: 'image', data: 'AA==', mimeType: 'image/png' }] }] } },
      cancelQueued: async (...args) => { calls.push(['queue.cancel', ...args]); return { status: 'cancelled', revision: 13 } },
      getDraft: async (...args) => { calls.push(['draft.get', ...args]); return { revision: 0, contentBlocks: [], savedAt: null } },
      putDraft: async (...args) => { calls.push(['draft.put', ...args]); return { revision: 1, contentBlocks: args[4], savedAt: '2026-11-25T00:00:00.000Z' } },
    } : {}),
  }
  const bridge = createStudioBridge({ runtime, cwd: CWD, emit: (event) => events.push(event) })
  return { bridge, events, queries, calls }
}

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

function receiptFor(events, requestId) {
  return events.find((event) => event.kind === 'command.receipt' && event.receipt?.requestId === requestId)?.receipt
}

test('session.resume fails without switching the active session or claiming completion', async () => {
  const { bridge, events } = harness(async () => { throw new Error('already owned by another process') })
  const contextId = bridge.openContext({ sessionId: 'current-1' })

  bridge.command({ requestId: 'resume-1', commandName: 'session.resume', input: { threadId: 'history-1' } }, contextId)
  await new Promise((resolve) => setImmediate(resolve))

  const receipt = receiptFor(events, 'resume-1')
  assert.equal(receipt.status, 'failed')
  assert.equal(receipt.error.code, 'UNAVAILABLE')
  assert.match(receipt.error.message, /already owned/)
  assert.equal(bridge.snapshot(undefined, contextId).sessionId, 'current-1')
  assert.equal(events.some((event) => event.kind === 'snapshot' && event.snapshot?.sessionId === 'history-1'), false)
})

test('session.resume switches context only after the runtime accepts it', async () => {
  const { bridge, events } = harness()
  const contextId = bridge.openContext({ sessionId: 'current-1' })

  bridge.command({ requestId: 'resume-2', commandName: 'session.resume', input: { threadId: 'history-2' } }, contextId)
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(receiptFor(events, 'resume-2').status, 'completed')
  assert.equal(bridge.snapshot(undefined, contextId).sessionId, 'history-2')
})

test('a delayed resume cannot rebind a context after the user switches sessions', async () => {
  let finishResume
  const pendingResume = new Promise((resolve) => { finishResume = resolve })
  const { bridge, events } = harness(async () => pendingResume)
  const contextId = bridge.openContext({ sessionId: 'current-1' })
  bridge.command({ requestId: 'slow-resume', commandName: 'session.resume', input: { threadId: 'history-1' } }, contextId)
  await new Promise((resolve) => setImmediate(resolve))
  bridge.command({ requestId: 'new-session', commandName: 'session.create' }, contextId)
  await new Promise((resolve) => setImmediate(resolve))
  const selected = bridge.snapshot(undefined, contextId).sessionId

  finishResume()
  await new Promise((resolve) => setImmediate(resolve))
  const receipt = receiptFor(events, 'slow-resume')
  assert.equal(receipt.status, 'failed')
  assert.equal(receipt.error.code, 'FAILED_PRECONDITION')
  assert.equal(bridge.snapshot(undefined, contextId).sessionId, selected)
  assert.equal(selected.startsWith('omp-'), true)
})

test('missing or unknown approval decisions never default to allowed-once', async () => {
  const { bridge, events } = harness()
  const contextId = bridge.openContext({ sessionId: 'current-1' })
  const responses = []
  bridge.onApprovalRequest({
    requestId: 'server-approval', params: { sessionId: 'current-1' },
    respond: (result) => responses.push(result),
  })
  const interaction = events.find((event) => event.kind === 'interaction.required').interaction

  for (const [index, decision] of [undefined, 'allow', 'ALWAYS_ALLOW'].entries()) {
    bridge.command({
      requestId: `bad-decision-${index}`, commandName: 'interaction.respond',
      input: { interactionId: interaction.interactionId, leaseGeneration: 1, ...(decision === undefined ? {} : { decision }) },
    }, contextId)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(receiptFor(events, `bad-decision-${index}`).error.code, 'INVALID_ARGUMENT')
  }
  assert.deepEqual(responses, [])

  bridge.command({
    requestId: 'valid-decision', commandName: 'interaction.respond',
    input: { interactionId: interaction.interactionId, leaseGeneration: 1, decision: 'submit', value: true },
  }, contextId)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(responses, [{ outcome: 'allowed-once' }])
})

test('switching sessions cancels approvals owned only by the old session', async () => {
  const { bridge, events } = harness()
  const contextId = bridge.openContext({ sessionId: 'current-1' })
  const responses = []
  bridge.onApprovalRequest({
    requestId: 'server-approval', params: { sessionId: 'current-1' },
    respond: (result) => responses.push(result),
  })

  bridge.command({ requestId: 'switch-1', commandName: 'session.resume', input: { threadId: 'history-1' } }, contextId)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(receiptFor(events, 'switch-1').status, 'completed')
  assert.deepEqual(responses, [{ outcome: 'cancelled' }])
  assert.equal(bridge.snapshot(undefined, contextId).sessionId, 'history-1')
})

test('model adaptation fails explicitly when the runtime has no adaptation layer', async () => {
  const { bridge, queries } = harness()
  const contextId = bridge.openContext({ sessionId: 'current-1' })
  await assert.rejects(bridge.query('models.adaptation.resolve', { model: 'missing' }, contextId), (error) => {
    assert.equal(error.code, 'CAPABILITY_UNAVAILABLE')
    assert.match(error.message, /没有模型适配层/)
    return true
  })
  assert.deepEqual(queries, [])
})

test('steer and runtime queue reads fail explicitly without sending a prompt', async () => {
  const { bridge, events, queries } = harness()
  const contextId = bridge.openContext({ sessionId: 'current-1' })

  bridge.command({ requestId: 'steer-1', commandName: 'core.steer', input: { text: 'change direction' } }, contextId)
  bridge.command({ requestId: 'queue-1', commandName: 'session.queue.list', input: { sessionId: 'current-1' } }, contextId)
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(queries, [])
  for (const requestId of ['steer-1', 'queue-1']) {
    const receipt = receiptFor(events, requestId)
    assert.equal(receipt.status, 'failed')
    assert.equal(receipt.error.code, 'CAPABILITY_UNAVAILABLE')
  }
})

test('capability manifest marks steer and runtime queue reads unavailable', async () => {
  const { bridge } = harness()
  const contextId = bridge.openContext({ sessionId: 'current-1' })
  const model = await bridge.query('capabilities.get', {}, contextId)
  const grades = new Map(model.capabilities.map((row) => [row.id, row.grade]))
  assert.equal(grades.get('core.steer'), 'unavailable')
  assert.equal(grades.get('session.queue.list'), 'unavailable')
  assert.equal(grades.get('core.followUp'), 'limited')
  assert.equal(grades.get('queue.enqueue'), 'unavailable')
  assert.equal(grades.get('session.skills.list'), 'unavailable')
})

test('runtime skill identities fail explicitly instead of recycling disk discovery', async () => {
  const { bridge, events } = harness()
  const contextId = bridge.openContext({ sessionId: 'current-1' })

  bridge.command({ requestId: 'skills-1', commandName: 'session.skills.list', input: { sessionId: 'current-1' } }, contextId)
  await new Promise((resolve) => setImmediate(resolve))

  const receipt = receiptFor(events, 'skills-1')
  assert.equal(receipt.status, 'failed')
  assert.equal(receipt.error.code, 'CAPABILITY_UNAVAILABLE')
  assert.match(receipt.error.message, /磁盘发现的技能不等于已加载/)
  assert.equal('result' in receipt, false)
})

test('skill discovery projects user-invocable without inventing runtime state', () => {
  const rows = skillRecords([
    { name: 'review', description: 'Review changes', scope: 'workspace', label: 'project' },
    { name: 'hidden', description: 'Hidden', scope: 'workspace', label: 'project', userInvocable: false },
  ])
  assert.deepEqual(rows.map(({ name, enabled, hide }) => ({ name, enabled, hide })), [
    { name: 'review', enabled: true, hide: false },
    { name: 'hidden', enabled: false, hide: true },
  ])
  for (const row of rows) {
    assert.equal('loaded' in row, false)
    assert.equal('session' in row, false)
  }
})

test('MCP configured state never claims a live connection', () => {
  const model = mcpServerRecords({
    configured: true,
    clientMounted: true,
    servers: [{ name: 'local', transport: 'stdio', enabled: true }],
  })
  assert.equal(model.servers[0].status, 'enabled')
  assert.equal('connected' in model.servers[0], false)
  assert.match(model.warnings.join('\n'), /不代表已连接/)
})

test('MCP unknown transport and an unmounted client fail closed', () => {
  const unknown = mcpServerRecords({
    configured: true,
    clientMounted: true,
    servers: [{ name: 'unknown', transport: 'unknown', enabled: true }],
  })
  assert.deepEqual(unknown.servers, [])
  assert.match(unknown.unavailableReason, /transport/)

  const unmounted = mcpServerRecords({
    configured: true,
    clientMounted: false,
    servers: [{ name: 'local', transport: 'stdio', enabled: true }],
  })
  assert.equal(unmounted.servers[0].enabled, false)
  assert.equal(unmounted.servers[0].status, 'disabled')
})

const EXTERNAL_CONTRACT = {
  dictation: ['dictation.inspect', 'dictation.open', 'dictation.status', 'dictation.prepare', 'dictation.start', 'dictation.stop', 'dictation.cancel'],
  evaluations: ['evaluations.exportChunk', 'evaluations.retrySpec', 'evaluations.patch', 'evaluations.context', 'evaluations.list', 'evaluations.read', 'evaluations.rows', 'evaluations.openWorkspace', 'evaluations.prepare', 'evaluations.start', 'evaluations.control', 'evaluations.export', 'evaluations.respond'],
  benchmarks: ['benchmarks.accounts.read', 'benchmarks.list', 'benchmarks.start', 'benchmarks.read', 'benchmarks.cancel', 'benchmarks.close'],
  mcp: ['mcp.logs.get', 'mcp.refresh', 'mcp.setEnabled', 'mcp.setInstructions', 'mcp.test'],
  agent: ['agent.send', 'agent.kill', 'agent.revive'],
}
const EXTERNAL_NAMES = Object.values(EXTERNAL_CONTRACT).flat()
const EXTERNAL_REASON = {
  dictation: /云听写.*未接入/,
  evaluations: /评测与基准测试.*不返回模拟分数/,
  benchmarks: /评测与基准测试.*不返回模拟分数/,
  mcp: /MCP 运行时控制.*不测试/,
  agent: /send\/kill\/revive.*不发送控制指令/,
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

test('E-05 contract covers every dictation, evaluation, benchmark, MCP and Agent control entry exactly once', () => {
  assert.equal(EXTERNAL_NAMES.length, 34)
  assert.equal(new Set(EXTERNAL_NAMES).size, EXTERNAL_NAMES.length)
})

test('E-05 queries fail before Runtime or network access and never return successful empty data', async () => {
  const { bridge, queries } = harness()
  const contextId = bridge.openContext({ sessionId: 'current-1' })
  const originalFetch = globalThis.fetch
  let fetches = 0
  globalThis.fetch = async () => { fetches += 1; throw new Error('network access forbidden') }
  try {
    for (const [group, names] of Object.entries(EXTERNAL_CONTRACT)) {
      for (const name of names) {
        await assert.rejects(bridge.query(name, {}, contextId), (error) => {
          assert.equal(error.code, 'CAPABILITY_UNAVAILABLE')
          assert.match(error.message, EXTERNAL_REASON[group])
          return true
        })
      }
    }
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.deepEqual(queries, [])
  assert.equal(fetches, 0)
})

test('E-05 commands return failed receipts without results, prompt fallback, input mutation or external access', async () => {
  const { bridge, events, queries } = harness()
  const contextId = bridge.openContext({ sessionId: 'current-1' })
  const originalFetch = globalThis.fetch
  let fetches = 0
  globalThis.fetch = async () => { fetches += 1; throw new Error('network access forbidden') }
  try {
    for (const [group, names] of Object.entries(EXTERNAL_CONTRACT)) {
      for (const [index, name] of names.entries()) {
        const requestId = `external-${group}-${index}`
        const input = deepFreeze({
          text: 'must not become a prompt',
          spec: { provider: 'paid-provider', judge: 'paid-judge' },
          url: 'https://external.invalid/mcp',
          headers: { authorization: 'must-not-be-used' },
        })
        const before = JSON.stringify(input)
        bridge.command({ requestId, commandName: name, input }, contextId)
        await new Promise((resolve) => setImmediate(resolve))
        const receipt = receiptFor(events, requestId)
        assert.equal(receipt.status, 'failed', name)
        assert.equal(receipt.error.code, 'CAPABILITY_UNAVAILABLE', name)
        assert.match(receipt.error.message, EXTERNAL_REASON[group], name)
        assert.equal('result' in receipt, false, name)
        assert.equal(JSON.stringify(input), before, name)
      }
    }
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.deepEqual(queries, [])
  assert.equal(fetches, 0)
  assert.equal(events.some((event) => event.kind === 'snapshot'), false)
})

test('E-05 capability manifest never advertises an unimplemented external adapter as available', async () => {
  const { bridge, queries } = harness()
  const contextId = bridge.openContext({ sessionId: 'current-1' })
  const model = await bridge.query('capabilities.get', {}, contextId)
  const grades = new Map(model.capabilities.map((row) => [row.id, row.grade]))
  for (const name of EXTERNAL_NAMES) assert.equal(grades.get(name), 'unavailable', name)
  assert.equal(model.capabilities.filter((row) => EXTERNAL_NAMES.includes(row.id)).length, EXTERNAL_NAMES.length)
  assert.deepEqual(queries, [])
})

test('local drafts persist across bridge recreation without claiming Runtime queueing', async () => {
  let persisted = null
  const events = []
  const draftStore = {
    async load() { return persisted },
    async save(value) { persisted = value },
  }
  const makeBridge = () => createStudioBridge({
    runtime: { state: 'ready', options: { cwd: CWD }, resume: async () => {} },
    cwd: CWD, emit: (event) => events.push(event), host: { draftStore },
  })
  const first = makeBridge()
  const firstContext = first.openContext({ sessionId: 'draft-session' })
  first.command({
    requestId: 'local-put', commandName: 'session.draft.put',
    input: { draftId: 'composer', expectedRevision: 0, text: '未提交草稿' },
  }, firstContext)
  await new Promise((resolve) => setImmediate(resolve))

  const second = makeBridge()
  const secondContext = second.openContext({ sessionId: 'draft-session' })
  const restored = await second.query('session.state', {}, secondContext)
  assert.equal(restored.sessionId, 'draft-session')
  second.command({ requestId: 'local-get', commandName: 'session.draft.get', input: { draftId: 'composer' } }, secondContext)
  second.command({
    requestId: 'local-conflict', commandName: 'session.draft.put',
    input: { draftId: 'composer', expectedRevision: 0, text: '不能覆盖' },
  }, secondContext)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(persisted.includes('未提交草稿'), true)
  assert.equal(persisted.includes('不能覆盖'), false)
  assert.equal(receiptFor(events, 'local-put').result.source, 'local')
  assert.equal(receiptFor(events, 'local-put').result.runtimeQueued, false)
  assert.deepEqual(receiptFor(events, 'local-get').result.contentBlocks, [{ type: 'text', text: '未提交草稿' }])
  assert.equal(receiptFor(events, 'local-get').result.revision, 1)
  assert.equal(receiptFor(events, 'local-conflict').status, 'failed')
  assert.equal(receiptFor(events, 'local-conflict').error.code, 'CONFLICT')
  assert.equal(receiptFor(events, 'local-conflict').error.details.currentRevision, 1)
})

test('a Runtime draft conflict is never rewritten as a successful local write', async () => {
  const events = []
  let persisted = null
  const runtime = {
    state: 'ready', options: { cwd: CWD }, controlCapabilities: CONTROL_DESCRIPTOR,
    resume: async () => {},
    putDraft: async () => {
      const error = new Error('draft revision changed')
      error.data = { code: 'CONFLICT', details: { currentRevision: 7 } }
      throw error
    },
  }
  const bridge = createStudioBridge({
    runtime, cwd: CWD, emit: (event) => events.push(event),
    host: { draftStore: { async load() { return persisted }, async save(value) { persisted = value } } },
  })
  const contextId = bridge.openContext({ sessionId: 'draft-conflict' })
  bridge.command({
    requestId: 'runtime-conflict', commandName: 'session.draft.put',
    input: { draftId: 'composer', expectedRevision: 6, text: 'must not be saved locally' },
  }, contextId)
  await new Promise((resolve) => setImmediate(resolve))

  const receipt = receiptFor(events, 'runtime-conflict')
  assert.equal(receipt.status, 'failed')
  assert.equal(receipt.error.code, 'CONFLICT')
  assert.equal(receipt.error.details.currentRevision, 7)
  assert.equal(persisted, null)
})

test('an unknown Runtime draft write outcome is not duplicated into local storage', async () => {
  const events = []
  let persisted = null
  const runtime = {
    state: 'ready', options: { cwd: CWD }, controlCapabilities: CONTROL_DESCRIPTOR,
    resume: async () => {}, putDraft: async () => { throw new Error('request timed out after 100ms') },
  }
  const bridge = createStudioBridge({
    runtime, cwd: CWD, emit: (event) => events.push(event),
    host: { draftStore: { async load() { return persisted }, async save(value) { persisted = value } } },
  })
  const contextId = bridge.openContext({ sessionId: 'draft-unknown' })
  bridge.command({
    requestId: 'runtime-unknown', commandName: 'session.draft.put',
    input: { draftId: 'composer', expectedRevision: 0, text: 'outcome unknown' },
  }, contextId)
  await new Promise((resolve) => setImmediate(resolve))

  const receipt = receiptFor(events, 'runtime-unknown')
  assert.equal(receipt.status, 'failed')
  assert.equal(receipt.error.code, 'INTERNAL')
  assert.equal(persisted, null)
})

test('legacy Runtime rejects every new control command without a prompt fallback', async () => {
  const { bridge, events, queries, calls } = harness()
  const contextId = bridge.openContext({ sessionId: 'current-1' })
  bridge.onSessionEvent({ sessionId: 'current-1', event: { seq: 100, type: 'turn/start', time: Date.now(), data: { turn: 3 } } })
  const commands = [
    ['core.steer', { text: 'steer' }],
    ['queue.enqueue', { text: 'queue' }],
    ['core.abort', {}],
    ['session.queue.list', {}],
    ['session.queue.cancel', { queuedItemId: 'q1' }],
    ['session.draft.get', { draftId: 'd1' }],
    ['session.draft.put', { draftId: 'd1', expectedRevision: 0, contentBlocks: [] }],
  ]
  for (const [index, [commandName, input]] of commands.entries()) {
    bridge.command({ requestId: `legacy-${index}`, commandName, input }, contextId)
  }
  await new Promise((resolve) => setImmediate(resolve))
  for (const index of commands.keys()) {
    const receipt = receiptFor(events, `legacy-${index}`)
    assert.equal(receipt.status, 'failed')
    assert.equal(receipt.error.code, 'CAPABILITY_UNAVAILABLE')
    assert.equal('result' in receipt, false)
  }
  assert.deepEqual(queries, [])
  assert.deepEqual(calls, [])
})

test('declared Runtime controls use exact additive methods and never masquerade as prompts', async () => {
  const { bridge, events, queries, calls } = harness(undefined, true)
  const contextId = bridge.openContext({ sessionId: 'current-1' })
  bridge.onSessionEvent({ sessionId: 'current-1', event: { seq: 100, type: 'turn/start', time: Date.now(), data: { turn: 3 } } })
  const blocks = [{ type: 'text', text: 'native instruction' }]
  const commands = [
    ['core.steer', { text: 'native instruction' }],
    ['queue.enqueue', { text: 'native instruction', clientDraftId: 'd1' }],
    ['core.abort', {}],
    ['session.queue.list', {}],
    ['session.queue.cancel', { queuedItemId: 'q-new' }],
    ['session.draft.get', { draftId: 'd1' }],
    ['session.draft.put', { draftId: 'd1', expectedRevision: 0, contentBlocks: blocks }],
  ]
  for (const [index, [commandName, input]] of commands.entries()) {
    bridge.command({ requestId: `native-${index}`, commandName, input }, contextId)
  }
  await new Promise((resolve) => setImmediate(resolve))

  for (const index of commands.keys()) assert.equal(receiptFor(events, `native-${index}`).status, 'completed')
  assert.deepEqual(calls, [
    ['steer', 'current-1', 'native-0', blocks, { turnId: 3 }],
    ['enqueue', 'current-1', 'native-1', blocks, { clientDraftId: 'd1' }],
    ['cancel', 'current-1', 'native-2', { turnId: undefined, reason: undefined }],
    ['list', 'current-1'],
    ['queue.cancel', 'current-1', 'native-4', 'q-new'],
    ['draft.get', 'current-1', 'd1'],
    ['draft.put', 'current-1', 'd1', 'native-6', 0, blocks],
  ])
  assert.deepEqual(queries, [])
  const queue = receiptFor(events, 'native-3').result.result
  assert.equal(queue.source, 'agent-inbox')
  assert.equal(queue.target, 'next-turn')
  assert.equal(queue.revision, 12)
  assert.deepEqual(queue.items.map(({ id, text, imageCount, state }) => ({ id, text, imageCount, state })), [
    { id: 'q-new', text: 'queued[image]', imageCount: 1, state: 'pending' },
  ])
  const model = await bridge.query('capabilities.get', {}, contextId)
  const grades = new Map(model.capabilities.map((row) => [row.id, row.grade]))
  for (const name of ['core.steer', 'core.abort', 'queue.enqueue', 'session.queue.list', 'session.queue.cancel', 'session.queue.remove', 'session.draft.get', 'session.draft.put']) {
    assert.equal(grades.get(name), 'stable', name)
  }
})

test('a control context cannot operate on a session owned by another view', async () => {
  const { bridge, events, calls } = harness(undefined, true)
  const owner = bridge.openContext({ sessionId: 'owned' })
  const other = bridge.openContext({ sessionId: 'other' })
  bridge.command({
    requestId: 'cross-session', commandName: 'queue.enqueue',
    input: { sessionId: 'owned', text: 'must not cross the lease' },
  }, other)
  await new Promise((resolve) => setImmediate(resolve))

  const receipt = receiptFor(events, 'cross-session')
  assert.equal(receipt.status, 'failed')
  assert.equal(receipt.error.code, 'PERMISSION_DENIED')
  assert.deepEqual(calls, [])
  assert.equal(bridge.snapshot(undefined, owner).sessionId, 'owned')
  assert.equal(bridge.snapshot(undefined, other).sessionId, 'other')
})

test('queue cancellation reports already-sent as a completed non-removal outcome', async () => {
  const events = []
  const runtime = {
    state: 'ready', options: { cwd: CWD }, controlCapabilities: CONTROL_DESCRIPTOR,
    resume: async () => {}, cancelQueued: async () => ({ status: 'already-sent', revision: 13 }),
  }
  const bridge = createStudioBridge({ runtime, cwd: CWD, emit: (event) => events.push(event) })
  const contextId = bridge.openContext({ sessionId: 'current-1' })
  bridge.command({ requestId: 'sent-queue', commandName: 'session.queue.remove', input: { queuedItemId: 'q1' } }, contextId)
  await new Promise((resolve) => setImmediate(resolve))

  const receipt = receiptFor(events, 'sent-queue')
  assert.equal(receipt.status, 'completed')
  assert.deepEqual(receipt.result, { removed: false, status: 'already-sent', revision: 13 })
})

test('native continuity uncertainty is visible and projection sequence is not Runtime event.seq', () => {
  const { bridge, events } = harness()
  const contextId = bridge.openContext({ sessionId: 'continuity' })
  bridge.onSessionEvent({
    sessionId: 'continuity',
    event: { seq: 42, type: 'user/message', time: Date.now(), data: { id: 'u42', source: { kind: 'user' }, content: [{ type: 'text', text: 'native' }] } },
  })

  const notices = events.filter((event) => event.update?.source === 'CONTINUITY_UNKNOWN')
  assert.equal(notices.length, 1)
  assert.match(notices[0].update.message, /42/)
  const message = events.find((event) => event.update?.messageId === 'u42')
  assert.equal(message.streamSeq, 2)
  assert.equal(message.runtimeEventSeq, 42)
  assert.equal('eventSeq' in message, false)
  assert.equal('runtimeEventSeq' in notices[0], false)
  assert.equal(bridge.snapshot(undefined, contextId).sessionId, 'continuity')
})

test('native sequence zero is routed and retained without becoming a projection sequence', () => {
  const { bridge, events } = harness()
  bridge.openContext({ sessionId: 'native-zero' })
  bridge.onSessionEvent({
    sessionId: 'native-zero',
    event: { seq: 0, type: 'user/message', time: Date.now(), data: { id: 'u0', source: { kind: 'user' }, content: [{ type: 'text', text: 'first' }] } },
  })
  bridge.onSessionEvent({
    sessionId: 'native-zero',
    event: { seq: 1, type: 'user/message', time: Date.now(), data: { id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: 'second' }] } },
  })
  const messages = events.filter((event) => event.update?.messageId === 'u0' || event.update?.messageId === 'u1')
  assert.deepEqual(messages.map((event) => event.update.messageId), ['u0', 'u1'])
  assert.deepEqual(messages.map((event) => event.runtimeEventSeq), [0, 1])
  assert.deepEqual(messages.map((event) => event.streamSeq), [1, 2])
  assert.equal(messages.some((event) => 'eventSeq' in event), false)
})

test('conversation.open replays only projection events after the reconnect watermark', async () => {
  const { bridge } = harness()
  const first = bridge.openContext({ sessionId: 'reconnect' })
  const event = (id) => bridge.onSessionEvent({
    sessionId: 'reconnect',
    event: { seq: Number(id.slice(1)) - 1, type: 'user/message', time: Date.now(), data: { id, source: { kind: 'user' }, content: [{ type: 'text', text: id }] } },
  })
  event('u1')
  event('u2')
  bridge.closeContext(first)
  event('u3')
  const second = bridge.openContext({ sessionId: 'reconnect' })

  const caughtUp = await bridge.query('conversation.open', {
    target: { kind: 'session', sessionId: 'reconnect' }, afterStreamSeq: 2,
  }, second)
  assert.equal(caughtUp.live.watermark, 3)
  assert.deepEqual(caughtUp.live.events.map((item) => item.streamSeq), [3])
  assert.equal(caughtUp.live.events[0].update.messageId, 'u3')

  const duplicateFree = await bridge.query('conversation.open', {
    target: { kind: 'session', sessionId: 'reconnect' }, afterStreamSeq: 3,
  }, second)
  assert.deepEqual(duplicateFree.live.events, [])

  const initial = await bridge.query('conversation.open', {
    target: { kind: 'session', sessionId: 'reconnect' },
  }, second)
  assert.deepEqual(initial.live.events, [])
})

test('conversation.open bounds the reconnect journal and exposes eviction as a sequence gap', async () => {
  const { bridge } = harness()
  const contextId = bridge.openContext({ sessionId: 'bounded-reconnect' })
  for (let seq = 0; seq < 515; seq += 1) {
    bridge.onSessionEvent({
      sessionId: 'bounded-reconnect',
      event: { seq, type: 'turn/start', time: Date.now(), data: { turn: seq + 1 } },
    })
  }
  const opened = await bridge.query('conversation.open', {
    target: { kind: 'session', sessionId: 'bounded-reconnect' }, afterStreamSeq: 1,
  }, contextId)
  assert.equal(opened.live.watermark, 515)
  assert.equal(opened.live.events.length, 512)
  assert.equal(opened.live.events[0].streamSeq, 4)
  assert.equal(opened.live.events.at(-1).streamSeq, 515)
})

test('event-router overflow is surfaced as an error instead of silently dropping input', () => {
  const { bridge, events } = harness()
  bridge.openContext({ sessionId: 'overflow' })
  const event = (seq) => bridge.onSessionEvent({
    sessionId: 'overflow', event: { seq, type: 'turn/start', time: Date.now(), data: { turn: 1 } },
  })
  event(100)
  for (let seq = 102; seq <= 229; seq += 1) event(seq)
  event(230)

  const notices = events.filter((event) => event.update?.source === 'EVENT_BUFFER_OVERFLOW')
  assert.equal(notices.length, 1)
  assert.equal(notices[0].update.level, 'error')
  assert.match(notices[0].update.message, /缓冲上限/)
})

test('native event gaps buffer later input and flush in sequence before controls resume', async () => {
  const { bridge, events, calls } = harness(undefined, true)
  const contextId = bridge.openContext({ sessionId: 'current-1' })
  const event = (seq, type, data) => bridge.onSessionEvent({ sessionId: 'current-1', event: { seq, type, time: Date.now(), data } })
  event(100, 'turn/start', { turn: 3 })
  assert.equal(bridge.snapshot(undefined, contextId).activeTurnId, 3)
  event(102, 'user/message', { id: 'u102', source: { kind: 'user' }, content: [{ type: 'text', text: 'second' }] })
  event(101, 'user/message', { id: 'u101', source: { kind: 'user' }, content: [{ type: 'text', text: 'first' }] })
  assert.deepEqual(events.filter(item => item.kind === 'conversation.changed' && item.update.kind === 'conversation.message.completed').map(item => item.update.messageId), ['u101', 'u102'])
  assert.equal(events.some(item => item.kind === 'conversation.changed' && item.update.kind === 'conversation.notice' && item.update.source === 'SEQUENCE_GAP'), true)
  event(103, 'user/message', { id: 'u103', source: { kind: 'user' }, content: [{ type: 'text', text: 'third' }] })
  assert.deepEqual(events.filter(item => item.kind === 'conversation.changed' && item.update.kind === 'conversation.message.completed').map(item => item.update.messageId), ['u101', 'u102', 'u103'])

  bridge.command({ requestId: 'steer-after-gap', commandName: 'core.steer', input: { text: 'continue' } }, contextId)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(receiptFor(events, 'steer-after-gap').status, 'completed')
  assert.equal(calls[0][0], 'steer')
  assert.equal(calls[0][4].turnId, 3)

  event(104, 'turn/end', { turn: 3, reason: { kind: 'cancelled' } })
  assert.equal('activeTurnId' in bridge.snapshot(undefined, contextId), false)
  bridge.command({ requestId: 'steer-after-end', commandName: 'core.steer', input: { text: 'too late' } }, contextId)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(receiptFor(events, 'steer-after-end').error.code, 'INVALID_STATE')
  assert.equal(calls.length, 1)
})

test('bridge event leases isolate sessions and fan out only to current views', async () => {
  const { bridge, events } = harness()
  const first = bridge.openContext({ sessionId: 's1' })
  const second = bridge.openContext({ sessionId: 's1' })
  const other = bridge.openContext({ sessionId: 's2' })
  bridge.onSessionEvent({ sessionId: 's1', event: { seq: 50, type: 'turn/start', time: Date.now(), data: { turn: 1 } } })
  bridge.onSessionEvent({ sessionId: 's2', event: { seq: 7, type: 'turn/start', time: Date.now(), data: { turn: 1 } } })
  assert.equal(events.filter(item => item.kind === 'conversation.changed' && item.update.kind === 'conversation.turn.started' && item.sessionId === 's1').length, 2)
  assert.equal(events.filter(item => item.kind === 'conversation.changed' && item.update.kind === 'conversation.turn.started' && item.sessionId === 's2').length, 1)

  bridge.closeContext(first)
  const before = events.length
  bridge.onSessionEvent({ sessionId: 's1', event: { seq: 51, type: 'turn/end', time: Date.now(), data: { turn: 1 } } })
  const added = events.slice(before)
  assert.equal(added.some(item => item.sessionId === 's1'), true)
  assert.equal(added.every(item => item.contextId !== first), true)
  assert.equal(added.some(item => item.sessionId === 's2'), false)
  assert.equal(bridge.snapshot(undefined, other).sessionId, 's2')
})
