/** Pure per-session draft state. Local pending is never a Runtime queue claim. */
import {
  ControlError,
  ControlErrorCode,
  cloneJson,
  isPlainRecord,
} from './control.js'

const DRAFT_SCHEMA_VERSION = 1

function assertSessionId(sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 512) {
    throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, 'sessionId 必须是非空字符串')
  }
}

function assertRevision(revision) {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, 'draft revision 必须是非负安全整数')
  }
}

function assertTimestamp(value, name = 'updatedAt') {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, `${name} 必须是非空时间字符串`)
  }
}

function assertAttachments(value) {
  if (!Array.isArray(value)) throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, 'attachments 必须是数组')
  const ids = new Set()
  for (const attachment of value) {
    if (!isPlainRecord(attachment) || typeof attachment.id !== 'string' || !attachment.id || ids.has(attachment.id)) {
      throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, '每个附件必须具有唯一 id')
    }
    ids.add(attachment.id)
  }
}

export function createDraftState() {
  return { schemaVersion: DRAFT_SCHEMA_VERSION, sessions: {} }
}

export function getDraft(state, sessionId) {
  assertSessionId(sessionId)
  if (!isPlainRecord(state?.sessions)) throw new ControlError(ControlErrorCode.CORRUPT_RECORD, '草稿状态缺少 sessions')
  return state.sessions[sessionId] ?? null
}

function ensureDraft(state, sessionId) {
  assertSessionId(sessionId)
  if (!isPlainRecord(state?.sessions)) throw new ControlError(ControlErrorCode.CORRUPT_RECORD, '草稿状态缺少 sessions')
  if (!state.sessions[sessionId]) {
    state.sessions[sessionId] = {
      sessionId,
      draftId: `draft:${sessionId}`,
      revision: 0,
      body: '',
      attachments: [],
      submission: null,
      updatedAt: null,
    }
  }
  return state.sessions[sessionId]
}

function copyState(state) {
  return cloneJson(state)
}

function assertExpected(draft, expectedRevision) {
  assertRevision(expectedRevision)
  if (draft.revision !== expectedRevision) {
    throw new ControlError(ControlErrorCode.CONFLICT, '草稿 revision 已变化，拒绝覆盖', {
      expectedRevision,
      actualRevision: draft.revision,
    })
  }
}

export function updateDraft(state, sessionId, expectedRevision, patch, updatedAt) {
  const next = copyState(state)
  const draft = ensureDraft(next, sessionId)
  assertExpected(draft, expectedRevision)
  if (!isPlainRecord(patch)) throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, 'patch 必须是对象')
  if ('body' in patch) {
    if (typeof patch.body !== 'string' || patch.body.length > 1_000_000) {
      throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, 'body 必须是不超过 1,000,000 字符的字符串')
    }
    draft.body = patch.body
  }
  if ('attachments' in patch) {
    assertAttachments(patch.attachments)
    draft.attachments = cloneJson(patch.attachments)
  }
  assertTimestamp(updatedAt)
  draft.revision += 1
  draft.updatedAt = updatedAt
  return next
}

export function beginDraftSubmission(state, sessionId, expectedRevision, submissionId, updatedAt) {
  const next = copyState(state)
  const draft = ensureDraft(next, sessionId)
  assertExpected(draft, expectedRevision)
  if (typeof submissionId !== 'string' || !submissionId || submissionId.length > 512) {
    throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, 'submissionId 必须是非空字符串')
  }
  assertTimestamp(updatedAt)
  if (draft.submission && ['sending', 'local-queued'].includes(draft.submission.state)) {
    if (draft.submission.submissionId === submissionId) return state
    throw new ControlError(ControlErrorCode.CONFLICT, '该会话已有未结算的本地提交')
  }
  draft.submission = {
    submissionId,
    state: 'sending',
    origin: 'local-unsubmitted',
    runtimeAccepted: false,
    runtimeQueued: false,
    draftRevision: draft.revision,
    snapshot: { body: draft.body, attachments: cloneJson(draft.attachments) },
    error: null,
  }
  draft.revision += 1
  draft.updatedAt = updatedAt
  return next
}

