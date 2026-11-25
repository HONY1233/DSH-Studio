import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { resolveWslCwd } from '../../../apps/desktop/scripts/wsl-path.mjs'

test('Windows lifecycle cwd uses the real wslpath command and selected distro', async () => {
  const calls = []
  const result = await resolveWslCwd('F:\\projects\\dsh-studio', {
    distro: 'Ubuntu-Test',
    execute: async (...args) => {
      calls.push(args)
      return { stdout: '/home/tester/projects/dsh-studio\n' }
    },
  })
  assert.equal(result, '/home/tester/projects/dsh-studio')
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], [
    'wsl.exe',
    ['-d', 'Ubuntu-Test', '--', 'wslpath', '-u', 'F:/projects/dsh-studio'],
    { windowsHide: true },
  ])
})

test('absolute POSIX lifecycle cwd remains unchanged', async () => {
  assert.equal(await resolveWslCwd('/home/tester/projects/dsh-studio'), '/home/tester/projects/dsh-studio')
})

test('relative and malformed lifecycle cwd fail closed', async () => {
  await assert.rejects(resolveWslCwd('projects/dsh-studio'), /absolute/)
  await assert.rejects(resolveWslCwd('C:\\projects\nbad'), /Invalid WSL cwd/)
  await assert.rejects(resolveWslCwd('C:\\projects\\dsh-studio', {
    execute: async () => ({ stdout: 'not-a-posix-path' }),
  }), /invalid WSL path/)
  const probe = readFileSync(new URL('../../../apps/desktop/scripts/desktop-lifecycle-probe.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(probe, /\/mnt\/f\/projects\/dsh-studio/u)
  assert.match(probe, /await resolveWslCwd\(process\.env\.DSH_CWD \?\? repo/u)
})
