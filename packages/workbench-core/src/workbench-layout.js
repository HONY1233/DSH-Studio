/** Pure, replayable workbench layout operations and history (X2.2/X2.3). */
import { ControlError, ControlErrorCode, cloneJson } from './control.js'
import {
  assertWorkbenchId,
  cloneWorkbenchLayout,
  compactWorkbenchLayout,
  createFloat,
  createPane,
  createSplit,
  createTab,
  createWorkbenchLayout,
  findFloat,
  findPane,
  findSplit,
  listPanes,
  locateTab,
  normalizeSizes,
  validateRect,
  validateWorkbenchLayout,
} from './workbench-schema.js'

function invalid(message, details = {}) {
  return new ControlError(ControlErrorCode.INVALID_ARGUMENT, message, details)
}

function notFound(message) {
  return new ControlError(ControlErrorCode.NOT_FOUND, message)
}

function conflict(message) {
  return new ControlError(ControlErrorCode.CONFLICT, message)
}

function nextRevision(layout) {
  if (!Number.isSafeInteger(layout.revision + 1)) throw invalid('layout.revision 已超出安全整数范围')
  return { ...layout, revision: layout.revision + 1 }
}

function replacePane(layout, paneId, updater) {
  const pane = findPane(layout.root, paneId)
  if (!pane) throw notFound(`pane 不存在: ${paneId}`)
  const nextPane = updater(pane)
  const walk = (node) => {
    if (node.kind === 'pane') return node.id === paneId ? nextPane : node
    return { ...node, children: node.children.map(walk) }
  }
  return { ...layout, root: walk(layout.root) }
}

function replaceFloat(layout, floatId, updater) {
  const float = findFloat(layout, floatId)
  if (!float) throw notFound(`float 不存在: ${floatId}`)
  return {
    ...layout,
    floats: layout.floats.map((item) => item.id === floatId ? updater(item) : item),
  }
}

function activeAfterRemoval(tabs, removedId, currentActive) {
  const rest = tabs.filter((tab) => tab.id !== removedId)
  if (rest.length === 0) return undefined
  if (currentActive !== removedId) return currentActive
  const removedIndex = tabs.findIndex((tab) => tab.id === removedId)
  return rest[Math.min(removedIndex, rest.length - 1)].id
}

function withPaneTabs(pane, tabs, activeTabId) {
  return createPane(pane.id, tabs, activeTabId)
}

function withFloatTabs(float, tabs, activeTabId) {
  return createFloat({
    id: float.id,
    rect: float.rect,
    tabs,
    activeTabId,
    pin: float.pin,
    host: float.host,
    groupId: float.groupId,
    workspaceId: float.workspaceId,
    zIndex: float.zIndex,
    minimized: float.minimized,
  })
}

function assertFreshTabId(layout, tab) {
  if (locateTab(layout, tab.id)) throw conflict(`tab id 已存在: ${tab.id}`)
  const duplicateInstance = listPanes(layout.root)
    .flatMap((pane) => pane.tabs)
    .concat(layout.floats.flatMap((float) => float.tabs))
    .some((item) => item.ref.instanceId === tab.ref.instanceId)
  if (duplicateInstance) throw conflict(`content instance 已存在 live owner: ${tab.ref.instanceId}`)
}

function insertTab(layout, op) {
  const pane = findPane(layout.root, op.paneId)
  if (!pane) throw notFound(`pane 不存在: ${op.paneId}`)
  assertFreshTabId(layout, op.tab)
  const index = Math.max(0, Math.min(op.index ?? pane.tabs.length, pane.tabs.length))
  const tabs = [...pane.tabs]
  tabs.splice(index, 0, cloneJson(op.tab))
  return {
    ...replacePane(layout, pane.id, (current) => withPaneTabs(current, tabs, op.tab.id)),
    focusedId: pane.id,
  }
}

