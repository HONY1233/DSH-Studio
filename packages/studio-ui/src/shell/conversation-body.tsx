/**
 * 会话正文 —— 把「事件窗口」折成消息列表并渲染。
 *
 * 结构刻意简单：**不依赖任何 DSH 的 Session scope / provider**。
 * 数据全部来自 `binding.eventSource`（`ObservableSnapshot<SessionEventWindow>`），
 * 所以不需要 `wrap` 注入作用域，也就不受「SessionProvider 到底叫什么、
 * 参数是什么」这个未验证项影响。
 *
 * 两个订阅点，职责分明：
 * 1) `eventSource.subscribe` —— 只在事件窗口变化时触发，负责**喂**派生缓存；
 * 2) `cache.subscribe` —— 只在折叠结果变化时触发，负责**读**渲染。
 *
 * 这层分离让「同一会话两个窗口」天然只折一次：两条订阅都会 ingest，
 * 但派生缓存按 per-slot seq 去重，第二次全是跳过。
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react'

import {
  CONVERSATION_MODEL,
  type ConversationState,
  type MessageAttachment,
} from '../session-derived/conversation.js'
import type { DerivedCache, DerivedHandle } from '../session-derived/cache.js'
import {
  AttachmentImageCache,
  asAttachmentReader,
  useAttachmentImages,
} from './attachment-images.js'
import {
  defaultAttachmentLabels,
  MessageAttachments,
  type AttachmentLabels,
} from './attachment-view.js'
import { type RawSessionEventWindow, type SnapshotLike } from './event-adapter.js'
import type { SessionEventHub } from './event-hub.js'
import type { LightboxItem } from './image-lightbox.js'
import { readLiveStream } from './live-stream.js'
import { defaultToolCallLabels, ToolCallView, type ToolCallLabels } from './tool-call-view.js'

/**
 * 图片字节缓存是模块级单例：同一张图可能同时出现在两个窗口，
 * 缓存必须跨视图共享，否则每开一个窗口就重读一遍字节。
 * 测试可以传 `attachmentImages` 覆盖。
 */
const ATTACHMENT_IMAGES = new AttachmentImageCache()

export interface ConversationBodyLabels {
  readonly empty: string
  readonly streaming: string
  readonly messages: string
  /** 默认收起状态下的一行提示，如「已折叠 3 条系统上下文」。 */
  readonly showSynthetic: (count: number) => string
  readonly collapseSynthetic: (count: number) => string
  /** 向上加载更早的历史。 */
  readonly loadOlder: string
  readonly loadingOlder: string
  readonly loadOlderFailed: string
  /** 流式思考过程。 */
  readonly showReasoning: string
  readonly hideReasoning: string
}

export const defaultConversationLabels: ConversationBodyLabels = {
  empty: '这场对话还没有消息',
  streaming: '正在生成…',
  messages: '消息',
  showSynthetic: (count) => `已折叠 ${count} 条系统上下文`,
  collapseSynthetic: (count) => `收起 ${count} 条系统上下文`,
  loadOlder: '加载更早的消息',
  loadingOlder: '正在加载…',
  loadOlderFailed: '加载失败，点此重试',
  showReasoning: '展开思考过程',
  hideReasoning: '收起思考过程',
}

/**
 * `SessionFace` 里加载历史的那一半。
 *
 * 真实契约（逐字核对 `contract/session.d.ts`）：
 * ```ts
 * loadOlder(options?: { deferConsumption?: boolean }): Promise<void>
 * consumeOlder(): boolean
 * ```
 *
 * `deferConsumption` 是保持滚动位置的关键：先让 Host 把页面准备好但**不发布**，
 * 这时量一次 scrollHeight，再 `consumeOlder()` 同步发布 —— 发布与量高度之间
 * 没有用户可见的中间态，滚动复原才准。
 *
 * 失败不会 reject：契约说"failures and no progress set snapshot.historyLoadStatus
 * to error"，所以调用方要自己看有没有进展。
 */
export interface HistoryLoaderLike {
  loadOlder(options?: { readonly deferConsumption?: boolean }): Promise<void>
  consumeOlder(): boolean
}

export function asHistoryLoader(value: unknown): HistoryLoaderLike | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<HistoryLoaderLike>
  const ok = typeof candidate.loadOlder === 'function' && typeof candidate.consumeOlder === 'function'
  return ok ? (candidate as HistoryLoaderLike) : undefined
}

