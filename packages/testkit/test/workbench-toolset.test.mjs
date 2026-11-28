import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ControlErrorCode,
  acquireToolLease,
  closeSessionToolInstance,
  createToolCapabilitySnapshot,
  createWorkbenchRegistry,
  effectiveSessionToolset,
  putConversationWorkspace,
  registerSessionToolInstance,
  releaseToolLease,
  selectSessionToolset,
  setSessionToolset,
} from '../../workbench-core/src/index.js'

const OWNER = Object.freeze({ kind: 'session', id: 'session-a', hostId: 'host', windowId: 'window' })

function capabilities(patch = {}) {
  return createToolCapabilitySnapshot({
    source: 'host',
    revision: 'cap-1',
    observedAt: '2026-11-28T00:00:00.000Z',
    tools: {
      files: { grade: 'available', evidence: 'workspace.file.*' },
      terminal: { grade: 'available', evidence: 'terminal-service' },
      mcp: { grade: 'configured', reason: 'profile only' },
      browser: { grade: 'unavailable', reason: 'safety gate closed' },
      ...patch,
    },
  })
}

function registry() {
  return putConversationWorkspace(createWorkbenchRegistry(), {
    owner: OWNER,
    document: { draftId: 'draft:session-a', contentBlocks: [], revision: 0, queueLocal: [] },
  })
}

function withToolset(toolset = ['files', 'terminal']) {
  return setSessionToolset(registry(), {
    owner: OWNER,
    toolset,
    capabilities: capabilities(),
    expectedRevision: 1,
    updatedAt: '2026-11-28T00:00:01.000Z',
  })
}

test('tool capability snapshots are Host-owned and fail closed on incomplete claims', () => {
  assert.throws(() => createToolCapabilitySnapshot({
    source: 'renderer',
    revision: 'r',
    observedAt: 'now',
    tools: {},
  }), (error) => error.code === ControlErrorCode.INVALID_ARGUMENT)
  assert.throws(() => capabilities({ files: { grade: 'available' } }), /证据/)
  assert.throws(() => capabilities({ browser: { grade: 'unavailable' } }), /原因/)
  assert.throws(() => capabilities({ 'made-up': { grade: 'available', evidence: 'x' } }), /未知 toolId/)
})

test('toolset selection rejects unavailable, unknown, and duplicate tools instead of filtering', () => {
  const snapshot = capabilities()
  assert.deepEqual(selectSessionToolset(snapshot, ['files', 'terminal']), ['files', 'terminal'])
  assert.throws(() => selectSessionToolset(snapshot, ['browser']), (error) => (
    error.code === ControlErrorCode.CAPABILITY_UNAVAILABLE && error.details.toolId === 'browser'
  ))
  assert.throws(() => selectSessionToolset(snapshot, ['mcp']), (error) => (
    error.code === ControlErrorCode.CAPABILITY_UNAVAILABLE
  ))
  assert.throws(() => selectSessionToolset(snapshot, ['files', 'files']), /重复/)
  assert.throws(() => selectSessionToolset(snapshot, ['nope']), /未知 toolId/)
})

test('toolset writes require the Host snapshot and a matching registry revision', () => {
  const state = registry()
  assert.throws(() => setSessionToolset(state, {
    owner: OWNER,
    toolset: ['browser'],
    capabilities: capabilities(),
    expectedRevision: 1,
    updatedAt: 'now',
  }), (error) => error.code === ControlErrorCode.CAPABILITY_UNAVAILABLE)
  assert.throws(() => setSessionToolset(state, {
    owner: OWNER,
    toolset: ['files'],
    capabilities: capabilities(),
    expectedRevision: 0,
    updatedAt: 'now',
  }), (error) => error.code === ControlErrorCode.CONFLICT)

  const next = withToolset(['files'])
  assert.deepEqual(next.workspaces['session:session-a'].toolset, ['files'])
  assert.equal(next.workspaces['session:session-a'].runtimeCapabilities.source, 'host')
  assert.equal(next.revision, 2)
  assert.equal(state.revision, 1, 'the previous registry is not mutated')
})

