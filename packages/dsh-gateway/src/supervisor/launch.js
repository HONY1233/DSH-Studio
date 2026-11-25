/**
 * supervisor 的纯函数部分。
 *
 * 这里只做「字符串 → 结构」的转换，不碰进程、不碰网络，所以可以全量单测。
 * 进程生命周期在 ./index.js。
 *
 * 所有规则都来自 2026-11-23 的实测（DSH 0.2.2-rc.5）：
 *   - 启动成功后 stdout 打印：`dsh web: http://127.0.0.1:<port>/?token=<token>`
 *   - `GET /connect?token=...&interactions=none` 返回 302 + Set-Cookie
 *   - 401 / 403 是纯文本，不是 JSON
 */

/** ANSI 颜色/光标控制序列。DSH 的日志带颜色，不剥掉会污染正则匹配。 */
const ANSI_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/g

/** 去掉 ANSI 转义，用于日志展示与启动行解析。 */
export function stripAnsi(text) {
  return String(text ?? '').replace(ANSI_PATTERN, '')
}

/**
 * 启动行匹配。
 *
 * 故意放宽了这些地方：
 * - host 允许 127.0.0.1 / localhost / [::1]（不同版本打印不同）
 * - url 与 token 之间允许任意非空白字符（可能有 query 顺序差异）
 * - token 允许 URL-safe 字符集
 *
 * 收紧的地方：必须是 http（不是 https），必须带 token=。
 */
const LAUNCH_PATTERN =
  /(http:\/\/(127\.0\.0\.1|localhost|\[::1\]):(\d+)\/[^\s"'`]*?[?&]token=([A-Za-z0-9._~-]{8,}))/i

/**
 * 从一行日志里解析出启动信息。
 * @param {string} line
 * @returns {{ url: string, host: string, port: number, token: string } | null}
 */
export function parseLaunchLine(line) {
  const clean = stripAnsi(line)
  const match = LAUNCH_PATTERN.exec(clean)
  if (!match) return null
  const port = Number(match[3])
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null
  return { url: match[1], host: match[2], port, token: match[4] }
}

/**
 * 脱敏。两条路一起走，防止某个 secret 漏网：
 * 1. 显式传入的 secrets（token、Cookie 值）逐字替换
 * 2. 兜底正则，任何 `token=<长串>` 形态都替换
 *
 * @param {string} text
 * @param {Iterable<string>} [secrets]
 */
export function redact(text, secrets = []) {
  let out = String(text ?? '')
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length < 4) continue
    out = out.split(secret).join('<redacted>')
  }
  return out.replace(/(token=)[A-Za-z0-9._~-]{8,}/gi, '$1<redacted>')
}

/**
 * 拼 /connect URL。
 *
 * `interactions=none` 是必须的：省略了这个参数，DSH 会要求客户端具备交互能力，
 * 而我们只是拿 Cookie，不做交互。
 */
export function connectUrl(base, token) {
  const url = new URL('/connect', base)
  url.searchParams.set('token', token)
  url.searchParams.set('interactions', 'none')
  return url.toString()
}

/**
 * 把 Set-Cookie 头数组压成一个 Cookie 请求头。
 * 只取 `name=value`，丢弃 Path/HttpOnly/SameSite 这些响应侧属性。
 * @param {string[]} setCookieHeaders
 */
export function cookieFromSetCookie(setCookieHeaders) {
  if (!Array.isArray(setCookieHeaders)) return ''
  const pairs = []
  for (const raw of setCookieHeaders) {
    const head = String(raw).split(';')[0].trim()
    if (!head || !head.includes('=')) continue
    pairs.push(head)
  }
  return pairs.join('; ')
}

/** 从 cookie 串里抽出所有 value，加入脱敏名单。 */
export function cookieSecrets(cookie) {
  if (typeof cookie !== 'string' || cookie.length === 0) return []
  return cookie
    .split(';')
    .map((part) => part.split('=').slice(1).join('=').trim())
    .filter((value) => value.length >= 4)
}

/**
 * 指数退避。
 * @param {number} attempt 第几次重试，从 1 开始
 * @param {{ baseMs?: number, factor?: number, maxMs?: number, jitter?: number, random?: () => number }} [cfg]
 * @returns {number} 毫秒
 */
