/**
 * DSH → OMP Studio client contract bridge.
 *
 * The forked OMP renderer speaks `@omp-studio/client-contract`; the runtime
 * here is DeepSeek Harness over stdio JSON-RPC. This module owns that
 * translation: read models for the shell, `conversation.changed` events
 * projected from `session.event`, and command receipts.
 *
 * It stays inside the Electron main process and never exposes paths, PIDs or
 * wire frames to the renderer.
 */
import { EventEmitter } from 'node:events'
import { createLocalDraftStore } from './local-drafts.js'
import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { promisify } from 'node:util'
import {
  closeSessionToolInstance,
  createCapabilityManifest,
  createEventRouter,
  createToolCapabilitySnapshot,
  createWorkbenchLimits,
  createWorkbenchRegistry,
  effectiveSessionToolset,
  getConversationWorkspace,
  putConversationWorkspace,
  registerSessionToolInstance,
  setSessionToolset,
} from '@dsh-studio/workbench-core'
import {
  createGitWorkspace,
  createSystemDirectory,
  createWorkspaceFiles,
  credentialRefNames,
  credentialRefValue,
  deleteSession,
  deriveToolCatalog,
  inspectSystemFile,
  listSessions,
  listSystem,
  readAssetOverview,
  readBuiltinCommands,
  readMcpServers,
  readProfileSummary,
  readRuntimeModelCatalog,
  readSessionEvents,
  readSessionRuntimeState,
  readSkillRootExtras,
  readSystemChunk,
  readSystemText,
  renameSystemEntry,
  scanSkills,
  setCredentialRef,
  skillPathByName,
  skillRootPath,
  systemPlaces,
  toSystemPath,
  uncFromWsl,
  unsetCredentialRef,
  writeSystemText,
} from '@dsh-studio/host-services'

const execFileAsync = promisify(execFile)
const GIT = process.env.GIT_BIN ?? 'git'

const ENVIRONMENT_ID = 'dsh-environment'
const RUNTIME_ID = 'dsh-sdk'
const AUTHORITY_ID = 'dsh-desktop'
const CONTROL_RUNTIME_METHODS = Object.freeze({
  'core.steer': 'session/turn.steer',
  'core.abort': 'session/turn.cancel',
  'queue.enqueue': 'session/queue.enqueue',
  'session.queue.list': 'session/queue.list',
  'session.queue.cancel': 'session/queue.cancel',
  'session.queue.remove': 'session/queue.cancel',
  'session.draft.get': 'session/draft.get',
  'session.draft.put': 'session/draft.put',
})

/**
 * The Host-owned workbench tool matrix (X4.3).
 *
 * `available` entries name the adapter that really backs them. Everything else
 * stays blocked with a reason so a renderer cannot promote a configured or
 * preview-only capability by sending its own snapshot.
 */
const WORKBENCH_TOOL_CAPABILITIES = Object.freeze({
  files: Object.freeze({ grade: 'available', evidence: 'workspace.file.* + fs.file.*' }),
  changes: Object.freeze({ grade: 'available', evidence: 'git.repository.get + git.diff' }),
  git: Object.freeze({ grade: 'available', evidence: 'git.toolchain.get + git.log.list' }),
  terminal: Object.freeze({ grade: 'available', evidence: 'ompStudioTerminal + terminal-service' }),
  agents: Object.freeze({ grade: 'available', evidence: 'subagent.started + subagent.finished' }),
  mcp: Object.freeze({
    grade: 'configured',
    reason: 'MCP 仅解析 profile 配置；当前没有运行时连接、工具注册或健康检查',
  }),
  skills: Object.freeze({
    grade: 'configured',
    reason: 'Skills 来自磁盘发现；当前没有 Runtime loaded/session 事实',
  }),
  browser: Object.freeze({
    grade: 'unavailable',
    reason: '托管浏览器仍处于安全门关闭状态，未开放 browser preload',
  }),
  computer: Object.freeze({
    grade: 'unavailable',
    reason: '没有真实 ComputerAdapter 或系统驱动',
  }),
  ssh: Object.freeze({
    grade: 'unavailable',
    reason: 'SSH 驱动、主机密钥校验和凭据存储尚未接入',
  }),
  wsl: Object.freeze({
    grade: 'unavailable',
    reason: 'WSL 独立 profile 适配器尚未接入；本地 shell 使用 terminal',
  }),
  btw: Object.freeze({
    grade: 'unavailable',
    reason: 'Runtime 没有隔离的 BTW 上下文',
  }),
  voice: Object.freeze({
    grade: 'unavailable',
    reason: '没有宿主音频/ASR 适配器',
  }),
  evaluation: Object.freeze({
    grade: 'limited',
    reason: '只识别测试命令；没有 judge、评分集或隔离执行',
  }),
  'time-travel': Object.freeze({
    grade: 'unavailable',
    reason: 'Runtime 没有 fork/restore 或工作区快照协议',
  }),
})

/** Workspace id derived from the runtime cwd, stable for one folder. */
export function workspaceIdFor(posixCwd) {
  return `ws-${posixCwd.replaceAll('/', '-')}`
}

function workspaceNameFor(posixCwd) {
  const trimmed = posixCwd.replace(/\/+$/, '')
  return trimmed.slice(trimmed.lastIndexOf('/') + 1) || trimmed
}

function isoFromEpoch(value) {
  return new Date(typeof value === 'number' ? value : Date.now()).toISOString()
}

function textOfContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return ''
      if (block.type === 'text') return block.text ?? ''
      if (block.type === 'reasoning') return ''
      if (block.type === 'image') return '[image]'
      return ''
    })
    .join('')
}

/** Convert renderer composer input to additive Runtime content blocks. */
function controlContent(input) {
  const text = typeof input?.text === 'string' ? input.text : ''
  const blocks = text ? [{ type: 'text', text }] : []
  for (const image of Array.isArray(input?.images) ? input.images : []) {
    if (!image || typeof image !== 'object') continue
    if (typeof image.data !== 'string' || typeof image.mimeType !== 'string') continue
    blocks.push({ type: 'image', data: image.data, mimeType: image.mimeType })
  }
  return blocks
}

function controlError(error, fallback = 'INTERNAL') {
  const code = typeof error?.data?.code === 'string' ? error.data.code
    : (typeof error?.code === 'string' ? error.code : fallback)
  const details = error?.data?.details ?? error?.details
  return { code, message: error?.message ?? String(error), ...(details ? { details } : {}) }
}

/** DSH content blocks → contract content blocks. */
function toContractBlocks(content) {
  const blocks = []
  for (const block of Array.isArray(content) ? content : []) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && block.text) blocks.push({ type: 'text', text: block.text })
    else if (block.type === 'reasoning' && block.text) blocks.push({ type: 'thinking', text: block.text })
    else if (block.type === 'toolCall' && block.toolCallId) {
      blocks.push({
        type: 'toolCall',
        toolCallId: block.toolCallId,
        toolName: block.toolName ?? block.name ?? 'tool',
        ...(block.arguments === undefined ? {} : { arguments: block.arguments }),
      })
    } else if (block.type === 'toolResult' && block.toolCallId) {
      blocks.push({
        type: 'toolResult',
        toolCallId: block.toolCallId,
        ...(block.toolName ? { toolName: block.toolName } : {}),
        ...(block.output === undefined ? {} : { output: String(block.output) }),
        isError: block.isError === true,
      })
    }
  }
  return blocks
}

/** Whether a persisted/live DSH event should appear as a user message. */
function isUserVisibleMessage(data) {
  return data?.source?.kind === 'user'
}

function messageItem({ itemId, role, content, createdAt }) {
  return {
    kind: 'message',
    itemId,
    parentId: null,
    createdAt,
    role,
    content: toContractBlocks(content),
  }
}

/**
 * 子 Agent transcript 是扁平的 `{id, role, ts, text}` 列表，直接从会话读模型换算，
 * 复用同一套过滤（runtime-context 注入不算用户消息）。
 */
