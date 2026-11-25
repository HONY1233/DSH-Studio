import assert from 'node:assert/strict'
import { test } from 'node:test'
import { foldSessionRuntimeEvents, usageFromSessionEvent } from '@dsh-studio/host-services'

test('usage is read from the real assistant/message event position', () => {
  const usage = { inputTokens: 120, outputTokens: 18, cachedInputTokens: 12 }
  assert.deepEqual(usageFromSessionEvent('assistant/message', { usage }), usage)
  assert.equal(usageFromSessionEvent('turn/end', { reason: { kind: 'completed' } }), null)
})

test('persisted assistant usage survives a later legacy turn/end payload', () => {
  const assistant = { inputTokens: 120, outputTokens: 18, cachedInputTokens: 12 }
  const legacy = { inputTokens: 999, outputTokens: 99 }
  const state = foldSessionRuntimeEvents('s1', [
    { type: 'assistant/message', data: { usage: assistant } },
    { type: 'turn/end', data: { usage: legacy, reason: { kind: 'completed' } } },
  ])
  assert.deepEqual(state.usage, assistant)
  assert.deepEqual(foldSessionRuntimeEvents('s2', [
    { type: 'turn/end', data: { result: { usage: legacy } } },
  ]).usage, legacy)
})

test('legacy turn/end usage remains a fallback without overriding newer assistant usage', () => {
  const legacy = { inputTokens: 99, outputTokens: 7 }
  assert.deepEqual(usageFromSessionEvent('turn/end', { usage: legacy }), legacy)
  assert.deepEqual(usageFromSessionEvent('turn/end', { result: { usage: legacy } }), legacy)
  assert.equal(usageFromSessionEvent('tool/result', { usage: legacy }), null)
})
