import { describe, expect, it } from 'vitest'

import { toDerivedEntries, toDerivedEntry, attachmentsOfBlocks, textOfBlocks, type RawEventEntry } from './event-adapter.js'

function event(type: string, data: unknown, seq = 1): RawEventEntry {
  return { type: 'event', event: { type, seq, time: 1000, data } }
}

describe('textOfBlocks', () => {
  it('拼文本块，跳过非文本块', () => {
    expect(textOfBlocks([{ type: 'text', text: '甲' }, { type: 'image' }, { type: 'text', text: '乙' }])).toBe('甲乙')
    expect(textOfBlocks('直接字符串')).toBe('直接字符串')
    expect(textOfBlocks([])).toBe('')
    expect(textOfBlocks(undefined)).toBe('')
  })

  it('不因畸形输入抛错', () => {
    expect(textOfBlocks([null, 42, {}, { text: 123 }])).toBe('')
  })
})

describe('toDerivedEntry 事件映射', () => {
  it('assistant/message 的文本在 data.message.content 里（不是 data.content）', () => {
    const entry = toDerivedEntry(
      event('assistant/message', {
        turn: 1,
        step: 1,
        message: { role: 'assistant', content: [{ type: 'text', text: '这是回答' }] },
        stream: [],
      }),
    )
    expect(entry).toEqual({ seq: 1, type: 'assistant/message', data: { text: '这是回答' } })
  })

  it('user/message 携带 source.kind=user 时不标记 synthetic', () => {
    const entry = toDerivedEntry(
      event('user/message', { content: [{ type: 'text', text: '真人说的' }], source: { kind: 'user' } }),
    )
    expect(entry?.data).toEqual({ text: '真人说的', synthetic: false })
  })

  it('user/message 携带其它 source.kind 时标记 synthetic', () => {
    // 真机实测：system-reminder 注入也是 user/message，但 source.kind 是 system-prompt
    const entry = toDerivedEntry(
      event('user/message', {
        content: [{ type: 'text', text: '<system-reminder>…' }],
        source: { kind: 'system-prompt' },
      }),
    )
    expect(entry?.data).toEqual({ text: '<system-reminder>…', synthetic: true })
  })

  it('user/message 没有 source 时按真人处理（保守假设）', () => {
    const entry = toDerivedEntry(event('user/message', { content: [{ type: 'text', text: 'x' }] }))
    expect((entry?.data as { synthetic: boolean }).synthetic).toBe(false)
  })

  it('插件自定义的 source.kind 也按注入处理', () => {
    const entry = toDerivedEntry(
      event('user/message', { content: [{ type: 'text', text: 'agent inject' }], source: { kind: 'agent-inject' } }),
    )
    expect((entry?.data as { synthetic: boolean }).synthetic).toBe(true)
  })

  it('turn 边界事件原样透传（模型自己解释）', () => {
    const entry = toDerivedEntry(event('turn/start', { turn: 2 }))
    expect(entry?.data).toEqual({ turn: 2 })
    expect(entry?.type).toBe('turn/start')
  })

  it('transient 与畸形条目返回 undefined', () => {
    expect(
      toDerivedEntry({
        type: 'transient',
        event: { type: 'assistant/live-chunk', seq: 1, data: {} },
      }),
    ).toBeUndefined()
    expect(toDerivedEntry({ type: 'event', event: { type: 'x', seq: Number.NaN } } as RawEventEntry)).toBeUndefined()
    expect(toDerivedEntry({} as RawEventEntry)).toBeUndefined()
  })
})

describe('toDerivedEntries', () => {
  it('批量映射并丢掉 transient', () => {
    const entries: RawEventEntry[] = [
      event('turn/start', { turn: 1 }, 1),
      { type: 'transient', event: { type: 'assistant/live-chunk', seq: 2, data: {} } },
      event('user/message', { content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }, 3),
    ]
    const mapped = toDerivedEntries(entries)
    expect(mapped.map((e) => e.seq)).toEqual([1, 3])
  })
})

// ---------------------------------------------------------------- 附件

const IMAGE_REF = {
  attachmentId: 'sha256-abc',
  mediaType: 'image/png',
  bytes: 2048,
  width: 640,
  height: 480,
  name: 'shot.png',
}

const FILE_REF = { attachmentId: 'sha256-def', name: 'notes.txt', bytes: 14 }

describe('attachmentsOfBlocks', () => {
  it('按块顺序取出图片与文件', () => {
    const out = attachmentsOfBlocks([
      { type: 'text', text: '看这两个' },
      { type: 'image', attachment: IMAGE_REF },
      { type: 'file', attachment: FILE_REF },
    ])
    expect(out).toEqual([
      { kind: 'image', attachmentId: 'sha256-abc', mediaType: 'image/png', bytes: 2048, width: 640, height: 480, name: 'shot.png' },
      { kind: 'file', attachmentId: 'sha256-def', name: 'notes.txt', bytes: 14 },
    ])
  })

  it('没有附件时返回空数组（调用方据此不写字段）', () => {
    expect(attachmentsOfBlocks([{ type: 'text', text: '纯文字' }])).toEqual([])
    expect(attachmentsOfBlocks(undefined)).toEqual([])
    expect(attachmentsOfBlocks('字符串')).toEqual([])
  })

  it('缺 attachmentId 的引用整条丢掉（读不了，不渲染必然失败的占位）', () => {
    const out = attachmentsOfBlocks([
      { type: 'image', attachment: { mediaType: 'image/png', bytes: 1 } },
      { type: 'file', attachment: { name: 'a.txt', bytes: 1 } },
      { type: 'image', attachment: null },
    ])
    expect(out).toEqual([])
  })

  it('未知块类型与畸形块不影响其它块', () => {
    const out = attachmentsOfBlocks([
      null,
      42,
      { type: 'reasoning', text: '思考' },
      { type: 'image', attachment: IMAGE_REF },
    ])
    expect(out).toHaveLength(1)
  })

  it('bytes 非有限数时归零，而不是 NaN 传到格式化里', () => {
    const out = attachmentsOfBlocks([{ type: 'file', attachment: { attachmentId: 'x', name: 'a', bytes: Number.NaN } }])
    expect(out[0]?.bytes).toBe(0)
  })

  it('图片没有名字时省略字段（粘贴的图通常无名）', () => {
    const out = attachmentsOfBlocks([
      { type: 'image', attachment: { attachmentId: 'y', mediaType: 'image/png', bytes: 10, width: 1, height: 1 } },
    ])
    expect(out[0]).not.toHaveProperty('name')
  })
})

