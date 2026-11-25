import React, { useEffect, useState } from 'react'

/** Right-hand workspace browser: lazy directory tree plus a read-only preview. */
export default function FilePanel({ onClose }) {
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState(null)

  async function openFile(path) {
    setError(null)
    try {
      setPreview(await window.dsh.readFile(path))
    } catch (readError) {
      setError(readError.message)
    }
  }

  return (
    <aside className="panel">
      <div className="panel-head">
        <strong>工作区文件</strong>
        <button onClick={onClose}>关闭</button>
      </div>
      <div className="tree">
        <Directory path="" name="(root)" depth={0} onOpenFile={openFile} />
      </div>
      {error && <div className="panel-error">{error}</div>}
      {preview && (
        <div className="preview">
          <div className="preview-head">
            <span className="mono">{preview.path}</span>
            <span className="muted">{formatSize(preview.size)}</span>
          </div>
          {preview.binary
            ? <div className="preview-note">二进制文件，不预览</div>
            : preview.tooLarge
              ? <div className="preview-note">文件过大，不预览</div>
              : <pre className="mono">{preview.text}</pre>}
        </div>
      )}
    </aside>
  )
}

function Directory({ path, name, depth, onOpenFile }) {
  const [open, setOpen] = useState(depth === 0)
  const [entries, setEntries] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open || entries) return
    window.dsh.listDir(path)
      .then(setEntries)
      .catch((listError) => setError(listError.message))
  }, [open, entries, path])

  return (
    <div className="node">
      <button className="node-row" onClick={() => setOpen(!open)}>
        <span className="caret">{open ? '▾' : '▸'}</span>
        <span className="node-name">{name}</span>
      </button>
      {open && error && <div className="panel-error">{error}</div>}
      {open && entries?.map((entry) => (
        entry.type === 'dir'
          ? <Directory key={entry.path} path={entry.path} name={entry.name} depth={depth + 1} onOpenFile={onOpenFile} />
          : (
            <button className="node-row file" key={entry.path} onClick={() => onOpenFile(entry.path)}>
              <span className="caret" />
              <span className="node-name">{entry.name}</span>
              <span className="node-size">{formatSize(entry.size)}</span>
            </button>
          )
      ))}
      {open && entries && entries.length === 0 && <div className="panel-note">（空目录）</div>}
    </div>
  )
}

function formatSize(size) {
  if (!size) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}
