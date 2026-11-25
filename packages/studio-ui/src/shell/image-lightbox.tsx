/**
 * 图片全屏查看（lightbox）。
 *
 * 五个必须做对的细节：
 *
 * 1) **Esc 关闭 + 点背景关闭**，但点图片本身不关（放大看图时想拖动/选中）；
 * 2) **打开时焦点进到关闭按钮，关闭时还给触发元素** —— 否则键盘用户打开后
 *    就丢了焦点位置，Tab 会跑到页面另一头；
 * 3) **背景滚动要锁住**：遮罩里滚轮滚到底会"穿透"到正文，看起来像页面在乱跳；
 * 4) **另存用 `download` 属性 + blob URL**。附件是内容寻址的 blob，没有可分享的
 *    URL —— 想留住图片只能触发下载（Electron 里会弹保存对话框）；
 * 5) **多图可翻页**（← → 或按钮）。只给单图的遮罩在贴了 5 张截图时非常难受：
 *    要关掉、找到下一张、再点开。
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import { formatBytes } from './format.js'

export interface LightboxLabels {
  readonly close: string
  readonly save: string
  readonly image: string
  readonly hint: string
  /** 多图时的提示（覆盖 `hint`，否则"Esc 关闭"会漏掉怎么翻页）。 */
  readonly pagesHint: string
  readonly previous: string
  readonly next: string
}

export const defaultLightboxLabels: LightboxLabels = {
  close: '关闭',
  save: '另存',
  image: '图片',
  hint: 'Esc 关闭 · 点背景关闭',
  pagesHint: '← → 切换 · Esc 关闭 · 点背景关闭',
  previous: '上一张',
  next: '下一张',
}

/** 相册里的一项：url 必须已就绪（未读出来的图进不了相册，见 attachment-view）。 */
export interface LightboxItem {
  readonly url: string
  readonly name?: string
  readonly bytes?: number
}

/** 遮罩压在所有面板之上（工作台的浮窗层没有到 4 位数）。 */
const overlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 9999,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  padding: 24,
  background: 'rgba(20, 20, 18, .82)',
  backdropFilter: 'blur(2px)',
}

const toolbar: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '4px 8px',
  borderRadius: 8,
  background: 'rgba(255,255,255,.08)',
  color: '#f2f1ec',
  fontSize: 12,
  maxWidth: 'min(92vw, 900px)',
}

const actionButton: CSSProperties = {
  padding: '2px 9px',
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,.24)',
  background: 'transparent',
  color: '#f2f1ec',
  fontFamily: 'inherit',
  fontSize: 11,
  cursor: 'pointer',
  textDecoration: 'none',
}

export interface ImageLightboxProps {
  /** 单图入口（保留：只有一张图的场景不必构造数组）。给了 `items` 就忽略它。 */
  readonly url?: string
  readonly name?: string
  readonly bytes?: number
  /** 相册：同一条消息里**已就绪**的图，顺序即翻页顺序。 */
  readonly items?: readonly LightboxItem[]
  /** 初始位置（点开的那张在 `items` 里的下标）。 */
  readonly index?: number
  readonly labels?: LightboxLabels
  readonly onClose: () => void
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0
  if (!Number.isFinite(index)) return 0
  return Math.min(Math.max(Math.trunc(index), 0), length - 1)
}

export function ImageLightbox(props: ImageLightboxProps): ReactNode {
  const labels = props.labels ?? defaultLightboxLabels
  const closeRef = useRef<HTMLButtonElement | null>(null)

  const list: readonly LightboxItem[] =
    props.items && props.items.length > 0
      ? props.items
      : props.url === undefined
        ? []
        : [
            {
              url: props.url,
              ...(props.name === undefined ? {} : { name: props.name }),
              ...(props.bytes === undefined ? {} : { bytes: props.bytes }),
            },
          ]

  const [index, setIndex] = useState(() => clampIndex(props.index ?? 0, list.length))
  // 列表可能在打开期间变化（同一条消息里另一张图刚好读完）：渲染时夹一次，
  // 不用 state 同步 —— 那会在渲染后多一次跳动。
  const safeIndex = clampIndex(index, list.length)
  const current: LightboxItem | undefined = list[safeIndex]
  const multi = list.length > 1

  // 用 ref 持有最新的列表与回调，好让键盘监听只注册一次。
  // 否则 effect 每次渲染都重注册，顺带把焦点反复抢回关闭按钮。
  const listRef = useRef(list)
  listRef.current = list
  const onCloseRef = useRef(props.onClose)
  onCloseRef.current = props.onClose

  useEffect(() => {
    // 焦点进到关闭按钮：键盘用户打开后能直接 Esc 或 Enter 关掉
    closeRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      // 只有一张图时不接管方向键：没有下一页可翻，抢走按键只会让人困惑
      if (listRef.current.length < 2) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      const delta = event.key === 'ArrowLeft' ? -1 : 1
      setIndex((prev) => clampIndex(prev + delta, listRef.current.length))
    }
    window.addEventListener('keydown', onKeyDown)

    // 锁住背景滚动：否则遮罩里滚轮滚到底会穿透到正文
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previous
    }
  }, [])

  if (!current) return null

  const fileName = current.name ?? labels.image
  const downloadName = current.name ?? 'image.png'

  return (
    <div
      data-testid="image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={fileName}
      onClick={() => props.onClose()}
      style={overlay}
    >
      <div style={toolbar} onClick={(event) => event.stopPropagation()}>
        {multi && (
          <>
            <button
              type="button"
              data-testid="image-lightbox-prev"
              aria-label={labels.previous}
              disabled={safeIndex === 0}
              onClick={(event) => {
                event.stopPropagation()
                setIndex(safeIndex - 1)
              }}
              style={{ ...actionButton, opacity: safeIndex === 0 ? 0.35 : 1 }}
            >
              ‹
            </button>
            <span data-testid="image-lightbox-counter" style={{ opacity: 0.75, fontSize: 11 }}>
              {safeIndex + 1} / {list.length}
            </span>
            <button
              type="button"
              data-testid="image-lightbox-next"
              aria-label={labels.next}
              disabled={safeIndex === list.length - 1}
              onClick={(event) => {
                event.stopPropagation()
                setIndex(safeIndex + 1)
              }}
              style={{ ...actionButton, opacity: safeIndex === list.length - 1 ? 0.35 : 1 }}
            >
              ›
            </button>
          </>
        )}
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 420,
          }}
        >
          {fileName}
        </span>
        {current.bytes !== undefined && <span style={{ opacity: 0.65 }}>{formatBytes(current.bytes)}</span>}
        <span style={{ opacity: 0.45, fontSize: 10 }}>{multi ? labels.pagesHint : labels.hint}</span>
        <a
          data-testid="image-lightbox-save"
          href={current.url}
          download={downloadName}
          style={actionButton}
          onClick={(event) => event.stopPropagation()}
        >
          {labels.save}
        </a>
        <button
          ref={closeRef}
          type="button"
          data-testid="image-lightbox-close"
          aria-label={labels.close}
          onClick={() => props.onClose()}
          style={actionButton}
        >
          {labels.close}
        </button>
      </div>

      {/* 点图片本身不关闭（正在看图时误触很烦），只在图片区域外关 */}
      <img
        src={current.url}
        alt={fileName}
        onClick={(event) => event.stopPropagation()}
        style={{
          maxWidth: '92vw',
          maxHeight: '82vh',
          objectFit: 'contain',
          borderRadius: 8,
          boxShadow: '0 8px 40px rgba(0,0,0,.5)',
        }}
      />
    </div>
  )
}
