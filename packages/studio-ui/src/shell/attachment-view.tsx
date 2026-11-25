/**
 * 消息里的附件渲染。
 *
 * 两种形态，因为上游能提供的东西本来就不对等：
 * - **图片**：`readAttachment` 拿字节 → blob URL → `<img>`，可点击放大；
 * - **文件**：只有元数据（名字 + 字节数），渲染成 chip。**不做内容预览**，
 *   因为文件没有读取接口 —— 编造一个"点开看看"的入口只会让人点了没反应。
 *
 * 读取失败一律降级成 chip（名字或"图片" + 大小），不留坏图也不留转圈占位：
 * 附件可能被清理、权限可能过期，那是正常情况，不是错误状态。
 */

import { useCallback, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import type { MessageAttachment } from '../session-derived/conversation.js'
import {
  useAttachmentImages,
  type AttachmentImageCache,
  type AttachmentReaderLike,
  type ImageLoadState,
} from './attachment-images.js'

export interface AttachmentLabels {
  readonly image: string
  readonly file: string
  /** 展开/收起大图的无障碍标签。 */
  readonly enlargeImage: string
  readonly shrinkImage: string
  readonly loadingImage: string
  readonly failedImage: string
}

export const defaultAttachmentLabels: AttachmentLabels = {
  image: '图片',
  file: '文件',
  enlargeImage: '放大图片',
  shrinkImage: '还原图片',
  loadingImage: '图片加载中',
  failedImage: '图片无法显示',
}

/**
 * 人类可读的字节数。实现抽到 `format.ts`，避免与 lightbox 循环依赖；
 * 这里再导出一次，保持 `attachment-view` 的对外形状不变。
 */
import { formatBytes } from './format.js'

import { ImageLightbox, type LightboxItem } from './image-lightbox.js'

export { formatBytes }

const chipBase: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  maxWidth: '100%',
  padding: '4px 9px',
  border: '1px solid var(--color-border-secondary, #e2e0d9)',
  borderRadius: 7,
  background: 'var(--color-background-primary, #fff)',
  fontSize: 11,
  color: 'var(--color-text-secondary, #55554f)',
  textDecoration: 'none',
}

function FileChip(props: {
  readonly attachment: MessageAttachment
  readonly labels: AttachmentLabels
  readonly failed?: boolean
  /** 失败的具体原因（优先于通用文案，否则用户只知道"打不开"不知道"为什么"）。 */
  readonly reason?: string
}): ReactNode {
  const { attachment, labels } = props
  const name = attachment.name ?? (attachment.kind === 'image' ? labels.image : labels.file)
  const basis = `${name} · ${formatBytes(attachment.bytes)}`
  const title = props.failed
    ? `${basis} · ${props.reason ?? labels.failedImage}`
    : basis
  return (
    <span
      data-testid="message-attachment-file"
      data-attachment-id={attachment.attachmentId}
      data-failed={props.failed ? 'true' : 'false'}
      title={title}
      style={chipBase}
    >
      <span aria-hidden style={{ opacity: 0.7 }}>
        ▤
      </span>
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </span>
      <span style={{ opacity: 0.6, flex: '0 0 auto' }}>{formatBytes(attachment.bytes)}</span>
    </span>
  )
}

