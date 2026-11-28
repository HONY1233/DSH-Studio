import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import { createStudioBridge } from '../../../apps/desktop/src/studio-bridge.js'
import { createGitWorkspace } from '@dsh-studio/host-services'

const execFileAsync = promisify(execFile)

async function git(cwd, args) {
  return execFileAsync('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 })
}

async function initRepository(t, prefix = 'dsh-git-history-') {
  const root = await mkdtemp(join(tmpdir(), prefix))
  t.after(() => rm(root, { recursive: true, force: true }))
  await git(root, ['init', '-q', '-b', 'main'])
  await git(root, ['config', 'user.email', 'test@example.com'])
  await git(root, ['config', 'user.name', 'DSH Test'])
  await git(root, ['config', 'commit.gpgsign', 'false'])
  return root
}

async function seedCommits(t, count = 4) {
  const root = await initRepository(t)
  await writeFile(join(root, 'history.txt'), 'line 1\n')
  await git(root, ['add', '.'])
  await git(root, ['commit', '-q', '-m', 'commit 1'])
  for (let index = 2; index <= count; index += 1) {
    await writeFile(join(root, 'history.txt'), `line ${index}\n`)
    await git(root, ['commit', '-q', '-a', '-m', `commit ${index}`])
  }
  const oids = (await git(root, ['rev-list', 'HEAD'])).stdout.trim().split('\n')
  return { root, oids }
}

function harness(gitWorkspace) {
  const events = []
  const runtime = {
    state: 'ready',
    options: { cwd: '/workspace' },
    resume: async () => {},
    query: async () => ({ messageId: 'm1' }),
  }
  const bridge = createStudioBridge({
    runtime,
    cwd: '/workspace',
    emit: (event) => events.push(event),
    gitWorkspace,
  })
  return { bridge, events }
}

async function command(bridge, events, requestId, input, contextId) {
  bridge.command({ requestId, commandName: 'git.execute', input }, contextId)
  for (let attempt = 0; attempt < 400; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2))
    const receipt = events.find((event) => event.kind === 'command.receipt' && event.receipt?.requestId === requestId)?.receipt
    if (receipt) return receipt
  }
  return undefined
}

test('git log paginates real history and classifies local, remote and tag refs', async (t) => {
  const { root, oids } = await seedCommits(t, 4)
  await git(root, ['branch', 'feat/x', 'HEAD'])
  await git(root, ['tag', 'v1', 'HEAD'])
  await git(root, ['remote', 'add', 'origin', 'https://example.invalid/demo.git'])
  await git(root, ['update-ref', 'refs/remotes/origin/feat/x', 'HEAD'])
  const service = createGitWorkspace({ cwd: root })

  const all = await service.log({ limit: 4 })
  assert.deepEqual(all.commits.map((row) => row.oid), oids)
  assert.equal(all.commits[0].relation, 'head')
  assert.equal(all.commits[1].relation, 'common')
  assert.equal(all.truncated, false)
  assert.equal(all.cursor, undefined)
  assert.equal(all.headOid, oids[0])
  assert.equal(all.ahead, 0)
  assert.equal(all.behind, 0)

  const headRefs = all.commits[0].refs
  const branch = headRefs.find((ref) => ref.name === 'feat/x')
  assert.deepEqual(branch, { name: 'feat/x', kind: 'local', current: false })
  assert.deepEqual(headRefs.find((ref) => ref.name === 'main'), { name: 'main', kind: 'local', current: true })
  assert.deepEqual(headRefs.find((ref) => ref.name === 'origin/feat/x'), { name: 'origin/feat/x', kind: 'remote', current: false })
  assert.deepEqual(headRefs.find((ref) => ref.name === 'v1'), { name: 'v1', kind: 'tag', current: false })

  const firstPage = await service.log({ limit: 2 })
  assert.deepEqual(firstPage.commits.map((row) => row.oid), oids.slice(0, 2))
  assert.equal(firstPage.truncated, true)
  assert.equal(firstPage.cursor, '2')

  const secondPage = await service.log({ limit: 2, skip: 2 })
  assert.deepEqual(secondPage.commits.map((row) => row.oid), oids.slice(2))
  assert.equal(secondPage.truncated, false)
  assert.equal(secondPage.cursor, undefined)
  assert.equal(secondPage.commits[0].relation, 'common')

  const beyond = await service.log({ limit: 2, skip: 10 })
  assert.deepEqual(beyond.commits, [])
  assert.equal(beyond.truncated, false)

  await assert.rejects(() => service.log({ limit: 0 }), (error) => error.code === 'INVALID_ARGUMENT')
  await assert.rejects(() => service.log({ limit: 201 }), (error) => error.code === 'INVALID_ARGUMENT')
  await assert.rejects(() => service.log({ skip: -1 }), (error) => error.code === 'INVALID_ARGUMENT')

  const unborn = await initRepository(t, 'dsh-git-unborn-')
  const empty = await createGitWorkspace({ cwd: unborn }).log()
  assert.deepEqual(empty, { commits: [], truncated: false, ahead: 0, behind: 0 })

  const outside = await mkdtemp(join(tmpdir(), 'dsh-git-nonrepo-'))
  t.after(() => rm(outside, { recursive: true, force: true }))
  await assert.rejects(() => createGitWorkspace({ cwd: outside }).log(), (error) => error.code === 'NOT_FOUND')
})

