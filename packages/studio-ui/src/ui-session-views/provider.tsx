/**
 * React 层：只做两件事 —— 提供注册表、把租约映射成渲染状态。
 *
 * 刻意不用 Provider 直接 new 注册表：真机里注册表要跟着 Cordis 的
 * 生命周期走（`ctx.set('sessionLease', …)`），由插件层创建后注入。
 */

import { createContext, useContext, type ReactNode } from 'react'

import type { SessionLeaseRegistry } from './leases.js'
import type { SessionViewStore } from './session-view-store.js'

const RegistryContext = createContext<SessionLeaseRegistry | null>(null)
const StoreContext = createContext<SessionViewStore | null>(null)

export interface SessionViewsProviderProps {
  readonly registry: SessionLeaseRegistry
  /** Optional additive owner state; legacy single-session consumers may omit it. */
  readonly store?: SessionViewStore
  readonly children?: ReactNode
}

export function SessionViewsProvider(props: SessionViewsProviderProps): ReactNode {
  return (
    <RegistryContext.Provider value={props.registry}>
      <StoreContext.Provider value={props.store ?? null}>{props.children}</StoreContext.Provider>
    </RegistryContext.Provider>
  )
}

export function useSessionViewStore(): SessionViewStore | null {
  return useContext(StoreContext)
}

export function useSessionLeaseRegistry(): SessionLeaseRegistry {
  const registry = useContext(RegistryContext)
  if (!registry) {
    throw new Error('useSessionLease 必须在 <SessionViewsProvider> 之内调用')
  }
  return registry
}
