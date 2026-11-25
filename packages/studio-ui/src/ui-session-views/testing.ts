/**
 * 测试用的 `SessionPort` 假实现。
 *
 * 它同时是一份**对照样板**：真机适配器要满足的行为都在这里被断言过。
 * 生产代码不要 import 这个文件。
 */

import type { SessionBinding, SessionPort, SessionRetainOptions } from './port.js'

export interface FakeRetainCall {
  readonly target: string
  readonly options: SessionRetainOptions
  /** 底层 release 被调了几次；正常情况只会是 0 或 1。 */
  releaseCount: number
  /** 手动让 `ready` 成功，可覆盖 openState/error 等字段。 */
  resolve(binding?: Partial<SessionBinding>): void
  /** 手动让 `ready` 拒绝。 */
  reject(error: unknown): void
}

export interface FakeSessionPort {
  readonly port: SessionPort
  readonly calls: FakeRetainCall[]
}

export function createFakeSessionPort(overrides: Partial<SessionPort> = {}): FakeSessionPort {
  const calls: FakeRetainCall[] = []
  const port: SessionPort = {
    retain(target, options) {
      let resolveReady!: (binding: SessionBinding) => void
      let rejectReady!: (error: unknown) => void
      const ready = new Promise<SessionBinding>((resolve, reject) => {
        resolveReady = resolve
        rejectReady = reject
      })
      const call: FakeRetainCall = {
        target,
        options,
        releaseCount: 0,
        resolve: (binding = {}) => resolveReady({ sessionId: target, openState: 'ready', ...binding }),
        reject: (error) => rejectReady(error),
      }
      calls.push(call)
      return {
        ready,
        release() {
          call.releaseCount += 1
        },
      }
    },
    ...overrides,
  }
  return { port, calls }
}

/** 让出一个微任务：默认宽限期是 microtask，这一步就足以触发关闭。 */
export const tick = (): Promise<void> => Promise.resolve()

/** 等一个宏任务，用于 `timeout` 宽限期。 */
export const settle = (ms = 10): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
