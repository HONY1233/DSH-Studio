/** Pure conversation workspace, tool-instance and lease models (X2.11). */
import { ControlError, ControlErrorCode, cloneJson, isPlainRecord } from './control.js'
import {
  assertWorkbenchId,
  createWorkbenchLayout,
  validateWorkbenchLayout,
} from './workbench-schema.js'

export const TOOL_IDS = Object.freeze([
  'files', 'changes', 'git', 'terminal', 'browser', 'computer', 'ssh', 'wsl',
  'mcp', 'skills', 'agents', 'btw', 'voice', 'evaluation', 'time-travel',
])
export const TOOL_STATES = Object.freeze(['opening', 'ready', 'busy', 'disconnected', 'error', 'closed'])
export const LEASE_STATES = Object.freeze(['active', 'released'])

function invalid(message, details = {}) {
  return new ControlError(ControlErrorCode.INVALID_ARGUMENT, message, details)
}

function conflict(message, details = {}) {
  return new ControlError(ControlErrorCode.CONFLICT, message, details)
}

function notFound(message) {
  return new ControlError(ControlErrorCode.NOT_FOUND, message)
}

export function conversationKey(owner) {
  if (!isPlainRecord(owner)) throw invalid('conversation owner 必须是对象')
  if (owner.kind !== 'draft' && owner.kind !== 'session') throw invalid('owner.kind 必须是 draft 或 session')
  assertWorkbenchId(owner.id, 'owner.id')
  return `${owner.kind}:${owner.id}`
}

export function validateConversationOwner(owner) {
  conversationKey(owner)
  assertWorkbenchId(owner.hostId, 'owner.hostId')
  assertWorkbenchId(owner.windowId, 'owner.windowId')
  return cloneJson(owner)
}

export function defaultToolConcurrency(toolId) {
  if (['terminal', 'ssh', 'wsl', 'computer'].includes(toolId)) return 'exclusive'
  if (['files', 'changes', 'git'].includes(toolId)) return 'shared-read'
  return 'stateless'
}

export function createToolInstance(input) {
  if (!isPlainRecord(input)) throw invalid('tool instance 必须是对象')
  assertWorkbenchId(input.instanceId, 'tool.instanceId')
  if (!TOOL_IDS.includes(input.toolId)) throw invalid(`未知 toolId: ${input.toolId}`)
  const owner = validateConversationOwner(input.owner)
  const concurrency = input.concurrency ?? defaultToolConcurrency(input.toolId)
  if (!['shared-read', 'exclusive', 'stateless'].includes(concurrency)) throw invalid('tool.concurrency 无效')
  const state = input.state ?? 'opening'
  if (!TOOL_STATES.includes(state)) throw invalid('tool.state 无效')
  if (input.leaseId !== undefined) assertWorkbenchId(input.leaseId, 'tool.leaseId')
  if (input.metadata !== undefined && !isPlainRecord(input.metadata)) throw invalid('tool.metadata 必须是对象')
  return {
    instanceId: input.instanceId,
    toolId: input.toolId,
    owner,
    concurrency,
    state,
    ...(input.leaseId === undefined ? {} : { leaseId: input.leaseId }),
    ...(input.metadata === undefined ? {} : { metadata: cloneJson(input.metadata) }),
  }
}

export function createSessionLease(input) {
  if (!isPlainRecord(input)) throw invalid('lease 必须是对象')
  assertWorkbenchId(input.leaseId, 'lease.leaseId')
  assertWorkbenchId(input.instanceId, 'lease.instanceId')
  const owner = validateConversationOwner(input.owner)
  assertWorkbenchId(input.hostId, 'lease.hostId')
  assertWorkbenchId(input.windowId, 'lease.windowId')
  const state = input.state ?? 'active'
  if (!LEASE_STATES.includes(state)) throw invalid('lease.state 无效')
  if (typeof input.acquiredAt !== 'string' || !input.acquiredAt) throw invalid('lease.acquiredAt 必须是非空时间字符串')
  if (input.releasedAt !== undefined && (typeof input.releasedAt !== 'string' || !input.releasedAt)) {
    throw invalid('lease.releasedAt 必须是非空时间字符串')
  }
  return {
    leaseId: input.leaseId,
    instanceId: input.instanceId,
    owner,
    hostId: input.hostId,
    windowId: input.windowId,
    state,
    acquiredAt: input.acquiredAt,
    ...(input.releasedAt === undefined ? {} : { releasedAt: input.releasedAt }),
  }
}

