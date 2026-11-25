/**
 * `conversation` 派生模型 —— 参考实现，也是工作台里最热的那个模型。
 *
 * 它刻意只做**折叠**，不做渲染决策：不判断要不要合并相邻气泡、不截断长文本、
 * 不决定时间戳格式。那些是视图的事，放进折叠里会让缓存无法共享
 * （两个窗口对同一份数据有不同展示偏好，但折叠结果必须唯一）。
 *
 * 未知事件类型一律忽略并记录，绝不抛错：会话日志只增，
 * 旧客户端遇到新事件是常态，崩一次等于这个会话打不开。
 */

import { ChunkedList } from './chunked.js'
import type { DerivedEntry, DerivedModel } from './model.js'

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

/**
 * 一次工具调用的状态 —— `tool/call` 建记录，`tool/result` 合并回**同一条**。
 *
 * 为什么不拆成两条消息：日志里确实是两条事件，但用户看到的是"一次调用"。
 * 拆开会变成上下两行写着同一个工具名，第一行永远停在"运行中"。
 */
export interface ToolCallState {
  readonly callId: string
  readonly name: string
  /** 模型给的原始 JSON 字符串（不解析 —— 解析失败时仍要能显示原文）。 */
  readonly arguments: string
  /**
   * `interrupted` 是**必须有**的第四种状态：turn 结束时还没收到结果的调用，
   * 永远不会再收到结果了。留着 `running` 会让界面一直转圈，而且 `openCalls`
   * 会随着中断次数累积（下次 `tool/result` 还可能错配到旧下标）。
   */
  readonly status: 'running' | 'done' | 'error' | 'interrupted'
  /**
   * 结果正文。**不是** 400 字符摘要 —— 保留到 `RESULT_KEEP_CHARS` 为止，
   * 怎么显示由渲染层决定（默认 400，可展开）。
   */
  readonly result?: string
  /** 结果原文总长度。缺省表示"没结果"或"与 `result` 等长"。 */
  readonly resultChars?: number
  /** 结果超过保留上限，`result` 只是前缀，其余只存在于会话日志。 */
  readonly resultClipped?: boolean
  /** `tool/result` 的 `error.code` / `reason`。 */
  readonly error?: string
}

/**
 * 消息里的一条附件引用。
 *
 * 定义放在这一层（纯逻辑包）而不是适配层，是因为折叠结果要原样携带它：
 * 两个视图看到同一份 state，附件的身份必须一致，否则同一个文件会被当成两个。
 *
 * 对应 `dsh-llm` 的两个内容块（逐字核对 `types.d.ts`）：
 * ```ts
 * ImageBlock = { type: 'image', attachment: ImageAttachmentRef }
 * FileBlock  = { type: 'file',  attachment: FileAttachmentRef }
 * ImageAttachmentRef = { attachmentId, mediaType, bytes, width, height, name? }
 * FileAttachmentRef  = { attachmentId, name, bytes }
 * ```
 *
 * **文件没有读取接口**：`session.readAttachment` 只接受 `ImageAttachmentRef`，
 * 因为文件投影给模型时是"名字 + 大小 + 只读路径"的文本。所以文件只能显示元数据。
 */
export interface MessageAttachment {
  readonly kind: 'image' | 'file'
  readonly attachmentId: string
  /** 文件名。文件必有；图片可选（粘贴进来的图通常没有名字）。 */
  readonly name?: string
  readonly bytes: number
  /** 仅图片。 */
  readonly mediaType?: string
  readonly width?: number
  readonly height?: number
}

export interface ConversationMessage {
  readonly seq: number
  readonly role: MessageRole
  readonly text: string
  /**
   * 这条消息带的附件（按块顺序）。没有附件时不写字段 ——
   * 避免"每条消息都带空数组"这种无意义的结构差异。
   */
  readonly attachments?: readonly MessageAttachment[]
  /** 仅 `role === 'tool'`：这次调用的完整状态。 */
  readonly tool?: ToolCallState
  /**
   * Host 注入的上下文（system-reminder、技能说明、时间采样、AGENTS.md…），
   * 不是真人输入。判定依据是 `user/message` 的 `source.kind !== 'user'`。
   *
   * 这类消息**必须保留在折叠结果里**（它们确实在日志里、也影响了模型行为），
   * 但界面要默认收起 —— 真机上一场对话 4 条 user 消息里 3 条是这种注入，
   * 全渲染出来等于满屏噪音。
   */
  readonly synthetic?: boolean
}

