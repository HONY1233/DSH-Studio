/**
 * 会话级工具集（X4.3）。
 *
 * 这里只做两件事：把 Host 给出的真实 capability 快照投影成可选列表，以及把
 * 用户勾选发成 `workbench.toolset.set`。**绝不把 capability 一起发给 Main**：
 * UI 没有资格声明某个工具可用；伪造的 grade 必须由 Main 用 Host 快照重新校验。
 *
 * 未接入 `window.dshStudio` 时整块控件不渲染，旧入口和浏览器半都不受影响。
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'

export interface WorkbenchCapabilityRow {
  readonly grade: string
  readonly evidence?: string
  readonly reason?: string
}

export interface WorkbenchCapacityRow {
  readonly used: number
  readonly limit: number
}

export interface WorkbenchCapacity {
  readonly toolInstances: WorkbenchCapacityRow & { readonly perToolLimit: number }
  readonly terminalInstances: WorkbenchCapacityRow
  readonly browserTabs: WorkbenchCapacityRow
  readonly eventQueue: WorkbenchCapacityRow
  readonly overloaded: boolean
}

export interface WorkbenchToolsetReadModel {
  readonly schemaVersion: number
  readonly sessionId: string
  readonly revision: number
  readonly capabilityRevision: string
  readonly capabilities: {
    readonly source: string
    readonly revision: string
    readonly observedAt: string
    readonly tools: Readonly<Record<string, WorkbenchCapabilityRow>>
  }
  readonly toolset: readonly string[]
  readonly effectiveToolset: readonly string[]
  readonly staleToolset: readonly { readonly toolId: string; readonly reason: string }[]
  readonly instances: readonly { readonly toolId: string; readonly state: string }[]
  readonly capacity?: WorkbenchCapacity
}

interface QueryResponse {
  readonly ok?: boolean
  readonly result?: unknown
  readonly error?: { readonly code?: string; readonly message?: string }
}

interface CommandReceipt {
  readonly requestId: string
  readonly status: string
  readonly result?: unknown
  readonly error?: { readonly code?: string; readonly message?: string }
}

interface WorkbenchBridge {
  openContext(scope: { readonly sessionId: string }): Promise<string>
  close(contextId: string): Promise<void>
  query(request: { readonly queryName: string; readonly input: unknown }, contextId?: string): Promise<QueryResponse>
  command(request: {
    readonly requestId: string
    readonly commandName: string
    readonly input: unknown
  }, contextId?: string): Promise<unknown>
  subscribe(
    scope: Record<string, never>,
    listener: (event: {
      readonly kind?: string
      readonly sessionId?: string
      readonly receipt?: CommandReceipt
    }) => void,
    contextId?: string,
  ): () => void
}

function bridgeOf(): WorkbenchBridge | undefined {
  const candidate = (globalThis as { dshStudio?: Partial<WorkbenchBridge> }).dshStudio
  if (!candidate
    || typeof candidate.openContext !== 'function'
    || typeof candidate.close !== 'function'
    || typeof candidate.query !== 'function'
    || typeof candidate.command !== 'function'
    || typeof candidate.subscribe !== 'function') {
    return undefined
  }
  return candidate as WorkbenchBridge
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const TOOL_LABELS: Readonly<Record<string, string>> = {
  files: '文件',
  changes: '变更',
  git: 'Git',
  terminal: '终端',
  browser: '浏览器',
  computer: '电脑',
  ssh: 'SSH',
  wsl: 'WSL',
  mcp: 'MCP',
  skills: '技能',
  agents: '子代理',
  btw: 'BTW',
  voice: '语音',
  evaluation: '评测',
  'time-travel': '时间旅行',
}

const GRADE_LABELS: Readonly<Record<string, string>> = {
  available: '可用',
  limited: '受限',
  configured: '已配置',
  unavailable: '不可用',
  unsupported: '不支持',
  unknown: '未知',
}

const bar: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
  padding: '4px 10px',
  borderBottom: '1px solid var(--color-border-tertiary, rgba(0,0,0,.06))',
  fontSize: 10,
  color: 'var(--color-text-tertiary, #8a8a85)',
}

const pill: CSSProperties = {
  padding: '1px 6px',
  borderRadius: 999,
  border: '1px solid var(--color-border-secondary, rgba(0,0,0,.12))',
  background: 'var(--color-background-secondary, #fff)',
  fontSize: 10,
}

const menu: CSSProperties = {
  flexBasis: '100%',
  maxHeight: 240,
  overflowY: 'auto',
  padding: '6px 0 2px',
  borderTop: '1px dashed var(--color-border-tertiary, rgba(0,0,0,.08))',
}

const row: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  padding: '2px 0',
  color: 'var(--color-text-secondary, #5f5e5a)',
}

const reasonStyle: CSSProperties = {
  color: 'var(--color-text-tertiary, #8a8a85)',
  fontSize: 10,
}

function errorMessageOf(receipt: CommandReceipt): string {
  return receipt.error?.message ?? '工具集更新失败'
}

export function SessionToolsetBar(props: { readonly sessionId: string }): ReactNode {
  const { sessionId } = props
  const [status, setStatus] = useState<'loading' | 'ready' | 'absent' | 'error'>('loading')
  const [model, setModel] = useState<WorkbenchToolsetReadModel | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)

  const apiRef = useRef<WorkbenchBridge | undefined>(undefined)
  const contextRef = useRef<string | null>(null)
  const pending = useRef(new Map<string, (receipt: CommandReceipt) => void>())
  const sequence = useRef(0)
  const refreshRef = useRef<(clearError?: boolean) => Promise<void>>(async () => {})

  useEffect(() => {
    const api = bridgeOf()
    apiRef.current = api
    if (!api) {
      setStatus('absent')
      return undefined
    }

    let cancelled = false
    let contextId: string | null = null
    let unsubscribe: (() => void) | undefined
    // 切会话时先清空旧模型：加载期间绝不能把上一场会话的工具集显示给新会话。
    setModel(null)
    setOpen(false)
    setStatus('loading')
    setError(null)

    const refresh = async (clearError = true): Promise<void> => {
      if (!contextId || cancelled) return
      try {
        const response = await api.query({ queryName: 'workbench.toolset.get', input: {} }, contextId)
        if (cancelled) return
        if (response?.ok !== true || !response.result) {
          throw new Error(response?.error?.message ?? '读取工具集失败')
        }
        setModel(response.result as WorkbenchToolsetReadModel)
        if (clearError) setError(null)
        setStatus('ready')
      } catch (failure) {
        if (cancelled) return
        setError(messageOf(failure))
        setStatus('error')
      }
    }
    refreshRef.current = refresh

    api.openContext({ sessionId }).then((opened) => {
      if (cancelled) {
        void api.close(opened)
        return
      }
      contextId = opened
      contextRef.current = opened
      unsubscribe = api.subscribe({}, (event) => {
        if (cancelled) return
        if (event.kind === 'command.receipt' && event.receipt) {
          const settle = pending.current.get(event.receipt.requestId)
          if (settle) {
            pending.current.delete(event.receipt.requestId)
            settle(event.receipt)
          }
          return
        }
        // 同一会话的另一个视图改了工具集：重新读 Host 真相，不在本地拼状态。
        if (event.kind === 'workbench.toolset.changed'
          && (event.sessionId === undefined || event.sessionId === sessionId)) {
          void refresh()
        }
      }, opened)
      return refresh()
    }).catch((failure) => {
      if (cancelled) return
      setError(messageOf(failure))
      setStatus('error')
    })

    return () => {
      cancelled = true
      unsubscribe?.()
      cancelPending(pending.current)
      contextRef.current = null
      if (contextId) void api.close(contextId)
    }
  }, [sessionId])

  const send = useCallback(async (commandName: string, input: unknown): Promise<CommandReceipt> => {
    const api = apiRef.current
    const contextId = contextRef.current
    if (!api || !contextId) throw new Error('Host 上下文尚未就绪')
    sequence.current += 1
    const requestId = `studio-toolset-${sequence.current}`
    const receipt = await new Promise<CommandReceipt>((resolve, reject) => {
      pending.current.set(requestId, resolve)
      api.command({ requestId, commandName, input }, contextId).catch((failure) => {
        pending.current.delete(requestId)
        reject(failure)
      })
    })
    if (receipt.status !== 'completed') throw new Error(errorMessageOf(receipt))
    return receipt
  }, [])

  const toggle = useCallback(async (toolId: string): Promise<void> => {
    if (!model || busy) return
    const selected = model.toolset.includes(toolId)
    // 移除永远允许（包括能力已变 unavailable 的残留选择）；新增才要求 available。
    if (!selected && model.capabilities.tools[toolId]?.grade !== 'available') return
    const next = selected
      ? model.toolset.filter((id) => id !== toolId)
      : [...model.toolset, toolId]
    setBusy(true)
    setError(null)
    try {
      // 只发送选择结果和两个 revision；capability 是 Host 的事，UI 不附带。
      const receipt = await send('workbench.toolset.set', {
        expectedRevision: model.revision,
        capabilityRevision: model.capabilityRevision,
        toolset: next,
      })
      if (receipt.result) setModel(receipt.result as WorkbenchToolsetReadModel)
    } catch (failure) {
      setError(messageOf(failure))
      // 冲突时读回最新 revision，下一次点击不能继续撞旧值；但保留本次错误。
      await refreshRef.current(false)
    } finally {
      setBusy(false)
    }
  }, [busy, model, send])

  if (status === 'absent' || (!model && status === 'loading')) return null
  if (!model) {
    return (
      <div style={bar} data-testid="session-toolset" data-status={status}>
        <span role="alert" style={{ color: 'var(--color-text-danger, #c0392b)' }}>{error ?? '工具集不可用'}</span>
      </div>
    )
  }

  const openInstances = new Map<string, number>()
  for (const instance of model.instances) {
    if (instance.state === 'closed') continue
    openInstances.set(instance.toolId, (openInstances.get(instance.toolId) ?? 0) + 1)
  }
  const rows = Object.entries(model.capabilities.tools)
  const stale = new Map(model.staleToolset.map((item) => [item.toolId, item.reason]))
  const capacity = model.capacity
  const capacityAtLimit = capacity
    ? capacity.overloaded
      || capacity.toolInstances.used >= capacity.toolInstances.limit
      || capacity.eventQueue.used >= capacity.eventQueue.limit
    : false
  const capacityDetail = capacity
    ? [
        `实例 ${capacity.toolInstances.used}/${capacity.toolInstances.limit}`,
        ...(capacity.terminalInstances.used > 0
          ? [`终端 ${capacity.terminalInstances.used}/${capacity.terminalInstances.limit}`]
          : []),
        ...(capacity.browserTabs.used > 0
          ? [`浏览器 ${capacity.browserTabs.used}/${capacity.browserTabs.limit}`]
          : []),
        `队列 ${capacity.eventQueue.used}/${capacity.eventQueue.limit}`,
      ].join(' · ')
    : null

  return (
    <div style={bar} data-testid="session-toolset" data-status={status}>
      <span>工具</span>
      {model.toolset.length === 0 ? (
        <span>未选择</span>
      ) : (
        model.toolset.map((toolId) => (
          <span
            key={toolId}
            style={{
              ...pill,
              ...(model.effectiveToolset.includes(toolId)
                ? {}
                : { borderColor: 'var(--color-text-danger, #c0392b)', color: 'var(--color-text-danger, #c0392b)' }),
            }}
            title={stale.get(toolId) ?? undefined}
          >
            {TOOL_LABELS[toolId] ?? toolId}
          </span>
        ))
      )}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        style={{ ...pill, cursor: 'pointer', fontFamily: 'inherit' }}
      >
        {open ? '收起' : '选择'}
      </button>
      {busy ? <span role="status">更新中…</span> : null}
      {error ? (
        <span role="alert" style={{ color: 'var(--color-text-danger, #c0392b)' }}>{error}</span>
      ) : null}
      {capacityDetail ? (
        <span
          data-testid="session-capacity"
          data-overloaded={capacityAtLimit ? 'true' : 'false'}
          title={`单工具实例上限 ${capacity?.toolInstances.perToolLimit ?? '?'}`}
          style={capacityAtLimit ? { color: 'var(--color-text-danger, #c0392b)' } : undefined}
        >
          {capacityDetail}
        </span>
      ) : null}

      {open ? (
        <div style={menu} role="group" aria-label="工具能力">
          {rows.length === 0 ? <div style={reasonStyle}>Host 没有返回任何工具能力</div> : null}
          {rows.map(([toolId, capability]) => {
            const selected = model.toolset.includes(toolId)
            const available = capability.grade === 'available'
            const instanceCount = openInstances.get(toolId) ?? 0
            const locked = selected && instanceCount > 0
            return (
              <label
                key={toolId}
                style={{ ...row, opacity: available ? 1 : 0.65 }}
                data-tool-id={toolId}
                data-grade={capability.grade}
                title={locked ? '该工具仍有未关闭的实例，先关闭实例再移除' : undefined}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={busy || locked || (!available && !selected)}
                  onChange={() => { void toggle(toolId) }}
                />
                <span style={{ minWidth: 64 }}>{TOOL_LABELS[toolId] ?? toolId}</span>
                <span style={{ ...reasonStyle, minWidth: 44 }}>{GRADE_LABELS[capability.grade] ?? capability.grade}</span>
                {capability.reason ? <span style={reasonStyle}>{capability.reason}</span> : null}
                {instanceCount > 0 ? (
                  <span style={reasonStyle}>{instanceCount} 个未关闭实例</span>
                ) : null}
              </label>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

/** 卸载时让等待回执的 Promise 落地，避免调用方永久挂起。 */
function cancelPending(entries: Map<string, (receipt: CommandReceipt) => void>): void {
  for (const settle of entries.values()) {
    settle({
      requestId: '',
      status: 'failed',
      error: { code: 'CANCELLED', message: '会话工具集已卸载' },
    })
  }
  entries.clear()
}