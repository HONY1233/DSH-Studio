/**
 * 主区空态 —— 关掉最后一个对话视图后的落地页。
 *
 * 铁律：**不自动新建会话**。空出主区是合法状态，
 * 自动 `session.create` 会把"关掉最后一个窗口"变成意外开新会话。
 */

import type { ReactNode } from 'react'

export interface BackdropLabels {
  readonly title: string
  readonly hint: string
  readonly newConversation: string
  readonly openPanel: string
  readonly recent: string
}

export interface BackdropProps {
  readonly labels: BackdropLabels
  readonly recent?: readonly { readonly id: string; readonly title: string }[]
  readonly onNewConversation: () => void
  readonly onOpenPanel: () => void
  readonly onOpenRecent?: (id: string) => void
}

export function WorkspaceBackdrop(props: BackdropProps): ReactNode {
  const { labels, recent = [], onNewConversation, onOpenPanel, onOpenRecent } = props

  return (
    <div
      data-testid="workspace-backdrop"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        height: '100%',
        minHeight: 0,
        padding: 24,
        color: 'var(--color-text-secondary)',
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--color-text-primary)' }}>{labels.title}</div>
      <div style={{ fontSize: 12 }}>{labels.hint}</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button type="button" onClick={onNewConversation} style={primaryButton}>
          {labels.newConversation}
        </button>
        <button type="button" onClick={onOpenPanel} style={secondaryButton}>
          {labels.openPanel}
        </button>
      </div>
      {recent.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{labels.recent}</div>
          {recent.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onOpenRecent?.(item.id)}
              style={{ ...secondaryButton, border: 'none', padding: '2px 8px', fontSize: 12 }}
            >
              {item.title}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const primaryButton = {
  border: '0.5px solid var(--color-border-secondary)',
  background: 'var(--color-background-primary)',
  color: 'var(--color-text-primary)',
  borderRadius: 8,
  padding: '5px 12px',
  fontSize: 12,
  cursor: 'pointer',
} as const

const secondaryButton = {
  ...primaryButton,
  color: 'var(--color-text-secondary)',
} as const