function removeTab(layout, op) {
  const location = locateTab(layout, op.tabId)
  if (!location) throw notFound(`tab 不存在: ${op.tabId}`)
  if (location.host === 'float') {
    const float = findFloat(layout, location.hostId)
    const tabs = float.tabs.filter((tab) => tab.id !== op.tabId)
    const activeTabId = activeAfterRemoval(float.tabs, op.tabId, float.activeTabId)
    let next = replaceFloat(layout, float.id, (current) => withFloatTabs(current, tabs, activeTabId))
    if (tabs.length === 0) {
      next = {
        ...next,
        floats: next.floats.filter((item) => item.id !== float.id),
        minimized: next.minimized.filter((item) => item.floatId !== float.id),
      }
    }
    return next
  }
  const pane = findPane(layout.root, location.hostId)
  const tabs = pane.tabs.filter((tab) => tab.id !== op.tabId)
  const activeTabId = activeAfterRemoval(pane.tabs, op.tabId, pane.activeTabId)
  return replacePane(layout, pane.id, (current) => withPaneTabs(current, tabs, activeTabId))
}

function moveTab(layout, op) {
  const location = locateTab(layout, op.tabId)
  if (!location) throw notFound(`tab 不存在: ${op.tabId}`)
  if (location.host !== 'pane') throw conflict('moveTab 只支持 pane 之间；float 迁移请使用 dockFloat')
  const from = findPane(layout.root, location.hostId)
  const to = findPane(layout.root, op.toPaneId)
  if (!to) throw notFound(`目标 pane 不存在: ${op.toPaneId}`)
  const tab = location.tab
  const fromTabs = from.tabs.filter((item) => item.id !== tab.id)
  const fromActive = activeAfterRemoval(from.tabs, tab.id, from.activeTabId)
  const toTabs = [...to.tabs]
  const index = Math.max(0, Math.min(op.index ?? toTabs.length, toTabs.length))
  toTabs.splice(index, 0, tab)
  let next = replacePane(layout, from.id, (current) => withPaneTabs(current, fromTabs, fromActive))
  next = replacePane(next, to.id, (current) => withPaneTabs(current, toTabs, tab.id))
  return { ...next, focusedId: to.id }
}

function splitPane(layout, op) {
  const pane = findPane(layout.root, op.paneId)
  if (!pane) throw notFound(`pane 不存在: ${op.paneId}`)
  if (findPane(layout.root, op.newPaneId) || findSplit(layout.root, op.newSplitId)) {
    throw conflict(`新 pane/split id 已存在: ${op.newPaneId}/${op.newSplitId}`)
  }
  const ratio = op.ratio ?? 0.5
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) throw invalid('split.ratio 必须在 0..1 之间')
  const fresh = createPane(op.newPaneId)
  const children = op.at === 'before' ? [fresh, pane] : [pane, fresh]
  const sizes = op.at === 'before' ? [ratio, 1 - ratio] : [1 - ratio, ratio]
  const split = createSplit(op.newSplitId, op.axis, children, sizes)
  const replace = (node) => node.id === pane.id ? split : (
    node.kind === 'pane' ? node : { ...node, children: node.children.map(replace) }
  )
  return { ...layout, root: replace(layout.root), focusedId: fresh.id }
}

function removePane(layout, op) {
  const pane = findPane(layout.root, op.paneId)
  if (!pane) throw notFound(`pane 不存在: ${op.paneId}`)
  if (pane.tabs.length > 0) throw conflict('只有空 pane 才能删除')
  const findParent = (node) => {
    if (node.kind === 'pane') return null
    if (node.children.some((child) => child.id === pane.id)) return node
    for (const child of node.children) {
      const found = findParent(child)
      if (found) return found
    }
    return null
  }
  const parent = findParent(layout.root)
  if (!parent) throw conflict('不能删除根 pane；请先 split 或 compact')
  const index = parent.children.findIndex((child) => child.id === pane.id)
  const children = parent.children.filter((child) => child.id !== pane.id)
  const sizes = parent.sizes.filter((_, sizeIndex) => sizeIndex !== index)
  const replacement = children.length === 1
    ? children[0]
    : createSplit(parent.id, parent.axis, children, sizes)
  const replace = (node) => node.id === parent.id ? replacement : (
    node.kind === 'pane' ? node : { ...node, children: node.children.map(replace) }
  )
  return { ...layout, root: replace(layout.root) }
}

