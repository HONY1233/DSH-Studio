/**
 * 派生模型契约 —— "把会话事件折叠成 UI 要的形状"这件事的标准接口。
 *
 * 三个刻意的约束：
 * 1) `apply` 必须是**纯函数**：同样的 state + entry 永远得到同样的结果。
 *    这样缓存可以放心共享、回放、以及在测试里断言。
 * 2) 未知事件类型必须原样返回 state，**不许抛错**。
 *    会话日志是只增的，旧客户端一定会遇到新事件类型；崩一次就等于会话打不开。
 * 3) 初始状态与"已就绪"是两件事：`status: 'unknown'` 表示还没吃到任何事件。
 *    这时候 UI 该显示"未知"，而不是渲染一个空列表 —— 空列表是**结论**，未知不是。
 */

/** 折叠输入。`data` 里放原始 envelope 的其余字段，模型自己解释。 */
export interface DerivedEntry {
  readonly seq: number
  readonly type: string
  readonly data?: unknown
}

export interface DerivedModel<S> {
  /** 稳定 key，进缓存索引；发布后不得改名（否则等于换了个模型）。 */
  readonly key: string
  initial(): S
  apply(state: S, entry: DerivedEntry): S
  /**
   * 把「更早的一页」的折叠结果拼到当前状态前面（向上加载历史用）。
   *
   * 返回 `undefined` 表示这块拼不了，调用方必须退回"清空 + 整窗重折"。
   * 模型**应该**在拼不了时如实返回 undefined，而不是硬拼出一个近似结果 ——
   * 近似结果会在界面上表现为"同一次工具调用断成两截"这类难以归因的错乱。
   *
   * 不实现这个方法 = 不支持增量前插（缓存会自动退回全窗重折）。
   */
  prepend?(older: S, current: S): S | undefined
}

/**
 * 派生状态快照。对象身份只在内容变化时改变，可以直接喂 `useSyncExternalStore`。
 */
export interface DerivedState<S> {
  /** `unknown` = 一条事件都还没吃到；`ready` = 至少折叠过一条。 */
  readonly status: 'unknown' | 'ready'
  readonly value: S
  /** 已折叠到的最大 seq；`-1` 表示还没有任何事件。 */
  readonly lastSeq: number
  /** 折叠过多少条事件（跳过的重复/旧包不计）。 */
  readonly applied: number
  readonly updatedAt: number
}
