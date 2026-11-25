// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import {
  Composer,
  type FileUploadServiceLike,
  type PromptPart,
  type RemoteResultLike,
  type SessionFaceLike,
} from './composer.js'

type Accepted = RemoteResultLike<{ readonly accepted: true }>

interface PromptCall {
  readonly content: readonly PromptPart[]
  readonly mode: 'queue' | 'steer'
}

function fakeSession(): { face: SessionFaceLike; calls: PromptCall[] } {
  const calls: PromptCall[] = []
  const face: SessionFaceLike = {
    async prompt(content, mode) {
      calls.push({ content, mode })
      return { ok: true, value: { accepted: true } }
    },
  }
  return { face, calls }
}

interface FakeUploader {
  readonly service: FileUploadServiceLike
  readonly uploads: { sessionId: string; name?: string; type: string }[]
  readonly images: { sessionId: string; mediaType: string }[]
  readonly release: () => void
}

function fakeUploader(options: { fail?: boolean; delay?: boolean } = {}): FakeUploader {
  const uploads: FakeUploader['uploads'] = []
  const images: FakeUploader['images'] = []
  let release: (() => void) | undefined
  const gate = options.delay
    ? new Promise<void>((resolve) => {
        release = resolve
      })
    : undefined

  const service: FileUploadServiceLike = {
    async upload(sessionId, data, name) {
      uploads.push({ sessionId, name, type: data.type })
      if (gate) await gate
      return options.fail
        ? { ok: false as const, error: { message: 'too large' } }
        : { ok: true as const, value: { receiptId: 'r-1' } }
    },
    async uploadImage(sessionId, _data, mediaType) {
      images.push({ sessionId, mediaType })
      if (gate) await gate
      return { ok: true as const, value: { receiptId: 'r-img' } }
    },
  }

  return { service, uploads, images, release: () => release?.() }
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

function pickFiles(files: File[]): void {
  fireEvent.change(screen.getByTestId('studio-composer-file-input'), { target: { files } })
}

beforeAll(() => {
  // jsdom 没有 createObjectURL；图片预览要用
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:mock') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
})

describe('Composer 附件入口可用性', () => {
  it('没有上传服务时按钮禁用', () => {
    const { face } = fakeSession()
    render(<Composer session={face} sessionId="s1" />)
    expect((screen.getByTestId('studio-composer-attach') as HTMLButtonElement).disabled).toBe(true)
  })

  it('有上传服务但缺 sessionId 时也禁用（receipt 是按会话归属的）', () => {
    const { face } = fakeSession()
    const { service } = fakeUploader()
    render(<Composer session={face} uploader={service} />)
    expect((screen.getByTestId('studio-composer-attach') as HTMLButtonElement).disabled).toBe(true)
  })

  it('两者齐全时可用', () => {
    const { face } = fakeSession()
    const { service } = fakeUploader()
    render(<Composer session={face} sessionId="s1" uploader={service} />)
    expect((screen.getByTestId('studio-composer-attach') as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('Composer 上传', () => {
  it('普通文件走 upload，成功后 chip 变 ready', async () => {
    const { face } = fakeSession()
    const { service, uploads } = fakeUploader()
    render(<Composer session={face} sessionId="s1" uploader={service} />)

    pickFiles([new File(['hello'], 'notes.txt', { type: 'text/plain' })])
    await settle()

    expect(uploads).toHaveLength(1)
    expect(uploads[0]?.sessionId).toBe('s1')
    expect(uploads[0]?.name).toBe('notes.txt')
    expect(screen.getByTestId('studio-composer-attachment').getAttribute('data-status')).toBe('ready')
  })

  it('图片走 uploadImage（Host 会校验与规范化）', async () => {
    const { face } = fakeSession()
    const { service, images } = fakeUploader()
    render(<Composer session={face} sessionId="s1" uploader={service} />)

    pickFiles([new File(['png'], 'shot.png', { type: 'image/png' })])
    await settle()

    expect(images).toHaveLength(1)
    expect(images[0]?.mediaType).toBe('image/png')
  })

  it('多选文件各自上传', async () => {
    const { face } = fakeSession()
    const { service, uploads } = fakeUploader()
    render(<Composer session={face} sessionId="s1" uploader={service} />)

    pickFiles([
      new File(['a'], 'a.txt', { type: 'text/plain' }),
      new File(['b'], 'b.bin', { type: 'application/octet-stream' }),
    ])
    await settle()

    expect(uploads).toHaveLength(2)
    expect(screen.getAllByTestId('studio-composer-attachment')).toHaveLength(2)
  })

  it('上传失败时 chip 标 failed 并带错误原因', async () => {
    const { face } = fakeSession()
    const { service } = fakeUploader({ fail: true })
    render(<Composer session={face} sessionId="s1" uploader={service} />)

    pickFiles([new File(['a'], 'big.bin', { type: 'application/octet-stream' })])
    await settle()

    const item = screen.getByTestId('studio-composer-attachment')
    expect(item.getAttribute('data-status')).toBe('failed')
    expect(item.textContent).toContain('too large')
  })

  it('上传中禁用发送，完成后恢复', async () => {
    const { face } = fakeSession()
    const u = fakeUploader({ delay: true })
    render(<Composer session={face} sessionId="s1" uploader={u.service} />)

    fireEvent.change(screen.getByTestId('studio-composer-input'), { target: { value: '等附件' } })
    pickFiles([new File(['a'], 'a.txt', { type: 'text/plain' })])
    await settle()

    expect((screen.getByTestId('studio-composer-send') as HTMLButtonElement).disabled).toBe(true)

    await act(async () => {
      u.release()
      await Promise.resolve()
    })
    expect((screen.getByTestId('studio-composer-send') as HTMLButtonElement).disabled).toBe(false)
  })

  it('可以移除已上传的附件', async () => {
    const { face } = fakeSession()
    const { service } = fakeUploader()
    render(<Composer session={face} sessionId="s1" uploader={service} />)

    pickFiles([new File(['a'], 'a.txt', { type: 'text/plain' })])
    await settle()
    fireEvent.click(screen.getByTestId('studio-composer-attachment-remove'))

    expect(screen.queryByTestId('studio-composer-attachment')).toBeNull()
  })
})

describe('Composer 带附件发送', () => {
  it('文字 + 附件 → text part 在前，file part 在后', async () => {
    const { face, calls } = fakeSession()
    const { service } = fakeUploader()
    render(<Composer session={face} sessionId="s1" uploader={service} />)

    pickFiles([new File(['a'], 'a.txt', { type: 'text/plain' })])
    await settle()
    fireEvent.change(screen.getByTestId('studio-composer-input'), { target: { value: '看这个' } })
    fireEvent.keyDown(screen.getByTestId('studio-composer-input'), { key: 'Enter' })
    await settle()

    expect(calls).toHaveLength(1)
    expect(calls[0]?.content).toEqual([
      { type: 'text', text: '看这个' },
      { type: 'file', receiptId: 'r-1' },
    ])
  })

  it('只有附件、没有文字也能发送', async () => {
    const { face, calls } = fakeSession()
    const { service } = fakeUploader()
    render(<Composer session={face} sessionId="s1" uploader={service} />)

    pickFiles([new File(['a'], 'a.txt', { type: 'text/plain' })])
    await settle()
    fireEvent.click(screen.getByTestId('studio-composer-send'))
    await settle()

    expect(calls).toHaveLength(1)
    expect(calls[0]?.content).toEqual([{ type: 'file', receiptId: 'r-1' }])
  })

  it('上传失败时不允许发送', async () => {
    const { face, calls } = fakeSession()
    const { service } = fakeUploader({ fail: true })
    render(<Composer session={face} sessionId="s1" uploader={service} />)

    pickFiles([new File(['a'], 'big.bin', { type: 'application/octet-stream' })])
    await settle()
    fireEvent.change(screen.getByTestId('studio-composer-input'), { target: { value: 'x' } })
    fireEvent.click(screen.getByTestId('studio-composer-send'))
    await settle()

    // 有文字但附件失败 → 仍可发送文字（失败附件被排除，不会静默丢内容）
    expect(calls).toHaveLength(1)
    expect(calls[0]?.content).toEqual([{ type: 'text', text: 'x' }])
  })

  it('发送成功后清空附件列表', async () => {
    const { face } = fakeSession()
    const { service } = fakeUploader()
    render(<Composer session={face} sessionId="s1" uploader={service} />)

    pickFiles([new File(['a'], 'a.txt', { type: 'text/plain' })])
    await settle()
    fireEvent.change(screen.getByTestId('studio-composer-input'), { target: { value: '带走' } })
    fireEvent.keyDown(screen.getByTestId('studio-composer-input'), { key: 'Enter' })
    await settle()

    expect(screen.queryByTestId('studio-composer-attachment')).toBeNull()
  })
})
