/** Pure usage aggregation and read-model derivation for X2.12. */
import {
  ControlError,
  ControlErrorCode,
  cloneJson,
  isPlainRecord,
} from './control.js'
import {
  activeUsageRecords,
  createUsageLedger,
  ingestUsage,
  serializeUsageLedger,
  usageLedgerReport,
  usageLedgerSchemaVersion,
  restoreUsageLedger,
} from './ledger.js'
import {
  validateUsageRecord,
} from './usage.js'

export const USAGE_READ_MODEL_SCHEMA_VERSION = 1
export const USAGE_GRANULARITIES = Object.freeze(['day', 'week', 'month', 'year'])

const FLOW_FIELDS = Object.freeze([
  'uncachedInputTokens',
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'reasoningTokens',
])

const formatterCache = new Map()

function invalid(message) {
  return new ControlError(ControlErrorCode.INVALID_ARGUMENT, message)
}

function pad(value, length = 2) {
  return String(value).padStart(length, '0')
}

function assertOptionalString(value, name) {
  if (value != null && (typeof value !== 'string' || value.length === 0)) {
    throw invalid(`${name} 必须是非空字符串`)
  }
  return value ?? null
}

function parseInstant(value, name) {
  if (typeof value !== 'string' || value.length === 0) throw invalid(`${name} 必须是非空时间字符串`)
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds)) throw invalid(`${name} 不是合法时间`)
  return { value, milliseconds }
}

function normalizeOptions(options) {
  if (!isPlainRecord(options)) throw invalid('usage read-model options 必须是对象')
  const granularity = options.granularity ?? 'day'
  if (!USAGE_GRANULARITIES.includes(granularity)) {
    throw invalid(`granularity 必须是 ${USAGE_GRANULARITIES.join('/')}`)
  }
  const timeZone = options.timeZone ?? 'UTC'
  try {
    formatter(timeZone)
  } catch {
    throw invalid(`timeZone 不受支持：${timeZone}`)
  }
  const weekStartsOn = options.weekStartsOn ?? 1
  if (weekStartsOn !== 0 && weekStartsOn !== 1) throw invalid('weekStartsOn 必须是 0 或 1')
  const from = options.from == null ? null : parseInstant(options.from, 'from')
  const to = options.to == null ? null : parseInstant(options.to, 'to')
  const asOf = options.asOf == null ? null : parseInstant(options.asOf, 'asOf')
  if (from && to && from.milliseconds > to.milliseconds) throw invalid('from 不能晚于 to')
  const sessionId = assertOptionalString(options.sessionId, 'sessionId')
  const workspaceId = assertOptionalString(options.workspaceId, 'workspaceId')
  const turnId = assertOptionalString(options.turnId, 'turnId')
  let currentTurn = null
  if (options.currentTurn != null) {
    if (!isPlainRecord(options.currentTurn)) throw invalid('currentTurn 必须是对象')
    currentTurn = {
      sessionId: assertOptionalString(options.currentTurn.sessionId, 'currentTurn.sessionId'),
      turnId: assertOptionalString(options.currentTurn.turnId, 'currentTurn.turnId'),
    }
    if (!currentTurn.sessionId || !currentTurn.turnId) throw invalid('currentTurn 需要 sessionId 和 turnId')
  }
  return { granularity, timeZone, weekStartsOn, from, to, asOf, sessionId, workspaceId, turnId, currentTurn }
}

function formatter(timeZone) {
  let value = formatterCache.get(timeZone)
  if (!value) {
    value = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hourCycle: 'h23',
    })
    formatterCache.set(timeZone, value)
  }
  return value
}

function localDate(milliseconds, timeZone) {
  const parts = formatter(timeZone).formatToParts(new Date(milliseconds))
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  const year = Number(values.year)
  const month = Number(values.month)
  const day = Number(values.day)
  if (![year, month, day].every(Number.isSafeInteger)) throw invalid('无法解析本地日期')
  return { year, month, day }
}

