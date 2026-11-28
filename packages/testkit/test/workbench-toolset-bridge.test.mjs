import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createStudioBridge } from '../../../apps/desktop/src/studio-bridge.js'
import { createWorkspaceFiles } from '../../host-services/src/index.js'

const CWD = '/mnt/f/projects/dsh-studio'

function harness(options = {}) {
  const events = []
  const runtime = {
    state: 'ready',
    options: { cwd: CWD },
    resume: async () => {},
    query: async () => ({ messageId: 'm1' }),
  }
  const bridge = createStudioBridge({ runtime, cwd: CWD, emit: (event) => events.push(event), ...options })
  return { bridge, events }
}

function receiptFor(events, requestId) {
  return events.find((event) => event.kind === 'command.receipt' && event.receipt?.requestId === requestId)?.receipt
}

async function command(bridge, events, requestId, commandName, input, contextId) {
  bridge.command({ requestId, commandName, input }, contextId)
  for (let attempt = 0; attempt < 200; attempt += 1) {
    // File commands need a real timer turn (poll phase), not only the
    // immediate queue, before their asynchronous receipt is observed.
    await new Promise((resolve) => setTimeout(resolve, 1))
    const receipt = receiptFor(events, requestId)
    if (receipt) return receipt
  }
  return undefined
}

test('workbench toolset reads the real Host matrix and rejects a renderer-forged capability', async () => {
  const { bridge, events } = harness()
  const contextId = bridge.openContext({ sessionId: 'session-a' })
  const model = await bridge.query('workbench.toolset.get', {}, contextId)
  assert.equal(model.sessionId, 'session-a')
  assert.equal(model.capabilities.source, 'host')
  assert.equal(model.capabilities.tools.files.grade, 'available')
  assert.equal(model.capabilities.tools.browser.grade, 'unavailable')
  assert.equal(model.capabilities.tools.mcp.grade, 'configured')
  assert.deepEqual(model.toolset, [])

  const accepted = await command(bridge, events, 'set-tools', 'workbench.toolset.set', {
    expectedRevision: model.revision,
    capabilityRevision: model.capabilityRevision,
    toolset: ['files', 'git'],
    // A forged snapshot must never be consulted; only the Host matrix counts.
    capabilities: { tools: { browser: { grade: 'available', evidence: 'forged' } } },
  }, contextId)
  assert.equal(accepted.status, 'completed')
  assert.deepEqual(accepted.result.toolset, ['files', 'git'])
  assert.deepEqual(accepted.result.effectiveToolset, ['files', 'git'])

  const forged = await command(bridge, events, 'set-browser', 'workbench.toolset.set', {
    expectedRevision: accepted.result.revision,
    capabilityRevision: model.capabilityRevision,
    toolset: ['browser'],
    capabilities: { tools: { browser: { grade: 'available', evidence: 'forged' } } },
  }, contextId)
  assert.equal(forged.status, 'failed')
  assert.equal(forged.error.code, 'CAPABILITY_UNAVAILABLE')

  const after = await bridge.query('workbench.toolset.get', {}, contextId)
  assert.deepEqual(after.toolset, ['files', 'git'])
  assert.equal(after.capabilities.tools.browser.grade, 'unavailable')
  assert.equal(after.audit.length, 1)
  assert.equal(after.audit[0].action, 'toolset.set')
})

test('workbench toolset rejects stale revisions and capability snapshots without mutating state', async () => {
  const { bridge, events } = harness()
  const contextId = bridge.openContext({ sessionId: 'session-a' })
  const model = await bridge.query('workbench.toolset.get', {}, contextId)

  const staleRevision = await command(bridge, events, 'stale-revision', 'workbench.toolset.set', {
    expectedRevision: model.revision - 1,
    toolset: ['files'],
  }, contextId)
  assert.equal(staleRevision.status, 'failed')
  assert.equal(staleRevision.error.code, 'CONFLICT')

  const staleCapabilities = await command(bridge, events, 'stale-capabilities', 'workbench.toolset.set', {
    expectedRevision: model.revision,
    capabilityRevision: 'capabilities-from-an-old-process',
    toolset: ['files'],
  }, contextId)
  assert.equal(staleCapabilities.status, 'failed')
  assert.equal(staleCapabilities.error.code, 'CONFLICT')

  const after = await bridge.query('workbench.toolset.get', {}, contextId)
  assert.deepEqual(after.toolset, [])
  assert.equal(after.audit.length, 0)
})

