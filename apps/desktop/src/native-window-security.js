import { randomBytes } from 'node:crypto'

const TICKET_BYTES = 32
const DEFAULT_TTL_MS = 30_000
const MAX_TICKETS = 128

function denied(code = 'PERMISSION_DENIED') {
  const error = new Error('Native window access denied')
  error.code = code
  return error
}

function normalizeUrl(raw) {
  if (typeof raw !== 'string') return null
  try {
    const url = new URL(raw)
    url.hash = ''
    return url.href
  } catch {
    return null
  }
}

/**
 * One-shot tickets bind a native content frame to its BrowserWindow owner.
 * Tickets are delivered out-of-band after did-finish-load and never appear in
 * a URL, DOM attribute, localStorage, or the renderer-visible bridge.
 */
export function createNativeWindowTicketBroker({
  now = Date.now,
  ttlMs = DEFAULT_TTL_MS,
  contentUrl,
} = {}) {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 120_000) throw new Error('invalid ticket ttl')
  const trustedContentUrl = normalizeUrl(contentUrl)
  if (!trustedContentUrl) throw new Error('invalid native content URL')
  const records = new Map()
  const claimed = new Map()

  const validFrame = (event, contentsId) => Boolean(
    event?.sender
    && event.sender.id === contentsId
    && event.senderFrame === event.sender.mainFrame
    && normalizeUrl(event.senderFrame.url) === trustedContentUrl
  )

  const sweep = () => {
    const time = now()
    for (const [key, record] of records) {
      if (record.expiresAt <= time || record.used) records.delete(key)
    }
  }

  return {
    issue(windowId, contentsId) {
      if (!Number.isSafeInteger(contentsId) || contentsId <= 0) throw denied('INVALID_CONTENTS')
      if (typeof windowId !== 'string' || !windowId || windowId.length > 128) throw denied('INVALID_WINDOW')
      sweep()
      for (const [key, record] of records) {
        if (record.contentsId === contentsId) records.delete(key)
      }
      claimed.delete(contentsId)
      if (records.size >= MAX_TICKETS) throw denied('TICKET_LIMIT')
      const ticket = randomBytes(TICKET_BYTES).toString('base64url')
      records.set(ticket, {
        ticket,
        windowId,
        contentsId,
        expiresAt: now() + ttlMs,
        used: false,
      })
      return ticket
    },

    consume(event, windowId, ticket) {
      sweep()
      const record = typeof ticket === 'string' ? records.get(ticket) : undefined
      if (!record || record.used || record.windowId !== windowId || !validFrame(event, record.contentsId)) {
        throw denied('INVALID_TICKET')
      }
      record.used = true
      records.delete(ticket)
      claimed.set(event.sender.id, { windowId, contentsId: event.sender.id })
      return { windowId, contentsId: event.sender.id }
    },

    requireClaimed(event, windowId) {
      const claim = claimed.get(event?.sender?.id)
      if (!claim || claim.windowId !== windowId || !validFrame(event, claim.contentsId)) {
        throw denied('UNCLAIMED_CONTENT')
      }
      return claim
    },

    revokeWindow(windowId) {
      for (const [ticket, record] of records) {
        if (record.windowId === windowId) records.delete(ticket)
      }
      for (const [contentsId, claim] of claimed) {
        if (claim.windowId === windowId) claimed.delete(contentsId)
      }
    },

    pendingCount: () => records.size,
    claimedCount: () => claimed.size,
  }
}
