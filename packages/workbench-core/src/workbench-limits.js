/**
 * Configurable pressure boundaries for X4.6 (XC-18).
 *
 * These limits are deliberately explicit and fail closed: reaching a limit
 * rejects the *new* view/instance and reports which resource is full. Nothing
 * here closes, kills, or mutates an existing process, tab, or instance.
 */
import { ControlError, ControlErrorCode, isPlainRecord } from './control.js'
import { listTabs } from './workbench-schema.js'
import { TOOL_IDS, conversationKey } from './workbench-workspace.js'

export const WORKBENCH_LIMITS_SCHEMA_VERSION = 1

export const WORKBENCH_LIMIT_KEYS = Object.freeze([
  'maxTabsPerWorkspace',
  'maxToolInstancesPerSession',
  'maxInstancesPerTool',
  'maxTerminalInstances',
  'maxBrowserTabs',
  'isolationQueueLength',
])

export const DEFAULT_WORKBENCH_LIMITS = Object.freeze({
  schemaVersion: WORKBENCH_LIMITS_SCHEMA_VERSION,
  maxTabsPerWorkspace: 24,
  maxToolInstancesPerSession: 16,
  maxInstancesPerTool: 8,
  maxTerminalInstances: 8,
  maxBrowserTabs: 8,
  isolationQueueLength: 128,
})

function invalid(message, details = {}) {
  return new ControlError(ControlErrorCode.INVALID_ARGUMENT, message, details)
}

function limitError(message, details) {
  return new ControlError(ControlErrorCode.LIMIT_EXCEEDED, message, details)
}

function assertLimit(value, name) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 4096) {
    throw invalid(`${name} 必须是 1..4096 的整数`)
  }
  return value
}

/**
 * Validate and freeze one complete limits snapshot. Accepting a previously
 * normalised object makes it safe to pass limits down through several layers.
 */
export function createWorkbenchLimits(input = {}) {
  if (!isPlainRecord(input)) throw invalid('workbench limits 必须是对象')
  if (input.schemaVersion !== undefined && input.schemaVersion !== WORKBENCH_LIMITS_SCHEMA_VERSION) {
    throw invalid('workbench limits schemaVersion 不受支持')
  }
  const unknown = Object.keys(input).filter(
    (key) => key !== 'schemaVersion' && !WORKBENCH_LIMIT_KEYS.includes(key),
  )
  if (unknown.length > 0) throw invalid(`未知 workbench limit: ${unknown.join(', ')}`)

  const limits = { schemaVersion: WORKBENCH_LIMITS_SCHEMA_VERSION }
  for (const key of WORKBENCH_LIMIT_KEYS) {
    const value = input[key] ?? DEFAULT_WORKBENCH_LIMITS[key]
    limits[key] = assertLimit(value, key)
  }
  return Object.freeze(limits)
}

/** How many tabs a layout currently holds, across panes, regions and floats. */
export function countLayoutTabs(layout) {
  return listTabs(layout).length
}

export function inspectTabCountCapacity(used, limits) {
  const config = createWorkbenchLimits(limits)
  if (!Number.isSafeInteger(used) || used < 0) throw invalid('tab 数量必须是非负安全整数')
  return {
    allowed: used < config.maxTabsPerWorkspace,
    resource: 'views',
    used,
    limit: config.maxTabsPerWorkspace,
  }
}

export function inspectTabCapacity(layout, limits) {
  return inspectTabCountCapacity(countLayoutTabs(layout), limits)
}

function tabLimitError(capacity) {
  return limitError(`工作区打开的 view 已达上限（${capacity.limit}）；请先关闭一个标签`, {
    resource: capacity.resource,
    used: capacity.used,
    limit: capacity.limit,
  })
}

/** Reject a new tab count before it enters the layout; existing tabs stay untouched. */
export function assertTabCountCapacity(used, limits) {
  const capacity = inspectTabCountCapacity(used, limits)
  if (capacity.allowed) return capacity
  throw tabLimitError(capacity)
}

/** Reject a new tab before it enters the layout; existing tabs stay untouched. */
export function assertTabCapacity(layout, limits) {
  const capacity = inspectTabCapacity(layout, limits)
  if (capacity.allowed) return capacity
  throw tabLimitError(capacity)
}

function instanceRows(state) {
  if (!isPlainRecord(state?.toolInstances)) return []
  return Object.values(state.toolInstances).filter(
    (instance) => isPlainRecord(instance) && instance.state !== 'closed',
  )
}

/**
 * Inspect the next instance slot without mutating the registry. `used` is the
 * count before the requested instance is added, so `used >= limit` rejects.
 */
export function inspectToolInstanceCapacity(state, { owner, toolId, limits }) {
  const config = createWorkbenchLimits(limits)
  const key = conversationKey(owner)
  if (!TOOL_IDS.includes(toolId)) throw invalid(`未知 toolId: ${String(toolId)}`)
  const instances = instanceRows(state)
  const sessionInstances = instances.filter((instance) => {
    try {
      return conversationKey(instance.owner) === key
    } catch {
      return false
    }
  })
  const toolInSession = sessionInstances.filter((instance) => instance.toolId === toolId)
  const toolGlobal = instances.filter((instance) => instance.toolId === toolId)

  if (sessionInstances.length >= config.maxToolInstancesPerSession) {
    return {
      allowed: false,
      resource: 'sessionToolInstances',
      scope: 'session',
      used: sessionInstances.length,
      limit: config.maxToolInstancesPerSession,
      toolId,
    }
  }
  if (toolInSession.length >= config.maxInstancesPerTool) {
    return {
      allowed: false,
      resource: 'toolInstances',
      scope: 'tool',
      used: toolInSession.length,
      limit: config.maxInstancesPerTool,
      toolId,
    }
  }
  if (toolId === 'terminal' && toolGlobal.length >= config.maxTerminalInstances) {
    return {
      allowed: false,
      resource: 'pty',
      scope: 'host',
      used: toolGlobal.length,
      limit: config.maxTerminalInstances,
      toolId,
    }
  }
  if (toolId === 'browser' && toolGlobal.length >= config.maxBrowserTabs) {
    return {
      allowed: false,
      resource: 'browserTabs',
      scope: 'host',
      used: toolGlobal.length,
      limit: config.maxBrowserTabs,
      toolId,
    }
  }
  return {
    allowed: true,
    resource: null,
    scope: null,
    used: sessionInstances.length,
    limit: config.maxToolInstancesPerSession,
    toolId,
  }
}

/** Reject a new instance; every existing process/instance is left running. */
export function assertToolInstanceCapacity(state, input) {
  const capacity = inspectToolInstanceCapacity(state, input)
  if (capacity.allowed) return capacity
  const messages = {
    sessionToolInstances: `本会话工具实例已达上限（${capacity.limit}）；请先关闭一个工具`,
    toolInstances: `工具 ${capacity.toolId} 的实例已达上限（${capacity.limit}）`,
    pty: `PTY 数量已达上限（${capacity.limit}）；不会自动结束已有终端`,
    browserTabs: `浏览器标签已达上限（${capacity.limit}）；不会自动关闭已有标签`,
  }
  throw limitError(messages[capacity.resource] ?? `工具实例已达上限（${capacity.limit}）`, {
    resource: capacity.resource,
    scope: capacity.scope,
    used: capacity.used,
    limit: capacity.limit,
    toolId: capacity.toolId,
    sessionId: input.owner.id,
  })
}