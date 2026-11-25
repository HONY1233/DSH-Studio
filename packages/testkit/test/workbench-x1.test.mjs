import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ControlError,
  ControlErrorCode,
  acceptDraftSubmission,
  adaptUsage,
  adaptUsageFromEvent,
  assertRuntimeCapability,
  beginDraftSubmission,
  cancelDraftSubmission,
  capabilityOf,
  cloneJson,
  createCapabilityManifest,
  createControlDispatcher,
  createControlEnvelope,
  createControlReceipt,
  createDraftState,
  createEventRouter,
  createJsonlUsageRepository,
  createUsageLedger,
  getDraft,
  ingestUsage,
  queueDraftLocally,
  rawUsageHash,
  restoreDrafts,
  restoreUsageLedger,
  serializeDrafts,
  serializeUsageLedger,
  unsupportedControlReceipt,
  updateDraft,
  usageLedgerReport,
  usageTotals,
} from '../../workbench-core/src/index.js'

const NOW = '2026-11-25T08:00:00.000Z'

function envelope(overrides = {}) {
  return createControlEnvelope({
    requestId: 'request-1',
    method: 'session.cancel',
    sessionId: 'session-a',
    observedAt: NOW,
    payload: { turnId: 'turn-1' },
    ...overrides,
  })
}

function event(sequence, text = `event-${sequence}`, overrides = {}) {
  return {
    schemaVersion: 1,
    eventId: `event-${sequence}`,
    sessionId: 'session-a',
    sequence,
    type: 'assistant/message',
    occurredAt: NOW,
    data: { text },
    ...overrides,
  }
}

function usageRecord(outputTokens = 10, overrides = {}) {
  return adaptUsage({
    uncachedInputTokens: 20,
    outputTokens,
    cacheReadTokens: 5,
    cacheWriteTokens: 2,
  }, {
    sessionId: 'session-a',
    turnId: 'turn-1',
    messageId: 'message-1',
    eventType: 'assistant/message',
    eventId: 'event-1',
    sequence: 1,
    source: 'fixture',
  }, { observedAt: NOW, ...overrides })
}

function usageRow(record) {
  return { format: 'dsh-usage-jsonl', version: 1, kind: 'usage', record }
}

function memoryIo(initial = '') {
  const files = new Map(initial ? [['usage.jsonl', initial]] : [])
  const state = { failAppend: false, failAtomic: false }
  function missing(path) {
    const error = new Error(`missing: ${path}`)
    error.code = 'ENOENT'
    return error
  }
  return {
    files,
    state,
    read(path) {
      if (!files.has(path)) throw missing(path)
      return files.get(path)
    },
    append(path, text) {
      if (state.failAppend) {
        const error = new Error('disk full')
        error.code = 'ENOSPC'
        throw error
      }
      files.set(path, (files.get(path) ?? '') + text)
    },
    atomicWrite(tempPath, path, text) {
      if (state.failAtomic) {
        const error = new Error('disk full')
        error.code = 'ENOSPC'
        throw error
      }
      files.set(path, text)
      files.delete(tempPath)
    },
    copy(source, target) {
      if (!files.has(source)) throw missing(source)
      files.set(target, files.get(source))
    },
    remove(path) {
      files.delete(path)
    },
  }
}

test('X1.1 control envelopes and receipts are explicit and failed receipts never contain result', () => {
  const request = envelope()
  assert.equal(request.schemaVersion, 1)
  assert.deepEqual(request.payload, { turnId: 'turn-1' })
  const failed = createControlReceipt({
    requestId: request.requestId,
    observedAt: NOW,
    status: 'failed',
    error: { code: 'UNSUPPORTED', message: 'not supported' },
    result: { mustNotAppear: true },
  })
  assert.equal('result' in failed, false)
  assert.throws(() => envelope({ requestId: '' }), (error) => error.code === ControlErrorCode.INVALID_ARGUMENT)
  assert.throws(() => createControlReceipt({ requestId: 'x', observedAt: NOW, status: 'failed' }), ControlError)
})

