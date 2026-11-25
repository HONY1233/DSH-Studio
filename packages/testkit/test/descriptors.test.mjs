/**
 * descriptor 层测试。
 *
 * 这些断言的价值不在于「跑通」，而在于**守护 DSH 升级**：
 * descriptors.json 是 0.2.2-rc.5 的快照。一旦 DSH 改了方法签名而没人重跑提取器，
 * 这里会先红，而不是等到运行期收到 HTTP 200 + gateway/arguments-invalid。
 *
 * 断言的都是实测过的真实签名，不是我以为的签名。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DESCRIBED_DSH_VERSION,
  ENDPOINT_COUNT,
  buildArgs,
  checkArgs,
  describeEndpoint,
  formatArgProblems,
  getEndpoint,
  hasEndpoint,
  listEndpoints,
  suggestEndpoints,
} from '@dsh-studio/dsh-gateway'

// ───────────────────────────── 快照完整性 ─────────────────────────────

test('descriptor 快照：版本已记录，endpoint 数量合理', () => {
  assert.match(DESCRIBED_DSH_VERSION, /^\d+\.\d+\.\d+/)
  assert.ok(ENDPOINT_COUNT > 200, `endpoint 只有 ${ENDPOINT_COUNT} 个，可能提取不全`)
  assert.equal(listEndpoints().length, ENDPOINT_COUNT)
})

test('descriptor 快照：核心命名空间都在', () => {
  for (const endpoint of [
    'session/list',
    'session/create',
    'session/prompt',
    'session/cancel',
    'session/fork',
    'session/selectModel',
    'terminal/create',
    'terminal/attach',
    'settings/mutate',
    'skills/list',
    'commands/list',
    'workspaceFiles/list',
    'subagents/prompt',
  ]) {
    assert.ok(hasEndpoint(endpoint), `缺少 ${endpoint}`)
  }
})

test('listEndpoints：按命名空间过滤', () => {
  const session = listEndpoints('session')
  assert.ok(session.length >= 20)
  assert.ok(session.every((e) => e.startsWith('session/')))
  assert.ok(!session.includes('terminal/create'))
})

// ───────────────────────────── 参数名的真实差异（核心回归） ─────────────────────────────

test('参数名不是统一的：session/list 是 _request，session/create 是 request', () => {
  // 这条断言就是本文件存在的理由。实测得知：两者参数名不同，
  // 任何「session 命名空间都用 request」的假设都是错的。
  assert.deepEqual(Object.keys(getEndpoint('session/list').params), ['_request'])
  assert.deepEqual(Object.keys(getEndpoint('session/create').params), ['request'])
  assert.deepEqual(Object.keys(getEndpoint('session/prompt').params), ['request'])
  assert.deepEqual(Object.keys(getEndpoint('session/cancel').params), ['request'])
})

test('参数名不是统一的：terminal 用 agent，而 list/watch/retain 用 sessionId', () => {
  assert.deepEqual(Object.keys(getEndpoint('terminal/create').params), ['agent', 'request'])
  assert.deepEqual(Object.keys(getEndpoint('terminal/attach').params), ['agent', 'id'])
  assert.deepEqual(Object.keys(getEndpoint('terminal/list').params), ['sessionId'])
  assert.deepEqual(Object.keys(getEndpoint('terminal/watch').params), ['sessionId'])
  assert.deepEqual(Object.keys(getEndpoint('terminal/retain').params), ['sessionId', 'id'])
})

test('terminal/create 的 request 字段是 id/cols/rows/shellPath（id 由调用方给）', () => {
  const fields = Object.keys(getEndpoint('terminal/create').params.request.schema.properties)
  assert.deepEqual(fields.sort(), ['cols', 'id', 'rows', 'shellPath'])
  assert.ok(getEndpoint('terminal/create').params.request.schema.required.includes('id'))
})

// ───────────────────────────── buildArgs ─────────────────────────────

test('buildArgs：单参数 endpoint 把字段全归给那个参数', () => {
  assert.deepEqual(buildArgs('session/list', {}), { _request: {} })
  assert.deepEqual(buildArgs('session/list', { cursor: 'abc' }), { _request: { cursor: 'abc' } })
  assert.deepEqual(buildArgs('session/create', { cwd: '/w', sessionId: 's1' }), {
    request: { cwd: '/w', sessionId: 's1' },
  })
})

test('buildArgs：参数本身是标量时不多包一层', () => {
  // terminal/list 的 sessionId 是 {"type":"string"}，若包成 { sessionId: { sessionId } }
  // 会得到 input-invalid，而且看上去像「字段类型错」，很难定位。
  assert.deepEqual(buildArgs('terminal/list', { sessionId: 's1' }), { sessionId: 's1' })
  // 也接受直接传值（单字段时按位置推断）
  assert.deepEqual(buildArgs('terminal/list', { anything: 's2' }), { sessionId: 's2' })
})

test('buildArgs：标量参数没收任何值时抛错而不是发空对象', () => {
  assert.throws(() => buildArgs('terminal/list', {}), /需要参数/)
})

test('buildArgs：多参数 endpoint 按名分组', () => {
  assert.deepEqual(
    buildArgs('terminal/create', { agent: 'a1', request: { id: 't1', cols: 100, rows: 30 } }),
    { agent: 'a1', request: { id: 't1', cols: 100, rows: 30 } },
  )
  assert.deepEqual(buildArgs('terminal/list', { sessionId: 's1' }), { sessionId: 's1' })
})

test('buildArgs：多参数时剩余字段并进第一个参数（宽松兜底）', () => {
  // 调用方可能只传 request 的内容而不显式分组；不该因此丢字段
  const args = buildArgs('terminal/create', { agent: 'a1', id: 't1', cols: 80, rows: 24 })
  assert.equal(args.agent, 'a1')
  assert.deepEqual(args.request, { id: 't1', cols: 80, rows: 24 })
})

test('buildArgs：未知 endpoint 抛错并给候选', () => {
  assert.throws(
    () => buildArgs('session/lst', {}),
    (error) => {
      assert.equal(error.code, 'gateway/bad-request')
      assert.ok(Array.isArray(error.suggestions))
      assert.ok(error.suggestions.includes('session/list'))
      return true
    },
  )
})

// ───────────────────────────── suggestEndpoints ─────────────────────────────

test('suggestEndpoints：拼错也能找到目标', () => {
  assert.ok(suggestEndpoints('session/lst').includes('session/list'))
  assert.ok(suggestEndpoints('terminl/create').includes('terminal/create'))
  assert.deepEqual(suggestEndpoints(''), [])
})

// ───────────────────────────── checkArgs ─────────────────────────────

test('checkArgs：合法参数通过', () => {
  assert.equal(checkArgs('session/list', { _request: {} }).ok, true)
  assert.equal(
    checkArgs('terminal/create', { agent: 'a1', request: { id: 't1', cols: 80, rows: 24 } }).ok,
    true,
  )
})

test('checkArgs：顶层参数名写错是最典型的坑，必须被抓到', () => {
  // session/list 的参数名是 `_request`。写成 `request` 时 DSH 会返回
  // HTTP 200 + gateway/arguments-invalid（missing "_request"; unexpected "request"），
  // 看起来很像业务错误。这里要在发包前就抓住。
  const result = checkArgs('session/list', { request: {} })
  assert.equal(result.ok, false)
  assert.ok(result.problems.some((p) => p.parameter === '(顶层参数名)'))
  const top = result.problems.find((p) => p.parameter === '(顶层参数名)')
  assert.deepEqual(top.missing, ['_request'])
  assert.deepEqual(top.unexpected, ['request'])
})

test('checkArgs：缺整个参数能被抓到', () => {
  const result = checkArgs('session/create', {})
  assert.equal(result.ok, false)
  const top = result.problems.find((p) => p.parameter === '(顶层参数名)')
  assert.deepEqual(top.missing, ['request'])
})

test('checkArgs：对象内缺必填字段能被抓到', () => {
  const result = checkArgs('terminal/create', { agent: 'a1', request: { cols: 80 } })
  assert.equal(result.ok, false)
  assert.ok(result.problems.some((p) => p.missing.includes('id')))
})

test('checkArgs：参数内部的多余字段不报错（DSH 的 schema 全部 additionalProperties: true）', () => {
  // 这是实测事实：宽松的是字段，严格的是参数名。
  // 如果哪天 DSH 收紧了，这条会红——那正是我们想收到的信号。
  const result = checkArgs('terminal/create', {
    agent: 'a1',
    request: { id: 't1', cols: 80, rows: 24, extraField: true },
  })
  assert.equal(result.ok, true)

  const allFalse = Object.entries(
    Object.fromEntries(
      Object.entries(getEndpoint('terminal/create').params).map(([n, p]) => [n, p.schema]),
    ),
  ).filter(([, schema]) => schema?.additionalProperties === false)
  assert.equal(allFalse.length, 0, '如果 DSH 开始收紧 schema，需要同步调整 checkArgs 的预期')
})

test('checkArgs：未知 endpoint 抛错而不是静默通过', () => {
  assert.throws(() => checkArgs('nope/nope', {}))
})

test('formatArgProblems：拼成可读文案', () => {
  const text = formatArgProblems([
    { parameter: 'request', missing: ['id'], unexpected: ['bogus'] },
  ])
  assert.ok(text.includes('request'))
  assert.ok(text.includes('缺少'))
  assert.ok(text.includes('"id"'))
  assert.ok(text.includes('多余'))
})

// ───────────────────────────── describeEndpoint ─────────────────────────────

test('describeEndpoint：给出包名、说明与字段', () => {
  const info = describeEndpoint('terminal/create')
  assert.equal(info.endpoint, 'terminal/create')
  assert.match(info.package, /@deepseek-ai\//)
  assert.ok(info.params.some((p) => p.name === 'agent' && p.required))
  const requestParam = info.params.find((p) => p.name === 'request')
  assert.ok(requestParam.fields.includes('id'))
})
