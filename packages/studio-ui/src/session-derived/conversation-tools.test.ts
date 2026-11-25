/**
 * 工具调用在折叠模型里的行为。
 *
 * 核心是「两条事件合成一条消息」：`tool/call` 建记录、`tool/result` 合并回原处。
 * 拆成两条会让同一件工具显示两行，而且第一行永远停在"运行中"。
 */

import { describe, expect, it } from 'vitest'

import { createConversationModel, type ConversationState } from './conversation.js'
import type { DerivedEntry } from './model.js'

const MODEL = createConversationModel()

function fold(entries: DerivedEntry[]): ConversationState {
  let state = MODEL.initial()
  for (const entry of entries) state = MODEL.apply(state, entry)
  return state
}

const call = (seq: number, callId: string, name: string, args = '{}'): DerivedEntry => ({
  seq,
  type: 'tool/call',
  data: { callId, name, arguments: args },
})

const result = (seq: number, callId: string, text: string, isError = false): DerivedEntry => ({
  seq,
  type: 'tool/result',
  data: { callId, text, isError },
})

const userMsg = (seq: number, text: string): DerivedEntry => ({
  seq,
  type: 'user/message',
  data: { text, synthetic: false },
})

describe('tool/call 建记录', () => {
  it('变成一条 role=tool 的消息，状态 running', () => {
    const state = fold([call(1, 'c1', 'read_file', '{"path":"a.txt"}')])
    const msg = state.messages.get(0)
    expect(msg?.role).toBe('tool')
    expect(msg?.tool).toEqual({
      callId: 'c1',
      name: 'read_file',
      arguments: '{"path":"a.txt"}',
      status: 'running',
    })
    // 参数原文保留，不解析
    expect(msg?.tool?.arguments).toBe('{"path":"a.txt"}')
  })

  it('登记到 openCalls，值是消息下标', () => {
    const state = fold([userMsg(1, '开始'), call(2, 'c1', 'grep')])
    expect(state.openCalls).toEqual({ c1: 1 })
  })

  it('没有 callId 也能记录（用 seq 兜底，但不进 openCalls）', () => {
    const state = fold([{ seq: 3, type: 'tool/call', data: { name: 'x' } }])
    const msg = state.messages.get(0)
    expect(msg?.tool?.callId).toBe('seq-3')
    expect(msg?.tool?.status).toBe('running')
    expect(state.openCalls).toEqual({})
  })
})