export function createConversationWorkspace(input = {}) {
  const owner = validateConversationOwner(input.owner)
  if (!isPlainRecord(input.document)) throw invalid('workspace.document 必须是对象')
  assertWorkbenchId(input.document.draftId, 'document.draftId')
  if (!Array.isArray(input.document.contentBlocks)) throw invalid('document.contentBlocks 必须是数组')
  if (!Number.isSafeInteger(input.document.revision) || input.document.revision < 0) {
    throw invalid('document.revision 必须是非负安全整数')
  }
  if (!Array.isArray(input.document.queueLocal ?? [])) throw invalid('document.queueLocal 必须是数组')
  const toolLayout = input.toolLayout ?? createWorkbenchLayout({ kind: 'pane', id: 'pane-main', tabs: [] })
  validateWorkbenchLayout(toolLayout)
  if (!Array.isArray(input.toolInstances ?? [])) throw invalid('workspace.toolInstances 必须是数组')
  if (!Array.isArray(input.toolset ?? [])) throw invalid('workspace.toolset 必须是数组')
  if (!Array.isArray(input.leases ?? [])) throw invalid('workspace.leases 必须是数组')
  if (!Array.isArray(input.approvalState ?? [])) throw invalid('workspace.approvalState 必须是数组')
  if (!isPlainRecord(input.runtimeCapabilities ?? {})) throw invalid('workspace.runtimeCapabilities 必须是对象')
  return {
    owner,
    document: {
      draftId: input.document.draftId,
      contentBlocks: cloneJson(input.document.contentBlocks),
      revision: input.document.revision,
      queueLocal: cloneJson(input.document.queueLocal ?? []),
    },
    toolLayout: cloneJson(toolLayout),
    toolInstances: cloneJson(input.toolInstances ?? []),
    toolset: cloneJson(input.toolset ?? []),
    leases: cloneJson(input.leases ?? []),
    runtimeCapabilities: cloneJson(input.runtimeCapabilities ?? {}),
    approvalState: cloneJson(input.approvalState ?? []),
  }
}

export function createWorkbenchRegistry() {
  return {
    schemaVersion: 1,
    revision: 0,
    workspaces: {},
    toolInstances: {},
    leases: {},
  }
}

function nextRegistry(state) {
  if (!Number.isSafeInteger(state.revision + 1)) throw invalid('registry.revision 已超出安全整数范围')
  return { ...cloneJson(state), revision: state.revision + 1 }
}

export function putConversationWorkspace(state, workspace) {
  const validated = createConversationWorkspace(workspace)
  const key = conversationKey(validated.owner)
  const next = nextRegistry(state)
  next.workspaces[key] = validated
  return next
}

export function getConversationWorkspace(state, owner) {
  return state.workspaces[conversationKey(owner)] ?? null
}

export function putToolInstance(state, instance) {
  const validated = createToolInstance(instance)
  const next = nextRegistry(state)
  if (next.toolInstances[validated.instanceId]
    && JSON.stringify(next.toolInstances[validated.instanceId]) !== JSON.stringify(validated)) {
    throw conflict(`tool instance 已存在: ${validated.instanceId}`)
  }
  next.toolInstances[validated.instanceId] = validated
  const workspaceKey = conversationKey(validated.owner)
  if (!next.workspaces[workspaceKey]) throw notFound(`workspace 不存在: ${workspaceKey}`)
  const workspace = next.workspaces[workspaceKey]
  const index = workspace.toolInstances.findIndex((item) => item.instanceId === validated.instanceId)
  if (index >= 0) workspace.toolInstances[index] = validated
  else workspace.toolInstances.push(validated)
  return next
}