test('effective toolset exposes stale choices when Host capabilities change', () => {
  const saved = withToolset(['files', 'terminal'])
  const narrowed = capabilities({ terminal: { grade: 'unavailable', reason: 'adapter exited' } })
  const effective = effectiveSessionToolset(narrowed, saved.workspaces['session:session-a'].toolset)
  assert.deepEqual(effective.toolset, ['files'])
  assert.deepEqual(effective.stale, [{ toolId: 'terminal', reason: 'adapter exited' }])
})

test('toolsets cannot silently orphan an open per-session instance', () => {
  let state = withToolset(['files'])
  state = registerSessionToolInstance(state, {
    owner: OWNER,
    expectedRevision: state.revision,
    instanceId: 'instance-files',
    toolId: 'files',
  })
  assert.throws(() => setSessionToolset(state, {
    owner: OWNER,
    toolset: [],
    capabilities: capabilities(),
    expectedRevision: state.revision,
    updatedAt: 'now',
  }), (error) => error.code === ControlErrorCode.CONFLICT && /关闭/.test(error.message))

  state = closeSessionToolInstance(state, {
    owner: OWNER,
    expectedRevision: state.revision,
    instanceId: 'instance-files',
  })
  assert.equal(state.toolInstances['instance-files'].state, 'closed')
  const emptied = setSessionToolset(state, {
    owner: OWNER,
    toolset: [],
    capabilities: capabilities(),
    expectedRevision: state.revision,
    updatedAt: 'now',
  })
  assert.deepEqual(emptied.workspaces['session:session-a'].toolset, [])
})

test('instance registration is scoped to the selected toolset and its owner', () => {
  const state = withToolset(['terminal'])
  assert.throws(() => registerSessionToolInstance(state, {
    owner: OWNER,
    expectedRevision: state.revision,
    instanceId: 'instance-files',
    toolId: 'files',
  }), (error) => error.code === ControlErrorCode.CAPABILITY_UNAVAILABLE)

  const opened = registerSessionToolInstance(state, {
    owner: OWNER,
    expectedRevision: state.revision,
    instanceId: 'instance-terminal',
    toolId: 'terminal',
  })
  const instance = opened.toolInstances['instance-terminal']
  assert.equal(instance.state, 'opening')
  assert.equal(instance.concurrency, 'exclusive')
  assert.equal(instance.owner.id, OWNER.id)

  assert.throws(() => closeSessionToolInstance(opened, {
    owner: { ...OWNER, id: 'session-b' },
    expectedRevision: opened.revision,
    instanceId: 'instance-terminal',
  }), (error) => error.code === ControlErrorCode.CONFLICT)
})

test('closing an instance waits for its exclusive lease to be released', () => {
  let state = withToolset(['terminal'])
  state = registerSessionToolInstance(state, {
    owner: OWNER,
    expectedRevision: state.revision,
    instanceId: 'instance-terminal',
    toolId: 'terminal',
  })
  state = acquireToolLease(state, {
    leaseId: 'lease-terminal',
    instanceId: 'instance-terminal',
    owner: OWNER,
    hostId: OWNER.hostId,
    windowId: OWNER.windowId,
    acquiredAt: '2026-11-28T00:00:02.000Z',
  })
  assert.throws(() => closeSessionToolInstance(state, {
    owner: OWNER,
    expectedRevision: state.revision,
    instanceId: 'instance-terminal',
  }), (error) => error.code === ControlErrorCode.CONFLICT && /lease/.test(error.message))

  state = releaseToolLease(state, 'lease-terminal', '2026-11-28T00:00:03.000Z')
  const closed = closeSessionToolInstance(state, {
    owner: OWNER,
    expectedRevision: state.revision,
    instanceId: 'instance-terminal',
  })
  assert.equal(closed.toolInstances['instance-terminal'].state, 'closed')
})