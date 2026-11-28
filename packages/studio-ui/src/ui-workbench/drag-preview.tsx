import { useLayoutEffect, useRef, type ReactNode } from 'react'

export interface DragPreviewProps {
  readonly kind: string
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  readonly content: HTMLElement | null
  readonly sourceSize: { readonly w: number; readonly h: number }
}

/** 真实正文克隆只用于展示；外层裁剪并缩放到当前落点。 */
export function DragPreview({ kind, rect, content, sourceSize }: DragPreviewProps): ReactNode {
  const contentRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const mount = contentRef.current
    if (!mount || !content) return
    if (content.parentElement !== mount) mount.appendChild(content)
  }, [content])

  const scaleX = sourceSize.w > 0 ? rect.w / sourceSize.w : 1
  const scaleY = sourceSize.h > 0 ? rect.h / sourceSize.h : 1

  return (
    <div
      data-drag-preview={kind}
      data-drag-preview-live={content ? 'true' : 'false'}
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        overflow: 'hidden',
        pointerEvents: 'none',
        border: content ? '1px solid var(--color-border-primary)' : '1px dashed var(--color-border-primary)',
        borderRadius: 8,
        background: content
          ? 'var(--color-background-primary)'
          : 'color-mix(in srgb, var(--color-background-info) 40%, transparent)',
        boxShadow: content ? '0 12px 32px rgb(0 0 0 / 24%)' : undefined,
        zIndex: 50,
      }}
    >
      {content ? (
        <div
          ref={contentRef}
          style={{
            width: sourceSize.w,
            height: sourceSize.h,
            transform: `scale(${scaleX}, ${scaleY})`,
            transformOrigin: 'top left',
          }}
        />
      ) : null}
    </div>
  )
}
