import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  appendNotice,
  appendUserMessage,
  applySessionStatus,
  createSessionView,
  describeTurnEnd,
  projectSessionEvent,
} from '@dsh-studio/contract'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = resolve(here, '../fixtures/projection-basic.jsonl')

async function fold(lines) {
  let view = createSessionView('s1')
  for (const line of lines) {
    const { dir, frame } = JSON.parse(line)
    if (dir !== 'in' || frame.method !== 'session.event') continue
    view = projectSessionEvent(view, frame.params.event)
  }
  return view
}

test('folds a recorded session into user/assistant/tool items', async () => {
  const lines = (await readFile(fixture, 'utf8')).split('\n').filter(Boolean)
  const view = await fold(lines)

  assert.equal(view.status, 'idle')
  assert.equal(view.turn.number, 1)
  assert.equal(view.turn.ended.kind, 'completed')
  assert.equal(view.usage.outputTokens, 18)

  const messages = view.items.filter((item) => item.kind === 'message')
  assert.deepEqual(
    messages.map((item) => [item.role, item.text]),
    [
      ['user', '列一下当前目录'],
      ['assistant', '当前有 apps 和 packages 两个目录。'],
    ],
    'runtime-context injects must not surface as user messages',
  )

  const tool = view.items.find((item) => item.kind === 'tool')
  assert.equal(tool.name, 'bash')
  assert.equal(tool.status, 'done')
  assert.equal(tool.result, 'apps packages')
})

test('projection does not mutate the previous view', async () => {
  const lines = (await readFile(fixture, 'utf8')).split('\n').filter(Boolean)
  const view = createSessionView('s1')
  const firstEvent = JSON.parse(lines[2]).frame.params.event
  const next = projectSessionEvent(view, firstEvent)
  assert.equal(view.items.length, 0)
  assert.equal(next.items.length, 0)
  assert.equal(view.turn, null)
  assert.equal(next.turn.number, 1)
})

test('turn end reasons map to user-facing notices', () => {
  assert.equal(describeTurnEnd({ kind: 'completed' }), null)
  assert.equal(describeTurnEnd({ kind: 'error', error: { message: 'no api key', code: 'MISSING_CREDENTIAL' } }).level, 'error')
  assert.equal(describeTurnEnd({ kind: 'aborted', reason: { kind: 'user' } }).level, 'warn')
  assert.equal(describeTurnEnd({ kind: 'max-tokens' }).level, 'warn')
})

test('session status drives the running indicator', () => {
  const view = applySessionStatus(createSessionView('s1'), 'running')
  assert.equal(view.status, 'running')
})

test('native commands echo locally and append their result notice', () => {
  const view = appendNotice(appendUserMessage(createSessionView('s1'), '/plan off'), {
    level: 'info',
    text: 'Plan mode is already inactive.',
  })
  assert.deepEqual(
    view.items.map((item) => item.kind === 'message' ? `message:${item.text}` : `notice:${item.text}`),
    ['message:/plan off', 'notice:Plan mode is already inactive.'],
  )
})