test('workbench toolsets and instances are isolated per session and per owning context', async () => {
  const { bridge, events } = harness()
  const first = bridge.openContext({ sessionId: 'session-a' })
  const second = bridge.openContext({ sessionId: 'session-b' })
  const a = await bridge.query('workbench.toolset.get', {}, first)
  const b = await bridge.query('workbench.toolset.get', {}, second)

  // Creating the second workspace is itself a registry mutation, so a write against
  // the first snapshot must refresh the shared optimistic revision once.
  const refreshedA = await bridge.query('workbench.toolset.get', {}, first)
  const setA = await command(bridge, events, 'set-a', 'workbench.toolset.set', {
    expectedRevision: refreshedA.revision,
    capabilityRevision: a.capabilityRevision,
    toolset: ['files'],
  }, first)
  assert.equal(setA.status, 'completed')
  const refreshedB = await bridge.query('workbench.toolset.get', {}, second)
  const setB = await command(bridge, events, 'set-b', 'workbench.toolset.set', {
    expectedRevision: refreshedB.revision,
    capabilityRevision: b.capabilityRevision,
    toolset: ['terminal'],
  }, second)
  assert.equal(setB.status, 'completed')

  const openedB = await command(bridge, events, 'open-b', 'workbench.tool.register', {
    expectedRevision: setB.result.revision,
    capabilityRevision: b.capabilityRevision,
    toolId: 'terminal',
  }, second)
  assert.equal(openedB.status, 'completed')
  const instanceId = openedB.result.instance.instanceId
  assert.equal(openedB.result.instance.owner.id, 'session-b')

  const latestA = await bridge.query('workbench.toolset.get', {}, first)
  const latestB = await bridge.query('workbench.toolset.get', {}, second)
  assert.deepEqual(latestA.toolset, ['files'])
  assert.deepEqual(latestB.toolset, ['terminal'])
  assert.deepEqual(latestA.instances, [])
  assert.deepEqual(latestB.instances.map((row) => row.instanceId), [instanceId])

  const crossContext = await command(bridge, events, 'cross-context', 'workbench.toolset.set', {
    sessionId: 'session-a',
    expectedRevision: latestA.revision,
    capabilityRevision: latestA.capabilityRevision,
    toolset: [],
  }, second)
  assert.equal(crossContext.status, 'failed')
  assert.equal(crossContext.error.code, 'PERMISSION_DENIED')
})