describe('tool/result 合并回原记录', () => {
  it('合并后只有一条消息，状态变 done 并带结果', () => {
    const state = fold([call(1, 'c1', 'read_file'), result(2, 'c1', '文件内容')])
    expect(state.messages.length).toBe(1)
    const tool = state.messages.get(0)?.tool
    expect(tool?.status).toBe('done')
    expect(tool?.result).toBe('文件内容')
    // 工具名与参数没被结果覆盖
    expect(tool?.name).toBe('read_file')
  })

  it('合并后从 openCalls 移除', () => {
    const state = fold([call(1, 'c1', 'x'), result(2, 'c1', 'ok')])
    expect(state.openCalls).toEqual({})
  })

  it('isError 时状态是 error，并带上错误码', () => {
    const state = fold([
      call(1, 'c1', 'x'),
      { seq: 2, type: 'tool/result', data: { callId: 'c1', text: '命令失败', isError: true, error: 'ENOENT' } },
    ])
    const tool = state.messages.get(0)?.tool
    expect(tool?.status).toBe('error')
    expect(tool?.error).toBe('ENOENT')
    expect(tool?.result).toBe('命令失败')
  })

  it('结果不再截成 400，而是保留全文（渲染层才截）', () => {
    const long = 'x'.repeat(1000)
    const state = fold([call(1, 'c1', 'x'), result(2, 'c1', long)])
    const tool = state.messages.get(0)?.tool
    expect(tool?.result).toBe(long)
    // 等长时不写多余字段（保持信封最小）
    expect(tool).not.toHaveProperty('resultChars')
    expect(tool).not.toHaveProperty('resultClipped')
  })

  it('超过保留上限时截到 20000 并标记（附原长度）', () => {
    const huge = 'y'.repeat(25_000)
    const state = fold([call(1, 'c1', 'x'), result(2, 'c1', huge)])
    const tool = state.messages.get(0)?.tool
    expect(tool?.result?.length).toBe(20_000)
    expect(tool?.resultChars).toBe(25_000)
    expect(tool?.resultClipped).toBe(true)
  })

  it('空结果不写 result 字段', () => {
    const state = fold([call(1, 'c1', 'x'), result(2, 'c1', '')])
    const tool = state.messages.get(0)?.tool
    expect(tool?.status).toBe('done')
    expect(tool).not.toHaveProperty('result')
    expect(tool).not.toHaveProperty('resultChars')
  })

  it('默认保留原有消息顺序：用户 → 工具 → 助手', () => {
    const state = fold([
      userMsg(1, '查一下'),
      call(2, 'c1', 'read_file'),
      result(3, 'c1', '内容'),
      { seq: 4, type: 'assistant/message', data: { text: '读到了' } },
    ])
    expect(state.messages.toArray().map((m) => m.role)).toEqual(['user', 'tool', 'assistant'])
  })

  it('结果先于调用到达时，单独记一条（不静默丢弃）', () => {
    const state = fold([result(1, 'c9', '孤儿结果')])
    expect(state.messages.length).toBe(1)
    const tool = state.messages.get(0)?.tool
    expect(tool?.callId).toBe('c9')
    expect(tool?.status).toBe('done')
    expect(tool?.result).toBe('孤儿结果')
  })

  it('同一 callId 的结果只合并一次（重投不会重复）', () => {
    const state = fold([call(1, 'c1', 'x'), result(2, 'c1', '第一次')])
    // 重投通常会带更大 seq，这里模拟"结果再来一次"
    const again = MODEL.apply(state, result(3, 'c1', '第二次'))
    // 已从 openCalls 移除 → 走"孤儿结果"分支，追加一条，但不会破坏原来那条
    expect(state.messages.get(0)?.tool?.result).toBe('第一次')
    expect(again.messages.length).toBe(2)
  })

  it('并发两个工具各自配对', () => {
    const state = fold([
      call(1, 'a', 'read_file', '{"path":"a"}'),
      call(2, 'b', 'read_file', '{"path":"b"}'),
      result(3, 'b', 'B 的内容'),
      result(4, 'a', 'A 的内容'),
    ])
    expect(state.messages.length).toBe(2)
    expect(state.messages.get(0)?.tool?.result).toBe('A 的内容')
    expect(state.messages.get(1)?.tool?.result).toBe('B 的内容')
    expect(state.openCalls).toEqual({})
  })

  it('缺 callId 的结果记进 unknownTypes（形状不认识）', () => {
    const state = fold([{ seq: 1, type: 'tool/result', data: { text: 'x' } }])
    expect(state.messages.length).toBe(0)
    expect(state.unknownTypes).toContain('tool/result')
  })

  it('apply 是纯函数：同一 state 折两次得到等价结果，原 state 不变', () => {
    const base = fold([call(1, 'c1', 'x')])
    const snapshot = base.messages.get(0)?.tool?.status
    const a = MODEL.apply(base, result(2, 'c1', 'ok'))
    const b = MODEL.apply(base, result(2, 'c1', 'ok'))
    expect(a.messages.get(0)?.tool?.status).toBe('done')
    expect(b.messages.get(0)?.tool?.status).toBe('done')
    // 原 state 完全没动
    expect(base.messages.get(0)?.tool?.status).toBe(snapshot)
    expect(base.openCalls).toEqual({ c1: 0 })
  })
})

describe("turn/end 收尾未完成的工具调用", () => {
  it("turn 结束时仍挂着的调用标成 interrupted", () => {
    const state = fold([call(1, "c1", "read_file"), { seq: 2, type: "turn/end", data: {} }])
    expect(state.messages.get(0)?.tool?.status).toBe("interrupted")
  })

  it("turn 结束时清空 openCalls（否则会随中断次数累积并错配下标）", () => {
    const state = fold([
      call(1, "c1", "a"),
      call(2, "c2", "b"),
      { seq: 3, type: "turn/end", data: {} },
    ])
    expect(state.openCalls).toEqual({})
  })

  it("已经完成的调用不受影响", () => {
    const state = fold([
      call(1, "c1", "a"),
      result(2, "c1", "ok"),
      call(3, "c2", "b"),
      { seq: 4, type: "turn/end", data: {} },
    ])
    expect(state.messages.get(0)?.tool?.status).toBe("done")
    expect(state.messages.get(1)?.tool?.status).toBe("interrupted")
  })

  it("turn/end 后到达的旧结果不会错配到新调用上", () => {
    const state = fold([
      call(1, "c1", "a"),
      { seq: 2, type: "turn/end", data: {} },
      // 下一轮又有一个调用，地理位置恰好还是 1
      call(3, "c2", "b"),
      // 旧 result 迟到（c1 已经不在 openCalls 里）
      result(4, "c1", "迟到的结果"),
    ])
    expect(state.messages.get(0)?.tool?.status).toBe("interrupted")
    // c2 不能被误标
    expect(state.messages.get(1)?.tool?.status).toBe("running")
    // 迟到结果单独成一条
    expect(state.messages.length).toBe(3)
  })

  it("没有未完成调用时 turn/end 不产生多余对象", () => {
    const state = fold([call(1, "c1", "a"), result(2, "c1", "ok")])
    const after = MODEL.apply(state, { seq: 3, type: "turn/end", data: {} })
    // 已在 turn/end 之前就不是 streaming，也没有 openCalls → 原样返回
    expect(after).toBe(state)
  })
})
