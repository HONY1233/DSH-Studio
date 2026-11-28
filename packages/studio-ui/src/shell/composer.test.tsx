// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { SessionViewsProvider } from '../ui-session-views/provider.js'
import { SessionViewStore, type ConversationIdentity } from '../ui-session-views/session-view-store.js'
import { useOwnerSessionView } from '../ui-session-views/use-session-view.js'

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
  readonly requestId?: string
}

type Accepted = RemoteResultLike<{ readonly accepted: true }>

function fakeSession(result?: () => Promise<Accepted>) {
  const calls: PromptCall[] = []
  const face: SessionFaceLike = {
    async prompt(content, mode, _signal, requestId) {
      calls.push({ content, mode, ...(requestId === undefined ? {} : { requestId }) })
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

function SharedComposer(props: {
  readonly store: SessionViewStore
  readonly owner: ConversationIdentity
  readonly session: SessionFaceLike
  readonly sessionId: string
  readonly uploader?: unknown
}): ReactNode {
  const { projection, dispatchDraft } = useOwnerSessionView(props.owner)
  return (
    <Composer
      session={props.session}
      sessionId={props.sessionId}
      uploader={props.uploader}
      draft={projection?.draft ?? null}
      draftOwner={props.owner}
      dispatchDraft={dispatchDraft}
    />
  )
}

function sharedTree(store: SessionViewStore, owner: ConversationIdentity, session: SessionFaceLike, uploader?: unknown): ReactNode {
  return (
    <SessionViewsProvider registry={{} as never} store={store}>
      <SharedComposer store={store} owner={owner} session={session} sessionId={owner.id} uploader={uploader} />
    </SessionViewsProvider>
  )
}

describe('Composer owner-scoped sharing', () => {
  it('two same-session views share text and permit only one request with a requestId', async () => {
    const store = new SessionViewStore()
    const owner = { kind: 'session' as const, id: 'session-a' }
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const calls: PromptCall[] = []
    const face: SessionFaceLike = {
      async prompt(content, mode, _signal, requestId) {
        calls.push({ content, mode, ...(requestId === undefined ? {} : { requestId }) })
        await gate
        return { ok: true, value: { accepted: true } }
      },
    }
    render(
      <SessionViewsProvider registry={{} as never} store={store}>
        <div data-testid="view-a"><SharedComposer store={store} owner={owner} session={face} sessionId={owner.id} /></div>
        <div data-testid="view-b"><SharedComposer store={store} owner={owner} session={face} sessionId={owner.id} /></div>
      </SessionViewsProvider>,
    )
    const first = within(screen.getByTestId('view-a')).getByTestId('studio-composer-input')
    const second = within(screen.getByTestId('view-b')).getByTestId('studio-composer-input')
    fireEvent.change(first, { target: { value: 'shared' } })
    expect((second as HTMLTextAreaElement).value).toBe('shared')
    fireEvent.keyDown(first, { key: 'Enter' })
    fireEvent.keyDown(second, { key: 'Enter' })
    await settle()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.requestId).toEqual(expect.any(String))
    release()
    await settle()
  })

  it('A/B owners keep independent drafts in the same store', () => {
    const store = new SessionViewStore()
    const { face } = fakeSession()
    const ownerA = { kind: 'session' as const, id: 'session-a' }
    const ownerB = { kind: 'session' as const, id: 'session-b' }
    render(<>{sharedTree(store, ownerA, face)}{sharedTree(store, ownerB, face)}</>)
    const [first, second] = screen.getAllByTestId('studio-composer-input') as HTMLTextAreaElement[]
    fireEvent.change(first!, { target: { value: 'only A' } })
    expect(first!.value).toBe('only A')
    expect(second!.value).toBe('')
  })

  it('a late success does not clear newer text entered while sending', async () => {
    const store = new SessionViewStore()
    const owner = { kind: 'session' as const, id: 'session-a' }
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const face: SessionFaceLike = {
      async prompt() { await gate; return { ok: true, value: { accepted: true } } },
    }
    render(sharedTree(store, owner, face))
    const input = screen.getByTestId('studio-composer-input') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'original' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(store.getDraft(owner)?.submission?.state).toBe('sending'))
    fireEvent.change(input, { target: { value: 'newer' } })
    release()
    await waitFor(() => expect(store.getDraft(owner)?.submission?.state).toBe('accepted'))
    expect(input.value).toBe('newer')
  })

  it('a failed shared send retains text and exposes the Host error', async () => {
    const store = new SessionViewStore()
    const owner = { kind: 'session' as const, id: 'session-a' }
    const { face } = fakeSession(async () => ({ ok: false, error: { code: 'OFFLINE', message: 'offline' } }))
    render(sharedTree(store, owner, face))
    const input = screen.getByTestId('studio-composer-input') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'retry' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('studio-composer-error').textContent).toBe('offline'))
    expect(input.value).toBe('retry')
    expect(store.getDraft(owner)?.submission?.state).toBe('failed')
  })

  it('persists a ready attachment DTO without preview or progress state', async () => {
    const store = new SessionViewStore()
    const owner = { kind: 'session' as const, id: 'session-a' }
    const { face } = fakeSession()
    const uploader = { upload: vi.fn(async () => ({ ok: true as const, value: { receiptId: 'receipt-1' } })) }
    render(sharedTree(store, owner, face, uploader))
    fireEvent.change(screen.getByTestId('studio-composer-file-input'), { target: { files: [new File(['abc'], 'a.txt', { type: 'text/plain' })] } })
    await waitFor(() => expect(store.getDraft(owner)?.attachments).toHaveLength(1))
    expect(store.getDraft(owner)?.attachments[0]).toEqual({
      id: expect.any(String), name: 'a.txt', size: 3, mediaType: 'text/plain', receiptId: 'receipt-1',
    })
    expect(JSON.stringify(store.getDraft(owner))).not.toContain('previewUrl')
  })

  it('ignores an upload completion after the view moves to another owner', async () => {
    const store = new SessionViewStore()
    const ownerA = { kind: 'session' as const, id: 'session-a' }
    const ownerB = { kind: 'session' as const, id: 'session-b' }
    const { face } = fakeSession()
    let release!: (value: { ok: true; value: { receiptId: string } }) => void
    const uploader = { upload: vi.fn(() => new Promise<{ ok: true; value: { receiptId: string } }>((resolve) => { release = resolve })) }
    const view = render(sharedTree(store, ownerA, face, uploader))
    fireEvent.change(screen.getByTestId('studio-composer-file-input'), { target: { files: [new File(['abc'], 'a.txt', { type: 'text/plain' })] } })
    await waitFor(() => expect(uploader.upload).toHaveBeenCalledOnce())
    view.rerender(sharedTree(store, ownerB, face, uploader))
    release({ ok: true, value: { receiptId: 'late-receipt' } })
    await settle()
    expect(store.getDraft(ownerA)?.attachments ?? []).toHaveLength(0)
    expect(store.getDraft(ownerB)).toBeNull()
  })
})
