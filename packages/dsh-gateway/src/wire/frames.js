/**
 * DSH Web Host API 的报文编解码。
 *
 * 全部按 2026-11-23 实测编写，与随包 README 的描述有出入之处以本文件为准：
 *
 * 1. unary: `POST /api/<namespace>/<method>`
 *    body: `{ type:'client-request', rpcId, method, payload:{ args:{...} } }`
 *    - URL 里的 endpoint 必须与 body.method 完全一致
 *    - payload 有且只能有 args 一个字段
 * 2. 认证失败是 **401 纯文本**，trust 失败是 **403 纯文本**，都不是 JSON
 * 3. 业务失败也返回 HTTP 200，靠 `result.ok === false` 区分
 * 4. mux 流: WebSocket `/api/remote.mux`
 *    客户端帧 open 必须恰好是 type/streamId/endpoint/payload 四个键
 */

import { ErrorCode } from './errors.js'

/** 每段允许的字符（对齐 DSH 的 endpoint 段校验）。 */
const SEGMENT = /^[A-Za-z0-9._~-]+$/

/** 端点是否合法。非法端点不发请求，直接抛错，避免打到 404 上浪费一轮。 */
export function isValidEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length === 0) return false
  return endpoint.split('/').every((seg) => seg.length > 0 && seg !== '.' && seg !== '..' && SEGMENT.test(seg))
}

export function assertEndpoint(endpoint) {
  if (!isValidEndpoint(endpoint)) {
    throw new Error(`非法的 endpoint: ${JSON.stringify(endpoint)}`)
  }
  return endpoint
}

let counter = 0
/** 生成本地唯一 rpcId。仅用于请求关联，无需全局唯一。 */
export function makeRpcId(prefix = 'rpc') {
  counter += 1
  return `${prefix}-${Date.now().toString(36)}-${counter}`
}

/**
 * 构造 unary 请求体。
 * @param {{ rpcId?: string, method: string, args?: unknown }} input
 */
export function clientRequest({ rpcId, method, args }) {
  assertEndpoint(method)
  return {
    type: 'client-request',
    rpcId: rpcId ?? makeRpcId(),
    method,
    payload: { args: args ?? {} },
  }
}

/**
 * 解析 unary 响应。
 *
 * @param {{ status: number, contentType?: string | null, text: string }} input
 * @returns {{ kind:'ok', status:number, value:unknown }
 *   | { kind:'error', status:number, code:string, message:string, details?:unknown }
 *   | { kind:'unauthorized', status:number }
 *   | { kind:'forbidden', status:number }
 *   | { kind:'not-found', status:number }}
 */
export function parseResponse({ status, contentType, text }) {
  if (status === 401) return { kind: 'unauthorized', status }
  if (status === 403) return { kind: 'forbidden', status }
  if (status === 404) return { kind: 'not-found', status }

  const mime = String(contentType ?? '').split(';')[0].trim().toLowerCase()
  if (mime !== 'application/json') {
    return {
      kind: 'error',
      status,
      code: ErrorCode.badRequest,
      message: `期望 JSON 响应，实际是 ${mime || 'unknown'}：${String(text).slice(0, 200)}`,
    }
  }

  let envelope
  try {
    envelope = JSON.parse(text)
  } catch {
    return {
      kind: 'error',
      status,
      code: ErrorCode.badRequest,
      message: `响应不是合法 JSON：${String(text).slice(0, 200)}`,
    }
  }

  const result = envelope?.result
  if (!result || typeof result !== 'object') {
    return {
      kind: 'error',
      status,
      code: ErrorCode.badRequest,
      message: '响应缺少 result 字段',
    }
  }

  if (result.ok === true) return { kind: 'ok', status, value: result.value }

  return {
    kind: 'error',
    status,
    code: result.error?.code ?? ErrorCode.internal,
    message: result.error?.message ?? '',
    ...(result.error?.details !== undefined ? { details: result.error.details } : {}),
  }
}

/* ------------------------------------------------------------------ */
/* mux 流（WebSocket /api/remote.mux）                                  */
/* ------------------------------------------------------------------ */

/** mux 路径。由 /connect 的 302 Location 给出（./api/remote.mux）。 */
export const MUX_PATH = '/api/remote.mux'

/**
 * 构造 open 帧。DSH 用 exactKeys 校验，多一个字段都会整条被拒。
 * @param {{ streamId: string, endpoint: string, args?: unknown }} input
 */
export function openFrame({ streamId, endpoint, args }) {
  assertEndpoint(endpoint)
  if (!streamId) throw new Error('openFrame 需要 streamId')
  return { type: 'open', streamId, endpoint, payload: { args: args ?? {} } }
}

/** uplink 数据帧。value 可省略，宿主端按 undefined 处理。 */
export function uplinkFrame({ streamId, value }) {
  return value === undefined ? { type: 'item', streamId } : { type: 'item', streamId, value }
}

export function endFrame({ streamId }) {
  return { type: 'end', streamId }
}

export function cancelFrame({ streamId }) {
  return { type: 'cancel', streamId }
}

/**
 * 解析 Host 下行帧。
 *
 * 实测三种：
 * - `{type:'item', streamId, value}`  —— 数据（follow 的首帧 value.type 是 'snapshot'）
 * - `{type:'end', streamId}`          —— 正常结束
 * - `{type:'error', streamId, error}` —— 失败
 *
 * 注意：普通流的首帧 **不是** `ready`；`ready` 只属于 $events。
 *
 * @param {string} text
 */
export function parseHostFrame(text) {
  let frame
  try {
    frame = JSON.parse(text)
  } catch {
    return { type: 'invalid', reason: 'not-json' }
  }
  if (!frame || typeof frame !== 'object') return { type: 'invalid', reason: 'not-object' }

  switch (frame.type) {
    case 'item':
      return { type: 'item', streamId: frame.streamId, value: frame.value }
    case 'end':
      return { type: 'end', streamId: frame.streamId }
    case 'error':
      return {
        type: 'error',
        streamId: frame.streamId,
        code: frame.error?.code ?? ErrorCode.internal,
        message: frame.error?.message ?? '',
        details: frame.error?.details,
      }
    case 'ready':
      // $events 专用；出现在普通流里说明调用方开错了端点
      return { type: 'ready' }
    default:
      return { type: 'invalid', reason: `unknown-type:${String(frame.type)}` }
  }
}

/**
 * 序列化待发送的帧。集中一处便于将来加压缩或日志脱敏。
 */
export function encodeFrame(frame) {
  return JSON.stringify(frame)
}
