/**
 * 工具调用的渲染：默认收起成一行，点击展开参数与结果。
 *
 * 三条设计：
 *
 * 1) **默认收起**。一次任务里工具调用可能几十次，全展开会把对话刷成日志墙。
 *    收起态只留"图标 + 工具名 + 参数摘要"，一眼能看出"它在干什么"。
 * 2) **参数不解析也要能看**。模型偶尔产出不合法 JSON，`arguments` 是原始字符串，
 *    解析失败就原样显示 —— 而不是显示一个空白或 "undefined"。
 * 3) **结果先给 400 字符，可展开全文**。折叠层保留全文（有上限），这里默认显示
 *    前 400 —— 够判断"跑通了没"，又不至于把对话冲到看不见底。以前只在折叠层
 *    截断，400 之外连展开的机会都没有，排查时很被动。
 */

import { useCallback, useState, type CSSProperties, type ReactNode } from 'react'

import type { ToolCallState } from '../session-derived/conversation.js'

export interface ToolCallLabels {
  readonly running: string
  readonly done: string
  readonly failed: string
  /** turn 结束时还没结果的调用 —— 不会再有结果了。 */
  readonly interrupted: string
  readonly expand: string
  readonly collapse: string
  readonly arguments: string
  readonly result: string
  readonly noResult: string
  /** 结果超过预览长度时的展开按钮。 */
  readonly showFullResult: (chars: number) => string
  readonly collapseResult: string
  /** 结果超过折叠层保留上限 —— 界面必须说清剩下的在日志里。 */
  readonly resultClipped: (total: number) => string
}

export const defaultToolCallLabels: ToolCallLabels = {
  running: '运行中',
  done: '完成',
  failed: '失败',
  interrupted: '已中断',
  expand: '展开工具调用详情',
  collapse: '收起工具调用详情',
  arguments: '参数',
  result: '结果',
  noResult: '（没有输出）',
  showFullResult: (chars) => `展开全文（共 ${chars} 字符）`,
  collapseResult: '收起全文',
  resultClipped: (total) => `只保留前 ${RESULT_KEEP_HINT} 字符，完整输出在会话日志里（共 ${total} 字符）`,
}

/** 默认预览多少字符。够看开头和结论，又不至于把对话顶下去。 */
const RESULT_PREVIEW_CHARS = 400

/** 文案里的量级提示，和折叠层的保留上限保持一致。 */
const RESULT_KEEP_HINT = 20_000

/**
 * 参数摘要：优先取第一个有意义的字符串值（`path` / `command` / `query`…），
 * 这样收起态显示的多半是最有信息量的那一项。
 */
export function summarizeArguments(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === '') return ''
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const entries = Object.entries(parsed as Record<string, unknown>)
      // 优先这几个常见键（顺序即优先级）
      const preferred = ['path', 'file_path', 'command', 'pattern', 'query', 'url', 'name']
      for (const key of preferred) {
        const hit = entries.find(([k]) => k === key)
        if (hit && typeof hit[1] === 'string') return hit[1]
      }
      const firstString = entries.find(([, v]) => typeof v === 'string')
      if (firstString) return String(firstString[1])
      return entries.length === 0 ? '' : `{${entries.map(([k]) => k).join(', ')}}`
    }
    if (Array.isArray(parsed)) return `[${parsed.length} 项]`
    return String(parsed)
  } catch {
    // 非法 JSON：原样给前 80 字符，比什么都不显示强
    return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed
  }
}

/** 把 JSON 字符串美化；失败就返回原文（不隐藏问题）。 */
export function prettyArguments(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === '') return ''
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return raw
  }
}

const row: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 6,
  padding: '4px 9px',
  border: '1px solid var(--color-border-tertiary, rgba(0,0,0,.08))',
  borderRadius: 7,
  background: 'var(--color-background-secondary, #f7f6f2)',
  fontSize: 11,
  color: 'var(--color-text-secondary, #55554f)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
}

const STATUS_ICON = { running: '◌', done: '✓', error: '✗', interrupted: '⊘' } as const
const STATUS_COLOR = {
  running: 'var(--color-text-tertiary, #8a8a85)',
  done: 'var(--color-text-secondary, #55554f)',
  error: 'var(--color-text-danger, #b4472f)',
  interrupted: 'var(--color-text-tertiary, #8a8a85)',
} as const

export interface ToolCallViewProps {
  readonly tool: ToolCallState
  readonly labels?: ToolCallLabels
}

