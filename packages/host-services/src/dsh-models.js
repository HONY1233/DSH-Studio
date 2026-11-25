/**
 * DSH 运行时模型目录（只读）。
 *
 * 「Runtime 验证」的语义是：模型来自当前运行中的 DSH 安装，而不是界面里写死的
 * 推荐列表。DSH 的内置目录定义在 `@deepseek-ai/dsh-llm-deepseek` 的
 * `src/models.ts` 与 `src/defaults.ts` 里（llm-deepseek 默认目录），这里直接读
 * 这两个文件，所以换一个 DSH 版本，模型名与上下文窗口会跟着变。
 *
 * 读不到安装目录时返回 `source: "fallback"`，调用方必须据此标记「未验证」，
 * 不允许把 fallback 当作运行时事实。
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const WSL_HOME = process.env.DSH_WSL_HOME ?? '\\\\wsl.localhost\\Ubuntu\\home\\qtt199'
const WSL_HOME_POSIX = process.env.DSH_WSL_HOME_POSIX ?? '/home/qtt199'
const INSTALL_ROOT_OVERRIDE = process.env.DSH_INSTALL_ROOT ?? null

/** DSH 的默认模型供应商 route（事件流里的 provider 值）。 */
export const DEFAULT_PROVIDER = 'deepseek-official'

/** 同版本兜底目录：只在读不到安装目录时使用，永远标记为未验证。 */
const FALLBACK_MODELS = [
  { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', contextWindow: 1_048_576, image: true },
  { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', contextWindow: 1_048_576, image: false },
]

/** 任意 WSL 路径转 Windows 路径；`/mnt/*` 与用户目录之外的根目录都能读。 */
function uncFromAnyWsl(posixPath) {
  const drive = /^\/mnt\/([a-z])\/(.*)$/i.exec(posixPath)
  if (drive) return `${drive[1].toUpperCase()}:\\${drive[2].replaceAll('/', '\\')}`
  if (posixPath === WSL_HOME_POSIX) return WSL_HOME
  if (posixPath.startsWith(`${WSL_HOME_POSIX}/`)) {
    return `${WSL_HOME}${posixPath.slice(WSL_HOME_POSIX.length).replaceAll('/', '\\')}`
  }
  return `\\\\wsl.localhost\\Ubuntu${posixPath.replaceAll('/', '\\')}`
}

let installRootCache

const INSTALL_SUFFIXES = [
  // 全局安装的入口：/opt/node-v24.9.0-linux-x64/lib/node_modules/@deepseek-ai/dsh/lib/bin.js
  '/lib/node_modules/@deepseek-ai/dsh/lib/bin.js',
  // 某些安装会把 bin 直接放在前缀下。
  '/bin/dsh',
]

/** 解析 DSH 安装前缀（含 `bin/` 与 `lib/node_modules/` 的目录）。 */
async function resolveInstallRoot() {
  if (installRootCache !== undefined) return installRootCache
  if (INSTALL_ROOT_OVERRIDE) {
    installRootCache = INSTALL_ROOT_OVERRIDE
    return installRootCache
  }
  for (const link of ['/usr/local/bin/dsh', '/usr/bin/dsh']) {
    try {
      const { stdout } = await execFileAsync('wsl.exe', ['-e', 'bash', '-lc', `readlink -f ${link}`], { timeout: 10_000 })
      const real = stdout.trim()
      const suffix = INSTALL_SUFFIXES.find((item) => real.endsWith(item))
      if (suffix) {
        installRootCache = real.slice(0, -suffix.length)
        return installRootCache
      }
    } catch {
      /* 尝试下一个候选路径 */
    }
  }
  installRootCache = null
  return installRootCache
}

/** `@deepseek-ai` scoped 包目录；不存在时返回 null。 */
async function packageDir(name) {
  const root = await resolveInstallRoot()
  if (!root) return null
  const posix = `${root}/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/${name}`
  const dir = uncFromAnyWsl(posix)
  return existsSync(dir) ? dir : null
}

/** 解析 `models.ts` 里的 `DEFAULT_MODELS`；坏输入返回空数组。 */
export function parseBuiltinModels(source) {
  const text = String(source ?? '')
  const block = /DEFAULT_MODELS[^=]*=\s*\[([\s\S]*?)\n\]/.exec(text)
  if (!block) return []
  // 常量引用（如 OFFICIAL_CONTEXT_WINDOW）需要就地展开。
  const constants = {}
  for (const row of text.matchAll(/const\s+([A-Z][A-Z0-9_]*)\s*=\s*([0-9][0-9_]*)/g)) {
    constants[row[1]] = Number(row[2].replaceAll('_', ''))
  }
  const numeric = (raw) => {
    if (!raw) return null
    const value = raw.trim()
    if (/^[0-9][0-9_]*$/.test(value)) return Number(value.replaceAll('_', ''))
    return constants[value] ?? null
  }
  const models = []
  for (const entry of block[1].matchAll(/\{[^{}]*\}/g)) {
    const body = entry[0]
    const id = /id:\s*'([^']+)'/.exec(body)?.[1]
    if (!id) continue
    const name = /name:\s*'([^']+)'/.exec(body)?.[1] ?? id
    const description = /description:\s*'([^']+)'/.exec(body)?.[1] ?? ''
    const contextWindow = numeric(/contextWindow:\s*([A-Za-z0-9_]+)/.exec(body)?.[1])
    const modalities = /inputModalities:\s*\[([^\]]*)\]/.exec(body)?.[1] ?? ''
    models.push({
      id,
      name,
      description,
      contextWindow,
      image: /['"]image['"]/.test(modalities),
    })
  }
  return models
}

