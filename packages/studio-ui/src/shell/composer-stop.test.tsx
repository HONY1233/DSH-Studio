// @vitest-environment jsdom
/**
 * 停止按钮。
 *
 * 三条要守住的行为：
 * - **不夺走队列能力**：运行中点"发送"仍然是排队（这是 queue 模式的用处），
 *   停止是另一个按钮；
 * - **状态来自快照而不是本地猜测**：`stopping` 只是点击反馈，真伪看 `running`；
 * - **点了不会永久灰**：cancel 被接受但 turn 不结束时，8 秒后恢复可点。
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  Composer,
  sessionStateOf,
  type RemoteResultLike,
  type SessionFaceLike,
} from './composer.js'

type Accepted = RemoteResultLike<{ readonly accepted: true }>

interface FakeSessionOptions {
  running?: boolean
  withCancel?: boolean
  cancelResult?: () => Promise<Accepted>
  withSnapshot?: boolean
}

/** 可变快照的假会话：`setRunning()` 模拟 Host 推一次生命周期变化。 */
function fakeSession(options: FakeSessionOptions = {}) {
  const listeners = new Set<() => void>()
  let running = options.running === true
  const prompts: number[] = []
  const cancels: number[] = []

  const face: SessionFaceLike = {
    async prompt() {
      prompts.push(Date.now())
      return { ok: true, value: { accepted: true } }
    },
  }

  if (options.withSnapshot !== false) {
    face.getSnapshot = () => ({ running, promptError: null })
    face.subscribe = (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }

  if (options.withCancel !== false) {
    face.cancel = async () => {
      cancels.push(Date.now())
      return options.cancelResult ? options.cancelResult() : { ok: true, value: { accepted: true } }
    }
  }

  return {
    face,
    prompts,
    cancels,
    setRunning(next: boolean) {
      running = next
      for (const listener of [...listeners]) listener()
    },
  }
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

function typeMessage(value: string): void {
  fireEvent.change(screen.getByTestId('studio-composer-input'), { target: { value } })
}

describe('sessionStateOf', () => {
  it('读出 running 与 promptError', () => {
    expect(sessionStateOf({ running: true, promptError: null })).toEqual({ running: true, promptError: undefined })
    expect(sessionStateOf({ running: false, promptError: { message: '被拒绝' } })).toEqual({
      running: false,
      promptError: '被拒绝',
    })
  })

  it('形状不对时给保守默认值（不抛错）', () => {
    expect(sessionStateOf(undefined)).toEqual({ running: false, promptError: undefined })
    expect(sessionStateOf(null)).toEqual({ running: false, promptError: undefined })
    expect(sessionStateOf('x')).toEqual({ running: false, promptError: undefined })
    expect(sessionStateOf({ running: 'yes' })).toEqual({ running: false, promptError: undefined })
  })
})

describe('Composer 停止按钮', () => {
  it('未运行时没有停止按钮', () => {
    const { face } = fakeSession({ running: false })
    render(<Composer session={face} sessionId="s1" />)
    expect(screen.queryByTestId('studio-composer-stop')).toBeNull()
  })

  it('运行中出现停止按钮', () => {
    const { face } = fakeSession({ running: true })
    render(<Composer session={face} sessionId="s1" />)
    expect(screen.getByTestId('studio-composer-stop')).toBeDefined()
  })

  it('会话面没有 cancel 时不出现（不显示点了没反应的按钮）', () => {
    const { face } = fakeSession({ running: true, withCancel: false })
    render(<Composer session={face} sessionId="s1" />)
    expect(screen.queryByTestId('studio-composer-stop')).toBeNull()
  })

  it('会话面没有快照能力时按未运行处理', () => {
    const { face } = fakeSession({ running: true, withSnapshot: false })
    render(<Composer session={face} sessionId="s1" />)
    expect(screen.queryByTestId('studio-composer-stop')).toBeNull()
  })

  it('点击调用 cancel 一次', async () => {
    const s = fakeSession({ running: true })
    render(<Composer session={s.face} sessionId="s1" />)

    fireEvent.click(screen.getByTestId('studio-composer-stop'))
    await settle()

    expect(s.cancels).toHaveLength(1)
  })

  it('点击后进入"停止中"并禁用，防止连点', async () => {
    const s = fakeSession({ running: true })
    render(<Composer session={s.face} sessionId="s1" />)

    fireEvent.click(screen.getByTestId('studio-composer-stop'))
    await settle()

    const button = screen.getByTestId('studio-composer-stop') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.textContent).toBe('停止中…')

    // 再点一次不该重复调用
    fireEvent.click(button)
    await settle()
    expect(s.cancels).toHaveLength(1)
  })

  it('running 落回 false 后按钮消失', async () => {
    const s = fakeSession({ running: true })
    render(<Composer session={s.face} sessionId="s1" />)
    expect(screen.getByTestId('studio-composer-stop')).toBeDefined()

    await act(async () => {
      s.setRunning(false)
    })

    expect(screen.queryByTestId('studio-composer-stop')).toBeNull()
  })

  it('cancel 被拒绝时把原因显示出来', async () => {
    const s = fakeSession({
      running: true,
      cancelResult: async () => ({ ok: false, error: { message: 'turn 已结束' } }),
    })
    render(<Composer session={s.face} sessionId="s1" />)

    fireEvent.click(screen.getByTestId('studio-composer-stop'))
    await settle()

    expect(screen.getByTestId('studio-composer-error').textContent).toContain('turn 已结束')
  })

  it('cancel 抛错也不炸，转成可读文案', async () => {
    const s = fakeSession({
      running: true,
      cancelResult: async () => {
        throw new Error('网络断了')
      },
    })
    render(<Composer session={s.face} sessionId="s1" />)

    fireEvent.click(screen.getByTestId('studio-composer-stop'))
    await settle()

    expect(screen.getByTestId('studio-composer-error').textContent).toContain('网络断了')
  })

  it('运行中仍然可以发送（排队能力没被夺走）', async () => {
    const s = fakeSession({ running: true })
    render(<Composer session={s.face} sessionId="s1" />)

    typeMessage('排队一条')
    await settle()

    const send = screen.getByTestId('studio-composer-send') as HTMLButtonElement
    expect(send.disabled).toBe(false)
    fireEvent.click(send)
    await settle()

    expect(s.prompts).toHaveLength(1)
  })

  it('disabled 时不显示停止按钮（面板只读时不该能打断）', () => {
    const { face } = fakeSession({ running: true })
    render(<Composer session={face} sessionId="s1" disabled />)
    expect(screen.queryByTestId('studio-composer-stop')).toBeNull()
  })

  it('停止按钮排在发送按钮之前（避免误点发送）', () => {
    const { face } = fakeSession({ running: true })
    render(<Composer session={face} sessionId="s1" />)

    const stop = screen.getByTestId('studio-composer-stop')
    const send = screen.getByTestId('studio-composer-send')
    // 同一个父容器内，DOM 顺序上 stop 在 send 之前
    expect(stop.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('useSessionRunning 的降级', () => {
  it('getSnapshot 抛错时按未运行处理，不把输入框炸掉', () => {
    const face: SessionFaceLike = {
      async prompt() {
        return { ok: true, value: { accepted: true } }
      },
      getSnapshot: () => {
        throw new Error('boom')
      },
      subscribe: () => () => {},
    }
    render(<Composer session={face} sessionId="s1" />)
    // 关键：输入框还在，没有整棵子树崩掉
    expect(screen.getByTestId('studio-composer-input')).toBeDefined()
    expect(screen.queryByTestId('studio-composer-stop')).toBeNull()
  })

  it('使用稳定布尔快照，不因每次返回新对象而警告重渲染', () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
    const s = fakeSession({ running: true })
    render(<Composer session={s.face} sessionId="s1" />)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})

/**
 * 这一组对应真机上抓到的事实：`snapshot.running` 在 turn 开始约 50ms 后就落回
 * false，而 turn 还在继续输出。所以停止按钮的主信号必须是**折叠事件流得出的
 * `streaming`**，否则按钮会在最该点它的时候消失。
 */
describe('停止按钮以事件驱动为主信号（streaming）', () => {
  it('running=false 但 streaming=true 时仍然显示停止按钮', () => {
    const s = fakeSession({ running: false })
    render(<Composer session={s.face} sessionId="s1" streaming />)
    expect(screen.getByTestId('studio-composer-stop')).toBeDefined()
  })

  it('streaming 时点击同样能调 cancel', async () => {
    const s = fakeSession({ running: false })
    render(<Composer session={s.face} sessionId="s1" streaming />)

    fireEvent.click(screen.getByTestId('studio-composer-stop'))
    await settle()
    expect(s.cancels).toHaveLength(1)
  })

  it('streaming 从 true 变 false 后按钮消失（不用等 running）', () => {
    const s = fakeSession({ running: false })
    const { rerender } = render(<Composer session={s.face} sessionId="s1" streaming />)
    expect(screen.getByTestId('studio-composer-stop')).toBeDefined()

    rerender(<Composer session={s.face} sessionId="s1" streaming={false} />)
    expect(screen.queryByTestId('studio-composer-stop')).toBeNull()
  })

  it('streaming 变 false 也解除"停止中"锁定', async () => {
    const s = fakeSession({ running: false })
    const { rerender } = render(<Composer session={s.face} sessionId="s1" streaming />)

    fireEvent.click(screen.getByTestId('studio-composer-stop'))
    await settle()
    expect((screen.getByTestId('studio-composer-stop') as HTMLButtonElement).disabled).toBe(true)

    rerender(<Composer session={s.face} sessionId="s1" streaming={false} />)
    expect(screen.queryByTestId('studio-composer-stop')).toBeNull()
  })

  it('两者都为 false 时不显示', () => {
    const s = fakeSession({ running: false })
    render(<Composer session={s.face} sessionId="s1" streaming={false} />)
    expect(screen.queryByTestId('studio-composer-stop')).toBeNull()
  })
})
