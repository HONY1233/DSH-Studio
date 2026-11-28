/** Pure DSH-native workbench schema and invariants (X2.1). */
import {
  ControlError,
  ControlErrorCode,
  cloneJson,
  isPlainRecord,
} from './control.js'

export const WORKBENCH_SCHEMA_VERSION = 1
export const PIN_LEVELS = Object.freeze(['none', 'workspace', 'application', 'window', 'topmost'])
export const CONTENT_KINDS = Object.freeze(['conversation', 'panel'])
export const WINDOW_HOSTS = Object.freeze(['internal', 'native'])
export const MIN_SPLIT_RATIO = 0.05

function invalid(message, details = {}) {
  return new ControlError(ControlErrorCode.INVALID_ARGUMENT, message, details)
}

function corrupt(message, details = {}) {
  return new ControlError(ControlErrorCode.CORRUPT_RECORD, message, details)
}

export function assertWorkbenchId(value, name = 'id') {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw invalid(`${name} 必须是非空且不含控制字符的字符串`)
  }
  return value
}

export function assertFiniteNumber(value, name, { min = -Infinity, max = Infinity } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw invalid(`${name} 必须是 ${min}..${max} 范围内的有限数`)
  }
  return value
}

export function validateRect(rect, { maxEdge = 1_000_000 } = {}) {
  if (!isPlainRecord(rect)) throw invalid('rect 必须是对象')
  const x = assertFiniteNumber(rect.x, 'rect.x', { min: -maxEdge, max: maxEdge })
  const y = assertFiniteNumber(rect.y, 'rect.y', { min: -maxEdge, max: maxEdge })
  const w = assertFiniteNumber(rect.w, 'rect.w', { min: 1, max: maxEdge })
  const h = assertFiniteNumber(rect.h, 'rect.h', { min: 1, max: maxEdge })
  return { x, y, w, h }
}

export function validatePoint(point) {
  if (!isPlainRecord(point)) throw invalid('point 必须是对象')
  return {
    x: assertFiniteNumber(point.x, 'point.x'),
    y: assertFiniteNumber(point.y, 'point.y'),
  }
}

export function normalizeSizes(sizes, minRatio = MIN_SPLIT_RATIO) {
  if (!Array.isArray(sizes) || sizes.length === 0) throw invalid('sizes 必须是非空数组')
  if (!Number.isFinite(minRatio) || minRatio < 0 || minRatio * sizes.length >= 1) {
    throw invalid('minRatio 与 sizes 数量不兼容')
  }
  const safe = sizes.map((size, index) => {
    const value = typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : 0
    return Math.max(minRatio, value)
  })
  const total = safe.reduce((sum, value) => sum + value, 0)
  const normalized = safe.map((value) => value / total)
  const correction = normalized.reduce((sum, value) => sum + value, 0)
  return normalized.map((value) => value / correction)
}

export function createIdMint(prefix = 'wb') {
  assertWorkbenchId(prefix, 'prefix')
  let counter = 0
  const next = (kind) => {
    counter += 1
    return `${prefix}-${kind}-${counter}`
  }
  return {
    pane: () => next('pane'),
    split: () => next('split'),
    tab: () => next('tab'),
    float: () => next('float'),
    window: () => next('window'),
    lease: () => next('lease'),
  }
}

export function createTab({ id, kind, contentId, instanceId, title }) {
  assertWorkbenchId(id, 'tab.id')
  if (!CONTENT_KINDS.includes(kind)) throw invalid(`未知 content kind: ${kind}`)
  assertWorkbenchId(contentId, 'tab.contentId')
  assertWorkbenchId(instanceId, 'tab.instanceId')
  if (title !== undefined && (typeof title !== 'string' || title.length > 512)) {
    throw invalid('tab.title 必须是不超过 512 字符的字符串')
  }
  return {
    id,
    ref: { kind, contentId, instanceId },
    ...(title === undefined ? {} : { title }),
  }
}

export function createPane(id, tabs = [], activeTabId) {
  assertWorkbenchId(id, 'pane.id')
  if (!Array.isArray(tabs)) throw invalid('pane.tabs 必须是数组')
  const tabIds = new Set()
  for (const tab of tabs) {
    validateTab(tab)
    if (tabIds.has(tab.id)) throw invalid(`pane 内 tab id 重复: ${tab.id}`)
    tabIds.add(tab.id)
  }
  if (activeTabId !== undefined && !tabIds.has(activeTabId)) {
    throw invalid(`activeTabId 不存在于 pane: ${activeTabId}`)
  }
  return {
    kind: 'pane',
    id,
    tabs: cloneJson(tabs),
    ...(activeTabId === undefined ? {} : { activeTabId }),
  }
}

