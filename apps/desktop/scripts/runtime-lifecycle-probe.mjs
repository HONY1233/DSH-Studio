import assert from 'node:assert/strict'
import { RuntimeClient } from '@dsh-studio/runtime-client'

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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

async function waitUntil(predicate, timeoutMs = 10_000) {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started >= timeoutMs) return false
    await wait(50)
  }
  return true
}

const client = new RuntimeClient({
  ...(process.env.DSH_RUNTIME_CWD ? { cwd: process.env.DSH_RUNTIME_CWD } : {}),
  recordPath: null,
})
const outboundMethods = []
const serverRequests = []
client.on('frame', ({ dir, frame }) => {
  if (dir === 'out' && typeof frame?.method === 'string') outboundMethods.push(frame.method)
})
client.on('request', ({ method }) => serverRequests.push(method))

const cycles = []
try {
  for (let cycle = 1; cycle <= 2; cycle += 1) {
    const startedAt = Date.now()
    await client.start()
    const child = client.child
    assert.ok(child?.pid > 0)
    const pid = child.pid
    const info = await client.initialize()
    assert.equal(info.name, 'deepseek-harness-sdk-runtime')
    assert.equal(client.state, 'ready')

    await client.stop()
    assert.equal(client.child, null)
    assert.equal(client.state, 'exited')
    assert.equal(client.record, null)
    assert.equal(await waitUntil(() => !processAlive(pid)), true, `runtime process ${pid} survived stop`)

    cycles.push({
      cycle,
      pidExitedAfterStop: !processAlive(pid),
      stateAfterStop: client.state,
      elapsedMs: Date.now() - startedAt,
    })
  }

  assert.deepEqual(outboundMethods, ['initialize', 'shutdown', 'initialize', 'shutdown'])
  assert.deepEqual(serverRequests, [])
  assert.equal(client.pending.size, 0)
  assert.equal(client.serverRequests.size, 0)

  console.log(JSON.stringify({
    ok: true,
    result: {
      runtime: 'DSH SDK stdio',
      cycles,
      outboundMethods,
      serverRequests,
      pendingAfterStop: client.pending.size,
      promptsSent: outboundMethods.filter((method) => method === 'session/query' || method === 'session/prompt').length,
    },
  }, null, 2))
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.stack ?? String(error) }, null, 2))
  process.exitCode = 1
} finally {
  if (client.child) {
    try {
      await client.stop()
    } catch {
      // The original failure remains the probe result; RuntimeClient already
      // fails closed and terminates a child that refuses to exit.
    }
  }
}
