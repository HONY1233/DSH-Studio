import React, { useEffect, useRef, useState } from 'react'

/**
 * 右侧浏览器面板：页面本体是主进程的 WebContentsView，渲染层只留一个占位区域，
 * 把占位区域的矩形同步过去，让原生视图正好覆盖在上面。
 */
export default function BrowserPanel({ onClose }) {
  const hostRef = useRef(null)
  const [state, setState] = useState(null)
  const [address, setAddress] = useState('')
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true

    const rectOf = () => {
      const box = hostRef.current?.getBoundingClientRect()
      if (!box || box.width < 2 || box.height < 2) return null
      return { x: box.left, y: box.top, width: box.width, height: box.height }
    }

    const sync = (first) => {
      const rect = rectOf()
      if (!rect) return
      const action = first ? window.dsh.browserShow(rect) : window.dsh.browserBounds(rect)
      action.then((next) => {
        if (alive) setState(next)
      }).catch((syncError) => {
        if (alive) setError(syncError.message)
      })
    }

    const offState = window.dsh.onBrowserState((payload) => {
      if (alive) setState(payload)
    })

    // 不能等 rAF / ResizeObserver：窗口被系统隐藏时两者都会暂停，直接按当前布局量一次
    sync(true)
    const observer = new ResizeObserver(() => sync(false))
    observer.observe(hostRef.current)

    return () => {
      alive = false
      observer.disconnect()
      offState()
      window.dsh.browserHide().catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (state?.url && !address) setAddress(state.url)
  }, [state?.url])

  async function go(event) {
    event?.preventDefault()
    setError(null)
    try {
      setState(await window.dsh.browserNavigate(address))
    } catch (navigateError) {
      setError(navigateError.message)
    }
  }

  return (
    <aside className="panel browser">
      <div className="panel-head">
        <strong>浏览器{state?.title ? ` · ${state.title}` : ''}</strong>
        <span className="panel-actions">
          <button onClick={onClose}>关闭</button>
        </span>
      </div>
      <form className="browser-bar" onSubmit={go}>
        <button type="button" onClick={() => window.dsh.browserBack().then(setState)} disabled={!state?.canGoBack} title="后退">←</button>
        <button type="button" onClick={() => window.dsh.browserForward().then(setState)} disabled={!state?.canGoForward} title="前进">→</button>
        <button type="button" onClick={() => window.dsh.browserReload().then(setState)} title="刷新">⟳</button>
        <input
          className="mono"
          value={address}
          placeholder="输入网址后回车"
          onChange={(event) => setAddress(event.target.value)}
          spellCheck={false}
        />
        <button type="submit">打开</button>
      </form>
      {error && <div className="panel-error">{error}</div>}
      {state?.loading && <div className="browser-loading">加载中…</div>}
      <div className="browser-host" ref={hostRef} />
    </aside>
  )
}
