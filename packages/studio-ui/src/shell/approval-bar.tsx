/**
 * 会话级审批卡片（X4.5）。
 *
 * Host 是审批的唯一真相：这里只做三件事 —— 订阅本会话的
 * `interaction.required/resolved`、打开时用 `interaction.list` 补回已经挂起的
 * 审批、以及把用户的明确决定发成 `interaction.respond`。
 *
 * **绝不替用户默认允许**：没有点击就不发命令；`decision` 与 `value` 都由按钮
 * 显式给出。桥接层仍会校验上下文归属与 `leaseGeneration`。
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import type { ApprovalSummary, SessionViewStore } from '../ui-session-views/session-view-store.js'

interface QueryResponse {
  readonly ok?: boolean
  readonly result?: unknown
  readonly error?: { readonly code?: string; readonly message?: string }
}

interface CommandReceipt {
  readonly requestId: string
  readonly status: string
  readonly error?: { readonly code?: string; readonly message?: string }
}

interface ApprovalBridge {
  openContext(scope: { readonly sessionId: string }): Promise<string>
  close(contextId: string): Promise<void>
  query(request: { readonly queryName: string; readonly input: unknown }, contextId?: string): Promise<QueryResponse>
  command(request: {
    readonly requestId: string
    readonly commandName: string
    readonly input: unknown
  }, contextId?: string): Promise<unknown>
  subscribe(
    scope: Record<string, never>,
    listener: (event: {
      readonly kind?: string
      readonly interaction?: ApprovalSummary
      readonly interactionId?: string
      readonly leaseGeneration?: number
      readonly outcome?: 'submitted' | 'cancelled'
      readonly receipt?: CommandReceipt
    }) => void,
    contextId?: string,
  ): () => void
}

function bridgeOf(): ApprovalBridge | undefined {
  const candidate = (globalThis as { dshStudio?: Partial<ApprovalBridge> }).dshStudio
  if (!candidate
    || typeof candidate.openContext !== 'function'
    || typeof candidate.close !== 'function'
    || typeof candidate.query !== 'function'
    || typeof candidate.command !== 'function'
    || typeof candidate.subscribe !== 'function') {
    return undefined
  }
  return candidate as ApprovalBridge
}

const bar: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '6px 10px',
  borderBottom: '1px solid var(--color-border-tertiary, rgba(0,0,0,.06))',
  background: 'var(--color-background-secondary, #fff)',
  fontSize: 11,
}

const card: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
  padding: '4px 8px',
  borderRadius: 6,
  border: '1px solid var(--color-border-secondary, rgba(0,0,0,.12))',
  background: 'var(--color-background-primary, #faf9f5)',
}

const button: CSSProperties = {
  padding: '1px 8px',
  borderRadius: 4,
  border: '1px solid var(--color-border-secondary, rgba(0,0,0,.12))',
  background: 'var(--color-background-secondary, #fff)',
  cursor: 'pointer',
  fontSize: 11,
  fontFamily: 'inherit',
}

const detailStyle: CSSProperties = {
  color: 'var(--color-text-tertiary, #8a8a85)',
  fontSize: 10,
}

function detailText(detail: Readonly<Record<string, unknown>>): string {
  const rows: string[] = []
  for (const key of ['command', 'path', 'reason']) {
    const value = detail[key]
    if (typeof value === 'string' && value.length > 0) rows.push(value)
  }
  return rows.join(' · ')
}

export interface SessionApprovalBarProps {
  readonly sessionId: string
  readonly store: SessionViewStore | null
  readonly approvals: readonly ApprovalSummary[]
  /** 非活动标签只展示，不允许操作：响应权属于当前可见视图。 */
  readonly active: boolean
}

