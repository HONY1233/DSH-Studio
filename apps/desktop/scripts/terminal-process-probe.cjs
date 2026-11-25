const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { app } = require('electron')
const nodePty = require('node-pty')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitUntil(predicate, timeoutMs = 15000) {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started >= timeoutMs) return false
    await wait(50)
  }
  return true
}

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error?.code === 'EPERM') return true
    if (error?.code === 'ESRCH') return false
    throw error
  }
}

async function run() {
  const { createTerminalService } = await import(pathToFileURL(path.join(__dirname, '../src/terminal-service.js')).href)
  const cwd = process.env.DSH_TERMINAL_CWD ?? path.join(__dirname, '../../..')
  const service = createTerminalService({
    spawn: nodePty.spawn,
    distro: process.env.DSH_TERMINAL_DISTRO ?? 'Ubuntu',
    user: process.env.DSH_TERMINAL_USER ?? 'qtt199',
    cwd,
  })
  const created = []
  try {
    const native = service.createNative('probe-native-owner')
    created.push(native)
    const omp = service.create({ ownerId: 'probe-omp-owner', kind: 'omp', cols: 100, rows: 30 })
    created.push(omp)
    assert.equal(service.size(), 2)
    assert.equal(service.createNative('probe-native-owner'), native)
    assert.equal(service.size(), 2)

    service.write(native.id, native.ownerId, 'printf "DSH_PTY_NATIVE_READY\\n"\r')
    service.write(omp.id, omp.ownerId, 'printf "DSH_PTY_OMP_READY\\n"\r')
    assert.equal(await waitUntil(() => native.buffer.includes('DSH_PTY_NATIVE_READY') && omp.buffer.includes('DSH_PTY_OMP_READY')), true)
    assert.deepEqual(service.resize(native.id, native.ownerId, 120, 40), { cols: 120, rows: 40 })
    assert.equal(service.write(native.id, 'foreign-owner', 'printf "FOREIGN_WRITE\\n"\r'), false)
    assert.equal(service.dispose(native.id, 'foreign-owner'), false)
    assert.equal(processAlive(native.pid), true)
    assert.equal(processAlive(omp.pid), true)

    assert.equal(service.disposeOwner(native.ownerId), 1)
    assert.equal(service.dispose(omp.id, omp.ownerId), true)
    assert.equal(service.size(), 0)
    assert.equal(await waitUntil(() => !processAlive(native.pid) && !processAlive(omp.pid)), true)
    assert.equal(service.disposeAll(), 0)

    return {
      electron: process.versions.electron,
      distro: process.env.DSH_TERMINAL_DISTRO ?? 'Ubuntu',
      user: process.env.DSH_TERMINAL_USER ?? 'qtt199',
      started: created.length,
      readyMarkers: ['DSH_PTY_NATIVE_READY', 'DSH_PTY_OMP_READY'],
      foreignWriteRejected: true,
      foreignDisposeRejected: true,
      disposedByRegistry: 2,
      osProcessesAliveAfterDispose: created.filter((entry) => processAlive(entry.pid)).length,
      remainingRegistryEntries: service.size(),
    }
  } finally {
    service.disposeAll()
  }
}

app.whenReady().then(async () => {
  try {
    const result = await run()
    console.log(JSON.stringify({ ok: true, result }, null, 2))
    app.exit(0)
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.stack ?? String(error) }, null, 2))
    app.exit(1)
  }
})
