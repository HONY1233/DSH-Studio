/**
 * 独占工具跨会话移动的确认框（X4.4 / XC-17）。
 *
 * 只有两个业务选项，且都不带默认值：
 *   「移动并改归属」/「创建新实例」
 *
 * 另外给一个明确的取消入口（不复制）。Esc、点击遮罩都等于取消，
 * 绝不会替用户选 move/new；初始焦点也落在取消上。
 */

import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react'

import type { ExclusiveTransferPrompt, ToolTransferDecision } from './exclusive-transfer.js'

export interface ExclusiveTransferDialogLabels {
  readonly title: string
  readonly body: (toolId: string, from: string, to: string) => string
  readonly move: string
  readonly create: string
  readonly cancel: string
  readonly note: string
}

export const defaultExclusiveTransferLabels: ExclusiveTransferDialogLabels = {
  title: '移动独占工具',
  body: (toolId, from, to) =>
    `「${toolId}」正在会话 ${from} 中运行，不能直接共享给会话 ${to}。请选择移动归属，或在新会话创建独立实例。`,
  move: '移动并改归属',
  create: '创建新实例',
  cancel: '取消（不复制）',
  note: '默认不会复制 PTY、浏览器登录空间或任何运行中的连接。',
}

export interface ExclusiveTransferDialogProps {
  readonly prompt: ExclusiveTransferPrompt
  readonly onDecision: (decision: Exclude<ToolTransferDecision, 'cancel'>) => void
  readonly onCancel: () => void
  readonly labels?: ExclusiveTransferDialogLabels
}

const overlay: CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 40,
  display: 'grid',
  placeItems: 'center',
  background: 'rgba(0, 0, 0, .28)',
}

const panel: CSSProperties = {
  width: 'min(440px, calc(100% - 32px))',
  padding: '16px 18px',
  borderRadius: 10,
  border: '1px solid var(--color-border-secondary, rgba(0,0,0,.12))',
  background: 'var(--color-bg-elevated, #fff)',
  boxShadow: '0 12px 40px rgba(0, 0, 0, .22)',
  color: 'var(--color-text-primary, #2c2c2a)',
  fontSize: 12,
  lineHeight: 1.65,
}

const actions: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  justifyContent: 'flex-end',
  marginTop: 14,
}

const button: CSSProperties = {
  padding: '5px 12px',
  borderRadius: 6,
  border: '1px solid var(--color-border-secondary, rgba(0,0,0,.16))',
  background: 'transparent',
  color: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
}

export function ExclusiveTransferDialog(props: ExclusiveTransferDialogProps): ReactNode {
  const labels = props.labels ?? defaultExclusiveTransferLabels
  const titleId = useId()
  const descriptionId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)

  // 默认焦点在取消上：回车不会误触“移动”或“新建”。
  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        props.onCancel()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [props])

  const { source, target } = props.prompt
  return (
    <div
      style={overlay}
      data-testid="exclusive-transfer-overlay"
      onPointerDown={(event) => {
        // 点击遮罩 = 取消，绝不隐式选择任一业务选项。
        if (event.target === event.currentTarget) props.onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-testid="exclusive-transfer"
        data-tool-id={source.toolId}
        data-from-session={source.sessionId}
        data-to-session={target.sessionId}
        style={panel}
      >
        <div id={titleId} style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
          {labels.title}
        </div>
        <div id={descriptionId}>
          {labels.body(source.toolId, source.sessionId.slice(-8), target.sessionId.slice(-8))}
        </div>
        <div style={{ marginTop: 8, color: 'var(--color-text-tertiary, #8a8a85)', fontSize: 11 }}>
          {labels.note}
        </div>
        <div style={actions}>
          <button ref={cancelRef} type="button" style={button} onClick={() => props.onCancel()}>
            {labels.cancel}
          </button>
          <button type="button" style={button} onClick={() => props.onDecision('new')}>
            {labels.create}
          </button>
          <button type="button" style={button} onClick={() => props.onDecision('move')}>
            {labels.move}
          </button>
        </div>
      </div>
    </div>
  )
}