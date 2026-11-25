// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  asSessionFace,
  Composer,
  defaultComposerLabels,
  type RemoteResultLike,
  type SessionFaceLike,
  type PromptPart,
} from './composer.js'

interface PromptCall {
  readonly content: readonly PromptPart[]
  readonly mode: 'queue' | 'steer'
}

type Accepted = RemoteResultLike<{ readonly accepted: true }>

function fakeSession(result?: () => Promise<Accepted>) {
  const calls: PromptCall[] = []
  const face: SessionFaceLike = {
    async prompt(content, mode) {
      calls.push({ content, mode })
      if (result) return result()
      return { ok: true, value: { accepted: true } }
    },
  }
  return { face, calls }
}

/** 等一帧，让发送流程里的 await 链走完。 */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('asSessionFace', () => {
  it('认出有 prompt 的对象', () => {
    const { face } = fakeSession()
    expect(asSessionFace(face)).toBe(face)
  })

  it('认不出就返回 undefined（输入框降级为禁用）', () => {
    expect(asSessionFace(undefined)).toBeUndefined()
    expect(asSessionFace(null)).toBeUndefined()
    expect(asSessionFace({})).toBeUndefined()
    expect(asSessionFace({ prompt: 'not a function' })).toBeUndefined()
    expect(asSessionFace('session')).toBeUndefined()
  })
})

describe('Composer 发送', () => {
  it('没有可用会话时输入框禁用，并给出原因', () => {
    render(<Composer session={undefined} />)
    const input = screen.getByTestId('studio-composer-input') as HTMLTextAreaElement
    expect(input.disabled).toBe(true)
    expect(input.placeholder).toBe(defaultComposerLabels.unavailable)
  })

  it('空白文本不触发发送', async () => {
    const { face, calls } = fakeSession()
    render(<Composer session={face} />)
    const input = screen.getByTestId('studio-composer-input')

    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await settle()

    expect(calls).toHaveLength(0)
  })

  it('Enter 发送纯文本，mode 用 queue', async () => {
    const { face, calls } = fakeSession()
    render(<Composer session={face} />)
    const input = screen.getByTestId('studio-composer-input')

    fireEvent.change(input, { target: { value: '跑一下测试' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await settle()

    expect(calls).toHaveLength(1)
    expect(calls[0]?.mode).toBe('queue')
    expect(calls[0]?.content).toEqual([{ type: 'text', text: '跑一下测试' }])
  })

  it('发送成功后清空输入框', async () => {
    const { face } = fakeSession()
    render(<Composer session={face} />)
    const input = screen.getByTestId('studio-composer-input') as HTMLTextAreaElement

    fireEvent.change(input, { target: { value: '你好' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await settle()

    expect(input.value).toBe('')
  })

  it('Shift+Enter 不发送（留给换行）', async () => {
    const { face, calls } = fakeSession()
    render(<Composer session={face} />)
    const input = screen.getByTestId('studio-composer-input')

    fireEvent.change(input, { target: { value: '第一行' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    await settle()

    expect(calls).toHaveLength(0)
  })

  it('点按钮也能发送', async () => {
    const { face, calls } = fakeSession()
    render(<Composer session={face} />)
    const input = screen.getByTestId('studio-composer-input')

    fireEvent.change(input, { target: { value: '点按钮' } })
    fireEvent.click(screen.getByTestId('studio-composer-send'))
    await settle()

    expect(calls).toHaveLength(1)
  })

  it('前端去空格后发送', async () => {
    const { face, calls } = fakeSession()
    render(<Composer session={face} />)
    fireEvent.change(screen.getByTestId('studio-composer-input'), { target: { value: '  两边有空格  ' } })
    fireEvent.keyDown(screen.getByTestId('studio-composer-input'), { key: 'Enter' })
    await settle()

    expect(calls[0]?.content).toEqual([{ type: 'text', text: '两边有空格' }])
  })
})

describe('Composer 错误处理', () => {
  it('ok:false 时显示业务错误，且不清空输入', async () => {
    const { face } = fakeSession(async () => ({
      ok: false,
      error: { code: 'gateway/arguments-invalid', message: 'prompt 参数不合法' },
    }))
    render(<Composer session={face} />)
    const input = screen.getByTestId('studio-composer-input') as HTMLTextAreaElement

    fireEvent.change(input, { target: { value: '发出去的' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(screen.getByTestId('studio-composer-error').textContent).toBe('prompt 参数不合法')
    })
    // 失败时保留用户输入，避免重打一遍
    expect(input.value).toBe('发出去的')
  })

  it('只有 code 没有 message 时也能给出可读文案', async () => {
    const { face } = fakeSession(async () => ({ ok: false, error: { code: 'transport/offline' } }))
    render(<Composer session={face} />)

    fireEvent.change(screen.getByTestId('studio-composer-input'), { target: { value: 'x' } })
    fireEvent.keyDown(screen.getByTestId('studio-composer-input'), { key: 'Enter' })

    await waitFor(() => {
      expect(screen.getByTestId('studio-composer-error').textContent).toBe('transport/offline')
    })
  })

  it('prompt 抛错时显示异常信息，不炸组件', async () => {
    const face: SessionFaceLike = {
      prompt: vi.fn(async () => {
        throw new Error('连接断了')
      }) as unknown as SessionFaceLike['prompt'],
    }
    render(<Composer session={face} />)

    fireEvent.change(screen.getByTestId('studio-composer-input'), { target: { value: 'x' } })
    fireEvent.keyDown(screen.getByTestId('studio-composer-input'), { key: 'Enter' })

    await waitFor(() => {
      expect(screen.getByTestId('studio-composer-error').textContent).toBe('连接断了')
    })
    expect(screen.getByTestId('studio-composer-input')).toBeDefined()
  })

  it('发送中不重复提交', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const calls: PromptCall[] = []
    const face: SessionFaceLike = {
      async prompt(content, mode) {
        calls.push({ content, mode })
        await gate
        return { ok: true, value: { accepted: true } }
      },
    }
    render(<Composer session={face} />)
    const input = screen.getByTestId('studio-composer-input')

    fireEvent.change(input, { target: { value: '连发' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await settle()
    fireEvent.keyDown(input, { key: 'Enter' })
    await settle()

    expect(calls).toHaveLength(1)
    release()
    await settle()
  })
})