export interface ConversationState {
  /**
   * 只增不可变的分块列表，不是普通数组：
   * - `length` / `get(i)` / `at(-1)` / `toArray()` / `for...of` / `map` / `filter`；
   * - **没有数字索引**。`messages[0]` 会得到 undefined，请写 `messages.get(0)`。
   * 这样设计是因为每次追加都复制整份数组会让折叠总成本变成 O(n²)。
   */
  readonly messages: ChunkedList<ConversationMessage>
  readonly turns: number
  /** 最后一个 turn 还没结束。 */
  readonly streaming: boolean
  /**
   * 还没收到结果的工具调用：`callId → 消息下标`。
   *
   * 为什么放在 state 里而不是模块级 Map：`apply` 必须是纯函数，两个视图共享同一份
   * 缓存 —— 任何外部可变状态都会让第二个视图读到别人的顺序。用普通对象展开复制，
   * 成本是 O(正在跑的工具数)，真实并发通常 ≤3，可以忽略。
   */
  readonly openCalls: Readonly<Record<string, number>>
  /** 折叠时遇到过的不认识的事件类型（去重、有上限），用于排查"客户端比日志旧"。 */
  readonly unknownTypes: readonly string[]
}

export const CONVERSATION_MODEL_KEY = 'conversation'

/**
 * 共享的模型实例。
 *
 * 缓存按 `model.key` 索引 slot，所以同一个 key 的多个实例会命中同一份状态；
 * 导出单例只是为了让调用方不必各自 `createConversationModel()`（省一个对象，
 * 也让"谁在用同一个模型"在代码里一眼可见）。
 */
export const CONVERSATION_MODEL: DerivedModel<ConversationState> = createConversationModel()

const MAX_UNKNOWN_TYPES = 16

/** 从原始 envelope 里尽量取出文本，取不到就给空串（消息本身仍然要显示）。 */
export function textOf(data: unknown): string {
  if (typeof data === 'string') return data
  if (!data || typeof data !== 'object') return ''

  const record = data as { text?: unknown; content?: unknown }
  if (typeof record.text === 'string') return record.text

  if (typeof record.content === 'string') return record.content
  if (Array.isArray(record.content)) {
    return record.content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object') {
          const text = (part as { text?: unknown }).text
          if (typeof text === 'string') return text
        }
        return ''
      })
      .join('')
  }
  return ''
}

function withUnknown(state: ConversationState, type: string): ConversationState {
  if (state.unknownTypes.includes(type)) return state
  const next = [...state.unknownTypes, type].slice(-MAX_UNKNOWN_TYPES)
  return { ...state, unknownTypes: next }
}

/** 两份折叠结果都见过的不认识类型合并（去重、保留出现顺序、仍受上限约束）。 */
function mergeUnknownTypes(
  older: readonly string[],
  current: readonly string[],
): readonly string[] {
  const merged: string[] = [...older]
  for (const type of current) {
    if (!merged.includes(type)) merged.push(type)
  }
  return merged.slice(-MAX_UNKNOWN_TYPES)
}

/** `apply` 是纯函数，附件数组也必须原样搬（不复制、不加工）。 */
function attachmentsOf(data: unknown): readonly MessageAttachment[] | undefined {
  if (!data || typeof data !== 'object') return undefined
  const list = (data as { attachments?: unknown }).attachments
  if (!Array.isArray(list) || list.length === 0) return undefined
  return list as readonly MessageAttachment[]
}

/** 工具调用/结果的 data 形状（适配层已经拍平成这几个字段）。 */
interface ToolCallData {
  readonly callId?: unknown
  readonly name?: unknown
  readonly arguments?: unknown
}
interface ToolResultData {
  readonly callId?: unknown
  readonly text?: unknown
  readonly isError?: unknown
  readonly error?: unknown
}

