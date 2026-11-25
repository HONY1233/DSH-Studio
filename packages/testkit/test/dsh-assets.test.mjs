import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  deriveToolCatalog,
  mcpServersFromPluginTree,
  parseBuiltinSource,
  parseLegacyMcpServers,
  parsePluginTree,
  pluginGroup,
  shortPluginName,
  summarizePlugins,
} from '../../host-services/src/dsh-assets.js'

// 取自 `dsh --profile sdk --dump-config` 的真实片段，覆盖三种形态：
// 纯声明、带 config 块、带 !!js 条件禁用。
const DUMP = `- id: plugin-package-inventory-deepseek
  name: '@deepseek-ai/dsh-plugin-package-inventory-deepseek'
- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: deepseek-official
    model: deepseek-flash
- id: config-editor
  name: '@deepseek-ai/dsh-config-editor'
  disabled: !!js '!ctx.get(''profileContext'')'
- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'
- id: tool-fs
  name: '@deepseek-ai/dsh-tool-fs'
- id: plan-mode
  name: '@deepseek-ai/dsh-plan-mode'
- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
- id: mcp-resources
  name: '@deepseek-ai/dsh-mcp-resources'
- id: plugin-manager-tools
  name: '@deepseek-ai/dsh-plugin-manager/tools'
`

test('parses the dump-config plugin tree', () => {
  const plugins = parsePluginTree(DUMP)
  assert.equal(plugins.length, 9)
  assert.equal(plugins[0].id, 'plugin-package-inventory-deepseek')
  assert.equal(plugins[0].shortName, 'plugin-package-inventory-deepseek')
  // config 块的顶层键被记录，嵌套值不进读模型
  assert.deepEqual(plugins[1].configKeys, ['provider', 'model'])
  // !!js 表达式不能静态求值，标记为 conditional
  assert.equal(plugins[2].disabled, 'conditional')
  assert.equal(plugins[2].disabledExpr, "'!ctx.get(''profileContext'')'")
  // 未声明 disabled 的插件默认启用
  assert.equal(plugins[3].disabled, false)
})

test('groups plugins by responsibility', () => {
  assert.equal(pluginGroup('@deepseek-ai/dsh-tool-bash'), 'tool')
  assert.equal(pluginGroup('@deepseek-ai/dsh-plugin-manager/tools'), 'tool')
  assert.equal(pluginGroup('@deepseek-ai/dsh-plan-mode'), 'command')
  assert.equal(pluginGroup('@deepseek-ai/dsh-command-compact'), 'command')
  assert.equal(pluginGroup('@deepseek-ai/dsh-skill-filesystem'), 'skill')
  assert.equal(pluginGroup('@deepseek-ai/dsh-mcp-resources'), 'mcp')
  assert.equal(pluginGroup('@deepseek-ai/dsh-llm-deepseek-api-key'), 'model')
  assert.equal(pluginGroup('@deepseek-ai/dsh-session-projection'), 'session')
})

test('summary counts groups and disabled plugins', () => {
  const summary = summarizePlugins(parsePluginTree(DUMP))
  assert.equal(summary.total, 9)
  assert.equal(summary.groups.tool, 3)
  assert.equal(summary.groups.command, 1)
  // conditional 不算硬禁用
  assert.equal(summary.disabled, 0)
})

test('derives a tool catalog from tool plugins', () => {
  const tools = deriveToolCatalog(parsePluginTree(DUMP))
  const ids = tools.map((row) => row.id)
  assert.ok(ids.includes('tool-bash'))
  assert.ok(ids.includes('tool-fs'))
  assert.ok(ids.includes('plugin-manager/tools'))
  const bash = tools.find((row) => row.id === 'tool-bash')
  assert.equal(bash.category, '终端')
  assert.equal(bash.enabled, true)
})

test('parses builtin command ids and zh/en tokens', () => {
  const source = `
const BUILTINS = {
  goal: '@deepseek-ai/dsh-command-goal',
  plan: '@deepseek-ai/dsh-plan-mode',
  compact: '@deepseek-ai/dsh-command-compact',
} as const
export const builtinCommandTokens = {
  en: { goal: 'goal', plan: 'plan', compact: 'compact' },
  zh: { goal: '目标', plan: '计划', compact: '压缩' },
} as const
`
  const parsed = parseBuiltinSource(source)
  assert.equal(parsed.length, 3)
  const plan = parsed.find((row) => row.name === 'plan')
  assert.equal(plan.definitionId, '@deepseek-ai/dsh-plan-mode')
  assert.deepEqual(plan.tokens, { en: 'plan', zh: '计划' })
})

test('ignores malformed builtin source instead of throwing', () => {
  assert.equal(parseBuiltinSource('not yaml at all'), null)
  assert.equal(shortPluginName('@deepseek-ai/dsh-tool-fs'), 'tool-fs')
})

test('current MCP registrations expose only safe configured metadata', () => {
  const plugins = parsePluginTree(`- id: mcp-local
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: local
    transport: stdio
    command: secret-command
    env:
      TOKEN: secret-value
- id: mcp-web
  name: '@deepseek-ai/dsh-mcp-client'
  disabled: true
  config:
    serverName: web
    transport: streamable-http
    url: https://secret.example/mcp
- id: mcp-unknown
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: unknown
`)
  const servers = mcpServersFromPluginTree(plugins)
  assert.deepEqual(servers.map(({ name, transport, enabled, status }) => ({ name, transport, enabled, status })), [
    { name: 'local', transport: 'stdio', enabled: true, status: 'enabled' },
    { name: 'web', transport: 'http', enabled: false, status: 'disabled' },
    { name: 'unknown', transport: 'unknown', enabled: true, status: 'enabled' },
  ])
  for (const server of servers) {
    assert.equal('command' in server, false)
    assert.equal('env' in server, false)
    assert.equal('url' in server, false)
  }
})

test('legacy MCP blocks infer transport only from explicit non-secret fields', () => {
  const servers = parseLegacyMcpServers([`servers:
  - name: local
    transport: stdio
    command: secret-command
  - name: web
    url: https://secret.example/mcp
  - name: unknown
`])
  assert.deepEqual(servers.map(({ name, transport }) => ({ name, transport })), [
    { name: 'local', transport: 'stdio' },
    { name: 'web', transport: 'http' },
    { name: 'unknown', transport: 'unknown' },
  ])
})
