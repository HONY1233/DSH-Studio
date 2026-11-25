/**
 * 只增不可变的分块列表 —— 替代 `[...state.messages, item]`。
 *
 * 为什么需要它：`apply` 每折一条消息就 `[...messages, next]`，是 O(n) 拷贝。
 * 折 n 条的总成本因此是 O(n²)：2000 条对话 ≈ 200 万次元素拷贝，
 * 10000 条 ≈ 5000 万次。分片回放只解决了「卡帧」（单帧工作量），
 * 没解决「总拷贝量」—— 一帧里折 200 条，每一条都在复制整个历史。
 *
 * 分块之后单次 append 的成本是 O(块数 + 末块长度) = O(n / 256 + 256)：
 * - 10000 条：块数 39，单次 append ≈ 295 次指针写，总计约 300 万；
 * - 关键是**旧块整块共享**，不会被复制（`append` 只碰末块与块表）。
 *
 * 实测（`node scripts/bench-fold.ts`，本机 Node 22，折 n 条的总耗时）：
 *
 * | n | 数组 spread | 本类 | 倍数 |
 * |---|---|---|---|
 * | 1 000 | 1.3 ms | 1.9 ms | **0.7×（更慢）** |
 * | 2 000 | 2.2 ms | 1.0 ms | 2.2× |
 * | 5 000 | 13.7 ms | 4.1 ms | 3.3× |
 * | 10 000 | 44 ms | 5.8 ms | 7.6× |
 * | 20 000 | 734 ms | 7.4 ms | 99× |
 *
 * 注意第一行：**短列表上本类更慢**（每个 append 要多造一个对象）。
 * 交点大约在 1500 条。所以它只用在"会长到很大"的地方（对话消息），
 * 不要拿它去换掉几十条元素的临时数组。
 *
 * 设计取舍：
 * 1) **块表用普通数组复制**，不做 cons 链表。链表的 append 才是严格 O(1)，
 *    但 `toArray` / 随机访问要倒序再展开，代码复杂度和出错面都大。
 *    块表复制的量级是 n / CHUNK_SIZE，在本场景可以忽略。
 * 2) **`toArray()` 结果按实例记忆**。渲染一帧里多个组件读同一份 state 只materialize一次；
 *    state 换代后自然失效。返回冻结数组，防止调用方就地排序把记忆结果改坏。
 * 3) **不实现 `readonly T[]` 结构**（没有索引签名）。JS 无法在类上做真正的数字索引，
 *    假装成数组会让 `list[0]` 静默返回 undefined —— 宁可让调用方写 `get(0)`。
 *
 * 零依赖、零 DOM，Node 里可测。
 */

const CHUNK_SIZE = 256

const EMPTY_ARRAY: readonly never[] = Object.freeze([])

export class ChunkedList<T> implements Iterable<T> {
  /** 每块最多容纳多少元素。256 ≈ 与块表复制成本（n/256）平衡在 n≈65k。 */
  static readonly CHUNK_SIZE = CHUNK_SIZE

  private static readonly EMPTY: ChunkedList<never> = new ChunkedList<never>([], 0)

  /** 满块 + 可能未满的末块。除最后一个外，每个块的 `length === CHUNK_SIZE`。 */
  private readonly chunks: readonly (readonly T[])[]
  private readonly count: number
  private cache?: readonly T[]

  private constructor(chunks: readonly (readonly T[])[], count: number) {
    this.chunks = chunks
    this.count = count
  }

  static empty<T>(): ChunkedList<T> {
    return ChunkedList.EMPTY as unknown as ChunkedList<T>
  }