export function acquireToolLease(state, { leaseId, instanceId, owner, hostId, windowId, acquiredAt }) {
  const next = nextRegistry(state)
  const instance = next.toolInstances[instanceId]
  if (!instance) throw notFound(`tool instance 不存在: ${instanceId}`)
  if (instance.concurrency === 'stateless') throw conflict('stateless 工具不需要 lease')
  const validatedOwner = validateConversationOwner(owner)
  const active = Object.values(next.leases).find((lease) => lease.instanceId === instanceId && lease.state === 'active')
  if (instance.concurrency === 'exclusive' && active) {
    const sameOwner = conversationKey(active.owner) === conversationKey(validatedOwner)
      && active.hostId === hostId
      && active.windowId === windowId
    if (!sameOwner || active.leaseId !== leaseId) {
      throw conflict('exclusive 工具已被其他 owner 租用', {
        instanceId,
        activeLeaseId: active.leaseId,
        activeOwner: active.owner,
      })
    }
  }
  const lease = createSessionLease({ leaseId, instanceId, owner: validatedOwner, hostId, windowId, acquiredAt })
  next.leases[leaseId] = lease
  instance.leaseId = leaseId
  const workspace = next.workspaces[conversationKey(validatedOwner)]
  if (!workspace) throw notFound(`workspace 不存在: ${conversationKey(validatedOwner)}`)
  const existing = workspace.leases.findIndex((item) => item.leaseId === leaseId)
  if (existing >= 0) workspace.leases[existing] = lease
  else workspace.leases.push(lease)
  return next
}

export function releaseToolLease(state, leaseId, releasedAt) {
  const next = nextRegistry(state)
  const lease = next.leases[leaseId]
  if (!lease) throw notFound(`lease 不存在: ${leaseId}`)
  if (lease.state === 'released') return state
  lease.state = 'released'
  lease.releasedAt = releasedAt
  const instance = next.toolInstances[lease.instanceId]
  if (instance?.leaseId === leaseId) delete instance.leaseId
  const workspace = next.workspaces[conversationKey(lease.owner)]
  if (workspace) {
    const index = workspace.leases.findIndex((item) => item.leaseId === leaseId)
    if (index >= 0) workspace.leases[index] = cloneJson(lease)
  }
  return next
}

export function moveToolInstance(state, { instanceId, toOwner, toHostId, toWindowId, mode = 'move', newInstanceId, now }) {
  if (mode !== 'move' && mode !== 'new') throw invalid('mode 必须是 move 或 new')
  const next = nextRegistry(state)
  const source = next.toolInstances[instanceId]
  if (!source) throw notFound(`tool instance 不存在: ${instanceId}`)
  const targetOwner = validateConversationOwner(toOwner)
  const targetWorkspaceKey = conversationKey(targetOwner)
  if (!next.workspaces[targetWorkspaceKey]) throw notFound(`目标 workspace 不存在: ${targetWorkspaceKey}`)
  const activeLease = Object.values(next.leases).find((lease) => lease.instanceId === instanceId && lease.state === 'active')
  if (source.concurrency === 'exclusive' && activeLease && mode === 'move') {
    throw conflict('exclusive 工具移动前必须释放 lease，或显式创建新实例', { instanceId })
  }
  if (mode === 'new') {
    assertWorkbenchId(newInstanceId, 'newInstanceId')
    if (next.toolInstances[newInstanceId]) throw conflict(`新 instanceId 已存在: ${newInstanceId}`)
    const created = createToolInstance({
      ...source,
      instanceId: newInstanceId,
      owner: targetOwner,
      state: 'opening',
      leaseId: undefined,
      metadata: { ...(source.metadata ?? {}), createdFrom: instanceId, createdAt: now },
    })
    next.toolInstances[newInstanceId] = created
    next.workspaces[targetWorkspaceKey].toolInstances.push(created)
    return next
  }
  const sourceWorkspace = next.workspaces[conversationKey(source.owner)]
  if (sourceWorkspace) {
    sourceWorkspace.toolInstances = sourceWorkspace.toolInstances.filter((item) => item.instanceId !== instanceId)
  }
  source.owner = targetOwner
  source.state = source.state === 'closed' ? 'opening' : source.state
  next.workspaces[targetWorkspaceKey].toolInstances.push(source)
  if (activeLease) {
    activeLease.owner = targetOwner
    activeLease.hostId = toHostId
    activeLease.windowId = toWindowId
    const leaseWorkspace = next.workspaces[targetWorkspaceKey]
    const existing = leaseWorkspace.leases.findIndex((item) => item.leaseId === activeLease.leaseId)
    if (existing >= 0) leaseWorkspace.leases[existing] = cloneJson(activeLease)
    else leaseWorkspace.leases.push(cloneJson(activeLease))
  }
  return next
}

