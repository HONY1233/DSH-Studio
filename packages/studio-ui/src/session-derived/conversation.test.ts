import { describe, expect, it } from 'vitest'

import { DerivedCache } from './cache.js'
import { createConversationModel, textOf } from './conversation.js'

describe('conversation 模型折叠', () => {
  it('user / assistant 按序追加', () => {
    const model = createConversationModel()
    let state = model.initial()

    state = model.apply(state, { seq: 1, type: 'user/message', data: { text: '把这段重构一下' } })
    state = model.apply(state, { seq: 2, type: 'assistant/message', data: { text: '好的，先看接口' } })

    expect(state.messages.map((m) => [m.role, m.text])).toEqual([
      ['user', '把这段重构一下'],
      ['assistant', '好的，先看接口'],
    ])
    expect(state.messages.get(0)?.seq).toBe(1)
  })

  it('turn 计数与 streaming 状态', () => {
    const model = createConversationModel()
    let state = model.initial()

    state = model.apply(state, { seq: 1, type: 'turn/start' })
    expect(state).toMatchObject({ turns: 1, streaming: true })

    state = model.apply(state, { seq: 2, type: 'turn/end' })
    expect(state).toMatchObject({ turns: 1, streaming: false })
  })

  it('重复的 turn/end 不改状态对象（避免无谓重渲染）', () => {
    const model = createConversationModel()
    const running = model.apply(model.initial(), { seq: 1, type: 'turn/start' })
    const ended = model.apply(running, { seq: 2, type: 'turn/end' })
    const again = model.apply(ended, { seq: 3, type: 'turn/end' })

    expect(again).toBe(ended)
  })

  it('未知事件类型记录但不改消息，也绝不抛错', () => {
    const model = createConversationModel()
    const state = model.apply(model.initial(), { seq: 1, type: 'tool/result', data: { ok: true } })

    expect(state.messages.toArray()).toEqual([])
    expect(state.unknownTypes).toEqual(['tool/result'])
  })

  it('未知类型去重且有上限', () => {
    const model = createConversationModel()
    let state = model.initial()
    state = model.apply(state, { seq: 1, type: 'a/new' })
    state = model.apply(state, { seq: 2, type: 'a/new' })
    expect(state.unknownTypes).toEqual(['a/new'])

    for (let i = 0; i < 40; i += 1) state = model.apply(state, { seq: 10 + i, type: `x/${i}` })
    expect(state.unknownTypes.length).toBeLessThanOrEqual(16)
  })
})

describe('textOf', () => {
  it('常见三种形状', () => {
    expect(textOf('直接是字符串')).toBe('直接是字符串')
    expect(textOf({ text: '扁平的' })).toBe('扁平的')
    expect(textOf({ content: [{ type: 'text', text: '分段' }, { type: 'text', text: '拼起来' }] })).toBe('分段拼起来')
  })

  it('取不到就空串，不抛', () => {
    expect(textOf(undefined)).toBe('')
    expect(textOf(null)).toBe('')
    expect(textOf({})).toBe('')
    expect(textOf({ content: [null, 42] })).toBe('')
  })
})

describe('经缓存的端到端', () => {
  it('一批真实事件折出可渲染的消息', () => {
    const cache = new DerivedCache()
    const handle = cache.acquire('s1', createConversationModel())

    cache.ingest('s1', [
      { seq: 1, type: 'turn/start' },
      { seq: 2, type: 'user/message', data: { text: '跑一下测试' } },
      { seq: 3, type: 'assistant/message', data: { content: [{ type: 'text', text: '44 个用例全绿' }] } },
      { seq: 4, type: 'step/end', data: {} },
      { seq: 5, type: 'turn/end' },
    ])

    const state = handle.state()
    expect(state.status).toBe('ready')
    expect(state.value.turns).toBe(1)
    expect(state.value.streaming).toBe(false)
    expect(state.value.messages.map((m) => m.text)).toEqual(['跑一下测试', '44 个用例全绿'])
    // step/end 是合法事件但对话模型不解释它 —— 记进未知清单，不报错
    expect(state.value.unknownTypes).toContain('step/end')
  })
})
