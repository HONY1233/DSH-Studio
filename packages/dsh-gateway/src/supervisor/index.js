/**
 * 运行时进程守护。
 *
 * 职责（单一）：让 `dsh --profile web` 这个子进程处于「可用」状态，并交出
 * 访问它所需的 { base, port, cookie }。除此之外什么都不做——不解析业务事件、
 * 不做命令路由，那是 transport / projector 的事。
 *
 * 实测约束（2026-11-23，DSH 0.2.2-rc.5）：
 * 1. 启动行形如 `dsh web: http://127.0.0.1:<port>/?token=<token>`，只能从 stdout 抓。
 * 2. `GET /connect?token=...&interactions=none` → 302 + Set-Cookie，这是唯一的认证入口。
 * 3. Cookie 与 Peer 绑定，Peer 随 socket 关闭销毁 → transport 重连后必须重新调用
 *    `refreshCookie()`，否则后续请求全部 401。
 * 4. 不能用 `--trusted-host app://xxx`：带 scheme 会让 connection 插件不激活、启动失败。
 *
 * 状态机：
 *   idle → starting → connecting → ready
 *                        ↑            │
 *                   restarting ←──────┘（崩溃或失败，退避后重来）
 *   ready/restarting → stopping → stopped
 *   达到重试上限 → failed
 */

import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'

import { ErrorCode, describeError } from '../wire/errors.js'
import {
  DEFAULT_DSH_ARGS,
  backoffDelay,
  buildSpawnPlan,
  connectUrl,
  cookieFromSetCookie,
  cookieSecrets,
  createLineReader,
  parseLaunchLine,
  redact,
  shellQuote,
} from './launch.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export const SupervisorState = Object.freeze({
  idle: 'idle',
  starting: 'starting',
  connecting: 'connecting',
  ready: 'ready',
  restarting: 'restarting',
  stopping: 'stopping',
  stopped: 'stopped',
  failed: 'failed',
})

const DEFAULTS = Object.freeze({
  /** WSL 发行版名。为 null 表示 dsh 直接跑在宿主上（测试用）。 */
  distro: 'ubuntu',
  command: 'dsh',
  args: DEFAULT_DSH_ARGS,
  env: {},
  /** 从 spawn 到抓到启动行的上限。Cordis 插件树冷启动实测要十几秒，留足余量。 */
  launchTimeoutMs: 90_000,
  /** 拿到 token 后换 Cookie 的上限（含重试总预算）。 */
  connectTimeoutMs: 15_000,
  /**
   * connect 的连接级重试次数 / 间隔。
   *
   * 这个参数不是拍脑袋：实测发现 DSH 打印启动行之后，HTTP 服务（或 WSL2 的
   * localhost 端口转发）还需要一小段时间才接受连接，立即 fetch 会 ECONNREFUSED。
   * 401/403 不重试——能返回状态码就说明连接已经通了。
   */
  connectAttempts: 12,
  connectRetryDelayMs: 300,
  /** 停止时等 SIGTERM 生效的时间。 */
  stopGraceMs: 5_000,
  /** ready 后连续存活这么久，就认为启动稳定，把重试计数清零。 */
  stableMs: 60_000,
  /** 连续失败多少次后放弃。 */
  maxRestarts: 5,
  backoff: { baseMs: 1_000, factor: 2, maxMs: 30_000, jitter: 0.2 },
  autoRestart: true,
  /** 注入点：测试可替换 */
  spawnImpl: spawn,
  fetchImpl: (...args) => fetch(...args),
  now: () => Date.now(),
})

/**
 * @typedef {Object} SupervisorReady
 * @property {string} base    形如 http://127.0.0.1:3099
 * @property {number} port
 * @property {string} cookie  已脱敏日志里不会出现，仅供 transport 使用
 * @property {number | null} pid
 */

/**
 * @param {Partial<typeof DEFAULTS> & { launchId?: string | null }} [options]
 */