/**
 * 结果全文的保留上限。
 *
 * 这里**不再截成 400 字符**。以前只在折叠层给前 400，后果是 400 之外的内容
 * 连"展开看看"的机会都没有 —— 排查 `grep` 命中在第几行、`read_file` 的报错
 * 写在末尾时，只能去翻会话日志的压缩包。现在折叠层保留全文，由渲染层决定
 * 先显示多少（默认 400，可展开）。
 *
 * 上限 20000 而不是无限：折叠结果常驻内存、且被同一进程内所有视图共享，而
 * 事件窗口本来也把原文持在内存里 —— 再翻倍存一份几 MB 的日志没有意义。
 * 超过上限时标 `resultClipped`，界面必须说清"剩下的在日志里"，不能假装完整。
 */
const RESULT_KEEP_CHARS = 20_000

interface ResultSlice {
  readonly result: string
  /** 原文总长度（字符）。渲染层用它判断"还有没有更多"。 */
  readonly resultChars: number
  /** 超过保留上限，`result` 已是前缀。 */
  readonly resultClipped: boolean
}

function sliceResult(text: string): ResultSlice {
  if (text.length <= RESULT_KEEP_CHARS) {
    return { result: text, resultChars: text.length, resultClipped: false }
  }
  return { result: text.slice(0, RESULT_KEEP_CHARS), resultChars: text.length, resultClipped: true }
}

/**
 * 把切好的结果摊成可选字段。
 *
 * 空结果、恰好等长、未越界时都**不写字段** —— 否则每条工具结果都会带上
 * `resultChars: 0` / `resultClipped: false` 这种纯噪音，折叠结果的形状也会
 * 随"有没有越界"变得不稳定，快照比较和测试断言都更难写。
 */
function resultFields(slice: ResultSlice): {
  result?: string
  resultChars?: number
  resultClipped?: true
} {
  if (slice.resultChars === 0) return {}
  return {
    result: slice.result,
    ...(slice.resultChars === slice.result.length ? {} : { resultChars: slice.resultChars }),
    ...(slice.resultClipped ? { resultClipped: true as const } : {}),
  }
}