export function ToolCallView(props: ToolCallViewProps): ReactNode {
  const labels = props.labels ?? defaultToolCallLabels
  const { tool } = props
  const [expanded, setExpanded] = useState(false)
  const [fullResult, setFullResult] = useState(false)
  const toggle = useCallback(() => setExpanded((v) => !v), [])
  const toggleResult = useCallback(() => setFullResult((v) => !v), [])

  const resultText = tool.result ?? ''
  const errorText = tool.error ?? ''
  const needsToggle = resultText.length > RESULT_PREVIEW_CHARS
  const shownResult = fullResult ? resultText : resultText.slice(0, RESULT_PREVIEW_CHARS)

  // 结果区正文：状态文案优先于内容，但不掩盖已经拿到的部分。
  const bodyText =
    tool.status === 'running'
      ? labels.running
      : resultText.trim() === ''
        ? tool.status === 'interrupted'
          ? labels.interrupted
          : labels.noResult
        : shownResult

  const summary = summarizeArguments(tool.arguments)
  const statusText =
    tool.status === 'running'
      ? labels.running
      : tool.status === 'error'
        ? labels.failed
        : tool.status === 'interrupted'
          ? labels.interrupted
          : labels.done

  return (
    <div
      data-testid="tool-call"
      data-call-id={tool.callId}
      data-status={tool.status}
      data-expanded={expanded ? 'true' : 'false'}
      style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: '100%' }}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        aria-label={expanded ? labels.collapse : labels.expand}
        style={{
          ...row,
          textAlign: 'left',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          cursor: 'pointer',
          width: 'fit-content',
          maxWidth: '100%',
        }}
      >
        <span aria-hidden style={{ color: STATUS_COLOR[tool.status], flex: '0 0 auto' }}>
          {STATUS_ICON[tool.status]}
        </span>
        <span style={{ fontWeight: 500, flex: '0 0 auto' }}>{tool.name || 'tool'}</span>
        {summary !== '' && (
          <span
            style={{
              opacity: 0.75,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            {summary}
          </span>
        )}
        <span style={{ opacity: 0.55, flex: '0 0 auto', fontSize: 10 }}>{statusText}</span>
      </button>

      {expanded && (
        <div
          data-testid="tool-call-detail"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: '6px 9px',
            borderLeft: '2px solid var(--color-border-secondary, #e2e0d9)',
            marginLeft: 6,
          }}
        >
          {tool.arguments.trim() !== '' && (
            <section>
              <div style={{ fontSize: 10, opacity: 0.6, marginBottom: 2 }}>{labels.arguments}</div>
              <pre
                style={{
                  margin: 0,
                  padding: '6px 8px',
                  borderRadius: 6,
                  background: 'var(--color-background-secondary, #f7f6f2)',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 11,
                  lineHeight: 1.5,
                  overflowX: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  color: 'var(--color-text-primary, #2c2c2a)',
                }}
              >
                {prettyArguments(tool.arguments)}
              </pre>
            </section>
          )}

          <section>
            <div style={{ fontSize: 10, opacity: 0.6, marginBottom: 2 }}>{labels.result}</div>
            {errorText !== '' && (
              <div
                data-testid="tool-call-error"
                style={{
                  marginBottom: 4,
                  fontSize: 11,
                  color: 'var(--color-text-danger, #b4472f)',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  wordBreak: 'break-word',
                }}
              >
                {errorText}
              </div>
            )}
            <pre
              style={{
                margin: 0,
                padding: '6px 8px',
                borderRadius: 6,
                background: 'var(--color-background-secondary, #f7f6f2)',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 11,
                lineHeight: 1.5,
                // 展开全文后长行仍然只横向滚动，不换行成一片糊 —— 读日志要看行结构
                maxHeight: fullResult ? 480 : 'none',
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color:
                  tool.status === 'error'
                    ? 'var(--color-text-danger, #b4472f)'
                    : 'var(--color-text-primary, #2c2c2a)',
              }}
            >
              {bodyText}
            </pre>
            {needsToggle && (
              <button
                type="button"
                data-testid="tool-call-result-toggle"
                aria-expanded={fullResult}
                onClick={toggleResult}
                style={{
                  alignSelf: 'flex-start',
                  marginTop: 2,
                  padding: '1px 7px',
                  borderRadius: 5,
                  border: '1px solid var(--color-border-tertiary, rgba(0,0,0,.1))',
                  background: 'transparent',
                  color: 'var(--color-text-link, #2f6fb3)',
                  fontSize: 10,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                }}
              >
                {fullResult ? labels.collapseResult : labels.showFullResult(tool.resultChars ?? resultText.length)}
              </button>
            )}
            {fullResult && tool.resultClipped === true && (
              <div
                data-testid="tool-call-result-clipped"
                style={{ marginTop: 3, fontSize: 10, opacity: 0.65, color: 'var(--color-text-tertiary, #8a8a85)' }}
              >
                {labels.resultClipped(tool.resultChars ?? resultText.length)}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
