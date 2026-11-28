import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStudioBridge } from '../../../apps/desktop/src/studio-bridge.js'

const CWD = '/mnt/f/projects/dsh-studio'

function bridgeWithStub() {
  const events = []
  const runtime = {
    state: 'ready',
    options: { cwd: CWD },
    resume: async () => {},
  }
  const bridge = createStudioBridge({
    runtime,
    cwd: CWD,
    emit: (event) => events.push(event),
  })
  return { bridge, events }
}

test('subagent lifecycle folds into the root session snapshot', () => {
  const { bridge, events } = bridgeWithStub()
  const contextId = bridge.openContext({ sessionId: 'root-1' })

  // DSH 只推生命周期通知；名字/任务从父会话刚发出的 subagent 工具调用里配对。
  bridge.onSessionEvent({
    sessionId: 'root-1',
    event: {
      type: 'tool/call',
      seq: 1,
      time: 1,
      data: { callId: 'call-1', name: 'subagent', arguments: { name: 'deps', description: '查依赖' } },
    },
  })
  bridge.onSubagentStarted({ parentSessionId: 'root-1', childSessionId: 'child-1' })

  const snapshot = bridge.snapshot('root-1')
  assert.equal(snapshot.agents.length, 1)
  assert.equal(snapshot.agents[0].agentId, 'child-1')
  assert.equal(snapshot.agents[0].displayName, 'deps')
  assert.equal(snapshot.agents[0].assignment, '查依赖')
  assert.equal(snapshot.agents[0].status, 'running')
  assert.equal(snapshot.agents[0].hasLiveSession, true)
  assert.equal(snapshot.agentsRevision, 1)

  const delivered = events.filter((event) => event.kind === 'snapshot').at(-1)
  assert.equal(delivered.contextId, contextId)
  assert.equal(delivered.snapshot.sessionId, 'root-1')
})

test('finished subagents settle with status and summary, and nested rows keep their parent', () => {
  const { bridge } = bridgeWithStub()
  bridge.openContext({ sessionId: 'root-1' })
  bridge.onSubagentStarted({ parentSessionId: 'root-1', childSessionId: 'child-1' })
  bridge.onSubagentFinished({
    childSessionId: 'child-1',
    status: 'ok',
    stopReason: 'completed',
    lastAssistantMessage: [{ type: 'text', text: '依赖清单如下…' }],
  })

  const settled = bridge.snapshot('root-1')
  assert.equal(settled.agents[0].status, 'released')
  assert.equal(settled.agents[0].summary, '依赖清单如下…')
  assert.equal(settled.agents[0].hasLiveSession, false)
  assert.equal(settled.agentsRevision, 2)

  bridge.onSubagentStarted({ parentSessionId: 'child-1', childSessionId: 'child-2' })
  const nested = bridge.snapshot('root-1').agents.find((agent) => agent.agentId === 'child-2')
  assert.equal(nested.parentAgentId, 'child-1')
  assert.equal(nested.displayName, 'agent-1')

  bridge.onSubagentFinished({ childSessionId: 'child-2', status: 'error', stopReason: 'aborted' })
  assert.equal(bridge.snapshot('root-1').agents.find((agent) => agent.agentId === 'child-2').status, 'aborted')
})

test('session.agents.list and unknown notifications stay scoped', async () => {
  const { bridge } = bridgeWithStub()
  const contextId = bridge.openContext({ sessionId: 'root-1' })
  bridge.openContext({ sessionId: 'root-2' })
  bridge.onSubagentStarted({ parentSessionId: 'root-1', childSessionId: 'child-1' })

  const listed = await bridge.query('session.agents.list', { sessionId: 'root-1' }, contextId)
  assert.equal(listed.sessionId, 'root-1')
  assert.deepEqual(listed.agents.map((agent) => agent.agentId), ['child-1'])

  const other = await bridge.query('session.agents.list', { sessionId: 'root-2' }, undefined)
  assert.deepEqual(other.agents, [])

  // 没有 started 的 finished 不凭空造记录。
  bridge.onSubagentFinished({ childSessionId: 'ghost', status: 'ok', stopReason: 'completed' })
  assert.deepEqual(bridge.snapshot('root-1').agents.map((agent) => agent.agentId), ['child-1'])
})

test('session events never broadcast to a non-owner or an ownerless session', () => {
  const { bridge, events } = bridgeWithStub()
  const first = bridge.openContext({ sessionId: 'root-1' })
  const second = bridge.openContext({ sessionId: 'root-2' })
  events.length = 0

  bridge.onSessionEvent({
    sessionId: 'root-1',
    event: { type: 'assistant/message', data: { message: { id: 'a1', content: [{ type: 'text', text: 'one' }] } } },
  })
  bridge.onSessionEvent({
    sessionId: 'unowned',
    event: { type: 'assistant/message', data: { message: { id: 'a2', content: [{ type: 'text', text: 'orphan' }] } } },
  })

  const scoped = events.filter((event) => event.kind === 'conversation.changed')
  assert.equal(scoped.length, 1)
  assert.equal(scoped[0].contextId, first)
  assert.equal(events.some((event) => event.contextId === second), false)
  assert.equal(events.some((event) => event.contextId === undefined), false)
})

