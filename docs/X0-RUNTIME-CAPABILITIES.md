# X0 Runtime 协议与能力事实表

核验日期：2026-11-24。目的：冻结当前 Desktop 实际使用的 DSH SDK stdio 能力，防止把 DSH Web Remote descriptor、OMP 契约或 preview fixture 误当成已接通的生产能力。

## 1. 结论与版本边界

当前 Desktop 的实际链路是：

```text
Renderer / renderer-omp
  → preload IPC
  → Electron Main studio-bridge / native IPC
  → RuntimeClient
  → WSL 子进程 stdio JSONL JSON-RPC
  → dsh --profile sdk
```

RuntimeClient 默认启动参数见 `packages/runtime-client/src/index.js:84-95`。SDK dispatch 的白名单见 DSH 安装包 `node_modules/@deepseek-ai/dsh-sdk-jsonrpc-server/lib/index.js:715-745`。

必须区分以下版本号：

| 标识 | 本次核验值 | 含义 |
|---|---|---|
| 安装包 descriptor `dshVersion` | `0.2.2-rc.5` | 当前 WSL DSH 安装与 Web descriptor 快照版本 |
| descriptor `generatedAt` | `2026-11-23T01:09:08.207Z` | descriptor 生成时间，不是 SDK 握手时间 |
| descriptor `endpointCount` | `224` | Web Remote 端点快照数量；对象键数量也为 224 |
| SDK `serverInfo.name` | `deepseek-harness-sdk-runtime` | wire-stable server identity |
| SDK `serverInfo.version` | `0.0.1` | SDK 握手 fixture 返回值；不得当作安装包版本 |

证据：`packages/dsh-gateway/src/wire/descriptors.json:1`、`packages/testkit/fixtures/projection-basic.jsonl:2`、`packages/runtime-client/src/index.js:132-146`。

**Web descriptor 是潜在能力面，不是当前 Desktop 的可用适配器。** `packages/dsh-gateway/src/index.js:4-9` 自己标明 HTTP unary / mux transport 仍是下一步；Desktop 也没有走 gateway transport。Web 端点存在只能证明“上游协议有定义”，不能证明当前 SDK profile、权限、传输或 UI 已经接通。

## 2. SDK stdio 方法面

SDK 只接受下列方法；未知方法由 dispatch 抛错并映射为 JSON-RPC error：

| 方法 | 参数与语义 | 当前 Desktop 用法 |
|---|---|---|
| `initialize` | `cwd`、`provider`、`model`，可选 `reasoningEffort`、`maxTokens`、`approvalRequests`、`capabilities.userQuestions` | RuntimeClient 启动握手；当前 approvalRequests 开启，userQuestions 默认关闭 |
| `session/prompt` | 普通 prompt 入队，返回 `messageId` | SDK 可用；当前 RuntimeClient 主入口使用 `session/query` |
| `session/query` | 只接受非空 `sessionId` 与 `contentBlocks`；返回入队回执，不代表 turn 完成 | RuntimeClient `query()`；普通文本走此方法 |
| `session/resume` | 只接受 `sessionId`；恢复未被其他进程持有的持久会话 | Bridge 在历史会话 query 前按需恢复 |
| `session/wait` | 等待指定 SDK 会话及其托管后代 settle | RuntimeClient 有包装；常规 UI 不靠它判定事件结束 |
| `session/working-directory/get` | 读取指定 Session 的有效 cwd | 当前 Desktop Bridge 未作为独立工具能力开放 |
| `session/working-directory/set` | 修改有效 cwd，不改变 Session origin 或 permissions | 当前 Desktop Bridge 未作为独立工具能力开放 |
| `shutdown` | 关闭 SDK server | RuntimeClient `stop()`；5 秒失败后终止子进程 |

SDK `SessionQueryParams` 没有 `requestId` 或 `mode`。因此不能通过给 SDK query 增加 `mode: "steer"` 来假装实现插话；服务端会拒绝额外字段。SDK query 与 Web `session/prompt` 不是同一个方法或参数模型。

### 2.1 RuntimeClient 进程生命周期（Desktop 适配层）

以下规则约束 WSL stdio 子进程，不扩展 SDK 方法面：