export function bindDraftWorkspaceToSession(state, { draftId, sessionId, hostId, windowId }) {
  assertWorkbenchId(draftId, 'draftId')
  assertWorkbenchId(sessionId, 'sessionId')
  const draftOwner = { kind: 'draft', id: draftId, hostId, windowId }
  const sessionOwner = { kind: 'session', id: sessionId, hostId, windowId }
  const draftKey = conversationKey(draftOwner)
  const sessionKey = conversationKey(sessionOwner)
  const draft = state.workspaces[draftKey]
  if (!draft) throw notFound(`draft workspace 不存在: ${draftKey}`)
  if (state.workspaces[sessionKey]) throw conflict(`session workspace 已存在: ${sessionKey}`)
  const next = nextRegistry(state)
  const migrated = cloneJson(draft)
  migrated.owner = sessionOwner
  migrated.document.draftId = `draft:${sessionId}`
  for (const instance of migrated.toolInstances) instance.owner = sessionOwner
  for (const lease of migrated.leases) lease.owner = sessionOwner
  for (const [instanceId, instance] of Object.entries(next.toolInstances)) {
    if (conversationKey(instance.owner) === draftKey) next.toolInstances[instanceId].owner = sessionOwner
  }
  for (const lease of Object.values(next.leases)) {
    if (conversationKey(lease.owner) === draftKey) lease.owner = sessionOwner
  }
  delete next.workspaces[draftKey]
  next.workspaces[sessionKey] = migrated
  return next
}

export function validateWorkbenchDrop({ source, target, hosts = [], registry }) {
  if (!Array.isArray(hosts) || !hosts.some((host) => host.hostId === target?.hostId)) {
    throw conflict(`目标 host 不存在或无权访问: ${target?.hostId}`)
  }
  if (!registry) throw invalid('registry 必须提供')
  const instance = registry.toolInstances[source?.content?.instanceId]
  if (instance?.concurrency === 'exclusive') {
    const lease = Object.values(registry.leases).find((item) => item.instanceId === instance.instanceId && item.state === 'active')
    if (lease && (lease.hostId !== target.hostId || lease.windowId !== source.windowId)) {
      throw conflict('exclusive 工具跨宿主移动需要显式改归属', {
        instanceId: instance.instanceId,
        choices: ['move-and-reassign', 'create-new'],
      })
    }
  }
  return { allowed: true, requiresExclusiveChoice: false }
}

export function assertWorkbenchRegistryInvariants(state) {
  if (!isPlainRecord(state) || state.schemaVersion !== 1 || !isPlainRecord(state.workspaces)
    || !isPlainRecord(state.toolInstances) || !isPlainRecord(state.leases)) {
    throw invalid('workbench registry 结构无效')
  }
  for (const [key, workspace] of Object.entries(state.workspaces)) {
    if (conversationKey(workspace.owner) !== key) throw conflict(`workspace key 不匹配: ${key}`)
    validateWorkbenchLayout(workspace.toolLayout)
    for (const instance of workspace.toolInstances) {
      if (state.toolInstances[instance.instanceId]?.instanceId !== instance.instanceId) {
        throw conflict(`workspace 引用了不存在的 tool instance: ${instance.instanceId}`)
      }
    }
    for (const lease of workspace.leases) {
      if (state.leases[lease.leaseId]?.leaseId !== lease.leaseId) throw conflict(`workspace 引用了不存在的 lease: ${lease.leaseId}`)
    }
  }
  for (const lease of Object.values(state.leases)) {
    const instance = state.toolInstances[lease.instanceId]
    if (!instance) throw conflict(`lease 引用了不存在的 tool instance: ${lease.instanceId}`)
    if (lease.state === 'active' && instance.leaseId !== lease.leaseId) {
      throw conflict(`active lease 与 tool.leaseId 不匹配: ${lease.leaseId}`)
    }
  }
  return true
}
