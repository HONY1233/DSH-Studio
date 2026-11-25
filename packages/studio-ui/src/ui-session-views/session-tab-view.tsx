/**
 * 会话 tab 的容器 —— 工作台里每一格对话正文都长这样。
 *
 * 职责只有四件：
 * 1) 从 `TabRef` 认出会话 id（不认识的 kind 直接给出墓碑，不静默渲染空）；
 * 2) 用 `useSessionLease` 持有这一代；
 * 3) 加载中 / 打开失败 各有明确落地面，**不白屏**；
 * 4) 通过 `wrap` 把会话作用域子树套上去（真机传 `<SessionProvider reference>`）。
 *
 * 为什么不在这里直接 import dsh 的 `SessionProvider`：
 * 那会让本事依赖具体会话包，单测要拉起整条 Remote 链路。
 * `wrap` 是唯一注入点，默认恒等 —— 也就是"没有会话作用域也能渲染"。
 */

import type { ReactNode } from 'react'

import type { Tab, TabRef } from '../workbench/index.js'

import type { SessionBinding, SessionSource } from './port.js'
import { useSessionLease } from './use-session-lease.js'

export interface SessionTabViewLabels {
  readonly opening: string
  readonly failed: string
  readonly missing: string
}

export interface SessionTabViewContext {
  readonly active: boolean
  readonly sessionId: string
}

export interface SessionTabViewProps {
  readonly tab: Tab
  /** 是否当前可见。keepAlive 的隐藏 tab 拿到 false 但仍然持有引用。 */
  readonly active: boolean
  readonly source?: SessionSource
  /**
   * 会话作用域注入点。真机：
   * ```tsx
   * wrap={(node, binding) => (
   *   <SessionProvider reference={binding.session as Session} scope={binding.scope}>
   *     {node}
   *   </SessionProvider>
   * )}
   * ```
   */
  readonly wrap?: (node: ReactNode, binding: SessionBinding, ctx: SessionTabViewContext) => ReactNode
  readonly labels: SessionTabViewLabels
  readonly children: (binding: SessionBinding, ctx: SessionTabViewContext) => ReactNode
}

/** 会话 tab 的身份：`contentId` 是 session id，`instanceId` 带前缀防止与面板冲突。 */
export function conversationRef(sessionId: string): TabRef {
  return { kind: 'conversation', contentId: sessionId, instanceId: `session:${sessionId}` }
}

/** 从任意 TabRef 取会话 id；不是会话就返回 undefined。 */
export function sessionIdOf(ref: TabRef): string | undefined {
  return ref.kind === 'conversation' ? ref.contentId : undefined
}

export function SessionTabView(props: SessionTabViewProps): ReactNode {
  const { tab, active, labels } = props
  const sessionId = sessionIdOf(tab.ref)
  const { status, binding, error } = useSessionLease(sessionId, {
    source: props.source ?? 'workbench:pane',
  })

  if (!sessionId) {
    return <Tombstone status="missing" title={labels.missing} sessionId={tab.ref.instanceId} />
  }

  if (status === 'idle' || status === 'opening') {
    return (
      <div
        data-testid="session-tab-skeleton"
        data-session-id={sessionId}
        aria-busy="true"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          fontSize: 12,
          color: 'var(--color-text-tertiary)',
        }}
      >
        {labels.opening}
      </div>
    )
  }

  if (status === 'error') {
    return <Tombstone status="error" title={labels.failed} detail={error} sessionId={sessionId} />
  }

  // status === 'ready' 时 binding 必然存在；类型上仍兜一层，不写非空断言。
  if (!binding) {
    return <Tombstone status="error" title={labels.failed} sessionId={sessionId} />
  }

  const ctx: SessionTabViewContext = { active, sessionId }
  const body = props.children(binding, ctx)
  const content = props.wrap ? props.wrap(body, binding, ctx) : body

  return (
    <div
      data-testid="session-tab-view"
      data-session-id={sessionId}
      data-status={status}
      data-active={active ? 'true' : 'false'}
      style={{ height: '100%', minHeight: 0, display: 'contents' }}
    >
      {content}
    </div>
  )
}

function Tombstone(props: {
  readonly status: 'missing' | 'error'
  readonly title: string
  readonly detail?: string
  readonly sessionId: string
}): ReactNode {
  const isError = props.status === 'error'
  return (
    <div
      data-testid="session-tab-tombstone"
      data-status={props.status}
      data-session-id={props.sessionId}
      {...(isError ? { role: 'alert' as const } : {})}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        height: '100%',
        padding: 16,
        textAlign: 'center',
        color: isError ? 'var(--color-text-danger, #c0392b)' : 'var(--color-text-tertiary)',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 500 }}>{props.title}</div>
      {props.detail && (
        <div style={{ fontSize: 11, maxWidth: 420, wordBreak: 'break-word', opacity: 0.85 }}>
          {props.detail}
        </div>
      )}
      <code style={{ fontSize: 10, opacity: 0.6 }}>{props.sessionId}</code>
    </div>
  )
}