1. `start()` 的 spawn/error/exit/stdin error 回调都先验证 `child === this.child`。旧进程的迟到 exit 不得清理、终止或改变新进程状态。
2. spawn error 会清掉当前 child、pending request、server requests 与诊断录制，并回到 `failed`；随后允许重新 `start()`。
3. stdin 的异步 error（含 EPIPE）必须 fail-closed：拒绝 pending 请求、取消未决服务端请求、关闭录制并终止当前 child，不能产生未捕获异常。
4. 写出前检查 stdin 的 `writable` 与 `destroyed`；同步写失败时立即删除 pending 并清除超时，不留永久悬挂请求。
5. `stop()` 先发送 SDK `shutdown`，再等待 OS child 的 `exit`。仅收到 shutdown JSON-RPC 回执不代表进程已退出。
6. 拒退出的 child 在 `stopTimeoutMs` 后明确失败并终止；关闭录制、清空 client child，向调用方抛错。不得返回“已关闭”假成功。
7. `packages/testkit/test/runtime-client.test.mjs` 的 9 项 fake ChildProcess 回归覆盖上述规则；故障注入不能冒充真实 SDK/WSL 退出证据。
8. `apps/desktop/scripts/runtime-lifecycle-probe.mjs` 已用真实 WSL DSH SDK 连续完成两轮 `initialize → shutdown → OS PID 退出 → restart`；两轮均无 server request、无 prompt，停止后 pending 为 0。该探针只覆盖正常启停，不覆盖真实拒退出/超时终止。
9. `apps/desktop/scripts/desktop-lifecycle-probe.mjs` 已用明确标记的 loopback 测试渲染页启动真实 Electron Main，在 Runtime ready 且 native/OMP PTY 均收到 ready 标记后关闭主窗口；Electron 退出码为 0，Runtime/PTY 相关 `wsl.exe`/ConPTY 代理 OS 进程 6→0，未发送 prompt。
10. 便携生产包已真实启动生产 `file://` Renderer，Runtime `state:ready`、serverInfo 为 `deepseek-harness-sdk-runtime / 0.0.1`、cwd 为 `/mnt/f/projects/dsh-studio`；Renderer 重载后仍 ready，exception 与 console error 均为 0。关闭主窗口后，本次跟踪的 Main、Runtime、Renderer、GPU、Network 与 PTY PID 均退出，stdout 记录 `[studio] main window closed`。该证据覆盖便携包正常运行与关窗清理，不是标准安装包或真实拒退出/超时终止验收。

### 2.2 Bridge 会话与审批切换

- `conversation.open` 必须等待 Runtime `session/resume` 成功后才切 active context；失败保留原会话，不发目标 snapshot，不回 `completed`。
- `session.resume` 与 transcript 翻页导致 context 切换后，取消只属于旧会话的孤儿审批；仍属于其他 owner 的审批不得误取消。
- `interaction.respond` 只接受 `submit|cancel`；缺失、未知或大小写变体均回 `INVALID_ARGUMENT`，不得默认允许。
- `tool/result` 完成后立即释放 `callOwner`；后续重复 result 不得继承旧 turn 的工具调用归属。
- `models.adaptation.resolve` 在当前无适配层时回 `CAPABILITY_UNAVAILABLE`，不解析、不应用、不调用 Runtime query。

证据：`apps/desktop/src/studio-bridge.js`；`packages/testkit/test/runtime-capabilities.test.mjs` 15 项与 `subagents.test.mjs`。

## 3. Web Remote / SDK stdio / Desktop Bridge 对照

