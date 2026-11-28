import { adaptUsage } from '@dsh-studio/workbench-core'
import { describe, expect, it } from 'vitest'

import { SessionViewStore, type OwnerDraftCommand } from './session-view-store.js'

const T0 = '2026-11-28T00:00:00.000Z'
const ownerA = { kind: 'session' as const, id: 'session-a' }
const ownerB = { kind: 'session' as const, id: 'session-b' }

function dispatch(store: SessionViewStore, command: OwnerDraftCommand) {
  return store.dispatchDraft(command, T0)
}

function update(store: SessionViewStore, body: string, owner = ownerA) {
  return dispatch(store, { type: 'update', owner, expectedRevision: store.getDraft(owner)?.revision ?? 0, patch: { body } })
}

describe('SessionViewStore owner drafts', () => {
  it('shares one cached projection for same-session views and isolates another session', () => {
    const store = new SessionViewStore()
    update(store, 'A')
    update(store, 'B', ownerB)
    expect(store.getProjection(ownerA)).toBe(store.getProjection({ ...ownerA }))
    expect(store.getProjection(ownerA).draft?.body).toBe('A')
    expect(store.getProjection(ownerB).draft?.body).toBe('B')
  })

  it('allows only one in-flight submission even when two views use stale snapshots', () => {
    const store = new SessionViewStore()
    update(store, 'once')
    const first = dispatch(store, { type: 'begin', owner: ownerA, expectedRevision: 1, submissionId: 'submit-1' })
    const second = dispatch(store, { type: 'begin', owner: ownerA, expectedRevision: 1, submissionId: 'submit-2' })
    expect(first.changed).toBe(true)
    expect(second.changed).toBe(false)
    expect(second.draft?.submission?.submissionId).toBe('submit-1')
    expect(store.getDraft(ownerA)?.submission?.runtimeQueued).toBe(false)
  })

  it('a late accepted response preserves edits made while sending', () => {
    const store = new SessionViewStore()
    update(store, 'original')
    const begun = dispatch(store, { type: 'begin', owner: ownerA, expectedRevision: 1, submissionId: 'submit-1' })
    update(store, 'newer')
    const settled = dispatch(store, {
      type: 'settle', owner: ownerA, submissionId: 'submit-1', expectedRevision: begun.revision, outcome: 'accepted',
    })
    expect(settled.draft?.body).toBe('newer')
    expect(settled.draft?.submission?.state).toBe('accepted')
    expect(settled.draft?.submission?.snapshot.body).toBe('original')
    expect(settled.draft?.submission?.runtimeAccepted).toBe(true)
  })

  it('an accepted response clears an unchanged draft and duplicate settlement is a no-op', () => {
    const store = new SessionViewStore()
    update(store, 'original')
    const begun = dispatch(store, { type: 'begin', owner: ownerA, expectedRevision: 1, submissionId: 'submit-1' })
    const settled = dispatch(store, {
      type: 'settle', owner: ownerA, submissionId: 'submit-1', expectedRevision: begun.revision, outcome: 'accepted',
    })
    expect(settled.draft?.body).toBe('')
    const duplicate = dispatch(store, {
      type: 'settle', owner: ownerA, submissionId: 'submit-1', expectedRevision: begun.revision, outcome: 'accepted',
    })
    expect(duplicate.changed).toBe(false)
    expect(duplicate.revision).toBe(settled.revision)
  })

  it('a failed response retains content and attachments for retry', () => {
    const store = new SessionViewStore()
    update(store, 'retry me')
    dispatch(store, {
      type: 'update', owner: ownerA, expectedRevision: 1,
      patch: { attachments: [{ id: 'file-1', name: 'a.txt', size: 2, mediaType: 'text/plain', receiptId: 'receipt-1' }] },
    })
    const begun = dispatch(store, { type: 'begin', owner: ownerA, expectedRevision: 2, submissionId: 'submit-1' })
    const settled = dispatch(store, {
      type: 'settle', owner: ownerA, submissionId: 'submit-1', expectedRevision: begun.revision,
      outcome: 'failed', error: { code: 'OFFLINE', message: 'offline' },
    })
    expect(settled.draft?.body).toBe('retry me')
    expect(settled.draft?.attachments).toHaveLength(1)
    expect(settled.draft?.submission?.state).toBe('failed')
    expect(settled.draft?.submission?.runtimeAccepted).toBe(false)
  })

  it('persists only serializable attachment DTOs supplied by the caller', () => {
    const store = new SessionViewStore()
    const result = dispatch(store, {
      type: 'update', owner: ownerA, expectedRevision: 0,
      patch: { attachments: [{ id: 'file-1', name: 'a.txt', size: 2, mediaType: 'text/plain', receiptId: 'receipt-1' }] },
    })
    expect(() => JSON.stringify(result.draft)).not.toThrow()
    expect(result.draft?.attachments[0]).toEqual({
      id: 'file-1', name: 'a.txt', size: 2, mediaType: 'text/plain', receiptId: 'receipt-1',
    })
  })
})

