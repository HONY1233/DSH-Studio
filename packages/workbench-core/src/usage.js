/** Usage extraction and deterministic attribution for X1.6. */
import {
  ControlError,
  ControlErrorCode,
  cloneJson,
  isPlainRecord,
  stableStringify,
} from './control.js'

export const USAGE_SCHEMA_VERSION = 1
export const USAGE_NUMERIC_FIELDS = Object.freeze([
  'uncachedInputTokens',
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'reasoningTokens',
  'contextTokens',
  'maxTokens',
])

/**
 * Non-cryptographic deterministic fingerprint for deduplication/integrity
 * checks. It is not a credential hash or a security boundary.
 */
export function rawUsageHash(value) {
  const canonical = stableStringify(value)
  if (typeof canonical !== 'string') {
    throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, 'rawUsageHash 只能处理可 JSON 序列化的值')
  }
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < canonical.length; index += 1) {
    const code = canonical.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193) >>> 0
    second = Math.imul(second ^ (code + index), 0x85ebca6b) >>> 0
  }
  return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`
}

function validAttribution(value) {
  return isPlainRecord(value) && typeof value.sessionId === 'string' && value.sessionId.length > 0
}

function normalizeUsage(raw) {
  const normalized = {}
  let knownFields = 0
  for (const field of USAGE_NUMERIC_FIELDS) {
    if (!(field in raw)) continue
    const value = raw[field]
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, `usage.${field} 必须是非负安全整数`)
    }
    normalized[field] = value
    knownFields += 1
  }
  if (knownFields === 0) throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, 'usage 没有可识别的 token 字段')
  return normalized
}

export function adaptUsage(raw, attribution, options = {}) {
  if (!isPlainRecord(raw)) throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, 'raw usage 必须是对象')
  if (!validAttribution(attribution)) throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, 'usage attribution 缺少 sessionId')
  if (!isPlainRecord(options)) throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, 'usage options 必须是对象')
  const normalized = normalizeUsage(raw)
  const hash = rawUsageHash(raw)
  const identity = {
    sessionId: attribution.sessionId,
    turnId: attribution.turnId ?? null,
    messageId: attribution.messageId ?? null,
    eventType: attribution.eventType ?? null,
    eventId: attribution.eventId ?? null,
    sequence: attribution.sequence ?? null,
  }
  const usageId = `usage:${rawUsageHash(identity)}:${hash}`
  const record = {
    schemaVersion: USAGE_SCHEMA_VERSION,
    usageId,
    rawUsageHash: hash,
    attribution: cloneJson(attribution),
    observedAt: options.observedAt ?? attribution.observedAt ?? null,
    normalized,
    raw: cloneJson(raw),
    correctionOf: options.correctionOf ?? null,
  }
  if (record.correctionOf !== null && (typeof record.correctionOf !== 'string' || !record.correctionOf)) {
    throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, 'correctionOf 必须是非空 usageId')
  }
  return record
}

/** Extract only real usage positions; missing turn/end usage stays null. */
export function adaptUsageFromEvent(event) {
  if (!isPlainRecord(event) || typeof event.type !== 'string') return null
  let raw = null
  let source = null
  if (event.type === 'assistant/message' && isPlainRecord(event.data?.usage)) {
    raw = event.data.usage
    source = 'assistant/message.data.usage'
  } else if (event.type === 'turn/end') {
    if (isPlainRecord(event.data?.usage)) {
      raw = event.data.usage
      source = 'turn/end.data.usage'
    } else if (isPlainRecord(event.data?.result?.usage)) {
      raw = event.data.result.usage
      source = 'turn/end.data.result.usage'
    }
  }
  if (!raw) return null
  return adaptUsage(raw, {
    sessionId: event.sessionId,
    turnId: event.data?.turn ?? event.data?.turnId ?? null,
    messageId: event.data?.message?.id ?? event.data?.messageId ?? null,
    eventType: event.type,
    eventId: event.eventId ?? null,
    sequence: event.sequence ?? null,
    source,
    observedAt: event.occurredAt ?? null,
  }, { observedAt: event.occurredAt ?? null })
}

export function validateUsageRecord(record) {
  if (!isPlainRecord(record) || record.schemaVersion !== USAGE_SCHEMA_VERSION) {
    throw new ControlError(ControlErrorCode.CORRUPT_RECORD, 'usage schemaVersion 不受支持')
  }
  if (typeof record.usageId !== 'string' || !record.usageId) {
    throw new ControlError(ControlErrorCode.CORRUPT_RECORD, 'usageId 缺失')
  }
  if (!isPlainRecord(record.raw) || rawUsageHash(record.raw) !== record.rawUsageHash) {
    throw new ControlError(ControlErrorCode.CORRUPT_RECORD, 'rawUsageHash 与原始用量不一致')
  }
  if (!validAttribution(record.attribution)) {
    throw new ControlError(ControlErrorCode.CORRUPT_RECORD, 'usage attribution 无效')
  }
  if (!isPlainRecord(record.normalized)) {
    throw new ControlError(ControlErrorCode.CORRUPT_RECORD, 'normalized usage 缺失')
  }
  normalizeUsage(record.normalized)
  for (const field of USAGE_NUMERIC_FIELDS) {
    if (Object.hasOwn(record.raw, field) !== Object.hasOwn(record.normalized, field)
      || record.raw[field] !== record.normalized[field]) {
      throw new ControlError(ControlErrorCode.CORRUPT_RECORD, `normalized usage 与 raw usage 的 ${field} 不一致`)
    }
  }
  if (record.correctionOf !== null && (typeof record.correctionOf !== 'string' || !record.correctionOf)) {
    throw new ControlError(ControlErrorCode.CORRUPT_RECORD, 'correctionOf 无效')
  }
  return true
}
