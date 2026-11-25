import React, { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

const THEME = {
  background: '#12151b',
  foreground: '#dfe4ec',
  cursor: '#4f8cff',
  selectionBackground: '#27406b',
  black: '#12151b',
  red: '#ff5c5c',
  green: '#3ddc97',
  yellow: '#ffb020',
  blue: '#4f8cff',
  magenta: '#b98cff',
  cyan: '#4fd1c5',
  white: '#dfe4ec',
}

/** 右侧终端面板：xterm 接主进程 PTY（WSL 登录 shell）。 */
export default function TerminalPanel({ onClose }) {
  const hostRef = useRef(null)
  const termRef = useRef(null)
  const [info, setInfo] = useState(null)
  const [error, setError] = useState(null)
  const [exit, setExit] = useState(null)

  useEffect(() => {
    const term = new Terminal({
      fontFamily: '"Cascadia Code", Consolas, monospace',
      fontSize: 12.5,
      lineHeight: 1.25,
      cursorBlink: true,
      scrollback: 4000,
      theme: THEME,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current)
    termRef.current = term
    if (import.meta.env.DEV) window.__term = term // CDP 冒烟读到缓冲区用（窗口被系统隐藏时不会绘制）

    let resized = { cols: 0, rows: 0 }
    const syncSize = () => {
      try {
        fit.fit()
      } catch {
        return
      }
      if (term.cols === resized.cols && term.rows === resized.rows) return
      resized = { cols: term.cols, rows: term.rows }
      window.dsh.terminalResize(term.cols, term.rows).catch(() => {})
    }

    const offData = window.dsh.onTerminalData((data) => term.write(data))
    const offExit = window.dsh.onTerminalExit((payload) => {
      setExit(payload.exitCode)
      term.write(`\r\n\x1b[2m[process exited: ${payload.exitCode}]\x1b[0m\r\n`)
    })
    const onInput = term.onData((data) => window.dsh.terminalWrite(data))

    window.dsh
      .terminalStart()
      .then((value) => {
        setInfo(value)
        if (value.scrollback) term.write(value.scrollback)
        syncSize()
        term.focus()
      })
      .catch((startError) => setError(startError.message))

    const observer = new ResizeObserver(() => syncSize())
    observer.observe(hostRef.current)
    const focusTimer = setTimeout(() => term.focus(), 120)

    return () => {
      clearTimeout(focusTimer)
      observer.disconnect()
      onInput.dispose()
      offData()
      offExit()
      term.dispose()
      termRef.current = null
    }
  }, [])

  function restart() {
    setExit(null)
    setError(null)
    window.dsh.terminalKill().catch(() => {})
    window.dsh.terminalStart().then((value) => {
      setInfo(value)
      termRef.current?.reset()
      if (value.scrollback) termRef.current?.write(value.scrollback)
      termRef.current?.focus()
    }).catch((startError) => setError(startError.message))
  }

  return (
    <aside className="panel terminal">
      <div className="panel-head">
        <strong>终端 · {info ? `${info.distro}/${info.user}` : '…'}</strong>
        <span className="panel-actions">
          <button onClick={restart}>重启</button>
          <button onClick={onClose}>关闭</button>
        </span>
      </div>
      {error && <div className="panel-error">{error}</div>}
      {exit !== null && <div className="panel-note">进程已退出（{exit}），点「重启」再开一个 shell</div>}
      <div className="terminal-host" ref={hostRef} />
    </aside>
  )
}
