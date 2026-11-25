import { describe, expect, it } from 'vitest'

import type { RawEventEntry, RawSessionEventWindow } from './event-adapter.js'
import { readLiveStream, reasoningDeltaOf, textDeltaOf, toolCallDeltaOf } from './live-stream.js'

/** 一条 transient live-chunk。 */
function live(attemptId: string, text: string | undefined, seq = 0, time = 1000): RawEventEntry {
  return {
    type: 'transient',
    event: {
      type: 'assistant/live-chunk',
      seq,
      time,
      data: { attemptId, turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text } },
    },
  }
}

/** 一条 durable 事件。 */
function durable(type: string, seq = 1): RawEventEntry {
  return { type: 'event', event: { type, seq, time: 1000, data: {} } }
}

function windowOf(entries: RawEventEntry[]): RawSessionEventWindow {
  return { entries, hasMore: false, revision: 1 }
}

describe('textDeltaOf', () => {
  it('只认 text-delta', () => {
    expect(textDeltaOf({ type: 'text-delta', text: '你好' })).toBe('你好')
    expect(textDeltaOf({ type: 'reasoning-delta', text: '思考' })).toBe('')
    expect(textDeltaOf({ type: 'block-start', index: 0 })).toBe('')
    expect(textDeltaOf(undefined)).toBe('')
    expect(textDeltaOf(null)).toBe('')
    expect(textDeltaOf('text')).toBe('')
    expect(textDeltaOf({ type: 'text-delta' })).toBe('')
  })
})

describe('readLiveStream', () => {
  it('拼接尾部连续的 transient', () => {
    const window = windowOf([durable('user/message'), live('a1', '正在'), live('a1', '生成')])
    expect(readLiveStream(window)?.text).toBe('正在生成')
    expect(readLiveStream(window)?.attemptId).toBe('a1')
  })

  it('遇到 durable 就停 —— 不把上一轮的残留算进来', () => {
    const window = windowOf([
      live('old', '上一轮的残留'),
      durable('assistant/message', 5),
      live('new', '这一轮'),
    ])
    expect(readLiveStream(window)?.text).toBe('这一轮')
  })

  it('尾部没有 transient 时返回 undefined', () => {
    expect(readLiveStream(windowOf([durable('turn/end')]))).toBeUndefined()
    expect(readLiveStream(windowOf([]))).toBeUndefined()
    expect(readLiveStream(undefined)).toBeUndefined()
  })

  it('换 attempt 时丢弃前一个的文本（重试不该叠加）', () => {
    const window = windowOf([live('a1', '失败的半截'), live('a2', '重试后')])
    expect(readLiveStream(window)?.text).toBe('重试后')
    expect(readLiveStream(window)?.attemptId).toBe('a2')
  })

  it('只有非文本 chunk 时返回 undefined（例如纯工具调用）', () => {
    const window = windowOf([
      {
        type: 'transient',
        event: {
          type: 'assistant/live-chunk',
          seq: 0,
          time: 1000,
          data: { attemptId: 'a1', chunk: { type: 'tool-call-delta', argumentsDelta: '{}' } },
        },
      },
    ])
    expect(readLiveStream(window)).toBeUndefined()
  })

  it('记录最后一条 chunk 的时间', () => {
    const window = windowOf([live('a1', 'a', 0, 111), live('a1', 'b', 0, 222)])
    expect(readLiveStream(window)?.lastTime).toBe(222)
  })

  it('不因畸形条目抛错', () => {
    const window = windowOf([
      { type: 'transient', event: { type: 'whatever', seq: 0 } },
      { type: 'transient', event: { type: 'assistant/live-chunk', seq: 0, data: null } },
    ] as RawEventEntry[])
    expect(() => readLiveStream(window)).not.toThrow()
    expect(readLiveStream(window)).toBeUndefined()
  })
})

// ---------------------------------------------------------------- 思考过程

function think(attemptId: string, text: string, seq = 0, time = 1000): RawEventEntry {
  return {
    type: "transient",
    event: {
      type: "assistant/live-chunk",
      seq,
      time,
      data: { attemptId, turn: 1, step: 1, chunk: { type: "reasoning-delta", index: 0, text } },
    },
  }
}

describe("reasoningDeltaOf", () => {
  it("只认 reasoning-delta", () => {
    expect(reasoningDeltaOf({ type: "reasoning-delta", text: "想想" })).toBe("想想")
    expect(reasoningDeltaOf({ type: "text-delta", text: "答" })).toBe("")
    expect(reasoningDeltaOf(undefined)).toBe("")
  })
})

