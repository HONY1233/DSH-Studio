import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ControlError,
  ControlErrorCode,
  adaptUsage,
  aggregateUsageRecords,
  createUsageAggregator,
  createUsageLedger,
  createUsageReadModel,
  ingestUsage,
  usageBucketKey,
} from '../../workbench-core/src/index.js'

const T0 = '2026-01-01T00:00:00.000Z'
const T1 = '2026-01-01T01:00:00.000Z'
const T2 = '2026-01-02T01:00:00.000Z'
const T3 = '2026-01-03T01:00:00.000Z'

function usage(id, raw, observedAt, attribution = {}, options = {}) {
  return adaptUsage(raw, {
    sessionId: 'session-a',
    turnId: 'turn-a',
    requestId: `request-${id}`,
    messageId: `message-${id}`,
    eventId: id,
    eventType: 'assistant/message',
    source: 'runtime',
    workspaceId: 'workspace-a',
    ...attribution,
  }, { observedAt, ...options })
}

function ledgerOf(records) {
  let ledger = createUsageLedger()
  for (const record of records) ledger = ingestUsage(ledger, record, record.observedAt ?? T0).state
  return ledger
}

test('X2.12 unknown usage stays null while real zero remains zero and totals are granularity-invariant', () => {
  const records = [
    usage('u1', { inputTokens: 100, outputTokens: 20, cacheReadTokens: 10, inputTokensIncludesCache: true }, T0),
    usage('u2', { outputTokens: 0 }, T1),
    usage('u3', { contextTokens: 50, maxTokens: 200 }, T2),
  ]
  const expected = {
    uncachedInputTokens: null,
    inputTokens: 100,
    outputTokens: 20,
    cachedInputTokens: 10,
    cacheReadTokens: 10,
    cacheWriteTokens: null,
    reasoningTokens: null,
    cacheHitRate: 0.1,
    cacheHitRateBasis: 'cached/input',
  }
  for (const granularity of ['day', 'week', 'month', 'year']) {
    const model = createUsageReadModel(records, { granularity })
    assert.deepEqual(model.totals, expected)
    assert.equal(model.knownEvents, 2)
    assert.equal(model.unknownEvents, 1)
    assert.equal(model.recordCount, 3)
  }
})

test('X2.12 bucket keys honor user timezone, ISO week boundaries, and configurable week start', () => {
  assert.equal(usageBucketKey('2026-01-01T00:30:00.000Z', { timeZone: 'Asia/Shanghai', granularity: 'day' }), '2026-01-01')
  assert.equal(usageBucketKey('2026-01-01T00:30:00.000Z', { timeZone: 'Asia/Shanghai', granularity: 'week' }), '2025-12-29')
  assert.equal(usageBucketKey('2026-01-01T00:30:00.000Z', { timeZone: 'Asia/Shanghai', granularity: 'week', weekStartsOn: 0 }), '2025-12-28')
  assert.equal(usageBucketKey('2026-01-01T00:30:00.000Z', { timeZone: 'Asia/Shanghai', granularity: 'month' }), '2026-01')
  assert.equal(usageBucketKey('2026-01-01T00:30:00.000Z', { timeZone: 'Asia/Shanghai', granularity: 'year' }), '2026')
  assert.equal(usageBucketKey('2026-01-01T02:00:00.000Z', { timeZone: 'America/New_York', granularity: 'day' }), '2025-12-31')
})

test('X2.12 time range is inclusive and asOf excludes future records with visible coverage', () => {
  const records = [
    usage('u1', { inputTokens: 10 }, T0),
    usage('u2', { inputTokens: 20 }, T2),
    usage('u3', { inputTokens: 30 }, T3),
  ]
  const ranged = createUsageReadModel(records, { from: T0, to: T2 })
  assert.equal(ranged.totals.inputTokens, 30)
  assert.equal(ranged.coverage.outOfRangeEvents, 1)
  assert.deepEqual(ranged.range, { from: T0, to: T2 })

  const asOf = createUsageReadModel(records, { asOf: T2 })
  assert.equal(asOf.totals.inputTokens, 30)
  assert.equal(asOf.coverage.futureEvents, 1)
  assert.equal(asOf.coverage.knownEvents, 2)
})

