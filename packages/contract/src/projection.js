/**
 * Pure projection from DSH session events to the renderer's read model.
 *
 * The renderer never sees raw wire frames: it folds `session.event` payloads
 * through {@link projectSessionEvent}. Keeping this pure makes the whole
 * conversation view replayable from recorded fixtures in tests.
 */

/**
 * @typedef {object} MessageItem
 * @property {'message'} kind
 * @property {string} id
 * @property {'user' | 'assistant'} role
 * @property {string} text
 *
 * @typedef {object} ToolItem
 * @property {'tool'} kind
 * @property {string} callId
 * @property {string} name
 * @property {string} args
 * @property {'pending' | 'done' | 'error'} status
 * @property {string} [result]
 *
 * @typedef {object} NoticeItem
 * @property {'notice'} kind
 * @property {'info' | 'warn' | 'error'} level
 * @property {string} text
 * @property {string} [code]
 */

/** Empty conversation view for one session. */
export function createSessionView(sessionId = null) {
  return {
    sessionId,
    title: null,
    status: 'idle',
    /** @type {{ number: number, step: number, ended: unknown } | null} */
    turn: null,
    /** @type {(MessageItem | ToolItem | NoticeItem)[]} */
    items: [],
    usage: null,
  }
}

/** Concatenate the human-visible text of model content blocks. */
export function textOfContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return ''
      if (block.type === 'text') return block.text ?? ''
      if (block.type === 'reasoning') return ''
      if (block.type === 'image') return '[image]'
      return `[${block.type}]`
    })
    .join('')
}

/** Human-readable one-liner for a `turn/end` reason. */
export function describeTurnEnd(reason) {
  if (!reason || typeof reason !== 'object') return null
  switch (reason.kind) {
    case 'completed':
      return null
    case 'error':
      return { level: 'error', text: reason.error?.message ?? 'turn failed', code: reason.error?.code }
    case 'aborted':
      return { level: 'warn', text: `已取消（${reason.reason?.kind ?? 'unknown'}）` }
    case 'blocked':
      return { level: 'warn', text: '本轮被阻断' }
    case 'max-tokens':
      return { level: 'warn', text: '达到输出上限' }
    case 'interrupted':
      return { level: 'warn', text: '上一轮被中断（进程重启）' }
    case 'forked':
      return { level: 'info', text: '派生边界：轮次在此闭合' }
    default:
      return { level: 'info', text: `turn/end: ${JSON.stringify(reason)}` }
  }
}

/**
 * Fold one `session.event` into the view. Returns a new view; the input is not
 * mutated, so callers can diff or replay freely.
 */
export function projectSessionEvent(view, event) {
  const next = { ...view, items: [...view.items], turn: view.turn ? { ...view.turn } : null }
  const data = event?.data ?? {}

  switch (event?.type) {
    case 'turn/start':
      next.turn = { number: data.turn, step: 0, ended: null }
      next.status = 'running'
      break

    case 'step/start':
      if (next.turn) next.turn.step = data.step
      break

    case 'user/message':
      if (data.source?.kind !== 'user') break
      next.items.push({ kind: 'message', id: data.id, role: 'user', text: textOfContent(data.content) })
      break

    case 'assistant/message': {
      const text = textOfContent(data.message?.content)
      if (text) next.items.push({ kind: 'message', id: data.message?.id, role: 'assistant', text })
      if (data.usage) next.usage = data.usage
      break
    }

    case 'tool/call':
      next.items.push({
        kind: 'tool',
        callId: data.callId,
        name: data.name,
        args: data.arguments ?? '',
        status: 'pending',
      })
      break

    case 'tool/result': {
      const callId = data.message?.toolCallId
      const index = findToolIndex(next.items, callId)
      if (index < 0) break
      const tool = { ...next.items[index] }
      tool.status = data.message?.isError ? 'error' : 'done'
      tool.result = textOfContent(data.message?.content).slice(0, 4000)
      if (data.error?.reason) tool.result = `${tool.result}\n${data.error.reason}`.trim()
      next.items[index] = tool
      break
    }

    case 'turn/end': {
      if (next.turn) next.turn.ended = data.reason
      next.status = 'idle'
      const notice = describeTurnEnd(data.reason)
      if (notice) next.items.push({ kind: 'notice', level: notice.level, text: notice.text, code: notice.code })
      break
    }

    case 'session/title':
      next.title = data.title ?? data.text ?? next.title
      break

    default:
      break
  }

  return next
}

/** Apply a `session.status` notification. */
export function applySessionStatus(view, status) {
  return { ...view, status }
}

/** Echo a locally typed line (native commands produce no `user/message` event). */
export function appendUserMessage(view, text) {
  return {
    ...view,
    items: [...view.items, { kind: 'message', id: `local-${view.items.length}`, role: 'user', text }],
  }
}

/** Append a standalone notice, e.g. a native command's result text. */
export function appendNotice(view, { level = 'info', text, code } = {}) {
  if (!text) return view
  return { ...view, items: [...view.items, { kind: 'notice', level, text, code }] }
}

function findToolIndex(items, callId) {
  if (callId) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index]
      if (item.kind === 'tool' && item.callId === callId) return index
    }
  }
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item.kind === 'tool' && item.status === 'pending') return index
  }
  return -1
}