function resizeSplit(layout, op) {
  const split = findSplit(layout.root, op.splitId)
  if (!split) throw notFound(`split 不存在: ${op.splitId}`)
  if (!Array.isArray(op.sizes) || op.sizes.length !== split.children.length) {
    throw invalid('resize.sizes 长度必须等于 split.children')
  }
  const replace = (node) => node.id === split.id
    ? { ...node, sizes: normalizeSizes(op.sizes) }
    : (node.kind === 'pane' ? node : { ...node, children: node.children.map(replace) })
  return { ...layout, root: replace(layout.root) }
}

function floatTabs(layout, op) {
  if (!Array.isArray(op.tabIds) || op.tabIds.length === 0) throw invalid('floatTabs.tabIds 不能为空')
  if (findFloat(layout, op.floatId)) throw conflict(`float id 已存在: ${op.floatId}`)
  const locations = op.tabIds.map((tabId) => locateTab(layout, tabId))
  if (locations.some((location) => !location)) throw notFound('floatTabs 包含不存在的 tab')
  const paneIds = new Set(locations.map((location) => location.host === 'pane' ? location.hostId : location.hostId))
  if (paneIds.size !== 1 || locations[0].host !== 'pane') throw conflict('floatTabs 当前要求 tab 来自同一个 pane')
  const sourcePane = findPane(layout.root, locations[0].hostId)
  const tabs = op.tabIds.map((tabId) => sourcePane.tabs.find((tab) => tab.id === tabId))
  const remaining = sourcePane.tabs.filter((tab) => !op.tabIds.includes(tab.id))
  const activeTabId = activeAfterRemoval(sourcePane.tabs, sourcePane.activeTabId, sourcePane.activeTabId)
  let next = replacePane(layout, sourcePane.id, (current) => withPaneTabs(current, remaining, activeTabId))
  const float = createFloat({
    id: op.floatId,
    rect: op.rect,
    tabs,
    activeTabId: tabs[0].id,
    pin: op.pin,
    host: op.host,
    groupId: op.groupId,
    workspaceId: op.workspaceId,
    zIndex: op.zIndex,
  })
  next = { ...next, floats: [...next.floats, float], focusedId: float.id }
  return next
}

function dockFloat(layout, op) {
  const float = findFloat(layout, op.floatId)
  if (!float) throw notFound(`float 不存在: ${op.floatId}`)
  const pane = findPane(layout.root, op.paneId)
  if (!pane) throw notFound(`目标 pane 不存在: ${op.paneId}`)
  const moving = op.tabIds?.length ? float.tabs.filter((tab) => op.tabIds.includes(tab.id)) : float.tabs
  if (moving.length === 0) throw invalid('dockFloat 没有可移动的 tab')
  const tabs = [...pane.tabs]
  const index = Math.max(0, Math.min(op.index ?? tabs.length, tabs.length))
  tabs.splice(index, 0, ...moving)
  let next = replacePane(layout, pane.id, (current) => withPaneTabs(current, tabs, moving[0].id))
  const remaining = float.tabs.filter((tab) => !moving.includes(tab))
  if (remaining.length === 0) {
    next = {
      ...next,
      floats: next.floats.filter((item) => item.id !== float.id),
      minimized: next.minimized.filter((item) => item.floatId !== float.id),
    }
  } else {
    const remainingActive = remaining.some((tab) => tab.id === float.activeTabId)
      ? float.activeTabId
      : remaining[0].id
    next = replaceFloat(next, float.id, (current) => withFloatTabs(
      current,
      remaining,
      remainingActive,
    ))
  }
  return { ...next, focusedId: pane.id }
}

function minimizeFloat(layout, op) {
  const float = findFloat(layout, op.floatId)
  if (!float) throw notFound(`float 不存在: ${op.floatId}`)
  if (float.minimized) return layout
  let next = replaceFloat(layout, float.id, (current) => ({ ...current, minimized: true }))
  next = {
    ...next,
    minimized: [...next.minimized.filter((item) => item.floatId !== float.id), {
      floatId: float.id,
      x: op.x,
      y: op.y,
      host: float.host,
      ...(float.groupId === undefined ? {} : { groupId: float.groupId }),
    }],
  }
  return next
}

