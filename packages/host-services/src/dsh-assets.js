/**
 * DSH 资产索引：把运行时真实拥有的插件、命令、工具、技能根、MCP 与 profile 摘要
 * 读成渲染层可用的读模型。
 *
 * 数据源只有三类，全部是只读：
 *   1. `dsh --profile sdk --dump-config`（插件树，子进程 + 缓存）
 *   2. `~/.dsh/profiles/sdk/*.yml`（profile 配置、MCP 服务器声明）
 *   3. `@deepseek-ai/dsh-commands` 的 builtin 表（内置命令；读不到时用同版本 fallback）
 *
 * 保持无 Electron 依赖，testkit 可以直接调用解析函数。
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const DSH_CLI = process.env.DSH_CLI ?? 'dsh'
const DSH_PROFILE = process.env.DSH_PROFILE ?? 'sdk'
const WSL_HOME = process.env.DSH_WSL_HOME ?? '\\\\wsl.localhost\\Ubuntu\\home\\qtt199'
const WSL_HOME_POSIX = process.env.DSH_WSL_HOME_POSIX ?? '/home/qtt199'

/** profile 配置文件在 Windows 侧的路径。 */
export const profileDir = () => `${WSL_HOME}\\.dsh\\profiles\\${DSH_PROFILE}`

// ---- 插件树 ---------------------------------------------------------------

