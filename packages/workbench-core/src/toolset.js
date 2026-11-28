/**
 * Capability-gated session toolsets and per-session tool instances (X4.3).
 *
 * The renderer may choose from a list, but it never decides that a tool is
 * available. A capability snapshot is Host-owned: every `available` entry
 * carries the adapter evidence that made it selectable, and every blocked
 * entry carries a reason. Selection and instance registration fail closed when
 * the snapshot, the session toolset, or the expected registry revision does
 * not agree.
 */
import { ControlError, ControlErrorCode, cloneJson, isPlainRecord } from './control.js'
import {
  TOOL_IDS,
  conversationKey,
  createToolInstance,
  putToolInstance,
} from './workbench-workspace.js'
import { assertToolInstanceCapacity } from './workbench-limits.js'

export const SESSION_TOOLSET_SCHEMA_VERSION = 1
export const TOOL_CAPABILITY_GRADES = Object.freeze([
  'available',
  'limited',
  'configured',
  'unavailable',
  'unsupported',
  'unknown',
])

function invalid(message, details = {}) {
  return new ControlError(ControlErrorCode.INVALID_ARGUMENT, message, details)
}

function conflict(message, details = {}) {
  return new ControlError(ControlErrorCode.CONFLICT, message, details)
}

function notFound(message) {
  return new ControlError(ControlErrorCode.NOT_FOUND, message)
}

function unavailable(toolId, reason, details = {}) {
  return new ControlError(
    ControlErrorCode.CAPABILITY_UNAVAILABLE,
    `工具 ${toolId} 当前不可用：${reason}`,
    { toolId, reason, ...details },
  )
}

function assertRevision(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw invalid(`${label} 必须是非负安全整数`)
}

/**
 * Validate and clone a Host-owned capability snapshot.
 *
 * `source: 'host'` is an explicit provenance marker, not an authorization
 * token. The Desktop bridge constructs this object itself; renderer input is
 * never passed here.
 */
export function createToolCapabilitySnapshot(input) {
  if (!isPlainRecord(input)) throw invalid('tool capability 快照必须是对象')
  if (input.source !== 'host') throw invalid('tool capability 快照必须由 Host 创建')
  if (typeof input.revision !== 'string' || !input.revision.trim()) {
    throw invalid('tool capability.revision 必须是非空字符串')
  }
  if (typeof input.observedAt !== 'string' || !input.observedAt.trim()) {
    throw invalid('tool capability.observedAt 必须是非空时间字符串')
  }
  if (!isPlainRecord(input.tools)) throw invalid('tool capability.tools 必须是对象')

  const tools = {}
  for (const [toolId, raw] of Object.entries(input.tools)) {
    if (!TOOL_IDS.includes(toolId)) throw invalid(`未知 toolId: ${toolId}`)
    if (!isPlainRecord(raw)) throw invalid(`tool capability.${toolId} 必须是对象`)
    if (!TOOL_CAPABILITY_GRADES.includes(raw.grade)) {
      throw invalid(`tool capability.${toolId}.grade 无效`)
    }
    const evidence = raw.evidence === undefined ? undefined : String(raw.evidence)
    const reason = raw.reason === undefined ? undefined : String(raw.reason)
    if (raw.grade === 'available') {
      if (!evidence?.trim()) throw invalid(`可用工具 ${toolId} 必须提供真实适配器证据`)
      if (reason !== undefined) throw invalid(`可用工具 ${toolId} 不能同时带阻塞原因`)
    } else if (!reason?.trim()) {
      throw invalid(`不可用工具 ${toolId} 必须说明原因`)
    }
    tools[toolId] = {
      grade: raw.grade,
      ...(reason === undefined ? {} : { reason }),
      ...(evidence === undefined ? {} : { evidence }),
    }
  }

  return {
    schemaVersion: SESSION_TOOLSET_SCHEMA_VERSION,
    source: 'host',
    revision: input.revision,
    observedAt: input.observedAt,
    tools,
  }
}

export function validateToolCapabilitySnapshot(snapshot) {
  return createToolCapabilitySnapshot(snapshot)
}

export function toolCapabilityOf(snapshot, toolId) {
  const capabilities = validateToolCapabilitySnapshot(snapshot)
  if (!TOOL_IDS.includes(toolId)) throw invalid(`未知 toolId: ${toolId}`)
  return capabilities.tools[toolId] ?? null
}

/** Select only tools the Host currently marks available; reject, never filter silently. */
export function selectSessionToolset(snapshot, toolset) {
  if (!Array.isArray(toolset)) throw invalid('toolset 必须是数组')
  const capabilities = validateToolCapabilitySnapshot(snapshot)
  const seen = new Set()
  const selected = []
  for (const item of toolset) {
    if (typeof item !== 'string' || !TOOL_IDS.includes(item)) throw invalid(`未知 toolId: ${String(item)}`)
    if (seen.has(item)) throw invalid(`toolset 包含重复工具: ${item}`)
    seen.add(item)
    const capability = capabilities.tools[item]
    if (!capability || capability.grade !== 'available') {
      throw unavailable(item, capability?.reason ?? 'Host 没有声明此工具')
    }
    selected.push(item)
  }
  return selected
}

/**
 * Read-side intersection. A previously saved toolset can become stale when the
 * Host capability snapshot changes; callers must render the effective subset
 * and the explicit stale reasons instead of pretending the saved set is live.
 */