/** 骨架 / 空态：占满但不写死高度（父级是 flex column）。 */
const centerFill: CSSProperties = {
  flex: '1 1 auto',
  minHeight: 0,
  display: 'grid',
  placeItems: 'center',
  fontSize: 12,
  color: 'var(--color-text-tertiary, #8a8a85)',
}

const palette = {
  user: { bg: 'var(--color-background-secondary, #f4f3ef)', label: '你' },
  assistant: { bg: 'transparent', label: 'DSH' },
  system: { bg: 'transparent', label: '系统' },
  tool: { bg: 'transparent', label: '工具' },
} as const

export interface ConversationBodyProps {
  readonly sessionId: string
  readonly active: boolean
  readonly cache: DerivedCache
  /** 事件订阅的唯一入口（同会话只订一次）。 */
  readonly hub: SessionEventHub
  readonly eventSource?: unknown
  /**
   * 会话作用域里的原件（`binding.session`）。只在渲染附件时需要 ——
   * 图片字节要走它的 `readAttachment`。正文文本本身不依赖它。
   */
  readonly session?: unknown
  readonly labels?: ConversationBodyLabels
  readonly attachmentLabels?: AttachmentLabels
  readonly toolLabels?: ToolCallLabels
  /** 默认用模块级共享缓存；只有测试需要独立的。 */
  readonly attachmentImages?: AttachmentImageCache
}

function asSource(value: unknown): SnapshotLike<RawSessionEventWindow> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<SnapshotLike<RawSessionEventWindow>>
  if (typeof candidate.getSnapshot !== 'function' || typeof candidate.subscribe !== 'function') return undefined
  return candidate as SnapshotLike<RawSessionEventWindow>
}

/** 持有一份派生引用；卸载只减计数，state 留在缓存里（搬家不重折）。 */
function useDerivedHandle(
  cache: DerivedCache,
  sessionId: string,
): { state: ReturnType<DerivedHandle<ConversationState>['state']> | undefined } {
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
  const getSnapshot = useCallback(() => handle?.state(), [handle])
  return { state: useSyncExternalStore(subscribe, getSnapshot, getSnapshot) }
}

