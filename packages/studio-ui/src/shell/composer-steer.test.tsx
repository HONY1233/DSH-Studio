// @vitest-environment jsdom
/**
 * steer：打断并发送。
 *
 * 四条守则：
 * - **Enter 永远是排队**（安全默认），只有 Ctrl/Cmd+Enter 才打断 ——
 *   猜"用户大概想打断"的代价是正在生成的回答被截断；
 * - 没在跑的时候按 Ctrl+Enter 降级成 queue（不报错、不空转）；
 * - steer 也要带上附件与文字，不能只发文字；
 * - 按钮文字在运行中变成"排队发送"，并给出快捷键提示（否则没人发现）。
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  Composer,
  defaultComposerLabels,
  type RemoteResultLike,
  type SessionFaceLike,
} from './composer.js'

type Accepted = RemoteResultLike<{ readonly accepted: true }>

interface Call {
  readonly mode: 'queue' | 'steer'
  readonly text: string
  readonly parts: number
}

function fakeSession(options: { running?: boolean } = {}) {
  const listeners = new Set<() => void>()
  let running = options.running === true
  const calls: Call[] = []

  const face: SessionFaceLike = {
    async prompt(content, mode) {
      const text = content
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('')
      calls.push({ mode, text, parts: content.length })
      return { ok: true, value: { accepted: true } }
    },
    cancel: async () => ({ ok: true, value: { accepted: true } }),
    getSnapshot: () => ({ running, promptError: null }),
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
  }
  return { face, calls, setRunning: (v: boolean) => {
    running = v
    for (const fn of [...listeners]) fn()
  } }
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

function type(value: string): void {
  fireEvent.change(screen.getByTestId('studio-composer-input'), { target: { value } })
}

const input = () => screen.getByTestId('studio-composer-input')

describe('steer 的触发条件', () => {
  it('Enter 在运行中仍然是 queue（安全默认）', async () => {
    const s = fakeSession({ running: true })
    render(<Composer session={s.face} sessionId="s1" streaming />)

    type('排队一条')
    fireEvent.keyDown(input(), { key: 'Enter' })
    await settle()

    expect(s.calls).toHaveLength(1)
    expect(s.calls[0]?.mode).toBe('queue')
  })

  it('Ctrl+Enter 在运行中走 steer', async () => {
    const s = fakeSession({ running: true })
    render(<Composer session={s.face} sessionId="s1" streaming />)

    type('别数了，换个任务')
    fireEvent.keyDown(input(), { key: 'Enter', ctrlKey: true })
    await settle()

    expect(s.calls).toHaveLength(1)
    expect(s.calls[0]?.mode).toBe('steer')
    expect(s.calls[0]?.text).toBe('别数了，换个任务')
  })

  it('Cmd+Enter（macOS）同样走 steer', async () => {
    const s = fakeSession({ running: true })
    render(<Composer session={s.face} sessionId="s1" streaming />)

    type('打断')
    fireEvent.keyDown(input(), { key: 'Enter', metaKey: true })
    await settle()

    expect(s.calls[0]?.mode).toBe('steer')
  })

  it('没在跑时 Ctrl+Enter 降级成 queue（没有可打断的对象）', async () => {
    const s = fakeSession({ running: false })
    render(<Composer session={s.face} sessionId="s1" />)

    type('普通发送')
    fireEvent.keyDown(input(), { key: 'Enter', ctrlKey: true })
    await settle()

    expect(s.calls[0]?.mode).toBe('queue')
  })

  it('Shift+Enter 只换行，不发送', async () => {
    const s = fakeSession({ running: true })
    render(<Composer session={s.face} sessionId="s1" streaming />)

    type('第一行')
    fireEvent.keyDown(input(), { key: 'Enter', shiftKey: true })
    await settle()

    expect(s.calls).toHaveLength(0)
  })

  it('steer 也带上附件（不是只发文字）', async () => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:x' })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} })

    const s = fakeSession({ running: true })
    const uploader = {
      async upload() {
        return { ok: true as const, value: { receiptId: 'r-1' } }
      },
    }
    render(<Composer session={s.face} sessionId="s1" uploader={uploader} streaming />)

    const fileInput = screen.getByTestId('studio-composer-file-input')
    fireEvent.change(fileInput, { target: { files: [new File(['a'], 'a.txt', { type: 'text/plain' })] } })
    await settle()

    type('带附件打断')
    fireEvent.keyDown(input(), { key: 'Enter', ctrlKey: true })
    await settle()

    expect(s.calls[0]?.mode).toBe('steer')
    expect(s.calls[0]?.parts).toBe(2) // text + file
  })

  it('steer 成功后清空输入框', async () => {
    const s = fakeSession({ running: true })
    render(<Composer session={s.face} sessionId="s1" streaming />)

    type('打断')
    fireEvent.keyDown(input(), { key: 'Enter', ctrlKey: true })
    await settle()

    expect((input() as HTMLTextAreaElement).value).toBe('')
  })

  it('空白内容按 Ctrl+Enter 不发送', async () => {
    const s = fakeSession({ running: true })
    render(<Composer session={s.face} sessionId="s1" streaming />)

    type('   ')
    fireEvent.keyDown(input(), { key: 'Enter', ctrlKey: true })
    await settle()

    expect(s.calls).toHaveLength(0)
  })
})

describe('运行中的按钮文案', () => {
  it('运行中发送按钮说"排队发送"，并给出快捷键提示', () => {
    const s = fakeSession({ running: true })
    render(<Composer session={s.face} sessionId="s1" streaming />)

    const send = screen.getByTestId('studio-composer-send')
    expect(send.textContent).toBe(defaultComposerLabels.queueSend)
    expect(send.getAttribute('title')).toContain('Ctrl+Enter')
  })

  it('空闲时是普通"发送"，且没有 steer 提示', () => {
    const s = fakeSession({ running: false })
    render(<Composer session={s.face} sessionId="s1" />)

    const send = screen.getByTestId('studio-composer-send')
    expect(send.textContent).toBe(defaultComposerLabels.send)
    expect(send.getAttribute('title')).toBe(defaultComposerLabels.send)
  })

  it('点击发送按钮走 queue（不因为运行中就悄悄打断）', async () => {
    const s = fakeSession({ running: true })
    render(<Composer session={s.face} sessionId="s1" streaming />)

    type('点击发送')
    fireEvent.click(screen.getByTestId('studio-composer-send'))
    await settle()

    expect(s.calls[0]?.mode).toBe('queue')
  })

  it('提示文案里说明了三种回车行为', () => {
    const s = fakeSession()
    render(<Composer session={s.face} sessionId="s1" />)
    const hint = defaultComposerLabels.hint
    expect(hint).toContain('Enter 排队发送')
    expect(hint).toContain('Ctrl+Enter 打断并发送')
    expect(hint).toContain('Shift+Enter 换行')
  })
})
