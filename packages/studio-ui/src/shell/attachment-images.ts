/**
 * 图片附件的字节读取与缓存。
 *
 * 真实契约（逐字核对 `contract/session.d.ts`）：
 * ```ts
 * session.readAttachment(attachment: ImageAttachmentRef)
 *   : Promise<RemoteResult<{ attachment: ImageAttachmentRef; data: Uint8Array }>>
 * ```
 * **只接受图片**。文件没有读取接口 —— 它们投影给模型时是"名字 + 大小 + 只读路径"
 * 的文本，日志里保留结构化引用只是为了展示与授权。所以文件只显示元数据。
 *
 * 三条必须满足的性质：
 *
 * 1) **按 `attachmentId` 全局共享**。同一张图可能出现在两个窗口（同会话开两标签）、
 *    也可能在拖拽分屏后重新挂载。每个视图各读一遍等于把字节数乘以视图数，
 *    而且两个 `<img>` 用不同的 blob URL 会让浏览器缓存失效。缓存放在模块级，
 *    键是 attachmentId —— 它是内容寻址的，天然幂等。
 * 2) **失败必须可降级**。读取失败（权限过期、附件被清理）时视图要退回"文件 chip"
 *    而不是留一个永远转圈的占位。
 * 3) **blob URL 不 revoke**。理由：同一张图可能被多个视图同时持有，任何一方
 *    revoke 都会让另一方变成裂图；而附件数量是有界的（用户在对话里贴的图），
 *    页面关闭时浏览器统一回收。用 `WeakRef`/引用计数换来的精确性不值得这个复杂度。
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'

import type { MessageAttachment } from '../session-derived/conversation.js'

export type ImageLoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly url: string }
  | { readonly status: 'failed'; readonly error: string }

/** `readAttachment` 的最小面；形状不对时这里的类型会立刻暴露。 */
export interface AttachmentReaderLike {
  readAttachment(attachment: {
    readonly attachmentId: string
    readonly mediaType?: string
    readonly bytes?: number
    readonly width?: number
    readonly height?: number
    readonly name?: string
  }): Promise<
    | { readonly ok: true; readonly value: { readonly data: Uint8Array } }
    | { readonly ok: false; readonly error?: { readonly message?: string } }
  >
}

export function asAttachmentReader(value: unknown): AttachmentReaderLike | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<AttachmentReaderLike>
  return typeof candidate.readAttachment === 'function' ? (candidate as AttachmentReaderLike) : undefined
}

/** `URL.createObjectURL` 的可用性（jsdom 默认没有，测试里要 stub）。 */
function blobUrlOf(data: Uint8Array, mediaType: string): string {
  // 复制到独立 ArrayBuffer：`data` 可能是更大缓冲区上的视图，
  // 直接 `new Blob([data])` 在部分实现里会带上整个底层 buffer。
  const bytes = new Uint8Array(data.length)
  bytes.set(data)
  return URL.createObjectURL(new Blob([bytes], { type: mediaType }))
}

export class AttachmentImageCache {
  private readonly entries = new Map<string, ImageLoadState>()
  private readonly inflight = new Set<string>()
  private readonly listeners = new Set<() => void>()
  /**
   * 版本号：任何一条状态变化就 +1。
   *
   * 批量订阅（一条消息里好几张图、相册翻页）不能靠"某个 id 的快照"驱动 ——
   * `useSyncExternalStore` 需要一个整体变化的信号，否则第二张图读完了第一张
   * 的组件不会重渲染，相册里就少一张能翻到的图。
   */
  private revision = 0

  get version(): number {
    return this.revision
  }

  /** 只读快照。对象身份只在状态变化时改变，可直接喂 `useSyncExternalStore`。 */
  stateOf(attachmentId: string): ImageLoadState | undefined {
    return this.entries.get(attachmentId)
  }

