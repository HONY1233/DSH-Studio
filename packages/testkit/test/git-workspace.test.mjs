import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-git-workspace-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await git(root, ['init', '-q', '-b', 'main'])
  await git(root, ['config', 'user.email', 'test@example.com'])
  await git(root, ['config', 'user.name', 'DSH Test'])
  await git(root, ['config', 'commit.gpgsign', 'false'])
  await writeFile(join(root, 'README.md'), 'readme base\n')
  await writeFile(join(root, 'staged.txt'), 'staged base\n')
  await writeFile(join(root, 'both.txt'), 'both base\n')
  await writeFile(join(root, 'delete.txt'), 'delete base\n')
  await writeFile(join(root, 'rename.txt'), 'rename base\n')
  await writeFile(join(root, 'gone.txt'), 'gone base\n')
  await writeFile(join(root, 'image.bin'), Buffer.from([0, 1, 2, 3]))
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src', 'code.js'), 'const value = 1\n')
  await git(root, ['add', '.'])
  await git(root, ['commit', '-q', '-m', 'base'])

  await writeFile(join(root, 'README.md'), 'changed\n')
  await writeFile(join(root, 'staged.txt'), 'staged change\n')
  await git(root, ['add', 'staged.txt'])
  await writeFile(join(root, 'both.txt'), 'index change\n')
  await git(root, ['add', 'both.txt'])
  await writeFile(join(root, 'both.txt'), 'worktree change\n')
  await rm(join(root, 'delete.txt'))
  await rm(join(root, 'gone.txt'))
  await git(root, ['add', 'gone.txt'])
  await git(root, ['mv', 'rename.txt', 'renamed.txt'])
  await writeFile(join(root, 'renamed.txt'), 'renamed and edited\n')
  await writeFile(join(root, 'added.txt'), 'added\n')
  await git(root, ['add', 'added.txt'])
  await writeFile(join(root, 'notes.txt'), 'notes\n')
  // Avoid `tmp/`: the agent-wide global gitignore excludes it, which would make
  // this fixture silently skip the nested-untracked case.
  await mkdir(join(root, 'docs'))
  await writeFile(join(root, 'docs', 'deep.txt'), 'deep\n')
  await writeFile(join(root, 'image.bin'), Buffer.from([0, 1, 2, 4]))
  return root
}