test('workbench tool registration follows the selected toolset and closes explicitly', async () => {
  const { bridge, events } = harness()
  const contextId = bridge.openContext({ sessionId: 'session-a' })
  const model = await bridge.query('workbench.toolset.get', {}, contextId)
  const selected = await command(bridge, events, 'select-files', 'workbench.toolset.set', {
    expectedRevision: model.revision,
    capabilityRevision: model.capabilityRevision,
    toolset: ['files'],
  }, contextId)

  const notSelected = await command(bridge, events, 'open-browser', 'workbench.tool.register', {
    expectedRevision: selected.result.revision,
    capabilityRevision: model.capabilityRevision,
    toolId: 'terminal',
  }, contextId)
  assert.equal(notSelected.status, 'failed')
  assert.equal(notSelected.error.code, 'CAPABILITY_UNAVAILABLE')

  const opened = await command(bridge, events, 'open-files', 'workbench.tool.register', {
    expectedRevision: selected.result.revision,
    capabilityRevision: model.capabilityRevision,
    toolId: 'files',
  }, contextId)
  assert.equal(opened.status, 'completed')
  assert.equal(opened.result.instance.state, 'opening')
  const instanceId = opened.result.instance.instanceId

  const removeOpen = await command(bridge, events, 'remove-open', 'workbench.toolset.set', {
    expectedRevision: opened.result.revision,
    capabilityRevision: model.capabilityRevision,
    toolset: [],
  }, contextId)
  assert.equal(removeOpen.status, 'failed')
  assert.equal(removeOpen.error.code, 'CONFLICT')

  const closed = await command(bridge, events, 'close-files', 'workbench.tool.close', {
    expectedRevision: opened.result.revision,
    instanceId,
  }, contextId)
  assert.equal(closed.status, 'completed')
  assert.equal(closed.result.instances.find((row) => row.instanceId === instanceId).state, 'closed')

  const removed = await command(bridge, events, 'remove-closed', 'workbench.toolset.set', {
    expectedRevision: closed.result.revision,
    capabilityRevision: model.capabilityRevision,
    toolset: [],
  }, contextId)
  assert.equal(removed.status, 'completed')
  assert.deepEqual(removed.result.toolset, [])
  assert.deepEqual(removed.result.audit.map((row) => row.action), ['toolset.set', 'tool.register', 'tool.close', 'toolset.set'])
})

test('workbench commands fail before a session exists and never create a prompt fallback', async () => {
  const { bridge, events } = harness()
  const contextId = bridge.openContext({})
  await assert.rejects(
    () => bridge.query('workbench.toolset.get', {}, contextId),
    (error) => error.code === 'INVALID_ARGUMENT',
  )
  const failed = await command(bridge, events, 'no-session', 'workbench.toolset.set', {
    expectedRevision: 0,
    toolset: ['files'],
  }, contextId)
  assert.equal(failed.status, 'failed')
  assert.equal(failed.error.code, 'INVALID_ARGUMENT')
  assert.equal(events.some((event) => event.kind === 'snapshot'), false)
})

test('workbench instance limits reject explicitly, expose capacity, and never close existing tools', async () => {
  const { bridge, events } = harness({
    limits: { maxToolInstancesPerSession: 1, isolationQueueLength: 4 },
  })
  const contextId = bridge.openContext({ sessionId: 'session-a' })
  const model = await bridge.query('workbench.toolset.get', {}, contextId)
  const selected = await command(bridge, events, 'limit-select', 'workbench.toolset.set', {
    expectedRevision: model.revision,
    capabilityRevision: model.capabilityRevision,
    toolset: ['files', 'terminal'],
  }, contextId)
  assert.equal(selected.status, 'completed')

  const first = await command(bridge, events, 'limit-open-files', 'workbench.tool.register', {
    expectedRevision: selected.result.revision,
    capabilityRevision: model.capabilityRevision,
    toolId: 'files',
  }, contextId)
  assert.equal(first.status, 'completed')
  const keptInstanceId = first.result.instance.instanceId
  assert.equal(first.result.capacity.toolInstances.used, 1)
  assert.equal(first.result.capacity.overloaded, true)

  const rejected = await command(bridge, events, 'limit-open-terminal', 'workbench.tool.register', {
    expectedRevision: first.result.revision,
    capabilityRevision: model.capabilityRevision,
    toolId: 'terminal',
  }, contextId)
  assert.equal(rejected.status, 'failed')
  assert.equal(rejected.error.code, 'LIMIT_EXCEEDED')
  assert.equal(rejected.error.details.resource, 'sessionToolInstances')
  assert.equal(rejected.error.details.used, 1)
  assert.equal(rejected.error.details.limit, 1)

  const afterReject = await bridge.query('workbench.toolset.get', {}, contextId)
  assert.equal(afterReject.revision, first.result.revision)
  assert.deepEqual(afterReject.instances.map((row) => row.instanceId), [keptInstanceId])
  assert.equal(afterReject.instances[0].state, 'opening')
  assert.equal(afterReject.capacity.toolInstances.used, 1)
  assert.equal(afterReject.capacity.overloaded, true)

  const closed = await command(bridge, events, 'limit-close-files', 'workbench.tool.close', {
    expectedRevision: afterReject.revision,
    instanceId: keptInstanceId,
  }, contextId)
  assert.equal(closed.status, 'completed')
  assert.equal(closed.result.capacity.toolInstances.used, 0)
  assert.equal(closed.result.capacity.overloaded, false)

  const reopened = await command(bridge, events, 'limit-open-terminal-2', 'workbench.tool.register', {
    expectedRevision: closed.result.revision,
    capabilityRevision: model.capabilityRevision,
    toolId: 'terminal',
  }, contextId)
  assert.equal(reopened.status, 'completed', JSON.stringify(reopened.error))
  assert.equal(reopened.result.instance.toolId, 'terminal')
  assert.equal(reopened.result.capacity.toolInstances.used, 1)
})