test('X1.1 absent Runtime methods stay unavailable and local capabilities cannot authorize Runtime calls', () => {
  const manifest = createCapabilityManifest()
  for (const method of ['session.cancel', 'session.steer', 'session.queue.enqueue', 'session.queue.cancel', 'session.queue.list', 'session.queue.position', 'session.draft.save']) {
    assert.equal(capabilityOf(manifest, method).grade, 'unavailable', method)
    assert.throws(() => assertRuntimeCapability(manifest, method), (error) => error.code === ControlErrorCode.CAPABILITY_UNAVAILABLE)
  }
  assert.equal(capabilityOf(manifest, 'draft.local').source, 'client')
  assert.throws(() => assertRuntimeCapability(manifest, 'draft.local'), (error) => error.code === ControlErrorCode.CAPABILITY_UNAVAILABLE)
  const receipt = unsupportedControlReceipt('session.steer', 'request-2', NOW)
  assert.equal(receipt.status, 'failed')
  assert.equal(receipt.error.code, ControlErrorCode.CAPABILITY_UNAVAILABLE)
  assert.equal('result' in receipt, false)
})

test('X1.1 capability negotiation enables only explicitly declared additive methods', () => {
  const manifest = createCapabilityManifest({
    protocolVersion: 1,
    methods: { 'session.cancel': true, 'session.steer': { supported: false } },
  })
  assert.equal(capabilityOf(manifest, 'session.cancel').grade, 'available')
  assert.equal(capabilityOf(manifest, 'session.steer').grade, 'unavailable')
  assert.throws(() => createCapabilityManifest({ protocolVersion: 2 }), (error) => error.code === ControlErrorCode.CAPABILITY_UNAVAILABLE)
})

test('X1.1 request replay is idempotent and requestId reuse with different input is a conflict', async () => {
  const dispatcher = createControlDispatcher({
    capabilities: createCapabilityManifest({ protocolVersion: 1, methods: { 'session.cancel': true } }),
  })
  let executions = 0
  const execute = async () => {
    executions += 1
    await new Promise((resolve) => setImmediate(resolve))
    return { cancelled: true }
  }
  const first = dispatcher.dispatch(envelope(), execute)
  const replay = dispatcher.dispatch(envelope(), execute)
  assert.equal(first, replay)
  assert.deepEqual(await first, await replay)
  assert.equal(executions, 1)

  const conflict = await dispatcher.dispatch(envelope({ payload: { turnId: 'turn-2' } }), execute)
  assert.equal(conflict.status, 'failed')
  assert.equal(conflict.error.code, ControlErrorCode.CONFLICT)
  assert.equal(executions, 1)
})

test('X1.1 replay identity is session-scoped and requestId length matches the Runtime contract', async () => {
  const dispatcher = createControlDispatcher({
    capabilities: createCapabilityManifest({ protocolVersion: 1, methods: { 'session.cancel': true } }),
  })
  let executions = 0
  const execute = async (_request, gate) => {
    gate('session.cancel')
    executions += 1
    return { cancelled: true }
  }
  const first = dispatcher.dispatch(envelope(), execute)
  const other = dispatcher.dispatch(envelope({ sessionId: 'session-b' }), execute)
  assert.notEqual(first, other)
  assert.equal((await first).status, 'completed')
  assert.equal((await other).status, 'completed')
  assert.equal(executions, 2)
  assert.equal(dispatcher.get('session-a', 'request-1'), first)
  assert.equal(dispatcher.get('session-b', 'request-1'), other)
  assert.throws(
    () => envelope({ requestId: 'r'.repeat(257) }),
    (error) => error.code === ControlErrorCode.INVALID_ARGUMENT,
  )
})