| 产品语义 | Web Remote descriptor | SDK stdio | 当前 Desktop Bridge |
|---|---|---|---|
| 创建会话 | `session/create`：可选 `workspaceId`、`cwd`、`sessionId`、`agentPreset` | 无独立 create；未知 `sessionId` 可由 prompt/query 懒创建 | `session.create` 本地生成 `omp-*` ID，首条 prompt 时创建；不是 Web create 的语义等价物 |
| 会话列表 | `session/list`：不 resume Agent | 无 list 方法 | 从 host-services 的持久会话记录读取；不是 SDK 方法 |
| 恢复会话 | Web controller 有 resume 流程 | `session/resume` | Runtime 接受后才切换 context；失败回 `failed / UNAVAILABLE`，不发目标会话 snapshot，不回 `completed` |
| 普通入队 | `session/prompt` 必填 `requestId`、`sessionId`、`mode: queue|steer`、`content` | `session/prompt` / `session/query`；无 mode | `core.prompt` 走普通 `runtime.query`；`core.followUp` / `queue.enqueue` 是普通 query 近似，manifest 标为 `limited` |
| 运行中插话 | `session/prompt` 的 `mode: steer` | 无 steer 方法 | `core.steer` 明确 `CAPABILITY_UNAVAILABLE`，不发送 prompt；`core.followUp` 仅普通 query，不冒充 steer |
| 队列编辑/删除/提升 | `session/updateQueue`：`sessionId`、`itemId`、`action: edit/remove/steer` | 无 | 无；`session.queue.list` 明确 `CAPABILITY_UNAVAILABLE`，不再伪造空队列 |
| 取消 | `session/cancel`：取消 active turn，保留 pending inbox；结果 `accepted: true` | SDK 白名单无 cancel/stop | `core.abort` 明确 `UNSUPPORTED`；不存在可用停止实现 |
| Fork | `session/fork`：`sessionId`、可选 `atSeq`、`allowMigration`；fork cold-readable exact event prefix | 无 fork 方法 | `session.fork` 明确 `CAPABILITY_UNAVAILABLE` |
| 草稿/未发送输入 | descriptor 无 `session/draft` 或 `draft/*` 端点 | 无 | 草稿由 renderer 本地状态持有；`session.models.mentions` 返回固定空 mentions，不是草稿存储 |
| 用量 | descriptor 无独立 `usage/*` 端点 | `assistant/message.data.usage` 与消息同事件提交 | host-services 已优先读该位置；`turn/end` 仅作兼容回退，无独立 usage record |
| 会话事件 | Web 有独立事件投影层 | `session.event` 通知携带 `sessionId` 与完整 `SessionEvent` | Bridge 按 session owner 投递；无 owner 不广播 |
| 事件序号 | Web 有自己的 stream/read-model 语义 | `SessionEvent.seq` 是会话内单调连续序号 | Bridge 另建投影 `streamSeq/eventSeq`；二者不能互换 |
| 时间旅行/恢复 | Web fork 不等于 UI time travel | 无快照列表/回滚工作区方法 | timeline/settings/storage/restore 全部明确不支持 |

直接证据：

- Web descriptor：`packages/dsh-gateway/src/wire/descriptors.json` 的 `session/cancel`、`session/create`、`session/fork`、`session/list`、`session/prompt`、`session/updateQueue`。
- SDK 参数声明：DSH 安装包 `node_modules/@deepseek-ai/dsh-sdk-protocol/lib/types/types.d.ts:72-101`。
- Bridge 能力与拒绝实现：`apps/desktop/src/studio-bridge.js` 的 `UNAVAILABLE_REASONS`、`capabilities`、`runCommand()`；回归：`packages/testkit/test/runtime-capabilities.test.mjs`。
- usage：DSH 安装包 `node_modules/@deepseek-ai/dsh-session/lib/types/types.d.ts:328-346`。
- Bridge usage 修正：`packages/host-services/src/index.js` 的 `usageFromSessionEvent()`。

## 4. 事件、序号与 owner 契约

DSH `SessionEvent` 是 append-only、lossless JSON 日志；`seq` 在单个 Session 内单调连续，`time` 是 Unix epoch milliseconds。事件带 `type`、`data`；surface 事件还带 `surfaceOp`，部分事件带 `sourceEventSeqs`。未知且未标 `ignorable: true` 的事件不能静默丢弃，否则不得声称重建了完整会话。

Desktop Bridge 当前策略：

1. `onSessionEvent` 要求 `params.sessionId` 和 `params.event` 同时存在，缺一项直接忽略。
2. 事件状态按 `sessionId` 放入独立 `sessionState`，工具调用归属也按 session 隔离。
3. `emitConversation` 只为当前拥有该 session 的 context 投递；无 context owner 时不投递。
4. `streamSeq` / `eventSeq` 是 Bridge 投影序号，不是 DSH 持久日志 `event.seq`。
5. `session/title` 按 session 发 snapshot，不向无 owner 的上下文广播。
6. context 切换、关闭、core.prompt 前取消 orphan approval；审批响应校验 owner 与 lease generation。

