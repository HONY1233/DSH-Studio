/**
 * Additive client-side control primitives for X1.
 *
 * This module does not know about Electron, the Runtime wire, or a concrete
 * transport. It defines an idempotency boundary and an explicit capability
 * gate so an unsupported operation can never silently become a normal prompt.
 */

export const CONTROL_PROTOCOL_VERSION = 1

export const ControlErrorCode = Object.freeze({
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  CAPABILITY_UNAVAILABLE: 'CAPABILITY_UNAVAILABLE',
  UNSUPPORTED: 'UNSUPPORTED',
  OWNER_MISMATCH: 'OWNER_MISMATCH',
  SEQUENCE_GAP: 'SEQUENCE_GAP',
  BUFFER_OVERFLOW: 'BUFFER_OVERFLOW',
  CORRUPT_RECORD: 'CORRUPT_RECORD',
  STORAGE_FAILED: 'STORAGE_FAILED',
  INTERNAL: 'INTERNAL',
})

const CAPABILITY_DEFINITIONS = Object.freeze({
  'session.cancel': '当前 Runtime 没有经批准的按轮次取消方法',
  'session.steer': '当前 Runtime 没有经批准的运行中插话方法',
  'session.queue.enqueue': '当前 Runtime 没有经批准的幂等消息队列',
  'session.queue.cancel': '当前 Runtime 没有可取消的运行时消息队列',
  'session.queue.remove': '当前 Runtime 没有可取消的运行时消息队列',
  'session.queue.list': '界面本地待发状态不等于可读取的运行时队列',
  'session.queue.position': '当前 Runtime 没有可读取的队列位置；本地顺序不是 Runtime position',
  'session.draft.save': 'Runtime 草稿同步未接入；只能在本地保存未提交草稿',
})

const LOCAL_CAPABILITIES = Object.freeze({
  'draft.local': Object.freeze({ grade: 'local-only', source: 'client', reason: '仅本地草稿，不代表 Runtime 已接收' }),
  'events.local': Object.freeze({ grade: 'local-only', source: 'client', reason: '仅客户端事件路由，不代表 Runtime 支持重放' }),
  'usage.local': Object.freeze({ grade: 'local-only', source: 'client', reason: '仅本地用量适配与账本' }),
})

export class ControlError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'ControlError'
    this.code = code
    this.details = details
  }

  toJSON() {
    return { code: this.code, message: this.message, details: cloneJson(this.details) }
  }
}

export function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function cloneJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map(cloneJson)
  if (isPlainRecord(value)) {
    const out = {}
    for (const key of Object.keys(value)) out[key] = cloneJson(value[key])
    return out
  }
  throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, '控制数据必须是可 JSON 序列化的值')
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

function requiredString(value, name, maxLength) {
  if (typeof value !== 'string' || value.length === 0
    || (maxLength !== undefined && value.length > maxLength)) {
    throw new ControlError(
      ControlErrorCode.INVALID_ARGUMENT,
      maxLength === undefined ? `${name} 必须是非空字符串` : `${name} 必须是非空字符串且最多 ${maxLength} 个字符`,
    )
  }
  return value
}

function optionalRevision(value) {
  if (value === null || value === undefined) return null
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, 'revision 必须是非负安全整数')
  }
  return value
}

/** Create a deterministic additive request envelope. No transport is invoked. */
export function createControlEnvelope(input = {}) {
  if (!isPlainRecord(input)) throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, '控制 envelope 必须是对象')
  const method = requiredString(input.method, 'method')
  const requestId = requiredString(input.requestId, 'requestId', 256)
  const observedAt = requiredString(input.observedAt, 'observedAt')
  if (!isPlainRecord(input.payload ?? {})) {
    throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, 'payload 必须是对象')
  }
  return {
    schemaVersion: CONTROL_PROTOCOL_VERSION,
    requestId,
    method,
    sessionId: input.sessionId == null ? null : requiredString(input.sessionId, 'sessionId'),
    revision: optionalRevision(input.revision),
    observedAt,
    payload: cloneJson(input.payload ?? {}),
  }
}

