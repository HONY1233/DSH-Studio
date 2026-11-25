import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTerminalService } from '../../../apps/desktop/src/terminal-service.js'

class FakePty {
  constructor() {
    this.pid = 1000 + Math.floor(Math.random() * 1000)
    this.writes = []
    this.sizes = []
    this.killed = false
    this.dataHandlers = []
    this.exitHandlers = []
  }
  write(data) { this.writes.push(data) }
  resize(cols, rows) { this.sizes.push({ cols, rows }) }
  kill() { this.killed = true }
  onData(handler) { this.dataHandlers.push(handler) }
  onExit(handler) { this.exitHandlers.push(handler) }
  emitData(data) { for (const handler of this.dataHandlers) handler(data) }
  emitExit(exitCode) { for (const handler of this.exitHandlers) handler({ exitCode }) }
}

function service(options = {}) {
  const terminals = []
  const registry = createTerminalService({
    spawn: () => {
      const term = new FakePty()
      terminals.push(term)
      return term
    },
    distro: 'Ubuntu', user: 'tester', cwd: '/tmp', maxSessions: 2,
    ...options,
  })
  return { registry, terminals }
}

test('native terminal is reused per owner and keeps bounded scrollback', () => {
  const { registry, terminals } = service({ scrollbackLimit: 5 })
  const first = registry.createNative(7)
  assert.equal(registry.createNative(7), first)
  assert.equal(terminals.length, 1)
  first.term.emitData('123456789')
  assert.equal(first.buffer, '56789')
  assert.equal(registry.write(first.id, 8, 'x'), false)
  assert.equal(registry.write(first.id, 7, 'pwd\n'), true)
  assert.deepEqual(first.term.writes, ['pwd\n'])
})

test('owner cleanup disposes native and OMP terminals without touching another owner', () => {
  const { registry, terminals } = service()
  registry.createNative(1)
  const firstOmp = registry.create({ ownerId: 1, kind: 'omp' })
  const secondOmp = registry.create({ ownerId: 2, kind: 'omp' })

  assert.equal(registry.disposeOwner(1), 2)
  assert.equal(terminals[0].killed, true)
  assert.equal(firstOmp.term.killed, true)
  assert.equal(secondOmp.term.killed, false)
  assert.equal(registry.size(), 1)
  assert.equal(registry.dispose(firstOmp.id, 2), false)
})

test('late data and exit from a killed PTY cannot affect a reused terminal id', () => {
  const { registry, terminals } = service()
  const first = registry.createNative(7)
  assert.equal(registry.dispose(first.id, 7), true)
  const second = registry.createNative(7)
  assert.equal(second.id, first.id)

  first.term.emitData('stale-output')
  first.term.emitExit(0)
  assert.equal(second.buffer, '')
  assert.equal(registry.get(first.id), second)

  second.term.emitData('fresh-output')
  second.term.emitExit(0)
  assert.equal(registry.get(first.id), null)
})

test('natural exit removes the ledger entry and OMP session cap is enforced', () => {
  const { registry, terminals } = service()
  const first = registry.create({ ownerId: 1, kind: 'omp' })
  const second = registry.create({ ownerId: 1, kind: 'omp' })
  assert.throws(() => registry.create({ ownerId: 1, kind: 'omp' }), /上限/)

  first.term.emitExit(0)
  assert.equal(registry.get(first.id), null)
  assert.equal(registry.get(second.id), second)
  assert.equal(registry.disposeAll(), 1)
  assert.equal(terminals[1].killed, true)
})