test('X2.12 cache hit rate follows includesCache and remains null when the basis is unknown', () => {
  const included = usage('included', { inputTokens: 100, cacheReadTokens: 25, inputTokensIncludesCache: true }, T0)
  const excluded = usage('excluded', { inputTokens: 100, cacheReadTokens: 25, inputTokensIncludesCache: false }, T1)
  const unknown = usage('unknown', { inputTokens: 100, cacheReadTokens: 25 }, T2)
  assert.equal(createUsageReadModel([included]).totals.cacheHitRate, 0.25)
  assert.equal(createUsageReadModel([included]).totals.cacheHitRateBasis, 'cached/input')
  assert.equal(createUsageReadModel([excluded]).totals.cacheHitRate, 0.2)
  assert.equal(createUsageReadModel([excluded]).totals.cacheHitRateBasis, 'cached/(input+cached)')
  assert.equal(createUsageReadModel([unknown]).totals.cacheHitRate, null)
  assert.equal(createUsageReadModel([unknown]).totals.cacheHitRateBasis, null)
  const mixed = createUsageReadModel([included, excluded])
  assert.equal(mixed.totals.cacheHitRate, 50 / 225)
  assert.equal(mixed.totals.cacheHitRateBasis, 'mixed')
})

test('X2.12 context is a latest snapshot and currentTurn is isolated by session and turn', () => {
  const records = [
    usage('u1', { inputTokens: 10, contextTokens: 100, maxTokens: 1000 }, T0),
    usage('u2', { inputTokens: 20, contextTokens: 300, maxTokens: 1000 }, T1),
    usage('u3', { inputTokens: 999, contextTokens: 900, maxTokens: 1000 }, T2, { sessionId: 'session-b', turnId: 'turn-b' }),
  ]
  const model = createUsageReadModel(records, { currentTurn: { sessionId: 'session-a', turnId: 'turn-a' } })
  assert.deepEqual(model.context, {
    usedTokens: 900,
    windowTokens: 1000,
    ratio: 0.9,
    source: 'runtime',
    observedAt: T2,
  })
  assert.equal(model.currentTurn.totals.inputTokens, 30)
  assert.equal(model.currentTurn.recordCount, 2)
  assert.equal(model.currentTurn.context.usedTokens, 300)
  assert.equal(model.currentTurn.context.ratio, 0.3)

  const zeroWindow = createUsageReadModel([usage('zero', { contextTokens: 10, maxTokens: 0 }, T0)])
  assert.equal(zeroWindow.context.ratio, null)
})

test('X2.12 corrections replace prior values once and marked possible duplicates do not inflate totals', () => {
  const original = usage('original', { inputTokens: 100, outputTokens: 10 }, T0)
  const correction = usage('correction', { inputTokens: 120, outputTokens: 12 }, T1, {}, { correctionOf: original.usageId })
  const duplicate = { ...usage('duplicate', { inputTokens: 999, outputTokens: 99 }, T2), possibleDuplicate: true }
  let ledger = ledgerOf([original, correction, duplicate])
  const before = createUsageReadModel(ledger)
  assert.equal(before.totals.inputTokens, 120)
  assert.equal(before.totals.outputTokens, 12)
  assert.equal(before.recordCount, 1)
  assert.equal(before.coverage.possibleDuplicateEvents, 1)

  const replay = ingestUsage(ledger, correction, T1)
  assert.equal(replay.status, 'duplicate')
  ledger = replay.state
  assert.deepEqual(createUsageReadModel(ledger), before)
})

