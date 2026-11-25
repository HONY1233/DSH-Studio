# X1 控制、事件与用量核心契约

- 记录日期：2026-11-25
- 源码根目录：`/home/qtt199/projects/dsh-studio-xg0`
- 修改前基线：`F:\workbuddy data\tmp\dsh-x1-baseline-20261124T234333Z`
- 证据目录：`F:\workbuddy data\deliverables\dsh-studio\xg1-runtime-20261125`
- 源码控制状态：该导出源码树未观察到 `.git` 元数据；本阶段使用文件级修改前副本和 SHA-256，不宣称存在 Git diff 或回滚保护。

## 1. 门禁结论

**XG1 协议门通过（2026-11-25）。** 用户在纯核心阶段后明确回复“批准”，授权 Runtime additive 方法与真实 Runtime 集成。七方法、严格能力协商、unsupported 前置拒绝、双会话审批隔离与真实连续事件已通过验收。此结论只覆盖 XG1 协议门，不代表 XG0、全仓回归、物理设备或分发签名通过。

| 门禁条件 | 当前状态 |
|---|---|
| 用户/评审明确批准 additive Runtime 方法 | 已满足；用户回复“批准”，冻结契约见归档 `ADDITIVE-CONTROL-CONTRACT.md` |
| 能力矩阵与 unsupported 降级 | 已满足；initialize 必须广告精确 descriptor/method，缺失时在 wire 前拒绝 |
| 审批测试 | 已满足；真实 built Runtime 的 C=`allowed-once`、D=`rejected`，审批 ID、持久事件与工具执行结果隔离 |
| 事件测试 | 已满足；真实四会话事件从 `seq: 0` 起连续；桥接保留 `runtimeEventSeq`，与 projection `streamSeq` 分离 |
| 真实 Runtime cancel/steer/queue/draft | 已满足；真实 stdio 进程验证 replay/conflict、position、cancel/sent、CAS 草稿、steer/cancel 归属 |

用户“跳过物理设备和授权，继续”的调度决定仅让本轮不再等待物理设备与外部授权；这些项目继续记为“未验证”，不改变 XG0 或 XG1 结论。

## 2. 已实施范围

新增纯核心包 `@dsh-studio/workbench-core`，入口为 `packages/workbench-core/src/index.js`。该包不得依赖 Electron、React、RuntimeClient 或 HostServices；文件/Git 等能力必须由宿主注入 IO。

| WBS | 实施结果 | 生产边界 |
|---|---|---|
| X1.1 | 控制 envelope、receipt、错误码、能力协商、请求幂等 | 纯核心；执行器由宿主注入 |
| X1.2 | cancel/steer 默认 unsupported；批准后接入独立 additive 方法 | 真实 Runtime `session/turn.cancel`、`session/turn.steer`；不模拟 query |
| X1.3 | 队列 enqueue/cancel/list/position 默认 unsupported；批准后接真实 inbox | Runtime `session/queue.*`；本地待发仍不等于 Runtime position |
| X1.4 | 按会话隔离的草稿、revision、未提交状态与快照恢复 | Runtime draft 为 process-local；本地磁盘 fallback 明确标记 local |
| X1.5 | 会话事件 envelope、sequence gap、owner lease、多视图路由 | 已接真实 Runtime event；seq 0 保留，continuity 未知时显式提示 |
| X1.6 | UsageAdapter、原始哈希、归属、规范化字段 | 只读取已观察到的真实 usage 位置 |
| X1.7 | UsageLedger 幂等、去重、修正链与损坏报告 | 纯状态核心 |
| X1.8 | 注入 IO 的 JSONL repository、压缩与备份 | 尚未接 Electron Main 文件系统 |
| X1.9 | 既有 RuntimeClient wire 录制默认关闭、脱敏、限大小与轮转 | 本轮未改动既有实现 |

## 3. 控制协议（X1.1）

### 3.1 Envelope

`createControlEnvelope` 生成以下字段：

```js
{
  schemaVersion: 1,
  requestId,
  method,
  sessionId,       // 无会话时为 null
  revision,        // 非负安全整数；缺省为 null
  observedAt,
  payload,         // 可 JSON 序列化对象
}
```

`payload` 不接受 undefined、函数、非有限数、循环对象等不可 JSON 序列化值。复制后的执行器输入与原 envelope 隔离。

### 3.2 Receipt

