/**
 * 面板级错误边界。
 *
 * 真机踩过：调试面板里 `useSyncExternalStore` 的 `getSnapshot` 每次返回新对象
 * （`derived.stats()` 构造字面量），React 判定快照一直在变 → 无限重渲染 →
 * 抛错 → **整棵工作台被卸载**，标签全没了、主区空白。
 *
 * 一个面板的渲染错误不该让工作台消失。所以面板正文外面包一层边界：
 * 炸了就在那一格里显示可读的错误，其余照常。
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'

export interface PanelErrorBoundaryProps {
  readonly label: string
  readonly children: ReactNode
}

interface State {
  readonly error?: Error
}

export class PanelErrorBoundary extends Component<PanelErrorBoundaryProps, State> {
  override state: State = {}

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[studio] 面板 "${this.props.label}" 渲染失败`, error, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div
        data-testid="panel-error"
        role="alert"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          height: '100%',
          padding: 16,
          boxSizing: 'border-box',
          overflow: 'auto',
          fontSize: 12,
          color: 'var(--color-text-danger, #c0392b)',
        }}
      >
        <div style={{ fontWeight: 500 }}>面板渲染失败：{this.props.label}</div>
        <div style={{ fontSize: 11, opacity: 0.85, wordBreak: 'break-word' }}>{error.message}</div>
        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary, #8a8a85)' }}>
          其余标签不受影响。修复后重新打开该面板即可。
        </div>
      </div>
    )
  }
}
