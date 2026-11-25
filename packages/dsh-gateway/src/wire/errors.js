/**
 * DSH 错误码 → 三段式文案。
 *
 * 规则：任何错误都必须同时给出「发生了什么 / 为什么 / 我能做什么」。
 * 禁止只弹一行红字。文案表在这里集中维护，UI 只负责渲染。
 *
 * 错误码来源：
 * - `gateway/*`            Typert API Gateway 自己的分发/校验失败
 * - `remote-access/*`      权限策略拒绝
 * - `session/*`            会话层冲突
 * - `settings/*`           配置写入
 * - `credential-*`         凭证
 * - `terminal/*`           终端生命周期
 * - `MISSING_CREDENTIAL`   模型 Key 缺失（来自 LLM provider，不是 gateway）
 *
 * 全部来自 0.2.2-rc.5 的实测与随包文档，未收录的码走 fallback。
 */

/** 常见错误码常量，避免字符串拼错。 */
export const ErrorCode = Object.freeze({
  badRequest: 'gateway/bad-request',
  inputInvalid: 'gateway/input-invalid',
  argumentsInvalid: 'gateway/arguments-invalid',
  internal: 'gateway/internal',
  cancelled: 'gateway/cancelled',
  peerDisposed: 'gateway/peer-disposed',
  interactionsForbidden: 'gateway/interactions-forbidden',
  uplinkOverflow: 'gateway/uplink-overflow',
  protocol: 'gateway/protocol',

  accessDenied: 'remote-access/denied',
  resourceInvalid: 'resource-invalid',

  sessionConflict: 'session/conflict',
  sessionAgentBusy: 'session/agent-busy',

  settingsConflict: 'settings-conflict',
  settingsRejected: 'settings-rejected',
  credentialRejected: 'credential-rejected',

  terminalUnavailable: 'terminal/unavailable',

  missingCredential: 'MISSING_CREDENTIAL',

  /** 传输层自造：认证过期 */
  unauthorized: 'transport/unauthorized',
  /** 传输层自造：trust fence 拒绝 */
  forbidden: 'transport/forbidden',
  /** 传输层自造：连接或超时 */
  transportFailed: 'transport/failed',
})

/**
 * @type {Record<string, { what: string, why: string, todo: string }>}
 */
const GUIDE = {
  [ErrorCode.argumentsInvalid]: {
    what: '请求参数与运行时契约不一致',
    why: '客户端与 DSH 的 descriptor 版本不匹配，或调用方字段写错',
    todo: '核对 dsh --version 是否等于锁定版本；message 里会直接列出缺什么、多了什么',
  },
  [ErrorCode.inputInvalid]: {
    what: '某个字段的取值不合法',
    why: '字段名对了，但值的形状或类型不符合 descriptor',
    todo: '按 message 指明的字段检查嵌套结构（常见于 address、request 这类复合参数）',
  },
  [ErrorCode.badRequest]: {
    what: '请求格式有误',
    why: 'URL endpoint 与 body 里的 method 不一致，或报文结构非法',
    todo: '确认 POST 路径是 /api/<namespace>/<method>，且 body.method 与之完全一致',
  },
  [ErrorCode.internal]: {
    what: '运行时内部错误',
    why: 'DSH 侧处理时异常',
    todo: '查看 dsh 进程日志；若可复现，记录 rpcId 用于排查',
  },
  [ErrorCode.cancelled]: {
    what: '请求已被取消',
    why: '调用方主动取消，或 Peer 已销毁',
    todo: '通常无需处理；如果是意外取消，检查 WebSocket 是否断开',
  },
  [ErrorCode.peerDisposed]: {
    what: '连接身份已失效',
    why: '/connect 建立的 Peer 随 socket 关闭而销毁',
    todo: '重新 /connect 换取新 Cookie，并重建长活连接',
  },
  [ErrorCode.accessDenied]: {
    what: '没有执行该操作的权限',
    why: '远端访问策略（remote-access）拒绝了这次调用',
    todo: '本机单用户场景不应出现；出现请当作缺陷上报',
  },
  [ErrorCode.sessionConflict]: {
    what: '会话与指定的工作区或目录不匹配',
    why: '该 sessionId 已属于另一个目录',
    todo: '切换到正确的工作区，或新建会话',
  },
  [ErrorCode.sessionAgentBusy]: {
    what: '该会话正被子 Agent 占用',
    why: '子 Agent 持有该会话的写句柄',
    todo: '等待子 Agent 结束，或新建会话',
  },
  [ErrorCode.settingsConflict]: {
    what: '配置已被其他窗口修改',
    why: '写入时基于的版本已过期（乐观锁冲突）',
    todo: '刷新后重试',
  },
  [ErrorCode.settingsRejected]: {
    what: '配置写入被拒绝',
    why: 'provider 拒绝了这个值',
    todo: '按返回的具体原因修正后重试',
  },
  [ErrorCode.credentialRejected]: {
    what: '凭证被 provider 拒绝',
    why: 'Key 无效、过期或权限不足',
    todo: '重新输入 Key；注意凭证只写不读，无法查看已存的值',
  },
  [ErrorCode.terminalUnavailable]: {
    what: '终端已不可用',
    why: '终端已退出、被回收，或所在会话被销毁',
    todo: '重新打开终端；项目终端会随锚定会话重建',
  },
  [ErrorCode.missingCredential]: {
    what: '没有配置模型凭证',
    why: 'provider route 找不到对应的 API Key',
    todo: '在「运行时 → 模型与凭证」里填入 Key，或设置 DEEPSEEK_API_KEY 后重启',
  },
  [ErrorCode.unauthorized]: {
    what: '认证已失效',
    why: 'Cookie 过期，或 Peer 随上一条 socket 一起销毁',
    todo: '自动重连会重新换取 Cookie；若持续失败，检查 dsh 进程是否还在',
  },
  [ErrorCode.forbidden]: {
    what: '请求被主机信任策略拒绝',
    why: 'Host 不是 loopback，或 Origin 与 authority 不一致',
    todo: '确认主进程直连 127.0.0.1 且不设置 Origin 头',
  },
  [ErrorCode.transportFailed]: {
    what: '无法连接运行时',
    why: 'dsh web 进程未启动、已退出，或端口不可达',
    todo: '检查 WSL 内的 dsh 进程；应用会在退避后自动重试',
  },
}

/**
 * 把错误码翻译成三段式说明。
 * @param {string | null | undefined} code
 * @param {string} [message] 运行时给的原始信息
 * @returns {{ code: string, what: string, why: string, todo: string, detail: string | null }}
 */
export function describeError(code, message) {
  const key = typeof code === 'string' && code.length > 0 ? code : 'unknown'
  const guide = GUIDE[key]
  return {
    code: key,
    what: guide?.what ?? '发生了未归类的错误',
    why: guide?.why ?? '运行时返回了未收录的错误码',
    todo: guide?.todo ?? '保留 detail 字段并反馈，便于补充错误码表',
    detail: typeof message === 'string' && message.length > 0 ? message : null,
  }
}

/** 该错误是否值得自动重试（连接类可重试，业务类不可）。 */
export function isRetryable(code) {
  return code === ErrorCode.transportFailed || code === ErrorCode.unauthorized
}

/** 该错误是否意味着必须重新 /connect（Peer 已死）。 */
export function needsReconnect(code) {
  return code === ErrorCode.unauthorized || code === ErrorCode.peerDisposed
}