成功 receipt 使用 `status: 'completed'` 并包含 `result`；失败 receipt 使用 `status: 'failed'` 并包含 `error`，**绝不包含 `result`**。

```js
{
  schemaVersion: 1,
  requestId,
  status: 'failed',
  observedAt,
  error: { code, message, details }
}
```

错误码固定为：

```text
INVALID_ARGUMENT
NOT_FOUND
CONFLICT
CAPABILITY_UNAVAILABLE
UNSUPPORTED
OWNER_MISMATCH
SEQUENCE_GAP
BUFFER_OVERFLOW
CORRUPT_RECORD
STORAGE_FAILED
INTERNAL
```

### 3.3 能力矩阵

`createCapabilityManifest()` 不带 Runtime descriptor 时，内部 Runtime 方法全部为 `unavailable`。下表保留纯核心阶段的内部命名；批准后的 wire 方法名及严格映射以冻结契约为准。

| 内部能力 | 当前原因 |
|---|---|
| `session.cancel` | 没有经批准的按轮次取消方法 |
| `session.steer` | 没有经批准的运行中插话方法 |
| `session.queue.enqueue` | 没有经批准的幂等消息队列 |
| `session.queue.cancel` | 没有可取消的运行时消息队列 |
| `session.queue.list` | 本地待发状态不等于可读取的运行时队列 |
| `session.queue.position` | 本地顺序不是 Runtime position |
| `session.draft.save` | Runtime 草稿同步未接入，只能本地保存 |

只有 Runtime initialize 明确广告 protocolVersion 1、精确七个 method 和完整 durability/replay descriptor 时，能力才可变为 `available`。旧 Runtime 或畸形 descriptor 均在 wire 前失败，不按包版本推断支持。`draft.local`、`events.local`、`usage.local` 始终是 `local-only`，不能用于授权 Runtime 调用。

### 3.5 已批准的 Runtime additive 方法

```text
session/turn.cancel
session/turn.steer
session/queue.enqueue
session/queue.list
session/queue.cancel
session/draft.get
session/draft.put
```

Runtime request replay 与 draft 的 durability 均为 `runtime-process`，不是 crash-durable。cancel/steer/enqueue receipt 只表示控制受理，不表示 turn 完成。Runtime 原生事件从 `seq: 0` 开始；Studio 的一基 envelope 只用于纯路由，`runtimeEventSeq` 保留原生值，`streamSeq` 只作本地 projection。

### 3.4 幂等与冲突

`createControlDispatcher` 在进程内按 `requestId` 保存请求指纹与执行 Promise：

- 同一 `requestId` 与同一规范化请求返回原 Promise/receipt，不重复执行。
- 指纹按 method、sessionId、revision、payload 的稳定 JSON 计算，键顺序不影响一致性。
- 同一 `requestId` 对应不同请求返回 `CONFLICT`，不调用执行器。
- 已知 Runtime 方法在能力检查失败时，先记录失败 receipt，**不调用注入执行器**。
- 该 journal 当前是进程内状态，不宣称跨进程持久幂等。

## 4. 草稿与本地未提交状态（X1.4）

草稿状态按 `sessionId` 隔离：

```js
{
  schemaVersion: 1,
  sessions: {
    [sessionId]: {
      sessionId,
      draftId,
      revision,
      body,
      attachments,
      submission,
      updatedAt,
    },
  },
}
```

`updateDraft` 要求调用方提供正确的 `expectedRevision`；版本冲突返回 `CONFLICT` 并拒绝覆盖。附件 id 必须唯一，正文上限为 1,000,000 字符。

本地提交状态为：

```text
sending → local-queued / accepted / failed
sending → null（cancelDraftSubmission）
```

每次提交保存正文与附件快照，并固定 `origin: 'local-unsubmitted'`、`runtimeQueued: false`。只有显式调用 `acceptDraftSubmission` 才把 `runtimeAccepted` 设为 true；本地排队函数不会设置它。恢复快照时会拒绝伪造的 Runtime queue 状态、接收状态与快照不一致等损坏数据。

**`local-queued` 不是 Runtime 队列位置，也不是 Runtime 已接收凭据。**

## 5. 会话事件路由（X1.5）

事件 envelope 固定为：

```js
{
  schemaVersion: 1,
  eventId,
  sessionId,
  sequence,        // 从 1 开始的正安全整数
  type,
  occurredAt,
  originLease,
  data,
}
```

`createEventRouter({ replayWindow })` 提供：

