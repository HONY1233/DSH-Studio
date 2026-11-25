/** Pure idempotent UsageLedger with visible corruption and correction replay. */
import {
  ControlError,
  ControlErrorCode,
  cloneJson,
  isPlainRecord,
  stableStringify,
} from './control.js'
import {
  USAGE_NUMERIC_FIELDS,
  USAGE_SCHEMA_VERSION,
  rawUsageHash,
  validateUsageRecord,
} from './usage.js'

const LEDGER_SCHEMA_VERSION = 1

export function createUsageLedger() {
  return {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    revision: 0,
    records: {},
    pendingCorrections: {},
    corruptions: [],
  }
}

function cloneState(state) {
  return cloneJson(state)
}

function corruptionId(recordId, reason, reportedAt, line = null) {
  return `corruption:${rawUsageHash({ recordId, reason, reportedAt, line })}`
}

function addCorruption(state, input) {
  const reportedAt = input.reportedAt
  if (typeof reportedAt !== 'string' || !reportedAt) {
    throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, 'reportedAt 必须是非空时间字符串')
  }
  const corruption = {
    corruptionId: corruptionId(input.recordId ?? null, input.reason, reportedAt, input.line ?? null),
    code: input.code ?? ControlErrorCode.CORRUPT_RECORD,
    reason: input.reason,
    message: input.message,
    recordId: input.recordId ?? null,
    recordHash: input.recordHash ?? null,
    reportedAt,
    line: input.line ?? null,
  }
  if (!state.corruptions.some((item) => item.corruptionId === corruption.corruptionId)) {
    state.corruptions.push(corruption)
    state.revision += 1
  }
}

export function reportUsageCorruption(state, input) {
  const next = cloneState(state)
  addCorruption(next, input)
  return next
}

function fingerprint(record) {
  return stableStringify(record)
}

function hasCorrectionCycle(state, record) {
  const visited = new Set([record.usageId])
  let current = record
  while (current?.correctionOf) {
    const targetId = current.correctionOf
    if (visited.has(targetId)) return true
    visited.add(targetId)
    current = state.records[targetId] ?? state.pendingCorrections[targetId]
  }
  return false
}

function applyCorrection(state, correction) {
  const target = state.records[correction.correctionOf]
  if (!target) return false
  if (target.usageId === correction.usageId) {
    addCorruption(state, {
      recordId: correction.usageId,
      reason: 'self-correction',
      message: '用量修正不能指向自身',
      reportedAt: correction.observedAt ?? 'unknown',
    })
    return true
  }
  target.active = false
  target.supersededBy = correction.usageId
  correction.active = true
  correction.supersedes = target.usageId
  correction.supersededBy = null
  state.records[correction.usageId] = { ...cloneJson(correction), ledgerFingerprint: fingerprint(correction) }
  state.revision += 1
  for (const pending of Object.values(state.pendingCorrections)) {
    if (pending.correctionOf === correction.usageId) {
      delete state.pendingCorrections[pending.usageId]
      applyCorrection(state, pending)
    }
  }
  return true
}

function acceptRecord(state, record) {
  if (record.correctionOf) {
    if (applyCorrection(state, record)) return
    state.pendingCorrections[record.usageId] = cloneJson(record)
    state.revision += 1
    return
  }
  state.records[record.usageId] = {
    ...cloneJson(record),
    active: true,
    supersededBy: null,
    supersedes: null,
    ledgerFingerprint: fingerprint(record),
  }
  state.revision += 1
  for (const correction of Object.values(state.pendingCorrections)) {
    if (correction.correctionOf === record.usageId) {
      delete state.pendingCorrections[correction.usageId]
      applyCorrection(state, correction)
    }
  }
}

function corruptionHash(value) {
  if (value == null) return null
  try {
    return rawUsageHash(value)
  } catch {
    return null
  }
}

