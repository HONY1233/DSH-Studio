/**
 * 三态读模型：每个读接口必须返回 ready / empty / unavailable 之一。
 *
 * 存在意义：上一版桥里有约 20 个读接口返回空数组或常量却不说明，
 * 前端把它们当成「正常但为空」，于是出现「健康分 100 但什么都没查」这类假象。
 * 这里用工厂函数把「必须给原因」变成硬约束。
 */

/** 数据来源。渲染层据此显示来源徽标，也用于排查「这个数哪来的」。 */
export const Provenance = Object.freeze({
  /** DSH 运行时（unary 调用或 mux 流） */
  runtime: 'runtime',
  /** 由会话事件流投影得出（事件日志） */
  eventLog: 'event-log',
  /** 读取 DSH 安装目录（插件树、模型表、技能根） */
  install: 'install',
  /** 本机能力：Electron 主进程或 Node 直连（fs / git / pty） */
  host: 'host',
  /** 没有来源。不允许把 none 渲染成正常数据。 */
  none: 'none',
})

/**
 * 有数据。
 * @param {unknown} data
 * @param {string} [source] Provenance 值
 */
export function ready(data, source = Provenance.runtime) {
  return { state: 'ready', data, source, generatedAt: new Date().toISOString() }
}

/**
 * 无数据，但这是正常情况（例如新会话还没有用量）。
 * 强制要求 reason：没有原因的「空」视为缺陷。
 * @param {string} reason 为什么没有
 * @param {{ howToProduce?: string, source?: string }} [opts]
 */
export function empty(reason, { howToProduce, source = Provenance.runtime } = {}) {
  if (!reason) throw new Error('empty() 必须给出 reason')
  return {
    state: 'empty',
    reason,
    ...(howToProduce ? { howToProduce } : {}),
    source,
  }
}

/**
 * DSH 不具备该能力。
 * @param {string} reason 为什么不支持
 * @param {string} [alternative] 替代做法
 */
export function unavailable(reason, alternative) {
  if (!reason) throw new Error('unavailable() 必须给出 reason')
  return { state: 'unavailable', reason, ...(alternative ? { alternative } : {}) }
}

/** 判断一个值是否是合法读模型。用于传输层自检。 */
export function isReadState(value) {
  if (!value || typeof value !== 'object') return false
  switch (value.state) {
    case 'ready':
      return typeof value.source === 'string' && 'data' in value
    case 'empty':
      return typeof value.reason === 'string' && value.reason.length > 0
    case 'unavailable':
      return typeof value.reason === 'string' && value.reason.length > 0
    default:
      return false
  }
}

/** 从读模型里取数据，取不到返回 fallback。方便渲染层少写分支。 */
export function dataOr(value, fallback = null) {
  return value && value.state === 'ready' ? value.data : fallback
}
