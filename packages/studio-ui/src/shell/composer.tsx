/**
 * 会话输入框（支持文本 + 附件）。
 *
 * 真实契约（0.2.2-rc.5，逐字核对）：
 * ```ts
 * // 发送
 * session.prompt(content: PromptContentPart[], mode: 'queue' | 'steer', signal?, requestId?)
 *   : Promise<RemoteResult<{ accepted: true }>>
 *
 * // 上传（浏览器服务 ctx.fileUpload）
 * fileUpload.upload(sessionId, blob, name?, signal?, onProgress?)       → { receiptId, file }
 * fileUpload.uploadImage(sessionId, blob, mediaType, name?, …)          → { receiptId, image }
 * ```
 *
 * **附件统一走 `receiptId`**，图片也一样。`PromptContentPart` 的注释写得很清楚：
 * "File parts carry the opaque receipt returned by a preceding upload on the same
 * Session; the receipt of an image upload enters the message as that image."
 * 所以不必自己 base64 塞 `image.data` —— 上传一次，发送时只带 receipt。
 *
 * 四个刻意的取舍：
 *
 * 1) **只用 `mode: 'queue'`**，不自己判断该 queue 还是 steer。判据是会话是否在跑，
 *    这个状态会瞬变；猜错的后果是"想排队却打断了正在生成的回答"。
 * 2) **不调 `beginSubmission`**（那套乐观回显）。正文直接来自事件窗口，回显会变成
 *    第二条真相源 —— 窗口里迟早也会出现那条消息，于是重复。
 * 3) **选文件即上传**（DSH 的 staged receipt 就是为此设计的）。发送时只带 receipt，
 *    不用等大文件。代价是取消时会留一个孤儿 receipt，由 Host 侧回收。
 * 4) **`fileUpload` 是软依赖**。它不在 `inject` 里：万一那个包没加载，硬依赖会让
 *    整个插件不激活（连工作台都没了），那比"没有附件"糟糕得多。拿不到就禁用入口。
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ClipboardEvent,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'

/** `PromptContentPart` 的文本分支。 */
export interface TextPart {
  readonly type: 'text'
  readonly text: string
}

/** `PromptContentPart` 的文件分支 —— 图片上传拿到的 receipt 也从这里进。 */
export interface FilePart {
  readonly type: 'file'
  readonly receiptId: string
}

export type PromptPart = TextPart | FilePart

/**
 * 点"停止"之后最多等多久就恢复可点。
 *
 * 不是给 `cancel()` 设超时（它通常几十毫秒就返回），而是防**工具调用中途不响应取消**
 * 导致 `running` 迟迟不落回 false：那时按钮会一直灰着，用户以为点坏了。
 */
const STOP_TIMEOUT_MS = 8000

export interface RemoteFailureLike {
  readonly message?: string
  readonly code?: string
}

export type RemoteResultLike<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error?: RemoteFailureLike }

/**
 * `SessionFace` 里我们用到的最小面。
 *
 * 刻意不 import 真实的 `SessionFace`：那是会话包的私有类型，直接依赖会把上游
 * 小改动变成我们的编译错误。形状不对时这里一眼能看出来。
 *
 * 注意 `getSnapshot` / `subscribe` 是 `ObservableSnapshot<SessionSnapshot>` 的那一半
 * （`SessionFace = ISession & ObservableSnapshot<SessionSnapshot>`），
 * `running` / `promptError` 这些生命周期状态都从快照读，不额外订阅事件流。
 */
export interface SessionFaceLike {
  prompt(
    content: readonly PromptPart[],
    mode: 'queue' | 'steer',
    signal?: AbortSignal,
    requestId?: string,
  ): Promise<RemoteResultLike<{ readonly accepted: true }>>
  /**
   * 取消正在跑的 turn。契约原文：pending queued work remains and resumes in FIFO
   * order after the Host reaches cancellation quiescence —— 所以它**只停当前这一轮**，
   * 不动已排队的消息。这正是"停止"按钮该有的语义。
   */
  cancel?(): Promise<RemoteResultLike<{ readonly accepted: true }>>
  /** `ObservableSnapshot<SessionSnapshot>` 的读半；拿不到就当"不知道是否在跑"。 */
  getSnapshot?(): unknown
  /** `ObservableSnapshot<SessionSnapshot>` 的订阅半。 */
  subscribe?(listener: () => void): () => void
}

