import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ControlErrorCode,
  acceptOwnerDraftSubmission,
  adaptUsage,
  beginOwnerDraftSubmission,
  bindDraftOwnerToSession,
  composeSessionView,
  createDraftState,
  createWorkbenchRegistry,
  getOwnerDraft,
  projectApprovalsForOwner,
  projectToolsForOwner,
  projectUsageForOwner,
  putConversationWorkspace,
  putToolInstance,
  restoreDrafts,
  serializeDrafts,
  updateOwnerDraft,
} from '../../workbench-core/src/index.js'

const T0 = '2026-11-28T00:00:00.000Z'
const ownerA = { kind: 'session', id: 'session-a', hostId: 'host-a', windowId: 'window-a' }
const ownerB = { kind: 'session', id: 'session-b', hostId: 'host-b', windowId: 'window-b' }
const draftOwner = { kind: 'draft', id: 'draft-a' }

function usage(sessionId, outputTokens) {
  return adaptUsage({ inputTokens: 10, outputTokens }, {
    sessionId,
    turnId: `turn-${sessionId}`,
    requestId: `request-${sessionId}`,
    messageId: `message-${sessionId}`,
    eventId: `event-${sessionId}`,
    eventType: 'assistant/message',
    source: 'runtime',
    workspaceId: 'workspace-a',
  }, { observedAt: T0 })
}

function registry() {
  let state = createWorkbenchRegistry()
  for (const owner of [ownerA, ownerB]) {
    state = putConversationWorkspace(state, {
      owner,
      document: { draftId: `document-${owner.id}`, contentBlocks: [], revision: 0 },
    })
  }
  state = putToolInstance(state, {
    instanceId: 'tool-a', toolId: 'terminal', owner: ownerA, state: 'ready',
  })
  state = putToolInstance(state, {
    instanceId: 'tool-b', toolId: 'files', owner: ownerB, state: 'ready',
  })
  return state
}

test('X4.1 business owner excludes host/window and drafts are isolated by kind and id', () => {
  let drafts = createDraftState()
  drafts = updateOwnerDraft(drafts, ownerA, 0, { body: 'A' }, T0)
  drafts = updateOwnerDraft(drafts, { ...ownerA, hostId: 'host-other', windowId: 'window-other' }, 1, { body: 'A2' }, T0)
  drafts = updateOwnerDraft(drafts, ownerB, 0, { body: 'B' }, T0)
  drafts = updateOwnerDraft(drafts, draftOwner, 0, { body: 'draft' }, T0)

  assert.equal(getOwnerDraft(drafts, ownerA).body, 'A2')
  assert.equal(getOwnerDraft(drafts, ownerB).body, 'B')
  assert.equal(getOwnerDraft(drafts, draftOwner).body, 'draft')
  assert.equal(getOwnerDraft(drafts, { kind: 'session', id: 'missing' }), null)
  assert.throws(() => getOwnerDraft(drafts, { kind: 'other', id: 'x' }), (error) => error.code === ControlErrorCode.INVALID_ARGUMENT)
})

test('X4.1 owner draft v1 snapshots restore without changing the legacy per-session API', () => {
  let drafts = createDraftState()
  drafts = updateOwnerDraft(drafts, draftOwner, 0, {
    body: 'persisted',
    attachments: [{ id: 'file-1', name: 'a.txt', size: 2, mediaType: 'text/plain', receiptId: 'receipt-1' }],
  }, T0)
  const restored = restoreDrafts(serializeDrafts(drafts))
  assert.deepEqual(getOwnerDraft(restored, draftOwner), getOwnerDraft(drafts, draftOwner))
  assert.equal(restored.sessions['draft:draft-a'].sessionId, 'draft:draft-a')
})

test('X4.1 accepted draft binding preserves submission truth and refuses unsafe migration', () => {
  let drafts = createDraftState()
  drafts = updateOwnerDraft(drafts, draftOwner, 0, { body: 'send me' }, T0)
  drafts = beginOwnerDraftSubmission(drafts, draftOwner, 1, 'submission-1', T0)
  assert.throws(
    () => bindDraftOwnerToSession(drafts, { draftId: 'draft-a', sessionId: 'session-a', submissionId: 'submission-1', updatedAt: T0 }),
    (error) => error.code === ControlErrorCode.CONFLICT,
  )
  drafts = acceptOwnerDraftSubmission(drafts, draftOwner, 'submission-1', T0)
  const bound = bindDraftOwnerToSession(drafts, { draftId: 'draft-a', sessionId: 'session-a', submissionId: 'submission-1', updatedAt: T0 })
  assert.equal(getOwnerDraft(bound, draftOwner), null)
  const projected = getOwnerDraft(bound, ownerA)
  assert.equal(projected.ownerKey, 'session:session-a')
  assert.equal(projected.sessionId, 'session-a')
  assert.equal(projected.draftId, 'draft:session:session-a')
  assert.equal(projected.body, 'send me')
  assert.equal(projected.submission.runtimeAccepted, true)
  assert.equal(projected.submission.runtimeQueued, false)

  const withTarget = updateOwnerDraft(bound, ownerA, projected.revision, { body: 'newer' }, T0)
  assert.throws(
    () => bindDraftOwnerToSession(withTarget, { draftId: 'draft-a', sessionId: 'session-a', submissionId: 'submission-1', updatedAt: T0 }),
    (error) => error.code === ControlErrorCode.NOT_FOUND,
  )
})

