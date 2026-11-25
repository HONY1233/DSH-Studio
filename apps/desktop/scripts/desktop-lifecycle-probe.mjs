import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { resolveWslCwd } from './wsl-path.mjs'

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)
const electronPath = require('electron')
const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../..')
const fixturePath = resolve(here, 'desktop-lifecycle-renderer.html')
const wait = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))

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

async function waitUntil(predicate, timeoutMs = 15_000) {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started >= timeoutMs) return false
    await wait(50)
  }
  return true
}

function withTimeout(promise, timeoutMs, message) {
  let timer
  const timeout = new Promise((_resolvePromise, rejectPromise) => {
    timer = setTimeout(() => rejectPromise(new Error(message)), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

async function listProcesses() {
  const command = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress -Depth 3'
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  })
  const value = JSON.parse(stdout)
  return (Array.isArray(value) ? value : [value]).map((entry) => ({
    pid: Number(entry.ProcessId),
    parentPid: Number(entry.ParentProcessId),
    name: String(entry.Name ?? ''),
    commandLine: String(entry.CommandLine ?? ''),
  }))
}

function descendantsOf(rootPid, processes) {
  const byParent = new Map()
  for (const entry of processes) {
    const list = byParent.get(entry.parentPid) ?? []
    list.push(entry)
    byParent.set(entry.parentPid, list)
  }
  const result = []
  const queue = [rootPid]
  const seen = new Set(queue)
  for (let index = 0; index < queue.length; index += 1) {
    for (const entry of byParent.get(queue[index]) ?? []) {
      if (seen.has(entry.pid)) continue
      seen.add(entry.pid)
      result.push(entry)
      queue.push(entry.pid)
    }
  }
  return result
}

function isRuntimeOrPtyProcess(entry) {
  return entry.name.toLowerCase() === 'wsl.exe'
    || entry.commandLine.includes('conpty_console_list_agent.js')
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 64 * 1024) throw new Error('probe request too large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function main() {
  const { stdout: electronVersion } = await execFileAsync(electronPath, ['--version'], { windowsHide: true })
  const fixture = await readFile(fixturePath, 'utf8')
  let readyPayload
  let failedPayload
  let resolveReady
  let rejectReady
  const ready = new Promise((resolvePromise, rejectPromise) => {
    resolveReady = resolvePromise
    rejectReady = rejectPromise
  })
  let closing = false
  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/probe.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
        res.end(fixture)
        return
      }
      if (req.method === 'GET' && req.url === '/close') {
        res.writeHead(closing ? 200 : 409, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' })
        res.end(closing ? 'close' : '')
        return
      }
      if (req.method === 'POST' && req.url === '/ready') {
        readyPayload = await readBody(req)
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('ok')
        resolveReady(readyPayload)
        return
      }
      if (req.method === 'POST' && req.url === '/failed') {
        failedPayload = await readBody(req)
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('ok')
        rejectReady(new Error(failedPayload.error))
        return
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('not found')
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'text/plain' })
      res.end(String(error))
      rejectReady(error)
    }
  })
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const address = server.address()
  const rendererUrl = `http://127.0.0.1:${address.port}/probe.html`

  let child
  let exit
  let outputTail = ''
  let resourceProcesses = []
  try {
    child = spawn(electronPath, [resolve(repo, 'apps/desktop/src/main.js')], {
      cwd: repo,
      env: {
        ...process.env,
        DSH_RENDERER_URL: rendererUrl,
        DSH_CWD: await resolveWslCwd(process.env.DSH_CWD ?? repo, { distro: process.env.DSH_WSL_DISTRO ?? 'ubuntu' }),
        DSH_SHOW_MENU: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    const capture = (chunk) => { outputTail = `${outputTail}${chunk}`.slice(-12_000) }
    child.stdout.on('data', capture)
    child.stderr.on('data', capture)
    exit = new Promise((resolvePromise, rejectPromise) => {
      child.once('error', rejectPromise)
      child.once('exit', (code, signal) => resolvePromise({ code, signal }))
    })

    const timeout = setTimeout(() => rejectReady(new Error(`desktop ready timeout; output:\n${outputTail}`)), 45_000)
    const payload = await Promise.race([ready, exit.then((result) => {
      throw new Error(`desktop exited before ready: ${JSON.stringify(result)}\n${outputTail}`)
    })])
    clearTimeout(timeout)
    assert.equal(processAlive(child.pid), true, `desktop exited before process snapshot:\n${outputTail}`)
    assert.equal(payload.fixture, 'not-a-production-build')
    assert.equal(payload.runtime.name, 'deepseek-harness-sdk-runtime')
    assert.deepEqual(payload.markers, ['DSH_DESKTOP_NATIVE_READY', 'DSH_DESKTOP_OMP_READY'])
    assert.equal(processAlive(payload.native.pid), true)

    const processes = await listProcesses()
    const descendants = descendantsOf(child.pid, processes)
    resourceProcesses = descendants.filter(isRuntimeOrPtyProcess)
    assert.ok(resourceProcesses.length >= 3, `expected Runtime plus two PTY wsl.exe children, got ${resourceProcesses.length}; root=${child.pid}; rootAlive=${processAlive(child.pid)}; processes=${processes.length}; named=${JSON.stringify(processes.filter((entry) => /electron|wsl|conpty/i.test(entry.name)).map(({ pid, parentPid, name }) => ({ pid, parentPid, name })))}; descendants=${JSON.stringify(descendants.map(({ pid, parentPid, name }) => ({ pid, parentPid, name })))}`)
    assert.ok(resourceProcesses.every((entry) => processAlive(entry.pid)), 'a Runtime/PTY process was not alive before window close')
    assert.equal(failedPayload, undefined)

    closing = true
    const exitResult = await withTimeout(exit, 45_000, `desktop did not exit after window close; output:\n${outputTail}`)
    assert.equal(exitResult.code, 0)
    assert.equal(await waitUntil(() => resourceProcesses.every((entry) => !processAlive(entry.pid)), 15_000), true)

    const remaining = resourceProcesses.filter((entry) => processAlive(entry.pid))
    assert.deepEqual(remaining, [])
    console.log(JSON.stringify({
      ok: true,
      result: {
        electron: electronVersion.trim(),
        renderer: 'loopback test fixture, not a production build',
        runtimeReady: payload.runtime.name,
        terminalMarkers: payload.markers,
        nativePidExited: !processAlive(payload.native.pid),
        runtimeAndPtyProcessesBeforeClose: resourceProcesses.length,
        runtimeAndPtyProcessesAliveAfterExit: remaining.length,
        electronExitCode: exitResult.code,
        promptsSent: 0,
      },
    }, null, 2))
  } finally {
    closing = true
    if (child && child.exitCode === null && child.signalCode === null) child.kill()
    // Only clean up exact OS PIDs observed as this probe's descendants.
    for (const entry of resourceProcesses) {
      if (!processAlive(entry.pid)) continue
      try { process.kill(entry.pid) } catch { /* best-effort cleanup of this probe only */ }
    }
    await new Promise((resolvePromise) => server.close(resolvePromise))
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.stack ?? String(error) }, null, 2))
  process.exitCode = 1
})
