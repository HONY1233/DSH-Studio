/**
 * P0 spike: prove the Windows -> WSL stdio JSON-RPC link.
 *
 *   node packages/runtime-client/examples/handshake.mjs            # handshake only
 *   node packages/runtime-client/examples/handshake.mjs --prompt "只回复 pong"
 *
 * Every frame is recorded under packages/testkit/fixtures so the contract replay
 * tests can run without a live runtime or a model key.
 */
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RuntimeClient } from '../src/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../..')

const args = process.argv.slice(2)
const promptIndex = args.indexOf('--prompt')
const prompt = promptIndex >= 0 ? args[promptIndex + 1] : null
const resumeIndex = args.indexOf('--resume')
const resumeId = resumeIndex >= 0 ? args[resumeIndex + 1] : null
const sessionId = resumeId ?? `spike-${Date.now().toString(36)}`
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const fixturePath = resolve(repo, `packages/testkit/fixtures/handshake-${stamp}.jsonl`)
mkdirSync(dirname(fixturePath), { recursive: true })

const client = new RuntimeClient({
  recordPath: fixturePath,
  cwd: process.env.DSH_CWD ?? '/home/qtt199/projects/dsh',
  provider: process.env.DSH_PROVIDER ?? 'deepseek-official',
  model: process.env.DSH_MODEL ?? 'deepseek-flash',
})

client.on('state', ({ state, detail }) => console.log(`[state] ${state}${detail ? ` — ${detail}` : ''}`))
client.on('stderr', (line) => console.log(`[stderr] ${line}`))
client.on('request', ({ method, params, respond }) => {
  console.log(`[server-request] ${method} ${JSON.stringify(params)}`)
  respond(method === 'approval/request' ? { outcome: 'rejected' } : { cancelled: true })
})
client.on('notification', ({ method, params }) => {
  if (method !== 'session.event') {
    console.log(`[notify] ${method} ${JSON.stringify(params).slice(0, 200)}`)
    return
  }
  const { type, data } = params.event ?? {}
  const detail =
    type === 'assistant/message'
      ? JSON.stringify(data?.message?.content ?? []).slice(0, 300)
      : type === 'user/message'
        ? JSON.stringify(data?.content ?? []).slice(0, 200)
        : type === 'turn/end'
          ? `reason=${JSON.stringify(data?.reason)}`
          : type === 'assistant/attempt'
            ? `streams=${JSON.stringify(data?.stream ?? []).slice(0, 400)}`
            : type === 'tool/call'
            ? `${data?.name} ${String(data?.arguments ?? '').slice(0, 160)}`
            : ''
  console.log(`[event ${params.sessionId}] ${type} ${detail}`)
})

await client.start()
console.log(`[spawned] recording to ${fixturePath}`)

const info = await client.initialize()
console.log(`[initialize] ${info.name} ${info.version}`)

if (resumeId) {
  try {
    const result = await client.request('session/resume', { sessionId: resumeId })
    console.log(`[resume] ${JSON.stringify(result)}`)
  } catch (error) {
    console.log(`[resume] error code=${error.code} ${error.message} data=${JSON.stringify(error.data ?? null)}`)
  }
}

if (prompt) {
  try {
    const receipt = await client.query(sessionId, prompt)
    console.log(`[query] ${JSON.stringify(receipt)}`)
    if (receipt?.kind === 'command') {
      console.log('[query] native command settled')
    } else {
      await waitForTurnEnd(sessionId, 120_000)
      console.log('[query] turn finished')
    }
  } catch (error) {
    console.log(`[query] error code=${error.code} ${error.message}`)
    if (error.data) console.log(`[query] data=${JSON.stringify(error.data).slice(0, 800)}`)
  }
}

await client.stop()
console.log('[done]')

function waitForTurnEnd(id, timeoutMs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error('turn timeout')), timeoutMs)
    const onNotification = ({ method, params }) => {
      if (method !== 'session.event' || params.sessionId !== id) return
      if (params.event?.type !== 'turn/end') return
      clearTimeout(timer)
      client.off('notification', onNotification)
      resolvePromise()
    }
    client.on('notification', onNotification)
  })
}