function settleDraft(state, sessionId, submissionId, targetState, updatedAt, error = null) {
  const next = copyState(state)
  const draft = ensureDraft(next, sessionId)
  if (!draft.submission || draft.submission.submissionId !== submissionId) {
    throw new ControlError(ControlErrorCode.NOT_FOUND, '未找到对应的本地提交')
  }
  assertTimestamp(updatedAt)
  draft.submission.state = targetState
  draft.submission.runtimeAccepted = targetState === 'accepted'
  draft.submission.runtimeQueued = false
  draft.submission.error = error == null ? null : cloneJson(error)
  draft.revision += 1
  draft.updatedAt = updatedAt
  return next
}

export function queueDraftLocally(state, sessionId, submissionId, updatedAt) {
  return settleDraft(state, sessionId, submissionId, 'local-queued', updatedAt)
}

export function acceptDraftSubmission(state, sessionId, submissionId, updatedAt) {
  return settleDraft(state, sessionId, submissionId, 'accepted', updatedAt)
}

export function failDraftSubmission(state, sessionId, submissionId, error, updatedAt) {
  return settleDraft(state, sessionId, submissionId, 'failed', updatedAt, error)
}

export function cancelDraftSubmission(state, sessionId, submissionId, updatedAt) {
  const next = copyState(state)
  const draft = ensureDraft(next, sessionId)
  if (!draft.submission || draft.submission.submissionId !== submissionId) {
    throw new ControlError(ControlErrorCode.NOT_FOUND, '未找到对应的本地提交')
  }
  assertTimestamp(updatedAt)
  draft.submission = null
  draft.revision += 1
  draft.updatedAt = updatedAt
  return next
}

export function serializeDrafts(state) {
  const serialized = JSON.stringify(state)
  if (typeof serialized !== 'string') throw new ControlError(ControlErrorCode.CORRUPT_RECORD, '草稿状态无法序列化')
  return serialized
}

export function restoreDrafts(serialized) {
  if (typeof serialized !== 'string') throw new ControlError(ControlErrorCode.CORRUPT_RECORD, '草稿快照必须是 JSON 字符串')
  let state
  try {
    state = JSON.parse(serialized)
  } catch {
    throw new ControlError(ControlErrorCode.CORRUPT_RECORD, '草稿快照不是合法 JSON')
  }
  if (!isPlainRecord(state) || state.schemaVersion !== DRAFT_SCHEMA_VERSION || !isPlainRecord(state.sessions)) {
    throw new ControlError(ControlErrorCode.CORRUPT_RECORD, '草稿快照格式或版本不受支持')
  }
  for (const [sessionId, draft] of Object.entries(state.sessions)) {
    assertSessionId(sessionId)
    if (!isPlainRecord(draft) || draft.sessionId !== sessionId || typeof draft.draftId !== 'string') {
      throw new ControlError(ControlErrorCode.CORRUPT_RECORD, `草稿 ${sessionId} 的身份无效`)
    }
    assertRevision(draft.revision)
    if (typeof draft.body !== 'string') throw new ControlError(ControlErrorCode.CORRUPT_RECORD, `草稿 ${sessionId} 的正文无效`)
    assertAttachments(draft.attachments)
    if (draft.submission !== null) {
      const submission = draft.submission
      if (!isPlainRecord(submission) || typeof submission.submissionId !== 'string' || !submission.submissionId) {
        throw new ControlError(ControlErrorCode.CORRUPT_RECORD, `草稿 ${sessionId} 的本地提交无效`)
      }
      if (submission.runtimeQueued !== false || submission.origin !== 'local-unsubmitted') {
        throw new ControlError(ControlErrorCode.CORRUPT_RECORD, `草稿 ${sessionId} 伪造了运行时队列状态`)
      }
      if (!['sending', 'local-queued', 'accepted', 'failed'].includes(submission.state)) {
        throw new ControlError(ControlErrorCode.CORRUPT_RECORD, `草稿 ${sessionId} 的提交状态无效`)
      }
      if (typeof submission.runtimeAccepted !== 'boolean'
        || submission.runtimeAccepted !== (submission.state === 'accepted')
        || !Number.isSafeInteger(submission.draftRevision)
        || submission.draftRevision < 0
        || !isPlainRecord(submission.snapshot)
        || typeof submission.snapshot.body !== 'string') {
        throw new ControlError(ControlErrorCode.CORRUPT_RECORD, `草稿 ${sessionId} 的提交快照或接收状态无效`)
      }
      assertAttachments(submission.snapshot.attachments)
    }
  }
  return state
}