test('X1.2 unsupported steer fails before the injected executor and never becomes a prompt', async () => {
  const dispatcher = createControlDispatcher()
  let executions = 0
  const receipt = await dispatcher.dispatch(envelope({ method: 'session.steer' }), async () => {
    executions += 1
    return { sent: true }
  })
  assert.equal(executions, 0, 'unsupported control must fail before the injected executor')
  assert.equal(receipt.status, 'failed')
  assert.equal(receipt.error.code, ControlErrorCode.CAPABILITY_UNAVAILABLE)
  assert.equal('result' in receipt, false)
})

test('X1.4 drafts are per-session, revision conflicts do not overwrite, and restore round-trips', () => {
  let state = createDraftState()
  state = updateDraft(state, 'session-a', 0, { body: 'A1', attachments: [{ id: 'file-1', name: 'a.txt' }] }, NOW)
  state = updateDraft(state, 'session-b', 0, { body: 'B1' }, NOW)
  assert.equal(getDraft(state, 'session-a').revision, 1)
  assert.equal(getDraft(state, 'session-b').revision, 1)
  assert.throws(
    () => updateDraft(state, 'session-a', 0, { body: 'stale' }, NOW),
    (error) => error.code === ControlErrorCode.CONFLICT,
  )
  assert.equal(getDraft(state, 'session-a').body, 'A1')
  const restored = restoreDrafts(serializeDrafts(state))
  assert.deepEqual(restored, state)
})

test('X1.4 local queued/submission states never claim Runtime acceptance or Runtime queueing', () => {
  let state = createDraftState()
  state = updateDraft(state, 'session-a', 0, { body: 'keep me' }, NOW)
  state = beginDraftSubmission(state, 'session-a', 1, 'submit-1', NOW)
  assert.equal(beginDraftSubmission(state, 'session-a', 2, 'submit-1', NOW), state)
  state = queueDraftLocally(state, 'session-a', 'submit-1', NOW)
  let draft = getDraft(state, 'session-a')
  assert.equal(draft.body, 'keep me')
  assert.equal(draft.submission.state, 'local-queued')
  assert.equal(draft.submission.origin, 'local-unsubmitted')
  assert.equal(draft.submission.runtimeQueued, false)
  assert.equal(draft.submission.runtimeAccepted, false)
  state = acceptDraftSubmission(state, 'session-a', 'submit-1', NOW)
  draft = getDraft(state, 'session-a')
  assert.equal(draft.submission.runtimeAccepted, true)
  assert.equal(draft.submission.runtimeQueued, false)
  state = cancelDraftSubmission(state, 'session-a', 'submit-1', NOW)
  assert.equal(getDraft(state, 'session-a').submission, null)
})

test('X1.5 unowned events are buffered, never broadcast, and flush only to a current owner', () => {
  const router = createEventRouter()
  router.registerSession('session-a')
  const received = router.ingest(event(1))
  assert.equal(received.status, 'buffered-unowned')
  assert.deepEqual(received.deliveries, [])
  const deliveries = router.leaseOwner('session-a', 'view-a', 'lease-a', 1)
  assert.equal(deliveries.length, 1)
  assert.equal(deliveries[0].lease.contextId, 'view-a')
  assert.equal(deliveries[0].event.data.text, 'event-1')
  assert.equal(router.ingest(event(1)).status, 'duplicate')
})

test('X1.5 one event fans out to multiple views of the same session', () => {
  const router = createEventRouter()
  router.registerSession('session-a')
  router.leaseOwner('session-a', 'view-a', 'lease-a', 1)
  router.leaseOwner('session-a', 'view-b', 'lease-b', 1)
  const received = router.ingest(event(1))
  assert.equal(received.status, 'delivered')
  assert.deepEqual(received.deliveries.map((item) => item.lease.contextId), ['view-a', 'view-b'])
  assert.equal(router.snapshot('session-a').lastSequence, 1)
})