test('git log reports upstream ahead/behind and merge base from a real remote', async (t) => {
  const root = await initRepository(t, 'dsh-git-upstream-')
  const remote = await mkdtemp(join(tmpdir(), 'dsh-git-remote-'))
  t.after(() => rm(remote, { recursive: true, force: true }))
  await git(remote, ['init', '-q', '--bare'])
  await writeFile(join(root, 'app.txt'), 'v1\n')
  await git(root, ['add', '.'])
  await git(root, ['commit', '-q', '-m', 'base'])
  await git(root, ['remote', 'add', 'origin', remote])
  await git(root, ['push', '-q', '-u', 'origin', 'main'])
  const base = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim()
  await writeFile(join(root, 'app.txt'), 'v2\n')
  await git(root, ['commit', '-q', '-a', '-m', 'local 2'])
  await writeFile(join(root, 'app.txt'), 'v3\n')
  await git(root, ['commit', '-q', '-a', '-m', 'local 3'])

  const model = await createGitWorkspace({ cwd: root }).log({ limit: 3 })
  assert.equal(model.upstream, 'origin/main')
  assert.equal(model.ahead, 2)
  assert.equal(model.behind, 0)
  assert.equal(model.mergeBaseOid, base)
  assert.deepEqual(model.commits.map((row) => row.relation), ['head', 'outgoing', 'common'])
})

test('git worktrees list the real root and linked worktrees with stable ids and locks', async (t) => {
  const { root } = await seedCommits(t, 1)
  const container = await mkdtemp(join(tmpdir(), 'dsh-git-linked-'))
  t.after(() => rm(container, { recursive: true, force: true }))
  const linked = join(container, 'linked')
  await git(root, ['worktree', 'add', '-q', '-b', 'linked-branch', linked])

  const service = createGitWorkspace({ cwd: root })
  const model = await service.worktrees()
  assert.equal(model.rootConfigured, true)
  assert.equal(model.worktrees.length, 2)
  const rootRow = model.worktrees.find((row) => row.current)
  const linkedRow = model.worktrees.find((row) => !row.current)
  assert.equal(rootRow.branch, 'main')
  assert.equal(rootRow.name, root.split(/[\\/]/).pop())
  assert.equal(linkedRow.branch, 'linked-branch')
  assert.equal(linkedRow.name, 'linked')
  assert.equal(linkedRow.detached, false)
  assert.equal(linkedRow.bare, false)
  assert.equal(linkedRow.locked, false)
  assert.equal(linkedRow.prunable, false)
  assert.match(rootRow.worktreeId, /^wt_[a-f0-9]{24}$/)
  assert.match(linkedRow.worktreeId, /^wt_[a-f0-9]{24}$/)
  assert.notEqual(rootRow.worktreeId, linkedRow.worktreeId)
  assert.match(rootRow.headOid, /^[a-f0-9]{40}$/)

  const again = await service.worktrees()
  assert.deepEqual(again.worktrees.map((row) => row.worktreeId), model.worktrees.map((row) => row.worktreeId))

  await git(root, ['worktree', 'lock', '--reason', 'test hold', linked])
  const locked = await service.worktrees()
  const lockedRow = locked.worktrees.find((row) => !row.current)
  assert.equal(lockedRow.locked, true)
  assert.equal(lockedRow.lockReason, 'test hold')
  await git(root, ['worktree', 'unlock', linked])

  const outside = await mkdtemp(join(tmpdir(), 'dsh-git-worktree-nonrepo-'))
  t.after(() => rm(outside, { recursive: true, force: true }))
  await assert.rejects(() => createGitWorkspace({ cwd: outside }).worktrees(), (error) => error.code === 'NOT_FOUND')
})

