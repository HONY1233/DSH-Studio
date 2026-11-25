// @vitest-environment jsdom
/**
 * 会话正文的端到端测试：**事件窗口 → 适配 → 折叠 → 渲染**。
 *
 * 三个单测各自绿但拼起来空白，是这类数据管道最常见的事故。这里故意只用
 * 真实的事件形状（`user/message` 带 `content` 数组），不 mock 中间层，
 * 走完 `toDerivedEntries` → `DerivedCache` → `ConversationBody` 全程。
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DerivedCache } from '../session-derived/cache.js'
import { AttachmentImageCache, type AttachmentReaderLike } from './attachment-images.js'
import { ConversationBody } from './conversation-body.js'
import type { RawEventEntry, RawSessionEventWindow } from './event-adapter.js'
import { SessionEventHub } from './event-hub.js'

const IMAGE_REF = {
  attachmentId: 'sha256-img',
  mediaType: 'image/png',
  bytes: 4096,
  width: 800,
  height: 600,
  name: 'diagram.png',
}

const FILE_REF = { attachmentId: 'sha256-file', name: 'notes.txt', bytes: 128 }

function userMessage(
  seq: number,
  text: string,
  blocks: unknown[] = [],
  sourceKind = 'user',
): RawEventEntry {
  return {
    type: 'event',
    event: {
      type: 'user/message',
      seq,
      time: 1000 + seq,
      data: {
        content: [{ type: 'text', text }, ...blocks],
        source: { kind: sourceKind },
      },
    },
  }
}

/** 静态窗口的假事件源（`ObservableSnapshot<SessionEventWindow>`）。 */
function staticSource(entries: RawEventEntry[]) {
  const window: RawSessionEventWindow = {
    entries,
    hasMore: false,
    revision: 1,
    change: { kind: 'replace', entries },
  }
  return {
    getSnapshot: () => window,
    subscribe: () => () => {},
  }
}

function reader(result: 'ok' | 'fail' = 'ok'): { reader: AttachmentReaderLike; calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    reader: {
      readAttachment: async (attachment) => {
        calls.push(attachment.attachmentId)
        return result === 'ok'
          ? { ok: true, value: { data: new Uint8Array([1, 2, 3]) } }
          : { ok: false, error: { message: '附件已被清理' } }
      },
    },
  }
}

function stubObjectUrl(): void {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:mock') })
}

interface Harness {
  readonly cache: DerivedCache
  readonly hub: SessionEventHub
  readonly images: AttachmentImageCache
}

function harness(): Harness {
  const cache = new DerivedCache({ capacity: 4 })
  return { cache, hub: new SessionEventHub({ cache }), images: new AttachmentImageCache() }
}

function renderBody(h: Harness, entries: RawEventEntry[], session: unknown) {
  return render(
    <ConversationBody
      sessionId="s1"
      active
      cache={h.cache}
      hub={h.hub}
      eventSource={staticSource(entries)}
      session={session}
      attachmentImages={h.images}
    />,
  )
}

describe('会话正文端到端（含附件）', () => {
  it('带图片的消息渲染成 img，读取用 session.readAttachment', async () => {
    stubObjectUrl()
    const h = harness()
    const { reader: r, calls } = reader('ok')
    renderBody(h, [userMessage(1, '看这张图', [{ type: 'image', attachment: IMAGE_REF }])], r)

    await waitFor(() => expect(screen.getByTestId('message-attachment-image')).toBeDefined())
    expect(screen.getByRole('img').getAttribute('src')).toBe('blob:mock')
    expect(calls).toEqual(['sha256-img'])
    // 文字照常渲染，没被附件挤掉
    expect(screen.getByText('看这张图')).toBeDefined()
  })

  it('文件只在气泡里显示元数据，从不发起读取', () => {
    stubObjectUrl()
    const h = harness()
    const { reader: r, calls } = reader('ok')
    renderBody(h, [userMessage(1, '附件在这里', [{ type: 'file', attachment: FILE_REF }])], r)

    const chip = screen.getByTestId('message-attachment-file')
    expect(chip.textContent).toContain('notes.txt')
    expect(chip.textContent).toContain('128 B')
    expect(calls).toHaveLength(0)
  })

  it('图片读取失败时整条消息仍可读（降级不连坐）', async () => {
    stubObjectUrl()
    const h = harness()
    const { reader: r } = reader('fail')
    renderBody(h, [userMessage(1, '说明文字', [{ type: 'image', attachment: IMAGE_REF }])], r)

    await waitFor(() =>
      expect(screen.getByTestId('message-attachment-file').getAttribute('data-failed')).toBe('true'),
    )
    expect(screen.getByText('说明文字')).toBeDefined()
  })

  it('注入消息里的附件默认被折叠掉，不发起读取', () => {
    stubObjectUrl()
    const h = harness()
    const { reader: r, calls } = reader('ok')
    renderBody(
      h,
      [
        // 真人说了一句（保证不是空态），回推里还有一条带图的注入上下文
        userMessage(1, '真正的问题'),
        userMessage(
          2,
          '<system-reminder>x</system-reminder>',
          [{ type: 'image', attachment: IMAGE_REF }],
          'system-prompt',
        ),
      ],
      r,
    )

    // 注入消息整条被收起，附件自然也不渲染
    expect(screen.queryByTestId('message-attachment-image')).toBeNull()
    expect(screen.queryByTestId('message-attachment-file')).toBeNull()
    expect(calls).toHaveLength(0)
    // 但折叠条要说清"收起了几条"
    const toggle = screen.getByTestId('conversation-synthetic-toggle')
    expect(toggle.textContent).toContain('1')
    expect(screen.getByText('真正的问题')).toBeDefined()
  })

  it('只有附件、没有文字的消息不渲染空文本节点', async () => {
    stubObjectUrl()
    const h = harness()
    const { reader: r } = reader('ok')
    renderBody(h, [userMessage(1, '', [{ type: 'file', attachment: FILE_REF }])], r)

    const body = screen.getByTestId('conversation-body')
    const message = body.querySelector('[data-role="user"]')
    expect(message).not.toBeNull()
    // 子节点应该只有：角色标签 + 附件容器
    const children = Array.from(message?.children ?? [])
    expect(children.filter((c) => (c.textContent ?? '').trim() === '')).toHaveLength(0)
  })

  it('同一张图出现在两条消息里也只读一次（缓存按 attachmentId 共享）', async () => {
    stubObjectUrl()
    const h = harness()
    const { reader: r, calls } = reader('ok')
    renderBody(
      h,
      [
        userMessage(1, '第一次', [{ type: 'image', attachment: IMAGE_REF }]),
        userMessage(2, '第二次', [{ type: 'image', attachment: IMAGE_REF }]),
      ],
      r,
    )

    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2))
    expect(calls).toEqual(['sha256-img'])
  })
})

