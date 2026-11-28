import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createWorkspaceFiles } from '@dsh-studio/host-services'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-workspace-files-'))
  await writeFile(join(root, 'README.md'), 'hello\r\nworld\r\n')
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src', 'index.js'), 'export const value = 1\n')
  return root
}

function codeOf(code) {
  return (error) => {
    assert.equal(error.code, code, error.message)
    return true
  }
}

test('workspace files expose a content-hash version and preserve encoding on save', async (t) => {
  const root = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  const files = createWorkspaceFiles({ root })

  const rows = await files.list()
  assert.deepEqual(rows.map((row) => [row.type, row.name]), [
    ['dir', 'src'],
    ['file', 'README.md'],
  ])
  assert.equal((await files.list('src'))[0].path, 'src/index.js')

  const read = await files.readText('README.md')
  assert.equal(read.text, 'hello\r\nworld\r\n')
  assert.equal(read.lineEnding, 'crlf')
  assert.equal(read.encoding, 'utf8')
  assert.equal(read.bom, false)
  assert.match(read.file.version, /^sha256:[a-f0-9]{64}$/)

  const inspect = await files.inspect('README.md')
  assert.equal(inspect.version, read.file.version)
  assert.equal(inspect.size, Buffer.byteLength(read.text))
  assert.equal(inspect.writable, true)

  const saved = await files.writeText('README.md', {
    text: 'hello\nworld\nchanged\n',
    expectedVersion: read.file.version,
    encoding: 'utf8',
    bom: false,
    lineEnding: 'lf',
  })
  assert.equal(saved.saved, true)
  assert.notEqual(saved.file.version, read.file.version)
  assert.equal(await readFile(join(root, 'README.md'), 'utf8'), 'hello\nworld\nchanged\n')
  assert.deepEqual((await readdir(root)).filter((name) => name.endsWith('.tmp')), [])

  const beBody = Buffer.from('wide\r\ntext', 'utf16le')
  beBody.swap16()
  await writeFile(join(root, 'wide.txt'), Buffer.concat([Buffer.from([0xfe, 0xff]), beBody]))
  const wide = await files.readText('wide.txt')
  assert.equal(wide.text, 'wide\r\ntext')
  assert.equal(wide.encoding, 'utf16be')
  assert.equal(wide.bom, true)
  assert.equal(wide.lineEnding, 'crlf')
  const wideSaved = await files.writeText('wide.txt', {
    text: 'next\ntext',
    expectedVersion: wide.file.version,
    encoding: 'utf16be',
    bom: true,
    lineEnding: 'lf',
  })
  assert.equal(wideSaved.saved, true)
  const bytes = await readFile(join(root, 'wide.txt'))
  assert.deepEqual([...bytes.subarray(0, 2)], [0xfe, 0xff])
  const reloaded = await files.readText('wide.txt')
  assert.equal(reloaded.text, 'next\ntext')
})

test('workspace files reject stale versions without touching the bytes on disk', async (t) => {
  const root = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  const files = createWorkspaceFiles({ root })
  const read = await files.readText('README.md')
  await writeFile(join(root, 'README.md'), 'agent edit\r\n')

  const conflict = await files.writeText('README.md', {
    text: 'my draft\n',
    expectedVersion: read.file.version,
    encoding: 'utf8',
    bom: false,
    lineEnding: 'lf',
  })
  assert.equal(conflict.saved, false)
  assert.equal(conflict.conflict, true)
  assert.notEqual(conflict.file.version, read.file.version)
  assert.equal(await readFile(join(root, 'README.md'), 'utf8'), 'agent edit\r\n')

  const latest = await files.readText('README.md')
  const saved = await files.writeText('README.md', {
    text: 'explicit overwrite\n',
    expectedVersion: latest.file.version,
    encoding: 'utf8',
    bom: false,
    lineEnding: 'lf',
  })
  assert.equal(saved.saved, true)
  assert.equal(await readFile(join(root, 'README.md'), 'utf8'), 'explicit overwrite\n')
})