function transcriptMessages(items) {
  const messages = []
  for (const item of items) {
    if (item.kind !== 'message') continue
    if (item.role !== 'user' && item.role !== 'assistant') continue
    const text = (item.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
    if (!text) continue
    messages.push({
      id: item.itemId,
      role: item.role,
      ts: Date.parse(item.createdAt) || Date.now(),
      text,
    })
  }
  return messages
}

/**
 * Fold one DSH event into contract conversation items.
 * Returns `{ items, title }`; the caller decides how to merge.
 */
function projectEvent(state, sessionId, event) {
  const data = event?.data ?? {}
  const items = []
  switch (event?.type) {
    case 'user/message': {
      if (!isUserVisibleMessage(data)) break
      const blocks = toContractBlocks(data.content)
      if (blocks.length === 0) break
      items.push(messageItem({
        itemId: data.id ?? `user-${event.seq ?? items.length}`,
        role: 'user',
        content: data.content,
        createdAt: isoFromEpoch(event.time),
      }))
      break
    }
    case 'assistant/message': {
      const message = data.message ?? {}
      const blocks = toContractBlocks(message.content)
      const messageId = message.id ?? `assistant-${event.seq ?? 0}`
      if (blocks.length > 0) {
        items.push(messageItem({
          itemId: messageId,
          role: 'assistant',
          content: message.content,
          createdAt: isoFromEpoch(event.time),
        }))
      }
      state.lastAssistantMessageId = messageId
      state.lastTurnId = `turn-${data.turn ?? 0}`
      break
    }
    case 'tool/call': {
      state.callOwner.set(data.callId, {
        messageId: state.lastAssistantMessageId,
        turnId: `turn-${data.turn ?? 0}`,
      })
      break
    }
    case 'tool/result': {
      const callId = data.message?.toolCallId
      const owner = state.callOwner.get(callId)
      const result = {
        kind: 'message',
        itemId: `tool-${callId}`,
        parentId: null,
        createdAt: isoFromEpoch(event.time),
        role: 'assistant',
        content: [{
          type: 'toolResult',
          toolCallId: callId,
          ...(data.message?.toolName ? { toolName: data.message.toolName } : {}),
          output: textOfContent(data.message?.content),
          isError: data.message?.isError === true,
        }],
      }
      items.push(result)
      if (owner) state.callOwner.delete(callId)
      break
    }
    case 'session/title': {
      state.titles.set(sessionId, data.title ?? data.text ?? '')
      break
    }
    case 'command/done': {
      if (data.text) {
        items.push({
          kind: 'message',
          itemId: `command-${data.commandId ?? event.seq ?? 0}`,
          parentId: null,
          createdAt: isoFromEpoch(event.time),
          role: 'system',
          content: [{ type: 'text', text: String(data.text) }],
        })
      }
      break
    }
    default:
      break
  }
  return items
}

/** Build a transcript page from the persisted session log. */
/** 映射 workspace-files 的读模型到 contract 的 WorkspaceFileInfo。 */
function workspaceFileInfo(workspaceId, info) {
  const name = info.name || String(info.path ?? '').split('/').pop() || String(info.path ?? '')
  return {
    ...info,
    workspaceId,
    path: info.path,
    id: `${workspaceId}:${info.path}`,
    name,
    mime: info.mime ?? 'text/plain',
    size: info.size ?? 0,
    // workspace-files 用内容哈希作版本；旧 system 文件服务使用 mtime:size。
    version: info.version ?? `${Math.round(info.mtimeMs ?? Date.now())}:${info.size ?? 0}`,
    writable: info.writable !== false,
  }
}

async function readPage(sessionId, limit = 50) {
  const events = await readSessionEvents(sessionId)
  const state = { lastAssistantMessageId: null, lastTurnId: null, callOwner: new Map(), titles: new Map() }
  const items = []
  for (const event of events) {
    if (!event || typeof event !== 'object') continue
    if (event.type === 'session') continue
    items.push(...projectEvent(state, sessionId, event))
  }
  const size = Math.max(1, Math.min(Number(limit) || 50, 100))
  const sliced = items.length > size ? items.slice(-size) : items
  return {
    runtimeEpoch: 1,
    sessionId,
    branchLeafId: null,
    items: sliced,
    headCursor: `head:${items.length}`,
    hasMoreBefore: items.length > sliced.length,
  }
}

/**
 * 运行时客观没有的能力：统一在这里给出中文原因。
 * 查询抛 CAPABILITY_UNAVAILABLE，命令回失败回执——不允许再“静默成功”。
 */
const UNAVAILABLE_REASONS = {
  // —— 面板级：DSH SDK 没有对应接口 ——
  'timeTravel.timeline.read': '时间旅行依赖 OMP 的会话快照，DSH SDK 不提供快照列表',
  'timeTravel.settings.get': '时间旅行依赖 OMP 的会话快照，DSH SDK 没有对应设置',
  'timeTravel.storage.get': '时间旅行依赖 OMP 的快照存储，DSH SDK 没有对应存储',
  'timeTravel.settings.set': '时间旅行依赖 OMP 的会话快照，DSH SDK 没有对应设置',
  'timeTravel.cleanup': '时间旅行依赖 OMP 的会话快照，DSH SDK 没有对应存储',
  'timeTravel.restore': '时间旅行依赖 OMP 的会话快照，DSH SDK 无法回滚工作区',
  'live.webrtc.connect': '实时语音依赖 OMP 的 WebRTC 网关，DSH SDK 没有对应服务',
  'live.webrtc.mute': '实时语音依赖 OMP 的 WebRTC 网关，DSH SDK 没有对应服务',
  'live.webrtc.release': '实时语音依赖 OMP 的 WebRTC 网关，DSH SDK 没有对应服务',
  'live.webrtc.status': '实时语音依赖 OMP 的 WebRTC 网关，DSH SDK 没有对应服务',
  'prediction.query': '输入预测依赖 OMP 的本地预测引擎，DSH SDK 没有对应接口',
  'prediction.prepare': '输入预测依赖 OMP 的本地预测引擎，DSH SDK 没有对应接口',
  'prediction.release': '输入预测依赖 OMP 的本地预测引擎，DSH SDK 没有对应接口',
  'github.auth.get': 'GitHub 面板依赖 gh 登录态与 OMP 的 GitHub 服务，当前未接入',
  'github.execute': 'GitHub 面板依赖 gh 登录态与 OMP 的 GitHub 服务，当前未接入',
  'artifacts.list': '产物面板依赖 OMP 的 artifact 服务，DSH 没有对应存储',
  'artifacts.text.read': '产物面板依赖 OMP 的 artifact 服务，DSH 没有对应存储',
  'artifacts.delete': '产物面板依赖 OMP 的 artifact 服务，DSH 没有对应存储',
  'artifacts.saveText': '产物面板依赖 OMP 的 artifact 服务，DSH 没有对应存储',
  'resources.list': '资源面板依赖 OMP 的资源服务，DSH 没有对应存储',
  'resource.read': '资源读取依赖 OMP 的资源服务，DSH 没有对应存储',
  'resource.local.ensureDir': '资源面板依赖 OMP 的资源服务，DSH 没有对应存储',
  'resource.local.list': '资源面板依赖 OMP 的资源服务，DSH 没有对应存储',
  'resource.local.open': '资源面板依赖 OMP 的资源服务，DSH 没有对应存储',
  'resource.local.save': '资源面板依赖 OMP 的资源服务，DSH 没有对应存储',
  'extensions.links.list': '扩展链接清单由 OMP 的扩展体系提供，DSH 没有对应接口',
  'context.view.list': '上下文查看器依赖 OMP 的上下文分片接口，DSH SDK 未暴露',
  'context.view.entry': '上下文查看器依赖 OMP 的上下文分片接口，DSH SDK 未暴露',
  'context.view.release': '上下文查看器依赖 OMP 的上下文分片接口，DSH SDK 未暴露',
  'session.lease.read': '会话租约是 OMP 的并发控制概念，DSH 没有对应接口',
  'session.cache.get': '会话缓存统计由 OMP 运行时提供，DSH 没有对应接口',
  'session.fork': 'DSH SDK 不支持会话分叉',
  'session.queue.list': 'DSH SDK 没有可读取的运行时消息队列；界面本地待发送队列不等于运行时队列',
  'session.skills.list': 'DSH SDK 不提供会话运行时技能身份查询；磁盘发现的技能不等于已加载或已加入当前会话',
  'core.steer': 'DSH SDK 没有运行中插话接口；当前操作未执行，输入仍保留在本地',
  'session.handoff': 'DSH SDK 不支持会话交接',
  'session.restore.inspect': 'DSH SDK 不支持恢复前检查',
  'shell.view.read': '终端视图快照由 OMP 的 shell 服务提供，桌面端用原生 PTY 面板代替',
  'shell.view.release': '终端视图快照由 OMP 的 shell 服务提供，桌面端用原生 PTY 面板代替',
  'agent.messages.list': '子 Agent 消息列表走 DSH 的事件投影，不提供独立分页接口',
  'agent.spawn.options.read': 'DSH SDK 不提供子 Agent 可选类型清单',
  'agent.kill': 'DSH SDK 不支持按子 Agent 终止',
  'agent.revive': 'DSH SDK 不支持重新唤起子 Agent',
  'agent.send': 'DSH SDK 不支持直接给子 Agent 发消息',
  'advisors.config.get': '顾问配置是 OMP 的能力，DSH 没有对应插件',
  'benchmarks.accounts.read': '基准测试账号是 OMP 的内部能力，DSH 没有对应接口',
  'mcp.logs.get': 'MCP 管理器只在 web profile 挂载，sdk profile 没有对应日志',
  'mcp.refresh': 'MCP 管理器只在 web profile 挂载，sdk profile 没有可刷新的服务器',
  'mcp.setEnabled': 'MCP 管理器只在 web profile 挂载，sdk profile 无法修改 MCP 配置',
  'mcp.setInstructions': 'MCP 管理器只在 web profile 挂载，sdk profile 无法修改 MCP 配置',
  'mcp.test': 'MCP 管理器只在 web profile 挂载，sdk profile 无法测试服务器',
  'plugins.setEnabled': '插件清单由 DSH profile 管理（dsh plugin --profile sdk），界面暂不支持启停',
  'skills.setEnabled': 'DSH 技能是否进入会话由 tool-skill 决定，界面暂不支持启停',
  'models.auth.login': 'DSH 的模型凭证是 API Key 文件，不支持浏览器登录流程',
  'models.auth.cancel': 'DSH 没有进行中的登录流程可取消',
  'models.auth.unpause': 'DSH 没有账号暂停状态可恢复',
  'models.accounts.resetPolicy.set': 'DSH 没有账号额度重置策略',
  'models.webSearch.set': '联网搜索由 DSH profile 的插件决定，界面暂不支持修改',
  'models.provider.probe': '自定义模型服务商是 OMP 的能力，DSH 只读取启动参数里的 provider/model',
  'models.provider.test': '自定义模型服务商是 OMP 的能力，DSH 只读取启动参数里的 provider/model',
  'models.catalog.refresh': '模型目录由 DSH 的 llm-deepseek 插件维护，界面暂不支持刷新',
  'jobs.inspect': '作业检查依赖 OMP 的作业系统，DSH 没有对应接口',
  'maintenance.compression.auto.status': '自动压缩策略由 OMP 的维护服务提供，DSH 没有对应接口',
  'mode.plan.review.details': '计划评审详情依赖 OMP 的计划服务；DSH 请直接发送 /plan 命令',
  'mode.plan.review.saveAndQuit': '计划评审依赖 OMP 的计划服务；DSH 请直接发送 /plan 命令',
  'operator.invoke': 'operator 调用是 OMP 的调试入口，DSH 没有对应接口',
  'preferences.features.set': '功能开关是 OMP 的偏好体系，DSH 没有对应设置',
  'runtime.ensure': 'DSH 运行时由桌面端启动并托管，不需要安装流程',
  'runtime.install': 'DSH 运行时由桌面端启动并托管，不需要安装流程',
  'runtime.settings.get': '运行时设置由 DSH profile 决定，界面暂不支持修改',
  'runtime.settings.set': '运行时设置由 DSH profile 决定，界面暂不支持修改',
  'usage.openDashboard': '用量面板依赖 OMP 的本地统计库，DSH 没有对应数据',
  'worktrees.session.resume.prepare': 'DSH SDK 没有 worktree 会话恢复流程',
  'accounts.logout': '账号登出属于 OMP 的账号体系，DSH 用凭证文件管理模型密钥',
  // —— 剩余入口逐个定性，避免落到兜底文案 ——
  'artifacts.storage.get': '产物库是 OMP 的存储概念，DSH 用工作区文件代替',
  'context.view.open': '上下文查看器依赖 OMP 的上下文分片接口，DSH SDK 未暴露',
  'github.discussion.list': 'GitHub 面板依赖 gh 登录态与 OMP 的 GitHub 服务，当前未接入',
  'github.items.get': 'GitHub 面板依赖 gh 登录态与 OMP 的 GitHub 服务，当前未接入',
  'github.items.list': 'GitHub 面板依赖 gh 登录态与 OMP 的 GitHub 服务，当前未接入',
  'github.pr.diff': 'GitHub 面板依赖 gh 登录态与 OMP 的 GitHub 服务，当前未接入',
  'github.pr.files': 'GitHub 面板依赖 gh 登录态与 OMP 的 GitHub 服务，当前未接入',
  'github.repositories.list': 'GitHub 面板依赖 gh 登录态与 OMP 的 GitHub 服务，当前未接入',
  'history.prompts.list': '提示词库是 OMP 的本地存储，DSH 没有对应的提示词历史',
  'history.prompts.read': '提示词库是 OMP 的本地存储，DSH 没有对应的提示词历史',
  'interaction.form.read': 'DSH 的提问由运行时通过 user-question/ask 推送，没有可单独读取的表单',
  'models.antigravity.readiness': 'Antigravity 是 OMP 的供应商集成，DSH 没有对应能力',
  'models.systemTemplates.file.read': '系统模板是 OMP 的配置概念，DSH 用 profile 的 cordis 配置表达',
  'models.systemTemplates.inspect': '系统模板是 OMP 的配置概念，DSH 用 profile 的 cordis 配置表达',
  'models.systemTemplates.list': '系统模板是 OMP 的配置概念，DSH 用 profile 的 cordis 配置表达',
  'models.systemTemplates.binding.set': '系统模板是 OMP 的配置概念，DSH 用 profile 的 cordis 配置表达',
  'models.systemTemplates.file.write': '系统模板是 OMP 的配置概念，DSH 用 profile 的 cordis 配置表达',
  'timeTravel.restore.preview': '时间旅行依赖 OMP 的会话快照，DSH SDK 不提供快照预览',
  'advisors.config.save': '顾问配置是 OMP 的能力，DSH 没有对应插件',
  'agent.model.inspect': 'DSH 的子 Agent 与主会话共用模型路由，没有独立模型可查',
  'core.continue': 'DSH 没有“继续生成”语义；直接在输入框补充要求即可',
  'extensions.links.activate': '扩展体系是 OMP 的能力，DSH 用 profile 插件树表达',
  'history.prompts.delete': '提示词库是 OMP 的本地存储，DSH 没有对应的提示词历史',
  'job.cancel': 'DSH 的后台作业由工具内部管理，SDK 没有取消接口',
  'models.provider.roster.refresh': '供应商清单由 DSH 的 profile 决定，没有可刷新的名录',
  'prediction.control': '输入预测依赖 OMP 的本地预测引擎，DSH SDK 没有对应接口',
  'turn.retry': 'DSH 没有单轮重试接口；重新发送同一条消息即可',
  'workspace.openPath': '当前工作区在运行时启动时固定，暂不支持按路径切换',
  'worktrees.session.resume.list': 'DSH SDK 没有 worktree 会话恢复流程',
}

/**
 * E-05：没有真实适配器、权限与费用确认的外部能力。
 * 查询与命令都在进入任何 Runtime / 文件 / 网络分支前拒绝，不能回退为普通 prompt。
 */
const EXTERNAL_CAPABILITY_GROUPS = {
  dictation: [
    'dictation.inspect',
    'dictation.open',
    'dictation.status',
    'dictation.prepare',
    'dictation.start',
    'dictation.stop',
    'dictation.cancel',
  ],
  evaluations: [
    'evaluations.exportChunk',
    'evaluations.retrySpec',
    'evaluations.patch',
    'evaluations.context',
    'evaluations.list',
    'evaluations.read',
    'evaluations.rows',
    'evaluations.openWorkspace',
    'evaluations.prepare',
    'evaluations.start',
    'evaluations.control',
    'evaluations.export',
    'evaluations.respond',
  ],
  benchmarks: [
    'benchmarks.accounts.read',
    'benchmarks.list',
    'benchmarks.start',
    'benchmarks.read',
    'benchmarks.cancel',
    'benchmarks.close',
  ],
  mcp: [
    'mcp.logs.get',
    'mcp.refresh',
    'mcp.setEnabled',
    'mcp.setInstructions',
    'mcp.test',
  ],
  agent: ['agent.send', 'agent.kill', 'agent.revive'],
}
const EXTERNAL_CAPABILITIES = new Set(Object.values(EXTERNAL_CAPABILITY_GROUPS).flat())

function externalUnavailableReason(name) {
  if (name.startsWith('dictation.')) {
    return '云听写需要真实 Desktop 音频采集、ASR 适配器及用户对云端处理/模型下载/费用的明确同意；当前未接入，未录音或发起识别'
  }
  if (name.startsWith('evaluations.') || name.startsWith('benchmarks.')) {
    return '评测与基准测试需要真实 judge、评分集、运行器和 provider 调用链；当前未接入，不执行、不计费、不返回模拟分数'
  }
  if (name.startsWith('mcp.')) {
    return 'MCP 运行时控制需要已授权的真实客户端适配器；当前只读 profile 配置，不刷新、不启停、不测试、不读取运行时日志'
  }
  if (name.startsWith('agent.')) {
    return 'DSH SDK 不提供子 Agent send/kill/revive 控制；当前只投影真实派生事件，不发送控制指令'
  }
  return null
}

/** 统一的兜底文案，带上接口名便于定位。 */
function unavailableReasonFor(name) {
  return externalUnavailableReason(name) ?? UNAVAILABLE_REASONS[name] ?? `当前运行时（dsh --profile sdk）没有提供该能力：${name}`
}

/** 之前被当成“空成功”的会话类命令，这里给出可操作的中文说明。 */
const COMMAND_REASONS = {
  'session.model.set': 'DSH SDK 不支持在会话内切换模型；请用启动参数 DSH_MODEL 指定后重启',
  'session.thinking.set': 'DSH SDK 不支持在会话内切换思考强度',
  'session.speed.set': 'DSH 运行时没有速度档位设置',
  'session.tier.set': 'DSH 运行时没有服务档位设置',
  'session.drop': 'DSH SDK 没有按会话丢弃接口；关闭标签只是隐藏，不会删除历史',
  'session.archive': 'DSH SDK 没有会话归档接口',
  'session.unarchive': 'DSH SDK 没有会话归档接口',
  'session.clearContext': 'DSH 用内置命令 /compact 压缩上下文，没有单独的清空接口',
  'session.history.rename': 'DSH 的会话标题由运行时生成，暂不支持重命名',
  'session.history.pin': 'DSH 没有会话置顶',
  'session.titles.inspect': 'DSH 没有批量标题检查接口',
  'session.queue.ack': 'DSH 没有消息队列确认接口',
  'session.queue.takeback': 'DSH 没有消息队列撤回接口',
  'mode.plan.enter': 'DSH 的计划模式是内置命令，请直接在输入框发送 /plan',
  'mode.plan.exit': 'DSH 的计划模式是内置命令，请直接在输入框发送 /plan off',
  'mode.plan.review.respond': 'DSH 的计划评审走 /plan 命令，没有独立评审回执',
  'permissions.mode.set': 'DSH 的权限模式用内置命令调整，请发送 /permission',
  'approvals.forget': 'DSH 没有审批记忆清除接口',
  'runtime.pause': 'DSH SDK 没有暂停接口',
  'runtime.resume': 'DSH SDK 没有恢复接口',
}

function commandUnavailableReason(name) {
  return COMMAND_REASONS[name] ?? unavailableReasonFor(name)
}

/**
 * 模型凭证路由。DSH 只内置 DeepSeek；OpenCode 的 Key 先写入对应引用，
 * 运行时是否真的能路由由 profile 里是否挂载 pi-ai 路由决定（见 Models 页提示）。
 */
const MODEL_AUTH_PROVIDERS = [
  { id: 'deepseek-official', name: 'DeepSeek', ref: 'DEEPSEEK_API_KEY', label: 'DeepSeek API Key' },
  { id: 'opencode-go', name: 'OpenCode Go', ref: 'OPENCODE_GO_API_KEY', label: 'OpenCode Go API Key' },
  { id: 'opencode-zen', name: 'OpenCode Zen', ref: 'OPENCODE_ZEN_API_KEY', label: 'OpenCode Zen API Key' },
]

function modelAuthRoute(providerId) {
  return MODEL_AUTH_PROVIDERS.find((row) => row.id === providerId) ?? null
}

/** 模型凭证读模型（不含密钥本身）。 */
async function modelAuthProviders(sessionId) {
  let refs = []
  let failure
  try {
    refs = await credentialRefNames()
  } catch (error) {
    failure = `凭证文件读取失败：${error.message}`
  }
  return {
    sessionId,
    providers: MODEL_AUTH_PROVIDERS.map((row) => {
      const configured = refs.includes(row.ref)
      return {
        id: row.id,
        name: row.name,
        available: failure === undefined,
        authenticated: configured,
        kind: 'api-key',
        credentials: configured ? [{ id: 1, label: row.label, type: 'api_key' }] : [],
        loginBehavior: 'replace',
        ...(failure === undefined ? {} : { warning: failure }),
      }
    }),
  }
}

/** 从 DSH 凭证文件读出 Key，问一次官方模型列表；结果只缓存在主进程。 */
const catalogCache = { models: null, at: 0 }

async function refreshDeepseekCatalog() {
  const status = { version: 'dsh-0.2.2', upstreamCommit: '', source: 'builtin' }
  let key = null
  try {
    key = await credentialRefValue('DEEPSEEK_API_KEY')
  } catch {
    key = null
  }
  if (!key) {
    return {
      updated: false,
      catalog: status,
      message: '未配置 DeepSeek API Key，仍使用内置目录（deepseek-flash / deepseek-v4-pro）',
    }
  }
  const response = await fetch('https://api.deepseek.com/models', {
    headers: { authorization: `Bearer ${key}` },
  })
  if (!response.ok) throw new Error(`DeepSeek 模型列表返回 HTTP ${response.status}`)
  const payload = await response.json()
  const ids = (payload?.data ?? payload?.models ?? [])
    .map((row) => (typeof row === 'string' ? row : row?.id))
    .filter((id) => typeof id === 'string' && id.length > 0)
  if (ids.length === 0) {
    return { updated: false, catalog: status, message: '官方模型列表为空，保留内置目录' }
  }
  catalogCache.models = ids
  catalogCache.at = Date.now()
  return {
    updated: true,
    catalog: { ...status, source: 'updated' },
    message: `已从官方接口更新 ${ids.length} 个模型`,
  }
}

/** Project configured MCP metadata without claiming a live connection. */
export function mcpServerRecords(mcp = {}) {
  const warnings = [...(mcp.guidance ? [mcp.guidance] : [])]
  const servers = []
  for (const row of mcp.servers ?? []) {
    if (row.transport !== 'stdio' && row.transport !== 'http' && row.transport !== 'sse') {
      warnings.push(`MCP ${row.name}：transport 未知，未推断为 stdio，也未执行连接。`)
      continue
    }
    if (row.reason) warnings.push(`MCP ${row.name}：${row.reason}`)
    const enabled = mcp.clientMounted === true && row.enabled !== false
    servers.push({
      name: row.name,
      transport: row.transport,
      enabled,
      status: enabled ? 'enabled' : 'disabled',
      sourceLabel: '用户',
      scope: 'user',
    })
  }
  return {
    servers,
    warnings: [
      ...warnings,
      ...(servers.length > 0 ? ['MCP enabled/disabled 仅表示 profile 配置状态，不代表已连接或工具已注册。'] : []),
    ],
    ...(mcp.configured === true && servers.length === 0
      ? { unavailableReason: mcp.guidance ?? '发现 MCP 配置，但没有可识别的 transport；未执行连接。' }
      : mcp.configured === true
        ? {}
        : { unavailableReason: mcp.guidance ?? '当前 profile 没有配置 MCP 服务器' }),
  }
}

/** 磁盘技能只投影调用面，不虚构 Runtime loaded/session 事实。 */
export function skillRecords(skills = []) {
  return skills.map((row) => ({
    name: row.name,
    desc: row.description,
    scope: row.scope,
    sourceKind: 'native',
    sourceLabel: row.label,
    enabled: row.userInvocable !== false,
    hide: row.userInvocable === false,
  }))
}

/**
 * Create the bridge. `emit` receives every `ClientEvent` for the window.
 * `limits` is the X4.6 pressure boundary; it is validated here so a bad
 * configuration fails at startup instead of silently running unbounded.
 */
export function createStudioBridge({ runtime, cwd, emit, host = {}, limits = {}, workspaceFiles, gitWorkspace } = {}) {
  const workbenchLimits = createWorkbenchLimits(limits)
  const localDrafts = host.draftStore ? createLocalDraftStore({ store: host.draftStore }) : null
  const authorityEpoch = 1
  const runtimeEpoch = 1
  const workspaceId = workspaceIdFor(cwd)
  let workspaceFilesService = workspaceFiles
  let gitWorkspaceService = gitWorkspace

  /** Lazily bind the filesystem service so a bad root reports on the first file call. */
  function files() {
    if (!workspaceFilesService) {
      workspaceFilesService = createWorkspaceFiles({ root: uncFromWsl(cwd) })
    }
    return workspaceFilesService
  }

  /** Git uses the same native workspace root as Files; tests can inject a fixture. */
  function git() {
    if (!gitWorkspaceService) {
      gitWorkspaceService = createGitWorkspace({ cwd: uncFromWsl(cwd) })
    }
    return gitWorkspaceService
  }
  let stateVersion = 1
  let cursor = 0
  let serverInfo = null
  /**
   * 每个对话窗口一个上下文。contextId 只隔离“当前会话”与事件投递，
   * 运行时进程、会话状态和磁盘历史仍然共享。
   */
  const ROOT_CONTEXT = 'root'
  const contexts = new Map()
  let contextSeq = 0

  // X4.3: one owner-scoped registry for workbench toolsets and instances.
  const WORKBENCH_HOST_ID = 'dsh-desktop'
  const WORKBENCH_WINDOW_ID = 'studio-main'
  const WORKBENCH_AUDIT_LIMIT = 100
  let workbenchRegistry = createWorkbenchRegistry()
  let workbenchInstanceSeq = 0
  const workbenchAudit = new Map()

  function contextOf(contextId) {
    const id = contextId ?? ROOT_CONTEXT
    let context = contexts.get(id)
    if (!context) {
      context = { currentSessionId: null, epoch: 0 }
      contexts.set(id, context)
    }
    return context
  }

  function contextsForSession(sessionId) {
    const owners = []
    for (const [contextId, context] of contexts) {
      if (context.currentSessionId === sessionId) owners.push(contextId)
    }
    return owners
  }

  function workbenchCapabilities() {
    return createToolCapabilitySnapshot({
      source: 'host',
      revision: `dsh-tools-${runtimeEpoch}-v1`,
      observedAt: new Date().toISOString(),
      tools: WORKBENCH_TOOL_CAPABILITIES,
    })
  }

  function workbenchOwner(sessionId) {
    return {
      kind: 'session',
      id: sessionId,
      hostId: WORKBENCH_HOST_ID,
      windowId: WORKBENCH_WINDOW_ID,
    }
  }

  /**
   * A context may only manage the session it currently owns. The workbench
   * registry itself is session-scoped so two views of the same session share
   * one toolset and one instance set.
   */
  function workbenchSession(input, context) {
    const sessionId = input?.sessionId ?? context.currentSessionId
    if (!sessionId) throw clientError('INVALID_ARGUMENT', 'no session selected')
    if (context.currentSessionId !== sessionId) {
      throw clientError('PERMISSION_DENIED', 'context does not own this workbench session')
    }
    return sessionId
  }

  function ensureWorkbenchWorkspace(sessionId) {
    const owner = workbenchOwner(sessionId)
    let workspace = getConversationWorkspace(workbenchRegistry, owner)
    if (!workspace) {
      workbenchRegistry = putConversationWorkspace(workbenchRegistry, {
        owner,
        document: {
          draftId: `draft:${sessionId}`,
          contentBlocks: [],
          revision: 0,
          queueLocal: [],
        },
        toolset: [],
        runtimeCapabilities: workbenchCapabilities(),
      })
      workspace = getConversationWorkspace(workbenchRegistry, owner)
    }
    if (!workspace) throw clientError('INTERNAL', 'workbench workspace 初始化失败')
    return { owner, workspace }
  }

  function workbenchAuditFor(sessionId) {
    return (workbenchAudit.get(sessionId) ?? []).map((entry) => structuredClone(entry))
  }

  function recordWorkbenchAudit(sessionId, action, detail = {}) {
    const rows = workbenchAudit.get(sessionId) ?? []
    rows.push({
      action,
      sessionId,
      revision: workbenchRegistry.revision,
      at: new Date().toISOString(),
      ...detail,
    })
    if (rows.length > WORKBENCH_AUDIT_LIMIT) rows.splice(0, rows.length - WORKBENCH_AUDIT_LIMIT)
    workbenchAudit.set(sessionId, rows)
  }

  function emitWorkbenchChange(sessionId, change) {
    for (const ownerContextId of contextsForSession(sessionId)) {
      emitEvent({
        kind: 'workbench.toolset.changed',
        sessionId,
        revision: workbenchRegistry.revision,
        ...change,
      }, ownerContextId)
    }
  }

  function workbenchCapacity(sessionId) {
    const open = Object.values(workbenchRegistry.toolInstances)
      .filter((instance) => instance.state !== 'closed')
    const sessionOpen = open.filter(
      (instance) => instance.owner?.kind === 'session' && instance.owner.id === sessionId,
    )
    const terminalUsed = open.filter((instance) => instance.toolId === 'terminal').length
    const browserUsed = open.filter((instance) => instance.toolId === 'browser').length
    const eventQueueUsed = eventRouter.snapshot(sessionId).pendingSequences.length
    const capacity = {
      toolInstances: {
        used: sessionOpen.length,
        limit: workbenchLimits.maxToolInstancesPerSession,
        perToolLimit: workbenchLimits.maxInstancesPerTool,
      },
      terminalInstances: { used: terminalUsed, limit: workbenchLimits.maxTerminalInstances },
      browserTabs: { used: browserUsed, limit: workbenchLimits.maxBrowserTabs },
      eventQueue: { used: eventQueueUsed, limit: workbenchLimits.isolationQueueLength },
    }
    return {
      ...capacity,
      overloaded: Object.values(capacity).some((row) => row.used >= row.limit),
    }
  }

  function workbenchReadModel(sessionId) {
    const { workspace } = ensureWorkbenchWorkspace(sessionId)
    const capabilities = workbenchCapabilities()
    const effective = effectiveSessionToolset(capabilities, workspace.toolset)
    const instances = Object.values(workbenchRegistry.toolInstances)
      .filter((instance) => instance.owner?.kind === 'session' && instance.owner.id === sessionId)
      .sort((left, right) => left.instanceId.localeCompare(right.instanceId))
    return {
      schemaVersion: 1,
      sessionId,
      revision: workbenchRegistry.revision,
      capabilityRevision: capabilities.revision,
      capabilities,
      toolset: [...workspace.toolset],
      effectiveToolset: effective.toolset,
      staleToolset: effective.stale,
      instances,
      capacity: workbenchCapacity(sessionId),
      audit: workbenchAuditFor(sessionId),
      observedAt: capabilities.observedAt,
    }
  }

  /**
   * 尚未发出第一条消息的上下文需要一个稳定的会话身份。多个对话窗口若共用
   * 同一个身份，渲染层会把它们当成同一会话串在一起，所以按上下文各给一个。
   */
  function draftSessionId(contextId) {
    if (contextId === undefined) return 'dsh-draft'
    const context = contextOf(contextId)
    if (!context.draftSessionId) context.draftSessionId = `dsh-draft-${contextId}`
    return context.draftSessionId
  }

  function releaseContextLease(contextId) {
    const id = contextId ?? ROOT_CONTEXT
    const context = contexts.get(id)
    if (!context?.currentSessionId || !context.leaseId) return false
    try {
      return eventRouter.releaseOwner(context.currentSessionId, id, {
        leaseId: context.leaseId,
        generation: context.leaseGeneration,
      })
    } catch {
      return false
    }
  }

  function leaseContext(contextId, sessionId) {
    const id = contextId ?? ROOT_CONTEXT
    const context = contextOf(id)
    context.leaseId ??= `lease-${id}`
    context.leaseGeneration ??= 1
    const deliveries = eventRouter.leaseOwner(sessionId, id, context.leaseId, context.leaseGeneration)
    for (const delivery of deliveries) {
      projectSessionEvent({ sessionId, event: runtimeEventFromEnvelope(delivery.event) })
    }
    return deliveries
  }

  function bindContextSession(contextId, sessionId) {
    const id = contextId ?? ROOT_CONTEXT
    const context = contextOf(id)
    if (context.currentSessionId === sessionId) return leaseContext(id, sessionId)
    releaseContextLease(id)
    if (context.currentSessionId !== null) context.epoch += 1
    context.currentSessionId = sessionId
    return leaseContext(id, sessionId)
  }

  function openContext(scope) {
    contextSeq += 1
    const contextId = `ctx-${contextSeq}`
    contexts.set(contextId, { currentSessionId: null, epoch: 0 })
    const sessionId = typeof scope?.sessionId === 'string' ? scope.sessionId : null
    if (sessionId) {
      bindContextSession(contextId, sessionId)
      if (!liveSessionSeq.has(sessionId)) {
        liveSessionSeq.set(sessionId, 0)
        // 预先挂载历史会话，后续 prompt 才有 live session 可写入；
        // 已被本进程持有的情况交给后续 query 的重试逻辑处理。
        runtime.resume(sessionId).catch(() => {})
      }
    }
    return contextId
  }

  function closeContext(contextId) {
    if (contextId !== undefined) {
      releaseContextLease(contextId)
      contexts.delete(contextId)
    }
    cancelOrphanedApprovals()
    return true
  }

  const sessionState = new Map()
  const liveSessionSeq = new Map()
  /** Bounded per-session projection journal used to catch up after a renderer reconnect. */
  const conversationJournal = new Map()
  const CONVERSATION_REPLAY_LIMIT = 512
  const streamingSessions = new Set()
  const activeTurns = new Map()
  const observedNativeBaseline = new Set()
  const reportedEventGaps = new Set()
  const eventRouter = createEventRouter({ replayWindow: workbenchLimits.isolationQueueLength })
  /**
   * 子 Agent 树。DSH 只推生命周期通知（`subagent.started` / `subagent.finished`），
   * 不推子会话的事件流；这里按根会话归组，快照与 `session.agents.list` 都读这一份。
   */
  const subagents = new Map()
  const agentsRevisions = new Map()
  /** 父会话里刚发出、还没等到 `subagent.started` 的 subagent 工具调用（用于取名/任务）。 */
  const pendingSubagentCalls = new Map()
  const approvals = new Map()
  let interactionSeq = 0
  let commandSeq = 0

  function nextCursor() {
    cursor += 1
    return String(cursor)
  }

  function envelope(extra) {
    stateVersion += 1
    return {
      authorityEpoch,
      runtimeEpoch,
      stateVersion,
      cursor: nextCursor(),
      occurredAt: new Date().toISOString(),
      ...extra,
    }
  }

  function stateFor(sessionId) {
    let state = sessionState.get(sessionId)
    if (!state) {
      state = { lastAssistantMessageId: null, lastTurnId: null, callOwner: new Map(), titles: new Map() }
      sessionState.set(sessionId, state)
    }
    return state
  }

  /** 子 Agent 的父可能还是子 Agent，沿父链找到根会话。 */
  function rootSessionOf(sessionId) {
    let current = sessionId
    const seen = new Set()
    while (!seen.has(current)) {
      seen.add(current)
      const record = subagents.get(current)
      if (!record) return current
      current = record.parentSessionId
    }
    return current
  }

  /** 契约里的 Agent 读模型；只有父节点也是子 Agent 时才带 `parentAgentId`。 */
  function agentSnapshotOf(agent) {
    const live = agent.status === 'running' || agent.status === 'starting'
    return {
      agentId: agent.childSessionId,
      generation: 1,
      ...(subagents.has(agent.parentSessionId) ? { parentAgentId: agent.parentSessionId } : {}),
      kind: 'subagent',
      displayName: agent.displayName,
      status: agent.status,
      ...(agent.assignment === undefined ? {} : { assignment: agent.assignment }),
      ...(agent.summary === undefined ? {} : { summary: agent.summary }),
      startedAt: agent.startedAt,
      updatedAt: agent.updatedAt,
      hasLiveSession: live,
      hasTranscript: !live,
      unreadCount: 0,
      activeJobIds: [],
    }
  }

  function agentsForSession(sessionId) {
    if (!sessionId) return []
    return [...subagents.values()]
      .filter((agent) => agent.rootSessionId === sessionId)
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
      .map(agentSnapshotOf)
  }

  function bumpAgentsRevision(sessionId) {
    agentsRevisions.set(sessionId, (agentsRevisions.get(sessionId) ?? 0) + 1)
  }

  // ---- public identity -----------------------------------------------------

  function runtimeConnection() {
    return {
      status: runtime.state === 'ready' ? 'connected' : 'connecting',
      classification: 'managed',
      runtimeId: RUNTIME_ID,
      runtimeEpoch,
      backend: 'rpc-ui',
      ...(serverInfo?.version ? { runtimeVersion: serverInfo.version } : {}),
    }
  }

  function runtimeControlDescriptor() {
    return runtime.controlCapabilities
      ?? serverInfo?.sessionControl
      ?? serverInfo?.capabilities?.sessionControl
      ?? null
  }

  function runtimeControlAvailable(method) {
    return Array.isArray(runtimeControlDescriptor()?.methods) && runtimeControlDescriptor().methods.includes(method)
  }

  function controlGrade(id, fallback) {
    const method = CONTROL_RUNTIME_METHODS[id]
    if (!method) return fallback
    const manifest = createCapabilityManifest(runtimeControlDescriptor())
    const pureId = ({
      'core.steer': 'session.steer',
      'core.abort': 'session.cancel',
      'queue.enqueue': 'session.queue.enqueue',
      'session.queue.cancel': 'session.queue.cancel',
      'session.queue.remove': 'session.queue.cancel',
      'session.draft.get': 'session.draft.save',
      'session.draft.put': 'session.draft.save',
    })[id] ?? id
    const capability = manifest.capabilities[pureId]
    return capability?.grade === 'available' ? 'stable' : fallback
  }

  const capabilities = [
    ['core.prompt', 'stable'],
    ['core.steer', 'unavailable'],
    ['core.followUp', 'limited'],
    ['queue.enqueue', 'unavailable'],
    ['session.queue.list', 'unavailable'],
    ['session.queue.cancel', 'unavailable'],
    ['session.queue.remove', 'unavailable'],
    ['session.draft.get', 'unavailable'],
    ['session.draft.put', 'unavailable'],
    ['core.abort', 'unavailable'],
    ['session.state', 'stable'],
    ['session.history', 'stable'],
    ['session.transcript.read', 'stable'],
    ['conversation.stream', 'limited'],
    ['session.model.set', 'unavailable'],
    ['session.thinking.set', 'unavailable'],
    ['interaction.respond', 'stable'],
    ['workspace.files', 'stable'],
    ['workspace.fileTree', 'stable'],
    ['workspace.file.inspect', 'stable'],
    ['workspace.file.readText', 'stable'],
    ['workspace.file.readChunk', 'stable'],
    ['workspace.paths.resolve', 'stable'],
    ['workspace.file.create', 'stable'],
    ['workspace.directory.create', 'stable'],
    ['workspace.file.writeText', 'stable'],
    ['git.changes', 'stable'],
    // 桌面端真实实现的能力；渲染层据此点亮对应入口。
    ['fs.file.inspect', 'stable'],
    ['fs.file.readText', 'stable'],
    ['fs.file.writeText', 'stable'],
    ['fs.list', 'stable'],
    ['fs.places', 'stable'],
    ['fs.directory.create', 'stable'],
    ['fs.rename', 'stable'],
    ['fs.trash', 'stable'],
    ['workspace.pick', 'limited'],
    ['skills.reveal', 'stable'],
    ['skills.revealRoot', 'stable'],
    ['models.auth.providers.read', 'stable'],
    ['models.auth.key.set', 'stable'],
    ['models.auth.key.remove', 'stable'],
    ['models.catalog.refresh', 'limited'],
    ['models.discovery.refresh', 'limited'],
    // 运行时模型目录可读：读当前 DSH 安装里 llm-deepseek 的内置模型表。
    ['models.available.refresh', 'stable'],
    ['session.compaction.enqueue', 'stable'],
    ['session.skills.list', 'unavailable'],
    // E-05：外部能力没有真实适配器时一律 unavailable，不能由 fixture 点亮。
    ...[...EXTERNAL_CAPABILITIES].map((id) => [id, 'unavailable']),
    // DSH 资产索引：插件 / 内置命令 / 工具 / MCP 都有真实数据源。
    ['capabilities.get', 'stable'],
    ['commands.getManifest', 'stable'],
    ['skills.get', 'stable'],
    ['mcp.get', 'limited'],
    ['runtime.refreshAssets', 'stable'],
  ].map(([id, grade]) => ({ id, grade, version: 1, evidence: 'deepseek-harness' }))

  /**
   * DSH 资产索引：插件树 / 内置命令 / 工具目录 / profile / MCP / 技能根。
   * 首次访问时加载；失败也返回带 reason 的结构，界面据此提示而不是显示成空。
   */
  let assetOverview = null
  let assetPending = null

  function loadAssets({ force = false } = {}) {
    if (assetOverview !== null && !force) return Promise.resolve(assetOverview)
    if (assetPending !== null && !force) return assetPending
    assetPending = readAssetOverview({ forcePlugins: force })
      .then((value) => {
        assetOverview = value
        return value
      })
      .catch((error) => {
        const reason = `DSH 资产索引读取失败：${error.message}`
        // 保留上一份成功快照，避免界面在偶发失败时变空。
        return assetOverview ?? {
          generatedAt: new Date().toISOString(),
          plugins: [],
          pluginSummary: { total: 0, groups: {}, disabled: 0 },
          pluginState: { cached: false, stale: true, reason, fetchedAt: null },
          commands: [],
          tools: [],
          toolGroups: [],
          profile: null,
          mcp: { servers: [], configured: false, clientMounted: false, guidance: reason },
          skillExtras: { customSkillDirs: [], bundledSkillDir: null },
        }
      })
      .finally(() => {
        assetPending = null
      })
    return assetPending
  }

  /** 技能目录扫描有 IO 成本，页面与抽屉同一轮刷新共用一份结果。 */
  const SKILLS_CACHE_MS = 3000
  let skillsCache = { at: 0, result: null }

  /** 磁盘扫描结果（含路径与调用策略），技能页与会话技能列表共用。 */
  async function skillsScan() {
    if (skillsCache.result && Date.now() - skillsCache.at < SKILLS_CACHE_MS) return skillsCache.result
    const assets = await loadAssets()
    const result = await scanSkills(cwd, assets.skillExtras)
    skillsCache = { at: Date.now(), result }
    return result
  }

  /** DSH 插件 → OMP 的 `PluginRecord` 读模型。DSH 插件都是 npm 包，没有 hook/ui 贡献。 */
  function pluginRecords(assets) {
    return assets.plugins.map((row) => {
      const isTool = row.group === 'tool'
      const isCommand = row.group === 'command'
      return {
        name: row.shortName,
        version: serverInfo?.version ?? 'dsh',
        sourceKind: 'npm',
        srcLabel: 'npm',
        enabled: row.disabled !== true,
        status: 'configured',
        tools: isTool ? 1 : 0,
        commands: isCommand ? 1 : 0,
        hooks: 0,
        ui: false,
        toolItems: isTool ? [row.shortName] : [],
        commandItems: isCommand ? [row.shortName] : [],
        hookItems: [],
        uiItems: [],
        ...(row.disabled === 'conditional' ? { err: '按 profile 条件启用（disabled 为表达式）' } : {}),
      }
    })
  }

  /**
   * 技能读模型：扫描 DSH 的文件系统技能根目录（项目 `.dsh/skills`、`.agents/skills`、
   * profile 自定义目录与用户目录），并附带真实的插件与工具清单。
   */
  async function skillsReadModel() {
    try {
      const assets = await loadAssets()
      const { skills, warnings } = await skillsScan()
      return {
        skills: skillRecords(skills),
        plugins: pluginRecords(assets),
        tools: assets.tools,
        pluginSummary: assets.pluginSummary,
        assetState: assets.pluginState,
        profile: assets.profile,
        warnings: [
          ...warnings,
          ...(skills.length > 0
            ? ['技能清单来自磁盘发现；enabled 仅表示允许用户调用，不代表 Runtime 已加载或已加入会话。']
            : []),
          ...(assets.pluginState.reason ? [assets.pluginState.reason] : []),
          ...(assets.pluginSummary.total === 0 && !assets.pluginState.reason
            ? ['未读到任何 DSH 插件：请确认 WSL 里的 dsh CLI 可用']
            : []),
        ],
        generatedAt: new Date().toISOString(),
      }
    } catch (error) {
      return {
        skills: [],
        plugins: [],
        tools: [],
        warnings: [],
        generatedAt: new Date().toISOString(),
        unavailableReason: `技能目录读取失败：${error.message}`,
      }
    }
  }

  /** 能力中心同时读 capabilities 数组和 skills/plugins/tools 清单，合并返回。 */
  async function capabilityReadModel() {
    const model = await skillsReadModel()
    return {
      ...capabilityManifest,
      skills: model.skills,
      plugins: model.plugins,
      tools: model.tools ?? [],
      pluginSummary: model.pluginSummary ?? null,
      assetState: model.assetState ?? null,
      profile: model.profile ?? null,
      warnings: model.warnings,
      generatedAt: model.generatedAt,
      ...(model.unavailableReason === undefined ? {} : { unavailableReason: model.unavailableReason }),
    }
  }

  /**
   * MCP 读模型：服务器条目来自 profile 的 mcp-client 配置。
   * sdk profile 默认没有挂载 dsh-mcp-client，未配置时给出可操作引导而不是归咎于插件缺失。
   */
  async function mcpReadModel() {
    const assets = await loadAssets()
    const mcp = assets.mcp ?? { servers: [], configured: false, clientMounted: false }
    return {
      ...mcpServerRecords(mcp),
      generatedAt: new Date().toISOString(),
    }
  }

  const capabilityManifest = {
    profile: 'limited',
    generatedAt: new Date().toISOString(),
    get hash() {
      return `dsh-capabilities-${runtimeControlDescriptor()?.methods?.join(',') ?? 'legacy'}`
    },
    get capabilities() {
      return capabilities.map((row) => ({ ...row, grade: controlGrade(row.id, row.grade) }))
    },
  }

  function snapshot(sessionIdArg = undefined, contextId = undefined) {
    const sessionId = sessionIdArg ?? contextOf(contextId).currentSessionId ?? draftSessionId(contextId)
    return {
      runtimeId: RUNTIME_ID,
      runtimeEpoch,
      stateVersion,
      sessionId,
      isStreaming: streamingSessions.has(sessionId),
      ...(activeTurns.has(sessionId) ? { activeTurnId: activeTurns.get(sessionId) } : {}),
      eventGap: eventRouter.snapshot(sessionId).gap,
      isCompacting: false,
      activeMode: 'normal',
      approvalMode: 'always-ask',
      pendingMessages: 0,
      activeCommandIds: [],
      agentsRevision: agentsRevisions.get(sessionId) ?? 0,
      jobsRevision: 0,
      agents: agentsForSession(sessionId),
      jobs: [],
    }
  }

  async function bootstrap(contextId) {
    const sessionId = contextOf(contextId).currentSessionId
    return {
      contractVersion: 2,
      authority: { authorityId: AUTHORITY_ID, authorityEpoch },
      runtime: runtimeConnection(),
      surface: { terminalAttach: true, fileReveal: false, previewInput: false, openExternal: true },
      capabilityManifest: await capabilityReadModel(),
      commandManifestHash: 'dsh-commands-v1',
      selected: {
        environmentId: ENVIRONMENT_ID,
        workspaceId,
        ...(sessionId ? { sessionId } : {}),
      },
      snapshot: snapshot(undefined, contextId),
      cursor: String(cursor),
    }
  }

  // ---- read models ---------------------------------------------------------

  async function workspaces() {
    return {
      workspaces: [{
        workspaceId,
        name: workspaceNameFor(cwd),
        root: cwd,
        lastOpenedAt: new Date().toISOString(),
        active: true,
      }],
      activeWorkspaceId: workspaceId,
    }
  }

  async function history(limit = 20) {
    const sessions = await listSessions()
    const entries = sessions.slice(0, Math.max(1, limit)).map((session) => ({
      historyId: session.id,
      threadId: session.id,
      environmentId: ENVIRONMENT_ID,
      sessionId: session.id,
      ...(session.title ? { title: session.title } : {}),
      startedAt: isoFromEpoch(session.createdAt),
      lastActiveAt: isoFromEpoch(session.createdAt),
      messageCount: 0,
      status: 'active',
    }))
    return { entries, total: sessions.length }
  }

  async function gitRepository() {
    const model = await git().repository()
    return {
      workspaceId,
      ...model,
      ...(model.isRepository ? { repositoryId: workspaceId } : {}),
    }
  }

  /** 本地与远程分支，ahead/behind 留给后续实现（当前不强算）。 */
  async function gitBranches() {
    const gitCwd = uncFromWsl(cwd)
    const format = '--format=%(refname:short)%x1f%(objectname)%x1f%(HEAD)%x1f%(upstream:short)'
    const [local, remote] = await Promise.all([
      execFileAsync(GIT, ['branch', format], { cwd: gitCwd, maxBuffer: 8 * 1024 * 1024 }).catch(() => ({ stdout: '' })),
      execFileAsync(GIT, ['branch', '-r', format], { cwd: gitCwd, maxBuffer: 8 * 1024 * 1024 }).catch(() => ({ stdout: '' })),
    ])
    const parse = (text, isRemote) => text.split('\n').filter(Boolean).map((row) => {
      const [name, headOid, head, upstream] = row.split('\x1f')
      return {
        name,
        remote: isRemote,
        current: head === '*',
        headOid,
        ...(upstream ? { upstream } : {}),
        ahead: 0,
        behind: 0,
      }
    })
    return [...parse(local.stdout, false), ...parse(remote.stdout, true)]
  }

  /** `git remote -v` 的分组结果。 */
  async function gitRemotes() {
    const { stdout } = await execFileAsync(GIT, ['remote', '-v'], { cwd: uncFromWsl(cwd), maxBuffer: 1024 * 1024 }).catch(() => ({ stdout: '' }))
    const byName = new Map()
    for (const line of stdout.split('\n')) {
      const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line.trim())
      if (!match) continue
      const [, name, url, kind] = match
      const row = byName.get(name) ?? { name, fetchUrl: '', pushUrl: '' }
      if (kind === 'fetch') row.fetchUrl = url
      else row.pushUrl = url
      byName.set(name, row)
    }
    return [...byName.values()]
  }

  /**
   * 把本地化命令名换成运行时认识的英文名：`/计划 xxx` → `/plan xxx`。
   * DSH 的 commands registry 本身也认中文 token，但统一成英文后，
   * 前端的本地回显与运行时的命令识别不会出现两套名字。
   */
  async function normalizeCommandText(text) {
    const value = String(text ?? '')
    if (!value.startsWith('/')) return value
    const assets = await loadAssets()
    for (const row of assets.commands) {
      for (const token of [row.tokens?.zh, row.tokens?.en]) {
        if (!token || token === row.name) continue
        if (value === `/${token}` || value.startsWith(`/${token} `)) {
          return `/${row.name}${value.slice(token.length + 1)}`
        }
      }
    }
    return value
  }

  async function sendToSession(sessionId, text) {
    const payload = await normalizeCommandText(text)
    if (!liveSessionSeq.has(sessionId)) liveSessionSeq.set(sessionId, 0)
    try {
      await runtime.query(sessionId, payload)
    } catch (error) {
      if (!/already exists/i.test(String(error?.message ?? ''))) throw error
      try {
        await runtime.resume(sessionId)
      } catch (resumeError) {
        if (!/already owned/i.test(String(resumeError?.message ?? ''))) throw resumeError
      }
      await runtime.query(sessionId, payload)
    }
  }

  /**
 * Translate a path inside the runtime workspace to its relative form so path
 * classification uses the same root-checked service as reads and writes.
 */
  function workspaceRelativePath(value) {
    const text = String(value ?? '').replaceAll('\\', '/')
    const root = cwd.replace(/\/$/, '')
    if (text === root) return ''
    if (text.startsWith(`${root}/`)) return text.slice(root.length + 1)
    let windowsRoot
    try {
      windowsRoot = uncFromWsl(cwd).replaceAll('/', '\\').replace(/\\+$/, '')
    } catch {
      return null
    }
    const windowsText = text.replaceAll('/', '\\')
    if (windowsText.toLowerCase() === windowsRoot.toLowerCase()) return ''
    if (windowsText.toLowerCase().startsWith(`${windowsRoot.toLowerCase()}\\`)) {
      return windowsText.slice(windowsRoot.length + 1).replaceAll('\\', '/')
    }
    return null
  }

  async function classifyPath(value) {
    const text = String(value ?? '')
    if (!text) return 'missing'
    const relative = workspaceRelativePath(text)
    if (relative !== null) {
      try {
        return await files().kind(relative)
      } catch {
        return 'missing'
      }
    }
    if (/^(?:[A-Za-z]:[\\/]|[\\/]|~(?:[\\/]|$)|file:)/.test(text)) {
      try {
        const info = await stat(toSystemPath(text))
        return info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'missing'
      } catch {
        return 'missing'
      }
    }
    try {
      return await files().kind(text)
    } catch {
      return 'missing'
    }
  }

  async function resolveWorkspacePaths(input) {
    const paths = Array.isArray(input?.paths) ? input.paths : []
    const resolutions = []
    for (const path of paths) {
      resolutions.push({ path, kind: await classifyPath(path) })
    }
    return { resolutions }
  }

  async function query(name, input, contextId) {
    const context = contextOf(contextId)
    if (EXTERNAL_CAPABILITIES.has(name)) {
      throw clientError('CAPABILITY_UNAVAILABLE', unavailableReasonFor(name))
    }
    switch (name) {
      case 'projects.list':
        return workspaces()
      case 'history.list':
        return history(input?.limit)
      case 'history.locate':
        return []
      case 'capabilities.get':
        // 能力中心读的是 skills/plugins 清单；bootstrap 也走同一读模型。
        return capabilityReadModel()
      case 'commands.getManifest': {
        // DSH 的 first-party 命令（goal / plan / feedback / compact / permission / export）。
        // 清单只用于展示与补全；执行仍由运行时自己的 commands registry 处理。
        const assets = await loadAssets()
        const commands = assets.commands.map((row) => ({
          id: row.definitionId,
          name: row.name,
          aliases: row.tokens.zh && row.tokens.zh !== row.name ? [row.tokens.zh] : [],
          description: row.desc || `DSH 内置命令 ${row.name}`,
          source: 'builtin',
          implementation: 'shared-service',
          interactionKinds: ['input'],
          presentation: 'generic-form',
          availability: row.available === false ? 'disabled' : 'available',
          risk: row.name === 'permission' ? 'sensitive' : 'normal',
          effect: row.name === 'export' ? 'workspace' : 'session',
          contractTestId: `dsh.command.${row.name}`,
        }))
        return {
          generatedAt: new Date().toISOString(),
          upstreamCommit: serverInfo?.version ?? 'dsh',
          hash: `dsh-commands-${commands.length}`,
          commands,
          unclassifiedBuiltins: [],
        }
      }
      case 'environment.get':
        return {
          platform: process.platform,
          arch: process.arch,
          authority: { authorityId: AUTHORITY_ID, authorityEpoch },
          runtime: runtimeConnection(),
          installer: { status: 'installed', signature: 'unknown', ...(serverInfo?.version ? { version: serverInfo.version } : {}) },
        }
      case 'home.get':
        return {
          authority: { authorityId: AUTHORITY_ID, authorityEpoch },
          runtime: runtimeConnection(),
          snapshot: snapshot(undefined, contextId),
          recentThreads: (await history(5)).entries.map((entry) => ({
            threadId: entry.threadId,
            ...(entry.title ? { title: entry.title } : {}),
            lastActiveAt: entry.lastActiveAt,
          })),
          recentWorkspaces: (await workspaces()).workspaces,
        }
      case 'diagnostics.get':
        return {
          generatedAt: new Date().toISOString(),
          authority: { authorityId: AUTHORITY_ID, authorityEpoch },
          entries: [],
          redacted: true,
        }
      case 'session.state':
        return snapshot(undefined, contextId)
      case 'residents.list':
        return {
          residents: context.currentSessionId
            ? [{
                sessionId: context.currentSessionId,
                workspaceId,
                phase: 'idle',
                pendingMessages: 0,
                lastActivityAt: new Date().toISOString(),
              }]
            : [],
          ...(context.currentSessionId ? { activeSessionId: context.currentSessionId } : {}),
          generatedAt: new Date().toISOString(),
        }
      case 'models.get':
        return await modelConfig()
      case 'usage.get':
        return {
          generatedAt: new Date().toISOString(),
          days: [],
          models: [],
          byModel: [],
          hours: [],
        }
      case 'conversation.open': {
        const contextEpoch = context.epoch
        const target = input?.target
        if (target?.kind !== 'session') throw clientError('UNAVAILABLE', 'Agent conversations are not bridged yet')
        // 打开历史会话时把运行时挂载回来，否则后续 prompt 没有 live session 可写入。
        if (target.sessionId !== context.currentSessionId) {
          try {
            await runtime.resume(target.sessionId)
            assertContextEpoch(contextId, contextEpoch)
          } catch (error) {
            if (error.code === 'FAILED_PRECONDITION') throw error
            throw clientError('UNAVAILABLE', `会话恢复失败：${error.message}`)
          }
          bindContextSession(contextId, target.sessionId)
          cancelOrphanedApprovals()
        }
        const afterStreamSeq = Number.isSafeInteger(input?.afterStreamSeq) && input.afterStreamSeq >= 0
          ? input.afterStreamSeq
          : null
        // Capture the projection watermark before awaiting disk I/O. Events
        // emitted during the read stay above this watermark for the live stream;
        // advancing it afterwards could skip events absent from the page snapshot.
        const watermark = liveSessionSeq.get(target.sessionId) ?? 0
        const page = await readPage(target.sessionId, input?.limit)
        const replayAfter = afterStreamSeq ?? watermark
        return {
          target: { kind: 'session', sessionId: target.sessionId, conversationSessionId: target.sessionId },
          page,
          // 初次打开由 transcript page 提供完整历史；重连/补洞只返回水位之后的投影事件。
          // 若事件已超出有界 journal，客户端会看到首个 streamSeq 不连续并回退到整页重同步。
          live: {
            status: 'complete',
            watermark,
            events: (conversationJournal.get(target.sessionId) ?? [])
              .filter((event) => event.streamSeq > replayAfter && event.streamSeq <= watermark),
          },
        }
      }
      case 'interaction.list': {
        // A context newly mounted for an already-running session must be able to
        // recover pending cards. Listing also grants it ownership: it is bound to
        // the same session, so it may answer exactly like the original views.
        const sessionId = context.currentSessionId
        if (!sessionId) return { approvals: [] }
        if (typeof contextId === 'string') {
          for (const approval of approvals.values()) {
            if (approval.sessionId === sessionId) approval.owners.add(contextId)
          }
        }
        return {
          approvals: [...approvals.entries()]
            .filter(([, approval]) => approval.sessionId === sessionId)
            .map(([interactionId, approval]) => approvalCard(interactionId, approval)),
        }
      }
      case 'workbench.toolset.get': {
        const sessionId = workbenchSession(input, context)
        return workbenchReadModel(sessionId)
      }
      case 'session.transcript.readPage': {
        const sessionId = input?.sessionId ?? context.currentSessionId
        if (!sessionId) throw clientError('INVALID_ARGUMENT', 'no session selected')
        if (sessionId !== context.currentSessionId) {
          bindContextSession(contextId, sessionId)
          cancelOrphanedApprovals()
          emitEvent({ kind: 'snapshot', snapshot: snapshot(sessionId) }, contextId)
        }
        const page = await readPage(sessionId, input?.limit)
        return {
          sessionId,
          transcriptRevision: `rev:${page.headCursor}`,
          branchLeafId: null,
          items: page.items,
          headCursor: page.headCursor,
          hasMoreBefore: page.hasMoreBefore,
        }
      }
      case 'session.transcript.read': {
        const sessionId = context.currentSessionId
        if (!sessionId) throw clientError('INVALID_ARGUMENT', 'no session selected')
        return readPage(sessionId, input?.limit)
      }
      case 'session.transcript.prefetch':
        return { status: 'skipped' }
      case 'session.agents.list': {
        const sessionId = input?.sessionId ?? context.currentSessionId
        return { sessionId, agents: agentsForSession(sessionId) }
      }
      case 'agent.transcript.read': {
        const agentId = typeof input?.agentId === 'string' ? input.agentId : ''
        if (!agentId) throw clientError('INVALID_ARGUMENT', 'agentId is required')
        const page = await readPage(agentId, 200)
        const messages = transcriptMessages(page.items)
        return {
          agentId,
          generation: 1,
          cursor: `cursor:${messages.length}`,
          messages,
          eof: true,
        }
      }
      case 'session.runtime.state.read': {
        // 会话的权限预设、沙箱、审批策略、模型、命令历史、用量都只存在于事件流里。
        const sessionId = input?.sessionId ?? context.currentSessionId ?? draftSessionId(contextId)
        return readSessionRuntimeState(sessionId)
      }
      case 'agent.conversation.read': {
        const agentId = typeof input?.agentId === 'string' ? input.agentId : ''
        if (!agentId) throw clientError('INVALID_ARGUMENT', 'agentId is required')
        return readPage(agentId, input?.limit)
      }
      case 'session.telemetry.read':
        return { sessionId: input?.sessionId ?? context.currentSessionId, generatedAt: new Date().toISOString() }
      case 'session.compaction.read':
        return { sessionId: input?.sessionId ?? context.currentSessionId, compactions: [] }
      case 'workspace.fileTree': {
        const nodes = await files().list(input?.path ?? '')
        return { workspaceId, nodes }
      }
      case 'workspace.file.readText': {
        const value = await files().readText(input?.path ?? '')
        return { ...value, file: workspaceFileInfo(workspaceId, value.file) }
      }
      case 'workspace.file.inspect':
        return workspaceFileInfo(workspaceId, await files().inspect(input?.path ?? ''))
      case 'workspace.file.readChunk': {
        const value = await files().readChunk(input?.path ?? '', input ?? {})
        return value
      }
      case 'workspace.paths.resolve':
        return resolveWorkspacePaths(input)
      case 'git.toolchain.get': {
        const toolchain = await git().toolchain()
        return { git: toolchain, githubCli: { available: false, unavailableReason: 'not bridged' } }
      }
      case 'git.repository.get':
        return gitRepository()
      case 'git.repository.summary': {
        const repo = await gitRepository()
        return {
          workspaceId,
          isRepository: repo.isRepository,
          ...(repo.repositoryId ? { repositoryId: repo.repositoryId } : {}),
          ...(repo.workspacePrefix ? { workspacePrefix: repo.workspacePrefix } : {}),
          ...(repo.branch ? { branch: repo.branch } : {}),
          ...(repo.headOid ? { headOid: repo.headOid } : {}),
          detached: repo.detached,
          ahead: repo.ahead,
          behind: repo.behind,
          ...(repo.unavailableReason ? { unavailableReason: repo.unavailableReason } : {}),
          changedFiles: repo.changes.length,
          sampledAt: new Date().toISOString(),
        }
      }
      case 'git.diff.get': {
        const target = input?.target === 'staged' ? 'staged' : 'working'
        const model = await git().diff(input?.path ?? '', target)
        return {
          workspaceId,
          path: String(input?.path ?? '').replaceAll('\\', '/'),
          target,
          ...model,
        }
      }
      case 'git.branches.list':
        return { workspaceId, branches: await gitBranches() }
      case 'git.worktrees.list':
        return { workspaceId, ...(await git().worktrees()) }
      case 'git.remotes.list':
        return { workspaceId, remotes: await gitRemotes() }
      case 'git.log.list':
        return { workspaceId, ...(await git().log({ limit: input?.limit, skip: input?.skip })) }
      case 'git.commit.changes':
        return { workspaceId, ...(await git().commitChanges(input?.oid)) }
      case 'git.commit.diff':
        return {
          workspaceId,
          oid: String(input?.oid ?? ''),
          path: String(input?.path ?? '').replaceAll('\\', '/'),
          ...(await git().commitDiff(input?.oid, input?.path ?? '')),
        }
      case 'fs.places':
        return systemPlaces()
      case 'fs.list':
        return listSystem(String(input?.path ?? cwd), {
          showHidden: input?.showHidden === true,
          workspaceId,
          rootPosix: cwd,
        })
      case 'fs.file.inspect':
        return inspectSystemFile(String(input?.path ?? ''))
      case 'fs.file.readText':
        return readSystemText(String(input?.path ?? ''))
      case 'fs.file.readChunk':
        return readSystemChunk(String(input?.path ?? ''), input?.offset, input?.length)
      case 'models.auth.providers.read':
        if (!input?.sessionId) throw clientError('INVALID_ARGUMENT', 'sessionId is required')
        return modelAuthProviders(input.sessionId)
      case 'models.adaptation.resolve':
        throw clientError('CAPABILITY_UNAVAILABLE', '当前 Runtime 没有模型适配层，未解析或应用任何模型选择')
      case 'skills.get':
        return skillsReadModel()
      case 'mcp.get':
        return await mcpReadModel()
      case 'agents.definitions.get':
        return {
          agents: [],
          warnings: [],
          builtinToolNames: [],
          roleAliases: [],
          projectScopeAvailable: false,
          generatedAt: new Date().toISOString(),
        }
      default:
        throw clientError('CAPABILITY_UNAVAILABLE', unavailableReasonFor(name))
    }
  }

  async function modelConfig() {
    const provider = runtime.options?.provider ?? 'deepseek-official'
    const model = runtime.options?.model ?? 'deepseek-flash'
    let hasSecret = false
    try {
      hasSecret = (await credentialRefNames()).includes('DEEPSEEK_API_KEY')
    } catch {
      /* 凭证文件读不到时仍展示目录，状态由 auth 面板单独提示 */
    }
    // 模型目录来自当前 DSH 安装里 llm-deepseek 的内置模型表；用户点过“刷新模型”后
    // 优先用官方接口返回的 ID。读不到安装目录时退回静态目录，并标记未验证。
    const runtimeCatalog = await readRuntimeModelCatalog()
    const known = new Map(runtimeCatalog.models.map((row) => [row.id, row]))
    const ids = Array.isArray(catalogCache.models) && catalogCache.models.length > 0
      ? catalogCache.models
      : runtimeCatalog.models.map((row) => row.id)
    const catalog = ids.map((id) => {
      const info = known.get(id)
      return {
        id,
        name: info?.name ?? id,
        image: info?.image ?? /flash|vl|vision/i.test(id),
        contextWindow: info?.contextWindow ?? runtimeCatalog.contextWindow,
        description: info?.description ?? '',
      }
    })
    if (!catalog.some((row) => row.id === model)) {
      catalog.unshift({ id: model, name: model, image: false, contextWindow: runtimeCatalog.contextWindow, description: '' })
    }
    const models = catalog.map((row) => ({
      id: row.id,
      name: row.name,
      selector: `${provider}/${row.id}`,
      image: row.image,
      reasoning: true,
      tools: true,
      contextWindow: row.contextWindow ?? undefined,
      maxTokens: runtimeCatalog.maxTokens ?? undefined,
      input: row.image ? ['text', 'image'] : ['text'],
      ...(row.description ? { description: row.description } : {}),
      status: 'available',
      source: 'catalog',
    }))
    // 只有读到了当前 DSH 安装的模型表才算 Runtime 验证。
    const verified = runtimeCatalog.source === 'runtime'
    const availability = verified
      ? {
          status: 'verified',
          source: 'runtime',
          total: models.length,
          ...(runtimeCatalog.version ? { version: runtimeCatalog.version } : {}),
          truncated: false,
        }
      : {
          status: 'unverified',
          source: 'none',
          reason: runtimeCatalog.reason ?? '当前 DSH 安装没有提供可读的模型目录',
        }
    return {
      availability,
      catalog: {
        version: runtimeCatalog.version ? `dsh ${runtimeCatalog.version}` : 'unknown',
        upstreamCommit: runtimeCatalog.version ?? '',
        source: 'builtin',
      },
      providers: [{
        id: provider,
        name: 'DeepSeek',
        source: 'builtin',
        status: 'available',
        statusDetail: '',
        api: 'openai-completions',
        local: false,
        enabled: true,
        auth: { type: 'env', hasSecret },
        models,
      }],
      presets: [],
      roles: [],
      cycleOrder: [],
      availableModels: models.map((row) => ({
        provider,
        id: row.id,
        selector: row.selector,
        name: row.name,
        kind: 'chat',
        reasoning: row.reasoning,
        image: row.image,
        tools: row.tools,
        source: 'registry',
        ...(row.contextWindow === undefined ? {} : { contextWindow: row.contextWindow }),
        ...(row.maxTokens === undefined ? {} : { maxTokens: row.maxTokens }),
        ...(row.input === undefined ? {} : { input: row.input }),
        ...(row.description === undefined ? {} : { description: row.description }),
      })),
      loginProviders: [],
      generatedModelsYml: '',
      generatedConfigYml: '',
      runtimeEffectHint: 'DeepSeek Harness runtime',
      loginAvailable: false,
      ompAvailable: true,
      modelRoleStorage: 'global',
      projectScopeAvailable: false,
      modelProviderOrder: [provider],
      fallbackChains: {},
      fallbackRevertPolicy: 'cooldown-expiry',
      webSearch: {
        enabled: false,
        order: [],
        exclude: [],
        timeoutSeconds: 30,
        geminiModel: '',
        providers: [],
        advanced: {},
      },
    }
  }

  // ---- live events ---------------------------------------------------------

  function runtimeEventFromEnvelope(event) {
    return {
      // The pure router uses a one-based envelope; Runtime sequences start at 0.
      seq: event.sequence - 1,
      type: event.type,
      time: Date.parse(event.occurredAt),
      data: event.data,
    }
  }

  function emitEvent(extra, contextId = undefined) {
    emit(envelope(contextId === undefined ? extra : { ...extra, contextId }))
  }

  /** Deliver only to contexts that currently own this session. */
  function forEachSessionContext(sessionId, deliver) {
    for (const contextId of contextsForSession(sessionId)) deliver(contextId)
  }

  function emitConversation(sessionId, update, nativeSequence = undefined) {
    const seq = (liveSessionSeq.get(sessionId) ?? 0) + 1
    liveSessionSeq.set(sessionId, seq)
    const change = {
      kind: 'conversation.changed',
      sessionId,
      streamSeq: seq,
      ...(Number.isSafeInteger(nativeSequence) && nativeSequence >= 0 ? { runtimeEventSeq: nativeSequence } : {}),
      update,
    }
    const journal = conversationJournal.get(sessionId) ?? []
    journal.push(change)
    if (journal.length > CONVERSATION_REPLAY_LIMIT) journal.splice(0, journal.length - CONVERSATION_REPLAY_LIMIT)
    conversationJournal.set(sessionId, journal)
    forEachSessionContext(sessionId, (contextId) => {
      emitEvent(change, contextId)
    })
  }

  function emitSessionSnapshot(sessionId) {
    forEachSessionContext(sessionId, (contextId) => {
      emitEvent({ kind: 'snapshot', snapshot: snapshot(undefined, contextId) }, contextId)
    })
  }

  /** Route native events once per session, buffering gaps until their predecessors arrive. */
  function onSessionEvent(params) {
    const sessionId = params?.sessionId
    const event = params?.event
    if (!sessionId || !event) return
    if (!Number.isSafeInteger(event.seq) || event.seq < 0) {
      // Legacy/test transports without native sequence cannot make ordering claims.
      projectSessionEvent({ sessionId, event })
      return
    }
    try {
      if (!observedNativeBaseline.has(sessionId)) {
        observedNativeBaseline.add(sessionId)
        // The notification stream has no authoritative attachment watermark. The
        // previous native sequence is useful only for local ordering, never as
        // proof that earlier Runtime events were received. Runtime starts at 0.
        eventRouter.registerSession(sessionId, event.seq)
        if (event.seq > 0) {
          emitConversation(sessionId, {
            kind: 'conversation.notice', sessionId, level: 'warning',
            message: `从 Runtime 事件序号 ${event.seq} 开始接收；此前事件是否遗漏无法确认`,
            source: 'CONTINUITY_UNKNOWN',
          })
        }
      }
      const eventTime = typeof event.time === 'number' ? event.time : Date.parse(event.time)
      const occurredAt = Number.isFinite(eventTime) ? new Date(eventTime).toISOString() : new Date().toISOString()
      const result = eventRouter.ingest({
        schemaVersion: 1,
        eventId: `${sessionId}:${event.seq}`,
        sessionId,
        // Normalize zero-based Runtime sequences into the router's one-based envelope.
        sequence: event.seq + 1,
        type: String(event.type ?? ''),
        occurredAt,
        originLease: null,
        data: event.data ?? {},
      })
      const deliveredEvents = new Map(result.deliveries.map((delivery) => [delivery.event.eventId, delivery.event]))
      for (const delivered of deliveredEvents.values()) {
        projectSessionEvent({ sessionId, event: runtimeEventFromEnvelope(delivered) })
      }
      if (result.gap) {
        const missingFrom = result.gap.missingFrom - 1
        const missingTo = result.gap.missingTo - 1
        const key = `${sessionId}:${missingFrom}:${missingTo}`
        if (!reportedEventGaps.has(key)) {
          reportedEventGaps.add(key)
          emitConversation(sessionId, {
            kind: 'conversation.notice', sessionId, level: 'warning',
            message: `Runtime 事件序号 ${missingFrom}–${missingTo} 尚未到达，后续事件已缓冲`,
            source: 'SEQUENCE_GAP',
          })
        }
      }
      if (result.status === 'conflict') {
        emitConversation(sessionId, {
          kind: 'conversation.notice', sessionId, level: 'error',
          message: result.error?.message ?? 'Runtime 事件内容冲突', source: 'EVENT_CONFLICT',
        })
      }
      if (result.status === 'rejected') {
        emitConversation(sessionId, {
          kind: 'conversation.notice', sessionId, level: 'error',
          message: `${result.error?.message ?? 'Runtime 事件缓冲已满'}；请重新同步会话以恢复完整事件流`,
          source: 'EVENT_BUFFER_OVERFLOW',
        })
      }
    } catch (error) {
      emitConversation(sessionId, {
        kind: 'conversation.notice', sessionId, level: 'error',
        message: error.message ?? String(error), source: 'EVENT_ROUTING_FAILED',
      })
    }
  }

  /** Translate one DSH `session.event` notification into owner-scoped projections. */
  function projectSessionEvent(params) {
    const sessionId = params?.sessionId
    const event = params?.event
    if (!sessionId || !event) return
    const state = stateFor(sessionId)
    const data = event.data ?? {}
    const turnId = `turn-${data.turn ?? 0}`
    const emitProjection = (update) => emitConversation(sessionId, update, event.seq)

    switch (event.type) {
      case 'user/message': {
        if (!isUserVisibleMessage(data)) return
        const blocks = toContractBlocks(data.content)
        if (blocks.length === 0) return
        const messageId = data.id ?? `user-${event.seq ?? Date.now()}`
        emitProjection({
          kind: 'conversation.message.completed',
          sessionId,
          turnId,
          messageId,
          item: messageItem({ itemId: messageId, role: 'user', content: data.content, createdAt: isoFromEpoch(event.time) }),
        })
        return
      }
      case 'assistant/message': {
        const message = data.message ?? {}
        const blocks = toContractBlocks(message.content)
        const messageId = message.id ?? `assistant-${event.seq ?? Date.now()}`
        state.lastAssistantMessageId = messageId
        state.lastTurnId = turnId
        if (blocks.length > 0) {
          emitProjection({
            kind: 'conversation.message.completed',
            sessionId,
            turnId,
            messageId,
            item: messageItem({ itemId: messageId, role: 'assistant', content: message.content, createdAt: isoFromEpoch(event.time) }),
          })
        }
        return
      }
      case 'tool/call': {
        const owner = { messageId: state.lastAssistantMessageId ?? `tool-${data.callId}`, turnId }
        state.callOwner.set(data.callId, owner)
        let parsed = data.arguments
        if (typeof parsed === 'string') {
          try {
            parsed = JSON.parse(parsed)
          } catch {
            parsed = data.arguments
          }
        }
        // DSH 的 subagent 工具参数带 name / description；生命周期通知只有会话 id，
        // 先按父会话排队，等 `subagent.started` 到达时配对。
        if (data.name === 'subagent') {
          const queue = pendingSubagentCalls.get(sessionId) ?? []
          queue.push({
            name: typeof parsed?.name === 'string' ? parsed.name : undefined,
            description: typeof parsed?.description === 'string' ? parsed.description : undefined,
            at: Date.now(),
          })
          pendingSubagentCalls.set(sessionId, queue.slice(-8))
        }
        emitProjection({
          kind: 'conversation.tool.started',
          sessionId,
          turnId,
          messageId: owner.messageId,
          toolCallId: data.callId,
          toolName: data.name ?? 'tool',
          ...(parsed === undefined ? {} : { arguments: parsed }),
          startedAt: isoFromEpoch(event.time),
        })
        return
      }
      case 'tool/result': {
        const callId = data.message?.toolCallId
        const owner = state.callOwner.get(callId)
        state.callOwner.delete(callId)
        emitProjection({
          kind: 'conversation.tool.completed',
          sessionId,
          turnId: owner?.turnId ?? turnId,
          toolCallId: callId,
          result: {
            type: 'toolResult',
            toolCallId: callId,
            ...(data.message?.toolName ? { toolName: data.message.toolName } : {}),
            output: textOfContent(data.message?.content),
            isError: data.message?.isError === true,
          },
          completedAt: isoFromEpoch(event.time),
        })
        return
      }
      case 'turn/start': {
        if (Number.isSafeInteger(data.turn) && data.turn >= 1) activeTurns.set(sessionId, data.turn)
        streamingSessions.add(sessionId)
        emitProjection({ kind: 'conversation.turn.started', sessionId, turnId, startedAt: isoFromEpoch(event.time) })
        emitSessionSnapshot(sessionId)
        return
      }
      case 'turn/end': {
        if (activeTurns.get(sessionId) === data.turn) activeTurns.delete(sessionId)
        streamingSessions.delete(sessionId)
        const reason = data.reason
        if (reason?.kind === 'error') {
          emitProjection({
            kind: 'conversation.notice',
            sessionId,
            level: 'error',
            message: reason.error?.message ?? 'turn failed',
            source: reason.error?.code,
          })
        }
        emitProjection({ kind: 'conversation.turn.completed', sessionId, turnId: `turn-${data.turn ?? 0}` })
        emitSessionSnapshot(sessionId)
        return
      }
      case 'command/done': {
        if (!data.text) return
        emitProjection({
          kind: 'conversation.notice',
          sessionId,
          level: data.kind === 'error' ? 'error' : 'info',
          message: String(data.text),
          source: data.name,
        })
        return
      }
      case 'session/title': {
        state.titles.set(sessionId, data.title ?? data.text ?? '')
        emitSessionSnapshot(sessionId)
        return
      }
      default:
        return
    }
  }

  /** Push the current runtime connection so the renderer can leave "connecting". */
  function notifyRuntime() {
    emitEvent({ kind: 'runtime.changed', connection: runtimeConnection() })
  }

  /** Translate `session.status` notifications into snapshot updates. */
  function onStatus(params) {
    const sessionId = params?.sessionId
    if (!sessionId) return
    if (params.status === 'running') streamingSessions.add(sessionId)
    else streamingSessions.delete(sessionId)
    emitSessionSnapshot(sessionId)
  }

  /** 子 Agent 开始：名字/任务从刚才排队的 subagent 工具调用里取；没有就退回默认名。 */
  function onSubagentStarted(params) {
    const parentSessionId = typeof params?.parentSessionId === 'string' ? params.parentSessionId : ''
    const childSessionId = typeof params?.childSessionId === 'string' ? params.childSessionId : ''
    if (!parentSessionId || !childSessionId) return
    const queue = pendingSubagentCalls.get(parentSessionId) ?? []
    while (queue.length > 0 && Date.now() - queue[0].at > 120_000) queue.shift()
    const call = queue.shift()
    if (queue.length === 0) pendingSubagentCalls.delete(parentSessionId)
    else pendingSubagentCalls.set(parentSessionId, queue)

    const siblings = [...subagents.values()].filter((agent) => agent.parentSessionId === parentSessionId).length
    const now = new Date().toISOString()
    subagents.set(childSessionId, {
      childSessionId,
      parentSessionId,
      rootSessionId: rootSessionOf(parentSessionId),
      displayName: call?.name ?? `agent-${siblings + 1}`,
      ...(call?.description === undefined ? {} : { assignment: call.description }),
      status: 'running',
      startedAt: now,
      updatedAt: now,
    })
    const rootSessionId = subagents.get(childSessionId).rootSessionId
    bumpAgentsRevision(rootSessionId)
    emitSessionSnapshot(rootSessionId)
  }

  /** 子 Agent 结束：把终态与最终回复摘要折叠进快照。 */
  function onSubagentFinished(params) {
    const childSessionId = typeof params?.childSessionId === 'string' ? params.childSessionId
      : typeof params?.agentId === 'string' ? params.agentId : ''
    if (!childSessionId) return
    const record = subagents.get(childSessionId)
    // 桥重启后没收到 started 的记录不凭空造：没有身份就没有可展示的状态。
    if (!record) return
    const stopReason = typeof params?.stopReason === 'string' ? params.stopReason : ''
    record.status = params?.status === 'ok' ? 'released' : stopReason === 'aborted' ? 'aborted' : 'failed'
    const summary = textOfContent(params?.lastAssistantMessage).trim()
    if (summary) record.summary = summary.length > 200 ? `${summary.slice(0, 200)}…` : summary
    record.updatedAt = new Date().toISOString()
    bumpAgentsRevision(record.rootSessionId)
    emitSessionSnapshot(record.rootSessionId)
  }

  /** Public, serialisable view of a bridge-owned approval (never includes respond). */
  function approvalCard(interactionId, approval, status = 'pending') {
    return {
      interactionId,
      sessionId: approval.sessionId,
      leaseGeneration: approval.leaseGeneration,
      title: 'Tool approval',
      kind: 'approval',
      approvalType: approval.approvalType,
      detail: approval.detail,
      status,
    }
  }

  /** Forward a DSH approval request only to contexts that own its session. */
  function onApprovalRequest({ requestId = null, params, respond }) {
    const sessionId = params?.sessionId
    if (!sessionId) {
      respond({ outcome: 'cancelled' })
      return
    }
    const owners = contextsForSession(sessionId)
    if (owners.length === 0) {
      respond({ outcome: 'cancelled' })
      return
    }
    interactionSeq += 1
    const interactionId = `approval-${interactionSeq}`
    const approval = {
      requestId,
      sessionId,
      owners: new Set(owners),
      leaseGeneration: 1,
      approvalType: params?.type ?? params?.kind ?? 'command',
      detail: {
        ...(params?.command ? { command: params.command } : {}),
        ...(params?.path ? { path: params.path } : {}),
        ...(params?.reason ? { reason: params.reason } : {}),
      },
      respond,
    }
    approvals.set(interactionId, approval)
    for (const contextId of owners) {
      emitEvent({
        kind: 'interaction.required',
        interaction: approvalCard(interactionId, approval),
      }, contextId)
    }
  }

  function cancelOrphanedApprovals() {
    for (const [interactionId, approval] of approvals) {
      const liveOwners = [...approval.owners].filter(
        (contextId) => contexts.get(contextId)?.currentSessionId === approval.sessionId,
      )
      if (liveOwners.length > 0) continue
      approvals.delete(interactionId)
      approval.respond({ outcome: 'cancelled' })
    }
  }

  /** Settle bridge-side interaction cards when RuntimeClient responds or times out. */
  function onRequestSettled({ requestId, reason }) {
    if (!requestId) return
    for (const [interactionId, approval] of approvals) {
      if (approval.requestId !== requestId) continue
      approvals.delete(interactionId)
      for (const contextId of approval.owners) {
        emitEvent({
          kind: 'interaction.resolved',
          interactionId,
          leaseGeneration: approval.leaseGeneration,
          outcome: reason === 'responded' ? 'submitted' : 'cancelled',
        }, contextId)
      }
    }
  }

  // ---- commands ------------------------------------------------------------

  function emitReceipt(requestId, commandName, outcome, contextId) {
    emitEvent({ kind: 'command.receipt', receipt: { requestId, commandName, ...outcome } }, contextId)
  }

  function newSessionId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${++commandSeq}`
  }

  function requireControl(method) {
    if (!runtimeControlAvailable(method)) {
      throw clientError('CAPABILITY_UNAVAILABLE', `当前 Runtime 未声明支持 ${method}；不会改用普通 prompt 模拟`)
    }
    if (typeof runtime[({
      'session/turn.cancel': 'cancelTurn',
      'session/turn.steer': 'steerTurn',
      'session/queue.enqueue': 'enqueue',
      'session/queue.list': 'listQueue',
      'session/queue.cancel': 'cancelQueued',
      'session/draft.get': 'getDraft',
      'session/draft.put': 'putDraft',
    })[method]] !== 'function') {
      throw clientError('CAPABILITY_UNAVAILABLE', `当前桌面客户端尚未接入 ${method}`)
    }
  }

  function controlSession(input, context) {
    const sessionId = input?.sessionId ?? context.currentSessionId
    if (typeof sessionId !== 'string' || !sessionId) throw clientError('INVALID_ARGUMENT', '控制操作需要已存在的 sessionId')
    if (sessionId !== context.currentSessionId) {
      throw clientError('PERMISSION_DENIED', '当前窗口没有该会话的控制租约')
    }
    return sessionId
  }

  function controlRequestId(requestId) {
    if (typeof requestId !== 'string' || !requestId || requestId.length > 256) {
      throw clientError('INVALID_ARGUMENT', 'requestId 必须是 1..256 字符')
    }
    return requestId
  }

  function requestedTurnId(input, sessionId, optional = false) {
    const value = input?.turnId
    if (value === undefined || value === null) {
      if (optional) return undefined
      const active = activeTurns.get(sessionId)
      if (active === undefined) throw clientError('INVALID_STATE', '当前会话没有已确认的活动轮次')
      return active
    }
    const match = typeof value === 'number' ? value : (typeof value === 'string' ? /^turn-(\d+)$/.exec(value)?.[1] : undefined)
    const turn = Number(match)
    if (!Number.isSafeInteger(turn) || turn < 1) throw clientError('INVALID_ARGUMENT', 'turnId 必须是正整数或 turn-<number>')
    return turn
  }

  function assertContextEpoch(contextId, epoch) {
    if (contexts.get(contextId)?.epoch !== epoch) {
      throw clientError('FAILED_PRECONDITION', '窗口会话已切换，旧操作不能覆盖当前状态')
    }
  }

  function canUseLocalDrafts(error) {
    // Fall back only when no Runtime write could have happened. In particular,
    // a timeout or disconnect after sending has an unknown outcome and must not
    // be duplicated into a second authority; structured conflicts stay visible.
    return error?.code === 'CAPABILITY_UNAVAILABLE' || error?.code === 'CONTROL_UNSUPPORTED'
      || error?.message === 'runtime is not running'
  }

  async function runtimeDraftGet(sessionId, draftId) {
    try {
      requireControl('session/draft.get')
      const result = await runtime.getDraft(sessionId, draftId)
      if (result.savedAt != null || result.contentBlocks?.length > 0 || !localDrafts) return result
      const local = await localDrafts.get(sessionId, draftId)
      return local.savedAt == null ? result : local
    } catch (error) {
      if (!localDrafts || !canUseLocalDrafts(error)) throw error
      return localDrafts.get(sessionId, draftId)
    }
  }

  async function runtimeDraftPut(sessionId, draftId, requestId, expectedRevision, contentBlocks) {
    try {
      requireControl('session/draft.put')
      return await runtime.putDraft(sessionId, draftId, requestId, expectedRevision, contentBlocks)
    } catch (error) {
      if (!localDrafts || !canUseLocalDrafts(error)) throw error
      return localDrafts.put(sessionId, draftId, requestId, expectedRevision, contentBlocks)
    }
  }

  async function runCommand(commandName, input, requestId, contextId) {
    const context = contextOf(contextId)
    const contextEpoch = context.epoch
    // 所有回执都只发给发起命令的那个上下文，避免串到别的对话窗口。
    const receipt = (id, name, outcome) => emitReceipt(id, name, outcome, contextId)
    if (EXTERNAL_CAPABILITIES.has(commandName)) {
      receipt(requestId, commandName, {
        status: 'failed',
        error: clientError('CAPABILITY_UNAVAILABLE', unavailableReasonFor(commandName)),
        observedAt: new Date().toISOString(),
      })
      return
    }
    switch (commandName) {
      case 'core.steer': {
        try {
          requireControl('session/turn.steer')
          const sessionId = controlSession(input, context)
          const contentBlocks = controlContent(input)
          if (contentBlocks.length === 0 || contentBlocks.every(block => block.type === 'text' && !block.text.trim())) {
            throw clientError('INVALID_ARGUMENT', 'empty prompt')
          }
          controlRequestId(requestId)
          const result = await runtime.steerTurn(sessionId, requestId, contentBlocks, {
            turnId: requestedTurnId(input, sessionId),
          })
          receipt(requestId, commandName, { status: 'completed', result, observedAt: new Date().toISOString() })
        } catch (error) {
          receipt(requestId, commandName, { status: 'failed', error: controlError(error), observedAt: new Date().toISOString() })
        }
        return
      }
      case 'core.prompt':
      case 'core.followUp': {
        const text = input?.text
        if (!text) {
          receipt(requestId, commandName, { status: 'failed', error: clientError('INVALID_ARGUMENT', 'empty prompt'), observedAt: new Date().toISOString() })
          return
        }
        if (!context.currentSessionId) context.currentSessionId = newSessionId('omp')
        bindContextSession(contextId, context.currentSessionId)
        cancelOrphanedApprovals()
        // 磁盘上已有的会话在当前运行时里没有挂载，`session/query` 会返回
        // “already exists”。按 SDK 约定先 resume 再写 turn；已被本进程持有的
        // 情况忽略 resume 错误，让 query 自己给出结论。
        await sendToSession(context.currentSessionId, text)
        receipt(requestId, commandName, { status: 'completed', result: {}, observedAt: new Date().toISOString() })
        return
      }
      case 'queue.enqueue': {
        try {
          requireControl('session/queue.enqueue')
          const sessionId = controlSession(input, context)
          const contentBlocks = controlContent(input)
          if (contentBlocks.length === 0 || contentBlocks.every(block => block.type === 'text' && !block.text.trim())) {
            throw clientError('INVALID_ARGUMENT', 'empty prompt')
          }
          controlRequestId(requestId)
          const result = await runtime.enqueue(sessionId, requestId, contentBlocks, {
            clientDraftId: input?.clientDraftId,
          })
          receipt(requestId, commandName, { status: 'completed', result, observedAt: new Date().toISOString() })
        } catch (error) {
          receipt(requestId, commandName, { status: 'failed', error: controlError(error), observedAt: new Date().toISOString() })
        }
        return
      }
      case 'core.abort': {
        try {
          requireControl('session/turn.cancel')
          const sessionId = controlSession(input, context)
          controlRequestId(requestId)
          const result = await runtime.cancelTurn(sessionId, requestId, {
            turnId: requestedTurnId(input, sessionId, true),
            reason: input?.reason,
          })
          receipt(requestId, commandName, { status: 'completed', result, observedAt: new Date().toISOString() })
        } catch (error) {
          receipt(requestId, commandName, { status: 'failed', error: controlError(error), observedAt: new Date().toISOString() })
        }
        return
      }
      case 'workbench.toolset.set': {
        try {
          const sessionId = workbenchSession(input, context)
          const { owner, workspace } = ensureWorkbenchWorkspace(sessionId)
          const capabilities = workbenchCapabilities()
          if (input?.capabilityRevision !== undefined && input.capabilityRevision !== capabilities.revision) {
            throw clientError('CONFLICT', 'capability snapshot 已变化；请重新读取后再选择工具')
          }
          const before = [...workspace.toolset]
          workbenchRegistry = setSessionToolset(workbenchRegistry, {
            owner,
            toolset: input?.toolset,
            capabilities,
            expectedRevision: input?.expectedRevision,
            updatedAt: new Date().toISOString(),
          })
          recordWorkbenchAudit(sessionId, 'toolset.set', {
            before,
            after: [...(getConversationWorkspace(workbenchRegistry, owner)?.toolset ?? [])],
            capabilityRevision: capabilities.revision,
          })
          emitWorkbenchChange(sessionId, {
            toolset: [...(getConversationWorkspace(workbenchRegistry, owner)?.toolset ?? [])],
          })
          receipt(requestId, commandName, {
            status: 'completed',
            result: workbenchReadModel(sessionId),
            observedAt: new Date().toISOString(),
          })
        } catch (error) {
          receipt(requestId, commandName, {
            status: 'failed',
            error: controlError(error),
            observedAt: new Date().toISOString(),
          })
        }
        return
      }
      case 'workbench.tool.register': {
        try {
          const sessionId = workbenchSession(input, context)
          const { owner } = ensureWorkbenchWorkspace(sessionId)
          const capabilities = workbenchCapabilities()
          if (input?.capabilityRevision !== undefined && input.capabilityRevision !== capabilities.revision) {
            throw clientError('CONFLICT', 'capability snapshot 已变化；请重新读取后再注册工具')
          }
          const instanceId = `workbench-tool-${workbenchInstanceSeq + 1}`
          workbenchRegistry = registerSessionToolInstance(workbenchRegistry, {
            owner,
            expectedRevision: input?.expectedRevision,
            instanceId,
            toolId: input?.toolId,
            metadata: input?.metadata,
            limits: workbenchLimits,
          })
          workbenchInstanceSeq += 1
          recordWorkbenchAudit(sessionId, 'tool.register', {
            instanceId,
            toolId: input?.toolId,
          })
          emitWorkbenchChange(sessionId, {
            instanceId,
            toolId: input?.toolId,
            instanceState: 'opening',
          })
          receipt(requestId, commandName, {
            status: 'completed',
            result: {
              ...workbenchReadModel(sessionId),
              instance: workbenchRegistry.toolInstances[instanceId],
            },
            observedAt: new Date().toISOString(),
          })
        } catch (error) {
          receipt(requestId, commandName, {
            status: 'failed',
            error: controlError(error),
            observedAt: new Date().toISOString(),
          })
        }
        return
      }
      case 'workbench.tool.close': {
        try {
          const sessionId = workbenchSession(input, context)
          const { owner } = ensureWorkbenchWorkspace(sessionId)
          workbenchRegistry = closeSessionToolInstance(workbenchRegistry, {
            owner,
            expectedRevision: input?.expectedRevision,
            instanceId: input?.instanceId,
          })
          recordWorkbenchAudit(sessionId, 'tool.close', {
            instanceId: input?.instanceId,
          })
          emitWorkbenchChange(sessionId, {
            instanceId: input?.instanceId,
            instanceState: 'closed',
          })
          receipt(requestId, commandName, {
            status: 'completed',
            result: workbenchReadModel(sessionId),
            observedAt: new Date().toISOString(),
          })
        } catch (error) {
          receipt(requestId, commandName, {
            status: 'failed',
            error: controlError(error),
            observedAt: new Date().toISOString(),
          })
        }
        return
      }
      case 'session.create': {
        bindContextSession(contextId, newSessionId('omp'))
        cancelOrphanedApprovals()
        liveSessionSeq.set(context.currentSessionId, 0)
        conversationJournal.delete(context.currentSessionId)
        emitEvent({ kind: 'snapshot', snapshot: snapshot(undefined, contextId) }, contextId)
        receipt(requestId, commandName, { status: 'completed', result: snapshot(undefined, contextId), observedAt: new Date().toISOString() })
        return
      }
      case 'session.delete':
      case 'session.deleteArchived': {
        const threadId = input?.threadId
        if (!threadId) {
          receipt(requestId, commandName, { status: 'failed', error: clientError('INVALID_ARGUMENT', 'missing threadId'), observedAt: new Date().toISOString() })
          return
        }
        try {
          const { removed } = await deleteSession(threadId)
          if (removed === 0) {
            receipt(requestId, commandName, { status: 'failed', error: clientError('NOT_FOUND', '没有找到该会话的磁盘记录'), observedAt: new Date().toISOString() })
            return
          }
          // 运行时里还挂着的会话保留内存状态，但历史已经不可恢复。
          liveSessionSeq.delete(threadId)
          conversationJournal.delete(threadId)
          receipt(requestId, commandName, {
            status: 'completed',
            result: { message: '会话已删除', cleanup: 'complete' },
            observedAt: new Date().toISOString(),
          })
        } catch (error) {
          receipt(requestId, commandName, { status: 'failed', error: clientError('INTERNAL', `删除会话失败：${error.message}`), observedAt: new Date().toISOString() })
        }
        return
      }
      case 'session.resume': {
        const sessionId = input?.threadId
        if (!sessionId) {
          receipt(requestId, commandName, { status: 'failed', error: clientError('INVALID_ARGUMENT', 'missing threadId'), observedAt: new Date().toISOString() })
          return
        }
        try {
          await runtime.resume(sessionId)
          assertContextEpoch(contextId, contextEpoch)
        } catch (error) {
          receipt(requestId, commandName, {
            status: 'failed',
            error: error.code === 'FAILED_PRECONDITION'
              ? error
              : clientError('UNAVAILABLE', `会话恢复失败：${error.message}`),
            observedAt: new Date().toISOString(),
          })
          return
        }
        bindContextSession(contextId, sessionId)
        cancelOrphanedApprovals()
        emitEvent({ kind: 'snapshot', snapshot: snapshot(undefined, contextId) }, contextId)
        receipt(requestId, commandName, { status: 'completed', result: snapshot(undefined, contextId), observedAt: new Date().toISOString() })
        return
      }
      case 'interaction.respond': {
        const approval = approvals.get(input?.interactionId)
        if (!approval) {
          receipt(requestId, commandName, { status: 'failed', error: clientError('INVALID_ARGUMENT', 'unknown interaction'), observedAt: new Date().toISOString() })
          return
        }
        if (!approval.owners.has(contextId ?? ROOT_CONTEXT)) {
          receipt(requestId, commandName, { status: 'failed', error: clientError('PERMISSION_DENIED', 'context does not own this interaction'), observedAt: new Date().toISOString() })
          return
        }
        if ((input?.leaseGeneration ?? 1) !== approval.leaseGeneration) {
          receipt(requestId, commandName, { status: 'failed', error: clientError('FAILED_PRECONDITION', 'interaction lease mismatch'), observedAt: new Date().toISOString() })
          return
        }
        const decision = input?.decision
        if (decision !== 'submit' && decision !== 'cancel') {
          receipt(requestId, commandName, { status: 'failed', error: clientError('INVALID_ARGUMENT', 'decision must be submit or cancel'), observedAt: new Date().toISOString() })
          return
        }
        const outcome = decision === 'cancel'
          ? 'cancelled'
          : input?.value === false || input?.value === 'reject'
            ? 'rejected'
            : 'allowed-once'
        const accepted = approval.respond({ outcome })
        approvals.delete(input.interactionId)
        if (!accepted) {
          receipt(requestId, commandName, { status: 'failed', error: clientError('FAILED_PRECONDITION', 'interaction already settled'), observedAt: new Date().toISOString() })
          return
        }
        receipt(requestId, commandName, { status: 'completed', result: {}, observedAt: new Date().toISOString() })
        return
      }
      case 'workspace.open': {
        receipt(requestId, commandName, { status: 'completed', result: await workspaces(), observedAt: new Date().toISOString() })
        return
      }
      case 'session.models.mentions': {
        // 升级类命令的回执约定：receipt.result = { result: <payload> }，
        // 渲染层的 waitReceipt 会把 receipt.result 原样交给调用方。
        receipt(requestId, commandName, {
          status: 'completed',
          result: {
            result: {
              sessionId: input?.sessionId ?? context.currentSessionId ?? 'dsh-draft',
              mentions: [],
              available: [],
              activeModelImage: false,
            },
          },
          observedAt: new Date().toISOString(),
        })
        return
      }
      case 'runtime.models.list': {
        // 模型选择器按 `{ models, nextCursor }` 分页读取运行时可用模型。
        const { availableModels } = modelConfig()
        receipt(requestId, commandName, {
          status: 'completed',
          result: { result: { models: availableModels, nextCursor: null } },
          observedAt: new Date().toISOString(),
        })
        return
      }
      case 'session.queue.list': {
        try {
          requireControl('session/queue.list')
          const sessionId = controlSession(input, context)
          const queue = await runtime.listQueue(sessionId)
          const offset = input?.offset ?? 0
          if (!Number.isSafeInteger(offset) || offset < 0) throw clientError('INVALID_ARGUMENT', 'offset 必须是非负整数')
          const items = queue.items.slice(offset, offset + 100).map((item) => ({
            id: item.queuedItemId,
            queuedItemId: item.queuedItemId,
            position: item.position,
            text: textOfContent(item.contentBlocks),
            imageCount: item.contentBlocks.filter(block => block.type === 'image').length,
            queue: 'followUp',
            state: 'pending',
          }))
          receipt(requestId, commandName, {
            status: 'completed',
            result: { result: {
              sessionId, revision: queue.revision, total: queue.items.length,
              followUpMode: 'all', steeringMode: 'unsupported', items,
              source: queue.source, target: queue.target,
            } },
            observedAt: new Date().toISOString(),
          })
        } catch (error) {
          receipt(requestId, commandName, { status: 'failed', error: controlError(error), observedAt: new Date().toISOString() })
        }
        return
      }
      case 'session.queue.cancel':
      case 'session.queue.remove': {
        try {
          requireControl('session/queue.cancel')
          const sessionId = controlSession(input, context)
          const queuedItemId = input?.queuedItemId ?? input?.id
          if (typeof queuedItemId !== 'string' || !queuedItemId) throw clientError('INVALID_ARGUMENT', 'missing queuedItemId')
          controlRequestId(requestId)
          const result = await runtime.cancelQueued(sessionId, requestId, queuedItemId)
          receipt(requestId, commandName, {
            status: 'completed', result: { removed: result.status === 'cancelled', status: result.status, revision: result.revision },
            observedAt: new Date().toISOString(),
          })
        } catch (error) {
          receipt(requestId, commandName, { status: 'failed', error: controlError(error), observedAt: new Date().toISOString() })
        }
        return
      }
      case 'session.draft.get':
      case 'session.draft.put': {
        try {
          const sessionId = controlSession(input, context)
          const draftId = input?.draftId
          if (typeof draftId !== 'string' || !draftId) throw clientError('INVALID_ARGUMENT', 'missing draftId')
          const result = commandName === 'session.draft.get'
            ? await runtimeDraftGet(sessionId, draftId)
            : await runtimeDraftPut(sessionId, draftId, controlRequestId(requestId), input?.expectedRevision,
              Array.isArray(input?.contentBlocks) ? input.contentBlocks : controlContent({ text: input?.text, images: input?.images }))
          receipt(requestId, commandName, { status: 'completed', result, observedAt: new Date().toISOString() })
        } catch (error) {
          receipt(requestId, commandName, { status: 'failed', error: controlError(error), observedAt: new Date().toISOString() })
        }
        return
      }
      case 'session.skills.list': {
        receipt(requestId, commandName, {
          status: 'failed',
          error: clientError('CAPABILITY_UNAVAILABLE', unavailableReasonFor(commandName)),
          observedAt: new Date().toISOString(),
        })
        return
      }
      case 'session.compaction.enqueue': {
        const sessionId = input?.sessionId ?? context.currentSessionId
        if (!sessionId) {
          receipt(requestId, commandName, { status: 'failed', error: clientError('INVALID_ARGUMENT', '没有可压缩的会话'), observedAt: new Date().toISOString() })
          return
        }
        // DSH 的压缩是一条内置命令，走同一条 prompt 通道。
        await sendToSession(sessionId, '/compact')
        receipt(requestId, commandName, { status: 'completed', result: {}, observedAt: new Date().toISOString() })
        return
      }
      case 'models.auth.key.set': {
        const key = typeof input?.apiKey === 'string' ? input.apiKey.trim() : ''
        const route = modelAuthRoute(input?.providerId ?? 'deepseek-official')
        if (!route) {
          receipt(requestId, commandName, { status: 'failed', error: clientError('INVALID_ARGUMENT', `未知的供应商：${input?.providerId}`), observedAt: new Date().toISOString() })
          return
        }
        if (!key) {
          receipt(requestId, commandName, { status: 'failed', error: clientError('INVALID_ARGUMENT', 'API Key 不能为空'), observedAt: new Date().toISOString() })
          return
        }
        try {
          await setCredentialRef(route.ref, key)
        } catch (error) {
          receipt(requestId, commandName, { status: 'failed', error: clientError('INTERNAL', `写入凭证失败：${error.message}`), observedAt: new Date().toISOString() })
          return
        }
        receipt(requestId, commandName, {
          status: 'completed',
          result: await modelAuthProviders(input?.sessionId ?? context.currentSessionId ?? 'dsh-draft'),
          observedAt: new Date().toISOString(),
        })
        return
      }
      case 'runtime.refreshAssets': {
        // 强制重读 dump-config（插件树 + 命令 + 工具），并清掉技能扫描缓存。
        try {
          const assets = await loadAssets({ force: true })
          skillsCache = { at: 0, result: null }
          receipt(requestId, commandName, {
            status: 'completed',
            result: {
              message: `已刷新 DSH 资产：${assets.pluginSummary.total} 个插件、${assets.commands.length} 个内置命令、${assets.tools.length} 个工具`,
              pluginSummary: assets.pluginSummary,
              pluginState: assets.pluginState,
            },
            observedAt: new Date().toISOString(),
          })
        } catch (error) {
          receipt(requestId, commandName, { status: 'failed', error: clientError('COMMAND_FAILED', `刷新资产失败：${error.message}`), observedAt: new Date().toISOString() })
        }
        return
      }
      case 'models.available.refresh': {
        try {
          // 先重读当前 DSH 安装的模型表；有 Key 时再问一次官方目录。
          const catalog = await readRuntimeModelCatalog({ force: true })
          const version = catalog.version ? ` ${catalog.version}` : ''
          let message = catalog.source === 'runtime'
            ? `已读取 DSH${version} 的 ${catalog.models.length} 个模型`
            : catalog.reason ?? '没有读到运行时模型目录'
          try {
            const online = await refreshDeepseekCatalog()
            if (online.updated) message += `，并从官方接口补到 ${catalogCache.models.length} 个模型`
          } catch (error) {
            message += `（官方目录刷新失败：${error.message}）`
          }
          receipt(requestId, commandName, { status: 'completed', result: { message }, observedAt: new Date().toISOString() })
        } catch (error) {
          receipt(requestId, commandName, { status: 'failed', error: clientError('COMMAND_FAILED', `刷新模型目录失败：${error.message}`), observedAt: new Date().toISOString() })
        }
        return
      }
      case 'models.catalog.refresh': {
        try {
          const result = await refreshDeepseekCatalog()
          receipt(requestId, commandName, { status: 'completed', result, observedAt: new Date().toISOString() })
        } catch (error) {
          receipt(requestId, commandName, { status: 'failed', error: clientError('COMMAND_FAILED', `刷新模型目录失败：${error.message}`), observedAt: new Date().toISOString() })
        }
        return
      }
      case 'models.discovery.refresh': {
        try {
          const result = await refreshDeepseekCatalog()
          receipt(requestId, commandName, { status: 'completed', result: { message: result.message }, observedAt: new Date().toISOString() })
        } catch (error) {
          receipt(requestId, commandName, { status: 'failed', error: clientError('COMMAND_FAILED', `刷新模型目录失败：${error.message}`), observedAt: new Date().toISOString() })
        }
        return
      }
      case 'models.auth.key.remove': {
        const route = modelAuthRoute(input?.providerId ?? 'deepseek-official')
        if (route) await unsetCredentialRef(route.ref)
        receipt(requestId, commandName, {
          status: 'completed',
          result: await modelAuthProviders(input?.sessionId ?? context.currentSessionId ?? 'dsh-draft'),
          observedAt: new Date().toISOString(),
        })
        return
      }
      case 'skills.reveal': {
        const name = typeof input?.name === 'string' ? input.name : ''
        const target = name ? await skillPathByName(cwd, name) : null
        if (!target) {
          receipt(requestId, commandName, { status: 'failed', error: clientError('NOT_FOUND', `没有找到技能：${name}`), observedAt: new Date().toISOString() })
          return
        }
        if (typeof host.showItem !== 'function') {
          receipt(requestId, commandName, { status: 'failed', error: clientError('CAPABILITY_UNAVAILABLE', '当前外壳没有提供文件管理器定位能力'), observedAt: new Date().toISOString() })
          return
        }
        host.showItem(target)
        receipt(requestId, commandName, { status: 'completed', result: { message: `已在文件管理器中定位技能 ${name}` }, observedAt: new Date().toISOString() })
        return
      }
      case 'skills.revealRoot': {
        const root = await skillRootPath(cwd, input?.scope === 'project' ? 'project' : 'user')
        if (!root) {
          receipt(requestId, commandName, { status: 'failed', error: clientError('NOT_FOUND', '没有找到技能根目录'), observedAt: new Date().toISOString() })
          return
        }
        if (typeof host.openPath !== 'function') {
          receipt(requestId, commandName, { status: 'failed', error: clientError('CAPABILITY_UNAVAILABLE', '当前外壳没有提供打开目录能力'), observedAt: new Date().toISOString() })
          return
        }
        await host.openPath(root)
        receipt(requestId, commandName, { status: 'completed', result: { message: '已打开技能根目录' }, observedAt: new Date().toISOString() })
        return
      }
      case 'workspace.pick': {
        if (typeof host.pickDirectory !== 'function') {
          receipt(requestId, commandName, { status: 'failed', error: clientError('CAPABILITY_UNAVAILABLE', '当前外壳没有提供目录选择器'), observedAt: new Date().toISOString() })
          return
        }
        const picked = await host.pickDirectory()
        if (!picked) {
          receipt(requestId, commandName, { status: 'failed', error: clientError('CANCELLED', '已取消选择文件夹'), observedAt: new Date().toISOString() })
          return
        }
        // 运行时进程与所有 Host 服务都绑定在启动时的工作区；切换需要重启运行时，
        // 这里明确拒绝而不是假装切换成功。
        const windowsRoot = (() => {
          try {
            return uncFromWsl(cwd)
          } catch {
            return cwd
          }
        })()
        if (picked.replaceAll('/', '\\').replace(/\\+$/, '').toLowerCase() !== windowsRoot.replaceAll('/', '\\').replace(/\\+$/, '').toLowerCase()) {
          receipt(requestId, commandName, {
            status: 'failed',
            error: clientError('UNSUPPORTED', `当前工作区固定为 ${workspaceNameFor(cwd)}；切换工作区需要重启桌面端（暂未实现）`),
            observedAt: new Date().toISOString(),
          })
          return
        }
        receipt(requestId, commandName, { status: 'completed', result: await workspaces(), observedAt: new Date().toISOString() })
        return
      }
      case 'workspace.file.writeText': {
        const relative = String(input?.path ?? '')
        try {
          const result = await files().writeText(relative, input)
          const file = result.file ? workspaceFileInfo(workspaceId, result.file) : undefined
          receipt(requestId, commandName, {
            status: 'completed',
            result: file ? { ...result, file } : result,
            observedAt: new Date().toISOString(),
          })
        } catch (error) {
          receipt(requestId, commandName, { status: 'failed', error: fileError(error), observedAt: new Date().toISOString() })
        }
        return
      }
      case 'workspace.file.create': {
        try {
          const result = await files().createFile(String(input?.path ?? ''), { text: input?.text ?? '' })
          receipt(requestId, commandName, { status: 'completed', result, observedAt: new Date().toISOString() })
        } catch (error) {
          receipt(requestId, commandName, { status: 'failed', error: fileError(error), observedAt: new Date().toISOString() })
        }
        return
      }
      case 'workspace.directory.create': {
        try {
          const result = await files().createDirectory(String(input?.path ?? ''))
          receipt(requestId, commandName, { status: 'completed', result, observedAt: new Date().toISOString() })
        } catch (error) {
          receipt(requestId, commandName, { status: 'failed', error: fileError(error), observedAt: new Date().toISOString() })
        }
        return
      }
      case 'fs.file.writeText': {
        try {
          const result = await writeSystemText(String(input?.path ?? ''), input)
          receipt(requestId, commandName, { status: 'completed', result, observedAt: new Date().toISOString() })
        } catch (error) {
          receipt(requestId, commandName, { status: 'failed', error: clientError('INTERNAL', error.message), observedAt: new Date().toISOString() })
        }
        return
      }
      case 'fs.directory.create': {
        const result = await createSystemDirectory(String(input?.parent ?? ''), String(input?.name ?? ''))
        receipt(requestId, commandName, { status: 'completed', result, observedAt: new Date().toISOString() })
        return
      }
      case 'fs.rename': {
        const result = await renameSystemEntry(String(input?.path ?? ''), String(input?.name ?? ''))
        receipt(requestId, commandName, { status: 'completed', result, observedAt: new Date().toISOString() })
        return
      }
      case 'fs.trash': {
        const paths = Array.isArray(input?.paths) ? input.paths : []
        if (typeof host.trash !== 'function') {
          receipt(requestId, commandName, { status: 'failed', error: clientError('CAPABILITY_UNAVAILABLE', '当前外壳没有提供回收站能力'), observedAt: new Date().toISOString() })
          return
        }
        await host.trash(paths.map((item) => toSystemPath(String(item))))
        receipt(requestId, commandName, { status: 'completed', result: { paths }, observedAt: new Date().toISOString() })
        return
      }
      case 'session.speed.get':
      case 'session.tier.get': {
        // 运行时没有速度/服务档位；空结果表示“未配置”。
        receipt(requestId, commandName, { status: 'completed', result: { result: {} }, observedAt: new Date().toISOString() })
        return
      }
      case 'git.execute': {
        try {
          const operation = input?.operation
          if (!operation || typeof operation !== 'object' || typeof operation.kind !== 'string') {
            throw clientError('INVALID_ARGUMENT', '缺少 Git 操作')
          }
          let message
          switch (operation.kind) {
            case 'stage': {
              const staged = await git().stage(operation.paths)
              message = `已暂存 ${staged.paths.length} 个路径`
              break
            }
            case 'unstage': {
              const unstaged = await git().unstage(operation.paths)
              message = `已取消暂存 ${unstaged.paths.length} 个路径`
              break
            }
            case 'discard': {
              const discarded = await git().discard(operation.paths, operation.expectedRevision)
              message = `已丢弃 ${discarded.paths.length} 个路径的工作区改动`
              break
            }
            case 'commit': {
              const committed = await git().commit(operation.message, {
                ...(operation.paths !== undefined ? { paths: operation.paths } : {}),
                ...(operation.amend !== undefined ? { amend: operation.amend } : {}),
                ...(operation.noVerify !== undefined ? { noVerify: operation.noVerify } : {}),
                ...(operation.sign !== undefined ? { sign: operation.sign } : {}),
              })
              message = `已提交 ${committed.oid.slice(0, 7)}：${committed.subject}`
              break
            }
            default:
              throw clientError(
                'CAPABILITY_UNAVAILABLE',
                `Git 操作 ${operation.kind} 尚未接入；X5.3 支持暂存、取消暂存、丢弃和提交`,
              )
          }
          const repository = await gitRepository()
          if (repository.isRepository) {
            emitEvent({
              kind: 'git.repository.changed',
              repository: {
                workspaceId,
                repositoryId: workspaceId,
                ...(repository.revision ? { revision: repository.revision } : {}),
                reason: 'command',
              },
            })
          }
          receipt(requestId, commandName, {
            status: 'completed',
            result: { operation: operation.kind, message, repository, workspaceId },
            observedAt: new Date().toISOString(),
          })
        } catch (error) {
          receipt(requestId, commandName, {
            status: 'failed',
            error: gitFailure(error),
            observedAt: new Date().toISOString(),
          })
        }
        return
      }
      case 'session.model.set':
      case 'session.thinking.set':
      case 'session.speed.set':
      case 'session.tier.set':
      case 'session.drop':
      case 'session.archive':
      case 'session.unarchive':
      case 'session.clearContext':
      case 'session.history.rename':
      case 'session.history.pin':
      case 'session.titles.inspect':
      case 'session.queue.ack':
      case 'session.queue.takeback':
      case 'mode.plan.enter':
      case 'mode.plan.exit':
      case 'mode.plan.review.respond':
      case 'permissions.mode.set':
      case 'approvals.forget':
      case 'runtime.pause':
      case 'runtime.resume': {
        // 这些命令在 DSH 里没有等价实现；返回失败回执，界面会显示下面的中文原因。
        receipt(requestId, commandName, {
          status: 'failed',
          error: clientError('CAPABILITY_UNAVAILABLE', commandUnavailableReason(commandName)),
          observedAt: new Date().toISOString(),
        })
        return
      }
      default:
        console.warn(`[studio-bridge] command not bridged: ${commandName}`)
        receipt(requestId, commandName, {
          status: 'failed',
          error: clientError('CAPABILITY_UNAVAILABLE', commandUnavailableReason(commandName)),
          observedAt: new Date().toISOString(),
        })
    }
  }

  return {
    openContext,
    closeContext,
    bootstrap,
    query,
    command(request, contextId) {
      const { commandName, input, requestId } = request
      const acceptedAt = new Date().toISOString()
      emitEvent({ kind: 'command.accepted', accepted: { commandName, requestId, status: 'accepted', acceptedAt } }, contextId)
      queueMicrotask(() => {
        void runCommand(commandName, input, requestId, contextId).catch((error) => {
          emitReceipt(requestId, commandName, {
            status: 'failed',
            error: clientError('INTERNAL', error.message ?? String(error)),
            observedAt: new Date().toISOString(),
          }, contextId)
        })
      })
      return { commandName, requestId, status: 'accepted', acceptedAt }
    },
    onSessionEvent,
    onStatus,
    onSubagentStarted,
    onSubagentFinished,
    notifyRuntime,
    onApprovalRequest,
    onRequestSettled,
    setServerInfo(info) {
      serverInfo = info
    },
    snapshot,
  }
}

function clientError(code, message) {
  const error = new Error(message)
  error.code = code
  return { code, message }
}

/** Preserve workspace-file failures instead of collapsing them to INTERNAL. */
function fileError(error) {
  const supported = new Set(['INVALID_ARGUMENT', 'NOT_FOUND', 'CONFLICT', 'STORAGE_FAILED', 'PERMISSION_DENIED'])
  const code = supported.has(error?.code) ? error.code : 'INTERNAL'
  return clientError(code, error?.message || '文件操作失败')
}

/** Preserve Git conflict/path errors so Changes can show the real reason. */
function gitFailure(error) {
  const supported = new Set(['INVALID_ARGUMENT', 'NOT_FOUND', 'CONFLICT', 'PERMISSION_DENIED', 'CAPABILITY_UNAVAILABLE', 'FAILED_PRECONDITION'])
  const code = supported.has(error?.code) ? error.code : 'INTERNAL'
  const base = clientError(code, error?.message || 'Git 操作失败')
  return error?.details === undefined ? base : { ...base, details: error.details }
}