/** 解析 `defaults.ts` 里的 `DEFAULT_MAX_TOKENS`；缺省返回 null。 */
export function parseDefaultMaxTokens(source) {
  const match = /DEFAULT_MAX_TOKENS\s*=\s*([0-9][0-9_]*)/.exec(String(source ?? ''))
  return match ? Number(match[1].replaceAll('_', '')) : null
}

let catalogCache = { value: null, at: 0 }

/**
 * 读运行时模型目录。默认 60 秒缓存；失败时保留上一次成功结果并标记 `stale`。
 *
 * @returns {{
 *   source: 'runtime' | 'fallback',
 *   provider: string,
 *   version: string | null,
 *   maxTokens: number | null,
 *   contextWindow: number | null,
 *   models: Array<{ id: string, name: string, contextWindow: number | null, image: boolean }>,
 *   reason: string | null,
 *   cached: boolean,
 *   stale: boolean,
 *   fetchedAt: string | null,
 * }}
 */
export async function readRuntimeModelCatalog({ maxAgeMs = 60_000, force = false } = {}) {
  const now = Date.now()
  if (!force && catalogCache.value && now - catalogCache.at < maxAgeMs) {
    return { ...catalogCache.value, cached: true, stale: false }
  }
  const fail = (reason) => {
    if (catalogCache.value) return { ...catalogCache.value, cached: true, stale: true, reason }
    return {
      source: 'fallback',
      provider: DEFAULT_PROVIDER,
      version: null,
      maxTokens: 256_000,
      contextWindow: 1_000_000,
      models: FALLBACK_MODELS.map((row) => ({ ...row })),
      reason,
      cached: false,
      stale: true,
      fetchedAt: null,
    }
  }
  try {
    const dir = await packageDir('dsh-llm-deepseek')
    if (!dir) return fail('没有找到 DSH 安装目录，无法读取运行时模型目录')
    const [modelsSource, defaultsSource, manifest] = await Promise.all([
      readFile(`${dir}\\src\\models.ts`, 'utf8').catch(() => ''),
      readFile(`${dir}\\src\\defaults.ts`, 'utf8').catch(() => ''),
      readFile(`${dir}\\package.json`, 'utf8').catch(() => '{}'),
    ])
    const models = parseBuiltinModels(modelsSource)
    if (models.length === 0) return fail('DSH 模型目录为空：models.ts 无法解析')
    let version = null
    try {
      version = JSON.parse(manifest)?.version ?? null
    } catch {
      version = null
    }
    const value = {
      source: 'runtime',
      provider: DEFAULT_PROVIDER,
      version,
      maxTokens: parseDefaultMaxTokens(defaultsSource),
      contextWindow: models.find((row) => Number.isFinite(row.contextWindow))?.contextWindow ?? null,
      models,
      reason: null,
      cached: false,
      stale: false,
      fetchedAt: new Date(now).toISOString(),
    }
    catalogCache = { value, at: now }
    return value
  } catch (error) {
    return fail(`读取 DSH 模型目录失败：${error.message}`)
  }
}