test('X2.12 unattributed usage is visible in coverage but never enters a concrete current turn', () => {
  const attributed = usage('u1', { inputTokens: 10 }, T0)
  const unattributed = usage('u2', { inputTokens: 5 }, T1, {
    sessionId: 'unattributed',
    turnId: null,
    attribution: 'unattributed',
    source: 'provider',
  })
  const model = createUsageReadModel([attributed, unattributed], {
    currentTurn: { sessionId: 'session-a', turnId: 'turn-a' },
  })
  assert.equal(model.totals.inputTokens, 15)
  assert.equal(model.coverage.unattributedEvents, 1)
  assert.deepEqual(model.coverage.sources, { provider: 1, runtime: 1 })
  assert.equal(model.currentTurn.totals.inputTokens, 10)
  assert.equal(model.currentTurn.recordCount, 1)

  const scoped = createUsageReadModel([attributed, unattributed], { sessionId: 'session-a' })
  assert.equal(scoped.totals.inputTokens, 10)
  assert.equal(scoped.coverage.excludedByScopeEvents, 1)
  assert.deepEqual(scoped.coverage.sources, { runtime: 1 })
})

test('X2.12 records without a usable timestamp are counted and only excluded when time filtering requires it', () => {
  const record = usage('undated', { inputTokens: 7 }, null)
  const unbounded = createUsageReadModel([record])
  assert.equal(unbounded.totals.inputTokens, 7)
  assert.equal(unbounded.coverage.unknownTimeEvents, 1)
  assert.deepEqual(unbounded.buckets, [])

  const bounded = createUsageReadModel([record], { from: T0, to: T2 })
  assert.equal(bounded.totals.inputTokens, null)
  assert.equal(bounded.coverage.unknownTimeEvents, 1)
  assert.equal(bounded.recordCount, 0)
})

test('X2.12 aggregator wraps ledger ingestion and read models are deterministic under record replay order', () => {
  const records = [
    usage('u1', { inputTokens: 10, outputTokens: 1 }, T2),
    usage('u2', { inputTokens: 20, outputTokens: 2 }, T0),
    usage('u3', { outputTokens: 3 }, T1),
  ]
  const aggregator = createUsageAggregator()
  for (const record of records) assert.equal(aggregator.ingest(record, record.observedAt).status, 'accepted')
  const model = aggregator.read({ granularity: 'week', timeZone: 'Asia/Shanghai' })
  assert.equal(model.revision, 3)
  assert.equal(aggregator.revision(), 3)
  assert.equal(JSON.parse(aggregator.snapshot()).records[records[0].usageId].usageId, records[0].usageId)
  assert.equal(aggregator.report().active.length, 3)

  for (let index = 0; index < 20; index += 1) {
    const reordered = index % 2 === 0 ? [...records].reverse() : [...records.slice(1), records[0]]
    assert.deepEqual(aggregateUsageRecords(reordered, { granularity: 'week', timeZone: 'Asia/Shanghai' }), aggregateUsageRecords(records, { granularity: 'week', timeZone: 'Asia/Shanghai' }))
  }
})

test('X2.12 invalid options and corrupt records fail explicitly', () => {
  assert.throws(
    () => createUsageReadModel([], { granularity: 'hour' }),
    (error) => error instanceof ControlError && error.code === ControlErrorCode.INVALID_ARGUMENT,
  )
  assert.throws(
    () => createUsageReadModel([], { timeZone: 'Not/AZone' }),
    (error) => error.code === ControlErrorCode.INVALID_ARGUMENT,
  )
  assert.throws(
    () => createUsageReadModel([], { from: T2, to: T0 }),
    (error) => error.code === ControlErrorCode.INVALID_ARGUMENT,
  )
  assert.throws(
    () => usageBucketKey(T0, null),
    (error) => error.code === ControlErrorCode.INVALID_ARGUMENT,
  )
  assert.throws(
    () => createUsageReadModel([{ schemaVersion: 1 }]),
    (error) => error.code === ControlErrorCode.CORRUPT_RECORD,
  )
})