describe('SessionViewStore Host facts', () => {
  it('projects approvals by session and applies only Host resolution outcomes', () => {
    const store = new SessionViewStore()
    store.replaceApprovals([
      { interactionId: 'a', sessionId: 'session-a', leaseGeneration: 1, kind: 'permission', approvalType: 'shell', detail: {}, status: 'pending' },
      { interactionId: 'b', sessionId: 'session-b', leaseGeneration: 1, kind: 'permission', approvalType: 'shell', detail: {}, status: 'pending' },
    ])
    expect(store.getProjection(ownerA).approvals.map((item) => item.interactionId)).toEqual(['a'])
    expect(store.getProjection(ownerB).approvals.map((item) => item.interactionId)).toEqual(['b'])
    store.applyInteraction({ kind: 'interaction.resolved', interactionId: 'a', leaseGeneration: 1, outcome: 'cancelled' })
    expect(store.getProjection(ownerA).approvals[0]?.status).toBe('cancelled')
    store.applyInteraction({ kind: 'interaction.resolved', interactionId: 'a', leaseGeneration: 2, outcome: 'submitted' })
    expect(store.getProjection(ownerA).approvals[0]?.status).toBe('cancelled')
  })

  it('reconciles one session without erasing approvals pending in another', () => {
    const store = new SessionViewStore()
    store.replaceApprovals([
      { interactionId: 'a1', sessionId: 'session-a', leaseGeneration: 1, kind: 'approval', approvalType: 'shell', detail: {}, status: 'pending' },
      { interactionId: 'b1', sessionId: 'session-b', leaseGeneration: 1, kind: 'approval', approvalType: 'shell', detail: {}, status: 'pending' },
    ])
    // A late view of A lists only A's cards; B stays untouched.
    store.replaceSessionApprovals('session-a', [
      { interactionId: 'a2', sessionId: 'session-a', leaseGeneration: 2, kind: 'approval', approvalType: 'command', detail: {}, status: 'pending' },
    ])
    expect(store.getProjection(ownerA).approvals.map((item) => item.interactionId)).toEqual(['a2'])
    expect(store.getProjection(ownerB).approvals.map((item) => item.interactionId)).toEqual(['b1'])
    expect(() => store.replaceSessionApprovals('session-a', [
      { interactionId: 'foreign', sessionId: 'session-b', leaseGeneration: 1, kind: 'approval', approvalType: 'shell', detail: {}, status: 'pending' },
    ])).toThrow('同一会话')
    expect(store.getSnapshot().revision).toBe(2)
  })

  it('deduplicates the same Host interaction replayed by two views', () => {
    const store = new SessionViewStore()
    const interaction = {
      interactionId: 'a1', sessionId: 'session-a', leaseGeneration: 1,
      kind: 'approval', approvalType: 'command', detail: {}, status: 'pending' as const,
    }
    store.applyInteraction({ kind: 'interaction.required', interaction })
    store.applyInteraction({ kind: 'interaction.required', interaction: { ...interaction } })
    expect(store.getProjection(ownerA).approvals).toHaveLength(1)
  })

  it('deduplicates replayed usage IDs but keeps distinct Host records', () => {
    const store = new SessionViewStore()
    const record = adaptUsage({ inputTokens: 10, outputTokens: 2 }, {
      sessionId: 'session-a', turnId: 'turn-1', requestId: 'request-1', messageId: 'message-1',
      eventId: 'event-1', eventType: 'assistant/message', source: 'runtime', workspaceId: 'workspace-a',
    }, { observedAt: T0 })
    store.addUsageRecord(record)
    store.addUsageRecord(record)
    expect(store.getSnapshot().usage).toHaveLength(1)
    expect(store.getProjection(ownerA).usage?.recordCount).toBe(1)
    expect(store.getProjection(ownerB).usage?.recordCount).toBe(0)
    store.addUsageRecord(adaptUsage({ inputTokens: 10, outputTokens: 3 }, {
      sessionId: 'session-a', turnId: 'turn-1', requestId: 'request-1', messageId: 'message-1',
      eventId: 'event-2', eventType: 'assistant/message', source: 'runtime', workspaceId: 'workspace-a',
    }, { observedAt: T0 }))
    expect(store.getProjection(ownerA).usage?.totals.outputTokens).toBe(5)
  })

  it('filters tool instances and layout by owner', () => {
    const store = new SessionViewStore()
    store.replaceRegistry({
      workspaces: {
        'session:session-a': { toolLayout: { kind: 'pane', id: 'pane-main', tabs: [] }, leases: [] },
      },
      toolInstances: {
        one: { instanceId: 'one', owner: { ...ownerA, hostId: 'h1', windowId: 'w1' } },
        two: { instanceId: 'two', owner: ownerB },
      },
      leases: {},
    })
    expect(store.getProjection(ownerA).tools.instances.map((item) => item.instanceId)).toEqual(['one'])
    expect(store.getProjection(ownerB).tools.instances.map((item) => item.instanceId)).toEqual(['two'])
    expect(store.getProjection(ownerA).tools.layout).toEqual({ kind: 'pane', id: 'pane-main', tabs: [] })
  })
})
