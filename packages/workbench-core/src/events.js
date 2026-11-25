/**
 * Pure session event envelope router for X1.5.
 *
 * Runtime sequence gaps are buffered, never skipped. Events are delivered only
 * to current owner leases; the same session may fan out to multiple views while
 * still consuming one Runtime event. No event is broadcast to unowned sessions.
 */
import {
  ControlError,
  ControlErrorCode,
  cloneJson,
  isPlainRecord,
  stableStringify,
} from './control.js'

export const EVENT_SCHEMA_VERSION = 1

function string(value, name, max = 512) {
  if (typeof value !== 'string' || !value || value.length > max) {
    throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, `${name} 必须是非空字符串`)
  }
  return value
}

function sequence(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, `${name} 必须是非负安全整数`)
  }
  return value
}

export function createSessionEvent(input = {}) {
  if (!isPlainRecord(input) || input.schemaVersion !== EVENT_SCHEMA_VERSION) {
    throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, 'session event schemaVersion 不受支持')
  }
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) {
    throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, 'event sequence 必须是正安全整数')
  }
  if (!isPlainRecord(input.data)) throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, 'event data 必须是对象')
  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    eventId: string(input.eventId, 'eventId'),
    sessionId: string(input.sessionId, 'sessionId'),
    sequence: input.sequence,
    type: string(input.type, 'type', 256),
    occurredAt: string(input.occurredAt, 'occurredAt'),
    originLease: input.originLease == null ? null : string(input.originLease, 'originLease'),
    data: cloneJson(input.data),
  }
}

