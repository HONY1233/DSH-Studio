/**
 * 一个可以被 React 订阅的"可选服务槽"。
 *
 * 为什么需要它：Cordis 有服务隔离 —— 插件的 ctx 只能访问自己 `inject` 声明的服务。
 * 而附件（`ctx.fileUpload`）是可选能力：加进插件级 `inject` 会让整个插件在缺包时
 * 不激活（为了附件把工作台弄没）。不加又读不到。
 *
 * 正确做法是 Cordis 的**条件注入**：
 * ```ts
 * ctx.inject(['fileUpload'], (sub) => { slot.set(sub.fileUpload) })
 * ```
 * 服务可用时才回调，不可用时不回调。但它不是 React 状态，所以中间垫一层可订阅的槽：
 * 服务就绪 → `set()` → 订阅者重渲染 → 附件入口从禁用变可用。
 *
 * 真机踩过的坑（写成注释免得再踩）：直接 `ctx.fileUpload` 读不到不是返回 undefined，
 * 而是**抛错**；一旦没兜住，整个 `apply()` 挂掉，工作台一行都渲染不出来。
 */

import { useCallback, useSyncExternalStore } from 'react'

export class ServiceSlot<T> {
  private value: T | undefined
  private readonly listeners = new Set<() => void>()

  get(): T | undefined {
    return this.value
  }

  set(next: T | undefined): void {
    if (this.value === next) return
    this.value = next
    for (const listener of [...this.listeners]) listener()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

/** 订阅一个服务槽；返回值身份稳定（服务变化才换），可直接用于依赖比较。 */
export function useServiceSlot<T>(slot: ServiceSlot<T>): T | undefined {
  const subscribe = useCallback((listener: () => void) => slot.subscribe(listener), [slot])
  const getSnapshot = useCallback(() => slot.get(), [slot])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
