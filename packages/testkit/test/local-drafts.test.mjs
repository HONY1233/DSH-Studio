import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createFileDraftStore } from '../../../apps/desktop/src/draft-store.js'
import { createLocalDraftStore } from '../../../apps/desktop/src/local-drafts.js'

test('file-backed local drafts survive recreation, replay writes, and reject stale revisions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-drafts-'))
  const filePath = join(directory, 'nested', 'drafts.json')
  try {
    const first = createLocalDraftStore({ store: createFileDraftStore(filePath) })
    const saved = await first.put('s1', 'composer', 'r1', 0, [{ type: 'text', text: 'keep me' }])
    assert.equal(saved.revision, 1)
    assert.equal(saved.runtimeAccepted, false)
    assert.equal(saved.runtimeQueued, false)
    assert.deepEqual(await first.put('s1', 'composer', 'r1', 0, [{ type: 'text', text: 'keep me' }]), saved)

    const second = createLocalDraftStore({ store: createFileDraftStore(filePath) })
    assert.deepEqual((await second.get('s1', 'composer')).contentBlocks, [{ type: 'text', text: 'keep me' }])
    await assert.rejects(
      second.put('s1', 'composer', 'r2', 0, [{ type: 'text', text: 'overwrite' }]),
      (error) => error.code === 'CONFLICT' && error.details.currentRevision === 1,
    )
    assert.equal((await readFile(filePath, 'utf8')).includes('overwrite'), false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a corrupt local replay journal is rejected instead of trusting forged receipts', async () => {
  let persisted = null
  const store = { async load() { return persisted }, async save(value) { persisted = value } }
  const drafts = createLocalDraftStore({ store })
  await drafts.put('s1', 'composer', 'r1', 0, [{ type: 'text', text: 'safe' }])
  const corrupted = JSON.parse(persisted)
  const requestKey = Object.keys(corrupted.requests)[0]
  corrupted.requests[requestKey].receipt.runtimeQueued = true
  persisted = JSON.stringify(corrupted)

  const restored = createLocalDraftStore({ store })
  await assert.rejects(restored.get('s1', 'composer'), (error) => error.code === 'CORRUPT_RECORD')
  assert.equal(JSON.parse(persisted).requests[requestKey].receipt.runtimeQueued, true)
})

test('corrupt local drafts fail visibly rather than silently replacing user data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-drafts-corrupt-'))
  const filePath = join(directory, 'drafts.json')
  try {
    await writeFile(filePath, '{broken', 'utf8')
    const drafts = createLocalDraftStore({ store: createFileDraftStore(filePath) })
    await assert.rejects(drafts.get('s1', 'composer'), (error) => error.code === 'CORRUPT_RECORD')
    assert.equal(await readFile(filePath, 'utf8'), '{broken')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
