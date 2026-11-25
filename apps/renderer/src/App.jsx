import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  appendNotice,
  appendUserMessage,
  applySessionStatus,
  createSessionView,
  projectSessionEvent,
} from '@dsh-studio/contract'
import FilePanel from './FilePanel.jsx'
import ChangesPanel from './ChangesPanel.jsx'
import TerminalPanel from './TerminalPanel.jsx'
import BrowserPanel from './BrowserPanel.jsx'
import LogsPanel from './LogsPanel.jsx'

export default function App() {
  const [info, setInfo] = useState(null)
  const [state, setState] = useState({ state: 'starting', detail: '' })
  const [sessions, setSessions] = useState({ order: [], views: {}, active: null })
  const [approvals, setApprovals] = useState([])
  const [input, setInput] = useState('')
  const [stderr, setStderr] = useState([])
  const [recent, setRecent] = useState(null)
  const [panel, setPanel] = useState(null)
  const bottomRef = useRef(null)

  const view = sessions.active ? sessions.views[sessions.active] : null
  const running = view?.status === 'running'
  const usage = useMemo(() => {
    if (!view?.usage) return null
    const { inputTokens = 0, outputTokens = 0 } = view.usage
    return `${inputTokens} in / ${outputTokens} out`
  }, [view?.usage])
  const activeApprovals = useMemo(
    () => approvals.filter((request) => request.params?.sessionId === sessions.active),
    [approvals, sessions.active],
  )

  useEffect(() => {
    window.dsh.info().then((value) => {
      setInfo(value)
      const detail = value.serverInfo
        ? `${value.serverInfo.name} ${value.serverInfo.version}`
        : ''
      setState({ state: value.state, detail })
      const ids = value.sessionIds?.length ? value.sessionIds : [value.sessionId]
      const views = {}
      for (const id of ids) views[id] = createSessionView(id)
      setSessions({ order: ids, views, active: ids[0] })
    })

    const offs = [
      window.dsh.onState((payload) => setState(payload)),
      window.dsh.onReady((serverInfo) => {
        setState({ state: 'ready', detail: `${serverInfo.name} ${serverInfo.version}` })
      }),
      window.dsh.onStderr((line) => setStderr((prev) => [...prev.slice(-40), line])),
      window.dsh.onRequest((payload) => setApprovals((prev) => [...prev, payload])),
      window.dsh.onRequestSettled(({ requestId }) => {
        setApprovals((prev) => prev.filter((item) => item.requestId !== requestId))
      }),
      window.dsh.onNotification(({ method, params }) => {
        if (method === 'session.status') {
          applyToSession(params.sessionId, (sessionView) => applySessionStatus(sessionView, params.status))
          return
        }
        if (method !== 'session.event') return
        applyToSession(params.sessionId, (sessionView) => projectSessionEvent(sessionView, params.event))
      }),
    ]

    return () => offs.forEach((off) => off())
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [view?.items, activeApprovals])

  function applyToSession(sessionId, update) {
    setSessions((prev) => {
      const sessionView = prev.views[sessionId]
      if (!sessionView) return prev
      return { ...prev, views: { ...prev.views, [sessionId]: update(sessionView) } }
    })
  }

  function updateActive(update) {
    if (!sessions.active) return
    applyToSession(sessions.active, update)
  }

  async function createSession() {
    const { sessionId } = await window.dsh.createSession()
    setSessions((prev) => ({
      order: [...prev.order, sessionId],
      views: { ...prev.views, [sessionId]: createSessionView(sessionId) },
      active: sessionId,
    }))
    setInput('')
  }

  function selectSession(sessionId) {
    setSessions((prev) => ({ ...prev, active: sessionId }))
  }

  function closeSession(sessionId) {
    setSessions((prev) => {
      if (prev.order.length <= 1) return prev
      const order = prev.order.filter((id) => id !== sessionId)
      const views = { ...prev.views }
      delete views[sessionId]
      const active = prev.active === sessionId
        ? order[Math.max(0, prev.order.indexOf(sessionId) - 1)]
        : prev.active
      return { order, views, active }
    })
  }

  async function openRecentList() {
    const sessions = await window.dsh.listSessions()
    setRecent(sessions)
  }

  async function openPersistedSession(sessionId) {
    setRecent(null)
    if (sessions.views[sessionId]) {
      setSessions((prev) => ({ ...prev, active: sessionId }))
      return
    }
    const { events } = await window.dsh.openSession(sessionId).catch((error) => {
      updateActive((sessionView) => appendNotice(sessionView, { level: 'error', text: error.message }))
      return { events: [] }
    })
    let history = createSessionView(sessionId)
    for (const event of events) history = projectSessionEvent(history, event)
    history.status = 'idle'
    setSessions((prev) => ({
      order: [...prev.order, sessionId],
      views: { ...prev.views, [sessionId]: history },
      active: sessionId,
    }))
  }

  async function send() {
    const text = input.trim()
    if (!text || !info || state.state !== 'ready' || !sessions.active) return
    const sessionId = sessions.active
    setInput('')
    try {
      const receipt = await window.dsh.query(sessionId, text)
      if (receipt?.kind === 'command') {
        const result = receipt.execution?.result ?? {}
        applyToSession(sessionId, (sessionView) => appendNotice(appendUserMessage(sessionView, text), {
          level: result.kind === 'success' ? 'info' : 'warn',
          text: result.text ?? result.message ?? '命令已执行',
        }))
      }
    } catch (error) {
      applyToSession(sessionId, (sessionView) => projectSessionEvent(sessionView, {
        type: 'turn/end',
        data: { reason: { kind: 'error', error: { message: error.message } } },
      }))
    }
  }

  async function decide(request, result) {
    await window.dsh.respondRequest(request.requestId, result)
    setApprovals((prev) => prev.filter((item) => item.requestId !== request.requestId))
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="dot" data-state={state.state} />
          <span>DSH Studio</span>
          {view?.title && <span className="title">{view.title}</span>}
        </div>
        <div className="meta">
          <button className={`chip action ${panel === 'files' ? 'on' : ''}`} onClick={() => setPanel(panel === 'files' ? null : 'files')}>文件</button>
          <button className={`chip action ${panel === 'changes' ? 'on' : ''}`} onClick={() => setPanel(panel === 'changes' ? null : 'changes')}>变更</button>
          <button className={`chip action ${panel === 'terminal' ? 'on' : ''}`} onClick={() => setPanel(panel === 'terminal' ? null : 'terminal')}>终端</button>
          <button className={`chip action ${panel === 'browser' ? 'on' : ''}`} onClick={() => setPanel(panel === 'browser' ? null : 'browser')}>浏览器</button>
          <button className={`chip action ${panel === 'logs' ? 'on' : ''}`} onClick={() => setPanel(panel === 'logs' ? null : 'logs')}>日志</button>
          <span className="chip">{info?.provider} / {info?.model}</span>
          <span className="chip mono">{info?.cwd}</span>
          {usage && <span className="chip mono">tokens {usage}</span>}
          <span className="chip mono status">{state.state}{state.detail ? ` · ${state.detail}` : ''}</span>
        </div>
      </header>

      <nav className="tabs">
        {sessions.order.map((sessionId, index) => {
          const sessionView = sessions.views[sessionId]
          return (
            <button
              key={sessionId}
              className={`tab ${sessions.active === sessionId ? 'active' : ''}`}
              onClick={() => selectSession(sessionId)}
              title={sessionId}
            >
              <span className="tab-title">{sessionView?.title || `会话 ${index + 1}`}</span>
              {sessionView?.status === 'running' && <span className="tab-dot" />}
              {sessions.order.length > 1 && (
                <span
                  className="tab-close"
                  role="button"
                  tabIndex={-1}
                  onClick={(event) => {
                    event.stopPropagation()
                    closeSession(sessionId)
                  }}
                >
                  ×
                </span>
              )}
            </button>
          )
        })}
        <button className="tab new" onClick={createSession}>＋ 新会话</button>
        <button className="tab recent" onClick={openRecentList}>最近会话</button>
      </nav>

      {recent && (
        <div className="drawer">
          <div className="drawer-head">
            <strong>最近会话 · {recent.length}</strong>
            <button onClick={() => setRecent(null)}>关闭</button>
          </div>
          <ul>
            {recent.map((session) => (
              <li key={session.id}>
                <button className="recent-item" data-session-id={session.id} onClick={() => openPersistedSession(session.id)}>
                  <span className="recent-title">{session.title || session.id}</span>
                  <span className="recent-meta">
                    {(session.cwd ?? '').replace('/home/qtt199', '~')}
                    {session.createdAt ? ` · ${new Date(session.createdAt).toLocaleString()}` : ''}
                  </span>
                </button>
              </li>
            ))}
            {recent.length === 0 && <li className="recent-empty">没有找到持久化会话</li>}
          </ul>
        </div>
      )}

      {activeApprovals.map((request) => (
        <div className="approval" key={request.requestId}>
          <div>
            <strong>{request.method}</strong>
            <pre>{JSON.stringify(request.params, null, 2)}</pre>
          </div>
          <div className="approval-actions">
            <button className="primary" onClick={() => decide(request, { outcome: 'allowed-once' })}>允许一次</button>
            <button onClick={() => decide(request, { outcome: 'rejected' })}>拒绝</button>
            <button onClick={() => decide(request, { outcome: 'cancelled' })}>取消</button>
          </div>
        </div>
      ))}

      <div className="workspace">
      <main className="stream">
        {(!view || view.items.length === 0) && (
          <div className="empty">
            <h1>把工作台连上 DSH 运行时</h1>
            <p>握手已完成即可对话；命令如 <code>/plan off</code>、<code>/compact</code> 也走同一个入口。</p>
          </div>
        )}
        {view?.items.map((item, index) => {
          if (item.kind === 'message') {
            return (
              <article className={`bubble ${item.role}`} key={`${item.id}-${index}`}>
                <div className="role">{item.role}</div>
                <div className="text">{item.text || '（空）'}</div>
              </article>
            )
          }
          if (item.kind === 'tool') {
            return (
              <details className={`tool ${item.status}`} key={`${item.callId}-${index}`}>
                <summary>
                  <span className="tool-name">{item.name}</span>
                  <span className="tool-state">{item.status}</span>
                </summary>
                <pre className="tool-args">{prettyArgs(item.args)}</pre>
                {item.result && <pre className="tool-result">{item.result}</pre>}
              </details>
            )
          }
          return (
            <div className={`notice ${item.level}`} key={`notice-${index}`}>
              {item.text}
              {item.code && <span className="code">{item.code}</span>}
            </div>
          )
        })}
        {running && <div className="thinking">运行时正在处理…</div>}
        <div ref={bottomRef} />
      </main>
      {panel === 'files' && <FilePanel onClose={() => setPanel(null)} />}
      {panel === 'changes' && <ChangesPanel onClose={() => setPanel(null)} />}
      {panel === 'terminal' && <TerminalPanel onClose={() => setPanel(null)} />}
      {panel === 'browser' && <BrowserPanel onClose={() => setPanel(null)} />}
      {panel === 'logs' && <LogsPanel onClose={() => setPanel(null)} />}
      </div>

      <footer className="composer">
        <textarea
          value={input}
          placeholder={state.state === 'ready' ? '输入消息，Enter 发送（Shift+Enter 换行）' : '等待运行时握手…'}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
          disabled={state.state !== 'ready'}
        />
        <button className="primary" onClick={send} disabled={state.state !== 'ready' || running || !sessions.active}>发送</button>
      </footer>

      {stderr.length > 0 && (
        <details className="stderr">
          <summary>runtime stderr · {stderr.length}</summary>
          <pre>{stderr.join('\n')}</pre>
        </details>
      )}
    </div>
  )
}

function prettyArgs(args) {
  if (!args) return ''
  try {
    return JSON.stringify(JSON.parse(args), null, 2)
  } catch {
    return args
  }
}
