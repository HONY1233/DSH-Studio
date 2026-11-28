// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { beginToolTransfer, type ExclusiveTransferPrompt } from './exclusive-transfer.js'
import { ExclusiveTransferDialog } from './exclusive-transfer-dialog.js'

function prompt(): ExclusiveTransferPrompt {
  const state = beginToolTransfer({
    source: {
      instanceId: 'terminal-1',
      toolId: 'terminal',
      sessionId: 'alpha',
      concurrency: 'exclusive',
    },
    target: { sessionId: 'beta' },
  })
  if (state.phase !== 'prompt') throw new Error('expected prompt')
  return state
}

afterEach(cleanup)

describe('ExclusiveTransferDialog', () => {
  it('只提供移动、新建、取消三个动作，渲染后不会自动选择', () => {
    const onDecision = vi.fn()
    const onCancel = vi.fn()
    render(<ExclusiveTransferDialog prompt={prompt()} onDecision={onDecision} onCancel={onCancel} />)

    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(screen.getByText(/正在会话 alpha 中运行/)).toBeTruthy()
    expect(screen.getByText(/默认不会复制/)).toBeTruthy()

    const buttons = screen.getAllByRole('button').map((button) => button.textContent)
    expect(buttons).toEqual(['取消（不复制）', '创建新实例', '移动并改归属'])
    expect(buttons.some((label) => label === '复制' || label === '复制实例')).toBe(false)

    expect(onDecision).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
    // 初始焦点在取消上，回车不会误触业务动作。
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '取消（不复制）' }))
  })

  it('点击两个业务按钮分别给出 move / new', () => {
    const onDecision = vi.fn()
    render(<ExclusiveTransferDialog prompt={prompt()} onDecision={onDecision} onCancel={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '移动并改归属' }))
    expect(onDecision).toHaveBeenLastCalledWith('move')

    fireEvent.click(screen.getByRole('button', { name: '创建新实例' }))
    expect(onDecision).toHaveBeenLastCalledWith('new')
    expect(onDecision).toHaveBeenCalledTimes(2)
  })

  it('Esc、取消按钮和点击遮罩都只走取消，不产生业务决策', () => {
    const onDecision = vi.fn()
    const onCancel = vi.fn()
    render(<ExclusiveTransferDialog prompt={prompt()} onDecision={onDecision} onCancel={onCancel} />)

    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: '取消（不复制）' }))
    fireEvent.pointerDown(screen.getByTestId('exclusive-transfer-overlay'))

    expect(onCancel).toHaveBeenCalledTimes(3)
    expect(onDecision).not.toHaveBeenCalled()
  })

  it('点击对话框内部不会触发取消', () => {
    const onCancel = vi.fn()
    render(<ExclusiveTransferDialog prompt={prompt()} onDecision={vi.fn()} onCancel={onCancel} />)
    fireEvent.pointerDown(screen.getByTestId('exclusive-transfer'))
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('支持自定义文案，避免英文界面混入中文', () => {
    render(
      <ExclusiveTransferDialog
        prompt={prompt()}
        onDecision={vi.fn()}
        onCancel={vi.fn()}
        labels={{
          title: 'Move exclusive tool',
          body: (toolId, from, to) => `${toolId}: ${from} -> ${to}`,
          move: 'Move and reassign',
          create: 'Create new instance',
          cancel: 'Cancel (no copy)',
          note: 'Nothing is copied by default.',
        }}
      />,
    )
    expect(screen.getByText('terminal: alpha -> beta')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Move and reassign' })).toBeTruthy()
  })
})