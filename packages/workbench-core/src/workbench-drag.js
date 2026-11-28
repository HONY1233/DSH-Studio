/** Pure drag/drop state machine and live-content attachment contract (X2.5–X2.8). */
import { ControlError, ControlErrorCode, cloneJson } from './control.js'
import { assertWorkbenchId, validatePoint } from './workbench-schema.js'

export const DRAG_THRESHOLD_PX = 6
export const DROP_MODES = Object.freeze(['move', 'split-before', 'split-after', 'tab', 'group'])

function invalid(message, details = {}) {
  return new ControlError(ControlErrorCode.INVALID_ARGUMENT, message, details)
}

function conflict(message, details = {}) {
  return new ControlError(ControlErrorCode.CONFLICT, message, details)
}

function validateSource(source) {
  if (!source || typeof source !== 'object') throw invalid('drag.source 必须是对象')
  assertWorkbenchId(source.hostId, 'source.hostId')
  assertWorkbenchId(source.windowId, 'source.windowId')
  if (!source.content || typeof source.content !== 'object') throw invalid('source.content 必须是对象')
  assertWorkbenchId(source.content.instanceId, 'source.content.instanceId')
  if (source.content.kind !== 'conversation' && source.content.kind !== 'panel') {
    throw invalid('source.content.kind 无效')
  }
  if (source.groupId !== undefined) assertWorkbenchId(source.groupId, 'source.groupId')
  return cloneJson(source)
}

function validateTarget(target) {
  if (!target || typeof target !== 'object') throw invalid('drag.target 必须是对象')
  assertWorkbenchId(target.hostId, 'target.hostId')
  if (target.paneId !== undefined) assertWorkbenchId(target.paneId, 'target.paneId')
  if (target.tabId !== undefined) assertWorkbenchId(target.tabId, 'target.tabId')
  if (target.edge !== undefined && !['left', 'right', 'top', 'bottom', 'center'].includes(target.edge)) {
    throw invalid('target.edge 无效')
  }
  return cloneJson(target)
}

export function createContentAttachment(input = {}) {
  if (typeof input.documentKey !== 'string' || !input.documentKey) throw invalid('documentKey 必须是非空字符串')
  if (typeof input.attachToken !== 'string' || !input.attachToken) throw invalid('attachToken 必须是非空字符串')
  const selectionStart = input.selectionStart ?? 0
  const selectionEnd = input.selectionEnd ?? selectionStart
  for (const [name, value] of Object.entries({ selectionStart, selectionEnd })) {
    if (!Number.isSafeInteger(value) || value < 0) throw invalid(`${name} 必须是非负安全整数`)
  }
  if (selectionEnd < selectionStart) throw invalid('selectionEnd 不能小于 selectionStart')
  for (const name of ['scrollTop', 'scrollLeft']) {
    if (!Number.isFinite(input[name] ?? 0)) throw invalid(`${name} 必须是有限数`)
  }
  const value = input.value ?? ''
  if (typeof value !== 'string') throw invalid('attachment.value 必须是字符串')
  return {
    documentKey: input.documentKey,
    attachToken: input.attachToken,
    value,
    selectionStart,
    selectionEnd,
    scrollTop: input.scrollTop ?? 0,
    scrollLeft: input.scrollLeft ?? 0,
    imeComposition: input.imeComposition === true,
  }
}

export function assertContentAttachmentPreserved(before, after) {
  if (!before || !after) throw conflict('正文 attachment 缺失')
  for (const key of ['documentKey', 'attachToken', 'value', 'selectionStart', 'selectionEnd', 'scrollTop', 'scrollLeft', 'imeComposition']) {
    if (before[key] !== after[key]) {
      throw conflict(`正文现场未保持: ${key}`, { field: key })
    }
  }
  return true
}

export function resolveDropIntent(source, target, pointer, mode = 'move') {
  if (!DROP_MODES.includes(mode)) throw invalid(`未知 drop mode: ${mode}`)
  const safeSource = validateSource(source)
  const safeTarget = validateTarget(target)
  const safePointer = validatePoint(pointer)
  if (mode === 'group' && !safeSource.groupId) throw invalid('group drop 要求 source.groupId')
  return {
    source: safeSource,
    target: safeTarget,
    pointer: safePointer,
    mode,
  }
}