export function SessionApprovalBar(props: SessionApprovalBarProps): ReactNode {
  const { sessionId, store, approvals, active } = props
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const pending = useRef(new Map<string, (receipt: CommandReceipt) => void>())
  const sequence = useRef(0)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  const apiRef = useRef<ApprovalBridge | undefined>(undefined)
  const contextRef = useRef<string | null>(null)
  const storeRef = useRef(store)
  storeRef.current = store

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    const api = bridgeOf()
    apiRef.current = api
    if (!api || !store) return undefined

    let cancelled = false
    let contextId: string | null = null
    let unsubscribe: (() => void) | undefined
    setError(null)
    const pendingHere = pending.current

    api.openContext({ sessionId }).then(async (opened) => {
      if (cancelled) {
        void api.close(opened)
        return
      }
      contextId = opened
      contextRef.current = opened
      unsubscribe = api.subscribe({}, (event) => {
        if (cancelled) return
        const current = storeRef.current
        if (event.kind === 'command.receipt' && event.receipt) {
          const settle = pendingHere.get(event.receipt.requestId)
          if (settle) {
            pendingHere.delete(event.receipt.requestId)
            settle(event.receipt)
          }
          return
        }
        if (!current) return
        if (event.kind === 'interaction.required' && event.interaction
          && event.interaction.sessionId === sessionId) {
          current.applyInteraction({ kind: 'interaction.required', interaction: event.interaction })
          return
        }
        if (event.kind === 'interaction.resolved'
          && typeof event.interactionId === 'string'
          && typeof event.leaseGeneration === 'number') {
          current.applyInteraction({
            kind: 'interaction.resolved',
            interactionId: event.interactionId,
            leaseGeneration: event.leaseGeneration,
            outcome: event.outcome === 'cancelled' ? 'cancelled' : 'submitted',
          })
        }
      }, opened)

      try {
        const response = await api.query({ queryName: 'interaction.list', input: {} }, opened)
        if (cancelled) return
        if (response?.ok !== true) throw new Error(response?.error?.message ?? '读取待审批失败')
        const rows = (response.result as { approvals?: unknown })?.approvals
        const list = Array.isArray(rows) ? rows as ApprovalSummary[] : []
        storeRef.current?.replaceSessionApprovals(sessionId, list)
      } catch (failure) {
        if (cancelled) return
        setError(failure instanceof Error ? failure.message : String(failure))
      }
    }).catch((failure) => {
      if (cancelled) return
      setError(failure instanceof Error ? failure.message : String(failure))
    })

    return () => {
      cancelled = true
      unsubscribe?.()
      settleAll(pendingHere)
      contextRef.current = null
      if (contextId) void api.close(contextId)
    }
  }, [sessionId, store])

  const respond = useCallback(async (
    interaction: ApprovalSummary,
    decision: 'submit' | 'cancel',
    value?: boolean,
  ): Promise<void> => {
    const api = apiRef.current
    const contextId = contextRef.current
    if (!api || !contextId) {
      setError('Host 上下文尚未就绪')
      return
    }
    const current = storeRef.current
    const key = `${interaction.interactionId}:${decision}:${value ?? ''}`
    if (inFlight.current) return
    inFlight.current = true
    setBusy(key)
    setError(null)
    sequence.current += 1
    const requestId = `studio-approval-${sequence.current}`
    try {
      const receipt = await new Promise<CommandReceipt>((resolve, reject) => {
        pending.current.set(requestId, resolve)
        api.command({
          requestId,
          commandName: 'interaction.respond',
          input: {
            interactionId: interaction.interactionId,
            leaseGeneration: interaction.leaseGeneration,
            decision,
            ...(decision === 'submit' ? { value: value !== false } : {}),
          },
        }, contextId).catch((failure) => {
          pending.current.delete(requestId)
          reject(failure)
        })
      })
      if (!mounted.current) return
      if (receipt.status !== 'completed') {
        throw new Error(receipt.error?.message ?? '审批提交失败')
      }
      // Runtime may settle slightly later; reflect the accepted decision now so
      // the card cannot be clicked twice while the resolved event is in flight.
      current?.applyInteraction({
        kind: 'interaction.resolved',
        interactionId: interaction.interactionId,
        leaseGeneration: interaction.leaseGeneration,
        outcome: decision === 'cancel' ? 'cancelled' : 'submitted',
      })
    } catch (failure) {
      if (!mounted.current) return
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      inFlight.current = false
      if (mounted.current) setBusy(null)
    }
  }, [])

  const rows = approvals.filter((item) => item.status === 'pending')
  if (rows.length === 0 && !error) return null

  return (
    <div style={bar} data-testid="session-approvals" data-active={active ? 'true' : 'false'}>
      {rows.map((item) => {
        const detail = detailText(item.detail)
        const disabled = !active || busy !== null
        return (
          <div key={item.interactionId} style={card} data-interaction-id={item.interactionId}>
            <span>{item.title ?? '需要审批'}</span>
            <span style={detailStyle}>{item.approvalType}</span>
            {detail ? <code style={detailStyle}>{detail}</code> : null}
            <button
              type="button"
              style={{ ...button, opacity: disabled ? 0.5 : 1 }}
              disabled={disabled}
              onClick={() => { void respond(item, 'submit', true) }}
            >
              允许一次
            </button>
            <button
              type="button"
              style={{ ...button, opacity: disabled ? 0.5 : 1 }}
              disabled={disabled}
              onClick={() => { void respond(item, 'submit', false) }}
            >
              拒绝
            </button>
            <button
              type="button"
              style={{ ...button, opacity: disabled ? 0.5 : 1 }}
              disabled={disabled}
              onClick={() => { void respond(item, 'cancel') }}
            >
              取消
            </button>
          </div>
        )
      })}
      {!active && rows.length > 0 ? <span style={detailStyle}>切到该标签后可操作</span> : null}
      {error ? <span role="alert" style={{ color: 'var(--color-text-danger, #c0392b)' }}>{error}</span> : null}
    </div>
  )
}

function settleAll(entries: Map<string, (receipt: CommandReceipt) => void>): void {
  for (const settle of entries.values()) {
    settle({
      requestId: '',
      status: 'failed',
      error: { code: 'CANCELLED', message: '审批视图已卸载' },
    })
  }
  entries.clear()
}