```text
registerSession(sessionId, lastSequence)
leaseOwner(sessionId, contextId, leaseId, generation)
releaseOwner(sessionId, contextId, expectedLease)
ingest(event)
acknowledge(sessionId, contextId, eventId, expectedLease)
snapshot(sessionId)
```

不变量：

- 无 owner 的事件只缓冲，不广播。
- sequence 出现缺口时在 `gap` 中报告：`expected`、`received`、`missingFrom`、`missingTo`。
- 只有连续序号全部到齐才按顺序 flush；不跳号、不丢已缓冲事件。
- 同一会话可 fan-out 给多个当前 view/owner，但仍只摄入一次 Runtime 事件。
- 同序号同内容、同 eventId 同内容均为 duplicate；同序号不同内容或 eventId 复用为 `CONFLICT`。
- 旧 lease generation 不能释放或确认当前订阅。
- 缺口缓冲超过 `replayWindow` 返回 `BUFFER_OVERFLOW`。
- seen、delivery identity、acknowledgement 状态按 replay window 清理。

该模块是客户端状态核心；XG1 已通过真实 Runtime stdio 进程验证多会话事件与审批。Studio bridge 对首个 `seq > 0` 只建立本地排序基线并提示连续性未知，不把 `seq - 1` 冒充权威 attachment watermark。

## 6. 用量适配（X1.6）

UsageAdapter 只从以下已观察位置取原始用量：

```text
assistant/message.data.usage
turn/end.data.usage
turn/end.data.result.usage
```

缺失时返回 `null`，不编造零用量。记录保留：

```text
schemaVersion
usageId
rawUsageHash
attribution
observedAt
normalized
raw
correctionOf
```

识别的 token 字段为：

```text
uncachedInputTokens
inputTokens
outputTokens
cacheReadTokens
cacheWriteTokens
reasoningTokens
contextTokens
maxTokens
```

所有已识别字段必须是非负安全整数，至少存在一个。`normalized` 必须与 `raw` 逐字段完全一致。`rawUsageHash` 是稳定 JSON 的确定性非加密指纹，仅用于去重和完整性检查，不是安全哈希或凭据保护。

## 7. 用量账本（X1.7）

`createUsageLedger` 状态包含 `revision`、`records`、`pendingCorrections`、`corruptions`。

- 同 `usageId` 同内容为 duplicate，不推进 revision、不重复计入。
- 同 `usageId` 不同有效内容返回 `conflict` 并写入可见 `CONFLICT` 报告。
- 无效、负数、小数、raw hash 不一致或 normalized 被篡改的记录不进入 totals，写入损坏报告。
- 修正记录通过 `correctionOf` 指向旧记录；生效后旧记录 inactive，totals 只计 active 记录。
- 修正可先于旧记录到达并留在 `pendingCorrections`；旧记录到达后递归结算多级修正链。
- 自引用与循环修正被拒绝并可见报告。
- `serializeUsageLedger` / `restoreUsageLedger` 校验版本、记录、修正链、active 状态与损坏报告。

## 8. JSONL Repository（X1.8）

`createJsonlUsageRepository` 要求宿主注入：

```js
{
  read(path),
  append(path, text),
  atomicWrite(tempPath, targetPath, text),
  copy(sourcePath, targetPath),
  remove?(tempPath),
  now(),
}
```

纯核心不导入 `node:fs`。使用前必须 `load()`；API 为 `append`、`backup`、`compact`、`snapshot`、`report`。

JSONL 行格式：

```js
{ format: 'dsh-usage-jsonl', version: 1, kind: 'usage', record }
{ format: 'dsh-usage-jsonl', version: 1, kind: 'corruption', corruption }
```

行为约束：

- 非法 JSON、截断行、未知格式/版本均生成带行号的损坏报告，不静默丢弃。
- 已保存的 corruption 行在压缩与重载后保留，不重复变成新的 invalid-row 报告。
- duplicate append 不再次写盘。
- append 失败时内存账本不推进。
- compact 必须先成功备份，再通过 `atomicWrite` 替换。
- atomicWrite 失败时原 repository 保持权威，临时文件尽力清理。
- 当前 IO 测试为内存适配器，不冒充真实磁盘、SQLite 或 Electron Main 集成。

## 9. 架构与生产边界

新增第 8 组架构规则，禁止 `packages/workbench-core/src` 依赖：