export function beginWorkbenchDrag({ source, start, target, mode = 'move', locked = false, attachment } = {}) {
  if (typeof locked !== 'boolean') throw invalid('locked 必须是布尔值')
  if (attachment !== undefined) createContentAttachment(attachment)
  return {
    phase: 'pending',
    source: validateSource(source),
    start: validatePoint(start),
    pointer: validatePoint(start),
    target: validateTarget(target),
    mode,
    locked,
    attachment: attachment === undefined ? null : createContentAttachment(attachment),
    preview: null,
    reason: null,
  }
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function moveWorkbenchDrag(state, pointer, target = state.target) {
  if (['cancelled', 'committed', 'clicked'].includes(state.phase)) return state
  if (state.locked) {
    throw conflict('locked 内容不可拖动')
  }
  const safePointer = validatePoint(pointer)
  const safeTarget = validateTarget(target)
  if (state.phase === 'pending' && distance(state.start, safePointer) <= DRAG_THRESHOLD_PX) {
    return { ...state, pointer: safePointer, target: safeTarget }
  }
  return {
    ...state,
    phase: 'dragging',
    pointer: safePointer,
    target: safeTarget,
    preview: resolveDropIntent(state.source, safeTarget, safePointer, state.mode),
  }
}

export function releaseWorkbenchDrag(state, pointer = state.pointer, target = state.target) {
  if (!['pending', 'dragging'].includes(state.phase)) return state
  const moved = moveWorkbenchDrag(state, pointer, target)
  if (moved.phase === 'pending') return { ...moved, phase: 'clicked', preview: null }
  return {
    ...moved,
    phase: 'committed',
    intent: moved.preview,
    preview: null,
  }
}

export function cancelWorkbenchDrag(state, reason = 'cancelled') {
  if (!['pending', 'dragging'].includes(state.phase)) return state
  if (typeof reason !== 'string' || !reason) throw invalid('cancel reason 必须是非空字符串')
  return { ...state, phase: 'cancelled', preview: null, intent: null, reason }
}

export function keyboardWorkbenchDrag(state, key, target = state.target) {
  if (typeof key !== 'string') throw invalid('key 必须是字符串')
  if (key === 'Escape') return cancelWorkbenchDrag(state, 'escape')
  if (state.phase === 'pending' && (key === 'Enter' || key === ' ')) {
    return {
      ...state,
      phase: 'dragging',
      preview: resolveDropIntent(state.source, state.target, state.pointer, state.mode),
    }
  }
  if (state.phase !== 'dragging') return state
  if (key === 'Enter' || key === ' ') return releaseWorkbenchDrag(state)
  return moveWorkbenchDrag(state, state.pointer, target)
}

export function describeWorkbenchDragPreview(state) {
  if (state.phase !== 'dragging') return null
  if (!state.attachment) throw conflict('dragging 状态必须携带真实正文 attachment')
  return {
    kind: 'live-content',
    attachment: cloneJson(state.attachment),
    drop: cloneJson(state.preview),
  }
}

export function assertDropCommitAllowed(state, { hosts = [], toolInstances = [], leases = [] } = {}) {
  if (state.phase !== 'dragging') throw conflict('只有 dragging 状态可以提交 drop')
  if (state.locked) throw conflict('locked 内容不可移动')
  if (!Array.isArray(hosts) || !hosts.some((host) => host.hostId === state.target.hostId)) {
    throw conflict(`目标 host 不存在或无权访问: ${state.target.hostId}`)
  }
  const instance = toolInstances.find((item) => item.instanceId === state.source.content.instanceId)
  if (instance?.concurrency === 'exclusive') {
    const active = leases.find((lease) => lease.instanceId === instance.instanceId && lease.state === 'active')
    if (active && (active.hostId !== state.target.hostId || active.windowId !== state.source.windowId)) {
      throw conflict('exclusive 工具已有 owner；必须显式选择移动并改归属或创建新实例', {
        instanceId: instance.instanceId,
        owner: active.owner,
      })
    }
  }
  return state.preview
}
