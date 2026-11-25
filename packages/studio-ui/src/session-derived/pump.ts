/**
 * 分片泵 —— 把"一次折 5000 条"拆成"每轮 200 条 + 让出主线程"。
 *
 * 为什么需要它：`DerivedModel.apply` 是纯函数，但折叠 5000 条仍然是同步 CPU 活。
 * 首次打开一场大会话、或重连后整份回放，会在主线程上卡住一帧以上
 * （表现为窗口假死、滚动掉帧）。分片把这段代价摊到多帧上。
 *
 * 三个设计点：
 * 1) **`rest` 而不是重扫整批**：`ingest` 返回没处理完的尾部，下一轮直接喂它，
 *    总成本 O(n) 而不是 O(n × 轮数)。
 * 2) **可取消**：切会话时要能立刻停，`shouldStop` 在每轮开头查一次。
 * 3) **已折的不丢**：中途停下时，前面已折进 state 的部分保留 —— 回来接着折即可
 *    （per-slot 的 lastSeq 保证不会重复折）。
 */

import type { DerivedCache } from './cache.js'
import type { DerivedEntry } from './model.js'

/** 每轮默认处理条数。200 条 ≈ 不到 1ms，够平滑又不至于太多轮。 */
export const DEFAULT_BUDGET = 200

export interface DrainOptions {
  /** 每轮最多处理多少条。 */
  readonly budget?: number
  /** 让出入口。默认 `Promise.resolve()`（微任务）；真机建议 `requestIdleCallback`。 */
  readonly yieldTo?: () => Promise<void>
  /** 每轮开头检查一次：返回 true 就停（切会话、组件卸载）。 */
  readonly shouldStop?: () => boolean
}

export interface DrainResult {
  readonly rounds: number
  readonly folded: number
  readonly skipped: number
  /** 被 `shouldStop` 中途停下。 */
  readonly stopped: boolean
  /** 没处理的条数（停下时大于 0）。 */
  readonly remaining: number
  /** 该会话没有任何消费者，整批丢弃。 */
  readonly ignored: boolean
}

export async function drainEntries(
  cache: DerivedCache,
  sessionId: string,
  entries: readonly DerivedEntry[],
  options: DrainOptions = {},
): Promise<DrainResult> {
  const budget = Math.max(1, options.budget ?? DEFAULT_BUDGET)
  const yieldTo = options.yieldTo ?? ((): Promise<void> => Promise.resolve())
  const shouldStop = options.shouldStop ?? ((): boolean => false)

  let batch = entries
  let rounds = 0
  let folded = 0
  let skipped = 0

  while (batch.length > 0) {
    if (shouldStop()) return { rounds, folded, skipped, stopped: true, remaining: batch.length, ignored: false }

    const result = cache.ingest(sessionId, batch, { budget })
    rounds += 1
    folded += result.folded
    skipped += result.skipped

    if (result.ignored) return { rounds, folded, skipped, stopped: false, remaining: 0, ignored: true }
    if (!result.hasMore) return { rounds, folded, skipped, stopped: false, remaining: 0, ignored: false }

    batch = result.rest ?? []
    if (batch.length === 0) return { rounds, folded, skipped, stopped: false, remaining: 0, ignored: false }

    await yieldTo()
  }

  return { rounds, folded, skipped, stopped: false, remaining: 0, ignored: false }
}