test('X1.5 sequence gaps are reported and out-of-order events flush in order without loss', () => {
  const router = createEventRouter()
  router.registerSession('session-a')
  const gap = router.ingest(event(2))
  assert.equal(gap.status, 'buffered-gap')
  assert.deepEqual(gap.gap, { expected: 1, received: 2, missingFrom: 1, missingTo: 1 })
  router.leaseOwner('session-a', 'view-a', 'lease-a', 1)
  const flushed = router.ingest(event(1))
  assert.deepEqual(flushed.deliveries.map((item) => item.event.sequence), [1, 2])
  assert.equal(router.snapshot('session-a').lastSequence, 2)
  assert.equal(router.snapshot('session-a').gap, null)
})

test('X1.5 conflicting sequence content is visible and bounded buffers fail closed', () => {
  const router = createEventRouter({ replayWindow: 2 })
  router.registerSession('session-a')
  router.ingest(event(1))
  const conflict = router.ingest(event(1, 'different'))
  assert.equal(conflict.status, 'conflict')
  assert.equal(conflict.error.code, ControlErrorCode.CONFLICT)
  router.ingest(event(2))
  const overflow = router.ingest(event(3))
  assert.equal(overflow.status, 'rejected')
  assert.equal(overflow.error.code, ControlErrorCode.BUFFER_OVERFLOW)
})

test('X1.5 reused eventId with different content or sequence is a conflict', () => {
  const router = createEventRouter()
  router.registerSession('session-a')
  router.leaseOwner('session-a', 'view-a', 'lease-a', 1)
  router.ingest(event(1, 'first', { eventId: 'stable-event-id' }))
  const conflict = router.ingest(event(2, 'second', { eventId: 'stable-event-id' }))
  assert.equal(conflict.status, 'conflict')
  assert.equal(conflict.error.code, ControlErrorCode.CONFLICT)
})

test('X1.5 stale owner leases cannot release or acknowledge current subscriptions', () => {
  const router = createEventRouter()
  router.registerSession('session-a')
  router.leaseOwner('session-a', 'view-a', 'lease-old', 1)
  router.ingest(event(1))
  router.leaseOwner('session-a', 'view-a', 'lease-new', 2)
  assert.throws(
    () => router.releaseOwner('session-a', 'view-a', { leaseId: 'lease-old', generation: 1 }),
    (error) => error.code === ControlErrorCode.OWNER_MISMATCH,
  )
  assert.throws(
    () => router.acknowledge('session-a', 'view-a', 'event-1', { leaseId: 'lease-old', generation: 1 }),
    (error) => error.code === ControlErrorCode.OWNER_MISMATCH,
  )
  assert.equal(router.acknowledge('session-a', 'view-a', 'event-1', { leaseId: 'lease-new', generation: 2 }).status, 'acknowledged')
  assert.equal(router.acknowledge('session-a', 'view-a', 'event-1', { leaseId: 'lease-new', generation: 2 }).status, 'duplicate')
})

test('X1.6 UsageAdapter preserves raw hash/attribution and does not invent missing turn/end usage', () => {
  const raw = { uncachedInputTokens: 20, outputTokens: 10, cacheReadTokens: 5 }
  const record = adaptUsage(raw, { sessionId: 'session-a', eventId: 'event-1', sequence: 1, source: 'fixture' }, { observedAt: NOW })
  assert.equal(record.rawUsageHash, rawUsageHash(raw))
  assert.deepEqual(record.raw, raw)
  assert.equal(record.attribution.source, 'fixture')
  assert.equal(record.normalized.cacheReadTokens, 5)
  assert.equal(adaptUsageFromEvent({ type: 'turn/end', sessionId: 'session-a', data: { reason: { kind: 'completed' } } }), null)
  const adapted = adaptUsageFromEvent({
    type: 'assistant/message', sessionId: 'session-a', eventId: 'event-2', sequence: 2, occurredAt: NOW,
    data: { usage: raw, message: { id: 'message-2' }, turn: 3 },
  })
  assert.equal(adapted.attribution.source, 'assistant/message.data.usage')
  assert.equal(adapted.attribution.messageId, 'message-2')
  assert.equal(adapted.attribution.turnId, 3)
})