export function createSplit(id, axis, children, sizes) {
  assertWorkbenchId(id, 'split.id')
  if (axis !== 'row' && axis !== 'column') throw invalid("split.axis 必须是 row 或 column")
  if (!Array.isArray(children) || children.length < 2) throw invalid('split 至少需要两个子节点')
  if (!Array.isArray(sizes) || sizes.length !== children.length) throw invalid('split.sizes 长度必须等于 children')
  return {
    kind: 'split',
    id,
    axis,
    children: cloneJson(children),
    sizes: normalizeSizes(sizes),
  }
}

export function createWindowRef({ windowId, hostId, host = 'internal' }) {
  assertWorkbenchId(windowId, 'windowRef.windowId')
  assertWorkbenchId(hostId, 'windowRef.hostId')
  if (!WINDOW_HOSTS.includes(host)) throw invalid(`未知窗口宿主: ${host}`)
  return { windowId, hostId, host }
}

export function createFloat({ id, rect, tabs = [], activeTabId, pin = 'none', host = 'internal', groupId, workspaceId, zIndex = 0, minimized = false }) {
  assertWorkbenchId(id, 'float.id')
  if (!PIN_LEVELS.includes(pin)) throw invalid(`未知 Pin 档位: ${pin}`)
  if (!WINDOW_HOSTS.includes(host)) throw invalid(`未知窗口宿主: ${host}`)
  if (!Number.isSafeInteger(zIndex) || zIndex < 0) throw invalid('float.zIndex 必须是非负安全整数')
  if (groupId !== undefined) assertWorkbenchId(groupId, 'float.groupId')
  if (workspaceId !== undefined) assertWorkbenchId(workspaceId, 'float.workspaceId')
  if (typeof minimized !== 'boolean') throw invalid('float.minimized 必须是布尔值')
  const paneLike = createPane(`${id}:content`, tabs, activeTabId)
  return {
    kind: 'float',
    id,
    rect: validateRect(rect),
    pin,
    host,
    ...(groupId === undefined ? {} : { groupId }),
    ...(workspaceId === undefined ? {} : { workspaceId }),
    zIndex,
    minimized,
    tabs: paneLike.tabs,
    ...(paneLike.activeTabId === undefined ? {} : { activeTabId: paneLike.activeTabId }),
  }
}

export function createWorkbenchLayout(root, floats = [], options = {}) {
  if (!isPlainRecord(options)) throw invalid('layout options 必须是对象')
  const revision = options.revision ?? 0
  if (!Number.isSafeInteger(revision) || revision < 0) throw invalid('layout.revision 必须是非负安全整数')
  if (options.focusedId !== undefined) assertWorkbenchId(options.focusedId, 'layout.focusedId')
  if (!Array.isArray(options.minimized ?? [])) throw invalid('layout.minimized 必须是数组')
  const layout = {
    schemaVersion: WORKBENCH_SCHEMA_VERSION,
    revision,
    root: cloneJson(root),
    floats: cloneJson(floats),
    ...(options.focusedId === undefined ? {} : { focusedId: options.focusedId }),
    minimized: cloneJson(options.minimized ?? []),
  }
  validateWorkbenchLayout(layout)
  return layout
}

export function validateTab(tab) {
  if (!isPlainRecord(tab)) throw invalid('tab 必须是对象')
  assertWorkbenchId(tab.id, 'tab.id')
  if (!isPlainRecord(tab.ref)) throw invalid('tab.ref 必须是对象')
  if (!CONTENT_KINDS.includes(tab.ref.kind)) throw invalid(`未知 content kind: ${tab.ref.kind}`)
  assertWorkbenchId(tab.ref.contentId, 'tab.ref.contentId')
  assertWorkbenchId(tab.ref.instanceId, 'tab.ref.instanceId')
  if (tab.title !== undefined && (typeof tab.title !== 'string' || tab.title.length > 512)) {
    throw invalid('tab.title 必须是不超过 512 字符的字符串')
  }
  return tab
}

