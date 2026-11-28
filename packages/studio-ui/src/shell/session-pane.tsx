/**
 * 一个会话标签的完整正文区域：消息列表 + 输入框。
 *
 * 为什么要单独一层：`SessionTabView` 的容器是 `display: contents`（为了让会话
 * 作用域子树直接参与外层布局），所以"正文撑满 + 输入框贴底"这个 flex 结构
 * 必须由我们自己给出来，不能指望 `SessionTabView` 提供。
 *
 * 它还负责把**"这一轮是否在生成"**告诉输入框。判据来自自己折叠的事件状态
 * （`turn/start` → `turn/end`），**不用 `snapshot.running`** —— 真机实测那个
 * 布尔值在 turn 开始 50ms 后就不再更新，而 turn 还在继续输出（详见 README）。
 */

import { useCallback, useLayoutEffect, useMemo, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'

import type { DerivedCache, DerivedHandle } from '../session-derived/cache.js'
import { CONVERSATION_MODEL, type ConversationState } from '../session-derived/conversation.js'
import { SessionApprovalBar } from './approval-bar.js'
import { ConversationBody, defaultConversationLabels, type ConversationBodyLabels } from './conversation-body.js'
import { Composer, defaultComposerLabels, type ComposerLabels } from './composer.js'
import type { EventContinuity, SessionEventHub } from './event-hub.js'
import { useOwnerSessionView } from '../ui-session-views/use-session-view.js'
import { SessionToolsetBar } from './toolset-bar.js'

const column: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
  minWidth: 0,
}

/**
 * 这一轮是否在生成 —— 读自己折叠出来的 `streaming`。
 *
 * `getSnapshot` 只返回原始布尔值：折叠结果对象在内容变化时才换，但
 * `streaming` 是个稳定的原始值，能省掉一次对象身份比较。
 */
function useStreaming(cache: DerivedCache, sessionId: string): boolean {
  const [handle, setHandle] = useState<DerivedHandle<ConversationState> | undefined>(undefined)

  useLayoutEffect(() => {
    const next = cache.acquire(sessionId, CONVERSATION_MODEL)
    setHandle(next)
    return () => {
      next.release()
      setHandle(undefined)
    }
  }, [cache, sessionId])

  const subscribe = useCallback((listener: () => void) => cache.subscribe(listener), [cache])
  const getSnapshot = useCallback(() => handle?.state().value.streaming === true, [handle])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export interface SessionPaneProps {
  readonly sessionId: string
  readonly active: boolean
  readonly cache: DerivedCache
  readonly hub: SessionEventHub
  /** 会话作用域里的原件（`binding.session`），交给 Composer 取 `prompt`。 */
  readonly session?: unknown
  /** `ctx.fileUpload`（软依赖）：拿不到时输入框的附件入口禁用。 */
  readonly uploader?: unknown
  readonly eventSource?: unknown
  readonly conversationLabels?: ConversationBodyLabels
  readonly composerLabels?: ComposerLabels
}

const CONTINUITY_LABELS: Readonly<Record<EventContinuity, string>> = {
  unknown: '连接：未知',
  complete: '连接：完整',
  gap: '连接：事件缺口',
  conflict: '连接：事件冲突',
  'buffer-overflow': '连接：缓冲溢出',
}

/** 断线重连可见性：直接读 hub 的连续性判定，不在视图里猜。 */
function useContinuity(hub: SessionEventHub, sessionId: string): EventContinuity {
  const subscribe = useCallback((listener: () => void) => hub.subscribeWindow(listener), [hub])
  const getSnapshot = useCallback(() => hub.continuityOf(sessionId), [hub, sessionId])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function SessionPane(props: SessionPaneProps): ReactNode {
  const streaming = useStreaming(props.cache, props.sessionId)
  const continuity = useContinuity(props.hub, props.sessionId)
  const owner = useMemo(() => ({ kind: 'session' as const, id: props.sessionId }), [props.sessionId])
  const { store, projection, dispatchDraft } = useOwnerSessionView(owner)
  const pendingApprovals = projection?.approvals.filter((item) => item.status === 'pending').length ?? 0
  const outputTokens = projection?.usage?.totals.outputTokens
  return (
    <div style={column} data-testid="session-pane" data-session-id={props.sessionId}>
      {store && (
        <div data-testid="session-owner-status" style={{ display: 'flex', gap: 12, padding: '4px 10px', fontSize: 10, color: 'var(--color-text-tertiary, #8a8a85)' }}>
          <span data-testid="session-owner-approvals">待审批 {pendingApprovals}</span>
          <span data-testid="session-owner-usage">输出 token {outputTokens ?? '—'}</span>
          <span data-testid="session-owner-tools">工具 {projection?.tools.instances.length ?? 0}</span>
          <span
            data-testid="session-continuity"
            data-state={continuity}
            style={continuity === 'complete' || continuity === 'unknown'
              ? undefined
              : { color: 'var(--color-text-danger, #c0392b)' }}
          >
            {CONTINUITY_LABELS[continuity]}
          </span>
        </div>
      )}
      <SessionApprovalBar
        sessionId={props.sessionId}
        store={store}
        approvals={projection?.approvals ?? []}
        active={props.active}
      />
      <SessionToolsetBar sessionId={props.sessionId} />
      <ConversationBody
        sessionId={props.sessionId}
        active={props.active}
        cache={props.cache}
        hub={props.hub}
        eventSource={props.eventSource}
        session={props.session}
        labels={props.conversationLabels ?? defaultConversationLabels}
      />
      <Composer
        session={props.session}
        sessionId={props.sessionId}
        draft={store ? projection?.draft ?? null : undefined}
        draftOwner={owner}
        dispatchDraft={store ? dispatchDraft : undefined}
        uploader={props.uploader}
        streaming={streaming}
        labels={props.composerLabels ?? defaultComposerLabels}
      />
    </div>
  )
}