export function ConversationBody(props: ConversationBodyProps): ReactNode {
  const labels = props.labels ?? defaultConversationLabels
  const attachmentLabels = props.attachmentLabels ?? defaultAttachmentLabels
  const toolLabels = props.toolLabels ?? defaultToolCallLabels
  const source = asSource(props.eventSource)
  const { sessionId, cache, hub } = props
  const attachmentReader = asAttachmentReader(props.session)
  const attachmentImages = props.attachmentImages ?? ATTACHMENT_IMAGES
  const historyLoader = asHistoryLoader(props.session)

  // 副作用订阅：喂折叠缓存（同会话只订一次）
  useEffect(() => hub.attach(sessionId, source), [hub, sessionId, source])
  const { state } = useDerivedHandle(cache, sessionId)
  const [showSynthetic, setShowSynthetic] = useState(false)
  /** 流式思考过程默认收起：模型先想后答，铺开思考会把答案推下去。 */
  const [showReasoning, setShowReasoning] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [olderError, setOlderError] = useState<string | undefined>(undefined)

  const bodyRef = useRef<HTMLDivElement | null>(null)
  /**
   * 向上加载前的高度锚点。
   *
   * 重折是"整窗 reset 再重来"，内容一下子变长，浏览器的滚动位置会跳。
   * 记录发布前的 `scrollHeight` / `scrollTop`，发布后在 layout effect 里换算回
   * 同一个视觉位置：`新 scrollTop = 新高度 - 旧高度 + 旧 scrollTop`。
   */
  const anchorRef = useRef<{ readonly height: number; readonly top: number } | null>(null)

  // The Hub owns the only source subscription and fans the same window snapshot
  // out to every same-session view for live-stream rendering.
  const subscribeWindow = useCallback(
    (listener: () => void) => hub.subscribeWindow(listener),
    [hub],
  )
  const getWindow = useCallback(() => hub.getWindowSnapshot(sessionId), [hub, sessionId])
  const liveWindow = useSyncExternalStore(subscribeWindow, getWindow, getWindow)
  const live = readLiveStream(liveWindow)

  const messages = state?.value.messages
  const hasMore = liveWindow?.hasMore === true

  const loadOlder = useCallback(async (): Promise<void> => {
    if (!historyLoader || loadingOlder) return
    setLoadingOlder(true)
    setOlderError(undefined)
    const el = bodyRef.current
    try {
      // ① 让 Host 准备好页面但先别发布 —— 这样量高度时视图还没变
      await historyLoader.loadOlder({ deferConsumption: true })
      // ② 记锚点，③ 同步发布；发布触发的重折会在 layout effect 里复原滚动
      if (el) anchorRef.current = { height: el.scrollHeight, top: el.scrollTop }
      const published = historyLoader.consumeOlder()
      if (!published) {
        anchorRef.current = null
        setOlderError(labels.loadOlderFailed)
      }
    } catch (error) {
      anchorRef.current = null
      setOlderError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoadingOlder(false)
    }
  }, [historyLoader, labels.loadOlderFailed, loadingOlder])

  /**
   * 发布后复原滚动位置。
   *
   * 依赖 `messages.length`：prepend 重折会让它变大。没有锚点时什么都不做，
   * 所以正常的实时追加不受影响（那本来就该停在底部）。
   */
  const messageCount = messages?.length ?? 0
  useLayoutEffect(() => {
    const el = bodyRef.current
    const anchor = anchorRef.current
    if (!el || !anchor) return
    anchorRef.current = null
    const next = el.scrollHeight - anchor.height + anchor.top
    // 夹到合法范围：极端情况下（内容反而变少）也不会把滚动条设成负数
    el.scrollTop = Math.max(0, Math.min(next, el.scrollHeight - el.clientHeight))
  }, [messageCount])

  /** 滚到接近顶部时自动加载（只在可见标签里，保活的隐藏标签不该偷偷拉历史）。 */
  const onScroll = useCallback((): void => {
    if (!props.active || !hasMore || loadingOlder || !historyLoader) return
    const el = bodyRef.current
    if (!el) return
    if (el.scrollTop > 120) return
    void loadOlder()
  }, [hasMore, historyLoader, loadOlder, loadingOlder, props.active])

  // unknown ≠ 空：一条 durable 事件都没吃到、也没有流式内容时给骨架。
  // **注意**：这个分支必须放在所有 hook 之后（见下面），否则首次渲染走 early return、
  // 后续渲染多出几个 hook，React 会直接报 "Rendered more hooks than during the previous render"。

  const list = messages ?? []
  // 系统上下文默认收起，两类都算：
  // 1) Host 注入的 user/message（system-reminder / 技能说明 / 时间采样），
  //    它们的 `source.kind !== 'user'`；
  // 2) 真正的 system/message —— 那是模型可见的系统提示词，动辄几千字，
  //    真机上它一个人占了整个视口，用户翻半天看不到对话。
  const isSystemContext = (m: { readonly synthetic?: boolean; readonly role: string }): boolean =>
    m.synthetic === true || m.role === 'system'
  const syntheticCount = list.filter(isSystemContext).length
  const visibleMessages = showSynthetic ? list : list.filter((m) => !isSystemContext(m))

  /**
   * 整个会话的图片，按出现顺序。
   *
   * 只收**当前可见**消息里的图：系统上下文默认收起，把里面的图混进相册会让
   * 用户翻到一张自己从没见过的图（而且分不清是哪来的）。
   */
  const galleryImages = useMemo(() => {
    const out: MessageAttachment[] = []
    const source = visibleMessages as readonly { attachments?: readonly MessageAttachment[] }[]
    for (const message of source) {
      if (!message.attachments) continue
      for (const attachment of message.attachments) {
        if (attachment.kind === 'image') out.push(attachment)
      }
    }
    return out
  }, [visibleMessages])

  // 一次批量订阅整场会话的图：相册要能翻到还没点开的那些，不能等点了才读。
  const galleryStates = useAttachmentImages(attachmentImages, attachmentReader, galleryImages)

  const gallery = useMemo(() => {
    const items: LightboxItem[] = []
    const indexOf = new Map<string, number>()
    galleryImages.forEach((attachment, index) => {
      const state = galleryStates[index]
      if (!state || state.status !== 'ready') return
      indexOf.set(attachment.attachmentId, items.length)
      items.push({
        url: state.url,
        ...(attachment.name === undefined ? {} : { name: attachment.name }),
        bytes: attachment.bytes,
      })
    })
    return { items, indexOf }
    // galleryStates 每次渲染都是新数组，但它只是缓存状态的投影；
    // 真正影响结果的是"哪些图 ready 了"，由 attachmentImages 的版本号驱动重渲染。
  }, [galleryImages, galleryStates])

  // 放在 hook 之后：这条 early return 在"还没吃到事件"时生效。
  if ((!state || state.status === 'unknown') && live === undefined) {
    return (
      <div
        data-testid="conversation-skeleton"
        data-session-id={sessionId}
        style={centerFill}
      >
        {labels.empty}
      </div>
    )
  }

  // 只有流式内容、没有真人消息时（新会话第一轮），也要渲染正文容器。
  if (visibleMessages.length === 0 && !live) {
    return (
      <div
        data-testid="conversation-empty"
        data-session-id={sessionId}
        style={{ ...centerFill, gap: 8 }}
      >
        <span>{labels.empty}</span>
        {/* 历史还有更早的却没渲染出内容（例如整页都是被折叠的系统上下文）——
            这时候必须给入口，否则用户会被困在这个空态里。 */}
        {hasMore && historyLoader && (
          <button
            type="button"
            data-testid="conversation-load-older"
            disabled={loadingOlder}
            onClick={() => void loadOlder()}
            style={{
              padding: '3px 10px',
              border: '1px solid var(--color-border-secondary, rgba(0,0,0,.1))',
              borderRadius: 999,
              background: 'transparent',
              color: olderError ? 'var(--color-text-danger, #b4472f)' : 'inherit',
              fontFamily: 'inherit',
              fontSize: 11,
              cursor: loadingOlder ? 'default' : 'pointer',
            }}
          >
            {loadingOlder ? labels.loadingOlder : olderError ?? labels.loadOlder}
          </button>
        )}
      </div>
    )
  }

  return (
    <div
      ref={bodyRef}
      data-testid="conversation-body"
      data-session-id={sessionId}
      data-active={String(props.active)}
      data-messages={visibleMessages.length}
      data-synthetic={syntheticCount}
      data-live={live ? 'true' : 'false'}
      data-has-more={hasMore ? 'true' : 'false'}
      aria-label={labels.messages}
      onScroll={onScroll}
      style={{
        flex: '1 1 auto',
        minHeight: 0,
        minWidth: 0,
        overflowY: 'auto',
        padding: '14px 18px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        fontSize: 13,
        lineHeight: 1.62,
        color: 'var(--color-text-primary, #2c2c2a)',
      }}
    >
      {/* 向上加载：只有 Host 说还有更早的才显示。
          滚到顶部 120px 内也会自动触发（见 onScroll），按钮是手动兜底。 */}
      {hasMore && historyLoader && (
        <button
          type="button"
          data-testid="conversation-load-older"
          disabled={loadingOlder}
          onClick={() => void loadOlder()}
          style={{
            alignSelf: 'center',
            padding: '3px 10px',
            border: '1px solid var(--color-border-secondary, rgba(0,0,0,.1))',
            borderRadius: 999,
            background: 'transparent',
            color: olderError
              ? 'var(--color-text-danger, #b4472f)'
              : 'var(--color-text-tertiary, #8a8a85)',
            fontFamily: 'inherit',
            fontSize: 11,
            cursor: loadingOlder ? 'default' : 'pointer',
          }}
        >
          {loadingOlder ? labels.loadingOlder : olderError ?? labels.loadOlder}
        </button>
      )}

      {syntheticCount > 0 && (
        <button
          type="button"
          data-testid="conversation-synthetic-toggle"
          onClick={() => setShowSynthetic((v) => !v)}
          style={{
            alignSelf: 'flex-start',
            padding: '2px 8px',
            border: 'none',
            borderRadius: 6,
            background: 'transparent',
            color: 'var(--color-text-tertiary, #8a8a85)',
            fontFamily: 'inherit',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          {showSynthetic ? labels.collapseSynthetic(syntheticCount) : labels.showSynthetic(syntheticCount)}
        </button>
      )}

      {visibleMessages.map((message) => {
        // 工具调用单独一种形态：不套"你/DSH"气泡，渲染成可展开的一行。
        if (message.role === 'tool' && message.tool) {
          return <ToolCallView key={message.seq} tool={message.tool} labels={toolLabels} />
        }
        const tone = palette[message.role] ?? palette.system
        return (
          <div
            key={message.seq}
            data-role={message.role}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
              padding: '8px 11px',
              borderRadius: 9,
              background: tone.bg,
              alignSelf: message.role === 'user' ? 'flex-end' : 'stretch',
              maxWidth: message.role === 'user' ? '78%' : '100%',
            }}
          >
            <span style={{ fontSize: 10, letterSpacing: '.04em', color: 'var(--color-text-tertiary, #8a8a85)' }}>
              {tone.label}
            </span>
            {message.attachments && message.attachments.length > 0 && (
              <MessageAttachments
                attachments={message.attachments}
                reader={attachmentReader}
                cache={attachmentImages}
                labels={attachmentLabels}
                gallery={gallery.items}
                galleryIndexOf={gallery.indexOf}
              />
            )}
            {/* 只有附件、没有文字时不渲染空 span —— 否则会多出一份行高。 */}
            {message.text !== '' && (
              <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{message.text}</span>
            )}
          </div>
        )
      })}

      {/* 流式气泡：settle 之后 transient 从窗口消失，这块自然消失，
          由折叠出的 durable 消息接手 —— 不会出现"两段重复正文"。 */}
      {live && (
        <div
          data-testid="conversation-live"
          data-attempt={live.attemptId}
          data-role="assistant"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            padding: '8px 11px',
            borderRadius: 9,
            background: palette.assistant.bg,
          }}
        >
          <span style={{ fontSize: 10, letterSpacing: '.04em', color: 'var(--color-text-tertiary, #8a8a85)' }}>
            {palette.assistant.label}
          </span>
          {/* 思考过程：默认收起。模型先想后答，把思考铺开会让正文被推下去，
              而用户要的多半是答案本身。 */}
          {live.reasoning !== '' && (
            <>
              <button
                type="button"
                data-testid="conversation-live-reasoning-toggle"
                onClick={() => setShowReasoning((v) => !v)}
                style={{
                  alignSelf: 'flex-start',
                  padding: '1px 7px',
                  border: 'none',
                  borderRadius: 6,
                  background: 'transparent',
                  color: 'var(--color-text-tertiary, #8a8a85)',
                  fontFamily: 'inherit',
                  fontSize: 10,
                  cursor: 'pointer',
                }}
              >
                {showReasoning ? labels.hideReasoning : labels.showReasoning}
              </button>
              {showReasoning && (
                <span
                  data-testid="conversation-live-reasoning"
                  style={{
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontStyle: 'italic',
                    opacity: 0.72,
                    fontSize: 12,
                    borderLeft: '2px solid var(--color-border-secondary, #e2e0d9)',
                    paddingLeft: 8,
                  }}
                >
                  {live.reasoning}
                </span>
              )}
            </>
          )}
          {live.text !== '' && (
            <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {live.text}
              <span
                aria-hidden="true"
                style={{
                  display: 'inline-block',
                  width: 6,
                  marginLeft: 2,
                  opacity: 0.55,
                  animation: 'studio-caret 1s steps(2, start) infinite',
                }}
              >
                ▍
              </span>
            </span>
          )}
          {/* 正在拼装的工具调用：`tool/call` 还没落库，先给一行"正在调用 xxx"。
              复用 ToolCallView 的 running 形态，保证落库前后的视觉一致。 */}
          {live.toolCalls.map((call) => (
            <ToolCallView
              key={`live-${call.id}`}
              labels={toolLabels}
              tool={{
                callId: call.id,
                name: call.name,
                arguments: call.arguments,
                status: 'running',
              }}
            />
          ))}
        </div>
      )}

      {/* 没有可见文本、但 turn 还开着（例如正在跑工具）时给个提示 */}
      {!live && state?.value.streaming && (
        <div data-testid="conversation-streaming" style={{ fontSize: 11, color: 'var(--color-text-tertiary, #8a8a85)' }}>
          {labels.streaming}
        </div>
      )}
    </div>
  )
}
