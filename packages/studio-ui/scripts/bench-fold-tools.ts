/**
 * 折叠成本基线：工具调用场景。
 *
 * 回答两个具体问题：
 *
 * 1) **`openCalls` 的展开复制要不要担心？** 它只在有工具调用时执行，
 *    成本 O(正在跑的工具数)。配对的调用会让它保持在很小值。
 * 2) **未配对的调用有多糟？** 全是 `tool/call` 没有 `tool/result` 时，
 *    `openCalls` 会长到 N，每次 apply 都复制一遍 → O(N²)。
 *
 * 实测（rolldown 打包后 node 跑，取三次中位数）：
 *
 * | n | 配对（call+result） | 未配对（只有 call） | 未配对 + 定期 turn/end |
 * |---|---|---|---|
 * | 500 | 1.32 ms | 6.69 ms | — |
 * | 1 000 | 1.41 ms | 51.90 ms | — |
 * | 2 000 | 3.92 ms | **376.64 ms** | 3.79 ms |
 * | 5 000 | 8.16 ms | **3075.81 ms** | **9.26 ms** |
 *
 * 结论：**`turn/end` 清空 `openCalls` 不是可选的收尾**。同样是 5000 次未配对调用，
 * 有清理是 9.26 ms、没有是 3075 ms —— 相差 332 倍，而且这还是"折叠一次"的成本，
 * 每次 prepend 重折都要再付一遍。
 *
 * 跑法：
 * ```bash
 * npx rolldown scripts/bench-fold-tools.ts -o /tmp/bench.mjs --format esm && node /tmp/bench.mjs
 * ```
 * （源码用 `.js` 后缀导入，Node 直跑 TS 解不了，所以要打包一次。）
 */

import { createConversationModel } from '../src/session-derived/conversation.ts'
import type { DerivedEntry } from '../src/session-derived/model.ts'

const MODEL = createConversationModel()

function call(seq: number, id: string): DerivedEntry {
  return { seq, type: 'tool/call', data: { callId: id, name: 'read_file', arguments: '{"path":"a"}' } }
}

function result(seq: number, id: string): DerivedEntry {
  return { seq, type: 'tool/result', data: { callId: id, text: 'ok', isError: false } }
}

function turnEnd(seq: number): DerivedEntry {
  return { seq, type: 'turn/end', data: {} }
}

/** 配对的调用：call + result 立刻成对（真实场景）。 */
function pairedEntries(n: number): DerivedEntry[] {
  const out: DerivedEntry[] = []
  for (let i = 0; i < n; i += 1) {
    out.push(call(i * 2, `c${i}`), result(i * 2 + 1, `c${i}`))
  }
  return out
}

/** 最坏情况：全部只有 call，没有 result。 */
function orphanEntries(n: number): DerivedEntry[] {
  const out: DerivedEntry[] = []
  for (let i = 0; i < n; i += 1) out.push(call(i, `c${i}`))
  return out
}

function timeIt(entries: DerivedEntry[]): number {
  const start = performance.now()
  let state = MODEL.initial()
  for (const entry of entries) state = MODEL.apply(state, entry)
  const elapsed = performance.now() - start
  // 防止被优化掉
  if (state.messages.length < 0) throw new Error('unreachable')
  return elapsed
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function bench(label: string, make: (n: number) => DerivedEntry[], sizes: number[]): void {
  console.log(`\n== ${label} ==`)
  for (const n of sizes) {
    const entries = make(n)
    const samples = [timeIt(entries), timeIt(entries), timeIt(entries)]
    console.log(`  n=${String(n).padStart(6)}  ${median(samples).toFixed(2)} ms`)
  }
}

const SIZES = [500, 1_000, 2_000, 5_000]

bench('配对调用（call+result，真实场景）', pairedEntries, SIZES)
bench('未配对调用（全部只有 call，最坏情况）', orphanEntries, SIZES)

// turn/end 收尾的收益：同样 2000 个未配对调用，只是每 100 个补一次 turn/end
console.log('\n== 未配对 + 每 100 个一次 turn/end ==')
for (const n of [2_000, 5_000]) {
  const entries: DerivedEntry[] = []
  for (let i = 0; i < n; i += 1) {
    entries.push(call(i, `c${i}`))
    if ((i + 1) % 100 === 0) entries.push(turnEnd(i))
  }
  const samples = [timeIt(entries), timeIt(entries), timeIt(entries)]
  console.log(`  n=${String(n).padStart(6)}  ${median(samples).toFixed(2)} ms  （openCalls 被定期清空）`)
}

console.log('\n结论：')
console.log('  · 配对场景 O(n)，5000 对也在毫秒级 —— openCalls 的展开复制不是瓶颈')
console.log('  · 未配对场景是 O(n²)：这正是 turn/end 清空 openCalls 的必要性')