function validateNode(node, ids, tabIds, instanceIds) {
  if (!isPlainRecord(node)) throw invalid('layout node 必须是对象')
  if (node.kind === 'pane') {
    assertWorkbenchId(node.id, 'pane.id')
    if (ids.has(node.id)) throw invalid(`layout id 重复: ${node.id}`)
    ids.add(node.id)
    if (!Array.isArray(node.tabs)) throw invalid('pane.tabs 必须是数组')
    for (const tab of node.tabs) {
      validateTab(tab)
      if (tabIds.has(tab.id)) throw invalid(`tab id 重复: ${tab.id}`)
      if (instanceIds.has(tab.ref.instanceId)) throw invalid(`content instance 重复: ${tab.ref.instanceId}`)
      tabIds.add(tab.id)
      instanceIds.add(tab.ref.instanceId)
    }
    if (node.activeTabId !== undefined && !node.tabs.some((tab) => tab.id === node.activeTabId)) {
      throw invalid(`pane activeTabId 无效: ${node.activeTabId}`)
    }
    return
  }
  if (node.kind !== 'split') throw invalid(`未知 layout node kind: ${node.kind}`)
  assertWorkbenchId(node.id, 'split.id')
  if (ids.has(node.id)) throw invalid(`layout id 重复: ${node.id}`)
  ids.add(node.id)
  if (node.axis !== 'row' && node.axis !== 'column') throw invalid('split.axis 无效')
  if (!Array.isArray(node.children) || node.children.length < 2) throw invalid('split 至少需要两个子节点')
  if (!Array.isArray(node.sizes) || node.sizes.length !== node.children.length) {
    throw invalid('split.sizes 长度必须等于 children')
  }
  for (const size of node.sizes) assertFiniteNumber(size, 'split.size', { min: Number.MIN_VALUE, max: 1 })
  const total = node.sizes.reduce((sum, size) => sum + size, 0)
  if (Math.abs(total - 1) > 1e-8) throw invalid('split.sizes 总和必须为 1')
  for (const child of node.children) validateNode(child, ids, tabIds, instanceIds)
}

export function validateWorkbenchLayout(layout) {
  if (!isPlainRecord(layout)) throw invalid('workbench layout 必须是对象')
  if (layout.schemaVersion !== WORKBENCH_SCHEMA_VERSION) {
    throw invalid(`不支持的 workbench schemaVersion: ${layout.schemaVersion}`)
  }
  if (!Number.isSafeInteger(layout.revision) || layout.revision < 0) throw invalid('layout.revision 无效')
  const ids = new Set()
  const tabIds = new Set()
  const instanceIds = new Set()
  validateNode(layout.root, ids, tabIds, instanceIds)
  if (!Array.isArray(layout.floats)) throw invalid('layout.floats 必须是数组')
  const floatIds = new Set()
  for (const float of layout.floats) {
    if (!isPlainRecord(float) || float.kind !== 'float') throw invalid('float 记录无效')
    assertWorkbenchId(float.id, 'float.id')
    if (ids.has(float.id) || floatIds.has(float.id)) throw invalid(`float id 重复: ${float.id}`)
    ids.add(float.id)
    floatIds.add(float.id)
    validateRect(float.rect)
    if (!PIN_LEVELS.includes(float.pin)) throw invalid(`未知 Pin 档位: ${float.pin}`)
    if (!WINDOW_HOSTS.includes(float.host)) throw invalid(`未知窗口宿主: ${float.host}`)
    if (!Number.isSafeInteger(float.zIndex) || float.zIndex < 0) throw invalid('float.zIndex 无效')
    if (float.groupId !== undefined) assertWorkbenchId(float.groupId, 'float.groupId')
    if (float.workspaceId !== undefined) assertWorkbenchId(float.workspaceId, 'float.workspaceId')
    if (typeof float.minimized !== 'boolean') throw invalid('float.minimized 无效')
    if (!Array.isArray(float.tabs)) throw invalid('float.tabs 必须是数组')
    for (const tab of float.tabs) {
      validateTab(tab)
      if (tabIds.has(tab.id)) throw invalid(`tab id 重复: ${tab.id}`)
      if (instanceIds.has(tab.ref.instanceId)) throw invalid(`content instance 重复: ${tab.ref.instanceId}`)
      tabIds.add(tab.id)
      instanceIds.add(tab.ref.instanceId)
    }
    if (float.activeTabId !== undefined && !float.tabs.some((tab) => tab.id === float.activeTabId)) {
      throw invalid(`float activeTabId 无效: ${float.activeTabId}`)
    }
  }
  if (!Array.isArray(layout.minimized)) throw invalid('layout.minimized 必须是数组')
  const minimizedIds = new Set()
  for (const record of layout.minimized) {
    if (!isPlainRecord(record)) throw invalid('minimized record 必须是对象')
    assertWorkbenchId(record.floatId, 'minimized.floatId')
    if (!floatIds.has(record.floatId) || minimizedIds.has(record.floatId)) {
      throw invalid(`minimized.floatId 无效或重复: ${record.floatId}`)
    }
    minimizedIds.add(record.floatId)
    assertFiniteNumber(record.x, 'minimized.x')
    assertFiniteNumber(record.y, 'minimized.y')
    if (!WINDOW_HOSTS.includes(record.host)) throw invalid('minimized.host 无效')
    if (record.groupId !== undefined) assertWorkbenchId(record.groupId, 'minimized.groupId')
    const float = layout.floats.find((item) => item.id === record.floatId)
    if (!float.minimized) throw invalid(`minimized record 指向未最小化的 float: ${record.floatId}`)
  }
  for (const float of layout.floats) {
    if (float.minimized && !minimizedIds.has(float.id)) throw invalid(`最小化 float 缺少胶囊位置: ${float.id}`)
  }
  if (layout.focusedId !== undefined) {
    assertWorkbenchId(layout.focusedId, 'layout.focusedId')
    if (!ids.has(layout.focusedId)) throw invalid(`layout.focusedId 不存在: ${layout.focusedId}`)
  }
  return layout
}