  /**
   * 确保这张图已被读取（幂等）。
   *
   * @param reader - `binding.session`（有 `readAttachment` 的那一层）
   * @param attachment - 折叠结果里的附件引用
   */
  ensure(reader: AttachmentReaderLike | undefined, attachment: MessageAttachment): void {
    if (attachment.kind !== 'image') return
    const id = attachment.attachmentId
    const known = this.entries.get(id)
    if (known && known.status !== 'failed') return
    if (this.inflight.has(id)) return

    if (!reader) {
      this.set(id, { status: 'failed', error: '当前会话不提供附件读取' })
      return
    }

    this.inflight.add(id)
    this.set(id, { status: 'loading' })

    void reader
      .readAttachment({
        attachmentId: id,
        ...(attachment.mediaType === undefined ? {} : { mediaType: attachment.mediaType }),
        bytes: attachment.bytes,
        ...(attachment.width === undefined ? {} : { width: attachment.width }),
        ...(attachment.height === undefined ? {} : { height: attachment.height }),
        ...(attachment.name === undefined ? {} : { name: attachment.name }),
      })
      .then((result) => {
        if (result.ok) {
          const mediaType = attachment.mediaType ?? 'image/png'
          try {
            this.set(id, { status: 'ready', url: blobUrlOf(result.value.data, mediaType) })
          } catch (error) {
            // `createObjectURL` 不存在或超出配额。降级成 chip，不抛。
            this.set(id, { status: 'failed', error: messageOf(error) })
          }
        } else {
          this.set(id, { status: 'failed', error: result.error?.message ?? '图片读取被拒绝' })
        }
      })
      .catch((error: unknown) => {
        this.set(id, { status: 'failed', error: messageOf(error) })
      })
      .finally(() => {
        this.inflight.delete(id)
      })
  }

  /** 清空缓存（插件卸载、或换会话作用域时用）。blob URL 故意不 revoke，见文件头。 */
  clear(): void {
    this.entries.clear()
    this.inflight.clear()
    this.notify()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private set(id: string, state: ImageLoadState): void {
    this.entries.set(id, state)
    this.notify()
  }

  private notify(): void {
    this.revision += 1
    for (const listener of [...this.listeners]) listener()
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return '图片读取失败'
}

/**
 * 订阅某张图的加载状态，并在需要时发起读取。
 *
 * `getSnapshot` 返回缓存里的同一对象（只有状态变化才换），所以不会重渲染抖动。
 */
export function useAttachmentImage(
  cache: AttachmentImageCache,
  reader: AttachmentReaderLike | undefined,
  attachment: MessageAttachment,
): ImageLoadState | undefined {
  const id = attachment.attachmentId
  const subscribe = useCallback((listener: () => void) => cache.subscribe(listener), [cache])
  const getSnapshot = useCallback(() => cache.stateOf(id), [cache, id])

  // 在 effect 里发起读取：渲染阶段不能有副作用（StrictMode 会跑两次渲染）。
  useEffect(() => {
    cache.ensure(reader, attachment)
    // attachment 每次折叠都是同一份对象（缓存共享），但身份来自适配层，
    // 用 id + bytes 做依赖足够；不要依赖整个对象，避免无谓重试。
  }, [cache, reader, id, attachment.bytes])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * 一次订阅整组图片的状态（顺序与入参一致）。
 *
 * 用途是相册：lightbox 要能翻到同一条消息里的下一张图，就必须先知道**所有**
 * 图的 URL —— 不能等用户点开某张时才现读，那样翻页会闪白。
 *
 * 与 `useAttachmentImage` 的差别只有订阅粒度：这里依赖缓存的版本号，
 * 任何一张图的状态变化都会让调用方重渲染（消息里图不多，代价可忽略）。
 */
export function useAttachmentImages(
  cache: AttachmentImageCache,
  reader: AttachmentReaderLike | undefined,
  attachments: readonly MessageAttachment[],
): readonly (ImageLoadState | undefined)[] {
  const subscribe = useCallback((listener: () => void) => cache.subscribe(listener), [cache])
  const getSnapshot = useCallback(() => cache.version, [cache])
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  // 依赖用 id 串而不是数组身份：调用方每次渲染都可能给一个新数组（filter/map 的
  // 结果），而 effect 里会写缓存 → 通知 → 重渲染，用身份做依赖会直接死循环。
  const key = attachments.map((attachment) => attachment.attachmentId).join('\u0000')
  const latest = useRef(attachments)
  latest.current = attachments

  useEffect(() => {
    // 顺序发起而不是 Promise.all：`ensure` 本身幂等且内部记录 inflight，
    // 并发读不会重复请求；这里不需要等它们完成。
    for (const attachment of latest.current) cache.ensure(reader, attachment)
  }, [cache, reader, key])

  return attachments.map((attachment) => cache.stateOf(attachment.attachmentId))
}