export function ingestUsage(state, rawRecord, reportedAt) {
  const next = cloneState(state)
  let record
  try {
    record = cloneJson(rawRecord)
    validateUsageRecord(record)
  } catch (error) {
    addCorruption(next, {
      recordId: isPlainRecord(rawRecord) && typeof rawRecord.usageId === 'string' ? rawRecord.usageId : null,
      reason: error?.code ?? ControlErrorCode.CORRUPT_RECORD,
      message: error?.message ?? '用量记录损坏',
      recordHash: corruptionHash(rawRecord),
      reportedAt,
    })
    return { state: next, status: 'corrupt', revision: next.revision }
  }
  const recordHash = fingerprint(record)
  if (record.correctionOf === record.usageId) {
    addCorruption(next, {
      recordId: record.usageId,
      reason: 'self-correction',
      message: '用量修正不能指向自身',
      recordHash,
      reportedAt,
    })
    return { state: next, status: 'corrupt', revision: next.revision }
  }
  if (record.correctionOf && hasCorrectionCycle(next, record)) {
    addCorruption(next, {
      recordId: record.usageId,
      code: ControlErrorCode.CONFLICT,
      reason: 'correction-cycle',
      message: '用量修正链形成循环',
      recordHash,
      reportedAt,
    })
    return { state: next, status: 'conflict', revision: next.revision }
  }
  const existing = next.records[record.usageId]
  const pending = next.pendingCorrections[record.usageId]
  if (existing || pending) {
    const storedFingerprint = existing?.ledgerFingerprint ?? fingerprint(existing ?? pending)
    if (storedFingerprint === recordHash) return { state, status: 'duplicate', revision: state.revision }
    addCorruption(next, {
      recordId: record.usageId,
      code: ControlErrorCode.CONFLICT,
      reason: ControlErrorCode.CONFLICT,
      message: '同一 usageId 对应不同用量内容',
      recordHash,
      reportedAt,
    })
    return { state: next, status: 'conflict', revision: next.revision }
  }
  acceptRecord(next, record)
  const status = next.pendingCorrections[record.usageId] ? 'pending-correction' : 'accepted'
  return { state: next, status, revision: next.revision }
}

export function activeUsageRecords(state) {
  return Object.values(state.records).filter((record) => record.active).map(cloneJson)
}

export function usageTotals(state) {
  const records = activeUsageRecords(state)
  const totals = {}
  const coverage = Object.fromEntries(USAGE_NUMERIC_FIELDS.map((field) => [field, 0]))
  for (const record of records) {
    for (const field of USAGE_NUMERIC_FIELDS) {
      if (Object.hasOwn(record.normalized, field)) {
        totals[field] = (totals[field] ?? 0) + record.normalized[field]
        coverage[field] += 1
      }
    }
  }
  return {
    activeRecords: records.length,
    totals,
    coverage,
    incompleteRecords: records.filter((record) => USAGE_NUMERIC_FIELDS.some((field) => !Object.hasOwn(record.normalized, field))).length,
  }
}

export function usageLedgerReport(state) {
  return {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    revision: state.revision,
    active: activeUsageRecords(state),
    superseded: Object.values(state.records).filter((record) => !record.active).map(cloneJson),
    pendingCorrections: Object.values(state.pendingCorrections).map(cloneJson),
    corruptions: cloneJson(state.corruptions),
  }
}

export function serializeUsageLedger(state) {
  if (!isPlainRecord(state) || state.schemaVersion !== LEDGER_SCHEMA_VERSION) {
    throw new ControlError(ControlErrorCode.CORRUPT_RECORD, 'UsageLedger 格式或版本不受支持')
  }
  return JSON.stringify(state)
}

export function restoreUsageLedger(serialized) {
  if (typeof serialized !== 'string') throw new ControlError(ControlErrorCode.CORRUPT_RECORD, 'UsageLedger 快照必须是 JSON 字符串')
  let state
  try {
    state = JSON.parse(serialized)
  } catch {
    throw new ControlError(ControlErrorCode.CORRUPT_RECORD, 'UsageLedger 快照不是合法 JSON')
  }
  if (!isPlainRecord(state)
    || state.schemaVersion !== LEDGER_SCHEMA_VERSION
    || !Number.isSafeInteger(state.revision)
    || state.revision < 0
    || !isPlainRecord(state.records)
    || !isPlainRecord(state.pendingCorrections)
    || !Array.isArray(state.corruptions)) {
    throw new ControlError(ControlErrorCode.CORRUPT_RECORD, 'UsageLedger 快照结构无效')
  }
  for (const record of [...Object.values(state.records), ...Object.values(state.pendingCorrections)]) validateUsageRecord(record)
  for (const record of Object.values(state.records)) {
    if (typeof record.active !== 'boolean'
      || (record.supersededBy !== null && typeof record.supersededBy !== 'string')
      || (record.supersedes !== null && typeof record.supersedes !== 'string')
      || (record.correctionOf && !state.records[record.correctionOf])) {
      throw new ControlError(ControlErrorCode.CORRUPT_RECORD, 'UsageLedger 修正链或有效状态无效')
    }
  }
  for (const record of Object.values(state.pendingCorrections)) {
    if (!record.correctionOf || state.records[record.correctionOf] || hasCorrectionCycle(state, record)) {
      throw new ControlError(ControlErrorCode.CORRUPT_RECORD, 'UsageLedger 待应用修正无效')
    }
  }
  for (const corruption of state.corruptions) {
    if (!isPlainRecord(corruption)
      || typeof corruption.corruptionId !== 'string'
      || typeof corruption.reason !== 'string'
      || typeof corruption.message !== 'string') {
      throw new ControlError(ControlErrorCode.CORRUPT_RECORD, 'UsageLedger 损坏报告无效')
    }
  }
  return state
}

export const usageLedgerSchemaVersion = LEDGER_SCHEMA_VERSION
export const usageRecordSchemaVersion = USAGE_SCHEMA_VERSION
