/**
 * wire 层单测：报文编解码必须与实测完全一致。
 *
 * 覆盖 T2 的四条验收：ok / 业务错误 / 401 纯文本 / 403 纯文本，
 * 外加 404、非 JSON、以及 mux 帧的 exactKeys 约束。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ErrorCode,
  MUX_PATH,
  cancelFrame,
  clientRequest,
  describeError,
  encodeFrame,
  endFrame,
  isRetryable,
  isValidEndpoint,
  needsReconnect,
  openFrame,
  parseHostFrame,
  parseResponse,
  uplinkFrame,
} from '@dsh-studio/dsh-gateway/wire'

test('clientRequest 包出 payload.args 且 endpoint 合法', () => {
  const body = clientRequest({ rpcId: 'r1', method: 'session/create', args: { request: { cwd: '/tmp' } } })
  assert.deepEqual(body, {
    type: 'client-request',
    rpcId: 'r1',
    method: 'session/create',
    payload: { args: { request: { cwd: '/tmp' } } },
  })
  assert.equal(Object.keys(body.payload).length, 1, 'payload 只允许 args 一个字段')
})

test('clientRequest 拒绝非法 endpoint', () => {
  assert.throws(() => clientRequest({ method: '' }), /非法的 endpoint/)
  assert.throws(() => clientRequest({ method: 'a//b' }), /非法的 endpoint/)
  assert.throws(() => clientRequest({ method: '../etc/passwd' }), /非法的 endpoint/)
  assert.throws(() => clientRequest({ method: 'session/ has space' }), /非法的 endpoint/)
})

test('isValidEndpoint 接受实测用到的端点', () => {
  for (const ep of ['session/create', 'session/follow', 'terminal/create', 'session/selectModel']) {
    assert.equal(isValidEndpoint(ep), true, ep)
  }
})

test('parseResponse: 200 + ok:true → ok', () => {
  const r = parseResponse({
    status: 200,
    contentType: 'application/json',
    text: JSON.stringify({ type: 'server-response', rpcId: 'r1', result: { ok: true, value: { sessionId: 's1' } } }),
  })
  assert.deepEqual(r, { kind: 'ok', status: 200, value: { sessionId: 's1' } })
})

test('parseResponse: 200 + ok:false 是业务错误（不能当成功）', () => {
  const r = parseResponse({
    status: 200,
    contentType: 'application/json; charset=utf-8',
    text: JSON.stringify({
      type: 'server-response',
      rpcId: 'r1',
      result: {
        ok: false,
        error: {
          code: 'gateway/arguments-invalid',
          message: 'missing "request"',
          details: { endpoint: 'session/create' },
        },
      },
    }),
  })
  assert.equal(r.kind, 'error')
  assert.equal(r.code, 'gateway/arguments-invalid')
  assert.equal(r.message, 'missing "request"')
  assert.deepEqual(r.details, { endpoint: 'session/create' })
})

test('parseResponse: 401 是纯文本，不尝试 JSON 解析', () => {
  const r = parseResponse({ status: 401, contentType: 'text/plain', text: 'unauthorized' })
  assert.deepEqual(r, { kind: 'unauthorized', status: 401 })
})

test('parseResponse: 403 是纯文本', () => {
  const r = parseResponse({ status: 403, contentType: 'text/plain', text: 'forbidden' })
  assert.deepEqual(r, { kind: 'forbidden', status: 403 })
})

test('parseResponse: 404 单独归类', () => {
  assert.deepEqual(parseResponse({ status: 404, contentType: 'text/plain', text: 'not found' }), {
    kind: 'not-found',
    status: 404,
  })
})

test('parseResponse: 200 但返回非 JSON → badRequest', () => {
  const r = parseResponse({ status: 200, contentType: 'text/html', text: '<html>' })
  assert.equal(r.kind, 'error')
  assert.equal(r.code, ErrorCode.badRequest)
})

test('parseResponse: 缺少 result → badRequest', () => {
  const r = parseResponse({ status: 200, contentType: 'application/json', text: '{"type":"server-response"}' })
  assert.equal(r.kind, 'error')
  assert.equal(r.code, ErrorCode.badRequest)
})

test('openFrame 恰好四个键（DSH 用 exactKeys 校验）', () => {
  const f = openFrame({ streamId: 's1', endpoint: 'session/follow', args: { request: {} } })
  assert.deepEqual(Object.keys(f).sort(), ['endpoint', 'payload', 'streamId', 'type'])
  assert.deepEqual(f, {
    type: 'open',
    streamId: 's1',
    endpoint: 'session/follow',
    payload: { args: { request: {} } },
  })
})

test('uplinkFrame 在 value 为 undefined 时省略该键', () => {
  assert.deepEqual(uplinkFrame({ streamId: 's1' }), { type: 'item', streamId: 's1' })
  assert.deepEqual(uplinkFrame({ streamId: 's1', value: 0 }), { type: 'item', streamId: 's1', value: 0 })
})

test('endFrame / cancelFrame 只有两个键', () => {
  assert.deepEqual(endFrame({ streamId: 's1' }), { type: 'end', streamId: 's1' })
  assert.deepEqual(cancelFrame({ streamId: 's1' }), { type: 'cancel', streamId: 's1' })
})

test('parseHostFrame: item / end / error / ready', () => {
  assert.deepEqual(parseHostFrame('{"type":"item","streamId":"s1","value":{"type":"snapshot"}}'), {
    type: 'item',
    streamId: 's1',
    value: { type: 'snapshot' },
  })
  assert.deepEqual(parseHostFrame('{"type":"end","streamId":"s1"}'), { type: 'end', streamId: 's1' })
  const err = parseHostFrame(
    '{"type":"error","streamId":"s1","error":{"code":"gateway/input-invalid","message":"bad"}}',
  )
  assert.equal(err.type, 'error')
  assert.equal(err.code, 'gateway/input-invalid')
  assert.deepEqual(parseHostFrame('{"type":"ready"}'), { type: 'ready' })
})

test('parseHostFrame: 非 JSON 与未知类型都归为 invalid，不抛错', () => {
  assert.equal(parseHostFrame('not json').type, 'invalid')
  assert.equal(parseHostFrame('{"type":"weird"}').reason, 'unknown-type:weird')
})

test('encodeFrame 是 encode(open) 的可逆形式', () => {
  const f = openFrame({ streamId: 's1', endpoint: 'session/follow' })
  assert.deepEqual(JSON.parse(encodeFrame(f)), f)
})

test('MUX_PATH 与 /connect 返回的 Location 一致', () => {
  assert.equal(MUX_PATH, '/api/remote.mux')
})

test('describeError 任何码都产出三段式，不缺字段', () => {
  for (const code of Object.values(ErrorCode)) {
    const d = describeError(code, 'raw message')
    assert.equal(typeof d.what, 'string')
    assert.ok(d.what.length > 0, code)
    assert.ok(d.why.length > 0, code)
    assert.ok(d.todo.length > 0, code)
    assert.equal(d.detail, 'raw message')
  }
  const unknown = describeError('some/unknown-code')
  assert.equal(unknown.code, 'some/unknown-code')
  assert.ok(unknown.what.length > 0, '未收录的码也要有兜底文案')
})

test('可重试与需重连的判定', () => {
  assert.equal(isRetryable(ErrorCode.transportFailed), true)
  assert.equal(isRetryable(ErrorCode.unauthorized), true)
  assert.equal(isRetryable(ErrorCode.argumentsInvalid), false)
  assert.equal(needsReconnect(ErrorCode.unauthorized), true)
  assert.equal(needsReconnect(ErrorCode.peerDisposed), true)
  assert.equal(needsReconnect(ErrorCode.terminalUnavailable), false)
})