/** 从会话快照里读出我们要的两个字段；形状不对就给保守默认值。 */
export function sessionStateOf(snapshot: unknown): {
  readonly running: boolean
  readonly promptError: string | undefined
} {
  if (!snapshot || typeof snapshot !== 'object') return { running: false, promptError: undefined }
  const record = snapshot as { running?: unknown; promptError?: unknown; lastAgentError?: unknown }
  const running = record.running === true
  // `promptError` 是 `PromptError | null`；只取可读的 message。
  const promptError =
    record.promptError && typeof record.promptError === 'object'
      ? (record.promptError as { message?: unknown }).message
      : undefined
  const message = typeof promptError === 'string' ? promptError : undefined
  return { running, promptError: message }
}

/**
 * 订阅会话的 `running` 状态。
 *
 * 三个降级：
 * - 没有 `getSnapshot`/`subscribe` 时永远 `running: false`（不显示停止按钮，
 *   而不是显示一个点了没反应的按钮）；
 * - 快照读抛错时同样按 false 处理；
 * - 快照对象每次都是新的话 `useSyncExternalStore` 会警告，所以这里**只取布尔值**
 *   作快照 —— 原始值天然稳定。
 */
export function useSessionRunning(face: SessionFaceLike | undefined): boolean {
  const subscribe = useCallback(
    (listener: () => void) => (face?.subscribe ? face.subscribe(listener) : () => {}),
    [face],
  )
  const getSnapshot = useCallback(() => {
    if (!face?.getSnapshot) return false
    try {
      return sessionStateOf(face.getSnapshot()).running
    } catch {
      return false
    }
  }, [face])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export interface UploadProgressLike {
  readonly loaded: number
  readonly total?: number
}

/** `ctx.fileUpload` 里我们用到的最小面。 */
export interface FileUploadServiceLike {
  upload(
    sessionId: string,
    data: Blob,
    name?: string,
    signal?: AbortSignal,
    onProgress?: (progress: UploadProgressLike) => void,
  ): Promise<RemoteResultLike<{ readonly receiptId: string }>>
  uploadImage?(
    sessionId: string,
    data: Blob,
    mediaType: string,
    name?: string,
    signal?: AbortSignal,
    onProgress?: (progress: UploadProgressLike) => void,
  ): Promise<RemoteResultLike<{ readonly receiptId: string }>>
}

/** 从任意值里认出可用的会话面；认不出就返回 undefined（输入框降级为禁用）。 */
export function asSessionFace(value: unknown): SessionFaceLike | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<SessionFaceLike>
  return typeof candidate.prompt === 'function' ? (candidate as SessionFaceLike) : undefined
}

/** 从任意值里认出可用的上传服务。 */
export function asFileUploadService(value: unknown): FileUploadServiceLike | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<FileUploadServiceLike>
  return typeof candidate.upload === 'function' ? (candidate as FileUploadServiceLike) : undefined
}

export interface AttachmentItem {
  readonly id: string
  readonly name: string
  readonly size: number
  readonly mediaType: string
  readonly isImage: boolean
  /** 图片缩略图（object URL，卸载时要 revoke）。 */
  readonly previewUrl?: string
  readonly status: 'uploading' | 'ready' | 'failed'
  readonly receiptId?: string
  readonly error?: string
  readonly progress?: number
}

