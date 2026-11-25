/**
 * `useSessionLease` —— 视图挂载即持有，卸载即放手。
 *
 * 两个刻意的选择：
 *
 * 1) **在 layout effect 里 acquire**，不在 render 里。
 *    render 可能被丢弃（并发渲染 / StrictMode 双调用），在 render 里加计数
 *    会泄漏一份永远不会被释放的引用。layout effect 一定配对 cleanup，
 *    且早于绘制，用户看不到"先空一帧再出内容"。
 * 2) **状态从注册表读**，不在本地缓存 binding。
 *    同会话的三个视图必须看到同一份 ready/error，本地缓存会各说各话。
 */

import { useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react'

import type { LeaseStatus, SessionLease } from './leases.js'
import type { SessionBinding, SessionSource, SessionTarget } from './port.js'
import { useSessionLeaseRegistry } from './provider.js'

// SSR 下 useLayoutEffect 会告警；这个包里它本身就是客户端组件，
// 但保留习惯写法，方便以后被 web-server 渲染引用。
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export interface UseSessionLeaseOptions {
  readonly source?: SessionSource
  /** false 时不持有引用（如面板隐藏且不需要数据）。 */
  readonly enabled?: boolean
}

export interface SessionLeaseResult {
  /** `idle` = 没有目标或未启用，不是错误。 */
  readonly status: 'idle' | LeaseStatus
  readonly binding?: SessionBinding
  readonly error?: string
  readonly refCount: number
  readonly generation: number
  readonly draining: boolean
  readonly lease?: SessionLease
}

const IDLE: SessionLeaseResult = { status: 'idle', refCount: 0, generation: 0, draining: false }

export function useSessionLease(
  target: SessionTarget | undefined,
  options: UseSessionLeaseOptions = {},
): SessionLeaseResult {
  const registry = useSessionLeaseRegistry()
  const source = options.source ?? 'workbench:pane'
  const enabled = options.enabled ?? true

  const [lease, setLease] = useState<SessionLease | undefined>(undefined)

  useIsomorphicLayoutEffect(() => {
    if (!enabled || !target) {
      setLease(undefined)
      return undefined
    }
    const next = registry.acquire(target, source)
    setLease(next)
    return () => {
      // 搬家时这里先跑、新组件再 acquire，两者在同一 commit 内，
      // 注册表的宽限期会让底层引用原地复用，而不是断开重连。
      next.release()
      setLease(undefined)
    }
  }, [registry, target, source, enabled])

  const subscribe = useCallback((listener: () => void) => registry.subscribe(listener), [registry])
  const getSnapshot = useCallback(() => lease?.current(), [lease])
  const view = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  // 目标切换的那一帧 lease 还指向旧 target，直接按 idle 处理，
  // 免得把上一场会话的内容渲染到新 tab 里。
  if (!lease || lease.target !== target) return IDLE

  const current = view ?? lease.current()
  return {
    status: current.status,
    ...(current.binding === undefined ? {} : { binding: current.binding }),
    ...(current.error === undefined ? {} : { error: current.error }),
    refCount: current.refCount,
    generation: current.generation,
    draining: current.draining,
    lease,
  }
}