function ImageAttachment(props: {
  readonly attachment: MessageAttachment
  readonly state: ImageLoadState | undefined
  readonly labels: AttachmentLabels
  /** 同一条消息里已就绪的图（含自己），用于 lightbox 翻页。 */
  readonly gallery: readonly LightboxItem[]
  /** 自己在相册里的下标；找不到（还没就绪）时为 undefined。 */
  readonly galleryIndex: number | undefined
}): ReactNode {
  const { attachment, state, labels, gallery, galleryIndex } = props
  // 点开全屏查看（lightbox）。原地放大做不到"看细节 + 另存"，所以换成遮罩。
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const close = useCallback(() => {
    setOpen(false)
    // 焦点还给触发元素：否则键盘用户关掉遮罩后焦点丢在 body 上
    triggerRef.current?.focus()
  }, [])

  // 未就绪（含读取失败）先显示 chip：不会闪一个空框，也不会留永久占位。
  if (!state || state.status !== 'ready') {
    const failed = state?.status === 'failed'
    return (
      <span
        data-testid="message-attachment-pending"
        data-status={state?.status ?? 'loading'}
        title={failed ? (state?.error ?? labels.failedImage) : labels.loadingImage}
        style={{ display: 'inline-flex' }}
      >
        <FileChip
          attachment={attachment}
          labels={labels}
          failed={failed}
          {...(failed && state?.error !== undefined ? { reason: state.error } : {})}
        />
      </span>
    )
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid="message-attachment-image"
        data-attachment-id={attachment.attachmentId}
        aria-label={labels.enlargeImage}
        onClick={() => setOpen(true)}
        style={{
          display: 'block',
          padding: 0,
          border: 'none',
          background: 'transparent',
          cursor: 'zoom-in',
          maxWidth: '100%',
          textAlign: 'left',
        }}
      >
        <img
          src={state.url}
          alt={attachment.name ?? labels.image}
          style={{
            display: 'block',
            // 缩略图限高：一张竖图会把整个对话挤下去。看细节走 lightbox。
            maxHeight: 220,
            maxWidth: '100%',
            width: 'auto',
            height: 'auto',
            borderRadius: 7,
            border: '1px solid var(--color-border-secondary, #e2e0d9)',
            objectFit: 'contain',
          }}
        />
      </button>
      {open && (
        <ImageLightbox
          items={gallery}
          index={galleryIndex ?? 0}
          onClose={close}
        />
      )}
    </>
  )
}

export interface MessageAttachmentsProps {
  readonly attachments: readonly MessageAttachment[]
  readonly reader: AttachmentReaderLike | undefined
  readonly cache: AttachmentImageCache
  readonly labels?: AttachmentLabels
  /**
   * 整个会话的相册（正文层传下来）。
   *
   * 传了就跨消息翻页；不传就退回"只翻本条消息里的图" —— 单测与单独复用的场景
   * 不需要知道整场会话。
   */
  readonly gallery?: readonly LightboxItem[]
  /** `attachmentId → 在相册里的下标`。与 `gallery` 配套给。 */
  readonly galleryIndexOf?: ReadonlyMap<string, number>
}

export function MessageAttachments(props: MessageAttachmentsProps): ReactNode {
  const labels = props.labels ?? defaultAttachmentLabels
  const images = useMemo(
    () => props.attachments.filter((attachment) => attachment.kind === 'image'),
    [props.attachments],
  )
  // 一次订阅整组图：相册要能翻到还没点开的那些，就必须先把它们都读出来。
  // hooks 不能放在下面的 early return 之后，所以先算再判断空。
  const states = useAttachmentImages(props.cache, props.reader, images)

  // 没有外部相册时，退回"本消息内"的相册。
  const local = useMemo(() => {
    if (props.gallery) return undefined
    const items: LightboxItem[] = []
    const indexOf = new Map<string, number>()
    images.forEach((attachment, i) => {
      const state = states[i]
      if (!state || state.status !== 'ready') return
      indexOf.set(attachment.attachmentId, items.length)
      items.push({
        url: state.url,
        ...(attachment.name === undefined ? {} : { name: attachment.name }),
        bytes: attachment.bytes,
      })
    })
    return { items, indexOf }
  }, [props.gallery, images, states])

  if (props.attachments.length === 0) return null

  const gallery = props.gallery ?? local?.items ?? []
  const galleryIndexOf = props.galleryIndexOf ?? local?.indexOf

  let imageIndex = -1
  return (
    <div
      data-testid="message-attachments"
      data-count={props.attachments.length}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        alignItems: 'flex-start',
      }}
    >
      {props.attachments.map((attachment) => {
        if (attachment.kind !== 'image') {
          return <FileChip key={attachment.attachmentId} attachment={attachment} labels={labels} />
        }
        imageIndex += 1
        return (
          <ImageAttachment
            key={attachment.attachmentId}
            attachment={attachment}
            state={states[imageIndex]}
            labels={labels}
            gallery={gallery}
            galleryIndex={galleryIndexOf?.get(attachment.attachmentId)}
          />
        )
      })}
    </div>
  )
}