test('approval requests are owner-scoped and foreign contexts cannot respond', async () => {
  const { bridge, events } = bridgeWithStub()
  const owner = bridge.openContext({ sessionId: 'root-1' })
  const foreign = bridge.openContext({ sessionId: 'root-2' })
  const responses = []
  events.length = 0

  bridge.onApprovalRequest({
    requestId: 'server-1',
    params: { sessionId: 'root-1', command: 'rm -rf build' },
    respond: (result) => responses.push(result),
  })
  const required = events.find((event) => event.kind === 'interaction.required')
  assert.equal(required.contextId, owner)
  assert.equal(events.some((event) => event.contextId === foreign), false)

  bridge.command({
    requestId: 'cmd-foreign', commandName: 'interaction.respond',
    input: { interactionId: required.interaction.interactionId, leaseGeneration: 1, decision: 'submit', value: true },
  }, foreign)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(responses, [])
  assert.ok(events.some((event) => event.receipt?.error?.code === 'PERMISSION_DENIED'))

  bridge.command({
    requestId: 'cmd-owner', commandName: 'interaction.respond',
    input: { interactionId: required.interaction.interactionId, leaseGeneration: 1, decision: 'submit', value: true },
  }, owner)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(responses, [{ outcome: 'allowed-once' }])
})

test('completed tool calls release ownership so duplicate results cannot reuse an old turn', () => {
  const { bridge, events } = bridgeWithStub()
  bridge.openContext({ sessionId: 'root-1' })
  bridge.onSessionEvent({
    sessionId: 'root-1', event: { type: 'tool/call', seq: 1, data: { callId: 'call-1', turn: 1, name: 'read' } },
  })
  bridge.onSessionEvent({
    sessionId: 'root-1', event: {
      type: 'tool/result', seq: 2,
      data: { turn: 1, message: { toolCallId: 'call-1', content: [{ type: 'text', text: 'first' }] } },
    },
  })
  bridge.onSessionEvent({
    sessionId: 'root-1', event: {
      type: 'tool/result', seq: 3,
      data: { turn: 2, message: { toolCallId: 'call-1', content: [{ type: 'text', text: 'duplicate' }] } },
    },
  })
  const completed = events.filter((event) => event.kind === 'conversation.changed' && event.update?.kind === 'conversation.tool.completed')
  assert.deepEqual(completed.map((event) => event.update.turnId), ['turn-1', 'turn-2'])
})

test('ownerless approvals fail closed and closing the last owner cancels the request', () => {
  const { bridge, events } = bridgeWithStub()
  const responses = []
  events.length = 0
  bridge.onApprovalRequest({ requestId: 'orphan', params: { sessionId: 'missing' }, respond: (result) => responses.push(result) })
  assert.deepEqual(responses, [{ outcome: 'cancelled' }])
  assert.equal(events.some((event) => event.kind === 'interaction.required'), false)

  const owner = bridge.openContext({ sessionId: 'root-1' })
  bridge.onApprovalRequest({ requestId: 'owned', params: { sessionId: 'root-1' }, respond: (result) => responses.push(result) })
  bridge.closeContext(owner)
  assert.deepEqual(responses, [{ outcome: 'cancelled' }, { outcome: 'cancelled' }])
})

test('interaction.list recovers pending approvals for a same-session context and stays scoped', async () => {
  const { bridge, events } = bridgeWithStub()
  const first = bridge.openContext({ sessionId: 'root-1' })
  const foreign = bridge.openContext({ sessionId: 'root-2' })
  const responses = []
  bridge.onApprovalRequest({
    requestId: 'server-recover',
    params: { sessionId: 'root-1', command: 'rm -rf build', reason: 'outside workspace' },
    respond: (result) => responses.push(result),
  })
  const required = events.find((event) => event.kind === 'interaction.required')
  assert.equal(required.contextId, first)

  // A late view for the same session sees the card and gains the right to answer.
  const late = bridge.openContext({ sessionId: 'root-1' })
  const listed = await bridge.query('interaction.list', {}, late)
  assert.equal(listed.approvals.length, 1)
  assert.equal(listed.approvals[0].interactionId, required.interaction.interactionId)
  assert.equal(listed.approvals[0].status, 'pending')
  assert.deepEqual(listed.approvals[0].detail, { command: 'rm -rf build', reason: 'outside workspace' })
  assert.equal('respond' in listed.approvals[0], false)

  // Another session never sees or answers it.
  const foreignList = await bridge.query('interaction.list', {}, foreign)
  assert.deepEqual(foreignList.approvals, [])
  bridge.command({
    requestId: 'late-foreign', commandName: 'interaction.respond',
    input: { interactionId: required.interaction.interactionId, leaseGeneration: 1, decision: 'submit', value: true },
  }, foreign)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(responses, [])

  bridge.command({
    requestId: 'late-stale', commandName: 'interaction.respond',
    input: { interactionId: required.interaction.interactionId, leaseGeneration: 2, decision: 'submit', value: true },
  }, late)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(responses, [])
  assert.ok(events.some((event) => event.receipt?.error?.code === 'FAILED_PRECONDITION'))

  bridge.command({
    requestId: 'late-owner', commandName: 'interaction.respond',
    input: { interactionId: required.interaction.interactionId, leaseGeneration: 1, decision: 'submit', value: true },
  }, late)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(responses, [{ outcome: 'allowed-once' }])

  // A duplicate response is rejected and never reaches Runtime a second time.
  bridge.command({
    requestId: 'late-duplicate', commandName: 'interaction.respond',
    input: { interactionId: required.interaction.interactionId, leaseGeneration: 1, decision: 'submit', value: true },
  }, late)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(responses, [{ outcome: 'allowed-once' }])
  assert.ok(events.some((event) => event.receipt?.error?.code === 'INVALID_ARGUMENT'))

  const settled = await bridge.query('interaction.list', {}, first)
  assert.deepEqual(settled.approvals, [])
})