```text
electron
react
react-dom
@dsh-studio/runtime-client
@dsh-studio/host-services
```

本轮未修改：

```text
apps/desktop/src/main.js
apps/desktop/src/studio-bridge.js
apps/desktop/src/preload.cjs
packages/runtime-client/src/index.js
packages/host-services/src/index.js
apps/renderer/src/App.jsx
apps/renderer-omp/vendor/omp/*
```

`package-lock.json` 仅新增 `@dsh-studio/workbench-core` workspace link 与包条目；与修改前基线逐路径比较，未发现其他差异。

## 10. 验证证据

归档根目录：`F:\workbuddy data\deliverables\dsh-studio\xg1-runtime-20261125`。

| 检查 | 结果 | 日志 / 数据 |
|---|---|---|
| 真实 built Runtime XG1 验收 | 1/1；四会话 native events 25/19/29/27；mock requests 6；stderr 空 | `runtime-control-e2e-final.log`、`runtime-control-e2e-run6.json` |
| 真实审批隔离 | C allowed-once 且工具成功；D rejected 且 `SANDBOX_ESCALATION_REJECTED`；审批 ID 不同 | 同一结果文件与 `runtime-control-wire-run6.jsonl` |
| Runtime XG1 聚焦回归 | 4 文件/88 项全部通过 | `runtime-focused-final.log` |
| Renderer XG1 聚焦回归 | 3 文件/40 项全部通过 | `renderer-xg1-focused-final.log` |
| Studio Main 完整回归 | 243 通过、1 跳过、0 失败 | `studio-main-final.log` |
| Renderer 构建 | 退出码 0；3083 modules；1.65s | `renderer-build-final.log` |
| Renderer typecheck（XG1 历史变更范围） | 退出码 0，无诊断；不覆盖 `renderer-omp` 全量 typecheck | `renderer-typecheck-final.log` |
| Runtime artifact/typecheck | `build:artifacts` 8/8；`build:check` 2/2（实现阶段结果） | Runtime 构建记录；代码此后未再改动 |
| Python SDK parity | 368 passed、53 skipped（实现阶段结果） | Python SDK 回归记录；代码此后未再改动 |
| 早期纯核心 | 22/22；`npm run check` 220/220；Studio 525/525 | `standard-package-20261125/evidence/x1-core-20261125` |
| 全量 Renderer 套件 | **已通过**；288 文件、544 suites、2,132 tests，0 失败、0 跳过 | `docs/evidence/renderer-regression-20261125/REPORT.md` |
| Runtime 全仓回归 | **未通过，未完成 clean-tag 基线对照**；17 files/68 tests failed | 实现阶段全仓日志；失败簇含环境/超时/native fixture |

早期 Renderer 全量失败包含默认 node 环境导致 `window/document/localStorage/Range` 缺失、vendored `@omp-studio/testkit` 源包缺失、vendor dist 测试被收集、重复 React 及既有文案断言差异。上述基础设施与过时断言已修复，生产 dock panel 引用、`/btw` 键盘规划、Eval 媒体引用与 preview 默认值也已修正；末次全量 288 文件、2,132 项全部通过。XG1 早期归档中的“全量 Renderer 未通过”仅作为历史快照保留。由于不存在 XG1 修改前 clean baseline，本轮只声明同口径恢复结果，不声称全部历史失败均由 XG1 引入。

## 11. 仍未验证 / 下一步

- XG0 物理双屏、混合 DPI、负坐标、热插拔、旋转；摄像头/麦克风与 Windows 权限弹窗。
- XG0 E-05 真实 ASR/judge/MCP/Agent 适配器、provider、凭据、预算、费用与回执。
- Runtime 全仓失败簇 clean-tag 基线对照；`renderer-omp` 全量 TypeScript 检查仍未清零。
- Renderer 全量已通过，但不存在 XG1 修改前 clean baseline；不得把它扩展为 Runtime 全仓、XG0 或发布验收。
- Electron Main 文件 IO 接入、真实磁盘故障、SQLite/JSONL 生产持久化。
- Runtime draft 为 process-local；本地 fallback 在 Runtime 升级后的 authority/CAS 行为仍需专门验证。
- 事件缓冲溢出目前有显式错误，但尚无 reset/resync API。
- 提交、推送、发布仍未获授权。

XG1 的 additive 批准与真实审批/事件联调已经完成；后续工作不得反过来把该历史门禁描述为“尚未批准”。