test('git commit runs hooks by default and refuses amend/noVerify/sign mutation', async (t) => {
  const root = await initRepository(t, 'dsh-git-commit-')
  await writeFile(join(root, 'app.txt'), 'base\n')
  await git(root, ['add', '.'])
  await git(root, ['commit', '-q', '-m', 'base'])
  const service = createGitWorkspace({ cwd: root })
  const before = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim()

  await writeFile(join(root, 'app.txt'), 'blocked\n')
  await git(root, ['add', 'app.txt'])
  await mkdir(join(root, '.git', 'hooks'), { recursive: true })
  const hook = join(root, '.git', 'hooks', 'pre-commit')
  await writeFile(hook, '#!/bin/sh\necho "pre-commit hook blocked this commit" >&2\nexit 1\n')
  await chmod(hook, 0o755)
  await assert.rejects(
    () => service.commit('blocked'),
    (error) => error.code === 'FAILED_PRECONDITION' && /hook/.test(error.message),
  )
  assert.equal((await git(root, ['rev-parse', 'HEAD'])).stdout.trim(), before)
  assert.equal((await service.repository()).changes.find((row) => row.path === 'app.txt').index, 'modified')

  await rm(hook)
  const committed = await service.commit('allowed')
  assert.notEqual(committed.oid, before)
  assert.equal(committed.parent, before)
  assert.equal(committed.subject, 'allowed')
  assert.equal((await git(root, ['rev-parse', 'HEAD'])).stdout.trim(), committed.oid)

  const headAfterCommit = committed.oid
  await assert.rejects(
    () => service.commit('rewrite', { amend: true }),
    (error) => error.code === 'PERMISSION_DENIED',
  )
  await assert.rejects(
    () => service.commit('skip hooks', { noVerify: true }),
    (error) => error.code === 'PERMISSION_DENIED',
  )
  await assert.rejects(
    () => service.commit('signed', { sign: true }),
    (error) => error.code === 'CAPABILITY_UNAVAILABLE',
  )
  assert.equal((await git(root, ['rev-parse', 'HEAD'])).stdout.trim(), headAfterCommit)

  await assert.rejects(() => service.commit(''), (error) => error.code === 'INVALID_ARGUMENT')
  await assert.rejects(() => service.commit('   '), (error) => error.code === 'INVALID_ARGUMENT')
  await assert.rejects(() => service.commit('again'), (error) => error.code === 'FAILED_PRECONDITION')
  assert.equal((await git(root, ['rev-parse', 'HEAD'])).stdout.trim(), headAfterCommit)
})

test('git commit with paths stages only the selected paths', async (t) => {
  const root = await initRepository(t, 'dsh-git-path-commit-')
  await writeFile(join(root, 'a.txt'), 'a base\n')
  await writeFile(join(root, 'b.txt'), 'b base\n')
  await git(root, ['add', '.'])
  await git(root, ['commit', '-q', '-m', 'base'])
  await writeFile(join(root, 'a.txt'), 'a next\n')
  await writeFile(join(root, 'b.txt'), 'b next\n')

  const service = createGitWorkspace({ cwd: root })
  const committed = await service.commit('only a', { paths: ['a.txt'] })
  assert.deepEqual(committed.paths, ['a.txt'])
  const repository = await service.repository()
  assert.equal(repository.changes.find((row) => row.path === 'a.txt'), undefined)
  assert.deepEqual(repository.changes.find((row) => row.path === 'b.txt'), {
    path: 'b.txt', index: 'unmodified', worktree: 'modified', conflicted: false,
  })
  const files = await service.commitChanges(committed.oid)
  assert.deepEqual(files.files, [{ path: 'a.txt', status: 'modified' }])
})

test('git commit changes and diffs cover renames, root commits, binary and truncation', async (t) => {
  const root = await initRepository(t, 'dsh-git-commit-read-')
  await writeFile(join(root, 'old.txt'), 'old content\n')
  await git(root, ['add', '.'])
  await git(root, ['commit', '-q', '-m', 'root'])
  const rootOid = (await git(root, ['rev-list', '--max-parents=0', 'HEAD'])).stdout.trim()

  await git(root, ['mv', 'old.txt', 'new.txt'])
  await writeFile(join(root, 'new.txt'), 'old content\nedited\n')
  await writeFile(join(root, 'image.bin'), Buffer.from([0, 1, 2, 3, 4]))
  await git(root, ['add', '.'])
  await git(root, ['commit', '-q', '-m', 'rename and binary'])
  const oid = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim()

  const service = createGitWorkspace({ cwd: root })
  const changes = await service.commitChanges(oid)
  assert.equal(changes.oid, oid)
  assert.equal(changes.subject, 'rename and binary')
  assert.deepEqual(changes.files, [
    { path: 'image.bin', status: 'added' },
    { path: 'new.txt', status: 'renamed', originalPath: 'old.txt' },
  ])

  const text = await service.commitDiff(oid, 'new.txt')
  assert.match(text.patch, /\+edited/)
  assert.equal(text.binary, false)
  assert.equal(text.truncated, false)

  const binary = await service.commitDiff(oid, 'image.bin')
  assert.equal(binary.binary, true)
  assert.equal(binary.patch, '')

  const rootChanges = await service.commitChanges(rootOid)
  assert.deepEqual(rootChanges.files, [{ path: 'old.txt', status: 'added' }])
  const rootDiff = await service.commitDiff(rootOid, 'old.txt')
  assert.match(rootDiff.patch, /\+old content/)

  const tiny = createGitWorkspace({ cwd: root, maxDiffBytes: 20 })
  const clipped = await tiny.commitDiff(oid, 'new.txt')
  assert.equal(clipped.truncated, true)
  assert.ok(Buffer.byteLength(clipped.patch) <= 20)

  await assert.rejects(() => service.commitChanges('not-hex'), (error) => error.code === 'INVALID_ARGUMENT')
  await assert.rejects(() => service.commitChanges('deadbeef'), (error) => error.code === 'NOT_FOUND')
  await assert.rejects(() => service.commitChanges('HEAD'), (error) => error.code === 'INVALID_ARGUMENT')
  await assert.rejects(() => service.commitDiff(oid, '../escape.txt'), (error) => error.code === 'INVALID_ARGUMENT')
})