function restoreFloat(layout, op) {
  const float = findFloat(layout, op.floatId)
  if (!float) throw notFound(`float 不存在: ${op.floatId}`)
  if (!float.minimized) return layout
  let next = replaceFloat(layout, float.id, (current) => ({ ...current, minimized: false }))
  next = { ...next, minimized: next.minimized.filter((item) => item.floatId !== float.id) }
  return { ...next, focusedId: float.id }
}

function groupFloats(layout, op) {
  if (!Array.isArray(op.floatIds) || op.floatIds.length < 2) throw invalid('groupFloats 至少需要两个 float')
  assertWorkbenchId(op.groupId, 'groupId')
  for (const floatId of op.floatIds) {
    if (!findFloat(layout, floatId)) throw notFound(`float 不存在: ${floatId}`)
  }
  return {
    ...layout,
    floats: layout.floats.map((float) => op.floatIds.includes(float.id) ? { ...float, groupId: op.groupId } : float),
    minimized: layout.minimized.map((item) => op.floatIds.includes(item.floatId) ? { ...item, groupId: op.groupId } : item),
  }
}

function applyUnchecked(layout, op) {
  if (!op || typeof op !== 'object') throw invalid('layout op 必须是对象')
  switch (op.kind) {
    case 'insertTab': return insertTab(layout, op)
    case 'removeTab': return removeTab(layout, op)
    case 'moveTab': return moveTab(layout, op)
    case 'activateTab': {
      const location = locateTab(layout, op.tabId)
      if (!location || location.host !== 'pane') throw notFound(`pane tab 不存在: ${op.tabId}`)
      return {
        ...replacePane(layout, location.hostId, (pane) => ({ ...pane, activeTabId: op.tabId })),
        focusedId: location.hostId,
      }
    }
    case 'splitPane': return splitPane(layout, op)
    case 'removePane': return removePane(layout, op)
    case 'resizeSplit': return resizeSplit(layout, op)
    case 'floatTabs': return floatTabs(layout, op)
    case 'dockFloat': return dockFloat(layout, op)
    case 'moveFloat': {
      if (!findFloat(layout, op.floatId)) throw notFound(`float 不存在: ${op.floatId}`)
      return replaceFloat(layout, op.floatId, (float) => ({ ...float, rect: validateRect(op.rect) }))
    }
    case 'setFloatPin': {
      if (!findFloat(layout, op.floatId)) throw notFound(`float 不存在: ${op.floatId}`)
      return replaceFloat(layout, op.floatId, (float) => ({ ...float, pin: op.pin }))
    }
    case 'minimizeFloat': return minimizeFloat(layout, op)
    case 'restoreFloat': return restoreFloat(layout, op)
    case 'groupFloats': return groupFloats(layout, op)
    case 'ungroupFloat': {
      if (!findFloat(layout, op.floatId)) throw notFound(`float 不存在: ${op.floatId}`)
      let next = replaceFloat(layout, op.floatId, (float) => {
        const { groupId: _groupId, ...rest } = float
        return rest
      })
      next = {
        ...next,
        minimized: next.minimized.map((item) => {
          if (item.floatId !== op.floatId) return item
          const { groupId: _groupId, ...rest } = item
          return rest
        }),
      }
      return next
    }
    case 'focus': {
      if (op.id !== undefined && !findPane(layout.root, op.id) && !findFloat(layout, op.id) && !findSplit(layout.root, op.id)) {
        throw notFound(`focus 目标不存在: ${op.id}`)
      }
      if (op.id === undefined) {
        const { focusedId: _focusedId, ...rest } = layout
        return rest
      }
      return { ...layout, focusedId: op.id }
    }
    case 'replaceLayout': return cloneWorkbenchLayout(op.layout)
    case 'compact': return compactWorkbenchLayout(layout, op.seedPaneId)
    default: throw invalid(`未知 layout op: ${op.kind}`)
  }
}

/** Apply one data-only operation. The inverse is an exact pre-op snapshot. */
export function applyLayoutOp(layout, op) {
  validateWorkbenchLayout(layout)
  const before = cloneWorkbenchLayout(layout)
  const changed = applyUnchecked(before, op)
  const next = nextRevision(changed)
  validateWorkbenchLayout(next)
  return { next, inverse: { kind: 'replaceLayout', layout: before } }
}