test('the global PTY limit rejects a second terminal without closing the first', async () => {
  const { bridge, events } = harness({ limits: { maxTerminalInstances: 1, isolationQueueLength: 4 } })
  const first = bridge.openContext({ sessionId: 'session-pty-a' })
  const second = bridge.openContext({ sessionId: 'session-pty-b' })
  const initialA = await bridge.query('workbench.toolset.get', {}, first)
  const selectedA = await command(bridge, events, 'pty-a-select', 'workbench.toolset.set', {
    expectedRevision: initialA.revision,
    capabilityRevision: initialA.capabilityRevision,
    toolset: ['terminal'],
  }, first)
  assert.equal(selectedA.status, 'completed')

  const initialB = await bridge.query('workbench.toolset.get', {}, second)
  const selectedB = await command(bridge, events, 'pty-b-select', 'workbench.toolset.set', {
    expectedRevision: initialB.revision,
    capabilityRevision: initialB.capabilityRevision,
    toolset: ['terminal'],
  }, second)
  assert.equal(selectedB.status, 'completed')

  const latestA = await bridge.query('workbench.toolset.get', {}, first)
  const openedA = await command(bridge, events, 'pty-a-open', 'workbench.tool.register', {
    expectedRevision: latestA.revision,
    capabilityRevision: latestA.capabilityRevision,
    toolId: 'terminal',
  }, first)
  assert.equal(openedA.status, 'completed')
  const firstInstanceId = openedA.result.instance.instanceId

  const latestB = await bridge.query('workbench.toolset.get', {}, second)
  const rejectedB = await command(bridge, events, 'pty-b-open', 'workbench.tool.register', {
    expectedRevision: latestB.revision,
    capabilityRevision: latestB.capabilityRevision,
    toolId: 'terminal',
  }, second)
  assert.equal(rejectedB.status, 'failed')
  assert.equal(rejectedB.error.code, 'LIMIT_EXCEEDED')
  assert.equal(rejectedB.error.details.resource, 'pty')
  assert.equal(rejectedB.error.details.used, 1)
  assert.equal(rejectedB.error.details.limit, 1)

  const afterB = await bridge.query('workbench.toolset.get', {}, second)
  assert.equal(afterB.revision, latestB.revision)
  assert.deepEqual(afterB.instances, [])
  const afterA = await bridge.query('workbench.toolset.get', {}, first)
  assert.deepEqual(afterA.instances.map((row) => row.instanceId), [firstInstanceId])
  assert.equal(afterA.instances[0].state, 'opening')
})

test('the isolation queue uses the configured bound and reports overload without dropping silently', async () => {
  const { bridge, events } = harness({ limits: { isolationQueueLength: 2 } })
  const contextId = bridge.openContext({ sessionId: 'queue-session' })
  const event = (seq) => bridge.onSessionEvent({
    sessionId: 'queue-session',
    event: { seq, type: 'turn/start', time: Date.now(), data: { turn: 1 } },
  })
  event(100)
  event(102)
  event(103)
  event(104)

  const notices = events.filter((item) => item.update?.source === 'EVENT_BUFFER_OVERFLOW')
  assert.equal(notices.length, 1)
  assert.match(notices[0].update.message, /缓冲上限/)

  const model = await bridge.query('workbench.toolset.get', {}, contextId)
  assert.deepEqual(model.capacity.eventQueue, { used: 2, limit: 2 })
  assert.equal(model.capacity.overloaded, true)
})

