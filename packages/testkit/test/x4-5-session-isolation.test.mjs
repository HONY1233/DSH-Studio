import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStudioBridge } from '../../../apps/desktop/src/studio-bridge.js'

const CWD = '/mnt/f/projects/dsh-studio'

function bridgeWithStub() {
  const events = []
  const runtime = { state: 'ready', options: { cwd: CWD }, resume: async () => {} }
  const bridge = createStudioBridge({
    runtime,
    cwd: CWD,
    emit: (event) => events.push(event),
  })
  return { bridge, events }
}

function assistant(sessionId, text, seq) {
  return {
    sessionId,
    event: {
      type: 'assistant/message',
      seq,
      data: { message: { id: `${sessionId}-message-${seq}`, content: [{ type: 'text', text }] } },
    },
  }
}

function toolCall(sessionId, id, seq) {
  return {
    sessionId,
    event: {
      type: 'tool/call',
      seq,
      data: { callId: `${sessionId}-${id}`, turn: 1, name: 'read', arguments: { id } },
    },
  }
}

function toolResult(sessionId, id, seq, text) {
  return {
    sessionId,
    event: {
      type: 'tool/result',
      seq,
      data: {
        turn: 1,
        message: { toolCallId: `${sessionId}-${id}`, content: [{ type: 'text', text }] },
      },
    },
  }
}

test('X4.5/XA-04 dual sessions run concurrently with zero message, approval or tool leakage', async () => {
  const { bridge, events } = bridgeWithStub()
  const contextA = bridge.openContext({ sessionId: 'session-a' })
  const contextB = bridge.openContext({ sessionId: 'session-b' })
  events.length = 0

  // Both turns stream interleaved; each stream must only reach its own owner.
  bridge.onSessionEvent(assistant('session-a', 'A first', 1))
  bridge.onSessionEvent(assistant('session-b', 'B first', 1))
  bridge.onSessionEvent(toolCall('session-a', 'call-1', 2))
  bridge.onSessionEvent(toolCall('session-b', 'call-1', 2))
  bridge.onSessionEvent(toolResult('session-a', 'call-1', 3, 'A tool output'))
  bridge.onSessionEvent(toolResult('session-b', 'call-1', 3, 'B tool output'))
  bridge.onSessionEvent(assistant('session-a', 'A second', 4))
  bridge.onSessionEvent(assistant('session-b', 'B second', 4))

  const scoped = events.filter((event) => event.kind === 'conversation.changed')
  assert.ok(scoped.length > 0)
  assert.equal(scoped.every((event) => event.contextId === contextA || event.contextId === contextB), true)
  assert.equal(events.some((event) => event.contextId === undefined), false)

  // Every streamed update is owner-scoped: A's context never sees B's text or
  // tool output, and vice versa.
  const textA = JSON.stringify(scoped.filter((event) => event.contextId === contextA))
  const textB = JSON.stringify(scoped.filter((event) => event.contextId === contextB))
  assert.equal(textA.includes('B first'), false)
  assert.equal(textA.includes('B tool output'), false)
  assert.equal(textB.includes('A first'), false)
  assert.equal(textB.includes('A tool output'), false)
  assert.equal(textA.includes('A first'), true)
  assert.equal(textA.includes('A tool output'), true)
  assert.equal(textB.includes('B first'), true)
  assert.equal(textB.includes('B tool output'), true)
  assert.equal(scoped.filter((event) => event.contextId === contextA)
    .every((event) => event.sessionId === 'session-a'), true)
  assert.equal(scoped.filter((event) => event.contextId === contextB)
    .every((event) => event.sessionId === 'session-b'), true)

  // Approval belongs to A only; answering it never touches B's context.
  const responses = []
  events.length = 0
  bridge.onApprovalRequest({
    requestId: 'server-a',
    params: { sessionId: 'session-a', command: 'rm -rf build' },
    respond: (result) => responses.push(result),
  })
  const required = events.find((event) => event.kind === 'interaction.required')
  assert.equal(required.contextId, contextA)
  assert.equal(events.some((event) => event.contextId === contextB), false)

  bridge.command({
    requestId: 'approve-a',
    commandName: 'interaction.respond',
    input: { interactionId: required.interaction.interactionId, leaseGeneration: 1, decision: 'submit', value: true },
  }, contextA)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(responses, [{ outcome: 'allowed-once' }])

  const bList = await bridge.query('interaction.list', {}, contextB)
  assert.deepEqual(bList.approvals, [])
})