export function backoffDelay(attempt, cfg = {}) {
  const {
    baseMs = 1000,
    factor = 2,
    maxMs = 30000,
    jitter = 0.2,
    random = Math.random,
  } = cfg

  const step = Math.max(0, Math.floor(Number(attempt) || 0) - 1)
  const raw = Math.min(maxMs, baseMs * Math.pow(factor, step))
  const spread = raw * jitter
  const jittered = raw - spread + random() * spread * 2
  return Math.max(0, Math.round(Math.min(maxMs, jittered)))
}

/**
 * POSIX shell 单参数引用。
 * 注意：这是给 `bash -c` 拼命令用的，不是给 cmd.exe 用的。
 */
export function shellQuote(value) {
  const str = String(value ?? '')
  if (str.length === 0) return "''"
  if (/^[A-Za-z0-9_/.:=@%+,-]+$/.test(str)) return str
  return `'${str.replace(/'/g, `'\\''`)}'`
}

export const DEFAULT_DSH_ARGS = Object.freeze([
  '--profile',
  'web',
  '--port',
  '0',
  '--host',
  '127.0.0.1',
  '--no-open',
])

/**
 * 构造 spawn 计划。Windows 宿主上 DSH 装在 WSL 里，必须经 wsl.exe 转发。
 *
 * 关键决策：
 * - 用 `bash -c` 而不是 `bash -lc`。login shell 会加载 .bashrc/.profile，
 *   可能往 stdout 喷各种提示，污染启动行解析（实测踩过类似坑）。
 * - 环境变量在 WSL 模式下要写进命令前缀，因为宿主 env 不会自动过 WSL 边界。
 * - 不传 `--trusted-host`：实测带 scheme 会让 connection 插件不激活、启动直接失败。
 *
 * @param {{
 *   distro?: string | null,
 *   command?: string,
 *   args?: string[],
 *   env?: Record<string, string>,
 *   platform?: string,
 *   launchId?: string | null,
 * }} [options]
 */
export function buildSpawnPlan(options = {}) {
  const {
    distro = null,
    command = 'dsh',
    args = DEFAULT_DSH_ARGS,
    env = {},
    platform = process.platform,
    launchId = null,
  } = options

  const extraEnv = { ...env }
  if (launchId) extraEnv.DSH_STUDIO_LAUNCH_ID = launchId

  const argv = [command, ...args]
  const remoteCommand = argv.map(shellQuote).join(' ')

  if (distro) {
    const envPrefix = Object.entries(extraEnv)
      .map(([key, value]) => `${key}=${shellQuote(value)}`)
      .join(' ')
    const fullCommand = envPrefix ? `${envPrefix} ${remoteCommand}` : remoteCommand

    return {
      file: platform === 'win32' ? 'wsl.exe' : 'wsl',
      args: ['-d', distro, '-e', 'bash', '-c', fullCommand],
      env: {},
      shell: false,
      wrappedBy: 'wsl',
      distro,
      remoteCommand,
      matchPattern: `${command} ${args.slice(0, 4).join(' ')}`,
    }
  }

  return {
    file: command,
    args: [...args],
    env: extraEnv,
    shell: false,
    wrappedBy: null,
    distro: null,
    remoteCommand,
    matchPattern: `${command} ${args.slice(0, 4).join(' ')}`,
  }
}

/**
 * 行分割器。stdout/stderr 是流，一次 chunk 可能包含多行，也可能半行。
 * 超过上限的残留直接吐出，避免无换行的输出把内存撑爆。
 * @param {(line: string) => void} onLine
 * @param {number} [maxBuffer]
 */
export function createLineReader(onLine, maxBuffer = 64 * 1024) {
  let buffer = ''
  return {
    push(chunk) {
      buffer += String(chunk ?? '')
      let index
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, '')
        buffer = buffer.slice(index + 1)
        if (line.length > 0) onLine(line)
      }
      if (buffer.length > maxBuffer) {
        onLine(buffer)
        buffer = ''
      }
    },
    flush() {
      if (buffer.length > 0) {
        const line = buffer.replace(/\r$/, '')
        buffer = ''
        if (line.length > 0) onLine(line)
      }
    },
  }
}
