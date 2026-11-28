/** Owner-scoped SessionView projections (X4.1). No Runtime state is inferred here. */
import {
  ControlError,
  ControlErrorCode,
  cloneJson,
  isPlainRecord,
} from './control.js'
import {
  acceptDraftSubmission,
  beginDraftSubmission,
  cancelDraftSubmission,
  createDraftState,
  failDraftSubmission,
  getDraft,
  queueDraftLocally,
  updateDraft,
} from './drafts.js'
import { createUsageReadModel } from './usage-read-model.js'
import { conversationKey } from './workbench-workspace.js'

export const SESSION_VIEW_SCHEMA_VERSION = 1
export const APPROVAL_STATUSES = Object.freeze(['pending', 'submitted', 'cancelled'])

function invalid(message) {
  return new ControlError(ControlErrorCode.INVALID_ARGUMENT, message)
}

/** Business identity deliberately excludes host/window: same-session views share it. */
export function validateConversationIdentity(owner) {
  conversationKey(owner)
  return { kind: owner.kind, id: owner.id }
}

function ownerDraft(state, owner) {
  const key = conversationKey(owner)
  const draft = getDraft(state, key)
  return draft ? { ownerKey: key, ...cloneJson(draft) } : null
}

export function getOwnerDraft(state, owner) {
  if (!isPlainRecord(state?.sessions)) throw invalid('draft state 必须是 createDraftState 的结果')
  return ownerDraft(state, owner)
}

export function updateOwnerDraft(state, owner, expectedRevision, patch, updatedAt) {
  return updateDraft(state, conversationKey(owner), expectedRevision, patch, updatedAt)
}

export function beginOwnerDraftSubmission(state, owner, expectedRevision, submissionId, updatedAt) {
  return beginDraftSubmission(state, conversationKey(owner), expectedRevision, submissionId, updatedAt)
}

export function queueOwnerDraftLocally(state, owner, submissionId, updatedAt) {
  return queueDraftLocally(state, conversationKey(owner), submissionId, updatedAt)
}

export function acceptOwnerDraftSubmission(state, owner, submissionId, updatedAt) {
  return acceptDraftSubmission(state, conversationKey(owner), submissionId, updatedAt)
}

export function failOwnerDraftSubmission(state, owner, submissionId, error, updatedAt) {
  return failDraftSubmission(state, conversationKey(owner), submissionId, error, updatedAt)
}

export function cancelOwnerDraftSubmission(state, owner, submissionId, updatedAt) {
  return cancelDraftSubmission(state, conversationKey(owner), submissionId, updatedAt)
}

/** Move an accepted draft to its session identity without overwriting an existing draft. */
export function bindDraftOwnerToSession(state, { draftId, sessionId, submissionId, updatedAt }) {
  for (const value of [draftId, sessionId, submissionId]) {
    if (typeof value !== 'string' || !value) throw invalid('draft/session/submission 身份必须是非空字符串')
  }
  const source = { kind: 'draft', id: draftId }
  const target = { kind: 'session', id: sessionId }
  const current = getOwnerDraft(state, source)
  if (!current) throw new ControlError(ControlErrorCode.NOT_FOUND, 'draft owner 不存在')
  if (current.submission?.submissionId !== submissionId || current.submission.state !== 'accepted') {
    throw new ControlError(ControlErrorCode.CONFLICT, '只有 Runtime 已接收的草稿才能绑定 session')
  }
  if (getOwnerDraft(state, target)) {
    throw new ControlError(ControlErrorCode.CONFLICT, 'session 已有草稿，拒绝覆盖')
  }
  const next = cloneJson(state)
  const { ownerKey: _ownerKey, ...snapshot } = current
  next.sessions[conversationKey(target)] = {
    ...cloneJson(snapshot),
    sessionId,
    draftId: `draft:${conversationKey(target)}`,
    updatedAt,
  }
  delete next.sessions[conversationKey(source)]
  return next
}

function normalizeApprovals(input) {
  if (input == null) return []
  if (!Array.isArray(input)) throw invalid('approvals 必须是数组')
  const ids = new Set()
  return input.map((item) => {
    if (!isPlainRecord(item) || typeof item.interactionId !== 'string' || !item.interactionId
      || typeof item.sessionId !== 'string' || !item.sessionId) {
      throw invalid('approval 缺少 interactionId/sessionId')
    }
    if (ids.has(item.interactionId)) throw invalid('approval interactionId 必须唯一')
    ids.add(item.interactionId)
    const status = item.status ?? 'pending'
    if (!APPROVAL_STATUSES.includes(status)) throw invalid('approval status 无效')
    if (!Number.isSafeInteger(item.leaseGeneration ?? 1) || (item.leaseGeneration ?? 1) < 1) {
      throw invalid('approval leaseGeneration 无效')
    }
    return {
      interactionId: item.interactionId,
      sessionId: item.sessionId,
      leaseGeneration: item.leaseGeneration ?? 1,
      kind: typeof item.kind === 'string' ? item.kind : 'approval',
      approvalType: typeof item.approvalType === 'string' ? item.approvalType : 'unknown',
      detail: isPlainRecord(item.detail) ? cloneJson(item.detail) : {},
      status,
      ...(typeof item.title === 'string' ? { title: item.title } : {}),
    }
  })
}

/** Project only approvals owned by this session. Drafts never inherit session approvals. */
export function projectApprovalsForOwner(input, owner) {
  const identity = validateConversationIdentity(owner)
  return normalizeApprovals(input).filter((item) => identity.kind === 'session' && item.sessionId === identity.id)
}

/** Session usage is scoped by sessionId. A draft has no attributable Runtime usage. */
export function projectUsageForOwner(input, owner, options = {}) {
  const identity = validateConversationIdentity(owner)
  if (identity.kind === 'draft') return null
  return createUsageReadModel(input ?? [], { ...options, sessionId: identity.id })
}

export function projectToolsForOwner(input, owner) {
  const identity = validateConversationIdentity(owner)
  const registry = input ?? {}
  if (!isPlainRecord(registry.workspaces) || !isPlainRecord(registry.toolInstances)) {
    throw invalid('registry 缺少 workspaces/toolInstances')
  }
  const key = conversationKey(identity)
  const workspace = registry.workspaces[key] ?? null
  const instances = Object.values(registry.toolInstances)
    .filter((instance) => isPlainRecord(instance?.owner) && conversationKey(instance.owner) === key)
    .map(cloneJson)
  return {
    instances,
    layout: workspace?.toolLayout ? cloneJson(workspace.toolLayout) : null,
    leases: Array.isArray(workspace?.leases) ? cloneJson(workspace.leases) : [],
  }
}

/** Compose a read-only owner projection from independent local/Host inputs. */
export function composeSessionView(input = {}) {
  if (!isPlainRecord(input)) throw invalid('SessionView input 必须是对象')
  const owner = validateConversationIdentity(input.owner)
  const drafts = input.drafts ?? createDraftState()
  return {
    schemaVersion: SESSION_VIEW_SCHEMA_VERSION,
    owner,
    draft: projectDraftForOwner(drafts, owner),
    approvals: projectApprovalsForOwner(input.approvals, owner),
    usage: projectUsageForOwner(input.usage, owner, input.usageOptions ?? {}),
    tools: projectToolsForOwner(input.registry ?? { workspaces: {}, toolInstances: {} }, owner),
  }
}

export function projectDraftForOwner(state, owner) {
  return getOwnerDraft(state, owner)
}
