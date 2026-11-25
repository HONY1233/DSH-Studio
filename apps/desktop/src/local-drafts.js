import { cloneJson, isPlainRecord, stableStringify } from '@dsh-studio/workbench-core'

const SCHEMA_VERSION = 1
const REQUEST_LIMIT = 2048

function failure(code, message, details = {}) {
  const error = new Error(message)
  error.code = code
  error.details = details
  return error
}

function keyOf(sessionId, draftId) {
  return stableStringify([sessionId, draftId])
}

function emptyState() {
  return { schemaVersion: SCHEMA_VERSION, drafts: {}, requests: {} }
}

function validReceipt(receipt, sessionId, draftId) {
  return isPlainRecord(receipt) && receipt.sessionId === sessionId && receipt.draftId === draftId
    && Number.isSafeInteger(receipt.revision) && receipt.revision >= 1
    && typeof receipt.savedAt === 'string' && receipt.savedAt.length > 0
    && Array.isArray(receipt.contentBlocks) && receipt.source === 'local'
    && receipt.durability === 'local-disk' && receipt.runtimeAccepted === false && receipt.runtimeQueued === false
}

function restore(serialized) {
  if (serialized == null) return emptyState()
  let state
  try {
    state = JSON.parse(serialized)
  } catch {
    throw failure('CORRUPT_RECORD', '本地草稿文件不是合法 JSON')
  }
  if (!state || state.schemaVersion !== SCHEMA_VERSION
    || !state.drafts || typeof state.drafts !== 'object' || Array.isArray(state.drafts)
    || !state.requests || typeof state.requests !== 'object' || Array.isArray(state.requests)) {
    throw failure('CORRUPT_RECORD', '本地草稿文件格式或版本不受支持')
  }
  for (const [key, draft] of Object.entries(state.drafts)) {
    if (!isPlainRecord(draft) || draft.key !== key || typeof draft.sessionId !== 'string' || !draft.sessionId
      || typeof draft.draftId !== 'string' || !draft.draftId || key !== keyOf(draft.sessionId, draft.draftId)
      || !Number.isSafeInteger(draft.revision) || draft.revision < 0 || !Array.isArray(draft.contentBlocks)
      || (draft.savedAt !== null && (typeof draft.savedAt !== 'string' || !draft.savedAt))) {
      throw failure('CORRUPT_RECORD', '本地草稿记录损坏')
    }
  }
  for (const [requestKey, request] of Object.entries(state.requests)) {
    let identity
    try { identity = JSON.parse(requestKey) } catch { throw failure('CORRUPT_RECORD', '本地草稿请求标识损坏') }
    if (!Array.isArray(identity) || identity.length !== 2 || typeof identity[0] !== 'string' || !identity[0]
      || typeof identity[1] !== 'string' || !identity[1] || identity[1].length > 256
      || requestKey !== stableStringify(identity) || !isPlainRecord(request)
      || typeof request.key !== 'string' || typeof request.fingerprint !== 'string' || !request.fingerprint
      || request.key !== keyOf(identity[0], request.receipt?.draftId)
      || !validReceipt(request.receipt, identity[0], request.receipt?.draftId)) {
      throw failure('CORRUPT_RECORD', '本地草稿请求日志损坏')
    }
  }
  return cloneJson(state)
}

/**
 * Persistent local draft fallback. It never claims Runtime admission or queueing.
 * The injected store owns disk IO; mutations are serialized and CAS is checked
 * against the latest persisted snapshot, not a stale in-memory copy.
 */
export function createLocalDraftStore({ store }) {
  if (!store || typeof store.load !== 'function' || typeof store.save !== 'function') {
    throw failure('INVALID_ARGUMENT', 'local draft store requires load/save')
  }
  let state = null
  let tail = Promise.resolve()

  async function loaded() {
    if (state === null) state = restore(await store.load())
    return state
  }

  function enqueue(action) {
    const result = tail.then(action, action)
    tail = result.catch(() => {})
    return result
  }

  async function commit(next) {
    await store.save(JSON.stringify(next))
    state = next
  }

  function receipt(draft) {
    return {
      sessionId: draft.sessionId,
      draftId: draft.draftId,
      revision: draft.revision,
      contentBlocks: cloneJson(draft.contentBlocks),
      savedAt: draft.savedAt,
      source: 'local',
      durability: 'local-disk',
      runtimeAccepted: false,
      runtimeQueued: false,
    }
  }

  return {
    async get(sessionId, draftId) {
      if (typeof sessionId !== 'string' || !sessionId || typeof draftId !== 'string' || !draftId) {
        throw failure('INVALID_ARGUMENT', 'sessionId and draftId are required')
      }
      return enqueue(async () => {
        const current = await loaded()
        const draft = current.drafts[keyOf(sessionId, draftId)]
        return draft ? receipt(draft) : {
          sessionId, draftId, revision: 0, contentBlocks: [], savedAt: null,
          source: 'local', durability: 'local-disk', runtimeAccepted: false, runtimeQueued: false,
        }
      })
    },

    async put(sessionId, draftId, requestId, expectedRevision, contentBlocks, savedAt = new Date().toISOString()) {
      if (typeof sessionId !== 'string' || !sessionId || typeof draftId !== 'string' || !draftId
        || typeof requestId !== 'string' || !requestId || requestId.length > 256
        || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !Array.isArray(contentBlocks)
        || typeof savedAt !== 'string' || !savedAt) {
        throw failure('INVALID_ARGUMENT', 'invalid local draft write')
      }
      const blocks = cloneJson(contentBlocks)
      const fingerprint = stableStringify({ expectedRevision, contentBlocks: blocks })
      return enqueue(async () => {
        const current = await loaded()
        const key = keyOf(sessionId, draftId)
        const requestKey = stableStringify([sessionId, requestId])
        const previous = current.requests[requestKey]
        if (previous) {
          if (previous.key !== key || previous.fingerprint !== fingerprint) {
            throw failure('CONFLICT', 'requestId 已用于不同的本地草稿写入', { requestId })
          }
          return cloneJson(previous.receipt)
        }
        const draft = current.drafts[key]
        const revision = draft?.revision ?? 0
        if (revision !== expectedRevision) {
          throw failure('CONFLICT', '本地草稿 revision 已变化，拒绝覆盖', {
            expectedRevision, currentRevision: revision,
          })
        }
        const nextDraft = {
          key, sessionId, draftId, revision: revision + 1, contentBlocks: blocks, savedAt,
        }
        const next = cloneJson(current)
        next.drafts[key] = nextDraft
        next.requests[requestKey] = { key, fingerprint, receipt: receipt(nextDraft) }
        while (Object.keys(next.requests).length > REQUEST_LIMIT) delete next.requests[Object.keys(next.requests)[0]]
        await commit(next)
        return receipt(nextDraft)
      })
    },
  }
}