test('workspace files reject lexical, absolute and symlink escapes', async (t) => {
  const root = await fixture()
  const outside = await mkdtemp(join(tmpdir(), 'dsh-workspace-files-outside-'))
  t.after(() => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(outside, { recursive: true, force: true }),
  ]))
  await writeFile(join(outside, 'secret.txt'), 'outside secret\n')
  const files = createWorkspaceFiles({ root })

  for (const path of ['../outside.txt', 'src/../../outside.txt', '/etc/passwd', 'C:\\Windows\\win.ini', 'src/a:b']) {
    await assert.rejects(() => files.readText(path), codeOf('INVALID_ARGUMENT'), path)
    await assert.rejects(() => files.writeText(path, {
      text: 'x', expectedVersion: 'missing', encoding: 'utf8', bom: false, lineEnding: 'lf',
    }), codeOf('INVALID_ARGUMENT'), path)
  }

  await symlink(outside, join(root, 'escape'), 'dir')
  await symlink(join(outside, 'secret.txt'), join(root, 'secret-link.txt'), 'file')
  await assert.rejects(() => files.readText('escape/secret.txt'), codeOf('INVALID_ARGUMENT'))
  await assert.rejects(() => files.inspect('secret-link.txt'), codeOf('INVALID_ARGUMENT'))
  await assert.rejects(() => files.writeText('escape/new.txt', {
    text: 'x', expectedVersion: 'missing', encoding: 'utf8', bom: false, lineEnding: 'lf',
  }), codeOf('INVALID_ARGUMENT'))
})

test('workspace file creation never overwrites and directory creation stays inside the root', async (t) => {
  const root = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  const files = createWorkspaceFiles({ root })

  assert.deepEqual(await files.createFile('src/new.ts', { text: 'export {}\n' }), {
    applied: true,
    kind: 'file',
    path: 'src/new.ts',
  })
  assert.equal(await readFile(join(root, 'src', 'new.ts'), 'utf8'), 'export {}\n')
  await assert.rejects(() => files.createFile('src/new.ts'), codeOf('CONFLICT'))

  assert.deepEqual(await files.createDirectory('src/nested'), {
    applied: true,
    kind: 'directory',
    path: 'src/nested',
  })
  await assert.rejects(() => files.createDirectory('src/nested'), codeOf('CONFLICT'))
  await assert.rejects(() => files.createDirectory('missing/child'), codeOf('STORAGE_FAILED'))
  await assert.rejects(() => files.createDirectory('../outside-dir'), codeOf('INVALID_ARGUMENT'))
})

test('workspace saves leave the original intact when staging fails', async (t) => {
  const root = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  const files = createWorkspaceFiles({ root })
  const read = await files.readText('src/index.js')
  await chmod(join(root, 'src'), 0o555)
  try {
    await assert.rejects(() => files.writeText('src/index.js', {
      text: 'broken\n',
      expectedVersion: read.file.version,
      encoding: 'utf8',
      bom: false,
      lineEnding: 'lf',
    }), codeOf('STORAGE_FAILED'))
    assert.equal(await readFile(join(root, 'src', 'index.js'), 'utf8'), 'export const value = 1\n')
    assert.deepEqual((await readdir(join(root, 'src'))).filter((name) => name.endsWith('.tmp')), [])
  } finally {
    await chmod(join(root, 'src'), 0o755)
  }
})

test('workspace chunks require the current version and are bounded', async (t) => {
  const root = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  const files = createWorkspaceFiles({ root })
  const read = await files.readText('src/index.js')

  const chunk = await files.readChunk('src/index.js', {
    version: read.file.version,
    offset: 7,
    length: 5,
  })
  assert.equal(Buffer.from(chunk.data, 'base64').toString('utf8'), 'const')
  assert.equal(chunk.bytes, 5)

  await writeFile(join(root, 'src', 'index.js'), 'changed\n')
  await assert.rejects(() => files.readChunk('src/index.js', {
    version: read.file.version,
    offset: 0,
    length: 5,
  }), codeOf('CONFLICT'))
})

test('workspace delete and rename act on the entry and verify its real target', async (t) => {
  const root = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  const files = createWorkspaceFiles({ root })

  assert.deepEqual(await files.rename('README.md', 'GUIDE.md'), { applied: true, path: 'GUIDE.md' })
  assert.equal(await readFile(join(root, 'GUIDE.md'), 'utf8'), 'hello\r\nworld\r\n')
  await writeFile(join(root, 'taken.md'), 'occupied\n')
  await assert.rejects(() => files.rename('GUIDE.md', 'taken.md'), codeOf('CONFLICT'))
  await assert.rejects(() => files.rename('GUIDE.md', '../escape.md'), codeOf('INVALID_ARGUMENT'))

  await files.remove('GUIDE.md')
  await assert.rejects(() => files.readText('GUIDE.md'), codeOf('NOT_FOUND'))
})