function byPath(repository, path) {
  return repository.changes.find((row) => row.path === path)
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

test('git status keeps staged, unstaged, rename, delete and untracked states distinct', async (t) => {
  const root = await fixture(t)
  const service = createGitWorkspace({ cwd: root })
  const repository = await service.repository()

  assert.equal(repository.isRepository, true)
  assert.equal(repository.branch, 'main')
  assert.match(repository.headOid, /^[a-f0-9]{40}$/)
  assert.equal(repository.unborn, false)
  assert.equal(repository.detached, false)
  assert.match(repository.revision, /^git:[a-f0-9]{64}$/)

  assert.deepEqual(byPath(repository, 'README.md'), {
    path: 'README.md', index: 'unmodified', worktree: 'modified', conflicted: false,
  })
  assert.deepEqual(byPath(repository, 'staged.txt'), {
    path: 'staged.txt', index: 'modified', worktree: 'unmodified', conflicted: false,
  })
  assert.deepEqual(byPath(repository, 'both.txt'), {
    path: 'both.txt', index: 'modified', worktree: 'modified', conflicted: false,
  })
  assert.deepEqual(byPath(repository, 'delete.txt'), {
    path: 'delete.txt', index: 'unmodified', worktree: 'deleted', conflicted: false,
  })
  assert.deepEqual(byPath(repository, 'gone.txt'), {
    path: 'gone.txt', index: 'deleted', worktree: 'unmodified', conflicted: false,
  })
  assert.deepEqual(byPath(repository, 'renamed.txt'), {
    path: 'renamed.txt', originalPath: 'rename.txt', index: 'renamed', worktree: 'modified', conflicted: false,
  })
  assert.deepEqual(byPath(repository, 'added.txt'), {
    path: 'added.txt', index: 'added', worktree: 'unmodified', conflicted: false,
  })
  assert.deepEqual(byPath(repository, 'notes.txt'), {
    path: 'notes.txt', index: 'unmodified', worktree: 'untracked', conflicted: false,
  })
  assert.equal(byPath(repository, 'docs/deep.txt')?.worktree, 'untracked')

  const again = await service.repository()
  assert.equal(again.revision, repository.revision)
  assert.deepEqual(again.changes, repository.changes)
})

test('git diff exposes working, staged and rename patches plus binary/truncation flags', async (t) => {
  const root = await fixture(t)
  const service = createGitWorkspace({ cwd: root })

  const working = await service.diff('README.md', 'working')
  assert.match(working.patch, /-readme base/)
  assert.match(working.patch, /\+changed/)
  assert.equal(working.binary, false)
  assert.equal(working.truncated, false)
  assert.match(working.revision, /^git:/)

  const staged = await service.diff('staged.txt', 'staged')
  assert.match(staged.patch, /-staged base/)
  assert.match(staged.patch, /\+staged change/)
  const workingAfterStage = await service.diff('staged.txt', 'working')
  assert.equal(workingAfterStage.patch, '')

  const renamed = await service.diff('renamed.txt', 'staged')
  assert.match(renamed.patch, /rename from rename\.txt/)
  assert.match(renamed.patch, /rename to renamed\.txt/)

  const binary = await service.diff('image.bin', 'working')
  assert.equal(binary.binary, true)
  assert.equal(binary.patch, '')

  const truncated = createGitWorkspace({ cwd: root, maxDiffBytes: 40 })
  const clipped = await truncated.diff('README.md', 'working')
  assert.equal(clipped.truncated, true)
  assert.ok(Buffer.byteLength(clipped.patch) <= 40)

  await assert.rejects(() => service.diff('../outside.txt', 'working'), (error) => error.code === 'INVALID_ARGUMENT')
  await assert.rejects(() => service.diff('/etc/passwd', 'staged'), (error) => error.code === 'INVALID_ARGUMENT')
  await assert.rejects(() => service.diff('src/a:b', 'working'), (error) => error.code === 'INVALID_ARGUMENT')
  await assert.rejects(() => service.diff('README.md', 'index'), (error) => error.code === 'INVALID_ARGUMENT')
})

test('git stage/unstage/discard mutate the real index and reject stale or conflicted actions', async (t) => {
  const root = await fixture(t)
  const service = createGitWorkspace({ cwd: root })
  const before = await service.repository()

  await service.stage(['README.md'])
  let repository = await service.repository()
  assert.equal(byPath(repository, 'README.md').index, 'modified')
  assert.equal(byPath(repository, 'README.md').worktree, 'unmodified')
  assert.notEqual(repository.revision, before.revision)

  await service.unstage(['staged.txt'])
  repository = await service.repository()
  assert.equal(byPath(repository, 'staged.txt').index, 'unmodified')
  assert.equal(byPath(repository, 'staged.txt').worktree, 'modified')

  await service.stage(['notes.txt'])
  repository = await service.repository()
  assert.equal(byPath(repository, 'notes.txt').index, 'added')
  assert.equal(byPath(repository, 'notes.txt').worktree, 'unmodified')
  await service.unstage(['notes.txt'])
  repository = await service.repository()
  assert.equal(byPath(repository, 'notes.txt').index, 'unmodified')
  assert.equal(byPath(repository, 'notes.txt').worktree, 'untracked')

  await service.unstage(['README.md'])
  repository = await service.repository()
  assert.equal(byPath(repository, 'README.md').index, 'unmodified')
  assert.equal(byPath(repository, 'README.md').worktree, 'modified')

  const discardRevision = repository.revision
  await service.discard(['README.md'], discardRevision)
  repository = await service.repository()
  assert.equal(byPath(repository, 'README.md'), undefined)
  assert.equal(await readFile(join(root, 'README.md'), 'utf8'), 'readme base\n')

  await service.discard(['notes.txt'], repository.revision)
  repository = await service.repository()
  assert.equal(byPath(repository, 'notes.txt'), undefined)
  await assert.rejects(() => readFile(join(root, 'notes.txt'), 'utf8'), (error) => error.code === 'ENOENT')

  const staleRevision = repository.revision
  await writeFile(join(root, 'README.md'), 'first edit\n')
  await writeFile(join(root, 'README.md'), 'second edit\n')
  await assert.rejects(
    () => service.discard(['README.md'], staleRevision),
    (error) => error.code === 'CONFLICT',
  )
  assert.equal(await readFile(join(root, 'README.md'), 'utf8'), 'second edit\n')

  await assert.rejects(() => service.stage(['../outside.txt']), (error) => error.code === 'INVALID_ARGUMENT')
  await assert.rejects(() => service.stage(['/etc/passwd']), (error) => error.code === 'INVALID_ARGUMENT')
  await assert.rejects(() => service.stage(['.git/config']), (error) => error.code === 'INVALID_ARGUMENT')
  await assert.rejects(() => service.stage([]), (error) => error.code === 'INVALID_ARGUMENT')
})

test('git reports merge conflicts and refuses to stage unresolved paths', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-git-conflict-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await git(root, ['init', '-q', '-b', 'main'])
  await git(root, ['config', 'user.email', 'test@example.com'])
  await git(root, ['config', 'user.name', 'DSH Test'])
  await writeFile(join(root, 'conflict.txt'), 'base\n')
  await git(root, ['add', '.'])
  await git(root, ['commit', '-q', '-m', 'base'])
  await git(root, ['checkout', '-q', '-b', 'side'])
  await writeFile(join(root, 'conflict.txt'), 'side\n')
  await git(root, ['commit', '-q', '-a', '-m', 'side'])
  await git(root, ['checkout', '-q', 'main'])
  await writeFile(join(root, 'conflict.txt'), 'main\n')
  await git(root, ['commit', '-q', '-a', '-m', 'main'])
  await assert.rejects(() => git(root, ['merge', 'side']))

  const service = createGitWorkspace({ cwd: root })
  const repository = await service.repository()
  assert.equal(repository.operation, 'merge')
  assert.deepEqual(byPath(repository, 'conflict.txt'), {
    path: 'conflict.txt', index: 'conflicted', worktree: 'conflicted', conflicted: true,
  })
  await assert.rejects(() => service.stage(['conflict.txt']), (error) => error.code === 'CONFLICT')
  await assert.rejects(() => service.unstage(['conflict.txt']), (error) => error.code === 'CONFLICT')
  await assert.rejects(
    () => service.discard(['conflict.txt'], repository.revision),
    (error) => error.code === 'CONFLICT',
  )
})