export function createConversationModel(): DerivedModel<ConversationState> {
  return {
    key: CONVERSATION_MODEL_KEY,
    initial: () => ({
      messages: ChunkedList.empty<ConversationMessage>(),
      turns: 0,
      streaming: false,
      openCalls: {},
      unknownTypes: [],
    }),

    apply: (state, entry: DerivedEntry) => {
      switch (entry.type) {
        case 'turn/start':
          return { ...state, turns: state.turns + 1, streaming: true }

        case 'turn/end': {
          // turn 结束时还挂着的工具调用永远不会再有结果了（被中断、或 Host
          // 放弃了那条工具）。这**不是性能优化**，是正确性：留着 running 会让
          // 界面一直转圈，而且 openCalls 会随中断次数累积，下次 tool/result
          // 可能错配到旧下标上去。
          let messages = state.messages
          let changed = false
          for (const index of Object.values(state.openCalls)) {
            const target = messages.get(index)
            if (!target || !target.tool || target.tool.status !== 'running') continue
            messages = messages.update(index, {
              ...target,
              tool: { ...target.tool, status: 'interrupted' },
            })
            changed = true
          }
          const openEmpty = Object.keys(state.openCalls).length === 0
          if (!changed && openEmpty && !state.streaming) return state
          return {
            ...state,
            messages,
            openCalls: {},
            streaming: false,
          }
        }

        case 'user/message':
        case 'assistant/message':
        case 'system/message': {
          const role: MessageRole =
            entry.type === 'user/message' ? 'user' : entry.type === 'assistant/message' ? 'assistant' : 'system'
          const synthetic = (entry.data as { synthetic?: unknown } | undefined)?.synthetic === true
          const attachments = attachmentsOf(entry.data)
          return {
            ...state,
            // append 只复制末块与块表，旧块整块共享 —— 折叠总成本从 O(n²) 降到近 O(n)。
            messages: state.messages.append({
              seq: entry.seq,
              role,
              text: textOf(entry.data),
              ...(synthetic ? { synthetic: true } : {}),
              ...(attachments ? { attachments } : {}),
            }),
          }
        }

        case 'tool/call': {
          const data = (entry.data ?? {}) as ToolCallData
          const callId = typeof data.callId === 'string' ? data.callId : undefined
          const name = typeof data.name === 'string' ? data.name : ''
          // 没有 callId 就无法与结果配对，但仍然要记录下来（否则界面上
          // "模型说要用工具"和"工具真的跑了"之间会缺一段）。
          const index = state.messages.length
          const tool: ToolCallState = {
            callId: callId ?? `seq-${entry.seq}`,
            name,
            arguments: typeof data.arguments === 'string' ? data.arguments : '',
            status: 'running',
          }
          return {
            ...state,
            messages: state.messages.append({ seq: entry.seq, role: 'tool', text: '', tool }),
            ...(callId === undefined ? {} : { openCalls: { ...state.openCalls, [callId]: index } }),
          }
        }

        case 'tool/result': {
          const data = (entry.data ?? {}) as ToolResultData
          const callId = typeof data.callId === 'string' ? data.callId : undefined
          if (callId === undefined) return withUnknown(state, entry.type)

          const index = state.openCalls[callId]
          const target = index === undefined ? undefined : state.messages.get(index)
          if (index === undefined || !target || !target.tool) {
            // 结果比调用先到（prepend 后重折时可能遇到）或对不上号：
            // 记一条独立的结果消息，总比悄悄丢掉强。
            const slice = sliceResult(typeof data.text === 'string' ? data.text : '')
            return {
              ...state,
              messages: state.messages.append({
                seq: entry.seq,
                role: 'tool',
                text: '',
                tool: {
                  callId,
                  name: '',
                  arguments: '',
                  status: data.isError === true ? 'error' : 'done',
                  ...resultFields(slice),
                  ...(typeof data.error === 'string' ? { error: data.error } : {}),
                },
              }),
            }
          }

          const failed = data.isError === true
          const slice = sliceResult(typeof data.text === 'string' ? data.text : '')
          const merged: ToolCallState = {
            ...target.tool,
            status: failed ? 'error' : 'done',
            ...resultFields(slice),
            ...(typeof data.error === 'string' ? { error: data.error } : {}),
          }
          const openCalls = { ...state.openCalls }
          delete openCalls[callId]
          return {
            ...state,
            messages: state.messages.update(index, { ...target, tool: merged }),
            openCalls,
          }
        }

        default:
          return withUnknown(state, entry.type)
      }
    },

    /**
     * 增量前插：向上加载历史时，把更早一页的折叠结果接在前面。
     *
     * 拼不了的情况只有一种，但必须如实拒绝：**旧页结束时还有工具调用没有结果**
     * （页边界正好切在调用与结果之间）。这时结果在下一页里，硬拼会出现
     * "同一次调用两条记录" —— 一条永远 running、一条孤儿结果。让缓存整窗重折
     * 是对的：页边界不常落在调用中间，而错乱一旦发生很难归因。
     *
     * `openCalls` 里的下标是**相对当前页**的，拼接后必须整体后移，否则
     * 下一个 `tool/result` 会合并到旧页的某条无关消息上。
     */
    prepend: (older: ConversationState, current: ConversationState): ConversationState | undefined => {
      if (Object.keys(older.openCalls).length > 0) return undefined

      const shift = older.messages.length
      const openCalls: Record<string, number> = {}
      for (const [callId, index] of Object.entries(current.openCalls)) {
        openCalls[callId] = index + shift
      }

      return {
        messages: older.messages.concat(current.messages),
        turns: older.turns + current.turns,
        // 是否正在生成只取决于**当前**（最新）那一段
        streaming: current.streaming,
        openCalls,
        unknownTypes: mergeUnknownTypes(older.unknownTypes, current.unknownTypes),
      }
    },
  }
}
