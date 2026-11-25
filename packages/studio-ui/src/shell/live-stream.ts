/**
 * 正在流式输出的助手文本。
 *
 * 为什么**不**折进 `DerivedCache`：
 * 1) transient 事件（`assistant/live-chunk`）的 seq 语义是"插在 durable seq 之间"，
 *    可能重复、乱序，而且会被 `settle-assistant` 整体撤掉。把它喂进只增折叠的
 *    缓存，等于让缓存承担一份随时会作废的中间状态。
 * 2) 流式文本每几十毫秒变一次。折叠缓存一变更就 `notify()`，所有视图跟着重折 —
 *    而 durable 事件其实没变。分开之后，durable 折叠完全不受流式影响。
 *
 * 所以这里只做**只读派生**：从当前事件窗口里读出尾部那段连续的 transient，
 * 拼成文本交给渲染层。settle 之后 transient 从窗口里消失，气泡自然消失。
 *
 * 真实形状（`dsh-llm/types.d.ts`）：
 * ```ts
 * StreamChunk = { type: 'text-delta'; index: number; text: string } | ...
 * AssistantLiveChunkEvent.data = { attemptId, turn, step, chunk: StreamChunk }
 * ```
 */

import type { RawEventEntry, RawSessionEventWindow } from './event-adapter.js'

/**
 * 正在拼装中的一次工具调用。
 *
 * `tool-call-delta` 是**增量**的：`name` 可能只在第一个 delta 出现，
 * `argumentsDelta` 需要按序拼接。不发这个预览的话，"模型决定调工具"到
 * "`tool/call` 落库"之间有几百毫秒的空窗，界面看起来像卡住。
 *
 * 注意它**不是** durable 事实：arguments 可能还没拼完，也可能是坏 JSON。
 * 渲染层只当"正在调用 xxx"的提示用，不能当成完整调用。
 */
export interface LiveToolCall {
  readonly id: string
  readonly name: string
  /** 已按序拼接的参数增量（可能还不完整）。 */
  readonly arguments: string
}

export interface LiveStream {
  readonly attemptId: string
  readonly text: string
  /**
   * 思考过程（`reasoning-delta` 拼起来的）。
   *
   * 与 `text` 分开累计：模型先想后答，两者交错出现时混在一起会变成
   * "标题写着 DSH、正文一半是思考"的怪东西。界面上思考默认收起。
   */
  readonly reasoning: string
  /** 正在拼装的工具调用（按首次出现顺序）。 */
  readonly toolCalls: readonly LiveToolCall[]
  /** 最近一个 chunk 的时间戳（用于"还在动吗"的判断）。 */
  readonly lastTime?: number
}

/** 从 chunk 里取文本增量；不是文本块返回空串。 */
export function textDeltaOf(chunk: unknown): string {
  if (!chunk || typeof chunk !== 'object') return ''
  const record = chunk as { type?: unknown; text?: unknown }
  if (record.type !== 'text-delta') return ''
  return typeof record.text === 'string' ? record.text : ''
}

/** 从 chunk 里取思考增量；不是思考块返回空串。 */
export function reasoningDeltaOf(chunk: unknown): string {
  if (!chunk || typeof chunk !== 'object') return ''
  const record = chunk as { type?: unknown; text?: unknown }
  if (record.type !== 'reasoning-delta') return ''
  return typeof record.text === 'string' ? record.text : ''
}

/** 从 chunk 里取工具调用增量；不是工具块返回 undefined。 */
export function toolCallDeltaOf(
  chunk: unknown,
): { readonly id: string; readonly name?: string; readonly arguments: string } | undefined {
  if (!chunk || typeof chunk !== 'object') return undefined
  const record = chunk as { type?: unknown; id?: unknown; name?: unknown; argumentsDelta?: unknown }
  if (record.type !== 'tool-call-delta') return undefined
  const id = typeof record.id === 'string' ? record.id : undefined
  if (id === undefined) return undefined
  return {
    id,
    ...(typeof record.name === 'string' && record.name !== '' ? { name: record.name } : {}),
    arguments: typeof record.argumentsDelta === 'string' ? record.argumentsDelta : '',
  }
}

/**
 * 读当前窗口尾部的流式文本。
 *
 * 只扫**尾部连续的 transient 段**：碰到第一条 durable 事件就停。这样不会把
 * 上一轮已经 settle 掉、但还残留在窗口里的 transient 误认成"正在生成"。
 * 从后往前扫，正常情况下扫不到几十条就结束。
 */
export function readLiveStream(window: RawSessionEventWindow | undefined): LiveStream | undefined {
  if (!window) return undefined
  const entries = window.entries
  if (entries.length === 0) return undefined

  const tail: RawEventEntry[] = []
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]
    if (!entry || entry.type !== 'transient') break
    tail.push(entry)
  }
  if (tail.length === 0) return undefined
  tail.reverse()

  // 同一段里可能有多个 attempt（重试用新 attemptId），只保留最后一个。
  let attemptId = ''
  const parts: string[] = []
  const thoughts: string[] = []
  // Map 保证插入顺序 = 首次出现顺序；并发工具各自累积。
  let calls = new Map<string, { name: string; args: string[] }>()
  let lastTime: number | undefined

  for (const entry of tail) {
    const event = entry.event
    const data = event.data as { attemptId?: unknown; chunk?: unknown } | undefined
    const id = data?.attemptId === undefined ? '' : String(data.attemptId)
    if (id !== attemptId) {
      // 换了 attempt：之前的作废，从头累计。
      attemptId = id
      parts.length = 0
      thoughts.length = 0
      calls = new Map()
    }
    const delta = textDeltaOf(data?.chunk)
    if (delta) parts.push(delta)
    const thought = reasoningDeltaOf(data?.chunk)
    if (thought) thoughts.push(thought)
    const call = toolCallDeltaOf(data?.chunk)
    if (call) {
      const existing = calls.get(call.id)
      if (existing) {
        // `name` 可能只在首个 delta 出现，后续为 undefined —— 不要覆盖成空。
        if (call.name !== undefined) existing.name = call.name
        existing.args.push(call.arguments)
      } else {
        calls.set(call.id, { name: call.name ?? '', args: [call.arguments] })
      }
    }
    if (typeof event.time === 'number') lastTime = event.time
  }

  const text = parts.join('')
  const reasoning = thoughts.join('')
  const toolCalls: LiveToolCall[] = []
  for (const [id, value] of calls) {
    toolCalls.push({ id, name: value.name, arguments: value.args.join('') })
  }

  // 只有思考、还没开始答：也要返回（否则界面上会一片空白，看着像卡住）。
  // 工具调用同理 —— 它常常是"想完之后立刻动手"，正文一个字都还没有。
  if (text.length === 0 && reasoning.length === 0 && toolCalls.length === 0) return undefined
  return {
    attemptId,
    text,
    reasoning,
    toolCalls,
    ...(lastTime === undefined ? {} : { lastTime }),
  }
}