export interface ComposerLabels {
  readonly placeholder: string
  readonly send: string
  readonly sending: string
  readonly hint: string
  readonly unavailable: string
  readonly attach: string
  readonly removeAttachment: string
  readonly uploading: string
  readonly uploadFailed: string
  readonly attachUnavailable: string
  /** 运行中的 turn 可以被打断。 */
  readonly stop: string
  readonly stopping: string
  readonly stopFailed: string
  /** 运行中发送 = 排队；按钮文字与提示都要说清。 */
  readonly queueSend: string
  readonly steerHint: string
}

export const defaultComposerLabels: ComposerLabels = {
  placeholder: '输入消息，Enter 发送',
  send: '发送',
  sending: '发送中…',
  hint: 'Enter 排队发送 · Ctrl+Enter 打断并发送 · Shift+Enter 换行 · 可粘贴或拖入文件',
  unavailable: '这个会话暂时不能发送',
  attach: '附件',
  removeAttachment: '移除附件',
  uploading: '上传中',
  uploadFailed: '上传失败',
  attachUnavailable: '附件服务不可用',
  stop: '停止',
  stopping: '停止中…',
  stopFailed: '停止失败',
  queueSend: '排队发送',
  steerHint: '排队发送 · Ctrl+Enter 打断并发送',
}

export interface ComposerProps {
  readonly session?: unknown
  /** 附件上传目标；缺省时附件入口禁用。 */
  readonly sessionId?: string
  readonly uploader?: unknown
  /**
   * 这一轮是否在生成 —— 由**折叠事件流**得出（`turn/start` → `turn/end`）。
   *
   * 为什么不直接用 `session.getSnapshot().running`：真机实测那个布尔值在 turn
   * 开始约 50ms 后就落回 false，而 turn 还在继续输出（探针抓到 assistant 已写
   * 到 69 行、`running` 仍为 false）。用它做停止按钮的判据，按钮会在生成过程中
   * 消失 —— 恰好是最该点它的时候。
   *
   * `running` 仍作为补充信号（有些路径可能只更新它），两者或起来。
   */
  readonly streaming?: boolean
  readonly disabled?: boolean
  readonly labels?: ComposerLabels
}

const wrap: CSSProperties = {
  flex: '0 0 auto',
  borderTop: '1px solid var(--color-border-tertiary, rgba(0,0,0,.08))',
  padding: '8px 10px 10px',
  background: 'var(--color-background-primary, transparent)',
}

const chip: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '3px 6px 3px 4px',
  borderRadius: 7,
  border: '1px solid var(--color-border-tertiary, rgba(0,0,0,.1))',
  background: 'var(--color-background-secondary, #fff)',
  fontSize: 11,
  maxWidth: 200,
}

