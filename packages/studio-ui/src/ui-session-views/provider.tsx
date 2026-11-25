/**
 * React 层：只做两件事 —— 提供注册表、把租约映射成渲染状态。
 *
 * 刻意不用 Provider 直接 new 注册表：真机里注册表要跟着 Cordis 的
 * 生命周期走（`ctx.set('sessionLease', …)`），由插件层创建后注入。
 */

import { createContext, useContext, type ReactNode } from 'react'

import type { SessionLeaseRegistry } from './leases.js'

const RegistryContext = createContext<SessionLeaseRegistry | null>(null)

export interface SessionViewsProviderProps {
  readonly registry: SessionLeaseRegistry
  readonly children?: ReactNode
}

export function SessionViewsProvider(props: SessionViewsProviderProps): ReactNode {
  return <RegistryContext.Provider value={props.registry}>{props.children}</RegistryContext.Provider>
}

export function useSessionLeaseRegistry(): SessionLeaseRegistry {
  const registry = useContext(RegistryContext)
  if (!registry) {
    throw new Error('useSessionLease 必须在 <SessionViewsProvider> 之内调用')
  }
  return registry
}
