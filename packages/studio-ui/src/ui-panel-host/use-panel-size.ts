/**
 * React 侧尺寸 hook —— 与纯函数分开，保证 `size.ts` 能在 Node 里测。
 * 只有需要独立测量（例如面板内部再分栏）时才用；常规面板直接用
 * `PanelHost` 通过 props 传下来的 `size`。
 */

import { useEffect, useState } from 'react'
import type { RefObject } from 'react'

import { sizeOf, type PanelSize } from './size.js'

export function usePanelSize(
  target: RefObject<HTMLElement | null>,
  tiers: readonly number[] = [],
): PanelSize {
  const [size, setSize] = useState<PanelSize>(() => sizeOf(0, 0, tiers))

  useEffect(() => {
    const el = target.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (!box) return
      const next = sizeOf(Math.round(box.width), Math.round(box.height), tiers)
      setSize((prev) =>
        prev.width === next.width && prev.height === next.height && prev.tier === next.tier ? prev : next,
      )
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [target, tiers])

  return size
}