/** 工具调用事件（durable）。 */
function toolCall(seq: number, callId: string, name: string, args = '{}'): RawEventEntry {
  return { type: 'event', event: { type: 'tool/call', seq, time: 2000 + seq, data: { callId, name, arguments: args } } }
}
function toolResult(seq: number, callId: string, text: string, isError = false): RawEventEntry {
  return {
    type: 'event',
    event: {
      type: 'tool/result',
      seq,
      time: 2000 + seq,
      data: { message: { role: 'tool', toolCallId: callId, content: [{ type: 'text', text }], isError } },
    },
  }
}

describe('会话正文端到端（工具调用）', () => {
  it('call + result 折叠成一行工具调用，状态是 done', () => {
    const h = harness()
    renderBody(
      h,
      [
        userMessage(1, '看看 app.ts'),
        toolCall(2, 'c1', 'read_file', '{"path":"src/app.ts"}'),
        toolResult(3, 'c1', 'export const x = 1'),
      ],
      undefined,
    )

    const chip = screen.getByTestId('tool-call')
    expect(chip.getAttribute('data-status')).toBe('done')
    expect(chip.textContent).toContain('read_file')
    expect(chip.textContent).toContain('src/app.ts')
    // 只有一条工具记录 —— 结果合并回去了，没有多出一行
    expect(screen.getAllByTestId('tool-call')).toHaveLength(1)
    // 用户消息照常显示
    expect(screen.getByText('看看 app.ts')).toBeDefined()
  })

  it('展开后能看到结果原文', () => {
    const h = harness()
    renderBody(h, [toolCall(2, 'c1', 'read_file'), toolResult(3, 'c1', 'export const x = 1')], undefined)

    fireEvent.click(screen.getByRole('button', { name: /展开工具调用详情/ }))
    expect(screen.getByTestId('tool-call-detail').textContent).toContain('export const x = 1')
  })

  it('失败的调用显示 error 状态', () => {
    const h = harness()
    renderBody(h, [toolCall(2, 'c1', 'bash'), toolResult(3, 'c1', 'command not found', true)], undefined)

    expect(screen.getByTestId('tool-call').getAttribute('data-status')).toBe('error')
    expect(screen.getByTestId('tool-call').textContent).toContain('失败')
  })

  it('还在跑的调用显示 running', () => {
    const h = harness()
    renderBody(h, [toolCall(2, 'c1', 'grep', '{"pattern":"TODO"}')], undefined)

    const chip = screen.getByTestId('tool-call')
    expect(chip.getAttribute('data-status')).toBe('running')
    expect(chip.textContent).toContain('TODO')
  })

  it('工具调用不套"你/DSH"气泡（有自己的形态）', () => {
    const h = harness()
    renderBody(h, [toolCall(2, 'c1', 'x')], undefined)

    const body = screen.getByTestId('conversation-body')
    // 工具 chip 的祖先里不该出现 data-role
    const chip = screen.getByTestId('tool-call')
    expect(chip.closest('[data-role]')).toBeNull()
    expect(body).toBeDefined()
  })

  it('工具调用夹在消息之间，顺序不乱', () => {
    const h = harness()
    renderBody(
      h,
      [
        userMessage(1, '第一步'),
        toolCall(2, 'c1', 'read_file'),
        toolResult(3, 'c1', 'ok'),
        { type: 'event', event: { type: 'assistant/message', seq: 4, data: { message: { content: [{ type: 'text', text: '读完了' }] } } } },
      ],
      undefined,
    )

    const body = screen.getByTestId('conversation-body')
    const order = Array.from(body.children)
      .map((el) => (el.getAttribute('data-testid') === 'tool-call' ? 'tool' : el.getAttribute('data-role')))
      .filter((v): v is string => v !== null)
    expect(order).toEqual(['user', 'tool', 'assistant'])
  })
})

