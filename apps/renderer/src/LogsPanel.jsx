import React, { useEffect, useMemo, useRef, useState } from 'react'

const LEVELS = [
  { id: 'all', label: '全部' },
  { id: 'warn', label: '警告+' },
  { id: 'error', label: '仅错误' },
]

const SOURCE_LABEL = {
  send: 'out',
  recv: 'in',
  stderr: 'err',
  state: 'state',
}

/** 右侧日志面板：runtime 的 wire 帧、stderr、状态变化，可过滤/暂停/清空。 */
export default function LogsPanel({ onClose }) {
  const [entries, setEntries] = useState([])
  const [pending, setPending] = useState(0)
  const [level, setLevel] = useState('all')
  const [filter, setFilter] = useState('')
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(false)
  const listRef = useRef(null)

  pausedRef.current = paused

  useEffect(() => {
    let alive = true
    window.dsh.logsTail().then((rows) => {
      if (alive) setEntries(rows)
    })
    const off = window.dsh.onLogAppend((entry) => {
      if (pausedRef.current) {
        setPending((value) => value + 1)
        return
      }
      setEntries((prev) => {
        const next = [...prev, entry]
        return next.length > 800 ? next.slice(-800) : next
      })
    })
    return () => {
      alive = false
      off()
    }
  }, [])

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return entries.filter((entry) => {
      if (level === 'warn' && entry.level === 'info') return false
      if (level === 'error' && entry.level !== 'error') return false
      if (!needle) return true
      return entry.text.toLowerCase().includes(needle) || entry.source.includes(needle)
    })
  }, [entries, level, filter])

  useEffect(() => {
    if (paused) return
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [visible, paused])

  function resume() {
    setPaused(false)
    setPending(0)
    window.dsh.logsTail().then((rows) => setEntries(rows))
  }

  async function clear() {
    await window.dsh.logsClear()
    setEntries([])
    setPending(0)
  }

  return (
    <aside className="panel logs">
      <div className="panel-head">
        <strong>日志 · {visible.length}</strong>
        <span className="panel-actions">
          <button onClick={() => (paused ? resume() : setPaused(true))}>
            {paused ? `继续${pending ? ` (${pending})` : ''}` : '暂停'}
          </button>
          <button onClick={clear}>清空</button>
          <button onClick={onClose}>关闭</button>
        </span>
      </div>
      <div className="log-bar">
        {LEVELS.map((item) => (
          <button
            key={item.id}
            className={`log-level ${level === item.id ? 'on' : ''}`}
            onClick={() => setLevel(item.id)}
          >
            {item.label}
          </button>
        ))}
        <input
          className="mono"
          value={filter}
          placeholder="过滤：方法名 / session id / 文本"
          onChange={(event) => setFilter(event.target.value)}
          spellCheck={false}
        />
      </div>
      <div className="log-list" ref={listRef}>
        {visible.map((entry) => (
          <div className={`log-row ${entry.level}`} key={entry.id}>
            <span className="log-time mono">{formatTime(entry.ts)}</span>
            <span className="log-source mono">{SOURCE_LABEL[entry.source] ?? entry.source}</span>
            <span className="log-text mono" title={entry.text}>{entry.text}</span>
          </div>
        ))}
        {visible.length === 0 && <div className="panel-note">没有匹配的日志</div>}
      </div>
    </aside>
  )
}

function formatTime(ts) {
  const date = new Date(ts)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
}
