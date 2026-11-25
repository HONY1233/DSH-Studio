/**
 * Wire contract shared by the transport layer, the Electron host and the renderer.
 *
 * 这个包必须保持「无 node 内置模块、无 Electron 引用」，因为渲染层要 import 它。
 *
 * 四条主线：
 * - legacy-sdk    SDK stdio 通道常量（headless / 评测批跑器用）
 * - projection    会话事件 → 对话视图（纯函数，可回放）
 * - read-models   会话状态 / 终端 / 用量等读模型
 * - provenance    三态读模型工厂（ready / empty / unavailable）
 */

export {
  ApprovalOutcome,
  ClientRequestMethod,
  NotificationMethod,
  RequestMethod,
  RUNTIME_SERVER_NAME,
} from './legacy-sdk.js'

export {
  appendNotice,
  appendUserMessage,
  applySessionStatus,
  createSessionView,
  describeTurnEnd,
  projectSessionEvent,
  textOfContent,
} from './projection.js'

export {
  Provenance,
  dataOr,
  empty,
  isReadState,
  ready,
  unavailable,
} from './provenance.js'

export {
  TERMINAL_STATE,
  sessionHeaderOf,
  sessionStateOf,
  sessionStatusOf,
  terminalViewOf,
  usageOf,
} from './read-models.js'