test('X1.6 malformed or negative usage is rejected rather than coerced', () => {
  assert.throws(() => adaptUsage({ outputTokens: -1 }, { sessionId: 'session-a' }), (error) => error.code === ControlErrorCode.INVALID_ARGUMENT)
  assert.throws(() => adaptUsage({ outputTokens: 1.5 }, { sessionId: 'session-a' }), (error) => error.code === ControlErrorCode.INVALID_ARGUMENT)
  assert.throws(() => adaptUsage({ unknown: 1 }, { sessionId: 'session-a' }), (error) => error.code === ControlErrorCode.INVALID_ARGUMENT)
})

test('X1.7 duplicate usage does not advance the ledger and conflicting content is reported', () => {
  const record = usageRecord()
  const first = ingestUsage(createUsageLedger(), record, NOW)
  assert.equal(first.status, 'accepted')
  const duplicate = ingestUsage(first.state, cloneJson(record), NOW)
  assert.equal(duplicate.status, 'duplicate')
  assert.equal(duplicate.state, first.state)
  assert.equal(duplicate.revision, first.revision)

  const conflicting = cloneJson(record)
  conflicting.raw.outputTokens = 99
  conflicting.normalized.outputTokens = 99
  conflicting.rawUsageHash = rawUsageHash(conflicting.raw)
  const conflict = ingestUsage(first.state, conflicting, NOW)
  assert.equal(conflict.status, 'conflict')
  assert.equal(conflict.state.corruptions.length, 1)
  assert.equal(conflict.state.corruptions[0].code, ControlErrorCode.CONFLICT)
})

test('X1.7 out-of-order corrections replace totals instead of double-counting', () => {
  const original = usageRecord(10)
  const correction = usageRecord(7, { correctionOf: original.usageId })
  let ledger = createUsageLedger()
  const pending = ingestUsage(ledger, correction, NOW)
  assert.equal(pending.status, 'pending-correction')
  assert.equal(usageTotals(pending.state).totals.outputTokens, undefined)
  const applied = ingestUsage(pending.state, original, NOW)
  ledger = applied.state
  assert.equal(usageTotals(ledger).totals.outputTokens, 7)
  assert.equal(usageTotals(ledger).activeRecords, 1)
  assert.equal(usageLedgerReport(ledger).superseded.length, 1)
  const duplicate = ingestUsage(ledger, original, NOW)
  assert.equal(duplicate.status, 'duplicate')
  assert.equal(usageTotals(duplicate.state).totals.outputTokens, 7)
  assert.deepEqual(restoreUsageLedger(serializeUsageLedger(ledger)), ledger)
})

test('X1.7 raw hash corruption is visible and excluded from totals', () => {
  const record = usageRecord()
  record.raw.outputTokens = 999
  const result = ingestUsage(createUsageLedger(), record, NOW)
  assert.equal(result.status, 'corrupt')
  assert.equal(result.state.corruptions.length, 1)
  assert.equal(usageTotals(result.state).activeRecords, 0)

  const mismatched = usageRecord()
  mismatched.normalized.outputTokens = 999
  const normalizedMismatch = ingestUsage(createUsageLedger(), mismatched, NOW)
  assert.equal(normalizedMismatch.status, 'corrupt')
  assert.match(normalizedMismatch.state.corruptions[0].message, /不一致/)
})

