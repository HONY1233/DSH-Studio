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

import { useCallback, useLayoutEffect, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'

import type { DerivedCache, DerivedHandle } from '../session-derived/cache.js'
import { CONVERSATION_MODEL, type ConversationState } from '../session-derived/conversation.js'
import { ConversationBody, defaultConversationLabels, type ConversationBodyLabels } from './conversation-body.js'
import { Composer, defaultComposerLabels, type ComposerLabels } from './composer.js'
import type { SessionEventHub } from './event-hub.js'

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

export function SessionPane(props: SessionPaneProps): ReactNode {
  const streaming = useStreaming(props.cache, props.sessionId)
  return (
    <div style={column} data-testid="session-pane" data-session-id={props.sessionId}>
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
        uploader={props.uploader}
        streaming={streaming}
        labels={props.composerLabels ?? defaultComposerLabels}
      />
    </div>
  )
}
