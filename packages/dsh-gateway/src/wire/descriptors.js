/**
 * Remote descriptor 查询层。
 *
 * 存在理由（实测教训）：
 * 每个 remote 方法的参数名由自己的 descriptor 决定，**没有统一规律**。
 *   session/create → args: { request: {...} }
 *   session/list   → args: { _request: {...} }
 *   terminal/create→ args: { agentId, request: {...} }
 * 224 个 endpoint 里有 120 个不符合「参数叫 request/args」的直觉。
 *
 * 所以调用方只描述「我要传什么字段」，由这里查 descriptor 决定怎么包。
 * 手写 args 是禁止的 —— 一旦猜错，DSH 返回 HTTP 200 + gateway/arguments-invalid，
 * 错误只在运行期暴露，而且看起来像业务逻辑问题。
 *
 * descriptors.json 由 packages/testkit/scripts/extract-descriptors.mjs 生成，
 * 与 DSH 版本绑定。升级 DSH 后必须重跑并 diff。
 */

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/** @type {{ dshVersion: string, endpointCount: number, generatedAt: string, endpoints: Record<string, any> }} */
const SNAPSHOT = require('./descriptors.json')

/** 本适配层针对的 DSH 版本。启动时应与运行时实际版本比对。 */
export const DESCRIBED_DSH_VERSION = SNAPSHOT.dshVersion

export const ENDPOINT_COUNT = SNAPSHOT.endpointCount

/** 全部 endpoint 名（排序后，便于稳定 diff）。 */
export function listEndpoints(namespace = null) {
  const all = Object.keys(SNAPSHOT.endpoints).sort()
  if (!namespace) return all
  return all.filter((endpoint) => endpoint.startsWith(`${namespace}/`))
}

/** @param {string} endpoint */
export function hasEndpoint(endpoint) {
  return Object.prototype.hasOwnProperty.call(SNAPSHOT.endpoints, endpoint)
}

/**
 * 取单个 endpoint 的 descriptor。
 * @param {string} endpoint
 */
export function getEndpoint(endpoint) {
  const entry = SNAPSHOT.endpoints[endpoint]
  if (!entry) {
    throw Object.assign(new Error(`未知 endpoint: ${endpoint}`), {
      code: 'gateway/bad-request',
      suggestions: suggestEndpoints(endpoint),
    })
  }
  return entry
}

/** 判断 needle 的字符是否按顺序出现在 haystack 里（子序列）。 */
function isSubsequence(needle, haystack) {
  let cursor = 0
  for (const ch of haystack) {
    if (ch === needle[cursor]) cursor += 1
    if (cursor === needle.length) return true
  }
  return needle.length === 0
}

/** 拼错时给出候选，别让人对着 224 个名字找。 */
export function suggestEndpoints(endpoint, limit = 5) {
  if (typeof endpoint !== 'string' || endpoint.length === 0) return []
  const target = endpoint.toLowerCase()
  const [targetNs, targetMethod = ''] = target.includes('/')
    ? target.split('/')
    : [null, target]
  const scored = []

  for (const candidate of Object.keys(SNAPSHOT.endpoints)) {
    const lower = candidate.toLowerCase()
    if (lower === target) return [candidate]

    const [candidateNs, candidateMethod = ''] = lower.includes('/')
      ? lower.split('/')
      : [null, lower]

    let score = 0
    if (targetNs && candidateNs === targetNs) score += 5
    if (targetMethod && candidateMethod === targetMethod) score += 6
    // 省略元音的拼写（list ↔ lst、create ↔ crt）用子序列兜住
    else if (targetMethod.length >= 2 && isSubsequence(targetMethod, candidateMethod)) score += 4
    if (targetMethod && candidateMethod.startsWith(targetMethod)) score += 3
    if (lower.includes(target)) score += 2
    // 长度差越小越可能是同一个词
    if (score > 0 && targetMethod) score -= Math.abs(candidateMethod.length - targetMethod.length) * 0.2

    if (score > 0) scored.push({ candidate, score })
  }

  return scored
    .sort((a, b) => b.score - a.score || a.candidate.localeCompare(b.candidate))
    .slice(0, limit)
    .map((item) => item.candidate)
}

/**
 * 按 descriptor 把「字段包」翻译成 DSH 要求的 args 形状。
 *
 * 规则：
 * - 只有一个参数 → 所有字段都归它（这是最常见的情况）
 * - 多个参数 → 优先按参数名取；剩余字段归第一个参数
 *
 * @param {string} endpoint
 * @param {Record<string, unknown>} [fields]
 * @returns {Record<string, unknown>}
 */