describe("会话正文端到端（流式思考过程）", () => {
  function thinkLive(attemptId: string, text: string, seq = 1): RawEventEntry {
    return {
      type: "transient",
      event: {
        type: "assistant/live-chunk",
        seq,
        time: 3000,
        data: { attemptId, turn: 1, step: 1, chunk: { type: "reasoning-delta", index: 0, text } },
      },
    }
  }
  function textLive(attemptId: string, text: string, seq = 1): RawEventEntry {
    return {
      type: "transient",
      event: {
        type: "assistant/live-chunk",
        seq,
        time: 3000,
        data: { attemptId, turn: 1, step: 1, chunk: { type: "text-delta", index: 1, text } },
      },
    }
  }

  it("思考默认收起，正文照常显示", () => {
    const h = harness()
    renderBody(h, [userMessage(1, "问"), thinkLive("a", "让我想想"), textLive("a", "答")], undefined)

    expect(screen.getByTestId("conversation-live-reasoning-toggle")).toBeDefined()
    expect(screen.queryByTestId("conversation-live-reasoning")).toBeNull()
    expect(screen.getByTestId("conversation-live").textContent).toContain("答")
  })

  it("展开后能看到思考原文", () => {
    const h = harness()
    renderBody(h, [thinkLive("a", "让我想想"), textLive("a", "答")], undefined)

    fireEvent.click(screen.getByTestId("conversation-live-reasoning-toggle"))
    expect(screen.getByTestId("conversation-live-reasoning").textContent).toBe("让我想想")
  })

  it("只有思考没有正文时也有界面（不会一片空白）", () => {
    const h = harness()
    renderBody(h, [thinkLive("a", "正在分析…")], undefined)

    expect(screen.getByTestId("conversation-live")).toBeDefined()
    expect(screen.getByTestId("conversation-live-reasoning-toggle")).toBeDefined()
  })

  it("没有思考时不渲染切换按钮", () => {
    const h = harness()
    renderBody(h, [textLive("a", "直接答")], undefined)
    expect(screen.queryByTestId("conversation-live-reasoning-toggle")).toBeNull()
  })
})

describe("会话正文端到端（跨消息相册）", () => {
  const IMG_A = { attachmentId: "sha256-a", mediaType: "image/png", bytes: 100, name: "a.png" }
  const IMG_B = { attachmentId: "sha256-b", mediaType: "image/png", bytes: 200, name: "b.png" }
  const IMG_C = { attachmentId: "sha256-c", mediaType: "image/png", bytes: 300, name: "c.png" }

  it("点第一条消息里的图，能翻到第二条消息里的图", async () => {
    stubObjectUrl()
    const h = harness()
    const { reader: r } = reader("ok")
    renderBody(
      h,
      [
        userMessage(1, "第一张", [{ type: "image", attachment: IMG_A }]),
        userMessage(2, "第二张", [{ type: "image", attachment: IMG_B }]),
        userMessage(3, "第三张", [{ type: "image", attachment: IMG_C }]),
      ],
      r,
    )

    await waitFor(() => expect(screen.getAllByTestId("message-attachment-image")).toHaveLength(3))
    fireEvent.click(screen.getAllByTestId("message-attachment-image")[0])
    expect(screen.getByTestId("image-lightbox-counter").textContent).toContain("1 / 3")

    fireEvent.keyDown(window, { key: "ArrowRight" })
    fireEvent.keyDown(window, { key: "ArrowRight" })
    expect(screen.getByTestId("image-lightbox-counter").textContent).toContain("3 / 3")
    // 缩略图与遮罩里都有同 alt 的 img，必须限定在遮罩内查
    expect(within(screen.getByTestId("image-lightbox")).getByAltText("c.png")).toBeDefined()
  })

  it("被折叠的系统上下文里的图不进相册（翻不到自己没见过的图）", async () => {
    stubObjectUrl()
    const h = harness()
    const { reader: r } = reader("ok")
    renderBody(
      h,
      [
        // 注入消息（synthetic）：默认收起
        userMessage(1, "系统注入", [{ type: "image", attachment: IMG_A }], "runtime-context"),
        userMessage(2, "我问的", [{ type: "image", attachment: IMG_B }]),
      ],
      r,
    )

    await waitFor(() => expect(screen.getAllByTestId("message-attachment-image")).toHaveLength(1))
    fireEvent.click(screen.getAllByTestId("message-attachment-image")[0])
    // 相册只有可见的那一张
    expect(screen.queryByTestId("image-lightbox-counter")).toBeNull()
    expect(within(screen.getByTestId("image-lightbox")).getByAltText("b.png")).toBeDefined()
  })
})