test('git bridge serves history, worktrees, commit reads and commit execution', async (t) => {
  const root = await initRepository(t, 'dsh-git-bridge-history-')
  await writeFile(join(root, 'app.txt'), 'base\n')
  await git(root, ['add', '.'])
  await git(root, ['commit', '-q', '-m', 'base'])
  await writeFile(join(root, 'app.txt'), 'second\n')
  await git(root, ['commit', '-q', '-a', '-m', 'second'])
  const oid = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim()
  await writeFile(join(root, 'next.txt'), 'next\n')

  const service = createGitWorkspace({ cwd: root })
  const { bridge, events } = harness(service)
  const contextId = bridge.openContext({ sessionId: 'session-history' })

  const log = await bridge.query('git.log.list', { limit: 1 }, contextId)
  assert.equal(log.workspaceId, 'ws--workspace')
  assert.equal(log.commits.length, 1)
  assert.equal(log.commits[0].oid, oid)
  assert.equal(log.truncated, true)
  assert.equal(log.cursor, '1')

  const changes = await bridge.query('git.commit.changes', { oid }, contextId)
  assert.equal(changes.workspaceId, 'ws--workspace')
  assert.equal(changes.oid, oid)
  assert.equal(changes.subject, 'second')
  assert.deepEqual(changes.files, [{ path: 'app.txt', status: 'modified' }])

  const diff = await bridge.query('git.commit.diff', { oid, path: 'app.txt' }, contextId)
  assert.equal(diff.workspaceId, 'ws--workspace')
  assert.equal(diff.oid, oid)
  assert.equal(diff.path, 'app.txt')
  assert.match(diff.patch, /\+second/)
  assert.equal(diff.binary, false)

  const worktrees = await bridge.query('git.worktrees.list', {}, contextId)
  assert.equal(worktrees.workspaceId, 'ws--workspace')
  assert.equal(worktrees.rootConfigured, true)
  assert.equal(worktrees.worktrees.length, 1)
  assert.equal(worktrees.worktrees[0].current, true)
  assert.equal(worktrees.worktrees[0].branch, 'main')

  const staged = await command(bridge, events, 'history-stage', { workspaceId: worktrees.workspaceId, operation: { kind: 'stage', paths: ['next.txt'] } }, contextId)
  assert.equal(staged.status, 'completed', JSON.stringify(staged.error))

  const denied = await command(bridge, events, 'history-no-verify', { workspaceId: worktrees.workspaceId, operation: { kind: 'commit', message: 'skip', noVerify: true } }, contextId)
  assert.equal(denied.status, 'failed')
  assert.equal(denied.error.code, 'PERMISSION_DENIED')
  assert.equal((await git(root, ['rev-parse', 'HEAD'])).stdout.trim(), oid)

  const committed = await command(bridge, events, 'history-commit', { workspaceId: worktrees.workspaceId, operation: { kind: 'commit', message: 'bridge commit' } }, contextId)
  assert.equal(committed.status, 'completed', JSON.stringify(committed.error))
  assert.equal(committed.result.operation, 'commit')
  assert.match(committed.result.message, /已提交 [a-f0-9]{7}：bridge commit/)
  assert.notEqual(committed.result.repository.headOid, oid)
  assert.ok(events.some((event) => event.kind === 'git.repository.changed' && event.repository?.reason === 'command'))

  const headSubject = (await git(root, ['show', '-s', '--format=%s', 'HEAD'])).stdout.trim()
  assert.equal(headSubject, 'bridge commit')
  assert.equal(await readFile(join(root, 'next.txt'), 'utf8'), 'next\n')

  const invalid = await command(bridge, events, 'history-invalid', { workspaceId: worktrees.workspaceId, operation: { kind: 'commit', message: '' } }, contextId)
  assert.equal(invalid.status, 'failed')
  assert.equal(invalid.error.code, 'INVALID_ARGUMENT')
})