test('git bridge serves the real repository, diff and stage/commit receipts', async (t) => {
  const root = await fixture(t)
  const service = createGitWorkspace({ cwd: root })
  const { bridge, events } = harness(service)
  const contextId = bridge.openContext({ sessionId: 'session-git' })

  const repository = await bridge.query('git.repository.get', {}, contextId)
  assert.equal(repository.workspaceId, 'ws--workspace')
  assert.equal(repository.repositoryId, repository.workspaceId)
  assert.equal(repository.isRepository, true)
  assert.equal(byPath(repository, 'staged.txt').index, 'modified')
  assert.equal(byPath(repository, 'renamed.txt').originalPath, 'rename.txt')
  assert.match(repository.revision, /^git:/)

  const summary = await bridge.query('git.repository.summary', {}, contextId)
  assert.equal(summary.changedFiles, repository.changes.length)
  assert.equal(summary.isRepository, true)
  assert.match(summary.sampledAt, /^\d{4}-\d{2}-\d{2}T/)

  const diff = await bridge.query('git.diff.get', { workspaceId: repository.workspaceId, path: 'README.md', target: 'working' }, contextId)
  assert.match(diff.patch, /\+changed/)
  assert.equal(diff.revision, repository.revision)
  assert.equal(diff.path, 'README.md')

  const staged = await command(bridge, events, 'git-stage', { workspaceId: repository.workspaceId, operation: { kind: 'stage', paths: ['README.md'] } }, contextId)
  assert.equal(staged.status, 'completed', JSON.stringify(staged.error))
  assert.equal(staged.result.operation, 'stage')
  assert.equal(byPath(staged.result.repository, 'README.md').index, 'modified')
  assert.equal(byPath(staged.result.repository, 'README.md').worktree, 'unmodified')
  assert.ok(events.some((event) => event.kind === 'git.repository.changed' && event.repository?.reason === 'command'))

  const unstage = await command(bridge, events, 'git-unstage', { workspaceId: repository.workspaceId, operation: { kind: 'unstage', paths: ['staged.txt'] } }, contextId)
  assert.equal(unstage.status, 'completed', JSON.stringify(unstage.error))
  assert.equal(byPath(unstage.result.repository, 'staged.txt').worktree, 'modified')

  const commit = await command(bridge, events, 'git-commit', { workspaceId: repository.workspaceId, operation: { kind: 'commit', message: 'X5.3 commit' } }, contextId)
  assert.equal(commit.status, 'completed', JSON.stringify(commit.error))
  assert.equal(commit.result.operation, 'commit')
  assert.match(commit.result.message, /已提交 [a-f0-9]{7}：X5\.3 commit/)
  assert.ok(events.some((event) => event.kind === 'git.repository.changed' && event.repository?.reason === 'command'))

  const traversal = await command(bridge, events, 'git-traversal', { workspaceId: repository.workspaceId, operation: { kind: 'stage', paths: ['../escape.txt'] } }, contextId)
  assert.equal(traversal.status, 'failed')
  assert.equal(traversal.error.code, 'INVALID_ARGUMENT')

  const missing = await command(bridge, events, 'git-missing', { workspaceId: repository.workspaceId, operation: { kind: 'stage' } }, contextId)
  assert.equal(missing.status, 'failed')
  assert.equal(missing.error.code, 'INVALID_ARGUMENT')

  const toolchain = await bridge.query('git.toolchain.get', {}, contextId)
  assert.equal(toolchain.git.available, true)
  assert.match(toolchain.git.version, /^git version/)
})