/**
 * 真实事件窗口 → 派生折叠输入。
 *
 * 这一层把 DSH 的形状翻译成「模型友好的扁平信封」，好处是 `DerivedModel`
 * 永远不需要认识 DSH 的 `SessionEventMap`：
 *
 * ```ts
 * 'user/message'      → data.content            → { text }
 * 'assistant/message' → data.message.content    → { text }   ← 注意嵌了一层
 * 'system/message'    → data.message.content    → { text }
 * ```
 *
 * **`assistant/message` 的文本在 `data.message.content` 里，不在 `data.content`。**
 * 直接 `textOf(data)` 会得到空串 —— 这是核对 `dsh-session/types.d.ts` 才发现的
 * （`'assistant/message': { turn, step, message: AssistantMessage, stream, usage?, interrupted? }`）。
 *
 * 两处刻意不做的事：
 * 1) **不折叠 transient（`assistant/live-chunk`）**。流式 token 属于渲染层，
 *    塞进历史折叠会让「重连后重建」与「实时追加」走两条不同的路径。
 * 2) **不解析 tool/call 的参数**。那是面板与审批 UI 的事。
 */

import type { DerivedEntry } from '../session-derived/model.js'
import type { MessageAttachment } from '../session-derived/conversation.js'

/** `SessionEventLikeEntry` 的最小形状（`{type:'event'|'transient', event}`）。 */
export interface RawEventEntry {
  readonly type: 'event' | 'transient'
  readonly event: {
    readonly type: string
    readonly seq: number
    readonly time?: number
    readonly data?: unknown
  }
}

export interface RawSessionEventWindow {
  readonly entries: readonly RawEventEntry[]
  readonly hasMore: boolean
  readonly revision: number
  readonly change?: {
    readonly kind: 'replace' | 'prepend' | 'append' | 'settle-assistant'
    readonly entries?: readonly RawEventEntry[]
    readonly entry?: RawEventEntry
  }
}

/** `ObservableSnapshot<T>` 的最小形状。 */
export interface SnapshotLike<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** 从 `ContentBlock[]` 里拼出纯文本；不是文本块就跳过。 */
export function textOfBlocks(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (typeof block === 'string') {
      parts.push(block)
      continue
    }
    if (block && typeof block === 'object') {
      const text = (block as { text?: unknown }).text
      if (typeof text === 'string') parts.push(text)
    }
  }
  return parts.join('')
}

/**
 * 附件引用的类型定义在折叠包（`session-derived/conversation.ts`）里 ——
 * 折叠结果要原样携带它，所以身份定义必须只有一份。
 */
export type { MessageAttachment }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

function toAttachmentRef(block: Record<string, unknown>): MessageAttachment | undefined {
  const kind = block.type === 'image' ? 'image' : block.type === 'file' ? 'file' : undefined
  if (!kind) return undefined
  const ref = block.attachment
  if (!isRecord(ref)) return undefined

  // `attachmentId` 是 branded string，运行时就是 string。缺了它这条引用无法读取，
  // 与其渲染一个必然失败的占位，不如整条丢掉 —— 但保留 text 里的 handle 文本。
  const attachmentId = typeof ref.attachmentId === 'string' ? ref.attachmentId : undefined
  if (!attachmentId) return undefined

  const bytes = typeof ref.bytes === 'number' && Number.isFinite(ref.bytes) ? ref.bytes : 0
  const name = typeof ref.name === 'string' && ref.name.length > 0 ? ref.name : undefined
  const mediaType = typeof ref.mediaType === 'string' ? ref.mediaType : undefined
  const width = typeof ref.width === 'number' ? ref.width : undefined
  const height = typeof ref.height === 'number' ? ref.height : undefined

  return {
    kind,
    attachmentId,
    bytes,
    ...(name === undefined ? {} : { name }),
    ...(mediaType === undefined ? {} : { mediaType }),
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
  }
}

/**
 * 从 `ContentBlock[]` 里取出附件引用（保持块顺序）。
 *
 * 只在真的有附件时返回非空数组；调用方据此决定要不要往折叠结果里塞字段，
 * 避免"每条消息都带一个空数组"这种无意义的结构差异。
 */
export function attachmentsOfBlocks(content: unknown): MessageAttachment[] {
  if (!Array.isArray(content)) return []
  const out: MessageAttachment[] = []
  for (const block of content) {
    if (!isRecord(block)) continue
    const ref = toAttachmentRef(block)
    if (ref) out.push(ref)
  }
  return out
}