export function buildArgs(endpoint, fields = {}) {
  const entry = getEndpoint(endpoint)
  const names = Object.keys(entry.params ?? {})

  if (names.length === 0) {
    if (Object.keys(fields).length > 0) {
      throw Object.assign(
        new Error(`${endpoint} 不接受任何参数，但传入了 ${Object.keys(fields).join(', ')}`),
        { code: 'gateway/arguments-invalid' },
      )
    }
    return {}
  }

  if (names.length === 1) {
    const name = names[0]
    const schema = entry.params[name].schema
    // 参数本身是对象 → 把字段包进去（session/create 就属于这种）
    if (schema?.type === 'object' || schema?.properties) {
      return { [name]: fields }
    }
    // 参数本身是标量（terminal/list 的 sessionId）→ 不能多包一层，
    // 否则会变成 { sessionId: { sessionId: 'x' } }，运行期才报 input-invalid。
    if (Object.prototype.hasOwnProperty.call(fields, name)) {
      return { [name]: fields[name] }
    }
    const values = Object.values(fields)
    if (values.length === 1) return { [name]: values[0] }
    if (values.length === 0) {
      throw Object.assign(new Error(`${endpoint} 需要参数 \`${name}\`，但没有提供`), {
        code: 'gateway/arguments-invalid',
      })
    }
    throw Object.assign(
      new Error(`${endpoint} 的参数 \`${name}\` 是标量，但传入了多个字段：${Object.keys(fields).join(', ')}`),
      { code: 'gateway/arguments-invalid' },
    )
  }

  const args = {}
  const leftovers = { ...fields }
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(fields, name)) {
      args[name] = fields[name]
      delete leftovers[name]
    }
  }
  // 剩余字段归给第一个「对象型」参数，而不是第一个参数。
  // terminal/create 的形态是 { agent: 标量, request: 对象 }，
  // 若归给 agent 会直接被 codec 拒掉。
  if (Object.keys(leftovers).length > 0) {
    const sink =
      names.find((name) => {
        const schema = entry.params[name].schema
        return schema?.type === 'object' || schema?.properties
      }) ?? names[0]
    const existing = args[sink]
    args[sink] =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? { ...existing, ...leftovers }
        : leftovers
  }
  return args
}

/**
 * 本地参数形状检查。
 *
 * 只做「必填缺失 / 多余字段」这一层——它恰好对应 DSH 的
 * `gateway/arguments-invalid` 文案格式，但能在发包前就发现，
 * 省一次往返，也让 UI 能立刻定位问题。
 *
 * 不做完整 JSON Schema 校验：嵌套类型深、帧量大，全量校验的收益抵不上开销。
 *
 * @param {string} endpoint
 * @param {Record<string, unknown>} args
 * @returns {{ ok: boolean, problems: Array<{ parameter: string, missing: string[], unexpected: string[] }> }}
 */
export function checkArgs(endpoint, args) {
  const entry = getEndpoint(endpoint)
  const problems = []
  const paramNames = Object.keys(entry.params ?? {})
  const allowed = new Set(paramNames)

  // ① 顶层参数名必须先对。
  // 这是实测里唯一会真正报错的一层：参数名不匹配时 DSH 返回
  // gateway/arguments-invalid（missing "_request"; unexpected "request"）。
  // 而参数内部的字段是宽松的（所有 schema 都是 additionalProperties: true）。
  const givenNames = Object.keys(args ?? {})
  const badNames = givenNames.filter((name) => !allowed.has(name))
  const absentNames = paramNames.filter((name) => entry.params[name].required && args?.[name] === undefined)
  if (badNames.length > 0 || absentNames.length > 0) {
    problems.push({ parameter: '(顶层参数名)', missing: absentNames, unexpected: badNames })
  }

  // ② 再检查参数内部的必填字段
  for (const [name, param] of Object.entries(entry.params ?? {})) {
    const schema = param.schema ?? {}
    const isObject = schema.type === 'object' || !!schema.properties
    const value = args?.[name]

    if (value === undefined || value === null) continue
    if (!isObject) continue

    const properties = schema.properties ?? {}
    const required = Array.isArray(schema.required) ? schema.required : []
    const present = Object.keys(value)

    const missing = required.filter((key) => value[key] === undefined)
    const unexpected =
      schema.additionalProperties === false
        ? present.filter((key) => !Object.prototype.hasOwnProperty.call(properties, key))
        : []

    if (missing.length > 0 || unexpected.length > 0) {
      problems.push({ parameter: name, missing, unexpected })
    }
  }

  return { ok: problems.length === 0, problems }
}

/**
 * 把 checkArgs 的结果拼成一句可读的话，可直接塞进错误提示。
 * @param {Array<{ parameter: string, missing: string[], unexpected: string[] }>} problems
 */
export function formatArgProblems(problems) {
  return problems
    .map((item) => {
      const parts = []
      if (item.missing.length) parts.push(`缺少 ${item.missing.map((s) => `"${s}"`).join(', ')}`)
      if (item.unexpected.length)
        parts.push(`多余 ${item.unexpected.map((s) => `"${s}"`).join(', ')}`)
      return `参数 ${item.parameter}: ${parts.join('；')}`
    })
    .join(' | ')
}

/** endpoint 的可读摘要，用于诊断面板。 */
export function describeEndpoint(endpoint) {
  const entry = getEndpoint(endpoint)
  const params = Object.entries(entry.params ?? {}).map(([name, param]) => ({
    name,
    required: param.required,
    fields: param.schema?.type === 'object' ? Object.keys(param.schema.properties ?? {}) : [],
  }))
  return {
    endpoint,
    package: entry.package,
    description: entry.description,
    params,
  }
}
