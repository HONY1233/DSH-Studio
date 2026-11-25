/**
 * PanelHost —— 面板与停靠宿主之间唯一的接触面。
 *
 * 它只做三件事：给尺寸、切可见性、维持一个固定尺寸的滚动容器。
 *
 * **不**做的事（omp 踩过的坑，写在这里防复现）：
 * - 不加页边距。边距归面板自己，否则不同区域的正文缩进会打架。
 * - 不包额外的 flex 包装层。一页正文只能有一个根元素；多个兄弟块会被
 *   各自撑成 height:100%，带 flex:1 的列表直接挤成 0px。
 * - 不监听 window.resize。尺寸只认自己的容器，靠 ResizeObserver。
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import type { PanelContribution } from './contract.js'
import { sizeOf, type PanelSize } from './size.js'

export interface PanelHostProps {
  readonly contribution: PanelContribution
  readonly instanceId: string
  readonly active: boolean
  /** 首帧尺寸兜底；未测量前用默认值，避免 0 宽导致版式闪一下。 */
  readonly initialSize?: { readonly width: number; readonly height: number }
}

/**
 * G3 门禁：面板正文出现多个根元素时的提示语。
 *
 * 这是 omp 实际踩过的坑 —— 两个兄弟块各自被撑成 `height:100%`，
 * 带 `flex:1` 的列表被挤成 0px。所以它不是理论洁癖，是常见故障。
 */
export const MULTIPLE_ROOTS_HINT =
  '一页正文只能有一个根元素：多个兄弟块会各自撑满高度，带 flex:1 的列表会被挤成 0px。请把内容包进单个容器。'

function isProductionBuild(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
  return env?.NODE_ENV === 'production'
}

export function PanelHost({ contribution, instanceId, active, initialSize }: PanelHostProps): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null)
  const warned = useRef(false)
  const [size, setSize] = useState<PanelSize>(() =>
    sizeOf(initialSize?.width ?? 0, initialSize?.height ?? 0, contribution.widthTiers),
  )

  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (!box) return
      const next = sizeOf(Math.round(box.width), Math.round(box.height), contribution.widthTiers)
      setSize((prev) =>
        prev.width === next.width && prev.height === next.height && prev.tier === next.tier ? prev : next,
      )
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [contribution.widthTiers])

  // G3 门禁（运行时）：正文只能有一个根元素。开发期只在第一次违规时告警，
  // 生产构建跳过（不值得为一次开发期检查多遍历一遍 children）。
  useEffect(() => {
    const el = ref.current
    if (!el || warned.current || isProductionBuild()) return
    if (el.children.length <= 1) return
    warned.current = true
    console.warn(
      `[panel-host] 面板 "${contribution.id}" 的正文有 ${el.children.length} 个根元素。${MULTIPLE_ROOTS_HINT}`,
    )
  })

  // 不保活且不可见 → 由宿主直接卸载，这里不渲染任何东西。
  if (!active && !contribution.keepAlive) return null

  const hidden = !active

  return (
    <div
      ref={ref}
      data-panel-id={contribution.id}
      data-panel-instance={instanceId}
      data-active={active ? 'true' : 'false'}
      style={{
        width: '100%',
        height: '100%',
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
        // 保活的隐藏面板用 display:none 摘出渲染，但保留 DOM 与订阅。
        display: hidden ? 'none' : undefined,
      }}
    >
      {contribution.render({ panelId: contribution.id, instanceId, active, size })}
    </div>
  )
}