function formatLocalDate({ year, month, day }) {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`
}

/** Return a stable local-calendar bucket key for an instant. */
export function usageBucketKey(instant, options = {}) {
  if (!isPlainRecord(options)) throw invalid('usage bucket options 必须是对象')
  const normalized = normalizeOptions({
    granularity: options.granularity,
    timeZone: options.timeZone,
    weekStartsOn: options.weekStartsOn,
  })
  const parsed = parseInstant(instant, 'instant')
  const date = localDate(parsed.milliseconds, normalized.timeZone)
  if (normalized.granularity === 'day') return formatLocalDate(date)
  if (normalized.granularity === 'month') return `${pad(date.year, 4)}-${pad(date.month)}`
  if (normalized.granularity === 'year') return pad(date.year, 4)
  const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()
  const delta = (weekday - normalized.weekStartsOn + 7) % 7
  const start = new Date(Date.UTC(date.year, date.month - 1, date.day - delta))
  return formatLocalDate({
    year: start.getUTCFullYear(),
    month: start.getUTCMonth() + 1,
    day: start.getUTCDate(),
  })
}

function timestampOf(record) {
  const value = record.observedAt ?? record.attribution?.observedAt ?? null
  if (typeof value !== 'string' || value.length === 0) return null
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) ? { value, milliseconds } : null
}

function isPossibleDuplicate(record) {
  return record.possibleDuplicate === true
    || record.attribution?.possibleDuplicate === true
    || (typeof record.possibleDuplicateOf === 'string' && record.possibleDuplicateOf.length > 0)
    || (typeof record.attribution?.possibleDuplicateOf === 'string' && record.attribution.possibleDuplicateOf.length > 0)
}

function isUnattributed(record) {
  return record.attribution?.attribution === 'unattributed'
    || record.attribution?.sessionId === 'unattributed'
}

function sourceOf(record) {
  return record.attribution?.source ?? record.source ?? 'unknown'
}

function statusOf(record) {
  return record.status ?? record.attribution?.status ?? 'unknown'
}

function increment(object, key) {
  object[key] = (object[key] ?? 0) + 1
}

function sortedCounts(counts) {
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)))
}

function addSafe(total, value) {
  const next = total + value
  if (!Number.isSafeInteger(next)) {
    throw new ControlError(ControlErrorCode.BUFFER_OVERFLOW, '用量汇总超过安全整数范围')
  }
  return next
}

function emptyTotals() {
  return {
    uncachedInputTokens: null,
    inputTokens: null,
    outputTokens: null,
    cachedInputTokens: null,
    cacheWriteTokens: null,
    reasoningTokens: null,
    cacheHitRate: null,
    cacheHitRateBasis: null,
  }
}

function hasKnownFlow(record) {
  return FLOW_FIELDS.some((field) => Object.hasOwn(record.normalized, field))
}

function cacheContribution(record) {
  const includesCache = record.raw?.inputTokensIncludesCache
  if (typeof includesCache !== 'boolean') return null
  const cached = record.normalized.cacheReadTokens
  const input = record.normalized.inputTokens
  if (!Number.isSafeInteger(cached) || !Number.isSafeInteger(input)) return null
  if (includesCache) {
    if (input <= 0 || cached > input) return null
    return { numerator: cached, denominator: input, basis: 'cached/input' }
  }
  const denominator = input + cached
  if (!Number.isSafeInteger(denominator) || denominator <= 0) return null
  return { numerator: cached, denominator, basis: 'cached/(input+cached)' }
}

function summarize(records) {
  const totals = emptyTotals()
  const fieldCounts = Object.fromEntries(FLOW_FIELDS.map((field) => [field, 0]))
  const fieldSums = Object.fromEntries(FLOW_FIELDS.map((field) => [field, 0]))
  const cache = { numerator: 0, denominator: 0, eligible: 0, bases: new Set() }
  let knownEvents = 0
  let unknownEvents = 0
  const requestIds = new Set()
  const statuses = {}
  for (const record of records) {
    if (hasKnownFlow(record)) knownEvents += 1
    else unknownEvents += 1
    const requestId = record.attribution?.requestId
    if (typeof requestId === 'string' && requestId) requestIds.add(requestId)
    increment(statuses, statusOf(record))
    for (const field of FLOW_FIELDS) {
      if (!Object.hasOwn(record.normalized, field)) continue
      fieldCounts[field] += 1
      fieldSums[field] = addSafe(fieldSums[field], record.normalized[field])
    }
    const contribution = cacheContribution(record)
    if (contribution) {
      cache.numerator = addSafe(cache.numerator, contribution.numerator)
      cache.denominator = addSafe(cache.denominator, contribution.denominator)
      cache.eligible += 1
      cache.bases.add(contribution.basis)
    }
  }
  for (const field of FLOW_FIELDS) {
    if (fieldCounts[field] > 0) totals[field] = fieldSums[field]
  }
  totals.cachedInputTokens = totals.cacheReadTokens
  if (cache.eligible > 0 && cache.denominator > 0) {
    totals.cacheHitRate = cache.numerator / cache.denominator
    totals.cacheHitRateBasis = cache.bases.size === 1 ? [...cache.bases][0] : 'mixed'
  }
  return {
    totals,
    recordCount: records.length,
    knownEvents,
    unknownEvents,
    requestCount: requestIds.size,
    statuses: sortedCounts(statuses),
  }
}

function latestContext(records) {
  const candidates = records
    .filter((record) => Number.isSafeInteger(record.normalized.contextTokens)
      && Number.isSafeInteger(record.normalized.maxTokens))
    .map((record) => ({ record, timestamp: timestampOf(record) }))
    .filter((item) => item.timestamp)
    .sort((left, right) => right.timestamp.milliseconds - left.timestamp.milliseconds
      || left.record.usageId.localeCompare(right.record.usageId))
  if (candidates.length === 0) return null
  const { record, timestamp } = candidates[0]
  const usedTokens = record.normalized.contextTokens
  const windowTokens = record.normalized.maxTokens
  return {
    usedTokens,
    windowTokens,
    ratio: windowTokens > 0 ? usedTokens / windowTokens : null,
    source: sourceOf(record),
    observedAt: timestamp.value,
  }
}

function compareRecords(left, right) {
  const leftTime = timestampOf(left)?.milliseconds ?? -1
  const rightTime = timestampOf(right)?.milliseconds ?? -1
  return leftTime - rightTime || left.usageId.localeCompare(right.usageId)
}

function normalizeRecords(input) {
  if (Array.isArray(input)) {
    const records = input.map((record) => {
      validateUsageRecord(record)
      return cloneJson(record)
    })
    return { records, revision: null, activeRecords: records.length }
  }
  if (!isPlainRecord(input) || input.schemaVersion !== usageLedgerSchemaVersion) {
    throw invalid('usage read-model 输入必须是 UsageLedger 或 usage records 数组')
  }
  const ledger = restoreUsageLedger(serializeUsageLedger(input))
  const records = activeUsageRecords(ledger)
  for (const record of records) validateUsageRecord(record)
  return { records, revision: ledger.revision, activeRecords: records.length }
}

/** Aggregate active records without mutating the ledger or records. */
export function aggregateUsageRecords(records, options = {}) {
  if (!Array.isArray(records)) throw invalid('records 必须是数组')
  return createUsageReadModel(records, options)
}

/** Build the shared HomePage/ConversationHeader usage read model. */
export function createUsageReadModel(input, options = {}) {
  const normalizedOptions = normalizeOptions(options)
  const { records, revision, activeRecords } = normalizeRecords(input)
  const sorted = [...records].sort(compareRecords)
  const coverage = {
    from: normalizedOptions.from?.value ?? null,
    to: normalizedOptions.to?.value ?? null,
    knownEvents: 0,
    unknownEvents: 0,
    unattributedEvents: 0,
    possibleDuplicateEvents: 0,
    unknownTimeEvents: 0,
    futureEvents: 0,
    outOfRangeEvents: 0,
    excludedByScopeEvents: 0,
    sources: {},
    statuses: {},
  }
  const included = []
  for (const record of sorted) {
    if (normalizedOptions.sessionId && record.attribution?.sessionId !== normalizedOptions.sessionId) {
      coverage.excludedByScopeEvents += 1
      continue
    }
    if (normalizedOptions.workspaceId && record.attribution?.workspaceId !== normalizedOptions.workspaceId) {
      coverage.excludedByScopeEvents += 1
      continue
    }
    if (normalizedOptions.turnId && record.attribution?.turnId !== normalizedOptions.turnId) {
      coverage.excludedByScopeEvents += 1
      continue
    }
    increment(coverage.sources, sourceOf(record))
    increment(coverage.statuses, statusOf(record))
    if (isPossibleDuplicate(record)) {
      coverage.possibleDuplicateEvents += 1
      continue
    }
    const timestamp = timestampOf(record)
    if (!timestamp) {
      coverage.unknownTimeEvents += 1
      if (normalizedOptions.from || normalizedOptions.to || normalizedOptions.asOf) continue
      included.push({ record, timestamp: null })
      continue
    }
    if (normalizedOptions.asOf && timestamp.milliseconds > normalizedOptions.asOf.milliseconds) {
      coverage.futureEvents += 1
      continue
    }
    if (normalizedOptions.from && timestamp.milliseconds < normalizedOptions.from.milliseconds) {
      coverage.outOfRangeEvents += 1
      continue
    }
    if (normalizedOptions.to && timestamp.milliseconds > normalizedOptions.to.milliseconds) {
      coverage.outOfRangeEvents += 1
      continue
    }
    included.push({ record, timestamp })
  }

  const metricRecords = included.map((item) => item.record)
  const summary = summarize(metricRecords)
  coverage.knownEvents = summary.knownEvents
  coverage.unknownEvents = summary.unknownEvents
  coverage.unattributedEvents = metricRecords.filter(isUnattributed).length
  coverage.sources = sortedCounts(coverage.sources)
  coverage.statuses = sortedCounts(coverage.statuses)

  const timestamped = included.filter((item) => item.timestamp)
  if (!coverage.from && timestamped.length > 0) coverage.from = timestamped[0].timestamp.value
  if (!coverage.to && timestamped.length > 0) coverage.to = timestamped.at(-1).timestamp.value

  const bucketMap = new Map()
  for (const { record, timestamp } of timestamped) {
    const key = usageBucketKey(timestamp.value, normalizedOptions)
    if (!bucketMap.has(key)) bucketMap.set(key, [])
    bucketMap.get(key).push(record)
  }
  const buckets = [...bucketMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, bucketRecords]) => {
      const bucketSummary = summarize(bucketRecords)
      const times = bucketRecords.map(timestampOf).filter(Boolean).sort((left, right) => left.milliseconds - right.milliseconds)
      return {
        key,
        granularity: normalizedOptions.granularity,
        ...bucketSummary,
        sessionIds: [...new Set(bucketRecords.map((record) => record.attribution?.sessionId).filter(Boolean))].sort(),
        firstObservedAt: times[0]?.value ?? null,
        lastObservedAt: times.at(-1)?.value ?? null,
      }
    })

  let currentTurn = null
  if (normalizedOptions.currentTurn) {
    const turnRecords = metricRecords.filter((record) => (
      record.attribution?.sessionId === normalizedOptions.currentTurn.sessionId
      && record.attribution?.turnId === normalizedOptions.currentTurn.turnId
    ))
    if (turnRecords.length > 0) {
      currentTurn = {
        sessionId: normalizedOptions.currentTurn.sessionId,
        turnId: normalizedOptions.currentTurn.turnId,
        ...summarize(turnRecords),
        context: latestContext(turnRecords),
      }
    }
  }

  return {
    schemaVersion: USAGE_READ_MODEL_SCHEMA_VERSION,
    revision,
    activeRecords,
    granularity: normalizedOptions.granularity,
    timeZone: normalizedOptions.timeZone,
    weekStartsOn: normalizedOptions.weekStartsOn,
    range: { from: coverage.from, to: coverage.to },
    totals: summary.totals,
    recordCount: summary.recordCount,
    knownEvents: summary.knownEvents,
    unknownEvents: summary.unknownEvents,
    requestCount: summary.requestCount,
    statuses: summary.statuses,
    cacheHitRateBasis: summary.totals.cacheHitRateBasis,
    context: latestContext(metricRecords),
    currentTurn,
    buckets,
    coverage,
    lastUpdatedAt: timestamped.length > 0 ? timestamped.at(-1).timestamp.value : null,
  }
}

/** Stateful convenience wrapper around the pure ledger and read model. */
export function createUsageAggregator({ ledger = createUsageLedger() } = {}) {
  if (!isPlainRecord(ledger) || ledger.schemaVersion !== usageLedgerSchemaVersion) {
    throw invalid('createUsageAggregator 需要有效 UsageLedger')
  }
  let state = restoreUsageLedger(serializeUsageLedger(ledger))
  return {
    ingest(record, reportedAt) {
      const result = ingestUsage(state, record, reportedAt)
      state = result.state
      return result
    },
    read(options) {
      return createUsageReadModel(state, options)
    },
    snapshot() {
      return serializeUsageLedger(state)
    },
    report() {
      return usageLedgerReport(state)
    },
    revision() {
      return state.revision
    },
  }
}