/** 插件短名：去掉 `@deepseek-ai/` 与 `dsh-` 前缀。 */
export function shortPluginName(name) {
  return String(name ?? '')
    .replace(/^@[^/]+\//, '')
    .replace(/^dsh-/, '')
}

/**
 * 按插件职责分组。分组只影响界面归类，不参与任何执行判断。
 */
export function pluginGroup(name) {
  const short = shortPluginName(name)
  if (/^command(-|$)/.test(short) || /^(plan-mode|goal|goal-round-driver|compaction|permission-presets|user-approval|commands|command-feedback)$/.test(short)) return 'command'
  if (/^tool(-|\/|$)/.test(short) || short === 'plugin-manager/tools') return 'tool'
  if (/^skill/.test(short) || short.includes('skill')) return 'skill'
  if (/mcp/.test(short)) return 'mcp'
  if (/^(llm|credentials|deepseek|agent-default-model|model|authorization)/.test(short)) return 'model'
  if (/^(session|storage|projection|persistence|transcript|attachment|spill|checkpoint|token-meter)/.test(short)) return 'session'
  if (/^(plugin-manager|settings|config-editor|subprocess|sandbox|shell-env|fs-sandbox|authorization)/.test(short)) return 'system'
  return 'infra'
}

/**
 * 解析 `--dump-config` 的 YAML 文本。
 *
 * 只取三个字段：插件 id、包名、是否禁用（`!!js` 表达式记为 `conditional`）；
 * 以及 `config:` 块的顶层键名，用来告诉界面"这个插件配了什么"。
 */
export function parsePluginTree(text) {
  const plugins = []
  let current = null
  let inConfig = false
  for (const raw of String(text).split(/\r?\n/)) {
    if (!raw.trim()) continue
    const top = /^- id:\s*(.+)$/.exec(raw)
    if (top) {
      if (current) plugins.push(current)
      current = { id: top[1].trim(), name: '', disabled: false, disabledExpr: null, configKeys: [], config: {}, group: 'infra', shortName: '' }
      inConfig = false
      continue
    }
    if (current === null) continue
    const indent = raw.length - raw.trimStart().length
    const body = raw.trim()
    if (indent === 2) {
      inConfig = false
      const name = /^name:\s*(.+)$/.exec(body)
      if (name) {
        current.name = name[1].trim().replace(/^['"]|['"]$/g, '')
        current.shortName = shortPluginName(current.name)
        current.group = pluginGroup(current.name)
        continue
      }
      const disabled = /^disabled:\s*(.*)$/.exec(body)
      if (disabled) {
        const value = disabled[1].trim()
        if (/^!!js/.test(value)) {
          current.disabled = 'conditional'
          current.disabledExpr = value.replace(/^!!js\s*/, '')
        } else {
          current.disabled = /^(true|yes|on|1)$/i.test(value)
        }
        continue
      }
      if (/^config:\s*$/.test(body)) inConfig = true
      continue
    }
    if (inConfig && indent >= 4) {
      const match = /^([A-Za-z0-9_./-]+):\s*(.*)$/.exec(body)
      if (!match) continue
      if (indent === 4) current.configKeys.push(match[1])
      const value = match[2].trim()
      // 只收标量；`!!js` 表达式与块标量（`>-`）无法静态求值，跳过。
      if (value && !/^(!!js|[|>])/.test(value) && indent === 4) {
        current.config[match[1]] = value.replace(/^['"]|['"]$/g, '')
      }
    }
  }
  if (current) plugins.push(current)
  return plugins
}

/** 插件树汇总：总数、按组计数、禁用数。 */
export function summarizePlugins(plugins) {
  const groups = {}
  let disabled = 0
  for (const row of plugins) {
    groups[row.group] = (groups[row.group] ?? 0) + 1
    if (row.disabled === true) disabled += 1
  }
  return { total: plugins.length, groups, disabled }
}

const emptySummary = () => ({ total: 0, groups: {}, disabled: 0 })

let pluginCache = { plugins: [], summary: emptySummary(), at: 0, reason: null }

/**
 * 读取插件树；默认 60 秒缓存。刷新失败时返回上一次成功的结果并标记 `stale`，
 * 绝不假装"插件树为空"。
 */
export async function readPluginTree({ maxAgeMs = 60_000, force = false } = {}) {
  const now = Date.now()
  if (!force && pluginCache.at > 0 && now - pluginCache.at < maxAgeMs) {
    return { ...pluginCache, cached: true, stale: false, fetchedAt: new Date(pluginCache.at).toISOString() }
  }
  try {
    const { stdout } = await execFileAsync(
      'wsl.exe',
      ['-e', 'bash', '-lc', `${DSH_CLI} --profile ${DSH_PROFILE} --dump-config`],
      { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
    )
    const plugins = parsePluginTree(stdout)
    pluginCache = { plugins, summary: summarizePlugins(plugins), at: now, reason: null }
    return { ...pluginCache, cached: false, stale: false, fetchedAt: new Date(now).toISOString() }
  } catch (error) {
    const reason = `无法读取 DSH 插件树：${error.message}`
    if (pluginCache.at > 0) {
      return { ...pluginCache, cached: true, stale: true, reason, fetchedAt: new Date(pluginCache.at).toISOString() }
    }
    return { plugins: [], summary: emptySummary(), at: 0, cached: false, stale: true, reason, fetchedAt: null }
  }
}

// ---- 内置命令 -------------------------------------------------------------

/**
 * `@deepseek-ai/dsh-commands` 的 builtin 表（0.2.2-rc.5）。
 * 读取顺序：优先从 WSL 里的 `src/builtin.ts` 解析；失败时用这份同版本副本。
 */
const BUILTIN_FALLBACK = [
  { name: 'goal', definitionId: '@deepseek-ai/dsh-command-goal', plugin: 'dsh-goal-round-driver', tokens: { en: 'goal', zh: '目标' }, desc: '设置或查看当前会话的目标' },
  { name: 'plan', definitionId: '@deepseek-ai/dsh-plan-mode', plugin: 'dsh-plan-mode', tokens: { en: 'plan', zh: '计划' }, desc: '进入或退出计划模式' },
  { name: 'feedback', definitionId: '@deepseek-ai/dsh-command-feedback', plugin: 'dsh-command-feedback', tokens: { en: 'feedback', zh: '反馈' }, desc: '对当前回答提交反馈' },
  { name: 'compact', definitionId: '@deepseek-ai/dsh-command-compact', plugin: 'dsh-command-compact', tokens: { en: 'compact', zh: '压缩' }, desc: '压缩会话上下文' },
  { name: 'permission', definitionId: '@deepseek-ai/dsh-permission-presets', plugin: 'dsh-permission-presets', tokens: { en: 'permission', zh: '权限' }, desc: '切换权限预设' },
  { name: 'export', definitionId: '@deepseek-ai/dsh-session-log-export', plugin: 'dsh-session-log-export', tokens: { en: 'export', zh: '导出' }, desc: '导出会话记录' },
]

/** 从 builtin.ts 文本里解析 BUILTINS 与中英文 token；解析失败返回 null。 */
export function parseBuiltinSource(text) {
  const source = String(text)
  const block = /const BUILTINS = \{([\s\S]*?)\} as const/.exec(source)
  if (!block) return null
  // DSH 把多个键写在同一行（`en: { goal: 'goal', plan: 'plan', ... }`），
  // 所以按逗号切分而不是按行切分。
  const pairs = (chunk) => {
    const out = {}
    for (const part of chunk.split(',')) {
      const row = /^\s*([a-z][a-z-]*):\s*'([^']+)'\s*$/.exec(part.trim())
      if (row) out[row[1]] = row[2]
    }
    return out
  }
  const ids = pairs(block[1])
  const tokens = {}
  for (const lang of ['en', 'zh']) {
    const block = new RegExp(`\\b${lang}:\\s*\\{([^}]*)\\}`).exec(source)
    tokens[lang] = block ? pairs(block[1]) : {}
  }
  const names = Object.keys(ids)
  if (names.length === 0) return null
  return names.map((name) => ({
    name,
    definitionId: ids[name],
    plugin: ids[name].replace(/^@deepseek-ai\//, ''),
    tokens: { en: tokens.en[name] ?? name, zh: tokens.zh[name] ?? name },
    desc: '',
  }))
}

let builtinCache = null

/**
 * 内置命令清单。`available` 表示对应插件是否在当前 profile 里挂载。
 */
export async function readBuiltinCommands(plugins = []) {
  if (builtinCache === null) {
    const candidates = [
      `${WSL_HOME}\\..\\..\\..\\opt\\node-v24.9.0-linux-x64\\lib\\node_modules\\@deepseek-ai\\dsh\\node_modules\\@deepseek-ai\\dsh-commands\\src\\builtin.ts`,
    ]
    let parsed = null
    for (const file of candidates) {
      if (!existsSync(file)) continue
      try {
        parsed = parseBuiltinSource(await readFile(file, 'utf8'))
        if (parsed) break
      } catch {
        /* 继续尝试下一个候选路径 */
      }
    }
    const base = parsed ?? BUILTIN_FALLBACK
    // fallback 自带中文描述；源码解析出来的补上同版本文案。
    const described = base.map((row) => {
      const known = BUILTIN_FALLBACK.find((item) => item.name === row.name)
      return {
        ...row,
        desc: row.desc || known?.desc || '',
        tokens: { en: row.tokens?.en ?? row.name, zh: row.tokens?.zh ?? known?.tokens.zh ?? row.name },
      }
    })
    builtinCache = described
  }
  const installed = new Set(plugins.map((row) => row.name))
  return builtinCache.map((row) => ({
    ...row,
    available: installed.size === 0 ? true : installed.has(row.definitionId),
  }))
}

// ---- 工具目录 -------------------------------------------------------------

/** 工具插件的展示信息；未列出的按插件短名展示。 */
const TOOL_INFO = {
  'tool-bash': { label: 'Bash', category: '终端', desc: '在 WSL 里执行 bash 命令' },
  'tool-pwsh': { label: 'PowerShell', category: '终端', desc: '在 Windows 上执行 PowerShell' },
  'tool-jobs': { label: '后台作业', category: '终端', desc: '启动与查看后台运行的作业' },
  'tool-fs': { label: '文件读写', category: '文件', desc: '读取、写入、编辑工作区文件' },
  'tool-fs-search': { label: '文件搜索', category: '文件', desc: '按名称或内容搜索文件' },
  'tool-skill': { label: '技能调用', category: '技能', desc: '按需加载并执行本地技能' },
  'tool-web': { label: '联网', category: '联网', desc: '网页搜索与网页抓取' },
  'tool-todo': { label: '待办', category: '协作', desc: '维护会话内待办清单' },
  'tool-goal': { label: '目标', category: '协作', desc: '读取与更新会话目标' },
  'tool-office': { label: 'Office 文档', category: '文档', desc: '读写 docx / xlsx / pptx / pdf' },
  'tool-schedule': { label: '定时任务', category: '自动化', desc: '创建与管理定时任务' },
  'tool-ask-user': { label: '向用户提问', category: '交互', desc: '需要决策时向用户提问' },
  'tool-present': { label: '结构化展示', category: '交互', desc: '向用户呈现结构化内容' },
  'tool-subagent': { label: '子 Agent', category: 'Agent', desc: '派生子 Agent 执行子任务' },
  'tool-subagent-control': { label: '子 Agent 控制', category: 'Agent', desc: '等待、查询子 Agent 状态' },
  'tool-agent-team': { label: 'Agent 团队', category: 'Agent', desc: '组织多个 Agent 协作' },
  'tool-workflow': { label: '工作流', category: 'Agent', desc: '用脚本编排多步任务' },
  'tool-workspace-dependencies': { label: '工作区依赖', category: '工程', desc: '查看工作区依赖关系' },
  'plugin-manager/tools': { label: '插件管理', category: '系统', desc: '查询与启停插件' },
}

/** 由插件树推导工具清单。 */
export function deriveToolCatalog(plugins) {
  const tools = []
  for (const row of plugins) {
    if (row.group !== 'tool') continue
    const info = TOOL_INFO[row.shortName] ?? { label: row.shortName.replace(/^tool-/, ''), category: '其它', desc: '' }
    tools.push({
      id: row.shortName,
      label: info.label,
      category: info.category,
      desc: info.desc,
      plugin: row.name,
      enabled: row.disabled !== true,
    })
  }
  return tools.sort((left, right) => left.category.localeCompare(right.category) || left.label.localeCompare(right.label))
}

// ---- profile 与 MCP -------------------------------------------------------

async function readProfileFile(name) {
  const file = `${profileDir()}\\${name}`
  if (!existsSync(file)) return null
  try {
    return await readFile(file, 'utf8')
  } catch {
    return null
  }
}

/**
 * profile 摘要：默认模型、沙箱、权限预设，以及 patch 是否为空。
 * 优先从插件树读（dump-config 是展开后的真实组合），文件读取只作兜底。
 */
export async function readProfileSummary(plugins = []) {
  const [main, patch] = await Promise.all([readProfileFile('cordis.yml'), readProfileFile('cordis.patch.yml')])
  const pick = (text, re) => {
    if (!text) return null
    const match = re.exec(text)
    return match ? match[1].trim() : null
  }
  const byId = new Map(plugins.map((row) => [row.id, row]))
  const modelPlugin = byId.get('agent-default-model')
  const has = (short) => plugins.some((row) => row.shortName === short)
  return {
    profile: DSH_PROFILE,
    path: profileDir(),
    defaultProvider: modelPlugin?.config?.provider ?? pick(main, /provider:\s*([\w-]+)/),
    defaultModel: modelPlugin?.config?.model ?? pick(main, /model:\s*([\w.-]+)/),
    sandbox: {
      bash: has('bash-sandbox'),
      pwsh: has('pwsh-sandbox'),
    },
    permissionPresets: has('permission-presets'),
    patchEmpty: patch === null ? null : patch.trim().length === 0 || /^\[\]\s*$/.test(patch.trim()),
    readFailed: main === null && plugins.length === 0,
  }
}

/** DSH transport → public inventory transport。未知值不猜成 stdio。 */
function publicMcpTransport(value) {
  if (value === 'stdio') return 'stdio'
  if (value === 'streamable-http' || value === 'http') return 'http'
  if (value === 'sse') return 'sse'
  return 'unknown'
}

/**
 * 当前 DSH 使用一个 dsh-mcp-client 插件注册一个服务器。只投影名称、transport
 * 与 disabled；command/args/env/url/headers 等敏感或无关字段绝不进入读模型。
 */
export function mcpServersFromPluginTree(plugins) {
  return plugins.filter((row) => row.shortName === 'mcp-client').flatMap((row) => {
    const name = row.config?.serverName || row.id
    if (!name) return []
    const enabled = row.disabled !== true && row.disabled !== 'conditional'
    return [{
      name,
      transport: publicMcpTransport(row.config?.transport),
      enabled,
      status: enabled ? 'enabled' : 'disabled',
      ...(row.disabled === 'conditional' ? { reason: '按 profile 条件启用（disabled 为表达式）' } : {}),
    }]
  })
}

/** 兼容旧 profile 的 `servers:` 块；同样只读取非敏感元数据。 */
export function parseLegacyMcpServers(texts) {
  const servers = []
  for (const text of texts) {
    if (!text) continue
    const block = /servers:\s*\n((?:\s+-[\s\S]*?)(?=\n\S|\n*$))/.exec(text)
    if (!block) continue
    let current = null
    const flush = () => { if (current) servers.push(current); current = null }
    for (const line of block[1].split('\n')) {
      const name = /^\s*-\s*name:\s*(.+)$/.exec(line) ?? /^\s*([\w-]+):\s*$/.exec(line)
      if (name) {
        flush()
        current = { name: name[1].trim().replace(/^['"]|['"]$/g, ''), transport: 'unknown', enabled: true, status: 'enabled' }
        continue
      }
      if (!current) continue
      const transport = /^\s*transport:\s*(.+)$/.exec(line)
      if (transport) current.transport = publicMcpTransport(transport[1].trim().replace(/^['"]|['"]$/g, ''))
      if (/^\s*command:\s*(.+)$/.test(line) && current.transport === 'unknown') current.transport = 'stdio'
      if (/^\s*url:\s*(.+)$/.test(line) && current.transport === 'unknown') current.transport = 'http'
    }
    flush()
  }
  return servers
}

/**
 * MCP 服务器。sdk profile 没有挂载 `dsh-mcp-client` 时，任何服务器都不会生效，
 * 所以这里同时返回"是否配置过"和"为什么没生效"。enabled/status 仅配置状态，
 * 不是 connected；真实连接探测在当前 Desktop 尚未实现。
 */
export async function readMcpServers() {
  const [main, patch, tree] = await Promise.all([
    readProfileFile('cordis.yml'),
    readProfileFile('cordis.patch.yml'),
    readPluginTree(),
  ])
  const hasClient = /dsh-mcp-client/.test(main ?? '') || /dsh-mcp-client/.test(patch ?? '')
    || tree.plugins.some((row) => row.shortName === 'mcp-client')
  const current = mcpServersFromPluginTree(tree.plugins)
  const servers = current.length > 0 ? current : parseLegacyMcpServers([main, patch])
  const unknownTransport = servers.filter((row) => row.transport === 'unknown')
  return {
    servers,
    configured: servers.length > 0,
    clientMounted: hasClient,
    configPath: `${profileDir()}\\cordis.patch.yml`,
    ...(unknownTransport.length > 0
      ? { guidance: '发现 MCP 配置，但部分条目的 transport 无法识别；未推断为 stdio，也未执行连接。' }
      : servers.length === 0
        ? {
            guidance: hasClient
              ? '已挂载 dsh-mcp-client，但还没有服务器条目；请在 profile 配置 serverName 与 transport 后重启运行时。'
              : '当前 profile 没有挂载 dsh-mcp-client，也没有 MCP 服务器配置；如需使用 MCP，需要挂载 dsh-mcp-client 并添加服务器条目。',
          }
        : {}),
  }
}

// ---- 技能根扩展 -----------------------------------------------------------

/**
 * 在基础技能根之外补上 profile 里声明的自定义目录与 bundled 目录。
 * `customSkillDirs` 来自 `dsh-skill-filesystem` 的配置。
 */
export async function readSkillRootExtras() {
  const [main, patch] = await Promise.all([readProfileFile('cordis.yml'), readProfileFile('cordis.patch.yml')])
  const custom = []
  for (const text of [main, patch]) {
    if (!text) continue
    const block = /customSkillDirs:\s*\n((?:\s+-[\s\S]*?)(?=\n\s{0,3}\w|\n*$))/.exec(text)
      ?? /customSkillDirs:\s*\[([^\]]*)\]/.exec(text)
    if (!block) continue
    for (const line of block[1].split(/[\n,]/)) {
      const value = /['"]?(\/[\w./-]+)['"]?/.exec(line.trim())
      if (value && !custom.includes(value[1])) custom.push(value[1])
    }
  }
  const bundled = /bundledSkillDir:\s*['"]?([^'"\n]+)/.exec(main ?? '')?.[1]?.trim() ?? null
  return { customSkillDirs: custom, bundledSkillDir: bundled ?? (process.env.DSH_BUNDLED_SKILL_DIR || null) }
}

/** 供桥一次性拿到的资产总览。 */
export async function readAssetOverview({ forcePlugins = false } = {}) {
  const tree = await readPluginTree({ force: forcePlugins })
  const [commands, summary, mcp, skillExtras] = await Promise.all([
    readBuiltinCommands(tree.plugins),
    readProfileSummary(tree.plugins),
    readMcpServers(),
    readSkillRootExtras(),
  ])
  const tools = deriveToolCatalog(tree.plugins)
  return {
    generatedAt: new Date().toISOString(),
    plugins: tree.plugins,
    pluginSummary: tree.summary,
    pluginState: { cached: tree.cached, stale: tree.stale, reason: tree.reason ?? null, fetchedAt: tree.fetchedAt },
    commands,
    tools,
    toolGroups: [...new Set(tools.map((row) => row.category))],
    profile: summary,
    mcp,
    skillExtras,
    wslHome: WSL_HOME_POSIX,
  }
}