/** 把附件数组塞进 data 的公共收尾：空数组不写字段。 */
function withAttachments<T extends Record<string, unknown>>(data: T, content: unknown): T {
  const attachments = attachmentsOfBlocks(content)
  return attachments.length === 0 ? data : { ...data, attachments }
}

function dataOf(event: RawEventEntry['event']): unknown {
  const data = event.data
  if (!data || typeof data !== 'object') return data

  switch (event.type) {
    case 'user/message': {
      const record = data as { content?: unknown; source?: { kind?: unknown } }
      const kind = typeof record.source?.kind === 'string' ? record.source.kind : 'user'
      // `source.kind` 是"谁产生的"：`user` 是真人输入，其余（system-prompt、
      // 插件合并进来的 agent-inject 等）都是 Host 注入的上下文。
      // 真机实测：一场对话里 4 条 user/message 有 3 条是 system-reminder 注入 ——
      // 不区分就会把它们当成用户说过的话渲染出来。
      return withAttachments(
        { text: textOfBlocks(record.content), synthetic: kind !== 'user' },
        record.content,
      )
    }
    case 'assistant/message':
    case 'system/message':
    case 'developer/message': {
      const message = (data as { message?: { content?: unknown } }).message
      const content = message?.content ?? (data as { content?: unknown }).content
      // 助手侧目前不产出附件（适配器声明的输出是 text-only），但块类型是
      // role-neutral 的，按前向兼容一并提取 —— 未来真出现也不用改这里。
      return withAttachments({ text: textOfBlocks(content) }, content)
    }
    case 'tool/call': {
      // 契约：`{ turn, step, callId, name, arguments }`，`arguments` 是原始 JSON 字符串。
      // 不解析它 —— 模型偶尔产出不合法 JSON，那时仍要能显示原文。
      const record = data as { callId?: unknown; name?: unknown; arguments?: unknown }
      return {
        callId: typeof record.callId === 'string' ? record.callId : '',
        name: typeof record.name === 'string' ? record.name : '',
        arguments: typeof record.arguments === 'string' ? record.arguments : '',
      }
    }
    case 'tool/result': {
      // 契约：`{ turn, step, message: ToolResultMessage, error?: { name, code }, reason? }`。
      // 结果文本在 `message.content`（或适配层已拍平的 `text`）。
      const record = data as {
        message?: { content?: unknown; toolCallId?: unknown; isError?: unknown }
        toolCallId?: unknown
        text?: unknown
        isError?: unknown
        error?: { code?: unknown; name?: unknown } | unknown
      }
      const message = record.message
      const callId =
        typeof message?.toolCallId === 'string'
          ? message.toolCallId
          : typeof record.toolCallId === 'string'
            ? record.toolCallId
            : ''
      const text =
        typeof record.text === 'string' ? record.text : textOfBlocks(message?.content)
      const isError = message?.isError === true || record.isError === true
      // `error` 是 `{ name, code }`，`reason` 是给人看的原文（契约里说 reason 在模型
      // 内容之外）。优先用 reason，没有就退回 code —— 两者都没有就不写字段。
      const reason = typeof (data as { reason?: unknown }).reason === 'string' ? (data as { reason: string }).reason : undefined
      const code =
        record.error && typeof record.error === 'object' && typeof (record.error as { code?: unknown }).code === 'string'
          ? (record.error as { code: string }).code
          : undefined
      return {
        callId,
        text,
        isError,
        ...(reason ?? code ? { error: reason ?? code } : {}),
      }
    }
    default:
      // 其余事件（turn/step 边界、tool/result、projection 变更…）原样透传：
      // 模型自己决定要不要解释，不认识就记进 unknownTypes。
      return data
  }
}

/**
 * 一条真实事件 → 一条折叠输入。
 *
 * @returns transient 与非法条目返回 undefined（由调用方跳过）。
 */
export function toDerivedEntry(entry: RawEventEntry): DerivedEntry | undefined {
  if (!entry || entry.type !== 'event') return undefined
  const event = entry.event
  // `typeof NaN === 'number'`：seq 是 NaN 时去重判断（`seq > lastSeq`）永远为假，
  // 那条消息会静默消失。所以用 isFinite 而不是 typeof。
  if (!event || !Number.isFinite(event.seq) || typeof event.type !== 'string') return undefined
  return { seq: event.seq, type: event.type, data: dataOf(event) }
}

export function toDerivedEntries(entries: readonly RawEventEntry[]): DerivedEntry[] {
  const out: DerivedEntry[] = []
  for (const entry of entries) {
    const mapped = toDerivedEntry(entry)
    if (mapped) out.push(mapped)
  }
  return out
}