function errorText(error: RemoteFailureLike | undefined): string {
  if (!error) return '发送失败'
  if (typeof error.message === 'string' && error.message.length > 0) return error.message
  if (typeof error.code === 'string' && error.code.length > 0) return error.code
  return '发送失败'
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

let attachmentSeq = 0
const nextAttachmentId = (): string => `att-${(attachmentSeq += 1)}`

export function Composer(props: ComposerProps): ReactNode {
  const labels = props.labels ?? defaultComposerLabels
  const face = asSessionFace(props.session)
  const uploader = asFileUploadService(props.uploader)
  const canAttach = uploader !== undefined && typeof props.sessionId === 'string' && !props.disabled

  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<readonly AttachmentItem[]>([])
  const [sending, setSending] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [dragging, setDragging] = useState(false)
  const running = useSessionRunning(face)
  // `streaming` 是主信号（事件驱动、可靠），`running` 只是补充：
  // 有些路径只更新 Host 投影而不发事件（例如排队中），两者或起来不漏。
  const busy = props.streaming === true || running
  const canStop = busy && face?.cancel !== undefined && !props.disabled

  const areaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const uploading = attachments.some((item) => item.status === 'uploading')
  const ready = attachments.filter((item) => item.status === 'ready' && item.receiptId !== undefined)
  const canSend =
    face !== undefined && !props.disabled && !sending && !uploading && (text.trim().length > 0 || ready.length > 0)

  // 图片缩略图的 object URL 必须回收，否则每加一张泄漏一个 blob
  const previewsRef = useRef(new Set<string>())
  useEffect(() => {
    const previews = previewsRef.current
    return () => {
      for (const url of previews) URL.revokeObjectURL(url)
      previews.clear()
    }
  }, [])

  const patch = useCallback((id: string, changes: Partial<AttachmentItem>): void => {
    setAttachments((prev) => prev.map((item) => (item.id === id ? { ...item, ...changes } : item)))
  }, [])

  const removeAttachment = useCallback((id: string): void => {
    setAttachments((prev) => {
      const hit = prev.find((item) => item.id === id)
      if (hit?.previewUrl) {
        URL.revokeObjectURL(hit.previewUrl)
        previewsRef.current.delete(hit.previewUrl)
      }
      return prev.filter((item) => item.id !== id)
    })
  }, [])

  const addFiles = useCallback(
    async (files: readonly File[]): Promise<void> => {
      const sessionId = props.sessionId
      if (!uploader || !sessionId || files.length === 0) return

      for (const file of files) {
        const id = nextAttachmentId()
        const isImage = file.type.startsWith('image/')
        const previewUrl = isImage ? URL.createObjectURL(file) : undefined
        if (previewUrl) previewsRef.current.add(previewUrl)

        setAttachments((prev) => [
          ...prev,
          {
            id,
            name: file.name || (isImage ? '图片' : '文件'),
            size: file.size,
            mediaType: file.type,
            isImage,
            status: 'uploading',
            ...(previewUrl === undefined ? {} : { previewUrl }),
          },
        ])

        const onProgress = (progress: UploadProgressLike): void => {
          const ratio =
            progress.total && progress.total > 0 ? Math.min(1, progress.loaded / progress.total) : undefined
          patch(id, ratio === undefined ? {} : { progress: ratio })
        }

        try {
          // 图片优先走 uploadImage：Host 会校验、规范化并计入图片配额；
          // 其它文件走通用 upload。两者都只返回 receiptId，发送时统一用 file part。
          const result =
            isImage && uploader.uploadImage
              ? await uploader.uploadImage(sessionId, file, file.type, file.name, undefined, onProgress)
              : await uploader.upload(sessionId, file, file.name, undefined, onProgress)

          if (result.ok) {
            patch(id, { status: 'ready', receiptId: result.value.receiptId, progress: 1 })
          } else {
            patch(id, { status: 'failed', error: errorText(result.error) })
          }
        } catch (thrown) {
          patch(id, { status: 'failed', error: thrown instanceof Error ? thrown.message : String(thrown) })
        }
      }
    },
    [patch, props.sessionId, uploader],
  )

  /**
   * 发送。
   *
   * `mode` 决定这条消息怎么进队：
   * - `'queue'`：追加一轮，等当前 turn 跑完（**默认**，最安全）；
   * - `'steer'`：打断正在跑的 turn，立刻用这条消息接管。
   *
   * 只有用户显式按 Ctrl/Cmd+Enter 才走 steer —— 猜"用户大概想打断"是危险的，
   * 猜错的后果是正在生成的回答被截断。
   */
  const send = useCallback(
    async (mode: 'queue' | 'steer' = 'queue'): Promise<void> => {
      if (!face || sending || uploading) return
      const value = text.trim()
      const content: PromptPart[] = [
        ...(value.length > 0 ? [{ type: 'text' as const, text: value }] : []),
        ...ready.map((item) => ({ type: 'file' as const, receiptId: item.receiptId as string })),
      ]
      if (content.length === 0) return

      // 没在跑的时候 steer 没有可打断的对象，降级成 queue（不报错、不空转）。
      const effective: 'queue' | 'steer' = mode === 'steer' && busy ? 'steer' : 'queue'

      setSending(true)
      setError(undefined)
      try {
        const result = await face.prompt(content, effective)
        if (result.ok) {
          setText('')
          setAttachments([])
        } else {
          setError(errorText(result.error))
        }
      } catch (thrown) {
        setError(thrown instanceof Error ? thrown.message : String(thrown))
      } finally {
        setSending(false)
        areaRef.current?.focus()
      }
    },
    [busy, face, ready, sending, text, uploading],
  )

  /**
   * 打断正在跑的 turn。
   *
   * 三个刻意的决定：
   * 1) **保留"发送"按钮**（运行中发消息 = 排队）。如果把发送改成停止，就顺手
   *    废掉了 queue 模式 —— 而"停止的同时再排一条"恰恰是最常见的动作。
   * 2) `stopping` 只做 UI 反馈，真正的状态来自 `snapshot.running`。点了之后
   *    一定会由 Host 侧把 running 变成 false，不需要我们猜。
   * 3) **带超时兜底**：`cancel()` 被接受但 turn 迟迟不结束（工具调用中途不响应取消
   *    是常态），按钮不能永远灰着。8 秒后恢复可点，允许用户再试一次。
   */
  const stop = useCallback(async (): Promise<void> => {
    if (!face?.cancel || stopping) return
    setStopping(true)
    setError(undefined)
    try {
      const result = await face.cancel()
      if (!result.ok) setError(`${labels.stopFailed}：${errorText(result.error)}`)
    } catch (thrown) {
      setError(`${labels.stopFailed}：${thrown instanceof Error ? thrown.message : String(thrown)}`)
    } finally {
      // 立刻解除会把"点了没反应"变成"按钮闪一下"，所以交给 running 或超时来解除。
      // 这里只保证即使 running 一直不变也不会永久锁死。
      window.setTimeout(() => setStopping(false), STOP_TIMEOUT_MS)
    }
  }, [face, labels.stopFailed, stopping])

  // 生成结束（事件驱动的 streaming 落回 false）就是"停成了"，立刻恢复按钮。
  // 同时也看 running —— 两条路径任一恢复正常都算收工。
  useEffect(() => {
    if (!busy) setStopping(false)
  }, [busy])

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter') return
    // Shift+Enter 换行；Ctrl/Cmd+Enter 打断并发送；Enter 排队。
    if (event.shiftKey) return
    event.preventDefault()
    void send(event.ctrlKey || event.metaKey ? 'steer' : 'queue')
  }

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    const files = Array.from(event.clipboardData?.files ?? [])
    if (files.length === 0) return
    event.preventDefault()
    void addFiles(files)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setDragging(false)
    const files = Array.from(event.dataTransfer?.files ?? [])
    if (files.length > 0) void addFiles(files)
  }

  // 输入时自动增高，最多 6 行
  const autoGrow = (): void => {
    const el = areaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`
  }

  return (
    <div
      style={wrap}
      data-testid="studio-composer"
      onDragOver={(event) => {
        if (!canAttach) return
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {attachments.length > 0 && (
        <div
          data-testid="studio-composer-attachments"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}
        >
          {attachments.map((item) => (
            <div key={item.id} style={chip} data-testid="studio-composer-attachment" data-status={item.status}>
              {item.isImage && item.previewUrl ? (
                <img
                  src={item.previewUrl}
                  alt={item.name}
                  style={{ width: 22, height: 22, borderRadius: 4, objectFit: 'cover', flex: 'none' }}
                />
              ) : (
                <span style={{ fontSize: 12 }} aria-hidden="true">
                  ▤
                </span>
              )}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.status === 'uploading'
                  ? `${labels.uploading}${item.progress === undefined ? '' : ` ${Math.round(item.progress * 100)}%`}`
                  : item.status === 'failed'
                    ? `${labels.uploadFailed}：${item.error ?? ''}`
                    : `${item.name} · ${humanSize(item.size)}`}
              </span>
              <button
                type="button"
                aria-label={labels.removeAttachment}
                data-testid="studio-composer-attachment-remove"
                onClick={() => removeAttachment(item.id)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'inherit',
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: 12,
                  opacity: 0.6,
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 8,
          padding: '6px 8px',
          border: `1px solid ${
            dragging ? 'var(--color-border-info, #4a7dff)' : 'var(--color-border-secondary, rgba(0,0,0,.12))'
          }`,
          borderRadius: 10,
          background: 'var(--color-background-secondary, #fff)',
        }}
      >
        <button
          type="button"
          data-testid="studio-composer-attach"
          disabled={!canAttach}
          title={canAttach ? labels.attach : labels.attachUnavailable}
          onClick={() => fileInputRef.current?.click()}
          style={{
            flex: '0 0 auto',
            width: 26,
            height: 26,
            borderRadius: 7,
            border: '1px solid var(--color-border-secondary, rgba(0,0,0,.12))',
            background: 'transparent',
            color: canAttach ? 'inherit' : 'var(--color-text-tertiary, #8a8a85)',
            fontSize: 14,
            lineHeight: 1,
            cursor: canAttach ? 'pointer' : 'default',
          }}
        >
          +
        </button>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          data-testid="studio-composer-file-input"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            event.target.value = '' // 允许重复选同一个文件
            void addFiles(files)
          }}
        />

        <textarea
          ref={areaRef}
          data-testid="studio-composer-input"
          value={text}
          rows={1}
          disabled={!face || props.disabled}
          placeholder={face ? labels.placeholder : labels.unavailable}
          onChange={(event) => {
            setText(event.target.value)
            autoGrow()
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          style={{
            flex: '1 1 auto',
            minWidth: 0,
            resize: 'none',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: 'inherit',
            fontFamily: 'inherit',
            fontSize: 13,
            lineHeight: 1.55,
            padding: '2px 0',
            maxHeight: 132,
            overflowY: 'auto',
          }}
        />
        {/* 停止按钮只在运行中且会话面提供 cancel 时出现。
            刻意不替换"发送"——运行中发送 = 排队，那是另一个有用的动作。 */}
        {canStop && (
          <button
            type="button"
            data-testid="studio-composer-stop"
            onClick={() => void stop()}
            disabled={stopping}
            title={labels.stop}
            style={{
              flex: '0 0 auto',
              padding: '4px 10px',
              borderRadius: 7,
              border: '1px solid var(--color-border-secondary, rgba(0,0,0,.12))',
              background: 'transparent',
              color: stopping
                ? 'var(--color-text-tertiary, #8a8a85)'
                : 'var(--color-text-secondary, #55554f)',
              fontSize: 12,
              fontFamily: 'inherit',
              cursor: stopping ? 'default' : 'pointer',
            }}
          >
            {stopping ? labels.stopping : labels.stop}
          </button>
        )}
        <button
          type="button"
          data-testid="studio-composer-send"
          onClick={() => void send('queue')}
          disabled={!canSend}
          // 运行中 hover 能看出还有一条"打断并发送"的路径，否则快捷键没人发现
          title={busy && face?.cancel !== undefined ? labels.steerHint : labels.send}
          style={{
            flex: '0 0 auto',
            padding: '4px 12px',
            borderRadius: 7,
            border: '1px solid var(--color-border-secondary, rgba(0,0,0,.12))',
            background: canSend
              ? 'var(--color-background-info, #2c2c2a)'
              : 'var(--color-background-tertiary, rgba(0,0,0,.06))',
            color: canSend ? 'var(--color-text-inverse, #faf9f6)' : 'var(--color-text-tertiary, #8a8a85)',
            fontSize: 12,
            fontFamily: 'inherit',
            cursor: canSend ? 'pointer' : 'default',
          }}
        >
          {sending ? labels.sending : busy ? labels.queueSend : labels.send}
        </button>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 8,
          marginTop: 5,
          fontSize: 10,
          color: 'var(--color-text-tertiary, #8a8a85)',
        }}
      >
        <span>{labels.hint}</span>
        {error && (
          <span data-testid="studio-composer-error" role="alert" style={{ color: 'var(--color-text-danger, #c0392b)' }}>
            {error}
          </span>
        )}
      </div>
    </div>
  )
}