export function findPane(root, paneId) {
  if (!root) return undefined
  if (root.kind === 'pane') return root.id === paneId ? root : undefined
  for (const child of root.children) {
    const found = findPane(child, paneId)
    if (found) return found
  }
  return undefined
}

export function findSplit(root, splitId) {
  if (!root || root.kind === 'pane') return undefined
  if (root.id === splitId) return root
  for (const child of root.children) {
    const found = findSplit(child, splitId)
    if (found) return found
  }
  return undefined
}

export function findFloat(layout, floatId) {
  return layout.floats.find((float) => float.id === floatId)
}

export function listPanes(root) {
  if (!root) return []
  return root.kind === 'pane' ? [root] : root.children.flatMap(listPanes)
}

export function listTabs(layout) {
  return [
    ...listPanes(layout.root).flatMap((pane) => pane.tabs),
    ...layout.floats.flatMap((float) => float.tabs),
  ]
}

export function locateTab(layout, tabId) {
  for (const pane of listPanes(layout.root)) {
    const index = pane.tabs.findIndex((tab) => tab.id === tabId)
    if (index >= 0) return { host: 'pane', hostId: pane.id, index, tab: pane.tabs[index] }
  }
  for (const float of layout.floats) {
    const index = float.tabs.findIndex((tab) => tab.id === tabId)
    if (index >= 0) return { host: 'float', hostId: float.id, index, tab: float.tabs[index] }
  }
  return null
}

function compactNode(node, seedPaneId) {
  if (node.kind === 'pane') return node
  const children = node.children.map((child) => compactNode(child, seedPaneId))
  const kept = children.filter((child) => child.kind !== 'pane' || child.tabs.length > 0)
  if (kept.length === 0) return createPane(seedPaneId)
  if (kept.length === 1) return kept[0]
  const indexes = children.map((child, index) => ({ child, index })).filter(({ child }) => kept.includes(child))
  return {
    ...node,
    children: kept,
    sizes: normalizeSizes(indexes.map(({ index }) => node.sizes[index])),
  }
}

export function compactWorkbenchLayout(layout, seedPaneId = 'wb-empty') {
  validateWorkbenchLayout(layout)
  assertWorkbenchId(seedPaneId, 'seedPaneId')
  const root = compactNode(layout.root, seedPaneId)
  const next = { ...cloneJson(layout), root }
  validateWorkbenchLayout(next)
  return next
}

export function cloneWorkbenchLayout(layout) {
  validateWorkbenchLayout(layout)
  return cloneJson(layout)
}

export function workbenchLayoutShape(layout) {
  const clone = cloneWorkbenchLayout(layout)
  return JSON.stringify({ root: clone.root, floats: clone.floats, minimized: clone.minimized })
}

export function workbenchLayoutProblem(layout) {
  try {
    validateWorkbenchLayout(layout)
    return null
  } catch (error) {
    return corrupt(error.message, { causeCode: error.code })
  }
}
