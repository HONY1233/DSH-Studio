// @vitest-environment jsdom
/**
 * 附件渲染的组件测试。
 *
 * 重点不是"能不能画出来"，而是三条降级行为：
 * - 文件不发起读取（没有接口，硬读就是白转圈）；
 * - 图片加载中显示 chip 而不是空框；
 * - 读取失败降级成 chip，且能说清原因。
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { MessageAttachment } from '../session-derived/conversation.js'
import { AttachmentImageCache, type AttachmentReaderLike } from './attachment-images.js'
import { defaultAttachmentLabels, formatBytes, MessageAttachments } from './attachment-view.js'

const IMAGE: MessageAttachment = {
  kind: 'image',
  attachmentId: 'sha256-abc',
  mediaType: 'image/png',
  bytes: 2048,
  width: 640,
  height: 480,
  name: 'shot.png',
}

const FILE: MessageAttachment = {
  kind: 'file',
  attachmentId: 'sha256-def',
  name: 'notes.txt',
  bytes: 14,
}

function stubObjectUrl(): void {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:mock') })
}

function okReader(): { reader: AttachmentReaderLike; calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    reader: {
      readAttachment: async (attachment) => {
        calls.push(attachment.attachmentId)
        return { ok: true, value: { data: new Uint8Array([1, 2, 3]) } }
      },
    },
  }
}

function failReader(message: string): AttachmentReaderLike {
  return { readAttachment: async () => ({ ok: false, error: { message } }) }
}

describe('formatBytes', () => {
  it('小数与整数的分级', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(14)).toBe('14 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1024 * 1024 * 128)).toBe('128 MB')
  })

  it('非法输入给占位而不是 NaN', () => {
    expect(formatBytes(Number.NaN)).toBe('—')
    expect(formatBytes(-1)).toBe('—')
  })
})

describe('MessageAttachments', () => {
  it('文件渲染成 chip，不发读取请求', () => {
    stubObjectUrl()
    const { reader, calls } = okReader()
    render(<MessageAttachments attachments={[FILE]} reader={reader} cache={new AttachmentImageCache()} />)

    const chip = screen.getByTestId('message-attachment-file')
    expect(chip.textContent).toContain('notes.txt')
    expect(chip.textContent).toContain('14 B')
    expect(calls).toHaveLength(0)
  })

  it('图片加载中先显示 chip（不留空框）', () => {
    stubObjectUrl()
    // 永不 resolve 的读取
    const reader: AttachmentReaderLike = { readAttachment: () => new Promise(() => {}) }
    render(<MessageAttachments attachments={[IMAGE]} reader={reader} cache={new AttachmentImageCache()} />)

    const pending = screen.getByTestId('message-attachment-pending')
    expect(pending.getAttribute('data-status')).toBe('loading')
    expect(screen.queryByTestId('message-attachment-image')).toBeNull()
  })

  it('加载完成后渲染 img，src 来自 blob URL', async () => {
    stubObjectUrl()
    const { reader } = okReader()
    render(<MessageAttachments attachments={[IMAGE]} reader={reader} cache={new AttachmentImageCache()} />)

    await waitFor(() => expect(screen.getByTestId('message-attachment-image')).toBeDefined())
    const img = screen.getByRole('img') as HTMLImageElement
    expect(img.getAttribute('src')).toBe('blob:mock')
    expect(img.getAttribute('alt')).toBe('shot.png')
  })

  it('读取失败降级成 chip，并把原因放进 title', async () => {
    stubObjectUrl()
    render(
      <MessageAttachments
        attachments={[IMAGE]}
        reader={failReader('附件已被清理')}
        cache={new AttachmentImageCache()}
      />,
    )

    await waitFor(() =>
      expect(screen.getByTestId('message-attachment-file').getAttribute('data-failed')).toBe('true'),
    )
    const title = screen.getByTestId('message-attachment-file').getAttribute('title') ?? ''
    expect(title).toContain('附件已被清理')
    expect(screen.queryByTestId('message-attachment-image')).toBeNull()
  })

  it('点击图片打开全屏查看，Esc 关闭', async () => {
    stubObjectUrl()
    const { reader } = okReader()
    render(<MessageAttachments attachments={[IMAGE]} reader={reader} cache={new AttachmentImageCache()} />)

    await waitFor(() => expect(screen.getByTestId('message-attachment-image')).toBeDefined())
    fireEvent.click(screen.getByTestId('message-attachment-image'))
    expect(screen.getByTestId('image-lightbox')).toBeDefined()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('image-lightbox')).toBeNull()
  })

  it('多附件混合渲染，图片与文件各自成型', async () => {
    stubObjectUrl()
    const { reader } = okReader()
    render(<MessageAttachments attachments={[IMAGE, FILE]} reader={reader} cache={new AttachmentImageCache()} />)

    await waitFor(() => expect(screen.getByTestId('message-attachment-image')).toBeDefined())
    expect(screen.getByTestId('message-attachment-file').textContent).toContain('notes.txt')
    expect(screen.getByTestId('message-attachments').getAttribute('data-count')).toBe('2')
  })

  it('两个视图共用同一缓存时只读一次', async () => {
    stubObjectUrl()
    const cache = new AttachmentImageCache()
    const { reader, calls } = okReader()

    const first = render(<MessageAttachments attachments={[IMAGE]} reader={reader} cache={cache} />)
    await waitFor(() => expect(first.getByTestId('message-attachment-image')).toBeDefined())
    first.unmount()

    // 第二次挂载（相当于拖拽分屏后子树重建）
    const second = render(<MessageAttachments attachments={[IMAGE]} reader={reader} cache={cache} />)
    await waitFor(() => expect(second.getByTestId('message-attachment-image')).toBeDefined())

    expect(calls).toHaveLength(1)
  })

  it('空数组不渲染容器', () => {
    const { container } = render(
      <MessageAttachments attachments={[]} reader={undefined} cache={new AttachmentImageCache()} />,
    )
    expect(container.querySelector('[data-testid="message-attachments"]')).toBeNull()
  })

  it('缺 reader 时图片降级（新会话还没拿到 binding 也不炸）', () => {
    stubObjectUrl()
    render(<MessageAttachments attachments={[IMAGE]} reader={undefined} cache={new AttachmentImageCache()} />)
    expect(screen.getByTestId('message-attachment-file').getAttribute('data-failed')).toBe('true')
  })

  it('自定义文案生效', async () => {
    stubObjectUrl()
    render(
      <MessageAttachments
        attachments={[IMAGE]}
        reader={okReader().reader}
        cache={new AttachmentImageCache()}
        labels={{ ...defaultAttachmentLabels, enlargeImage: '查看大图', image: '照片' }}
      />,
    )
    await waitFor(() => expect(screen.getByTestId('message-attachment-image')).toBeDefined())
    expect(screen.getByTestId('message-attachment-image').getAttribute('aria-label')).toBe('查看大图')
  })
})

describe('同一条消息里的多图相册', () => {
  const shots: MessageAttachment[] = ['a', 'b', 'c'].map((key) => ({
    kind: 'image',
    attachmentId: `sha256-${key}`,
    mediaType: 'image/png',
    bytes: 1024,
    name: `${key}.png`,
  }))

  it('点第二张打开时定位到第二张，并能翻到第三张', async () => {
    stubObjectUrl()
    render(<MessageAttachments attachments={shots} reader={okReader().reader} cache={new AttachmentImageCache()} />)
    await waitFor(() => expect(screen.getAllByTestId('message-attachment-image')).toHaveLength(3))

    fireEvent.click(screen.getAllByTestId('message-attachment-image')[1])
    expect(screen.getByTestId('image-lightbox-counter').textContent).toContain('2 / 3')
    expect(within(screen.getByTestId('image-lightbox')).getByAltText('b.png')).toBeDefined()

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(within(screen.getByTestId('image-lightbox')).getByAltText('c.png')).toBeDefined()
  })

  it('读取失败的图不进相册（否则翻页会闪一张空图）', async () => {
    stubObjectUrl()
    // 第 2 张失败：相册只应有 2 张，且顺序保持
    const reader: AttachmentReaderLike = {
      readAttachment: async (attachment) =>
        attachment.attachmentId === 'sha256-b'
          ? { ok: false, error: { message: '附件已被清理' } }
          : { ok: true, value: { data: new Uint8Array([1]) } },
    }
    render(<MessageAttachments attachments={shots} reader={reader} cache={new AttachmentImageCache()} />)
    await waitFor(() => expect(screen.getAllByTestId('message-attachment-image')).toHaveLength(2))

    fireEvent.click(screen.getAllByTestId('message-attachment-image')[1])
    // 界面上第 2 张好图是 c
    expect(screen.getByTestId('image-lightbox-counter').textContent).toContain('2 / 2')
    expect(within(screen.getByTestId('image-lightbox')).getByAltText('c.png')).toBeDefined()
  })

  it('单图消息不出现翻页控件', async () => {
    stubObjectUrl()
    render(<MessageAttachments attachments={[IMAGE]} reader={okReader().reader} cache={new AttachmentImageCache()} />)
    await waitFor(() => expect(screen.getByTestId('message-attachment-image')).toBeDefined())
    fireEvent.click(screen.getByTestId('message-attachment-image'))
    expect(screen.queryByTestId('image-lightbox-counter')).toBeNull()
  })

  it('同一张图在两条消息里共享缓存，不重复读（相册批量读取也要幂等）', async () => {
    stubObjectUrl()
    const { reader, calls } = okReader()
    const cache = new AttachmentImageCache()
    render(<MessageAttachments attachments={[IMAGE]} reader={reader} cache={cache} />)
    await waitFor(() => expect(screen.getByTestId('message-attachment-image')).toBeDefined())
    render(<MessageAttachments attachments={[IMAGE]} reader={reader} cache={cache} />)
    await waitFor(() => expect(screen.getAllByTestId('message-attachment-image')).toHaveLength(2))
    expect(calls).toEqual(['sha256-abc'])
  })
})