export function createSupervisor(options = {}) {
  const cfg = { ...DEFAULTS, ...options }
  const emitter = new EventEmitter()
  // 高并发下会有多个 ready 监听，默认 10 个容易触发 MaxListeners 警告
  emitter.setMaxListeners(32)

  const secrets = new Set()

  /** @type {import('node:child_process').ChildProcess | null} */
  let child = null
  let state = SupervisorState.idle
  let attempt = 0
  /** @type {SupervisorReady | null} */
  let info = null
  /** 当前进程实例的 launch token。refreshCookie 需要它，不能只存在脱敏集合里。 */
  let launchToken = null
  let launchTimer = null
  let restartTimer = null
  let stableTimer = null
  /** @type {{ resolve: () => void } | null} */
  let stopWaiter = null
  /** 复用的 stop promise，保证并发 stop 不会互相顶掉 waiter */
  let stopPromise = null
  /** @type {{ promise: Promise<SupervisorReady>, resolve: (v: SupervisorReady) => void, reject: (e: unknown) => void } | null} */
  let startPromise = null
  let disposed = false
  /** 最近一次非正常退出，用于把原因带进 error 事件 */
  let lastExit = null
  /** 最新一条错误。消费方即使不监听 error 事件也能查到。 */
  let lastError = null
  /** 当前 spawn 计划，terminate 需要 matchPattern */
  let activePlan = null

  const launchId = cfg.launchId ?? `studio-${Math.random().toString(36).slice(2, 10)}`

  function setState(next, extra = {}) {
    if (state === next) return
    const from = state
    state = next
    emitter.emit('state', { from, to: next, ...extra })
  }

  function log(stream, line) {
    const clean = redact(line, secrets)
    emitter.emit('log', { stream, line: clean })
  }

  function fail(code, message, extra = {}) {
    const described = describeError(code, message)
    const payload = { ...described, ...extra }
    lastError = payload
    // 'error' 在 EventEmitter 里是特殊事件：没有监听器时会直接 throw，
    // 把整个 Electron 主进程带崩。消费方忘了监听是很容易发生的事，
    // 所以这里做保护：没人接就写进日志流，并留在 lastError 里可查。
    if (emitter.listenerCount('error') > 0) {
      emitter.emit('error', payload)
    } else {
      emitter.emit('log', {
        stream: 'internal',
        line: `[error] ${payload.code}: ${payload.what} — ${payload.why}`,
      })
    }
    return described
  }

  /**
   * 让 start() 的 promise 定下来。
   * 这个函数存在的理由：如果只改 state 不 reject，调用方会永久停在「启动中」。
   */
  function failStart(message, code = ErrorCode.transportFailed) {
    if (!startPromise) return
    const pending = startPromise
    startPromise = null
    pending.reject(Object.assign(new Error(message), { code }))
  }

  /** 统一收尾，避免 stopWaiter / stopPromise 互相泄漏。 */
  function finishStop() {
    setState(SupervisorState.stopped)
    const waiter = stopWaiter
    stopWaiter = null
    stopPromise = null
    if (waiter) waiter.resolve()
  }

  function clearTimers() {
    if (launchTimer) clearTimeout(launchTimer)
    if (restartTimer) clearTimeout(restartTimer)
    if (stableTimer) clearTimeout(stableTimer)
    launchTimer = null
    restartTimer = null
    stableTimer = null
  }

  /** 从 /connect 换 Cookie。transport 重连后也要调这个。 */
  async function connect(token, base) {
    const url = connectUrl(base, token)
    const budgetEnd = cfg.now() + cfg.connectTimeoutMs
    let lastError = null

    for (let attemptNo = 1; ; attemptNo += 1) {
      try {
        return await connectOnce(url)
      } catch (error) {
        lastError = error
        const canRetry = error.transient === true
        if (!canRetry || attemptNo >= cfg.connectAttempts || cfg.now() >= budgetEnd) {
          throw error
        }
        await sleep(cfg.connectRetryDelayMs)
      }
    }
    // 不可达；上面的循环要么 return 要么 throw
    throw lastError
  }

  async function connectOnce(url) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), cfg.connectTimeoutMs)
    try {
      const res = await cfg.fetchImpl(url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        // 注意：绝不设 Origin 头。loopback 的 Host 本身就能过 trust fence，
        // 附加 Origin 反而会触发 authority 比对。
      })

      if (res.status === 401) {
        throw Object.assign(new Error('connect 返回 401'), {
          code: ErrorCode.unauthorized,
          transient: false,
        })
      }
      if (res.status === 403) {
        throw Object.assign(new Error('connect 返回 403'), {
          code: ErrorCode.forbidden,
          transient: false,
        })
      }
      if (res.status >= 400) {
        throw Object.assign(new Error(`connect 返回 ${res.status}`), {
          code: ErrorCode.transportFailed,
          transient: false,
        })
      }

      const headers =
        typeof res.headers.getSetCookie === 'function'
          ? res.headers.getSetCookie()
          : [res.headers.get('set-cookie')].filter(Boolean)

      const cookie = cookieFromSetCookie(headers)
      if (!cookie) {
        throw Object.assign(new Error('connect 未返回 Set-Cookie'), {
          code: ErrorCode.transportFailed,
          transient: false,
        })
      }
      for (const value of cookieSecrets(cookie)) secrets.add(value)
      return cookie
    } catch (error) {
      if (error.transient !== undefined) throw error
      if (error?.name === 'AbortError') {
        // 请求超时：可能是服务还没就绪，允许重试
        throw Object.assign(new Error('connect 超时'), {
          code: ErrorCode.transportFailed,
          transient: true,
        })
      }
      // fetch 自身抛错（ECONNREFUSED / ENOTFOUND / 端口未监听）都是可重试的连接问题
      const cause = error?.cause?.code ?? error?.cause?.message ?? error?.message ?? ''
      throw Object.assign(new Error(`connect 无法建立连接（${cause}）`), {
        code: ErrorCode.transportFailed,
        transient: true,
        cause,
      })
    } finally {
      clearTimeout(timeout)
    }
  }

  function scheduleRestart(reason) {
    if (disposed) return
    if (!cfg.autoRestart) {
      fail(ErrorCode.transportFailed, `运行时启动失败且未启用自动重试（${reason}）`)
      setState(SupervisorState.failed, { reason })
      failStart(`运行时启动失败（${reason}）`)
      return
    }
    if (attempt >= cfg.maxRestarts) {
      fail(ErrorCode.transportFailed, `连续 ${attempt} 次启动失败，已停止重试`)
      setState(SupervisorState.failed, { reason })
      failStart(`连续 ${attempt} 次启动失败，已停止重试`)
      return
    }
    attempt += 1
    const delay = backoffDelay(attempt, cfg.backoff)
    setState(SupervisorState.restarting, { reason, attempt, delayMs: delay })
    restartTimer = setTimeout(() => {
      restartTimer = null
      spawnRuntime()
    }, delay)
  }

  function handleExit(proc, code, signal) {
    // 旧实例的退出事件必须忽略：start() 在 failed 后重建时会主动丢弃旧 child，
    // 若不比较引用，旧进程的 exit 会把新实例的启动流程当成崩溃处理。
    if (proc !== child) return

    const wasStopping = state === SupervisorState.stopping
    child = null
    info = null
    // token 与进程同生命周期，进程没了就作废，防止 refreshCookie 拿旧 token 撞 401
    launchToken = null
    if (stableTimer) {
      clearTimeout(stableTimer)
      stableTimer = null
    }
    if (launchTimer) {
      clearTimeout(launchTimer)
      launchTimer = null
    }

    lastExit = { code, signal, at: cfg.now() }
    emitter.emit('exit', lastExit)

    if (wasStopping) {
      finishStop()
      return
    }

    // 非预期退出：ready 之后崩的算一次失败，同样走退避
    if (state === SupervisorState.ready) {
      fail(ErrorCode.transportFailed, `运行时已退出（code=${code}, signal=${signal}）`)
    }
    scheduleRestart(`exit:${code ?? signal}`)
  }

  async function doConnect(port, token) {
    const base = `http://127.0.0.1:${port}`
    setState(SupervisorState.connecting, { port })
    try {
      const cookie = await connect(token, base)
      info = { base, port, cookie, pid: child?.pid ?? null }
      setState(SupervisorState.ready, { port })
      emitter.emit('ready', info)

      if (startPromise) {
        const pending = startPromise
        startPromise = null
        pending.resolve(info)
      }

      // 存活够久就认为稳定，清空重试计数，避免「跑了一天后崩一次就直接放弃」
      stableTimer = setTimeout(() => {
        stableTimer = null
        attempt = 0
      }, cfg.stableMs)
      if (typeof stableTimer.unref === 'function') stableTimer.unref()
    } catch (error) {
      fail(error.code ?? ErrorCode.transportFailed, error.message)
      terminate({ force: true })
      failStart(error.message, error.code ?? ErrorCode.transportFailed)
    }
  }

  function spawnRuntime() {
    if (disposed) return
    setState(SupervisorState.starting, { attempt })

    const plan = buildSpawnPlan({
      distro: cfg.distro,
      command: cfg.command,
      args: cfg.args,
      env: cfg.env,
      launchId,
    })
    activePlan = plan

    let proc
    try {
      proc = cfg.spawnImpl(plan.file, plan.args, {
        env: { ...process.env, ...plan.env },
        shell: plan.shell,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      fail(ErrorCode.transportFailed, `无法启动运行时：${error.message}`)
      scheduleRestart('spawn-threw')
      return
    }

    child = proc
    let settled = false

    const onChunk = (stream) => (chunk) => {
      const text = String(chunk)
      if (!settled) {
        const found = parseLaunchLine(text)
        if (found) {
          settled = true
          launchToken = found.token
          secrets.add(found.token)
          if (launchTimer) {
            clearTimeout(launchTimer)
            launchTimer = null
          }
          doConnect(found.port, found.token)
        }
      }
      reader(stream).push(text)
    }

    const readers = new Map()
    const reader = (stream) => {
      if (!readers.has(stream)) {
        readers.set(stream, createLineReader((line) => log(stream, line)))
      }
      return readers.get(stream)
    }

    proc.stdout?.on('data', onChunk('stdout'))
    proc.stderr?.on('data', onChunk('stderr'))

    proc.on('error', (error) => {
      fail(ErrorCode.transportFailed, `运行时进程错误：${error.message}`)
      // spawn 失败（如 ENOENT）时进程根本没起来，不会有 exit 事件。
      // 立即解绑 child，否则 stop() 会傻等一个永不到来的 exit。
      if (child === proc) child = null
      if (!settled) {
        settled = true
        scheduleRestart('process-error')
      }
    })

    proc.on('exit', (code, signal) => {
      settled = true
      handleExit(proc, code, signal)
    })

    launchTimer = setTimeout(() => {
      launchTimer = null
      if (settled) return
      settled = true
      fail(
        ErrorCode.transportFailed,
        `${Math.round(cfg.launchTimeoutMs / 1000)}s 内未捕获启动行，已终止本次启动`,
      )
      terminate({ force: true })
      scheduleRestart('launch-timeout')
    }, cfg.launchTimeoutMs)
    if (typeof launchTimer.unref === 'function') launchTimer.unref()
  }

  /**
   * 结束子进程。
   *
   * WSL 模式下优先在发行版内部 pkill：直接 kill wsl.exe 在 Windows 上是强制终止，
   * 容易把 Linux 侧进程留成孤儿。pkill 的 pattern 用「命令 + 前几个参数」，
   * 足以区分 `--profile web` 与用户自己开的其他 dsh 实例。
   */
  function terminate({ force = false } = {}) {
    const proc = child
    if (!proc) return

    const signal = force ? 'KILL' : 'TERM'

    if (cfg.distro && activePlan?.matchPattern) {
      try {
        const remote = `pkill -${signal} -f -- ${shellQuote(activePlan.matchPattern)} || true`
        cfg.spawnImpl(
          process.platform === 'win32' ? 'wsl.exe' : 'wsl',
          ['-d', cfg.distro, '-e', 'bash', '-c', remote],
          { stdio: 'ignore', windowsHide: true },
        )
      } catch {
        /* pkill 失败不致命，下面还有 kill 兜底 */
      }
    }

    try {
      proc.kill(signal === 'KILL' ? 'SIGKILL' : 'SIGTERM')
    } catch {
      /* 进程可能已经退出 */
    }
  }

  /** 启动并等到 ready。已在 ready 时直接返回当前信息。 */
  function start() {
    if (disposed) return Promise.reject(new Error('supervisor 已销毁'))
    if (state === SupervisorState.ready && info) return Promise.resolve(info)
    if (startPromise) return startPromise.promise

    let resolveFn
    let rejectFn
    const promise = new Promise((resolve, reject) => {
      resolveFn = resolve
      rejectFn = reject
    })
    startPromise = { promise, resolve: resolveFn, reject: rejectFn }

    attempt = 0

    // 上一轮已经放弃（failed）或停在半截（stopping）时，先把残留进程卸掉再重来。
    // 直接置 child = null 而不等 exit，是为了让旧实例的退出事件被 handleExit 忽略。
    if (state === SupervisorState.failed || state === SupervisorState.stopping) {
      clearTimers()
      if (child) {
        terminate({ force: true })
        child = null
      }
      info = null
      if (stopWaiter) {
        const waiter = stopWaiter
        stopWaiter = null
        stopPromise = null
        waiter.resolve()
      }
    }

    if (child) {
      // 复用一个已存在但未 ready 的进程：等它自己走完
      return promise
    }
    spawnRuntime()
    return promise
  }

  /** 停止并等到进程真正退出。并发调用共享同一个 promise。 */
  function stop({ force = false } = {}) {
    if (state === SupervisorState.stopped || state === SupervisorState.idle) {
      if (disposed) return Promise.resolve()
      setState(SupervisorState.stopped)
      return Promise.resolve()
    }

    if (stopPromise) return stopPromise

    clearTimers()
    stopPromise = new Promise((resolve) => {
      stopWaiter = { resolve }
    })
    setState(SupervisorState.stopping)

    if (!child) {
      finishStop()
      return stopPromise
    }

    // 进程已死但 exit 事件没送达（spawn 失败、或事件在其他 tick 已丢失）：
    // 再等下去只会挂住调用方，直接收尾。
    if (child.exitCode !== null || child.signalCode !== null) {
      child = null
      info = null
      launchToken = null
      finishStop()
      return stopPromise
    }

    terminate({ force })

    // grace 到期还没退就升级为强制
    const escalate = setTimeout(() => {
      if (child) terminate({ force: true })
    }, force ? 500 : cfg.stopGraceMs)
    if (typeof escalate.unref === 'function') escalate.unref()

    return stopPromise
  }

  /** 断开时释放所有定时器与子进程，不留下悬空句柄。 */
  async function dispose() {
    disposed = true
    await stop({ force: true })
    emitter.removeAllListeners()
  }

  return {
    /** @returns {string} */
    get state() {
      return state
    },
    /** @returns {SupervisorReady | null} */
    get info() {
      return info
    },
    get attempt() {
      return attempt
    },
    /** @returns {ReturnType<typeof describeError> | null} */
    get lastError() {
      return lastError
    },
    get launchId() {
      return launchId
    },
    /** 便于 transport 记录日志而不泄露 token */
    redact: (text) => redact(text, secrets),
    start,
    stop,
    dispose,
    /**
     * 仅重建认证。transport 的 socket 重连后必须调它——Cookie 与 Peer 同生命周期。
     * @returns {Promise<string>} 新 Cookie
     */
    async refreshCookie() {
      if (!info) throw new Error('supervisor 尚未 ready，无法刷新 Cookie')
      if (!launchToken) throw new Error('没有可用的 launch token，请重新 start()')
      const cookie = await connect(launchToken, info.base)
      info = { ...info, cookie }
      emitter.emit('cookie', { cookie })
      return cookie
    },
    on: (event, listener) => {
      emitter.on(event, listener)
      return () => emitter.off(event, listener)
    },
    once: (event, listener) => {
      emitter.once(event, listener)
      return () => emitter.off(event, listener)
    },
  }
}