test('X1.7 multi-level out-of-order corrections resolve and cycles fail visibly', () => {
  const original = usageRecord(10)
  const correction = usageRecord(7, { correctionOf: original.usageId })
  const final = usageRecord(5, { correctionOf: correction.usageId })
  let ledger = createUsageLedger()
  ledger = ingestUsage(ledger, final, NOW).state
  ledger = ingestUsage(ledger, correction, NOW).state
  ledger = ingestUsage(ledger, original, NOW).state
  assert.equal(usageTotals(ledger).totals.outputTokens, 5)
  assert.equal(usageTotals(ledger).activeRecords, 1)

  const first = usageRecord(8)
  const second = usageRecord(6)
  first.correctionOf = second.usageId
  second.correctionOf = first.usageId
  let cyclic = createUsageLedger()
  cyclic = ingestUsage(cyclic, first, NOW).state
  const rejected = ingestUsage(cyclic, second, NOW)
  assert.equal(rejected.status, 'conflict')
  assert.equal(rejected.state.corruptions.at(-1).reason, 'correction-cycle')
})

test('X1.8 JSONL load reports truncated rows and append replay writes only once', () => {
  const record = usageRecord()
  const initial = `${JSON.stringify(usageRow(record))}\n{"format":"dsh-usage-jsonl","version":1,"kind":"usage","record":`
  const io = memoryIo(initial)
  let nowCalls = 0
  const repository = createJsonlUsageRepository({ io, filePath: 'usage.jsonl', now: () => { nowCalls += 1; return NOW } })
  const loaded = repository.load()
  assert.equal(loaded.active.length, 1)
  assert.equal(loaded.corruptions.length, 1)
  assert.equal(loaded.corruptions[0].line, 2)
  const before = io.files.get('usage.jsonl')
  assert.equal(repository.append(record).status, 'duplicate')
  assert.equal(io.files.get('usage.jsonl'), before)
  assert.equal(repository.append(usageRecord(11)).status, 'accepted')
  assert.equal(nowCalls > 0, true)
})

test('X1.8 compaction preserves corruption reports without turning them into new invalid rows', () => {
  const record = usageRecord()
  const initial = `${JSON.stringify(usageRow(record))}\nnot-json\n`
  const io = memoryIo(initial)
  const repository = createJsonlUsageRepository({ io, filePath: 'usage.jsonl', now: () => NOW })
  const loaded = repository.load()
  assert.equal(loaded.corruptions.length, 1)
  repository.compact('usage.backup.jsonl')
  const reloaded = createJsonlUsageRepository({ io, filePath: 'usage.jsonl', now: () => NOW })
  const report = reloaded.load()
  assert.equal(report.active.length, 1)
  assert.equal(report.corruptions.length, 1)
  assert.equal(report.corruptions[0].reason, 'invalid-json')
})

test('X1.8 append failure does not advance memory and disk-full compaction preserves the original', () => {
  const io = memoryIo()
  const repository = createJsonlUsageRepository({ io, filePath: 'usage.jsonl', now: () => NOW })
  repository.load()
  io.state.failAppend = true
  assert.throws(() => repository.append(usageRecord()), (error) => error.code === ControlErrorCode.STORAGE_FAILED)
  assert.equal(repository.report().revision, 0)
  io.state.failAppend = false
  repository.append(usageRecord())
  const original = io.files.get('usage.jsonl')
  io.state.failAtomic = true
  assert.throws(() => repository.compact('usage.backup.jsonl'), (error) => error.code === ControlErrorCode.STORAGE_FAILED)
  assert.equal(io.files.get('usage.jsonl'), original)
  assert.equal(io.files.get('usage.backup.jsonl'), original)
  io.state.failAtomic = false
  const compacted = repository.compact('usage.backup.jsonl')
  assert.equal(compacted.records, 1)
  assert.equal(io.files.get('usage.backup.jsonl'), original)

  const reloaded = createJsonlUsageRepository({ io, filePath: 'usage.jsonl', now: () => NOW })
  const report = reloaded.load()
  assert.equal(report.active.length, 1)
  assert.equal(usageTotals(restoreUsageLedger(reloaded.snapshot())).totals.outputTokens, 10)
})