export function createLayoutHistory(initialLayout, { limit = 100 } = {}) {
  validateWorkbenchLayout(initialLayout)
  if (!Number.isSafeInteger(limit) || limit < 1) throw invalid('history.limit 必须是正整数')
  return {
    past: [],
    present: cloneWorkbenchLayout(initialLayout),
    future: [],
    limit,
  }
}

function restoreHistoryLayout(history, layout) {
  const restored = cloneWorkbenchLayout(layout)
  restored.revision = history.present.revision + 1
  validateWorkbenchLayout(restored)
  return restored
}

export function commitLayoutOp(history, op) {
  const result = applyLayoutOp(history.present, op)
  const past = [...history.past, cloneWorkbenchLayout(history.present)].slice(-history.limit)
  return { ...history, past, present: result.next, future: [] }
}

export function commitLayoutTransform(history, transform) {
  if (typeof transform !== 'function') throw invalid('transform 必须是函数')
  const transformed = transform(cloneWorkbenchLayout(history.present))
  const result = applyLayoutOp(history.present, { kind: 'replaceLayout', layout: transformed })
  const past = [...history.past, cloneWorkbenchLayout(history.present)].slice(-history.limit)
  return { ...history, past, present: result.next, future: [] }
}

export function undoLayout(history) {
  if (history.past.length === 0) return history
  const previous = history.past[history.past.length - 1]
  const present = restoreHistoryLayout(history, previous)
  return {
    ...history,
    past: history.past.slice(0, -1),
    present,
    future: [cloneWorkbenchLayout(history.present), ...history.future].slice(0, history.limit),
  }
}

export function redoLayout(history) {
  if (history.future.length === 0) return history
  const next = history.future[0]
  const present = restoreHistoryLayout(history, next)
  return {
    ...history,
    past: [...history.past, cloneWorkbenchLayout(history.present)].slice(-history.limit),
    present,
    future: history.future.slice(1),
  }
}

export function createLayoutTemplate(name, ids = {}) {
  const paneId = ids.paneId ?? 'pane-main'
  if (name === 'single') {
    return createWorkbenchLayout(createPane(paneId))
  }
  if (name === 'split-row' || name === 'split-column') {
    return createWorkbenchLayout(createSplit(
      ids.splitId ?? 'split-main',
      name === 'split-row' ? 'row' : 'column',
      [createPane(paneId), createPane(ids.secondPaneId ?? 'pane-second')],
      [0.5, 0.5],
    ))
  }
  if (name === 'grid') {
    return createWorkbenchLayout(createSplit(
      ids.splitId ?? 'split-grid',
      'column',
      [
        createSplit(ids.rowSplitId ?? 'split-row', 'row', [
          createPane(paneId),
          createPane(ids.secondPaneId ?? 'pane-second'),
        ], [0.5, 0.5]),
        createSplit(ids.bottomSplitId ?? 'split-bottom', 'row', [
          createPane(ids.thirdPaneId ?? 'pane-third'),
          createPane(ids.fourthPaneId ?? 'pane-fourth'),
        ], [0.5, 0.5]),
      ],
      [0.5, 0.5],
    ))
  }
  throw invalid(`未知布局模板: ${name}`)
}

export function makeWorkbenchTab(input) {
  return createTab(input)
}

/** Project floats for a workspace switch or the application-wide layer. */
export function selectPinnedFloats(layout, { workspaceId, scope = 'workspace' } = {}) {
  validateWorkbenchLayout(layout)
  if (scope !== 'workspace' && scope !== 'application') throw invalid('scope 必须是 workspace 或 application')
  if (scope === 'workspace') assertWorkbenchId(workspaceId, 'workspaceId')
  const keep = (float) => {
    if (scope === 'application') return ['application', 'window', 'topmost'].includes(float.pin)
    if (float.pin === 'none') return true
    if (float.pin === 'workspace') return float.workspaceId === workspaceId
    return false
  }
  const floats = layout.floats.filter(keep)
  const floatIds = new Set(floats.map((float) => float.id))
  return {
    ...cloneJson(layout),
    floats,
    minimized: layout.minimized.filter((item) => floatIds.has(item.floatId)),
  }
}
