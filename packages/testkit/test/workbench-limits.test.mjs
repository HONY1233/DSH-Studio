import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ControlErrorCode,
  DEFAULT_WORKBENCH_LIMITS,
  assertTabCapacity,
  assertTabCountCapacity,
  assertToolInstanceCapacity,
  createWorkbenchLimits,
  inspectTabCapacity,
  inspectToolInstanceCapacity,
} from '../../workbench-core/src/index.js'

const OWNER = Object.freeze({ kind: 'session', id: 'session-a', hostId: 'host', windowId: 'window' })

function layoutWithTabs(count) {
  return {
    version: 2,
    root: {
      kind: 'pane',
      id: 'pane-1',
      tabs: Array.from({ length: count }, (_, index) => ({
        id: `tab-${index}`,
        ref: { kind: 'conversation', contentId: `session-${index}`, instanceId: `session:${index}` },
      })),
    },
    floats: [],
    minimized: [],
  }
}

function instance(instanceId, toolId, owner = OWNER) {
  return {
    instanceId,
    toolId,
    owner,
    concurrency: 'exclusive',
    state: 'opening',
  }
}

test('workbench limits are explicit, validated, and frozen', () => {
  assert.deepEqual(createWorkbenchLimits(), DEFAULT_WORKBENCH_LIMITS)
  const custom = createWorkbenchLimits({ maxTabsPerWorkspace: 3, isolationQueueLength: 2 })
  assert.equal(custom.maxTabsPerWorkspace, 3)
  assert.equal(custom.isolationQueueLength, 2)
  assert.equal(custom.maxTerminalInstances, DEFAULT_WORKBENCH_LIMITS.maxTerminalInstances)
  assert.equal(Object.isFrozen(custom), true)

  assert.throws(() => createWorkbenchLimits({ maxTabsPerWorkspace: 0 }), (error) => (
    error.code === ControlErrorCode.INVALID_ARGUMENT
  ))
  assert.throws(() => createWorkbenchLimits({ maxTabsPerWorkspace: 1.5 }), /1\.\.4096/)
  assert.throws(() => createWorkbenchLimits({ maxTabsPerWorkspace: 4097 }), /1\.\.4096/)
  assert.throws(() => createWorkbenchLimits({ madeUpLimit: 1 }), /未知 workbench limit/)
  assert.throws(() => createWorkbenchLimits({ schemaVersion: 2 }), /schemaVersion/)
})

test('tab/view capacity rejects the next tab without touching the current layout', () => {
  const layout = layoutWithTabs(2)
  const before = JSON.stringify(layout)
  assert.equal(inspectTabCapacity(layout, { maxTabsPerWorkspace: 3 }).allowed, true)
  assert.throws(
    () => assertTabCapacity(layout, { maxTabsPerWorkspace: 2 }),
    (error) => error.code === ControlErrorCode.LIMIT_EXCEEDED
      && error.details.resource === 'views'
      && error.details.used === 2
      && error.details.limit === 2,
  )
  assert.throws(() => assertTabCountCapacity(3, { maxTabsPerWorkspace: 3 }), /view 已达上限/)
  assert.equal(JSON.stringify(layout), before)
})

test('per-session and per-tool instance limits fail closed with structured details', () => {
  const state = {
    workspaces: {},
    toolInstances: {
      'files-1': instance('files-1', 'files'),
      'files-2': instance('files-2', 'files'),
    },
    leases: {},
  }
  const snapshot = JSON.stringify(state)

  const total = inspectToolInstanceCapacity(state, {
    owner: OWNER,
    toolId: 'files',
    limits: { maxToolInstancesPerSession: 2, maxInstancesPerTool: 8 },
  })
  assert.equal(total.allowed, false)
  assert.equal(total.resource, 'sessionToolInstances')

  const perTool = inspectToolInstanceCapacity(state, {
    owner: OWNER,
    toolId: 'files',
    limits: { maxToolInstancesPerSession: 8, maxInstancesPerTool: 2 },
  })
  assert.equal(perTool.allowed, false)
  assert.equal(perTool.resource, 'toolInstances')
  assert.equal(perTool.used, 2)

  assert.throws(
    () => assertToolInstanceCapacity(state, {
      owner: OWNER,
      toolId: 'files',
      limits: { maxToolInstancesPerSession: 2, maxInstancesPerTool: 2 },
    }),
    (error) => error.code === ControlErrorCode.LIMIT_EXCEEDED
      && error.details.scope === 'session'
      && error.details.toolId === 'files'
      && error.details.sessionId === 'session-a',
  )
  assert.equal(JSON.stringify(state), snapshot)
  assert.throws(
    () => inspectToolInstanceCapacity(state, { owner: OWNER, toolId: 'made-up' }),
    /未知 toolId/,
  )
})

test('host-wide PTY and browser caps stop new instances but keep existing ones', () => {
  const terminal = {
    workspaces: {},
    toolInstances: {
      'terminal-1': instance('terminal-1', 'terminal', { kind: 'session', id: 'session-b', hostId: 'host', windowId: 'window' }),
    },
    leases: {},
  }
  const terminalSnapshot = JSON.stringify(terminal)
  assert.throws(
    () => assertToolInstanceCapacity(terminal, {
      owner: OWNER,
      toolId: 'terminal',
      limits: { maxTerminalInstances: 1, maxInstancesPerTool: 8 },
    }),
    (error) => error.code === ControlErrorCode.LIMIT_EXCEEDED
      && error.details.resource === 'pty'
      && error.details.used === 1
      && /不会自动结束/.test(error.message),
  )
  assert.equal(JSON.stringify(terminal), terminalSnapshot)

  const browser = {
    workspaces: {},
    toolInstances: {
      'browser-1': instance('browser-1', 'browser', { kind: 'session', id: 'session-b', hostId: 'host', windowId: 'window' }),
    },
    leases: {},
  }
  assert.throws(
    () => assertToolInstanceCapacity(browser, {
      owner: OWNER,
      toolId: 'browser',
      limits: { maxBrowserTabs: 1, maxInstancesPerTool: 8 },
    }),
    (error) => error.code === ControlErrorCode.LIMIT_EXCEEDED
      && error.details.resource === 'browserTabs'
      && /不会自动关闭/.test(error.message),
  )
})

test('closing an instance frees exactly one slot; closed rows do not count', () => {
  const state = {
    workspaces: {},
    toolInstances: {
      'files-1': instance('files-1', 'files'),
      'files-2': { ...instance('files-2', 'files'), state: 'closed' },
    },
    leases: {},
  }
  const capacity = inspectToolInstanceCapacity(state, {
    owner: OWNER,
    toolId: 'files',
    limits: { maxToolInstancesPerSession: 2, maxInstancesPerTool: 2 },
  })
  assert.equal(capacity.allowed, true)
  assert.equal(capacity.used, 1)
})