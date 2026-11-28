import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  createEmptyController,
  createPersistentWorkbenchController,
  createWorkbenchLabels,
  makeTab,
  storageKey,
  WorkbenchView,
} from '@studio/ui-shell/workbench'

import App from '../App.jsx'

const LAYOUT_STORAGE_KEY = storageKey({
  hostId: 'native',
  workspaceId: 'main',
  sessionId: 'workbench',
})

function hasTabs(node) {
  if (node.kind === 'pane') return node.tabs.length > 0
  return node.children.some(hasTabs)
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 新工作台的 native renderer 组合层。
 *
 * X3 只负责把现有 UI 壳挂进产品入口；会话文档、审批和工具面板仍在 X4
 * 拆分。当前唯一标签承载旧 App，保证新旧入口共享同一份 window.dsh 状态，
 * 不创建第二个 RuntimeClient，也不做双写。布局在每次提交前原子保存。
 */
export default function WorkbenchApp() {
  const labels = useMemo(() => createWorkbenchLabels('zh'), [])
  const [saveError, setSaveError] = useState(null)
  const [session] = useState(() => {
    try {
      return createPersistentWorkbenchController({
        storage: window.localStorage,
        key: LAYOUT_STORAGE_KEY,
        onPersistenceError: setSaveError,
        onPersistenceSaved: () => setSaveError(null),
      })
    } catch (error) {
      return {
        controller: createEmptyController(),
        persistence: null,
        report: { recovered: false, corruption: errorMessage(error), migrations: [] },
        initialError: error,
      }
    }
  })
  const controller = session.controller
  const storageError = saveError ?? session.initialError
  const [nativeWindows, setNativeWindows] = useState([])
  const [nativeWindowId, setNativeWindowId] = useState(null)
  const [nativePreviewId, setNativePreviewId] = useState(null)
  const [nativeWindowError, setNativeWindowError] = useState(null)
  const nativeHostRef = useRef(null)

  useEffect(() => {
    const api = window.dshWorkbench
    if (!api) return undefined
    let active = true
    const unsubscribe = api.onNativeWindowsChanged((payload) => {
      if (!active) return
      setNativeWindows(payload.windows ?? [])
      setNativeWindowError(payload.error ?? null)
    })
    api.listNativeWindows().then((windows) => {
      if (active) setNativeWindows(windows)
    }).catch((error) => {
      if (active) setNativeWindowError(errorMessage(error))
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (nativeWindows.some((item) => item.id === nativeWindowId)) return
    setNativeWindowId(nativeWindows[0]?.id ?? null)
  }, [nativeWindowId, nativeWindows])

  useEffect(() => {
    if (nativePreviewId && !nativeWindows.some((item) => item.id === nativePreviewId)) setNativePreviewId(null)
  }, [nativePreviewId, nativeWindows])

  useLayoutEffect(() => {
    const host = nativeHostRef.current
    const api = window.dshWorkbench
    if (!host || !api || !nativePreviewId) return undefined
    let frame = 0
    const sync = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const box = host.getBoundingClientRect()
        if (box.width <= 0 || box.height <= 0) return
        api.setNativeWindowBounds(nativePreviewId, {
          x: box.left,
          y: box.top,
          width: box.width,
          height: box.height,
        }).catch((error) => setNativeWindowError(errorMessage(error)))
      })
    }
    api.attachNativeWindow(nativePreviewId, { kind: 'main' }, {
      x: host.getBoundingClientRect().left,
      y: host.getBoundingClientRect().top,
      width: host.clientWidth,
      height: host.clientHeight,
    }).catch((error) => setNativeWindowError(errorMessage(error)))
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(sync) : null
    observer?.observe(host)
    window.addEventListener('resize', sync)
    sync()
    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', sync)
      api.detachNativeWindow(nativePreviewId).catch((error) => setNativeWindowError(errorMessage(error)))
    }
  }, [nativePreviewId])

  const nativeAction = (name, ...args) => {
    const api = window.dshWorkbench
    if (!api) return
    Promise.resolve(api[name](...args)).catch((error) => setNativeWindowError(errorMessage(error)))
  }

  useEffect(() => {
    const state = controller.getState()
    if (hasTabs(state.root) || state.floats.some((float) => float.tabs.length > 0)) return
    const pane = controller.focusedPane()
    if (!pane) return
    controller.dispatch({
      kind: 'insertTab',
      pane,
      tab: makeTab(
        controller.mint.tab(),
        { kind: 'panel', contentId: 'legacy-session', instanceId: 'legacy-session' },
        'DSH Studio',
      ),
    })
  }, [controller])

  const topbar = useMemo(
    () => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: 'var(--muted)' }}>
        <strong style={{ color: 'var(--text)' }}>DSH Studio · Workbench</strong>
        <span>新入口已显式启用</span>
        {session.report.recovered ? (
          <span role="status">布局已从备份恢复</span>
        ) : null}
        {storageError ? (
          <span role="alert" style={{ color: 'var(--error, #c53030)' }}>
            布局未保存：{errorMessage(storageError)}
          </span>
        ) : null}
        <a href="./index.html" style={{ marginLeft: 'auto', color: 'inherit' }}>
          返回旧版
        </a>
      </div>
    ),
    [session.report.recovered, storageError],
  )

  const nativeError = storageError ?? nativeWindowError

  return (
    <div data-renderer-entry="workbench" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, position: 'relative' }}>
      {window.dshWorkbench ? (
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: '6px 10px', borderBottom: '1px solid var(--border, #303745)', fontSize: 12 }}>
          <strong>原生窗口</strong>
          <button type="button" onClick={() => nativeAction('createNativeWindow', { title: 'DSH Native Content' })}>
            新建
          </button>
          <select aria-label="选择原生窗口" value={nativeWindowId ?? ''} onChange={(event) => setNativeWindowId(event.target.value)}>
            {nativeWindows.length === 0 ? <option value="">无窗口</option> : null}
            {nativeWindows.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
          <button type="button" disabled={!nativeWindowId} onClick={() => nativeAction('focusNativeWindow', nativeWindowId)}>聚焦</button>
          <button type="button" disabled={!nativeWindowId} onClick={() => nativeAction('minimizeNativeWindow', nativeWindowId)}>最小化</button>
          <button type="button" disabled={!nativeWindowId} onClick={() => nativeAction('maximizeNativeWindow', nativeWindowId)}>最大化</button>
          <button
            type="button"
            disabled={!nativeWindowId}
            onClick={() => {
              if (nativePreviewId === nativeWindowId) setNativePreviewId(null)
              else setNativePreviewId(nativeWindowId)
            }}
          >
            {nativePreviewId === nativeWindowId ? '分离预览' : '附着预览'}
          </button>
          <button type="button" disabled={!nativeWindowId} onClick={() => nativeAction('closeNativeWindow', nativeWindowId)}>关闭</button>
          {nativeError ? <span role="alert" style={{ color: 'var(--error, #c53030)' }}>{errorMessage(nativeError)}</span> : null}
        </div>
      ) : null}
      <div style={{ flex: '1 1 auto', minHeight: 0 }}>
        <WorkbenchView
          controller={controller}
          labels={labels}
          topbar={topbar}
          resolveTitle={(tab) => tab.title ?? tab.ref.contentId}
          renderContent={() => (
            <div data-testid="native-workbench-legacy" style={{ height: '100%', minHeight: 0 }}>
              <App />
            </div>
          )}
        />
        {nativePreviewId ? (
          <div
            ref={nativeHostRef}
            data-native-window-preview={nativePreviewId}
            style={{ position: 'absolute', right: 24, bottom: 24, width: 'min(480px, 60vw)', height: 320, zIndex: 40, border: '1px solid #4b5d78', borderRadius: 10, background: '#0f1115', overflow: 'hidden' }}
          >
            <span style={{ position: 'absolute', left: 8, bottom: 4, zIndex: -1, color: '#8fb7ff', fontSize: 11 }}>Native WebContentsView preview</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
