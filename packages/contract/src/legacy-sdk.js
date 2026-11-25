/**
 * SDK stdio 通道的 wire 常量（`dsh --profile sdk`）。
 *
 * 保留原因：G5b 的评测批跑器走 SDK 批量跑（不需要流式，且进程隔离更干净）。
 * Web 通道（`dsh --profile web`）的常量不在这里 —— 它没有固定的方法枚举，
 * 端点由 descriptor 决定，见 @dsh-studio/dsh-gateway。
 *
 * 基线镜像 `@deepseek-ai/dsh-sdk-protocol` 0.2.2-rc.5，并包含已批准的 XG1 additive 控制方法。
 */

/** Client -> server request methods. */
export const RequestMethod = Object.freeze({
  initialize: 'initialize',
  sessionPrompt: 'session/prompt',
  sessionQuery: 'session/query',
  sessionResume: 'session/resume',
  sessionWait: 'session/wait',
  workingDirectoryGet: 'session/working-directory/get',
  workingDirectorySet: 'session/working-directory/set',
  turnCancel: 'session/turn.cancel',
  turnSteer: 'session/turn.steer',
  queueEnqueue: 'session/queue.enqueue',
  queueList: 'session/queue.list',
  queueCancel: 'session/queue.cancel',
  draftGet: 'session/draft.get',
  draftPut: 'session/draft.put',
  shutdown: 'shutdown',
})

/** Server -> client request methods (opt-in through `initialize`). */
export const ClientRequestMethod = Object.freeze({
  approval: 'approval/request',
  userQuestion: 'user-question/ask',
})

/** Server -> client notifications. */
export const NotificationMethod = Object.freeze({
  sessionEvent: 'session.event',
  sessionStatus: 'session.status',
  queryCompleted: 'session.query.completed',
  userQuestionCancelled: 'user-question.cancelled',
  subagentStarted: 'subagent.started',
  subagentFinished: 'subagent.finished',
})

/** Wire-stable runtime identity returned by `initialize`. */
export const RUNTIME_SERVER_NAME = 'deepseek-harness-sdk-runtime'

/** One-shot approval outcomes accepted by the runtime. */
export const ApprovalOutcome = Object.freeze({
  allowedOnce: 'allowed-once',
  rejected: 'rejected',
  cancelled: 'cancelled',
})