export function createEventRouter({ replayWindow = 128 } = {}) {
  if (!Number.isSafeInteger(replayWindow) || replayWindow < 1 || replayWindow > 4096) {
    throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, 'replayWindow 必须是 1..4096 的整数')
  }
  const sessions = new Map()
  const contextOwners = new Map()

  function sessionOf(sessionId) {
    string(sessionId, 'sessionId')
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, {
        sessionId,
        lastSequence: 0,
        pending: new Map(),
        seen: new Map(),
        owners: new Map(),
        delivered: new Map(),
        deliveredBySequence: new Map(),
        eventIdentities: new Map(),
        acknowledgements: new Map(),
      })
    }
    return sessions.get(sessionId)
  }

  function purgeSeen(session) {
    const cutoff = session.lastSequence - replayWindow
    for (const seq of session.seen.keys()) {
      if (seq >= cutoff) continue
      session.seen.delete(seq)
      const eventId = session.deliveredBySequence.get(seq)
      if (eventId) {
        session.delivered.delete(eventId)
        session.acknowledgements.delete(eventId)
        const identity = session.eventIdentities.get(eventId)
        if (identity?.sequence === seq) session.eventIdentities.delete(eventId)
      }
      session.deliveredBySequence.delete(seq)
    }
  }

  function leaseFor(contextId, sessionId, leaseId, generation) {
    return {
      contextId: string(contextId, 'contextId'),
      sessionId: string(sessionId, 'sessionId'),
      leaseId: string(leaseId, 'leaseId'),
      generation: sequence(generation, 'lease generation'),
    }
  }

  function sameLease(left, right) {
    return left?.contextId === right?.contextId
      && left?.sessionId === right?.sessionId
      && left?.leaseId === right?.leaseId
      && left?.generation === right?.generation
  }

  function flush(session) {
    const deliveries = []
    if (session.owners.size === 0) return deliveries
    while (session.pending.has(session.lastSequence + 1)) {
      const seq = session.lastSequence + 1
      const event = session.pending.get(seq)
      const eventFingerprint = stableStringify(event)
      session.pending.delete(seq)
      session.lastSequence = seq
      session.seen.set(seq, eventFingerprint)
      session.delivered.set(event.eventId, eventFingerprint)
      session.deliveredBySequence.set(seq, event.eventId)
      session.eventIdentities.set(event.eventId, { sequence: seq, fingerprint: eventFingerprint })
      for (const lease of session.owners.values()) {
        deliveries.push({
          deliveryId: `${event.eventId}:${lease.leaseId}:${lease.generation}`,
          lease: cloneJson(lease),
          event: cloneJson(event),
        })
      }
    }
    purgeSeen(session)
    return deliveries
  }

  function registerSession(sessionId, lastSequence = 0) {
    const session = sessionOf(sessionId)
    const baseline = sequence(lastSequence, 'lastSequence')
    if (baseline > session.lastSequence) {
      if (session.pending.size > 0 || session.delivered.size > 0) {
        throw new ControlError(ControlErrorCode.CONFLICT, '已有事件后不能前移 session baseline')
      }
      session.lastSequence = baseline
    }
    return snapshot(session.sessionId)
  }

  function leaseOwner(sessionId, contextId, leaseId, generation) {
    const session = sessionOf(sessionId)
    const lease = leaseFor(contextId, sessionId, leaseId, generation)
    const previous = contextOwners.get(contextId)
    if (previous && previous.sessionId !== sessionId) {
      sessionOf(previous.sessionId).owners.delete(contextId)
    }
    session.owners.set(contextId, lease)
    contextOwners.set(contextId, lease)
    return flush(session)
  }

  function releaseOwner(sessionId, contextId, expectedLease) {
    const session = sessionOf(sessionId)
    const current = session.owners.get(contextId)
    if (!current) return false
    const expected = leaseFor(contextId, sessionId, expectedLease?.leaseId, expectedLease?.generation)
    if (!sameLease(current, expected)) {
      throw new ControlError(ControlErrorCode.OWNER_MISMATCH, '旧 owner lease 不能释放当前订阅')
    }
    session.owners.delete(contextId)
    if (sameLease(contextOwners.get(contextId), expected)) contextOwners.delete(contextId)
    return true
  }

  function ingest(rawEvent) {
    const event = createSessionEvent(rawEvent)
    const session = sessionOf(event.sessionId)
    const eventFingerprint = stableStringify(event)
    const identity = session.eventIdentities.get(event.eventId)
    if (identity) {
      if (identity.fingerprint === eventFingerprint) return { status: 'duplicate', deliveries: [] }
      return {
        status: 'conflict',
        error: { code: ControlErrorCode.CONFLICT, message: '同一 eventId 对应不同事件内容或 sequence' },
        deliveries: [],
      }
    }
    if (event.sequence <= session.lastSequence) {
      if (session.seen.get(event.sequence) === eventFingerprint) return { status: 'duplicate', deliveries: [] }
      if (session.seen.has(event.sequence)) {
        return {
          status: 'conflict',
          error: { code: ControlErrorCode.CONFLICT, message: '同一 sequence 对应不同事件' },
          deliveries: [],
        }
      }
      return { status: 'stale', deliveries: [] }
    }
    const pending = session.pending.get(event.sequence)
    if (pending) {
      if (stableStringify(pending) === eventFingerprint) return { status: 'duplicate', deliveries: [] }
      return {
        status: 'conflict',
        error: { code: ControlErrorCode.CONFLICT, message: '同一 sequence 对应不同事件' },
        deliveries: [],
      }
    }
    if (session.pending.size >= replayWindow) {
      return {
        status: 'rejected',
        error: { code: ControlErrorCode.BUFFER_OVERFLOW, message: '未补齐事件超过路由缓冲上限' },
        deliveries: [],
      }
    }
    session.pending.set(event.sequence, event)
    session.eventIdentities.set(event.eventId, { sequence: event.sequence, fingerprint: eventFingerprint })
    const deliveries = flush(session)
    const expected = session.lastSequence + 1
    const received = Math.min(...session.pending.keys())
    const gap = session.pending.size > 0 && received > expected
      ? { expected, received, missingFrom: expected, missingTo: received - 1 }
      : null
    if (deliveries.length > 0) return { status: 'delivered', deliveries, gap }
    return {
      status: gap ? 'buffered-gap' : (session.owners.size === 0 ? 'buffered-unowned' : 'buffered-gap'),
      deliveries: [],
      gap,
    }
  }

  function acknowledge(sessionId, contextId, eventId, expectedLease) {
    const session = sessionOf(sessionId)
    const lease = leaseFor(contextId, sessionId, expectedLease?.leaseId, expectedLease?.generation)
    const current = session.owners.get(contextId)
    if (!sameLease(current, lease)) {
      throw new ControlError(ControlErrorCode.OWNER_MISMATCH, '只有当前 owner lease 可以确认事件')
    }
    const fingerprint = session.delivered.get(eventId)
    if (!fingerprint) return { status: 'not-delivered' }
    const key = `${lease.leaseId}:${lease.generation}`
    const acknowledged = session.acknowledgements.get(eventId) ?? new Set()
    if (acknowledged.has(key)) return { status: 'duplicate' }
    acknowledged.add(key)
    session.acknowledgements.set(eventId, acknowledged)
    return { status: 'acknowledged' }
  }

  function snapshot(sessionId) {
    const session = sessionOf(sessionId)
    const expected = session.lastSequence + 1
    const received = session.pending.size > 0 ? Math.min(...session.pending.keys()) : null
    return {
      sessionId,
      lastSequence: session.lastSequence,
      pendingSequences: [...session.pending.keys()].sort((a, b) => a - b),
      owners: [...session.owners.values()].map(cloneJson),
      gap: received != null && received > expected
        ? { expected, received, missingFrom: expected, missingTo: received - 1 }
        : null,
    }
  }

  return {
    registerSession,
    leaseOwner,
    releaseOwner,
    ingest,
    acknowledge,
    snapshot,
  }
}