describe("readLiveStream 的思考过程", () => {
  it("思考与正文分开累计，不混在一起", () => {
    const out = readLiveStream(windowOf([think("a", "先看文件 "), live("a", "答案是 42")]))
    expect(out?.reasoning).toBe("先看文件 ")
    expect(out?.text).toBe("答案是 42")
  })

  it("只有思考、还没正文时也返回（否则界面一片空白像卡住）", () => {
    const out = readLiveStream(windowOf([think("a", "思考中…")]))
    expect(out).toBeDefined()
    expect(out?.text).toBe("")
    expect(out?.reasoning).toBe("思考中…")
  })

  it("思考与正文交错时各自保持顺序", () => {
    const out = readLiveStream(
      windowOf([think("a", "甲"), live("a", "一"), think("a", "乙"), live("a", "二")]),
    )
    expect(out?.reasoning).toBe("甲乙")
    expect(out?.text).toBe("一二")
  })

  it("换 attempt 时思考也一起丢弃", () => {
    const out = readLiveStream(windowOf([think("a", "旧思考"), live("a", "旧答"), think("b", "新思考")]))
    expect(out?.attemptId).toBe("b")
    expect(out?.reasoning).toBe("新思考")
    expect(out?.text).toBe("")
  })

  it("既无思考又无正文时返回 undefined", () => {
    expect(readLiveStream(windowOf([think("a", "")]))).toBeUndefined()
  })
})


// ---------------------------------------------------------------- 工具调用增量

function toolDelta(id: string, argsDelta: string, name: string | undefined, attemptId = "a"): RawEventEntry {
  return {
    type: "transient",
    event: {
      type: "assistant/live-chunk",
      seq: 0,
      time: 1000,
      data: {
        attemptId,
        turn: 1,
        step: 1,
        chunk: { type: "tool-call-delta", index: 0, id, name, argumentsDelta: argsDelta },
      },
    },
  }
}

describe("toolCallDeltaOf", () => {
  it("只认 tool-call-delta，且必须有 id", () => {
    expect(toolCallDeltaOf({ type: "tool-call-delta", id: "c1", name: "read", argumentsDelta: "{" })).toEqual({
      id: "c1",
      name: "read",
      arguments: "{",
    })
    expect(toolCallDeltaOf({ type: "tool-call-delta", argumentsDelta: "{" })).toBeUndefined()
    expect(toolCallDeltaOf({ type: "text-delta", text: "x" })).toBeUndefined()
    expect(toolCallDeltaOf(undefined)).toBeUndefined()
  })

  it("name 缺省时不写字段", () => {
    expect(toolCallDeltaOf({ type: "tool-call-delta", id: "c1", argumentsDelta: "{}" })).toEqual({
      id: "c1",
      arguments: "{}",
    })
  })
})

describe("readLiveStream 的流式工具调用", () => {
  it("按 id 拼接参数增量", () => {
    const out = readLiveStream(
      windowOf([toolDelta("c1", '{"pa', "read_file"), toolDelta("c1", 'th":"a"}', undefined)]),
    )
    expect(out?.toolCalls).toEqual([{ id: "c1", name: "read_file", arguments: '{"path":"a"}' }])
  })

  it("后续 delta 没有 name 时不覆盖已有的名字", () => {
    const out = readLiveStream(
      windowOf([toolDelta("c1", "{}", "grep"), toolDelta("c1", "", undefined)]),
    )
    expect(out?.toolCalls[0]?.name).toBe("grep")
  })

  it("并发多个工具各自累积，保持首次出现顺序", () => {
    const out = readLiveStream(
      windowOf([
        toolDelta("a", '{"p', "read_file"),
        toolDelta("b", '{"q', "grep"),
        toolDelta("a", '1"}', undefined),
        toolDelta("b", '2"}', undefined),
      ]),
    )
    expect(out?.toolCalls.map((c) => c.id)).toEqual(["a", "b"])
    expect(out?.toolCalls[0]?.arguments).toBe('{"p1"}')
    expect(out?.toolCalls[1]?.arguments).toBe('{"q2"}')
  })

  it("只有工具调用、没有正文和思考时也返回（否则界面空白）", () => {
    const out = readLiveStream(windowOf([toolDelta("c1", "{}", "read_file")]))
    expect(out).toBeDefined()
    expect(out?.text).toBe("")
    expect(out?.reasoning).toBe("")
    expect(out?.toolCalls).toHaveLength(1)
  })

  it("换 attempt 时工具调用一起丢弃", () => {
    const out = readLiveStream(
      windowOf([toolDelta("old", "{}", "x", "a"), toolDelta("new", "{}", "y", "b")]),
    )
    expect(out?.attemptId).toBe("b")
    expect(out?.toolCalls.map((c) => c.id)).toEqual(["new"])
  })
})