test('X4.1 a bound session draft is never overwritten by another accepted draft', () => {
  let drafts = createDraftState()
  drafts = updateOwnerDraft(drafts, draftOwner, 0, { body: 'first' }, T0)
  drafts = beginOwnerDraftSubmission(drafts, draftOwner, 1, 'submission-1', T0)
  drafts = acceptOwnerDraftSubmission(drafts, draftOwner, 'submission-1', T0)
  drafts = bindDraftOwnerToSession(drafts, { draftId: 'draft-a', sessionId: 'session-a', submissionId: 'submission-1', updatedAt: T0 })
  drafts = updateOwnerDraft(drafts, { kind: 'draft', id: 'draft-b' }, 0, { body: 'second' }, T0)
  drafts = beginOwnerDraftSubmission(drafts, { kind: 'draft', id: 'draft-b' }, 1, 'submission-2', T0)
  drafts = acceptOwnerDraftSubmission(drafts, { kind: 'draft', id: 'draft-b' }, 'submission-2', T0)
  assert.throws(
    () => bindDraftOwnerToSession(drafts, { draftId: 'draft-b', sessionId: 'session-a', submissionId: 'submission-2', updatedAt: T0 }),
    (error) => error.code === ControlErrorCode.CONFLICT,
  )
  assert.equal(getOwnerDraft(drafts, ownerA).body, 'first')
})

test('X4.1 approvals validate Host truth, isolate sessions, and never leak to drafts', () => {
  const approvals = [
    { interactionId: 'interaction-a', sessionId: 'session-a', leaseGeneration: 2, kind: 'permission', approvalType: 'shell', detail: { command: 'pwd' }, status: 'pending' },
    { interactionId: 'interaction-b', sessionId: 'session-b', leaseGeneration: 1, status: 'submitted' },
  ]
  assert.deepEqual(projectApprovalsForOwner(approvals, ownerA).map((item) => item.interactionId), ['interaction-a'])
  assert.deepEqual(projectApprovalsForOwner(approvals, ownerB).map((item) => item.interactionId), ['interaction-b'])
  assert.deepEqual(projectApprovalsForOwner(approvals, draftOwner), [])
  assert.throws(() => projectApprovalsForOwner([...approvals, approvals[0]], ownerA), (error) => error.code === ControlErrorCode.INVALID_ARGUMENT)
  assert.throws(() => projectApprovalsForOwner([{ ...approvals[0], status: 'allowed' }], ownerA), (error) => error.code === ControlErrorCode.INVALID_ARGUMENT)
  assert.throws(() => projectApprovalsForOwner([{ ...approvals[0], leaseGeneration: 0 }], ownerA), (error) => error.code === ControlErrorCode.INVALID_ARGUMENT)
})

test('X4.1 usage is attributable only to its real session and options cannot override owner scope', () => {
  const records = [usage('session-a', 7), usage('session-b', 11)]
  const projected = projectUsageForOwner(records, ownerA, { sessionId: 'session-b' })
  assert.equal(projected.totals.outputTokens, 7)
  assert.equal(projected.recordCount, 1)
  assert.equal(projectUsageForOwner(records, draftOwner), null)
})

test('X4.1 tools and layout are filtered by business owner, not Host placement', () => {
  const state = registry()
  const a = projectToolsForOwner(state, { ...ownerA, hostId: 'host-other', windowId: 'window-other' })
  const b = projectToolsForOwner(state, ownerB)
  assert.deepEqual(a.instances.map((item) => item.instanceId), ['tool-a'])
  assert.deepEqual(b.instances.map((item) => item.instanceId), ['tool-b'])
  assert.equal(a.layout.root.kind, 'pane')
  assert.deepEqual(projectToolsForOwner(state, draftOwner).instances, [])
})

test('X4.1 composeSessionView returns one coherent owner projection with an empty default registry', () => {
  let drafts = createDraftState()
  drafts = updateOwnerDraft(drafts, ownerA, 0, { body: 'A' }, T0)
  const view = composeSessionView({
    owner: ownerA,
    drafts,
    approvals: [{ interactionId: 'interaction-a', sessionId: 'session-a', status: 'pending' }],
    usage: [usage('session-a', 3), usage('session-b', 99)],
    registry: registry(),
  })
  assert.equal(view.schemaVersion, 1)
  assert.deepEqual(view.owner, { kind: 'session', id: 'session-a' })
  assert.equal(view.draft.body, 'A')
  assert.equal(view.approvals.length, 1)
  assert.equal(view.usage.totals.outputTokens, 3)
  assert.deepEqual(view.tools.instances.map((item) => item.instanceId), ['tool-a'])
  assert.deepEqual(composeSessionView({ owner: draftOwner }).tools, { instances: [], layout: null, leases: [] })
})