export function effectiveSessionToolset(snapshot, toolset) {
  if (!Array.isArray(toolset)) throw invalid('toolset 必须是数组')
  const capabilities = validateToolCapabilitySnapshot(snapshot)
  const selected = []
  const stale = []
  const seen = new Set()
  for (const item of toolset) {
    if (typeof item !== 'string' || seen.has(item)) continue
    seen.add(item)
    if (!TOOL_IDS.includes(item)) {
      stale.push({ toolId: item, reason: '未知 toolId' })
      continue
    }
    const capability = capabilities.tools[item]
    if (capability?.grade === 'available') selected.push(item)
    else stale.push({ toolId: item, reason: capability?.reason ?? 'Host 没有声明此工具' })
  }
  return { toolset: selected, stale }
}

export function setSessionToolset(state, { owner, toolset, capabilities, expectedRevision, updatedAt }) {
  assertRevision(expectedRevision, 'expectedRevision')
  if (typeof updatedAt !== 'string' || !updatedAt) throw invalid('updatedAt 必须是非空时间字符串')
  if (state.revision !== expectedRevision) {
    throw conflict('workbench registry revision 已变化', {
      expectedRevision,
      actualRevision: state.revision,
    })
  }
  const snapshot = validateToolCapabilitySnapshot(capabilities)
  const selected = selectSessionToolset(snapshot, toolset)
  const key = conversationKey(owner)
  const workspace = state.workspaces[key]
  if (!workspace) throw notFound(`workspace 不存在: ${key}`)

  const removed = workspace.toolInstances.filter(
    (instance) => instance.state !== 'closed' && !selected.includes(instance.toolId),
  )
  if (removed.length > 0) {
    throw conflict('移除工具前必须先关闭其实例', {
      instances: removed.map((instance) => ({
        instanceId: instance.instanceId,
        toolId: instance.toolId,
        state: instance.state,
      })),
    })
  }

  const next = cloneJson(state)
  next.revision += 1
  next.workspaces[key].toolset = cloneJson(selected)
  next.workspaces[key].runtimeCapabilities = cloneJson(snapshot)
  return next
}

function assertToolsetAllows(workspace, toolId) {
  if (!TOOL_IDS.includes(toolId)) throw invalid(`未知 toolId: ${String(toolId)}`)
  if (!Array.isArray(workspace.toolset) || !workspace.toolset.includes(toolId)) {
    throw new ControlError(
      ControlErrorCode.CAPABILITY_UNAVAILABLE,
      `工具 ${toolId} 不在当前会话 toolset 中`,
      { toolId, toolset: workspace.toolset ?? [] },
    )
  }
  const capability = workspace.runtimeCapabilities?.tools?.[toolId]
  if (capability?.grade !== 'available') {
    throw unavailable(toolId, capability?.reason ?? '会话 capability 快照缺失')
  }
}

/**
 * Open a Host-registered instance inside one session. The caller supplies the
 * Main-minted instanceId; the instance can only use an already-selected,
 * currently available tool. A configured capacity limit rejects the new
 * instance before anything is added and never touches existing instances.
 */
export function registerSessionToolInstance(state, {
  owner,
  expectedRevision,
  instanceId,
  toolId,
  concurrency,
  metadata,
  limits,
}) {
  assertRevision(expectedRevision, 'expectedRevision')
  if (state.revision !== expectedRevision) {
    throw conflict('workbench registry revision 已变化', {
      expectedRevision,
      actualRevision: state.revision,
    })
  }
  const key = conversationKey(owner)
  const workspace = state.workspaces[key]
  if (!workspace) throw notFound(`workspace 不存在: ${key}`)
  assertToolsetAllows(workspace, toolId)
  assertToolInstanceCapacity(state, { owner, toolId, limits })
  const instance = createToolInstance({
    instanceId,
    toolId,
    owner,
    ...(concurrency === undefined ? {} : { concurrency }),
    state: 'opening',
    ...(metadata === undefined ? {} : { metadata }),
  })
  return putToolInstance(state, instance)
}

export function closeSessionToolInstance(state, { owner, expectedRevision, instanceId }) {
  assertRevision(expectedRevision, 'expectedRevision')
  if (state.revision !== expectedRevision) {
    throw conflict('workbench registry revision 已变化', {
      expectedRevision,
      actualRevision: state.revision,
    })
  }
  const key = conversationKey(owner)
  const instance = state.toolInstances[instanceId]
  if (!instance) throw notFound(`tool instance 不存在: ${instanceId}`)
  if (conversationKey(instance.owner) !== key) {
    throw conflict('不能关闭其他会话的 tool instance', { instanceId, owner: key })
  }
  const activeLease = Object.values(state.leases)
    .find((lease) => lease.instanceId === instanceId && lease.state === 'active')
  if (activeLease) {
    throw conflict('关闭实例前必须先释放 lease', {
      instanceId,
      activeLeaseId: activeLease.leaseId,
    })
  }

  const next = cloneJson(state)
  next.revision += 1
  next.toolInstances[instanceId].state = 'closed'
  const workspace = next.workspaces[key]
  if (workspace) {
    const index = workspace.toolInstances.findIndex((item) => item.instanceId === instanceId)
    if (index >= 0) workspace.toolInstances[index].state = 'closed'
  }
  return next
}