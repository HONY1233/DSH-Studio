import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { RequestMethod } from '@dsh-studio/contract'
import { RuntimeClient } from '@dsh-studio/runtime-client'

const E2E = process.env.DSH_XG1_E2E === '1'

async function waitFor(predicate, message, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = predicate()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(`timed out: ${message}`)
}

function text(value) {
  return [{ type: 'text', text: value }]
}

function turnOf(events, sessionId) {
  const start = events.find(value => value.sessionId === sessionId && value.event.type === 'turn/start')
  assert.ok(start, `missing turn/start for ${sessionId}`)
  return start.event.data.turn
}

function assertContiguous(events, sessionId) {
  const sequences = events.filter(value => value.sessionId === sessionId).map(value => value.event.seq)
  assert.deepEqual(sequences, [...new Set(sequences)].sort((a, b) => a - b))
  assert.deepEqual(sequences, Array.from({ length: sequences.length }, (_, index) => index),
    `non-contiguous native event sequence for ${sessionId}`)
}

test('built Runtime serves additive controls through the real Studio stdio client', { skip: !E2E, timeout: 180_000 }, async (t) => {
  const runtimeRoot = process.env.DSH_XG1_RUNTIME_ROOT ?? '/home/qtt199/projects/deepseek-harness'
  const runtimeBin = join(runtimeRoot, 'apps/cli/lib/bin.js')
  assert.ok(existsSync(runtimeBin), `build Runtime artifacts first: ${runtimeBin}`)
  const { startMockLlmServer } = await import(pathToFileURL(
    join(runtimeRoot, 'packages/test-support/llm-mock-server/src/index.ts'),
  ).href)
  const home = mkdtempSync(join(tmpdir(), 'dsh-studio-xg1-e2e-'))
  const approvalMarker = join(tmpdir(), `dsh-xg1-approval-${basename(home)}`)
  const mock = await startMockLlmServer({
    sequence: ['stall', 'stall', 'tool_call_success', 'tool_call_success', 'success', 'success'],
    toolName: 'bash',
    // Request the exact wider mode that performs this one outside-workspace write.
    // Ordinary commands do not prompt merely because the approval policy is ask.
    toolArguments: JSON.stringify({
      command: `printf xg1-approved > ${approvalMarker}`,
      description: 'XG1 approval routing fixture',
      sandbox_permissions: 'danger-full-access',
      justification: 'Write the isolated XG1 approval marker outside the session workspace',
    }),
    successText: 'mock turn complete',
  })
  const notifications = []
  const serverRequests = []
  const stderr = []
  const previous = {
    DSH_HOME: process.env.DSH_HOME,
    DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    DSH_TELEMETRY_DISABLED: process.env.DSH_TELEMETRY_DISABLED,
  }
  process.env.DSH_HOME = home
  process.env.DEEPSEEK_BASE_URL = mock.baseURL
  process.env.DEEPSEEK_API_KEY = 'xg1-local-mock-key'
  process.env.DSH_TELEMETRY_DISABLED = '1'
  const recordPath = process.env.DSH_XG1_WIRE_PATH ?? join(home, 'wire.jsonl')
  const client = new RuntimeClient({
    command: `node ${runtimeBin}`,
    cwd: home,
    model: 'deepseek-v4-flash',
    recordPath,
    requestTimeoutMs: 30_000,
    serverRequestTimeoutMs: 60_000,
    spawnProcess: (_executable, args) => spawn('bash', ['-lc', args.at(-1)], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    }),
  })
  client.on('notification', value => {
    if (value.method === 'session.event') notifications.push(value.params)
  })
  client.on('request', value => serverRequests.push(value))
  client.on('stderr', value => stderr.push(value))
  t.after(async () => {
    await client.stop().catch(() => {})
    await mock.close()
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    rmSync(approvalMarker, { force: true })
    rmSync(home, { recursive: true, force: true })
  })

  await client.start()
  const identity = await client.initialize()
  assert.equal(identity.name, 'deepseek-harness-sdk-runtime')
  assert.equal(client.controlCapabilities.protocolVersion, 1)
  assert.deepEqual(new Set(client.controlCapabilities.methods), new Set([
    'session/turn.cancel', 'session/turn.steer', 'session/queue.enqueue', 'session/queue.list',
    'session/queue.cancel', 'session/draft.get', 'session/draft.put',
  ]))

  await client.request(RequestMethod.sessionPrompt, { sessionId: 'xg1-a', contentBlocks: text('hold a') })
  await waitFor(() => mock.requests.length >= 1, 'session A reaches mock')
  await client.request(RequestMethod.sessionPrompt, { sessionId: 'xg1-b', contentBlocks: text('hold b') })
  await waitFor(() => mock.requests.length >= 2, 'session B reaches mock')
  const turnA = await waitFor(() => notifications.some(value => value.sessionId === 'xg1-a' && value.event.type === 'turn/start') && turnOf(notifications, 'xg1-a'), 'turn A')
  const turnB = await waitFor(() => notifications.some(value => value.sessionId === 'xg1-b' && value.event.type === 'turn/start') && turnOf(notifications, 'xg1-b'), 'turn B')

  const queuedA = await client.enqueue('xg1-a', 'enqueue-a-1', text('queued a'))
  assert.equal(queuedA.position, 1)
  assert.deepEqual(await client.enqueue('xg1-a', 'enqueue-a-1', text('queued a')), queuedA)
  await assert.rejects(client.enqueue('xg1-a', 'enqueue-a-1', text('different')), error => error?.data?.code === 'CONFLICT')
  const queuedA2 = await client.enqueue('xg1-a', 'enqueue-a-2', text('queued a2'))
  assert.equal(queuedA2.position, 2)
  assert.deepEqual((await client.listQueue('xg1-a')).items.map(value => value.position), [1, 2])
  assert.equal((await client.cancelQueued('xg1-a', 'cancel-queue-a', queuedA.queuedItemId)).status, 'cancelled')
  assert.equal((await client.cancelQueued('xg1-a', 'cancel-queue-a-again', queuedA.queuedItemId)).status, 'already-cancelled')

  assert.equal((await client.getDraft('xg1-a', 'composer')).revision, 0)
  const draft = await client.putDraft('xg1-a', 'composer', 'draft-a-1', 0, text('draft a'))
  assert.equal(draft.revision, 1)
  assert.deepEqual(await client.putDraft('xg1-a', 'composer', 'draft-a-1', 0, text('draft a')), draft)
  await assert.rejects(client.putDraft('xg1-a', 'composer', 'draft-a-2', 0, text('stale')), error => error?.data?.code === 'CONFLICT' && error.data.details.currentRevision === 1)
  assert.equal((await client.getDraft('xg1-b', 'composer')).revision, 0)

  const steer = await client.steerTurn('xg1-a', 'steer-a', text('change approach'), { turnId: turnA })
  assert.equal(steer.effectiveTurnId, turnA)
  assert.equal(steer.target, 'next-step')
  const cancellation = await client.cancelTurn('xg1-a', 'cancel-a', { turnId: turnA })
  assert.equal(cancellation.effectiveTurnId, turnA)
  await waitFor(() => notifications.some(value => value.sessionId === 'xg1-a' && value.event.type === 'turn/end'), 'turn A ends')
  assert.equal(notifications.some(value => value.sessionId === 'xg1-b' && value.event.type === 'turn/end'), false)
  await client.cancelTurn('xg1-b', 'cancel-b', { turnId: turnB })
  await waitFor(() => notifications.some(value => value.sessionId === 'xg1-b' && value.event.type === 'turn/end'), 'turn B ends')

  await client.request(RequestMethod.sessionPrompt, { sessionId: 'xg1-c', contentBlocks: text('approval c') })
  await client.request(RequestMethod.sessionPrompt, { sessionId: 'xg1-d', contentBlocks: text('approval d') })
  const approvalC = await waitFor(() => serverRequests.find(value => value.method === 'approval/request' && value.params.sessionId === 'xg1-c'), 'approval C')
  const approvalD = await waitFor(() => serverRequests.find(value => value.method === 'approval/request' && value.params.sessionId === 'xg1-d'), 'approval D')
  assert.notEqual(approvalC.requestId, approvalD.requestId)
  assert.equal(approvalC.respond({ outcome: 'allowed-once' }), true)
  assert.equal(approvalD.respond({ outcome: 'rejected' }), true)
  await waitFor(() => mock.requests.length >= 6, 'both approval turns receive their final model response')
  await waitFor(() => notifications.some(value => value.sessionId === 'xg1-c' && value.event.type === 'turn/end'), 'approval C ends')
  await waitFor(() => notifications.some(value => value.sessionId === 'xg1-d' && value.event.type === 'turn/end'), 'approval D ends')
  assert.equal(mock.requests.length, 6, 'both sessions must finish without exhausting the mock script')
  const toolOutcomes = Object.fromEntries(['xg1-c', 'xg1-d'].map((sessionId) => [sessionId,
    notifications.find(value => value.sessionId === sessionId && value.event.type === 'tool/result')?.event.data,
  ]))
  assert.equal(toolOutcomes['xg1-c']?.message?.isError, false, 'approved tool call must execute successfully')
  assert.equal(toolOutcomes['xg1-d']?.message?.isError, true, 'rejected tool call must not execute')
  assert.match(JSON.stringify(toolOutcomes['xg1-d']?.error), /SANDBOX_ESCALATION_REJECTED/)
  const decisions = Object.fromEntries(['xg1-c', 'xg1-d'].map((sessionId) => [sessionId,
    notifications.filter((value) => value.sessionId === sessionId && value.event.type === 'approval/decided').map((value) => value.event.data),
  ]))
  assert.deepEqual(decisions['xg1-c'].map((value) => value.outcome), ['allowed-once'])
  assert.deepEqual(decisions['xg1-d'].map((value) => value.outcome), ['rejected'])
  assert.notEqual(decisions['xg1-c'][0].id, decisions['xg1-d'][0].id)
  assert.equal(existsSync(approvalMarker), true, 'approved fixture must execute outside the workspace')

  for (const sessionId of ['xg1-a', 'xg1-b', 'xg1-c', 'xg1-d']) assertContiguous(notifications, sessionId)
  assert.equal(notifications.some(value => value.sessionId === 'xg1-a' && value.control?.requestId === 'steer-a'), true)
  assert.equal(notifications.some(value => value.sessionId === 'xg1-b' && value.control?.requestId === 'steer-a'), false)
  const result = {
    status: 'passed', identity, capabilities: client.controlCapabilities,
    sessions: ['xg1-a', 'xg1-b', 'xg1-c', 'xg1-d'],
    nativeEventCounts: Object.fromEntries(['xg1-a', 'xg1-b', 'xg1-c', 'xg1-d'].map(sessionId => [sessionId, notifications.filter(value => value.sessionId === sessionId).length])),
    mockRequestCount: mock.requests.length,
    approvalDecisions: decisions,
    approvalToolOutcomes: Object.fromEntries(Object.entries(toolOutcomes).map(([sessionId, value]) => [sessionId, {
      isError: value?.message?.isError,
      error: value?.error,
    }])),
    wireRecorded: recordPath,
    stderr,
  }
  if (process.env.DSH_XG1_RESULT_PATH) writeFileSync(process.env.DSH_XG1_RESULT_PATH, `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify(result))
})