  /** 从已有数组构造（会把元素切块复制一次）。 */
  static of<T>(items: readonly T[]): ChunkedList<T> {
    if (items.length === 0) return ChunkedList.empty<T>()
    const chunks: (readonly T[])[] = []
    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
      chunks.push(items.slice(i, i + CHUNK_SIZE))
    }
    return new ChunkedList<T>(chunks, items.length)
  }

  get length(): number {
    return this.count
  }

  get isEmpty(): boolean {
    return this.count === 0
  }

  append(value: T): ChunkedList<T> {
    const lastIndex = this.chunks.length - 1
    const last = this.chunks[lastIndex]

    if (last && last.length < CHUNK_SIZE) {
      // 末块没满：只复制末块与块表，之前所有块共享同一批对象。
      const grown = [...last, value]
      const chunks = this.chunks.slice()
      chunks[lastIndex] = grown
      return new ChunkedList<T>(chunks, this.count + 1)
    }

    return new ChunkedList<T>([...this.chunks, [value]], this.count + 1)
  }

  appendAll(values: readonly T[]): ChunkedList<T> {
    if (values.length === 0) return this
    let next: ChunkedList<T> = this
    for (const value of values) next = next.append(value)
    return next
  }

  /**
   * 拼接：返回 `this` 后接 `other` 的新列表。
   *
   * 用于**向上加载历史**：更早的一页折好后要接在当前结果前面（`older.concat(current)`）。
   * 如果退化成 `appendAll(other.toArray())`，每接一条都要复制末块 —— `other` 有多少条
   * 就复制多少次，而 `other` 通常就是整个当前窗口。
   *
   * 这里的成本是块表复制（n / 256）+ 最多一个块的元素复制：
   * - `this` 末块不满且 `other` 非空 → 把 `other` 开头补进末块（凑满 256），
   *   剩下的块整块共享。"除末块外每块都满"的不变量继续成立，
   *   `get(index)` 的下标换算才不需要额外的偏移表。
   * - 末块已满 → 直接拼块表，两边所有块共享。
   */
  concat(other: ChunkedList<T>): ChunkedList<T> {
    if (other.count === 0) return this
    if (this.count === 0) return other

    const lastIndex = this.chunks.length - 1
    const last = this.chunks[lastIndex]
    if (!last) return other

    if (last.length === CHUNK_SIZE) {
      return new ChunkedList<T>([...this.chunks, ...other.chunks], this.count + other.count)
    }

    // 末块没满：用 other 的前若干项把它填满
    const merged = last.slice()
    let consumedChunks = 0
    let consumedInChunk = 0
    let carried = 0

    outer: for (let i = 0; i < other.chunks.length; i += 1) {
      const chunk = other.chunks[i]
      if (!chunk) continue
      consumedChunks = i + 1
      for (const value of chunk) {
        merged.push(value)
        carried += 1
        consumedInChunk += 1
        if (merged.length === CHUNK_SIZE) break outer
      }
    }
    // `consumedInChunk` 现在指的是"最后被吃掉的那块里吃掉了几个"

    const chunks = this.chunks.slice(0, lastIndex)
    chunks.push(merged)

    if (carried >= other.count) {
      // 整份 other 都被塞进了这个块（它本来就只有这么点）。
      return new ChunkedList<T>(chunks, this.count + other.count)
    }

    // 关键：最后被吃掉的那块还剩一截。**不能把它当成一个独立的块直接塞进去** ——
    // 那会让"中间块不满"，而 `get(index)` 的下标换算依赖"除末块外每块都满"，
    // 于是从那一块开始所有元素都会读错位（真机上表现为消息顺序错乱、
    // 末尾几条读不到）。正确做法是把它当 carry，与后续块逐个合并成满块。
    const sourceChunk = other.chunks[consumedChunks - 1]
    let carry: readonly T[] = sourceChunk ? sourceChunk.slice(consumedInChunk) : []

    for (let i = consumedChunks; i < other.chunks.length; i += 1) {
      const chunk = other.chunks[i]
      if (!chunk) continue
      if (carry.length === 0) {
        chunks.push(chunk)
        continue
      }
      const joined = [...carry, ...chunk]
      if (joined.length >= CHUNK_SIZE) {
        chunks.push(joined.slice(0, CHUNK_SIZE))
        carry = joined.slice(CHUNK_SIZE)
      } else {
        carry = joined
      }
    }
    if (carry.length > 0) chunks.push(carry)

    return new ChunkedList<T>(chunks, this.count + other.count)
  }

  /**
   * 替换第 `index` 项（越界返回自身）。
   *
   * 用途：工具调用先有 `tool/call`、后有 `tool/result`，结果要合并回**原来那条**
   * 记录里，否则同一件工具会显示成两行。只复制命中的那一块（≤256）与块表，
   * 其余块继续共享 —— 成本与 `append` 同量级。
   *
   * 注意这不是"可变列表"：原实例不受影响，返回的是新实例。
   */
  update(index: number, value: T): ChunkedList<T> {
    if (!Number.isInteger(index) || index < 0 || index >= this.count) return this
    const chunkIndex = Math.floor(index / CHUNK_SIZE)
    const offset = index % CHUNK_SIZE
    const chunk = this.chunks[chunkIndex]
    if (!chunk) return this
    if (chunk[offset] === value) return this

    const replaced = chunk.slice()
    replaced[offset] = value
    const chunks = this.chunks.slice()
    chunks[chunkIndex] = replaced
    return new ChunkedList<T>(chunks, this.count)
  }

  get(index: number): T | undefined {
    if (!Number.isInteger(index) || index < 0 || index >= this.count) return undefined
    const chunk = this.chunks[Math.floor(index / CHUNK_SIZE)]
    return chunk?.[index % CHUNK_SIZE]
  }

  /** 支持负索引（`at(-1)` 是最后一个）。 */
  at(index: number): T | undefined {
    return this.get(index < 0 ? this.count + index : index)
  }

  first(): T | undefined {
    return this.get(0)
  }

  last(): T | undefined {
    return this.get(this.count - 1)
  }

  /** 展开成数组。结果被冻结并按实例记忆 —— 同一份 state 渲染多次不会重复展开。 */
  toArray(): readonly T[] {
    if (this.count === 0) return EMPTY_ARRAY as unknown as readonly T[]
    if (this.cache) return this.cache
    const out: T[] = new Array(this.count)
    let cursor = 0
    for (const chunk of this.chunks) {
      for (const item of chunk) {
        out[cursor] = item
        cursor += 1
      }
    }
    this.cache = Object.freeze(out)
    return this.cache
  }

  slice(from: number, to?: number): readonly T[] {
    return this.toArray().slice(from, to)
  }

  map<U>(fn: (value: T, index: number) => U): U[] {
    return this.toArray().map(fn)
  }

  filter(fn: (value: T, index: number) => boolean): T[] {
    return this.toArray().filter(fn)
  }

  forEach(fn: (value: T, index: number) => void): void {
    let index = 0
    for (const chunk of this.chunks) {
      for (const item of chunk) {
        fn(item, index)
        index += 1
      }
    }
  }

  some(fn: (value: T) => boolean): boolean {
    for (const value of this) if (fn(value)) return true
    return false
  }

  /**
   * 迭代器直接走块，**不 materialize** —— `for...of` 与 `Array.from` 在长列表上
   * 不该为了读前几条而展开整份。
   */
  *[Symbol.iterator](): Iterator<T> {
    for (const chunk of this.chunks) {
      for (const item of chunk) yield item
    }
  }

  /** 调试/持久化用。注意它会触发整份展开。 */
  toJSON(): readonly T[] {
    return this.toArray()
  }
}