/** Create a wire-safe success/failure receipt. Failed receipts never contain result. */
export function createControlReceipt(input = {}) {
  const requestId = requiredString(input.requestId, 'requestId', 256)
  const observedAt = requiredString(input.observedAt, 'observedAt')
  if (input.status !== 'completed' && input.status !== 'failed') {
    throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, 'status 必须是 completed 或 failed')
  }
  if (input.status === 'failed') {
    const error = input.error instanceof ControlError ? input.error.toJSON() : input.error
    if (!isPlainRecord(error) || typeof error.code !== 'string' || typeof error.message !== 'string') {
      throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, 'failed receipt 必须包含 error')
    }
    return { schemaVersion: CONTROL_PROTOCOL_VERSION, requestId, status: 'failed', observedAt, error: cloneJson(error) }
  }
  return {
    schemaVersion: CONTROL_PROTOCOL_VERSION,
    requestId,
    status: 'completed',
    observedAt,
    result: cloneJson(input.result ?? {}),
  }
}

const RUNTIME_METHODS = Object.freeze({
  'session.cancel': 'session/turn.cancel',
  'session.steer': 'session/turn.steer',
  'session.queue.enqueue': 'session/queue.enqueue',
  'session.queue.cancel': 'session/queue.cancel',
  'session.queue.remove': 'session/queue.cancel',
  'session.queue.list': 'session/queue.list',
  'session.queue.position': 'session/queue.enqueue',
  'session.draft.save': 'session/draft.put',
})

function declaredMethods(methods) {
  if (Array.isArray(methods)) {
    if (methods.some(method => typeof method !== 'string')) {
      throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, 'Runtime methods 必须都是字符串')
    }
    return new Set(methods)
  }
  if (!isPlainRecord(methods)) throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, 'methods 必须是对象或数组')
  return new Set(Object.entries(methods)
    .filter(([, declaration]) => declaration === true || (isPlainRecord(declaration) && declaration.supported === true))
    .map(([method]) => method))
}

/**
 * Negotiate only explicitly declared Runtime methods. Unknown or absent
 * methods remain unavailable. Both the pure object-map fixture and the
 * additive Runtime methods-array descriptor are accepted without inference.
 */
export function createCapabilityManifest(runtimeDescriptor = null) {
  if (runtimeDescriptor != null && !isPlainRecord(runtimeDescriptor)) {
    throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, 'Runtime capability descriptor 必须是对象')
  }
  if (runtimeDescriptor?.protocolVersion != null && runtimeDescriptor.protocolVersion !== CONTROL_PROTOCOL_VERSION) {
    throw new ControlError(ControlErrorCode.CAPABILITY_UNAVAILABLE, `控制协议版本不兼容：${runtimeDescriptor.protocolVersion}`)
  }
  const methods = declaredMethods(runtimeDescriptor?.methods ?? {})
  const capabilities = {}
  for (const method of Object.keys(CAPABILITY_DEFINITIONS)) {
    const runtimeMethod = RUNTIME_METHODS[method]
    if (methods.has(runtimeMethod) || methods.has(method)) {
      capabilities[method] = { grade: 'available', source: 'runtime', reason: 'Runtime 明确声明支持' }
    } else {
      capabilities[method] = { grade: 'unavailable', source: 'runtime', reason: CAPABILITY_DEFINITIONS[method] }
    }
  }
  for (const [name, capability] of Object.entries(LOCAL_CAPABILITIES)) capabilities[name] = cloneJson(capability)
  return {
    schemaVersion: CONTROL_PROTOCOL_VERSION,
    protocolVersion: CONTROL_PROTOCOL_VERSION,
    runtimeProtocolVersion: runtimeDescriptor?.protocolVersion ?? null,
    capabilities,
  }
}

export function capabilityOf(manifest, method) {
  const capability = manifest?.capabilities?.[method]
  if (!capability) {
    return { grade: 'unavailable', source: 'unknown', reason: `未声明能力：${method}` }
  }
  return capability
}

