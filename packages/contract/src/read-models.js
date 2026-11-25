/**
 * 渲染层读模型：把 DSH 的 wire 形状折叠成 UI 直接能用的结构。
 *
 * 所有字段名均来自 2026-11-23 实测（follow 首帧 snapshot / terminal list），
 * 不是照文档猜的。字段缺失时保持 null，不编造默认值。
 *
 * 本文件必须保持纯函数：无 IO、无时间依赖（时间来自入参）。
 */

/**
 * 会话状态卡。数据源是 follow 首帧的 `snapshot.projections`。
 * 实测：一帧就包含权限、模型、目标、用量、上下文压力，无需额外请求。
 *
 * @param {{ asOfSeq?: number, values?: Record<string, unknown> } | null} projections
 */
export function sessionStatusOf(projections) {
  if (!projections || typeof projections !== 'object') return null
  const v = projections.values ?? {}

  return {
    asOfSeq: projections.asOfSeq ?? null,
    title: v.title ?? null,
    agentPreset: v.agentPreset ?? null,
    workingDirectory: v.workingDirectory ?? null,
    model: v.modelSelection ?? null,
    goal: v.goal ?? null,
    permissions: v.permissions ?? null,
    stats: v.sessionStats ?? null,
    tokens: v.tokenUsage ?? null,
    contextPressure: v.contextPressure ?? null,
    contextBreakdown: v.contextBreakdown ?? null,
    inbox: v.inbox ?? null,
    turnOutline: Array.isArray(v.turnOutline) ? v.turnOutline : [],
    userQuestions: v.userQuestions ?? { active: [], settled: [] },
  }
}

/**
 * 会话头。数据源是 follow 首帧的 `snapshot.header`。
 * @param {Record<string, unknown> | null} header
 */
export function sessionHeaderOf(header) {
  if (!header || typeof header !== 'object') return null
  return {
    id: header.id ?? null,
    formatVersion: header.version ?? null,
    createdAt: header.createdAt ?? null,
    cwd: header.cwd ?? null,
    isSeeded: header.isSeeded === true,
    delegationDepth: header.delegationDepth ?? 0,
    agentPreset: header.agentPreset ?? null,
  }
}

/**
 * 终端视图。数据源是 `terminal/list` / `terminal/create` 的返回值。
 *
 * origin / control 决定 UI 上怎么标（用户终端 vs Agent 终端），
 * 这是安全可见性要求：两者权限不同（用户终端不受 sandbox 约束）。
 *
 * @param {Record<string, unknown> | null} info
 */
export function terminalViewOf(info) {
  if (!info || typeof info !== 'object') return null
  return {
    id: info.id ?? null,
    title: info.title ?? null,
    shell: info.shell ?? null,
    cwd: info.cwd ?? null,
    cols: info.cols ?? 100,
    rows: info.rows ?? 30,
    state: info.state ?? 'unknown',
    exitCode: info.exitCode ?? null,
    origin: info.origin ?? 'user',
    control: info.control ?? 'user',
    /** 是否为 Agent 打开的终端（受会话 sandbox 约束） */
    isAgentOwned: info.origin === 'agent',
  }
}

/**
 * 一轮对话的用量。数据源是 `turn/end` 事件的 `data.usage`。
 * @param {Record<string, unknown> | null} usage
 */
export function usageOf(usage) {
  if (!usage || typeof usage !== 'object') return null
  return {
    uncachedInputTokens: usage.uncachedInputTokens ?? null,
    outputTokens: usage.outputTokens ?? null,
    cacheReadTokens: usage.cacheReadTokens ?? null,
    cacheWriteTokens: usage.cacheWriteTokens ?? null,
  }
}

/** 把项目状态映射成渲染层的三个语义状态，避免各面板自己判断字符串。 */
export const TERMINAL_STATE = Object.freeze({
  running: 'running',
  exited: 'exited',
  failed: 'failed',
})

/** 会话在列表里的状态，来自 `session/state`。 */
export function sessionStateOf(state) {
  if (!state || typeof state !== 'object') return null
  return {
    cursor: state.cursor ?? null,
    active: state.active === true,
    running: state.running === true,
    queue: Array.isArray(state.queue) ? state.queue : [],
    pendingInput: Array.isArray(state.pendingInput) ? state.pendingInput : [],
  }
}