describe('附件进入折叠信封', () => {
  it('user/message 带上附件，且不影响 synthetic 判定', () => {
    const entry = toDerivedEntry(
      event('user/message', {
        content: [{ type: 'text', text: '看这个' }, { type: 'image', attachment: IMAGE_REF }],
        source: { kind: 'user' },
      }),
    )
    expect(entry?.data).toEqual({
      text: '看这个',
      synthetic: false,
      attachments: [
        { kind: 'image', attachmentId: 'sha256-abc', mediaType: 'image/png', bytes: 2048, width: 640, height: 480, name: 'shot.png' },
      ],
    })
  })

  it('注入的 system-reminder 即便带附件也仍是 synthetic', () => {
    const entry = toDerivedEntry(
      event('user/message', {
        content: [{ type: 'text', text: 'reminder' }, { type: 'file', attachment: FILE_REF }],
        source: { kind: 'system-prompt' },
      }),
    )
    const data = entry?.data as { synthetic: boolean; attachments: unknown[] }
    expect(data.synthetic).toBe(true)
    expect(data.attachments).toHaveLength(1)
  })

  it('没有附件时不写 attachments 字段（保持信封最小）', () => {
    const entry = toDerivedEntry(
      event('assistant/message', {
        message: { role: 'assistant', content: [{ type: 'text', text: '答' }] },
      }),
    )
    expect(entry?.data).toEqual({ text: '答' })
    expect(entry?.data).not.toHaveProperty('attachments')
  })
})

// ---------------------------------------------------------------- 工具调用

describe('tool/call 与 tool/result 的映射', () => {
  it('tool/call 带出 callId / name / 原始 arguments', () => {
    const entry = toDerivedEntry(
      event('tool/call', {
        turn: 1,
        step: 1,
        callId: 'call-1',
        name: 'read_file',
        arguments: '{"path":"src/app.ts"}',
      }),
    )
    expect(entry).toEqual({
      seq: 1,
      type: 'tool/call',
      data: { callId: 'call-1', name: 'read_file', arguments: '{"path":"src/app.ts"}' },
    })
  })

  it('tool/call 的非法 JSON 参数原样保留（不解析、不丢弃）', () => {
    const entry = toDerivedEntry(event('tool/call', { callId: 'c', name: 'x', arguments: '{oops' }))
    expect((entry?.data as { arguments: string }).arguments).toBe('{oops')
  })

  it('tool/call 字段缺失时给空串而不是 undefined', () => {
    const entry = toDerivedEntry(event('tool/call', {}))
    expect(entry?.data).toEqual({ callId: '', name: '', arguments: '' })
  })

  it('tool/result 从 message.content 取结果文本', () => {
    const entry = toDerivedEntry(
      event('tool/result', {
        turn: 1,
        step: 1,
        message: {
          role: 'tool',
          toolCallId: 'call-1',
          content: [{ type: 'text', text: '文件内容' }],
          isError: false,
        },
      }),
    )
    expect(entry?.data).toEqual({ callId: 'call-1', text: '文件内容', isError: false })
  })

  it('tool/result 的 isError 透传', () => {
    const entry = toDerivedEntry(
      event('tool/result', {
        message: { toolCallId: 'c', content: [{ type: 'text', text: '失败' }], isError: true },
      }),
    )
    expect((entry?.data as { isError: boolean }).isError).toBe(true)
  })

  it('tool/result 的错误码从 error.code 取，没有时退回 reason', () => {
    const withCode = toDerivedEntry(
      event('tool/result', {
        message: { toolCallId: 'c', content: [{ type: 'text', text: 'x' }], isError: true },
        error: { name: 'AttachmentError', code: 'ATTACHMENT_NOT_FOUND' },
      }),
    )
    expect((withCode?.data as { error?: string }).error).toBe('ATTACHMENT_NOT_FOUND')

    const withReason = toDerivedEntry(
      event('tool/result', {
        message: { toolCallId: 'c', content: [{ type: 'text', text: 'x' }], isError: true },
        reason: '文件不存在',
      }),
    )
    expect((withReason?.data as { error?: string }).error).toBe('文件不存在')
  })

  it('tool/result 没有错误时不写 error 字段', () => {
    const entry = toDerivedEntry(
      event('tool/result', { message: { toolCallId: 'c', content: [{ type: 'text', text: 'ok' }] } }),
    )
    expect(entry?.data).not.toHaveProperty('error')
  })

  it('tool/result 缺 toolCallId 时 callId 为空串（折叠层据此记 unknownTypes）', () => {
    const entry = toDerivedEntry(event('tool/result', { message: { content: [] } }))
    expect((entry?.data as { callId: string }).callId).toBe('')
  })
})
