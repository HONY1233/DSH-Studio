import React, { useEffect, useState } from 'react'

const STATUS_LABEL = {
  M: 'modified',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  U: 'conflict',
  '?': 'untracked',
  '!': 'ignored',
}

/** Right-hand source-control panel: changed paths plus their unified diff. */
export default function ChangesPanel({ onClose }) {
  const [changes, setChanges] = useState(null)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)
  const [diff, setDiff] = useState(null)

  async function refresh() {
    setError(null)
    try {
      setChanges(await window.dsh.gitChanges())
    } catch (listError) {
      setError(listError.message)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  async function open(change) {
    setSelected(change)
    setDiff(null)
    if (change.path.endsWith('/')) {
      setDiff({ untracked: true, text: '（未跟踪目录。切到「文件」面板逐层展开。）' })
      return
    }
    try {
      if (change.index === '?' || change.worktree === '?') {
        const file = await window.dsh.readFile(change.path)
        setDiff({ untracked: true, text: file.binary ? '（二进制文件）' : file.text })
        return
      }
      const staged = change.index !== ' ' && change.index !== '?'
      const text = await window.dsh.gitDiff(change.path, staged)
      setDiff({ untracked: false, text: text || '（无 diff，可能是仅路径变更）' })
    } catch (diffError) {
      setDiff({ untracked: false, text: `读取失败：${diffError.message}` })
    }
  }

  return (
    <aside className="panel">
      <div className="panel-head">
        <strong>变更 · {changes?.length ?? '…'}</strong>
        <span className="panel-actions">
          <button onClick={refresh}>刷新</button>
          <button onClick={onClose}>关闭</button>
        </span>
      </div>
      {error && <div className="panel-error">{error}</div>}
      <div className="change-list">
        {changes?.map((change) => (
          <button
            key={change.path}
            className={`change-row ${selected?.path === change.path ? 'active' : ''}`}
            onClick={() => open(change)}
            title={change.from ? `${change.from} → ${change.path}` : change.path}
          >
            <span className={`change-code ${statusClass(change)}`}>
              {(change.index !== ' ' ? change.index : change.worktree) || '?'}
            </span>
            <span className="change-path">{change.path}</span>
          </button>
        ))}
        {changes && changes.length === 0 && <div className="panel-note">工作区干净</div>}
      </div>
      <div className="preview">
        <div className="preview-head">
          <span className="mono">{selected?.path ?? '选择左侧文件'}</span>
          <span className="muted">{diff?.untracked ? STATUS_LABEL['?'] : selected ? 'diff' : ''}</span>
        </div>
        {diff && <pre className="mono diff">{diff.text}</pre>}
      </div>
    </aside>
  )
}

function statusClass(change) {
  const code = change.index !== ' ' ? change.index : change.worktree
  if (code === '?') return 'untracked'
  if (code === 'D') return 'deleted'
  if (code === 'A') return 'added'
  return 'modified'
}
