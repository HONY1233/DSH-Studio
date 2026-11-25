import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseBuiltinModels, parseDefaultMaxTokens } from '../../host-services/src/dsh-models.js'

// 取自 @deepseek-ai/dsh-llm-deepseek 0.2.2-rc.5 的 src/models.ts：
// 第一个模型用常量引用上下文窗口，第二个没有 inputModalities。
const MODELS = `/** Default DeepSeek model catalog. */
import type { DeepSeekCatalogModel } from './types.ts'

/** Context window of both official models. */
const OFFICIAL_CONTEXT_WINDOW = 1_048_576

/** Advisory official model entries. */
export const DEFAULT_MODELS: DeepSeekCatalogModel[] = [
  {
    id: 'deepseek-flash',
    name: 'DeepSeek-V4.1-Flash',
    contextWindow: OFFICIAL_CONTEXT_WINDOW,
    inputModalities: ['text', 'image'],
    systemPromptUpdate: 'in-history',
    toolUpdate: 'addition-only',
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek-V4-Pro',
    description: 'Stronger agentic coding.',
    contextWindow: 1_048_576,
  },
]
`

test('parses the built-in model catalog and expands constants', () => {
  const models = parseBuiltinModels(MODELS)
  assert.equal(models.length, 2)
  assert.deepEqual(models[0], {
    id: 'deepseek-flash',
    name: 'DeepSeek-V4.1-Flash',
    description: '',
    contextWindow: 1_048_576,
    image: true,
  })
  assert.equal(models[1].id, 'deepseek-v4-pro')
  assert.equal(models[1].description, 'Stronger agentic coding.')
  assert.equal(models[1].contextWindow, 1_048_576)
  assert.equal(models[1].image, false)
})

test('returns no models on malformed source instead of throwing', () => {
  assert.deepEqual(parseBuiltinModels(''), [])
  assert.deepEqual(parseBuiltinModels('export const OTHER = []'), [])
})

test('parses the default max output tokens', () => {
  assert.equal(parseDefaultMaxTokens('export const DEFAULT_MAX_TOKENS = 256_000'), 256_000)
  assert.equal(parseDefaultMaxTokens('nothing here'), null)
})