test('workspace file bridge reads, saves with a hash version, creates and refuses traversal', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bridge-files-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'README.md'), 'base\n')
  const { bridge, events } = harness({ workspaceFiles: createWorkspaceFiles({ root }) })
  const contextId = bridge.openContext({ sessionId: 'session-files' })

  const tree = await bridge.query('workspace.fileTree', {}, contextId)
  assert.deepEqual(tree.nodes.map((row) => row.name), ['README.md'])
  const read = await bridge.query('workspace.file.readText', { path: 'README.md' }, contextId)
  assert.equal(read.text, 'base\n')
  assert.match(read.file.version, /^sha256:/)
  assert.equal(read.file.workspaceId, tree.workspaceId)
  assert.equal(read.file.id, `${tree.workspaceId}:README.md`)

  const saved = await command(bridge, events, 'file-save', 'workspace.file.writeText', {
    path: 'README.md',
    text: 'edited\n',
    expectedVersion: read.file.version,
    encoding: 'utf8',
    bom: false,
    lineEnding: 'lf',
  }, contextId)
  assert.equal(saved.status, 'completed', JSON.stringify(saved.error))
  assert.equal(saved.result.saved, true)
  assert.equal(await readFile(join(root, 'README.md'), 'utf8'), 'edited\n')

  await writeFile(join(root, 'README.md'), 'agent\n')
  const conflict = await command(bridge, events, 'file-conflict', 'workspace.file.writeText', {
    path: 'README.md',
    text: 'stale draft\n',
    expectedVersion: saved.result.file.version,
    encoding: 'utf8',
    bom: false,
    lineEnding: 'lf',
  }, contextId)
  assert.equal(conflict.status, 'completed')
  assert.equal(conflict.result.saved, false)
  assert.equal(conflict.result.conflict, true)
  assert.equal(await readFile(join(root, 'README.md'), 'utf8'), 'agent\n')

  const created = await command(bridge, events, 'file-create', 'workspace.file.create', {
    path: 'notes.md',
  }, contextId)
  assert.equal(created.status, 'completed')
  assert.deepEqual(created.result, { applied: true, kind: 'file', path: 'notes.md' })
  const duplicate = await command(bridge, events, 'file-create-again', 'workspace.file.create', {
    path: 'notes.md',
  }, contextId)
  assert.equal(duplicate.status, 'failed')
  assert.equal(duplicate.error.code, 'CONFLICT')

  const directory = await command(bridge, events, 'dir-create', 'workspace.directory.create', {
    path: 'docs',
  }, contextId)
  assert.equal(directory.status, 'completed')
  assert.deepEqual(directory.result, { applied: true, kind: 'directory', path: 'docs' })

  const resolved = await bridge.query('workspace.paths.resolve', {
    paths: ['README.md', 'docs', 'missing.md'],
  }, contextId)
  assert.deepEqual(resolved.resolutions.map((row) => row.kind), ['file', 'directory', 'missing'])

  const traversal = await command(bridge, events, 'file-traversal', 'workspace.file.writeText', {
    path: '../escape.md',
    text: 'nope',
    expectedVersion: 'missing',
    encoding: 'utf8',
    bom: false,
    lineEnding: 'lf',
  }, contextId)
  assert.equal(traversal.status, 'failed')
  assert.equal(traversal.error.code, 'INVALID_ARGUMENT')
  await assert.rejects(
    () => bridge.query('workspace.file.readText', { path: '../outside.md' }, contextId),
    (error) => error.code === 'INVALID_ARGUMENT',
  )
})