export function assertRuntimeCapability(manifest, method) {
  const capability = capabilityOf(manifest, method)
  if (capability.source !== 'runtime' || capability.grade !== 'available') {
    throw new ControlError(ControlErrorCode.CAPABILITY_UNAVAILABLE, capability.reason, { method, capability })
  }
  return capability
}

export function unsupportedControlReceipt(method, requestId, observedAt) {
  const manifest = createCapabilityManifest()
  const capability = capabilityOf(manifest, method)
  return createControlReceipt({
    requestId,
    observedAt,
    status: 'failed',
    error: {
      code: ControlErrorCode.CAPABILITY_UNAVAILABLE,
      message: capability.reason,
      details: { method, capability },
    },
  })
}

function fingerprint(envelope) {
  return stableStringify({
    method: envelope.method,
    sessionId: envelope.sessionId,
    revision: envelope.revision,
    payload: envelope.payload,
  })
}

/**
 * Process-local request journal. Replaying the same requestId and payload
 * returns the original receipt/promise; reusing an ID for different input is a
 * conflict. The executor is injected, so tests can prove no second side effect.
 */
export function createControlDispatcher(options = {}) {
  if (!isPlainRecord(options)) throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, 'dispatcher options 必须是对象')
  const entries = new Map()
  const replayLimit = options.replayLimit ?? 2048
  if (replayLimit !== 2048) {
    throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, 'replayLimit 必须为 2048')
  }
  const capabilities = options.capabilities ?? createCapabilityManifest()
  const gate = (method) => assertRuntimeCapability(capabilities, method)
  const remember = (key, requestFingerprint, promise) => {
    entries.set(key, { fingerprint: requestFingerprint, promise })
    if (entries.size > replayLimit) {
      const oldest = entries.keys().next().value
      if (oldest !== undefined) entries.delete(oldest)
    }
    return promise
  }

  function dispatch(rawEnvelope, execute) {
    const envelope = createControlEnvelope(rawEnvelope)
    const key = stableStringify([envelope.sessionId, envelope.requestId])
    const requestFingerprint = fingerprint(envelope)
    const existing = entries.get(key)
    if (existing) {
      if (existing.fingerprint !== requestFingerprint) {
        return Promise.resolve(createControlReceipt({
          requestId: envelope.requestId,
          observedAt: envelope.observedAt,
          status: 'failed',
          error: {
            code: ControlErrorCode.CONFLICT,
            message: 'requestId 已用于不同的控制请求',
            details: { requestId: envelope.requestId, sessionId: envelope.sessionId },
          },
        }))
      }
      return existing.promise
    }
    if (typeof execute !== 'function') {
      return Promise.resolve(createControlReceipt({
        requestId: envelope.requestId,
        observedAt: envelope.observedAt,
        status: 'failed',
        error: { code: ControlErrorCode.INVALID_ARGUMENT, message: '缺少控制执行器' },
      }))
    }
    if (Object.hasOwn(CAPABILITY_DEFINITIONS, envelope.method)) {
      try {
        gate(envelope.method)
      } catch (error) {
        const promise = Promise.resolve(createControlReceipt({
          requestId: envelope.requestId,
          observedAt: envelope.observedAt,
          status: 'failed',
          error: error.toJSON(),
        }))
        return remember(key, requestFingerprint, promise)
      }
    }
    const promise = Promise.resolve().then(() => execute(cloneJson(envelope), gate)).then((result) => (
      createControlReceipt({ requestId: envelope.requestId, observedAt: envelope.observedAt, status: 'completed', result })
    )).catch((error) => createControlReceipt({
      requestId: envelope.requestId,
      observedAt: envelope.observedAt,
      status: 'failed',
      error: error instanceof ControlError
        ? error.toJSON()
        : { code: ControlErrorCode.INTERNAL, message: error?.message ?? '控制执行失败' },
    }))
    return remember(key, requestFingerprint, promise)
  }

  return {
    dispatch,
    get(sessionId, requestId) {
      const entry = entries.get(stableStringify([sessionId ?? null, requestId]))
      return entry ? entry.promise : null
    },
    size() {
      return entries.size
    },
  }
}