证据：`apps/desktop/src/studio-bridge.js:1528-1550`、`:1553-1560`；DSH `dsh-session/lib/types/types.d.ts:489-523`。

## 5. 错误与完成语义

- SDK dispatch 对未知方法、非法参数抛错，返回 JSON-RPC error；不能把“无此方法”映射成空成功。
- `session/query` 的响应只是 durable enqueue receipt。完成信号来自后续 `session.event`，主要是 `turn/end`；`turn/end.reason.kind === "error"` 必须投影为错误通知。
- `session/wait` 等待整个 Session 与托管后代 settle，不是单条 prompt 的 turn 完成回执。
- Web `session/cancel` 的 `accepted: true` 只表示取消请求被接受；它不表示 pending inbox 已清空，也不表示工作区文件已回滚。
- 当前 `core.abort` 的失败回执是诚实行为，应保留，不能用 UI loading 提前结束来冒充 cancel。
- `session.resume` 已修复假成功：Runtime 拒绝恢复时回 `failed / UNAVAILABLE`，保留原 active session，不发目标 snapshot。回归见 `packages/testkit/test/runtime-capabilities.test.mjs`。
- `core.steer` 与 `session.queue.list` 已修复假执行/假空结果：均回 `failed / CAPABILITY_UNAVAILABLE`，不调用 `runtime.query`。capability manifest 将二者标为 `unavailable`，将普通 query 近似能力标为 `limited`。
- `session.skills.list` 已修复磁盘技能冒充运行时身份：SDK 无此查询，命令明确回 `failed / CAPABILITY_UNAVAILABLE`，manifest 标为 `unavailable`；技能抽屉、能力页与提及候选只使用 `skills.get` 的 configured 读模型，不标记 loaded/session。

## 6. X0 必须保留的缺口

| 编号 | 事实 | 当前门禁 |
|---|---|---|
| R-01 | `core.followUp` / `queue.enqueue` 仍是普通 query；`core.steer` 已拒绝 | 不得宣称支持运行中插话；近似能力保持 `limited`，steer 保持 `unavailable` |
| R-02 | `session.queue.list` 已明确 `CAPABILITY_UNAVAILABLE` | 已修复假空队列；本地待发送队列必须与 Runtime 队列分开命名 |
| R-03 | `core.abort` 不支持 | 保持 `UNSUPPORTED`；不得伪造 stop accepted |
| R-04 | `session.resume` 假成功已修 | 失败回 `UNAVAILABLE`、不切换 context；Runtime / MCP / Skills / E-05 能力回归 15/15 通过 |
| R-05 | SDK 无 fork | 保持不支持；Web `session/fork` 仅登记为后续协议候选 |
| R-06 | descriptor 无独立 draft / usage 端点 | 不得虚构对应 Web 端点；草稿与 usage 按现有真实来源处理 |
| R-07 | Web transport 未实现 | 不得把 descriptor 端点勾选为 Desktop 已接通 |
| R-08 | Bridge 投影 seq 与 DSH 持久 seq 不同 | 跨层引用必须带来源，不得混用 |

## 7. 未验证项

- 未在本次 X0 文档核验中启动真实 SDK 会话测试 steer/cancel/fork；这些方法不在 SDK 白名单，因此结论来自直接 dispatch 与类型证据。
- RuntimeClient 的 spawn error、EPIPE、generation 隔离与 stop 超时由 fake ChildProcess 验证；真实 SDK 正常启停/重启、真实 Electron 主窗口关窗清理与便携生产包运行/关窗清理已有独立证据。真实拒退出/超时终止仍未覆盖；标准安装包也未验收。
- 未验证所有 provider 在 cancelled turn 后的计费结算行为；UI 不得承诺“取消即停止计费”。
- 未验证 Web 224 个端点在当前安装上的在线可用性；descriptor 是生成快照，不是在线探活结果。
- 未把 RuntimeClient 当前 query 包装扩展到图片、文件 receipt 或 queue mutation；这些属于后续 additive 协议工作。

本事实表不修改 Runtime 上游，不增加 Web Remote 依赖，也不把潜在端点计入 X0 已完成能力。
