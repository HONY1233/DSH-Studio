# DSH Studio 桌面产品扩展落地计划书

| 项目 | 内容 |
|---|---|
| 文档版本 | 1.0 |
| 日期 | 2026-11-24 |
| 状态 | 详细实施草案，待 G0 评审；不授权生产实现 |
| 上位方案 | [DSH-WORKBENCH-DESKTOP-PRODUCT-PLAN.md](./DSH-WORKBENCH-DESKTOP-PRODUCT-PLAN.md) |
| 基础计划 | [DSH-WORKBENCH-LAYOUT-IMPLEMENTATION-PLAN.md](./DSH-WORKBENCH-LAYOUT-IMPLEMENTATION-PLAN.md) |
| 视觉依据 | [DSH-WORKBENCH-VISUAL-INTEGRATION-PLAN.md](./DSH-WORKBENCH-VISUAL-INTEGRATION-PLAN.md) |
| 本文目标 | 把窗口化、多会话、工具全覆盖、用量统计拆成可指派的文件级任务、协议、测试、验收与回滚方案 |
| 规划规模 | 12 项需求、81 项 WBS、93 条验收、20 项风险、9 个阶段批准门 |

> **当前授权边界**：本文只交付规划。生产代码、Runtime、依赖、凭据、构建、测试、Git 写操作、提交、推送和发布均未获批准。文中的新增方法、文件、命令、表格和状态名都是**拟议设计**，不是已存在实现。

---

## 0. 阅读方式与决策摘要

### 0.1 优先级结论

按以下顺序实施，不得为了先出界面跳过前置能力：

1. **X0 基线与协议门**：冻结真实 Runtime 能力，修复审批竞态、会话隔离、usage 字段、日志脱敏和 PTY 清理。
2. **X1 控制面与事件面**：经单独批准后增加 additive stop/steer/queue/draft/usage 能力；不支持的能力明确返回 unsupported。
3. **X2 纯核心**：先实现零副作用布局、窗口引用、租约、幂等用量账本及状态不变量。
4. **X3 原生窗口宿主**：统一浮窗、吸附、分组、最小化、独立系统窗口和多显示器恢复。
5. **X4 多会话工作区**：每场会话独立草稿、审批、工具实例和布局；共享只读状态与单订阅事件源。
6. **X5 工具适配器**：逐工具接真实 Desktop/Host/Runtime 能力，不接 OMP 假接口。
7. **X6 用量界面**：最后把已验证账本投影到首页图表和顶栏。
8. **X7 全量质量验证；X8 灰度与退出**：达到真实设备、安全、恢复和回滚门后才启用新入口。

### 0.2 不可妥协的产品原则

- 最终入口是 `apps/renderer`；`apps/renderer-omp` 只允许作为一次性行为参照和迁移来源。
- 不 import、复制或长期桥接 OMP reducer、store、type、client、transport、vendor 或美化代码。
- 业务事实只来自 DSH Runtime/Host、用户操作和可核验的本机服务；OMP mock 数据不进入新工作台。
- 没有真实后端能力时显示“不可用/未接入”及原因，不画假进度、不返回固定空数组冒充“没有数据”。
- 前端 capability 只控制可见性，不是安全边界；Main 必须再次校验 sender、workspace、会话、路径、窗口归属和操作权限。
- 所有耗时动作可取消、有唯一请求 ID、有终态；重复点击不得重复提交业务动作。
- 会话事件、审批、终端输出和浏览器 cookie 不得跨会话泄漏。
- 不新增“第二套工作台状态”：布局、窗口、会话文档、工具实例各有唯一状态源，界面只保存可重建的展示偏好。
- 视觉继续遵循四源 clean-room 融合，不新增 shadcn/ui、Seelen UI、Oh My Zsh 运行时依赖，不复制 Seelen 的 AGPL 代码或素材。

### 0.3 与 v2.3 基础计划的关系

| v2.3 约束 | 本文处理 |
|---|---|
| `workbench-core` 零 React/DOM/Electron/Runtime/OMP 依赖 | 保留；新增窗口、租约、usage 纯模型也放在 core |
| `workbench-ui` 只依赖 core/React | 保留；浏览器和系统窗口通过端口注入，不直接访问 Electron |
| Renderer 唯一直接读取 `window.dsh` 的应用层 | 保留；新组合层同样只经 preload 端口，不创建第二 RuntimeClient |
| Desktop Main 不知道会话业务 | 收窄为“不知道消息渲染，但校验会话/工作区所有权”；安全校验不能缺失 |
| 不修改 Runtime 协议 | **仅基础布局迁移继续有效**。新需求所需 stop/steer/queue/draft/usage/fork/restore 必须走 X0/X1 协议审计和单独批准，只允许 additive envelope |
| Browser、Computer、BTW、Evaluation 为范围外 | 被上位产品方案取代，在本文 X5 纳入，但外部能力未验证前不得启用 |
| 旧入口可回退 | 保留；通过显式入口开关回退，不做双写状态和长期兼容层 |

**Runtime 扩展红线**：只新增方法、事件字段和可选 capability；不改既有 `session/query` 请求语义、既有 `session.event` 语义、模型路由、权限策略、审批结果格式和已有 SDK 客户端兼容性。不能通过“把 steer 当普通 query 发送”伪造能力。

**服务端边界**：X0 必须定位实际 Runtime 源码/构建仓库及其版本。若服务端没有所需能力，X1 必须拆成“Runtime 服务端独立变更 + 本仓库客户端/契约变更”两项批准与验收；不能只给 `RuntimeClient` 加一个会收到 unknown-method 的方法，也不能用假 Runtime 通过测试冒充真实支持。Runtime 仓库未获单独批准时，本仓库只能交付 capability 探测、unsupported 状态和兼容客户端测试。

---

## 1. 范围、需求与交付口径

### 1.1 产品需求追踪

| 需求 ID | 需求 | 主要 WBS | 验收 |
|---|---|---|---|
| RP-01 | 对话、工具、网页共用窗口系统；浮动、吸附、分组、最小化、窗口与界面缩放 | X2.3～X2.9、X3.1～X3.6 | XB-03～XB-12、XC-01～XC-06 |
| RP-02 | 独立系统窗口、任务栏入口、第二显示器、重启恢复 | X0.8、X2.10、X3.7～X3.10 | XC-07～XC-12 |
| RP-03 | 多会话并行，每场独立草稿、审批、工具和布局 | X1.1～X1.5、X2.11、X4.1～X4.6 | XA-02～XA-07、XC-13～XC-18 |
| RP-04 | 左侧栏、工具区、右栏、底栏、浮窗自由拖放；6px 真实内容预览 | X2.2～X2.9、X4.2、X7.2 | XB-01～XB-16 |
| RP-05 | Files、Changes、Git、Worktree、提交图 | X5.1～X5.3 | XD-01～XD-05 |
| RP-06 | Terminal、SSH/WSL2 | X0.6、X5.4～X5.5 | XA-10、XD-06～XD-08 |
| RP-07 | 托管浏览器多标签、DevTools、元素截图引用、持久登录空间 | X0.9、X5.6～X5.7 | XA-11～XA-13、XD-09～XD-13 |
| RP-08 | Computer Use、MCP/Skills、Agent Hub 星图 | X5.8～X5.10 | XD-14～XD-17 |
| RP-09 | BTW、语音输入、评测工作区、Time Travel | X5.11～X5.14 | XD-18～XD-21 |
| RP-10 | 首页 Token 折线图与热力图；年/月/周/日切换 | X1.6～X1.8、X2.12、X6.1～X6.4 | XE-01～XE-12 |
| RP-11 | 顶栏本轮用量、缓存命中、上下文占用 | X1.6～X1.8、X6.5 | XE-05～XE-09 |
| RP-12 | 原生化、安全、可恢复、可回滚、无长期 OMP 桥 | 全部；重点 X0、X7、X8 | XA-01～XA-14、XF-01～XF-12 |

### 1.2 交付物分层

| 层 | 批准后交付物 | 完成口径 |
|---|---|---|
| L0 调查 | 协议清单、能力矩阵、环境探针报告、脏工作树快照 | 有文件/行号或真实命令结果；未知项明确标 unknown |
| L1 核心 | `workbench-core`、fixture、纯状态测试 | 无 Electron/React/Runtime 调用；确定性回放通过 |
| L2 宿主 | Main/preload 端口、窗口/终端/浏览器服务、安全测试 | 恶意 sender、跨窗口和失效票据被拒 |
| L3 产品 | 新 Renderer 组合层、全部工具面板、用量界面 | 经真实 Runtime/Host 数据驱动；mock 仅测试 |
| L4 设备 | Windows 真机、双屏、DPI、重启、断连、压力记录 | 每条设备验收有截图/录屏/日志和实际结果 |
| L5 发布 | 灰度开关、备份、回滚包、恢复手册 | 不覆盖用户数据；旧入口可按明确指令恢复 |

每轮汇报只使用三种结论：**已满足**（附证据）、**未验证**（附原因和下一步）、**外部阻塞**（附责任方/前置条件）。禁止把“代码已写”表述成“产品已完成”。

### 1.3 不在本文授权内

- 不替换 DSH Runtime 本体，不修改上游 SDK 包，不做模型供应商计费系统。
- 不实现远程多用户同步、云端账号体系、插件市场或移动端。
- 不默认开启自动批准、`noVerify` 提交、任意 shell 执行、任意 URL 导航或跨工作区文件访问。
- 不在未选择 Computer Use、ASR、SSH 密钥或 fork 协议时擅自接外部服务、读取凭据或产生费用。
- 不删除旧原型、旧计划、录屏和既有未提交改动。

---

## 2. 当前基线与已确认缺口

### 2.1 源码基线

| 证据 | 当前事实 | 对实施的影响 |
|---|---|---|
| [package.json](./package.json) | workspaces 含 desktop、renderer、packages；根 `check` 串联架构、入口、构建和 testkit | 新包必须接入 workspace 和 `check`，不能只在原型目录完成 |
| [contract/legacy-sdk.js](./packages/contract/src/legacy-sdk.js) 第 12～37 行 | 固定请求只有 initialize、prompt/query、resume、wait、working-directory、shutdown；没有 stop/steer/queue/draft | 控制面前必须做协议扩展或明确 unsupported |
| [preload.cjs](./apps/desktop/src/preload.cjs) | `window.dsh` 无 stop/cancel/steer/queue/draft、窗口系统、SSH、Computer Use、语音端口 | 不能直接在 UI 调用不存在的方法 |
| [renderer/App.jsx](./apps/renderer/src/App.jsx) | 会话、审批、输入均在一个组件；只有一个全局 Composer | 多会话必须拆 document/view，不继续堆 App 状态 |
| [studio-bridge.js](./apps/desktop/src/studio-bridge.js) 第 1510～1584 行 | `usage.get` 固定空数组；telemetry 只含 sessionId/generatedAt；部分控制语义降级 | OMP 桥不得作为真实能力来源 |
| [main.js](./apps/desktop/src/main.js) 第 170～220 行 | 原生终端按 webContents.id 保存，每窗口一个 PTY | 需改为 ToolInstanceId，并补齐关闭/恢复生命周期 |
| [main.js](./apps/desktop/src/main.js) 第 175～183、549～560 行 | 原生终端关主窗会清理，但既有审计发现 OMP 多 PTY 未随窗口关闭 | 在 X0 统一资源账本并回归，不把旧泄漏带入新窗口系统 |
| [runtime-client/index.js](./packages/runtime-client/src/index.js) 第 218～258 行 | 服务端请求无人同 tick 响应时，微任务后自动取消；Main 实际异步保存 respond | 审批可能在用户看到前被取消，是 P0 阻断 |
| [runtime-client/index.js](./packages/runtime-client/src/index.js) 第 188～196 行 | wire 原样记录 JSONL | 需先脱敏再开启生产录制 |
| [studio-bridge.js](./apps/desktop/src/studio-bridge.js) | 多会话无人接管时使用 `[undefined]` 广播兜底 | 会串会话，必须改为 owner/lease + 隔离队列 |
| [host-services/index.js](./packages/host-services/src/index.js) | usage 从 `turn/end.data.usage/result.usage` 读取 | 与真实 fixture 不一致，统计基线不可信 |
| [projection.js](./packages/contract/src/projection.js) 第 106～110 行 | projection 从 `assistant/message.data.usage` 读取 | 只能证明一种事件位置，不能证明 provider 全部字段 |
| [projection-basic.jsonl](./packages/testkit/fixtures/projection-basic.jsonl) 第 8 行 | fixture usage 位于 `assistant/message.data.usage`，turn/end 无 usage | X0 需冻结字段，X1 做多来源适配 |
| [main.js](./apps/desktop/src/main.js) | 浏览器是单例、无 partition、URL scheme 未收窄、无多标签/DevTools/元素拾取 | 浏览器工具必须新建受控服务，不能只加面板 |
| [studio-ui/event-hub.ts](./packages/studio-ui/src/shell/event-hub.ts) 第 67～125 行 | 已有同 session 单订阅、最后订阅者释放逻辑 | 可提炼原生实现，不直接搬 OMP 客户端 |
| [studio-ui/leases.ts](./packages/studio-ui/src/ui-session-views/leases.ts) 第 128～309 行 | 已有 retain/release、引用计数和微任务宽限 | 可验证租约语义，需适配新宿主 |
| [studio-ui/layout.ts](./packages/studio-ui/src/workbench/layout.ts) 第 32～248 行 | 已有纯布局树、Pin、浮窗、归一化、compact 思路 | 作为 core 重写参考，不 import OMP 类型/模块 |

### 2.2 已知测试与工程缺口

- 既有审计发现 `studio-ui-shell.test.mjs` 仍保留“只注册 sidebar”的旧断言，与当前 main+sidebar 不一致。X0 必须单独登记测试名、失败原因和基线结果；后续修复不得通过删断言掩盖回归。
- 当前架构检查未完整覆盖 `studio-ui`；入口检查不能证明语义正确。X0 需增加包依赖边界和入口真源检查。
- Electron 版本锁定不等于内嵌 Node 版本已知。`@types/node` 24 和 WSL Node 24 不能证明 Main 中 `node:sqlite` 可用。
- 当前没有 SQLite、`better-sqlite3`、`ssh2` 依赖；用量存储和 SSH 必须先探针/选型，不得按“已具备”排期。
- 现有凭据体系含明文配置及权限位做法，尚无 DPAPI/keychain/safeStorage 产品集成。SSH、浏览器 partition、ASR 密钥的安全设计是 X0/X5 前置。
- 工作树已有未提交改动。X0 实施前记录 `git status --short`、当前 HEAD、文件哈希和测试基线；不得 reset、clean、checkout 覆盖或顺带提交。

### 2.3 能力状态矩阵

| 能力 | 当前可证实状态 | 产品目标 | 未通过前置门时的行为 |
|---|---|---|---|
| 文本 query/resume/wait | 已有真实 RuntimeClient 通道 | 复用 | 连接失败显示错误，不排队假成功 |
| stop/cancel | 未在原生端口/固定协议中发现 | 真实中断当前 turn | 禁用并显示“当前 Runtime 不支持” |
| steer | OMP 降级为再次 send，不是真能力 | 运行中插入用户指令 | 不得伪装；unsupported |
| queue/draft | queue.list 固定空；无草稿 API | 本地草稿 + 真运行队列 | 草稿可本地实现；队列仅本地待发并明确“未提交” |
| 审批 | 有通道，但存在竞态 | 每会话审批、超时取消、可审计 | XA-02 未过前不启用新多会话 UI |
| Terminal | node-pty + WSL shell 已有 | 多实例、跨宿主、恢复元数据 | 不恢复未知 PTY，只恢复 shell 配置 |
| SSH | 未发现真实驱动 | SSH profile + 主机/密钥管理 | unsupported，不读取 `~/.ssh` 批量枚举 |
| Files 编辑 | 原生只读；OMP 有 expectedVersion/冲突思路 | 原生读写、版本冲突、保存事务 | 只读模式可用，写操作 disabled |
| Git stage/commit | Host 有函数，bridge 未完整接 | 原生 Changes/Git/Worktree/图 | 不接 OMP `git.execute` 空实现 |
| 浏览器 | 单例 WebContentsView，无受控 partition | 多标签、DevTools、元素引用、登录空间 | 仅 http/https；其余 disabled |
| Computer Use | 未发现真实 OS 驱动 | 受控截图/输入/动作回执 | unsupported；禁止 UI 演示冒充执行 |
| MCP/Skills | 有配置树读取思路，不等于会话可执行清单 | 展示、会话覆盖、调用审计 | 只读可见；不可执行时 disabled |
| Agent Hub | 有 subagent started/finished 通知，不足以证明完整派生图 | 主/子 Agent 星图与状态 | 只显示已证实节点，缺边显示“关系未知” |
| BTW | 无真实独立服务 | 不污染主对话上下文的旁路询问 | 若不能隔离上下文则 unsupported |
| 语音输入 | 无 ASR 通道 | 麦克风→转写→草稿，可编辑 | unsupported；不申请麦克风权限 |
| 评测 | 历史有评测脚本成果，不能自动视为新宿主已接 | 原生 EvaluationRun/Case 工作区 | 标“待接入”，不展示历史 mock 为当前结果 |
| Time Travel | 可读会话事件/日志，不等于可 fork/restore | 事件时间线、快照、恢复计划 | 只读时间线；fork/restore unsupported |
| usage | fixture 有一种真实位置，host/bridge 不一致 | 账本、聚合、图表 | 页面显示“统计不可用”，不补 0 |

---

## 3. 目标架构与模块边界

### 3.1 包和入口

```text
apps/renderer                      产品入口、组合层、页面、纯展示交互
  src/workbench/                   新工作台组合层，不继续扩大 App.jsx
apps/desktop
  src/main.js                      进程编排；尽量拆为 window/browser/terminal/security 服务
  src/preload.cjs                  唯一主窗口原生端口
  src/workbench-preload.cjs        独立系统窗口窄端口
packages/contract                  wire 常量、IPC DTO、错误码、共享类型，不放业务状态
packages/workbench-core            纯布局/窗口/会话文档/租约/usage 状态与不变量
packages/workbench-ui              纯 React 展示组件和受控交互
packages/host-services             文件、Git、事件读取、进程与工作区服务
packages/runtime-client            单一 RuntimeClient 与 additive 协议客户端
packages/testkit                  回放 fixture、协议假 Runtime、端到端断言
packages/studio-ui                 后续改为消费共享 core/UI；OMP 桥退出前不扩写
```

允许的新增目录仅为实施上述职责所需。若一个服务必须同时改布局、访问 Electron 又直接拼 Runtime wire，先拆职责再实现。

### 3.2 依赖方向

```text
renderer -> workbench-ui -> workbench-core
renderer -> runtime-port(interface) -> preload -> Main -> RuntimeClient/Host
desktop -> contract + host-services + runtime-client + workbench-core(仅纯校验)
testkit -> contract + core + protocol fixtures
```

禁止：

- core import React、DOM、Electron、`window.dsh`、RuntimeClient、OMP。
- UI 直接 import Main 实现、node-pty、文件系统或 OMP store。
- 子窗口加载 App 或创建 RuntimeClient。
- Renderer 将任意 shell、任意 URL、任意文件路径直接交给 Main 执行。
- 通过 OMP bridge 的固定空值/模拟结果“补齐”新工作台。

### 3.3 状态源划分

| 状态 | 唯一状态源 | 可否持久化 | 重建方式 |
|---|---|---|---|
| 窗口/分组/布局/几何 | `WorkbenchLayout` + `WindowRegistry` | 是 | 按主 ID 恢复，校验 display/workArea |
| 会话消息/事件/运行状态 | Runtime + SessionEventStore | Runtime 持久化；本地只缓存窗口 | resume + readSessionEvents |
| 草稿/队列意图/审批 UI 状态 | ConversationWorkspace.document | 草稿是；审批按 Runtime 状态校准 | 本地草稿恢复，队列未提交不得冒充已入队 |
| 工具实例/租约/会话归属 | ToolInstanceRegistry + SessionLeaseRegistry | 元数据是；活进程否 | 按实例 ID attach；失效显示 disconnected |
| 浏览器 tab/partition | BrowserRegistry | tab URL/标题是；cookie 由 partition 持久化 | 恢复 tab，不假设登录仍有效 |
| 用量原始事件 | UsageLedger | 是，append-only + revision | 从原始事件重放聚合 |
| 图表/热力图 | UsageReadModel 派生缓存 | 可重建，非事实源 | 删除后重新聚合 |
| 视觉偏好 | WorkbenchPreferences | 是 | 使用默认值回退 |

### 3.4 核心身份模型

```ts
type ConversationRef =
  | { kind: 'conversation'; sessionId: string }
  | { kind: 'conversation'; draftId: string }

type PanelRef = { kind: 'panel'; panelId: string; instanceId: string }
type BrowserRef = { kind: 'browser'; browserId: string; tabId: string }
type WindowContentRef = ConversationRef | PanelRef | BrowserRef

type DesktopScope = {
  hostId: string
  workspaceId: string
  owner: ConversationRef
}

type PinLevel = 'none' | 'workspace' | 'application' | 'window' | 'topmost'

interface WindowRef {
  windowId: string
  host: 'main' | 'internal' | 'native'
  content: WindowContentRef
  placement: 'main' | 'float' | 'snapped' | 'minimized' | 'native'
  groupId?: string
  native?: {
    displayId: string
    normalBounds: Rect
    isMaximized: boolean
    isMinimized: boolean
    topmost: boolean
  }
}
```

同一 session 可以有多个 ConversationView，但共享一个业务状态和 Runtime 事件订阅。同一独占工具只能有一个 live owner；移动工具时由 reducer 原子改变 owner/lease，不允许“复制 PTY”。

---

## 4. P0 前置与协议设计

### 4.1 协议盘点方法（X0.2）

在写任何新方法前完成一份协议事实表：

1. 读取当前 `legacy-sdk.js` 和实际 WSL Runtime 的版本/identity，不以 npm 名称猜版本。
2. 用录制 fixture 和最小无副作用请求核对 `initialize` capability、session.event、session.status、query.completed、approval、user-question、subagent 事件。
3. 对 stop/steer/queue/draft/usage/fork/restore 逐项记录：**已支持 / 可通过现有方法真实实现 / 需 additive / 不支持 / 未知**。
4. 每个结论附请求/响应/通知 JSON 或“已搜索但不存在”的源码证据。
5. 不通过运行真实模型查询来探活能力；协议测试使用假 Runtime 或只读方法。

### 4.2 会话控制 additive 提案

以下名字是设计候选，X1 批准后才写入 contract：

| 方法 | 输入 | 成功输出 | 失败语义 |
|---|---|---|---|
| `session/turn.cancel` | sessionId、turnId?、requestId、reason | accepted、effectiveTurnId、status | 非运行中返回 `not-running`；已结束返回 `already-ended`，不报假成功 |
| `session/turn.steer` | sessionId、turnId、requestId、contentBlocks | accepted、queuedInstructionId | 不支持/阶段不允许返回 `unsupported`/`invalid-state` |
| `session/queue.enqueue` | sessionId、requestId、contentBlocks、clientDraftId | queuedItemId、position | 持久化前不返回成功；重复 requestId 返回原回执 |
| `session/queue.list` | sessionId | items、revision | 只返回 Runtime 确认队列，本地待发单独标记 |
| `session/queue.cancel` | sessionId、queuedItemId、requestId | cancelled 或 already-sent | 已发送只能取消当前 turn，不能假装撤回消息 |
| `session/draft.get/put` | sessionId、draftId、expectedRevision、contentBlocks | revision、savedAt | revision 冲突返回 conflict + currentRevision，不覆盖 |
| `session/usage.read` | sessionId、from?、to?、cursor? | events、nextCursor、source | 无记录返回空 + coverage 信息；读失败返回 error |

若服务端需变更，X1.2～X1.4 的产物包括实际 Runtime 仓库的方法实现、协议测试和版本说明；本仓库的 RuntimeClient 只负责传输、幂等和错误映射。X0 未定位/未批准 Runtime 仓库时，这些任务保持“客户端设计完成、真实能力未验证”，不得进入 X4 多会话完成口径。

**不变量**：

- 所有写操作使用 `requestId` 幂等；取消与 enqueue 不得改变既有消息 ID。
- steer 不通过 `session/query` 模拟；queue 与草稿不是同一状态。
- `session/query.completed` 必须关联 requestId/turnId；无法关联时标记 `unattributed`，不猜会话。
- 新方法通过 initialize capability 协商；旧 Runtime 收到未知方法时界面必须可理解地降级。
- 不修改审批 outcome 和模型/权限配置。

### 4.3 审批生命周期（XA-02）

当前 `RuntimeClient` 在 `queueMicrotask` 中无人响应就取消，Main 却异步保存回调，存在竞态。修复方案：

1. 移除“同 tick 无人回答即取消”。收到请求后生成 Main 侧 `requestId`，同步登记 `respond` 和到期计时器。
2. 广播带 `sessionId`、`hostId`、`workspaceId`、`requestId`、`expiresAt` 的审批；只发给 owner view，不广播给所有会话。
3. `respond` 一次性、幂等；重复点击返回同一结果，不二次写 wire。
4. 超时前可配置提醒；最终超时执行 `cancelled`，并记录 `timed-out` 审计原因，不允许默认 allowed。
5. renderer 崩溃/断开时由 Main 按策略取消，恢复后从 Runtime 状态校准，不恢复过期审批。
6. 单元测试覆盖：同步响应、跨微任务响应、双 view、owner 离开、超时、重复点击、shutdown 竞态、错误响应格式。

### 4.4 事件隔离与 owner/lease（XA-03～XA-06）

推荐通知 envelope：

```ts
interface RoutedNotification {
  hostId: string
  workspaceId: string
  sessionId: string | null
  method: string
  params: unknown
  sequence?: number
}
```

路由规则：

- 通知带 sessionId 时，只发送给持有该 session 有效 lease 的 view；同 session 多 view 各收一份 UI 投影，但 Host/Runtime 只订阅一次。
- 通知不带 sessionId 时：若能由 requestId 唯一映射则补映射；否则放入全局控制通道，不进入任何会话消息流。
- 无人接管时进入有上限的隔离队列，记录原因；超过上限丢弃最旧未投递项并告警，不广播。
- draft 没有 Runtime sessionId，事件不能伪造 session 身份。
- 新 view attach 时按 sequence 补窗口；重复 seq 幂等；乱序进入 gap 恢复流程。
- lease 释放有微任务宽限，避免拖放重挂载反复 resume；关闭/退出时 flush。
- 测试必须证明 A 会话审批、工具结果、终端数据不会出现在 B 会话。

### 4.5 usage 字段冻结（XA-07～XA-09）

真实 fixture 只证明 `assistant/message.data.usage` 存在。X0 必须建立 provider/Runtime 样本表，至少覆盖：

- `assistant/message` 的 usage；
- `turn/end` 是否携带 usage/result.usage；
- query.completed 是否携带聚合 usage；
- 多次模型请求、工具后继续、partial/final、corrected、错误 turn；
- input/cached/reasoning 的实际字段名、数值类型和 null 语义；
- usage 与 requestId/turnId/sessionId/model/provider 的可关联字段。

未取得样本的字段写 `unknown`，不得按其他供应商文档猜映射。X1 只实现已观察字段的 adapter，并保存原始 usage 快照以便重放。

### 4.6 日志与隐私

- Runtime wire 录制默认关闭；启用必须显式参数和用户可见状态。
- 录制前按通道脱敏：authorization、cookie、token、密钥、私钥、完整 URL query、用户消息可选开关；先脱敏再写盘。
- 元数据保留 method、时间、大小、错误码和哈希；不保留敏感正文。
- 日志设置文件权限，定期轮转；fixture 不得包含真实凭据、真实 cookie 或未授权用户数据。
- 现有 JSONL 若已含敏感数据，不自动读取/外传；只报告位置和处置建议，由用户决定清理。

### 4.7 环境和存储探针（X0.7/X0.8）

在 Electron Main 内、发布模式附近执行只读探针，记录：

- `process.versions.electron`、`process.versions.node`、`process.platform`、`process.arch`；
- `screen.getAllDisplays()` 数量、ID、bounds、workArea、scaleFactor；
- `safeStorage.isEncryptionAvailable()`（只返回布尔值，不读取明文）；
- `node:sqlite` import 结果与最小临时库 open/read/write/close；
- `app.getPath('userData')` 可写性与目录权限；
- node-pty 加载状态。

`node:sqlite` 可用才选择 SQLite；不可用时使用同一 `UsageRepository` 接口的 append-only JSONL + compaction。两者共享 schema、幂等和聚合测试，不在 UI 层分叉。

---

## 5. 核心接口与数据契约

### 5.1 WorkbenchLayout

```ts
interface WorkbenchLayout {
  schemaVersion: 1
  workspaceId: string
  main: SplitNode
  floats: FloatWindow[]
  minimized: MinimizedWindow[]
  groups: WindowGroup[]
  focusedWindowId?: string
  revision: number
}

interface SplitNode {
  kind: 'split'
  id: string
  axis: 'row' | 'column'
  children: LayoutNode[]
  sizes: number[]
}

interface PaneNode {
  kind: 'pane'
  id: string
  tabs: WindowTab[]
  activeTabId?: string
}

interface FloatWindow {
  windowId: string
  rect: Rect
  pin: PinLevel
  host: 'internal' | 'native'
  groupId?: string
  zIndex: number
}
```

不变量：

- 每个 windowId 全局唯一；每个 content instance 在 live 布局中只有一个 live owner。
- split sizes 长度等于 children，且严格为正、归一化；最小可见尺寸同时受 DIP 和像素约束。
- 删除最后一个 tab 才允许 pane 折叠；空 pane 在存储树中保留到显式 compact，保证撤销精确。
- 最小化保存 rect、宿主和 group，不销毁正文。
- revision 单调递增；持久化使用 expectedRevision，冲突不静默覆盖。
- 所有 reducer 纯函数；随机 ID 由调用方 mint 后传入，测试可确定性回放。

### 5.2 ConversationWorkspace

```ts
interface ConversationWorkspace {
  owner: ConversationRef
  document: {
    draftId: string
    contentBlocks: ContentBlock[]
    revision: number
    queueLocal: LocalPendingItem[]
  }
  toolLayout: WorkbenchLayout
  toolInstances: ToolInstanceRef[]
  toolset: SessionToolset
  leases: SessionLease[]
  runtimeCapabilities: CapabilitySnapshot
  approvalState: ApprovalSummary[]
}
```

规则：

- session 与 draft 都可打开 view；首次发送成功后才绑定 sessionId，并原子迁移 document/toolLayout/toolInstances。
- 同 session 多 view 共享 businessState，但 composer selection/focus 是 view 状态。
- `runtimeCapabilities` 由 Host 提供；UI 不能自行声明 capability 为 true。
- toolset 只能是 Runtime profile/capability 允许列表的子集；提权需真实 Host 流程。
- 工具跨会话移动时，独占工具显示两个明确选项：“移动并改归属”/“创建新实例”；默认不自动复制。

### 5.3 ToolInstance、Lease 与 Capability

```ts
interface ToolInstanceRef {
  instanceId: string
  toolId: 'files' | 'changes' | 'git' | 'terminal' | 'browser' |
          'computer' | 'ssh' | 'wsl' | 'mcp' | 'skills' | 'agents' |
          'btw' | 'voice' | 'evaluation' | 'time-travel'
  owner: DesktopScope
  concurrency: 'shared-read' | 'exclusive' | 'stateless'
  state: 'opening' | 'ready' | 'busy' | 'disconnected' | 'error' | 'closed'
  leaseId?: string
  metadata?: Record<string, string>
}

interface CapabilitySnapshot {
  runtimeVersion: string
  control: { cancel: boolean; steer: boolean; queue: boolean; draft: boolean }
  tools: Record<string, { available: boolean; reason?: string }>
  observedAt: string
}
```

Files/Changes/Git 默认 shared-read，写操作仍逐请求校验 expectedVersion/权限；Terminal/SSH/WSL/Computer Use 默认 exclusive；浏览器 tab 独立实例但共享 partition 策略；统计类工具 stateless。

### 5.4 浏览器、工件与远程工作区

```ts
interface BrowserTab {
  tabId: string
  browserId: string
  partitionId: string
  url: string
  title: string
  loading: boolean
  canBack: boolean
  canForward: boolean
  historyRevision: number
}

interface BrowserPartition {
  partitionId: string
  workspaceId: string
  persistence: 'persistent' | 'ephemeral'
  storagePath: string
}

interface ElementArtifact {
  artifactId: string
  browserId: string
  tabId: string
  pageUrl: string
  capturedAt: string
  selectorHint?: string
  elementRect: Rect
  viewport: Size
  imagePath: string
  sha256: string
  redacted: boolean
}

interface RemoteLaunchProfile {
  profileId: string
  kind: 'wsl' | 'ssh'
  displayName: string
  host?: string
  port?: number
  distro?: string
  remoteRoot: string
  credentialRef?: string
}
```

`credentialRef` 只引用安全存储中的 ID，不在布局、日志或 IPC 回传中放密钥/私钥/passphrase。远程根目录必须由 Host 校验，禁止路径穿越和把 Windows 路径未经转换传给 WSL。

### 5.5 评测与时间旅行

```ts
interface EvaluationRun {
  runId: string
  workspaceId: string
  suiteId: string
  status: 'queued' | 'running' | 'passed' | 'failed' | 'cancelled' | 'unsupported'
  cases: EvaluationCaseResult[]
  startedAt?: string
  completedAt?: string
  runtimeVersion: string
  model: string
  usageRunId?: string
}

interface SnapshotManifest {
  snapshotId: string
  sessionId: string
  baseEventSequence: number
  workspaceStateHash: string
  runtimeVersion: string
  files: Array<{ path: string; sha256: string; mode?: string }>
  createdAt: string
}

interface RestorePlan {
  snapshotId: string
  targetSessionId?: string
  conflicts: RestoreConflict[]
  irreversible: boolean
  status: 'planned' | 'approved' | 'running' | 'completed' | 'failed' | 'unsupported'
}
```

Time Travel 默认只读。restore 不直接覆盖当前工作区；先生成 plan，列出文件冲突和不可逆项，用户明确批准后在新目标或备份副本执行。fork 只有 Runtime 真实支持时才可用。

### 5.6 UsageEvent 与 UsageReadModel

```ts
interface UsageEvent {
  eventId: string
  schemaVersion: 1
  hostId: string
  workspaceId: string
  sessionId: string
  turnId?: string
  requestId?: string
  model: string
  provider: string
  occurredAt: string
  completedAt?: string
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  reasoningTokens?: number
  inputTokensIncludesCache?: boolean
  context?: {
    usedTokens: number
    windowTokens: number
    source: string
    observedAt: string
  }
  source: 'provider' | 'runtime'
  status: 'partial' | 'final' | 'corrected'
  revision: number
  attribution: 'exact' | 'inferred-from-observed-fields' | 'unattributed'
  rawUsageHash: string
}

interface UsageReadModel {
  coverage: { from: string; to: string; knownEvents: number; unknownEvents: number }
  totals: {
    inputTokens: number | null
    outputTokens: number | null
    cachedInputTokens: number | null
    reasoningTokens: number | null
    cacheHitRate: number | null
  }
  buckets: UsageBucket[]
  currentTurn?: TurnUsageReadModel
  context?: ContextReadModel
}
```

规则：

- `undefined` 表示未知，`0` 只在真实回执为 0 时使用。
- `inputTokensIncludesCache` 未知时不计算缓存命中率。
- reasoning 已包含在 output 时是子集，不与 output 相加。
- context 是 observedAt 的快照，不是累计 token；windowTokens 为 0/未知时不计算比例。
- 时间 UTC 存储，用户时区聚合；默认周起始为周一，设置可改。
- 年/月/周/日切换只改变 bucket key 和粒度，不修改原始事件。
- 首页与顶栏读取同一个 `UsageReadModel`；不从图表反推原始数据。
- `unattributed` 事件进入“未能归属”列表和 coverage，不塞进当前会话。

### 5.7 存储键与迁移

布局键沿用：

```text
dsh.workbench.state.v1
dsh.workbench.state.v1.backup
```

用量、浏览器 partition、远程 profile、评测产物、快照使用独立目录/表，不塞进一个大布局 JSON。迁移过程：

1. 读取并校验 schemaVersion；未知版本不降级写入。
2. 深拷贝后转换，不修改输入。
3. 验证 ID 唯一、引用存在、rect 有限、比例有效、owner 合法。
4. 原子写临时文件→fsync→rename；保留上一版本备份。
5. 迁移结果写入报告；失败保留原文件和隔离的新文件，不自动删除。
6. OMP 布局只在用户明确选择一次性导入时转换；转换后删除旧来源需另行批准。

---

## 6. 窗口系统与交互细则

### 6.1 统一 reducer、不同 adapter

应用内浮窗、吸附分屏和 Electron 系统窗口必须调用同一 layout reducer。宿主差异只体现在 adapter：

| 操作 | main/internal | native | WebContentsView |
|---|---|---|---|
| 移动/缩放 | DOM rect + reducer | `setBounds` DIP | 由 Main attach 并同步 rect |
| 最小化 | 保留 DOM 正文 | `minimize` + ready | detach 但保留 WebContents |
| 聚焦 | zIndex/focus | `focus/show` | attach/focus |
| 关闭 | 释放工具 lease | destroy + 窄端口失效 | detach/close 按策略 |
| 恢复 | 从 state 重建 | bounds + content ticket | partition/tab 恢复 |

系统窗口不挂载 App，不创建 RuntimeClient；通过一次性 ticket 挂载同一内容宿主。主窗口与系统窗口的内容实例 ID 不变，DOM 工具通过同源 document host 移动真实节点。

### 6.2 独立系统窗口安全

沿用并扩展 v2.3 的四个通道：

```text
dsh:workbench-window:prepare
dsh:workbench-window:control
dsh:workbench-window:ready
dsh:workbench-window:changed
```

- 主 preload 暴露 `dshWorkbenchWindows`；子 preload 只暴露 `dshWorkbenchHost.ready(key)` 和必要的受控内容端口。
- 子窗口不得继承完整 `dsh`、terminal、Runtime 或文件 API。
- ticket 一次性、30 秒 TTL，绑定 sender、完整 URL、frameName、windowId、hostId；使用后立即失效。
- `contextIsolation:true`、`nodeIntegration:false`、`sandbox:true`；所有 IPC 校验 `event.senderFrame`。
- 导航只允许产品本地 origin；其他 URL、子框架、弹出窗口一律拒绝或转受控浏览器。
- 子窗口关闭/崩溃/票据过期均释放 registry 项；过期 ticket 重放测试必须失败。

### 6.3 拖放与真实内容预览

- pointerdown 只记录候选，不移动。
- 位移超过 **6px** 才进入 dragging；此前保持 click/focus。
- dragging 开始后创建真实内容克隆/预览宿主，不用灰色占位方块代替正文。
- 预览展示实际落点 rect、split 方向、目标 pane/tab 顺序和归属冲突提示。
- pointermove 只更新 preview，不 commit 布局；pointerup 原子提交 reducer。
- pointercancel、Escape、window blur、宿主失联回滚；不得留下半提交状态。
- 不重建原正文；输入、IME 组合、焦点、selection、scroll、terminal buffer 保持。
- 跨 WebContentsView 边界时，Main 计算真实内容坐标并显示受控预览；release 后 detach/attach，不复制 PTY/cookie。
- 最小命中区域、边缘吸附、嵌套 split、tab 成组、locked pane、独占工具冲突均有独立测试。

### 6.4 键盘与可访问性

- Enter/Space 拿起，方向键移动落点，Shift 加速，Enter 放下，Escape 取消。
- 拖拽控件、窗口、tabs、minimized capsules 均有可聚焦名称和状态播报。
- 焦点恢复按“被移动窗口→原焦点元素→合理 fallback”顺序。
- 支持 reduced motion；动画不能作为状态完成的唯一信号。
- 至少验证键盘-only、屏幕阅读器名称、200% 缩放、高对比度、中文 IME。

### 6.5 分组、Pin 与多显示器

- 成组保存成员和相对布局；拖动一个成员可整组移动，也可按住修饰键只移动当前 tab，行为在 UI 明示。
- 工作台界面缩放与 Windows/Electron DPI 分开：界面缩放只影响 CSS 布局和字号，保存为用户偏好；系统 DPI 由 Electron 处理。缩放变化后 split 最小尺寸、浮窗 rect 和浏览器 view 几何必须重新校验。
- Pin 五档：
  - none：随 owner 布局；
  - workspace：当前工作区保留，其他工作区隐藏；
  - application：跨工作区保留；
  - window：独立系统窗口；
  - topmost：独立系统窗口且显式置顶。
- 使用 Electron DIP；保存 displayId、normalBounds、workArea 快照和 `scaleFactor`，不把物理像素当 DIP。
- 启动恢复时若 displayId 不存在，按交集最大算法选可用显示器；完全不可见时移动到主屏安全区。
- 负坐标显示器、不同 DPI、缩放变化、拔屏、旋转、睡眠唤醒均需真机验证。
- maximized 恢复 normalBounds；minimized 不自动抢占焦点；topmost 不静默改变用户系统设置。

---

## 7. 多会话并行实施细则

### 7.1 会话打开与切换

1. 创建 draftId 或 session view，注册 owner/lease。
2. 若 session 未在当前进程打开，调用真实 `resume` 并读取事件窗口。
3. 恢复草稿、toolLayout 和 toolInstances 元数据；活 PTY 不自动重连未知会话。
4. capability 到达后启用/禁用工具；此前显示 loading/unsupported。
5. 切换 view 不销毁同 session 订阅，不改变其他会话运行状态。
6. 并发 turn 各自有 requestId/turnId；顶栏、审批、工具结果按 ID 投影。

### 7.2 跨区域移动

左侧栏、对话工具区、右栏、底栏、浮窗均接受同一 drop 协议：

```ts
interface DropIntent {
  source: { hostId: string; windowId: string; content: WindowContentRef }
  target: { hostId: string; paneId?: string; tabId?: string; edge?: Edge }
  mode: 'move' | 'split-before' | 'split-after' | 'tab' | 'group'
  pointer: Point
}
```

Main 校验 source 真实性，不相信 renderer 自报位置。提交前检查：

- 目标 host 是否存在且 sender 有权限；
- content 是否 live、是否 locked、是否 exclusive 且已有 owner；
- 跨 workspace 是否需要显式改归属；
- browser tab/partition 是否允许目标工作区；
- 新布局是否通过 schema/引用/几何校验。

失败显示具体原因并保持原布局；不能“先移动再报错”。

### 7.3 并行限制与压力边界

- Runtime 最大并行 turn 数由真实 capability/配置决定，不在前端硬编码为无限。
- 每个 workspace 的最大打开 view 数、隔离队列长度、浏览器 tab 数、PTY 数必须有可配置上限。
- 达到上限时拒绝新实例并说明；不得静默 kill 用户进程。
- CPU/内存热点用纯 bench 和真机记录；不先承诺未实测的毫秒指标。
- 100 次布局重放、重复事件、连续拖放、快速切会话、同时审批是 X7 必测场景。

---

## 8. 工具适配器实施规范

### 8.1 通用工具生命周期

```text
declared -> opening -> ready <-> busy -> disconnected/error -> closed
                  \-> unsupported
```

- `open(instanceId, owner, options)` 返回 capability/初始状态；不负责渲染。
- `attach(instanceId, host)` 绑定 view；`detach` 不默认 close。
- `invoke(instanceId, requestId, args)` 校验 owner 和 capability，返回 requestId。
- `cancel(requestId)` 只能取消可取消操作；结果标注 cancelled，不伪造成功。
- `close(instanceId, reason)` 幂等释放 PTY/view/lease/临时文件。
- 恢复时 `attach` 活实例；registry 中无进程则 disconnected，不自动 spawn。

### 8.2 Files / Changes / Git / Worktree / 提交图

**Files**

- Host 提供 list/read/stat/write/create/rename/delete/export；所有路径解析到 workspace root 后校验真实路径。
- 写使用 `expectedVersion`（mtime+size 不足时使用内容哈希）；冲突返回当前版本和 diff，不覆盖。
- 大文件不读入 renderer；二进制返回元数据和受控预览/下载。
- 保存采用临时文件 + 原子 rename；权限、符号链接、大小上限、编码和错误信息明确。
- 原生 UI 实现编辑；只参考 OMP 的冲突交互，不 import 其 client。

**Changes/Git**

- 复用 Host 的 `gitChanges/gitDiff/gitStage/gitCommit`，补 bridge/preload 端口和 sender/root 校验。
- commit 默认禁止 `noVerify`；amend、hook 绕过、强制操作需单独明确授权。
- dirty worktree、冲突、detached HEAD、submodule、LFS、rename、staged/unstaged 均需 fixture 或临时 Git 仓库测试。
- Worktree 未接真实服务前不显示固定空列表；返回 unsupported/stale 原因。
- 提交图从真实 Git 数据构建；分页/截断要标注“仅显示 N 个提交”，不冒充完整历史。

### 8.3 Terminal / SSH / WSL2

- 以 `instanceId` 取代 webContents.id；每个实例记录 owner、host、profile、cwd、cols/rows、pid、状态和 buffer 上限。
- output 按 instanceId + owner 路由；resize 只作用于活实例。
- 关闭窗口、owner 释放、应用退出三路径都 kill/close；测试断言 registry 和 OS 进程数归零。
- 恢复只恢复 profile/cwd/尺寸和 scrollback 元数据；未知 PTY 显示 disconnected，不自动执行历史命令。
- WSL launch profile 显式指定 distro/user/remote cwd；Windows 路径按真实 `wslpath` 规则转换，不写死 `/mnt/f` 适用于所有盘。
- SSH 在驱动、主机密钥校验、凭据存储和用户明确配置前保持 unsupported。凭据通过安全存储 ID 引用，禁止日志回显。

### 8.4 托管浏览器

- Main 管理多个 `WebContentsView`；tab 是独立实例，不是每次重载单例 view。
- 所有 view 使用 `contextIsolation:true`、`nodeIntegration:false`、`sandbox:true`，不使用可访问 Node 的 `<webview>` 作为业务载体；页面脚本只能经受控 preload/消息端口请求有限能力。
- 默认仅允许 `http:`/`https:` 和产品内部页面；拒绝 `file:`、`javascript:`、`data:`、自定义危险 scheme。
- 每次 navigation、redirect、window.open、download 都校验；OAuth 弹窗进入同一受控 partition，不跳转当前业务 tab。
- partition 按 workspace + profile 隔离；persistent 与 ephemeral 明确区分；不跨工作区共享 cookie。
- 下载默认进入用户选择的 artifacts 目录，显示文件名、大小、状态；不自动执行。
- DevTools 使用独立受控视图/窗口，不向页面暴露 Node 权限；生产构建按用户操作打开。
- 元素拾取使用受控 selector overlay/脚本，不开放 renderer 任意 `executeJavaScript`。
- 截图流程：验证 tab→读取 viewport/scroll→定位元素 rect→`capturePage`→裁剪→写 artifact→哈希→生成引用。失败不生成假图。
- 引用包含 artifactId、URL、capturedAt、selectorHint、尺寸、hash；消息只引用 artifact，不把 cookie/页面敏感数据写入会话日志。
- 页面崩溃、导航取消、下载失败、partition 不可用、权限拒绝均有可恢复错误态。

### 8.5 Computer Use

- 先定义 `ComputerAdapter`：`capabilities()`、`capture()`、`act()`、`cancel()`、`close()`。
- 每次 act 带 requestId、目标显示器、动作、参数、用户确认级别和结果回执。
- 默认禁用到系统设置、凭据、支付等高风险区域的自动输入；具体边界需安全评审。
- 无真实 OS 驱动时返回 unsupported。截图样例只能标测试 fixture，不能当作执行结果。
- X0 必须决定驱动路线和权限模型；本文不预设某外部 provider，也不申请无关授权。

### 8.6 MCP / Skills

- 读取真实配置/capability；配置树存在不等于某会话可执行。
- 会话 toolset 只能从允许列表选择；变更生成审计事件。
- 调用经 Runtime/Host，带 requestId、server/skill ID、参数摘要和结果状态；敏感参数不进入普通日志。
- 连接失败显示 stale/last-good 和原因，不清空后假装没有配置。
- Skills 展示版本/来源/启用状态；不执行未经用户选择的脚本。

### 8.7 Agent Hub 星图

- 节点来自 Runtime subagent 通知和会话关系，不按文案猜父子关系。
- `parentAgentId`、`agentId`、`sessionId`、`startedAt`、`finishedAt`、`status` 可验证才连边。
- 多个根、嵌套派生、失败、重启后恢复用 fixture 覆盖。
- 缺关系时显示未归属节点；不用装饰性假连线补齐。

### 8.8 BTW

- 必须是独立请求/上下文，不把旁路内容自动插入主对话历史。
- 若 Runtime 不支持隔离上下文，标记 unsupported；不能仅开一个浮窗就宣称 BTW。
- 显示目标范围、模型、费用/usage 和“不进入主对话”说明；用户明确选择后才能引用结果到主会话。

### 8.9 语音输入

- 状态：idle→requesting-permission→recording→transcribing→ready/error/cancelled。
- 只在用户点击录音后申请麦克风；取消立即停止并释放设备。
- 转写进入可编辑草稿，不自动发送；可查看和删除音频工件。
- provider、语言、隐私/上传提示、密钥存储和费用需用户确认；未接 ASR 时 unsupported。

### 8.10 评测工作区

- 定义 suite/cases、模型、Runtime 版本、workspace、预算、隔离目录和并发上限。
- 每个 case 有输入、期望断言、实际输出、工具事件、usage、耗时和终态。
- 不在用户主工作区自动运行破坏性 case；使用临时副本/容器/一次性 worktree。
- 支持取消和部分失败；汇总通过率同时显示未运行/error，不把 skipped 当 passed。
- 历史脚本成果只能作为迁移参考；新界面必须通过真实 EvaluationRun 服务。

### 8.11 Time Travel

- 第一层：按事件 sequence 浏览消息、工具、审批、usage 和状态变化。
- 第二层：SnapshotManifest 记录 session 事件位置、workspace hash、runtime/model 版本和文件清单。
- 第三层：RestorePlan 先分析冲突，用户批准后执行；不直接覆盖。
- fork/restore 无真实协议时保持 unsupported；不得通过“复制 JSONL + 改 sessionId”伪造可恢复会话。

---

## 9. 用量摄入、聚合与界面

### 9.1 摄入链路

```text
provider/runtime 原始 usage
  -> UsageAdapter（按已观察字段映射）
  -> UsageLedger.ingest（eventId + revision 幂等）
  -> 持久化（SQLite 或 JSONL）
  -> UsageAggregator（UTC→用户时区）
  -> UsageReadModel
  -> HomePage / ConversationHeader
```

禁止从 projection 的单个 `view.usage` 直接画图，也禁止在首页先画 mock 折线再等后端。

### 9.2 幂等与修正

- 优先使用真实 eventId；缺失时以已观察的 `(hostId, sessionId, requestId, messageId, turnId, usageHash)` 生成稳定 ID，并标 attribution。
- `revision` 严格递增；同 eventId 低/同 revision 重复摄入不改变结果；高 revision 替换旧值。
- partial 不覆盖 final；final 不覆盖 corrected；乱序 revision 进入待校正队列，最终聚合只取每事件最高有效 revision。
- 同一 usage 从 Runtime 和 provider 双通道出现时，以来源优先级和字段匹配去重；无法确定则保留两条并标 possible-duplicate，不重复计入总额。
- 损坏记录写入 `usage-corruption` 报告，保留行号/哈希，不静默跳过。
- 重放 fixture 必须得到与在线摄入相同的 totals/buckets/coverage。

### 9.3 指标定义

| 指标 | 定义 |
|---|---|
| 输入/输出 token | 仅真实回执数值；未知为 null |
| 缓存输入 | 仅真实 cachedInputTokens；不估算 |
| 缓存命中率 | includesCache=true：cached/input；false：cached/(input+cached)；includesCache 未知：null |
| reasoning | 展示真实值；若为 output 子集，只标注，不与 output 相加 |
| 上下文占用 | context.usedTokens/context.windowTokens；缺一即 null |
| 本轮 | 当前 turnId 下所有已归属请求的有效 revision 汇总 |
| coverage | 时间范围内 known/unknown/unattributed/possible-duplicate 数量与来源 |

### 9.4 首页

- Token 折线图按日/周/月/年聚合；input/output 可分别查看，unknown 不画成 0。
- 热力图以用户时区日期为格；周起始默认周一；未来日期不显示。
- 顶部显示统计范围、时区、数据覆盖和最后更新时间。
- 无数据显示空态；部分显示“数据不完整”；读取失败显示错误与重试。
- 点击 bucket 下钻到下一级/会话列表；切换粒度不丢筛选。
- 大年份/大量事件分桶聚合，避免 renderer 绘制数十万点；性能测试记录实际耗时。

### 9.5 对话顶栏

顶栏常驻简短读数，展开显示：

- 当前 turn 的 input/output/cached/reasoning；
- 缓存命中率及计算口径；
- context used/window、来源、observedAt；
- 请求数、partial/final/corrected 状态；
- unknown/unattributed 提示；
- 数据延迟与刷新按钮。

顶栏不展示“0 token”来掩盖未知；长数字使用本地化格式并保留精确 title/tooltip。

### 9.6 存储、compaction 与恢复

- SQLite：事件表主键 eventId，索引 `(workspaceId, sessionId, occurredAt)` 和 `(eventId, revision)`；事务写入。
- JSONL：每行一个事件，追加后 fsync；compaction 在快照 revision 后写新文件、校验、原子替换。
- 每日备份或可配置策略；备份带 schemaVersion、事件数和 hash。
- 启动校验：文件头/行 JSON、schema、数值非负、时间可解析、revision 单调；错误隔离，不阻止基础会话使用。
- 恢复测试覆盖写一半、断电式截断、重复行、逆序 revision、错误 schema、磁盘满、备份损坏。
- 备份/迁移/compaction 均不得删除原始事件，除非用户明确批准保留策略。

---

## 10. 文件级改动清单

> 下表是**计划修改点**。`新增`表示批准实施后创建，不表示当前已存在。

| 路径 | 动作 | 职责/主要任务 |
|---|---|---|
| `packages/workbench-core/package.json` | 新增 | 纯 TS 包，零运行时重依赖 |
| `packages/workbench-core/src/{ids,layout,windows,conversation,tools,capabilities}.ts` | 新增 | 身份、布局 reducer、窗口/分组、文档与工具不变量；X2 |
| `packages/workbench-core/src/usage/{event,ledger,aggregate,repository}.ts` | 新增 | 用量 schema、幂等、聚合和存储接口；X1/X2 |
| `packages/workbench-core/src/storage/{schema,migrate,validate}.ts` | 新增 | 布局/用量 schema、迁移和损坏恢复；X2 |
| `packages/workbench-core/test/*.test.mjs` | 新增 | 确定性 reducer、租约、usage 回放；X2 |
| `packages/workbench-ui/package.json` | 新增 | React 展示包 |
| `packages/workbench-ui/src/{WindowHost,DragLayer,TabStrip,Sidebar,BottomDock,UsageViews}` | 新增 | 受控工作台组件；X3/X4/X6 |
| `packages/contract/src/{workbench,usage,control,browser,tools}.js` | 新增/修改 | IPC DTO、错误码、wire 常量；X1 |
| `packages/contract/src/projection.js` | 修改 | 关联 turn/request/usage；不改变既有消息语义 |
| Runtime 源码/构建仓库（X0 定位） | 条件修改 | 仅在单独批准后实现 additive 服务端方法、capability 和协议测试；未批准时不动 |
| `packages/runtime-client/src/index.js` | 修改 | 审批生命周期、请求幂等、additive 方法、日志脱敏；X0/X1 |
| `packages/runtime-client/src/recording.js` | 新增 | 脱敏 wire 录制与轮转 |
| `packages/host-services/src/index.js` | 修改 | 修正 usage 字段、损坏行报告、文件/Git 能力；X0/X5 |
| `packages/host-services/src/{paths,git,remote,browser-artifacts}.js` | 新增 | 路径安全、Git 工作区、远程 profile、截图工件；X5 |
| `apps/desktop/src/main.js` | 修改并拆分 | 保留进程编排，移除大块内联业务；X0/X3 |
| `apps/desktop/src/services/window-service.js` | 新增 | internal/native 窗口、ticket、几何、多屏；X3 |
| `apps/desktop/src/services/browser-service.js` | 新增 | tab/view/partition/DevTools/下载/截图；X5 |
| `apps/desktop/src/services/terminal-service.js` | 新增 | 多 PTY、owner、关闭与恢复；X0/X5 |
| `apps/desktop/src/services/security-service.js` | 新增 | sender/origin/path/workspace/ticket 校验 |
| `apps/desktop/src/services/usage-service.js` | 新增 | Ledger 持久化和 read model；X1/X6 |
| `apps/desktop/src/preload.cjs` | 修改 | 暴露窄 IPC 端口；X1/X3/X5 |
| `apps/desktop/src/workbench-preload.cjs` | 新增 | 子窗口窄 ready/control 端口；X3 |
| `apps/desktop/src/workbench.html` | 新增 | 同源内容宿主，不挂 App；X3 |
| `apps/renderer/src/App.jsx` | 修改 | 保留回退入口，按开关加载新组合层；X8 |
| `apps/renderer/src/workbench/*` | 新增 | 状态组合、端口、页面和工具面板；X3～X6 |
| `apps/renderer/src/styles/workbench.css` | 新增 | 四源 clean-room 视觉 tokens；X3 |
| `packages/studio-ui/src/**` | 后续修改 | 仅改为消费共享 core/UI；不移植 OMP 客户端 |
| `packages/testkit/fixtures/{control,approval,events,usage,browser,tools}/*.jsonl` | 新增 | 脱敏协议/投影/回放 fixture；X0/X1/X2 |
| `packages/testkit/src/*.test.mjs` | 新增 | 路由、幂等、迁移、协议假 Runtime 测试 |
| `packages/testkit/scripts/check-architecture.mjs` | 修改 | 覆盖新包依赖边界；X0/X7 |
| `packages/testkit/scripts/check-entrypoint-alignment.mjs` | 修改 | 校验新入口和回退开关语义；X7 |
| `package.json` / `package-lock.json` | 条件修改 | 只有批准依赖/存储路线后才改；不在本文授权内安装 |
| `DSH-WORKBENCH-DESKTOP-PRODUCT-IMPLEMENTATION-PLAN.md` | 本文 | 批准后随真实结果更新，不静默改验收口径 |

---

## 11. WBS、依赖与并行规则

### 11.1 阶段总览

| 阶段 | 目标 | 依赖 | 退出门 |
|---|---|---|---|
| X0 基线与前置审计 | 把未知能力、安全和脏工作树变成可执行事实 | 无 | XG0 |
| X1 控制/事件/用量协议 | 建真实、隔离、幂等的控制面与数据面 | X0 | XG1 |
| X2 纯核心 | 可回放的布局、窗口、租约、账本 | X0；usage 依赖 X1.6～X1.8 | XG2 |
| X3 原生窗口与拖放 | 同一窗口系统、6px 真实预览、多屏 | X2.1～X2.11 | XG3 |
| X4 多会话组合 | 并行会话与工具自由迁移 | X1、X2、X3 | XG4 |
| X5 工具适配器 | 逐工具接真实能力 | X0、X3；浏览器依赖 X3.7～X3.9 | XG5 |
| X6 用量产品化 | 首页与顶栏共用 read model | X1.6～X1.8、X2.12、X4.1 | XG6 |
| X7 全量验证 | 单元、协议、安全、真机、压力、恢复 | X3～X6 | XG7 |
| X8 灰度与退出 | 显式启用、备份、回滚、旧桥退出 | X7 | XG8 |

### 11.2 详细 WBS

| WBS | 任务 | 文件/产物 | 依赖 | 验收 |
|---|---|---|---|---|
| X0.1 | 冻结工作树、HEAD、文件哈希、现有测试基线 | `baseline-*.json`、失败测试清单 | — | XA-01 |
| X0.2 | 盘点真实 Runtime 控制/事件/usage/fork 能力 | 协议事实表、脱敏样本 | X0.1 | XA-01 |
| X0.3 | 修复审批微任务取消竞态，定义超时/取消审计 | runtime-client、main、fixture | X0.1 | XA-02 |
| X0.4 | 移除无人接管广播，建立 owner/lease 路由和隔离队列 | studio-bridge、事件路由模块 | X0.2 | XA-03、XA-04 |
| X0.5 | 核对 usage 真实字段，修正 host 错位读取 | host-services、projection、fixture | X0.2 | XA-07 |
| X0.6 | 统一 PTY 资源账本，补 OMP/native 关窗清理 | main、terminal-service 前置 | X0.1 | XA-10 |
| X0.7 | Electron Node/sqlite/safeStorage 只读探针 | 探针脚本、环境报告 | X0.1 | XA-09 |
| X0.8 | 多显示器/DIP 能力与恢复策略探针 | 显示矩阵、几何 fixture | X0.7 | XC-07 |
| X0.9 | 浏览器威胁模型、partition、导航/下载白名单 | 安全设计、拒绝用例 | X0.1 | XA-11、XA-13 |
| X0.10 | Computer/ASR/SSH/fork 外部能力门与降级契约 | capability 矩阵、unsupported 文案 | X0.2 | XA-14、XD-17 |
| X0.11 | 修正/登记既有失败测试和架构检查缺口 | 基线报告、check 脚本设计 | X0.1 | XA-01、XF-01 |
| X1.1 | 定义 additive 控制 envelope、错误码、capability 协商 | contract、协议文档 | X0.2、X0.3 | XA-05 |
| X1.2 | 实现真实 cancel/steer；不支持时返回 unsupported | RuntimeClient、经批准的 Runtime 服务端、假 Runtime | X1.1 | XA-05 |
| X1.3 | 实现 Runtime queue 幂等、position、cancel/sent 语义 | RuntimeClient、经批准的 Runtime 服务端、fixture | X1.1 | XA-05 |
| X1.4 | 实现 draft revision 与本地未提交状态 | core、经批准的 Runtime 服务端、端口、UI 契约 | X1.1 | XA-06 |
| X1.5 | 实现 session 事件 envelope、sequence gap、owner 路由 | Main、event router、testkit | X0.4、X1.1 | XA-03、XA-04 |
| X1.6 | 实现 UsageAdapter，保留 rawUsageHash/attribution | contract、host/runtime adapter | X0.5 | XA-07、XE-01 |
| X1.7 | 实现 UsageLedger 幂等、revision、去重、损坏报告 | core、fixture | X1.6 | XA-08、XE-02、XE-03 |
| X1.8 | 选定 SQLite 或 JSONL，实现 repository/compaction/备份 | Main、core repository | X0.7、X1.7 | XA-09、XE-04 |
| X1.9 | 实现 wire 脱敏录制、默认关闭和轮转 | runtime-client、testkit | X0.2 | XA-12 |
| X2.1 | 定义 ID、Rect、Split/Pane、WindowRef 与 schema | workbench-core | X0.1 | XB-01 |
| X2.2 | 实现纯布局 reducer：tab、split、float、minimize、group | workbench-core | X2.1 | XB-02、XB-03 |
| X2.3 | 实现 normalize/compact/undo/redo 不变量 | workbench-core | X2.2 | XB-04 |
| X2.4 | 实现 Pin 五档与 workspace/application 恢复规则 | workbench-core | X2.2 | XB-05 |
| X2.5 | 实现 6px 拖放状态机和 drop 意图解析 | workbench-core | X2.2 | XB-06 |
| X2.6 | 实现键盘拖放、cancel/blur 回滚、locked 语义 | workbench-core | X2.5 | XB-07 |
| X2.7 | 实现 DOM 正文保留/attach 状态契约 | core + UI 端口 | X2.5 | XB-08 |
| X2.8 | 实现跨宿主 drop 校验与 exclusive owner 冲突 | workbench-core | X2.5 | XB-09 |
| X2.9 | 实现 schema 校验、原子持久化、迁移和备份 | core storage | X2.1、X2.4 | XB-10 |
| X2.10 | 实现多屏几何 clamp/intersection/restore | workbench-core | X0.8、X2.1 | XB-11、XC-07 |
| X2.11 | 实现 ConversationWorkspace、ToolInstance、Lease 纯模型 | workbench-core | X1.4、X1.5、X2.1 | XB-12、XC-13 |
| X2.12 | 实现 UsageAggregator/ReadModel/时区/粒度 | workbench-core | X1.7 | XE-05～XE-08 |
| X3.1 | 建立 workbench-ui 和 renderer 组合层、回退入口 | renderer/workbench-ui | X2.1、X2.2 | XB-01 |
| X3.2 | 实现 Pane/Tab/Sidebar/Right/Bottom 统一拖放宿主 | workbench-ui | X2.2、X2.5 | XB-03、XB-06 |
| X3.3 | 实现真实正文预览、IME/focus/scroll 保持 | workbench-ui | X2.7、X3.2 | XB-08、XB-13 |
| X3.4 | 实现内部浮窗、z-order、snap、minimize | UI + Main 端口 | X3.2 | XB-03、XB-14、XC-03 |
| X3.5 | 实现分组拖动、locked、Pin 控件 | UI + core | X2.4、X2.6 | XB-05、XB-07 |
| X3.6 | 接入布局原子保存、恢复、冲突与撤销 | UI + storage | X2.9、X3.2 | XB-10、XB-15 |
| X3.7 | 实现 native BrowserWindow + 窄 preload + 内容宿主 | Desktop 服务 | X2.1、X3.1 | XC-01、XC-07 |
| X3.8 | 实现一次性 ticket、sender/frame/origin 校验 | security/window service | X3.7 | XA-13、XC-08 |
| X3.9 | 实现 WebContentsView detach/attach 与几何同步 | Main + UI preview | X3.7、X2.10 | XC-02、XC-09 |
| X3.10 | 实现 native minimize/maximize/close/display restore | window service | X3.7～X3.9 | XC-07、XC-10～XC-12 |
| X3.11 | 接入四源 clean-room 视觉 tokens 和可访问性 | workbench-ui/styles | X3.2 | XB-16、XF-04 |
| X4.1 | 实现 SessionView 组合、草稿/审批/usage 按 owner 投影 | renderer/workbench | X1.3～X1.5、X2.11 | XC-04、XC-13、XC-14 |
| X4.2 | 实现侧栏/工具区/右栏/底栏/浮窗跨区拖放 | UI + Main drop | X3.2、X3.9、X2.8 | XC-06、XC-15、XB-09 |
| X4.3 | 实现 toolset capability 门和 per-session 实例注册 | renderer + Main | X0.10、X2.11 | XC-16、XD-15、XD-17 |
| X4.4 | 实现跨会话独占工具“移动/新建”确认 | UI + reducer | X2.8、X4.3 | XC-17 |
| X4.5 | 实现多 turn 并行、审批归属、断线重连 | Runtime port + UI | X1.2、X1.5、X4.1 | XC-05、XC-14、XA-04 |
| X4.6 | 实现 view/实例上限、隔离队列和过载状态 | Main + core + UI | X4.3、X4.5 | XC-18 |
| X5.1 | Files 原生只读→编辑/版本冲突/原子保存 | host-services、Files UI | X3.1、X0.1 | XD-01 |
| X5.2 | Changes 原生列表/diff/stage 和错误态 | Host、preload、UI | X5.1 | XD-02 |
| X5.3 | Git commit/worktree/提交图真实服务与分页 | Host、Git UI | X5.2、X0.10 | XD-03～XD-05 |
| X5.4 | Terminal 多实例、owner 路由、关闭清理 | terminal-service、UI | X0.6、X3.7 | XD-06、XA-10 |
| X5.5 | WSL profile 与 SSH adapter（SSH 未验证则 unsupported） | Host、preload、UI | X0.10、X5.4 | XD-07、XD-08 |
| X5.6 | Browser 多 tab/view/partition/导航/下载 | browser-service、UI | X0.9、X3.9 | XD-09、XD-10 |
| X5.7 | DevTools、元素拾取、capture/crop/artifact 引用 | browser-service、Host | X5.6 | XD-11～XD-13 |
| X5.8 | ComputerAdapter 与真实驱动接入门 | Desktop 服务、UI | X0.10、X4.3 | XD-14 |
| X5.9 | MCP/Skills 真实清单、会话覆盖、审计 | Runtime/Host、UI | X4.3 | XD-15 |
| X5.10 | Agent Hub 节点/边事实模型与星图 | 事件 adapter、UI | X1.5、X4.3 | XD-16 |
| X5.11 | BTW 独立上下文或 unsupported | Runtime adapter、UI | X0.10、X4.3 | XD-18 |
| X5.12 | 语音权限/录音/ASR/可编辑草稿或 unsupported | Desktop 服务、UI | X0.10、X4.3 | XD-19 |
| X5.13 | EvaluationRun/Case 工作区、取消、隔离执行 | Host/Runtime、UI | X4.3、X0.10 | XD-20 |
| X5.14 | Time Travel 只读时间线、Snapshot/Restore 门 | Host/Runtime、UI | X1.5、X0.10 | XD-21 |
| X6.1 | 首页统计页、范围/时区/coverage | renderer | X2.12、X4.1 | XE-01、XE-05 |
| X6.2 | Token 折线图四粒度与下钻 | UI + SVG 自绘 | X6.1 | XE-06、XE-07 |
| X6.3 | 热力图、空态/部分/错误/未知 | UI | X6.1 | XE-08、XE-10 |
| X6.4 | 聚合性能、分桶和大量数据测试 | core/UI bench | X6.2、X6.3 | XE-11、XF-05 |
| X6.5 | 顶栏本轮/缓存/context 展开面板 | UI | X1.6、X2.12 | XE-09、XE-12 |
| X6.6 | usage 持久化损坏/修正/重放端到端验证 | testkit、Main | X1.8、X6.1 | XE-02～XE-04 |
| X7.1 | 全量单元/投影/协议回放和架构检查 | testkit、CI 命令 | X3～X6 | XF-01、XF-02 |
| X7.2 | 鼠标/键盘/IME/焦点/滚动/取消交互回归 | 测试、录屏 | X3.3、X4.2 | XF-03 |
| X7.3 | IPC 安全、恶意 sender/origin/path/ticket 测试 | testkit/security | X3.8、X5.6 | XA-11～XA-13 |
| X7.4 | 浏览器登录隔离/下载/DevTools/截图真机验证 | 真机记录 | X5.6、X5.7 | XD-09～XD-13 |
| X7.5 | 双屏/DPI/负坐标/拔屏/睡眠恢复验证 | 真机记录 | X3.10 | XC-07～XC-12 |
| X7.6 | 多会话压力、重复事件、断线、PTY 泄漏验证 | testkit、真机 | X4.6、X5.4 | XC-18、XA-10 |
| X7.7 | 可访问性、200% 缩放、高对比度、视觉走查 | 测试、截图 | X3.11、X6.5 | XB-16、XF-04 |
| X7.8 | 备份/迁移/损坏/磁盘满/断电恢复演练 | testkit、恢复报告 | X2.9、X1.8 | XF-06 |
| X8.1 | 新入口显式开关、默认保留旧入口、功能标记 | App、配置 | X7.1～X7.8 | XF-07 |
| X8.2 | 灰度启用、监控、用户数据备份与回滚包 | 发布脚本、报告 | X8.1 | XF-08、XF-09 |
| X8.3 | OMP 桥依赖盘点与退出计划（不自动删除） | 退出清单 | X8.2 | XF-10 |
| X8.4 | 最终需求/验收/证据核对与交付 | 追踪矩阵 | X7、X8.1 | XF-11、XF-12 |

### 11.3 可并行与必须串行

**可并行**：X0 各调查任务在只读范围可并行；X2 纯核心在 X0 完成后可并行开发；X5 各工具在窗口宿主稳定后可分组并行；X6 图表可在 UsageReadModel fixture 稳定后开发；文档与 fixture 可同步更新。

**必须串行**：

- X0.2 协议事实表先于 X1 新方法；不得边猜边写。
- X0.3 审批竞态先于 X4 多会话启用。
- X1.6～X1.8 数据链路先于 X6 图表；不得倒序。
- X3.7～X3.9 系统窗口票据/attach 先于 X5 浏览器跨宿主。
- X0.7 存储探针先于 X1.8 选择 SQLite。
- X7 安全与恢复通过后才允许 X8 灰度。

---

## 12. 验收标准与证据要求

### 12.1 安全与协议（XA）

| ID | 验收标准 | 证据 |
|---|---|---|
| XA-01 | 基线包含 HEAD、脏文件、测试结果、能力未知项；未修改 Runtime 上游 | 基线报告 + diff |
| XA-02 | 审批在跨微任务/异步 IPC 后仍可响应；超时只取消；重复响应不二次写 wire | 协议测试 + wire fixture |
| XA-03 | 带 sessionId 事件只到 owner；同 session 多 view 共享单订阅 | 路由计数测试 |
| XA-04 | 无 owner 事件不广播；A/B 会话消息、审批、工具结果零串线 | 双会话 fixture |
| XA-05 | cancel/steer/queue 真调用或明确 unsupported；requestId 重放幂等 | 假 Runtime 测试 |
| XA-06 | 草稿 revision 冲突不覆盖；本地待发不显示为 Runtime 已排队 | UI/状态测试 |
| XA-07 | usage 按真实字段位置摄入；turn/end 无 usage 时不误读 | 多来源 fixture |
| XA-08 | 重复/乱序/修正 usage 不重复累计；损坏记录可见 | Ledger 回放报告 |
| XA-09 | Electron Main 实测 Node/sqlite；存储路线与报告一致；截断/磁盘满可恢复 | 环境探针 + 恢复测试 |
| XA-10 | 关闭所有窗口/退出后 PTY registry 和 OS 进程归零；不误杀其他应用 | 进程计数日志 |
| XA-11 | 非 http/https、危险 scheme、越权导航、弹窗、下载默认路径均被拒绝或受控 | 安全用例 |
| XA-12 | wire 录制默认关闭；开启后敏感字段不落盘；轮转有效 | 脱敏样本 |
| XA-13 | 伪造 sender/frame/origin、重放/过期 ticket、跨窗口控制均被拒 | IPC 安全测试 |
| XA-14 | Computer/ASR/SSH/fork 未接入时明确 unsupported，不读凭据、不产生费用 | capability/调用审计 |

### 12.2 核心与布局（XB）

| ID | 验收标准 | 证据 |
|---|---|---|
| XB-01 | 同一 fixture 回放得到相同 ID/布局；core 无 React/DOM/Electron/Runtime 依赖 | 确定性测试 + 架构检查 |
| XB-02 | tab/split/float/minimize/group reducer 纯函数且不修改输入 | 单元测试 |
| XB-03 | 所有内容区接受同一 drop 协议；提交后无重复/丢失 window | 属性测试 |
| XB-04 | sizes 合法、compact 幂等、撤销精确、无 0 尺寸 | 单元/属性测试 |
| XB-05 | 五档 Pin 在工作区/应用/窗口切换中行为正确 | 场景测试 |
| XB-06 | ≤6px 不拖动；>6px 显示真实正文落点；pointerup 才提交 | 鼠标回归 |
| XB-07 | Escape/cancel/blur 完整回滚；键盘可完成拖放；locked 不可移动 | 键盘/交互测试 |
| XB-08 | 拖动不重建正文；输入、IME、焦点、选区、滚动保持 | DOM/终端现场测试 |
| XB-09 | exclusive 工具跨宿主不复制；owner 冲突有明确选择 | reducer/UI 测试 |
| XB-10 | 迁移、原子保存、revision 冲突、备份恢复不丢布局 | 存储测试 |
| XB-11 | 非法/负数/巨大/NaN rect 被拒绝或安全 clamp | 几何 fixture |
| XB-12 | session/draft 切换、工具归属和 lease 不变量成立 | 状态测试 |
| XB-13 | 跨 WebContentsView 拖动预览与最终 rect 一致 | 真机录屏 |
| XB-14 | 最小化保留正文，恢复不重复 spawn/订阅 | 生命周期测试 |
| XB-15 | 杀进程后布局恢复到最近成功 revision，不出现半写 | 崩溃恢复测试 |
| XB-16 | 工作台界面缩放、200% 系统缩放、高对比度、键盘焦点、reduced motion 可用 | 可访问性走查 |

### 12.3 窗口与多会话（XC）

| ID | 验收标准 | 证据 |
|---|---|---|
| XC-01 | internal/native 窗口共用 reducer，关闭/恢复行为一致 | 状态对照测试 |
| XC-02 | WebContentsView 跨宿主 attach/detach 后页面状态保持 | 真机录屏 |
| XC-03 | 浮窗吸附分屏、成组移动、最小化均不丢内容 | 交互回归 |
| XC-04 | 同 session 多 view 共用业务状态，不重复发送/订阅 | 事件计数 |
| XC-05 | 多 session 同时运行，顶栏/审批/工具结果按 ID 归属 | 双会话录屏 |
| XC-06 | 侧栏/工具区/右栏/底栏/浮窗双向自由拖放 | 全路径清单 |
| XC-07 | 双屏、负坐标、不同 DPI、拔屏、旋转后窗口可见且不重叠到不可达 | 真机记录 |
| XC-08 | native 子窗口无完整 `dsh`/Node/terminal/Runtime API | 端口枚举测试 |
| XC-09 | 拖动中 view 几何不抖动；release 后最终位置与预览一致 | 录屏 + 坐标日志 |
| XC-10 | 独立任务栏入口可聚焦、关闭和恢复 | Windows 真机 |
| XC-11 | maximized/minimized/topmost 重启恢复符合用户设置 | 真机记录 |
| XC-12 | 单屏→双屏、双屏→单屏、DPI 变化不丢窗口 | 真机记录 |
| XC-13 | 每场会话独立草稿、审批、工具实例和布局 | 状态快照 |
| XC-14 | 断线重连后事件按 sequence 补齐，不重复消息 | 网络/进程测试 |
| XC-15 | 跨区移动 >6px 的真实预览在所有路径出现 | 路径回归 |
| XC-16 | toolset 只能是 capability 子集；UI 伪造 true 被 Main 拒绝 | 安全测试 |
| XC-17 | 跨会话独占工具必须选择移动或新建，默认不复制 | UI 测试 |
| XC-18 | 达到 view/PTY/tab/队列上限有明确拒绝，不静默杀进程 | 压力测试 |

### 12.4 工具（XD）

| ID | 验收标准 | 证据 |
|---|---|---|
| XD-01 | Files 编辑、版本冲突、原子保存、路径穿越拒绝可用 | 临时仓库测试 |
| XD-02 | Changes staged/unstaged/rename/conflict 与真实 Git 一致 | Git fixture |
| XD-03 | commit 默认不绕过 hook；noVerify/amend 需明确授权 | 安全测试 |
| XD-04 | Worktree 真实列表或明确 unsupported；不返回固定空值 | 服务测试 |
| XD-05 | 提交图与 Git 日志一致；分页/截断有标注 | 数据对照 |
| XD-06 | 多 Terminal 独立输出/尺寸/关闭，不串 PTY | 真机测试 |
| XD-07 | WSL profile 的 distro/user/cwd 真实生效 | 命令回执 |
| XD-08 | SSH 真实连接+主机密钥校验，或明确 unsupported | 连接报告 |
| XD-09 | 多 tab 独立 URL/历史/加载状态，页面不重复创建 | 浏览器测试 |
| XD-10 | partition 登录持久且跨 workspace 隔离；ephemeral 可清除 | cookie 隔离测试 |
| XD-11 | DevTools 可用且不暴露 Node；关闭后资源释放 | 真机测试 |
| XD-12 | 元素截图尺寸/区域/URL/hash 正确，不截错 tab | artifact 对照 |
| XD-13 | 消息引用 artifact 可追踪；危险导航/下载/弹窗受控 | 端到端测试 |
| XD-14 | Computer Use 仅真实驱动可执行；无驱动时 unsupported | adapter 报告 |
| XD-15 | MCP/Skills 真实清单、会话覆盖和审计一致 | 服务/UI 对照 |
| XD-16 | Agent Hub 只连可证实父子边；未知关系明确 | 事件 fixture |
| XD-17 | 工具可用性来自真实 Host/Runtime capability；伪造、过期或提权声明被 Main 拒绝 | capability/IPC 测试 |
| XD-18 | BTW 不污染主对话；不支持隔离时 unsupported | 上下文对照 |
| XD-19 | 语音需点击录音、可取消、转写可编辑、不自动发送 | 真机测试 |
| XD-20 | 评测 case 结果/usage/取消/隔离执行真实可追溯 | run 报告 |
| XD-21 | Time Travel 可读事件；fork/restore 无协议时 unsupported，不伪造 | 协议/UI 测试 |

### 12.5 用量（XE）

| ID | 验收标准 | 证据 |
|---|---|---|
| XE-01 | 只摄入真实 usage；未知不画 0、不估算 | adapter/UI 测试 |
| XE-02 | 重复 event/revision 幂等，修正只计一次 | Ledger 测试 |
| XE-03 | partial/final/corrected 和可能重复记录处理正确 | 回放 fixture |
| XE-04 | SQLite/JSONL 结果一致；compaction/备份/损坏可恢复 | 双实现对照 |
| XE-05 | 首页/顶栏同源 ReadModel，切换粒度不改变总量 | 端到端测试 |
| XE-06 | 年/月/周/日 bucket 边界、时区、周起始正确 | 时间 fixture |
| XE-07 | 折线图点击下钻、筛选、图例、unknown coverage 正确 | UI 测试 |
| XE-08 | 热力空格/部分/错误/未来日期状态正确 | UI 测试 |
| XE-09 | 顶栏本轮用量按 turnId，缓存率口径正确 | 数据对照 |
| XE-10 | context 快照不累计；缺 window 时不显示百分比 | 数据测试 |
| XE-11 | 大量事件分桶在实际数据规模下可操作，记录实际耗时 | bench 报告 |
| XE-12 | 修正后首页和顶栏同步更新，无需重算原始事件 | 端到端测试 |

### 12.6 质量与发布（XF）

| ID | 验收标准 | 证据 |
|---|---|---|
| XF-01 | 既有失败测试逐条有基线；新测试不删旧断言掩盖问题 | 测试报告 |
| XF-02 | `npm run check` 或批准后的等价全量命令通过；新增包纳入 | CI 日志 |
| XF-03 | 鼠标/键盘/IME/焦点/滚动/取消全回归通过 | 清单 + 录屏 |
| XF-04 | 视觉走查、可访问性、200% 缩放通过 | 截图 + 问题单 |
| XF-05 | core/UI bench 有实际数字和机器配置，无虚构性能承诺 | bench 日志 |
| XF-06 | 备份、迁移、损坏、磁盘满、断电式恢复通过 | 恢复演练 |
| XF-07 | 新入口默认关闭或显式启用；旧入口回退不双写 | 开关测试 |
| XF-08 | 灰度有监控、停止条件和用户数据备份 | 发布检查表 |
| XF-09 | 回滚包在隔离副本演练成功，不删除用户新数据 | 回滚报告 |
| XF-10 | OMP 桥仅列退出计划，未自动删除/改写 vendor | 依赖清单 |
| XF-11 | 需求→WBS→验收→证据无缺项；unsupported 不计为完成 | 追踪矩阵 |
| XF-12 | 已满足/未验证/外部阻塞分别列明，用户明确批准后才发布 | 交付报告 |

---

## 13. 测试策略与 fixture

### 13.1 测试金字塔

| 层 | 范围 | 主要手段 |
|---|---|---|
| T0 纯函数 | layout、window、drop、lease、usage、时区、迁移 | Node test + 属性测试/固定 seed |
| T1 协议 | RuntimeClient、审批、控制方法、事件 envelope | 假 stdio Runtime，不调用真实模型 |
| T2 投影/存储 | session event→view、UsageLedger、JSONL/SQLite | 脱敏 JSONL 回放、损坏注入 |
| T3 UI | tabs、拖放状态、弹窗、空态、图表 | Vitest/jsdom/testing-library + pointer 事件 |
| T4 Host 安全 | IPC sender/origin/path/ticket/partition | Electron 集成测试、恶意 fixture |
| T5 真机 | 窗口、多屏、DPI、PTY、浏览器、麦克风 | Windows 真机 + 录屏/日志 |
| T6 恢复/发布 | 崩溃、断电式截断、备份、回滚 | 隔离用户数据目录，不动真实用户数据 |

### 13.2 必建 fixture

- `approval-sync.jsonl`：同步响应。
- `approval-cross-microtask.jsonl`：跨微任务响应，复现旧竞态。
- `approval-timeout-duplicate.jsonl`：超时和重复点击。
- `multi-session-a-b.jsonl`：双 session 并发、审批和工具结果。
- `orphan-notification.jsonl`：无 sessionId、无 owner、sequence gap。
- `usage-assistant.jsonl`：真实 `assistant/message.data.usage` 位置。
- `usage-partial-final-corrected.jsonl`：多次修正、重复、乱序。
- `usage-cache-includes-true-false-unknown.jsonl`：缓存口径。
- `usage-corrupt.jsonl`：截断、错误 schema、非数值。
- `layout-drag-cancel-keyboard.json`：6px、Escape、blur、键盘。
- `layout-migration-v0-v1.json`：旧布局和非法引用。
- `window-multi-display.json`：负坐标、不同 DPI、拔屏。
- `browser-navigation-download.json`：重定向、弹窗、scheme、下载。
- `tools-capability-matrix.json`：supported/unsupported/stale。
- `agent-lineage.json`：多根、嵌套、未知边。
- `time-travel-conflict.json`：只读、冲突、unsupported restore。

所有 fixture 必须脱敏、可重复、有预期结果；禁止复制真实 cookie/token/用户消息。

### 13.3 目标命令

当前已有、批准实施后可运行：

```bash
npm run check
npm test
npm -w @dsh-studio/renderer run build
npm run studio:typecheck
npm -w @studio/ui-shell exec -- vitest run
```

实施后计划新增并接入根 `check`：

```bash
npm -w @dsh-studio/workbench-core test
npm -w @dsh-studio/workbench-core run typecheck
npm -w @dsh-studio/workbench-ui test
npm run test:protocol
npm run test:desktop-security
npm run test:usage-replay
npm run bench:workbench
```

这些新命令在对应 package/script 创建前不存在，不得在验收报告中写成已通过。Electron 真机命令需包含 `DSH_RENDERER_URL`、隔离 `userData`、Runtime profile 和日志目录，且不得读取真实凭据。

---

## 14. 风险登记与应急

| 风险 | 等级 | 触发信号 | 预防 | 应急/回滚 |
|---|---|---|---|---|
| RK-01 Runtime 无真实 steer/queue | 高 | capability=false/unknown method | X0 协议盘点，不模拟 | 保留 unsupported；只发布已验证子集 |
| RK-02 审批竞态导致误取消 | 高 | 用户未操作已 cancelled | X0.3 先行、超时审计 | 关闭新入口，恢复旧审批路径并修复 |
| RK-03 多会话事件串线 | 高 | A 审批/结果出现在 B | owner/lease、隔离队列 | 立即停用多会话开关，保留单会话 |
| RK-04 usage 字段/缓存口径错误 | 高 | 总额与 provider 回执不一致 | 冻结样本、rawUsageHash、修正语义 | 关闭统计入口，保留原始事件 |
| RK-05 SQLite 在 Electron 不可用 | 中 | 探针 import/open 失败 | X0.7 实测 | 同接口 JSONL；不改 UI |
| RK-06 独立窗口 ticket 被重放 | 高 | 过期/跨 sender 被接受 | 一次性、sender/frame/origin 绑定 | 关闭 native 窗口，吊销 ticket |
| RK-07 浏览器跨区 attach 抖动/崩溃 | 高 | view 丢消息、rect 漂移 | 单一 Main owner、几何事务 | 回退内部浮窗，关闭跨宿主浏览器 |
| RK-08 浏览器任意导航/下载风险 | 高 | 危险 scheme/未授权文件 | 白名单、partition、下载目录 | 关闭浏览器工具，隔离 partition |
| RK-09 PTY 泄漏/误杀 | 高 | 关窗后进程仍存活/误杀其他 PID | instance registry、幂等 close | kill 自有实例，禁用 native terminal |
| RK-10 多屏恢复窗口不可达 | 中 | displayId 丢失、负坐标 | workArea clamp/intersection | 安全重置几何，不删布局 |
| RK-11 拖放破坏输入/终端现场 | 高 | IME 中断、滚动重置 | 真实正文保留、不重建 | 回退到 tab 切换，保留旧入口 |
| RK-12 SSH/ASR/Computer 凭据泄漏 | 高 | 日志/布局出现 secret | 安全存储 ID、脱敏、最小权限 | 撤销凭据、关闭适配器、隔离日志 |
| RK-13 Computer Use 高风险误操作 | 高 | 非预期点击/系统设置变更 | 默认限制、确认、动作回执 | 立即取消、关闭驱动、人工恢复 |
| RK-14 Time Travel 覆盖工作区 | 高 | restore 直接写当前文件 | 只读优先、RestorePlan、备份 | 从备份恢复，禁用 restore |
| RK-15 OMP 空接口被当真能力 | 高 | usage/git/worktree 固定空值 | 能力矩阵、真实服务对照 | 标 unsupported，移除桥调用 |
| RK-16 旧测试失败被删掩盖 | 中 | 断言数量无故下降 | X0 基线、测试审查 | 恢复断言，重开基线 |
| RK-17 大量 usage 导致 UI 卡顿 | 中 | 切年/热力图明显阻塞 | 预聚合、分桶、bench | 限制范围/降粒度，保留 coverage |
| RK-18 存储损坏/磁盘满 | 高 | JSON 截断、rename 失败 | 原子写、fsync、备份 | 保留坏文件，恢复上一备份 |
| RK-19 视觉参考许可污染 | 中 | 复制 Seelen/shadcn 代码 | clean-room、依赖扫描 | 移除复制内容，保留自绘实现 |
| RK-20 新入口与旧入口双写分叉 | 高 | 同布局两套 revision | 显式开关、单一状态源 | 默认旧入口，停新入口写权限 |

---

## 15. 回滚、迁移与退出

### 15.1 回滚层级

| 级别 | 触发 | 动作 | 数据保护 |
|---|---|---|---|
| R0 交互回滚 | Escape/cancel/blur、drop 校验失败 | 不提交 reducer，恢复焦点 | 无写入 |
| R1 功能回滚 | capability=false、适配器失败 | 该工具 unsupported，其他工具继续 | 保留活实例/日志 |
| R2 阶段回滚 | XG 未过、安全/串线/usage 错误 | 关闭功能标记，回到上一阶段 | 不迁移用户布局 |
| R3 产品回滚 | 灰度严重故障 | 显式启用旧入口，停止新入口写权限 | 保留新状态文件和备份，不双写 |
| R4 数据恢复 | 布局/usage 损坏 | 从 `.backup`/usage 快照恢复 | 原文件改名隔离，不删除 |

### 15.2 回滚包内容

- 应用版本/构建哈希、功能标记快照；
- 布局 schema、迁移版本、上一版本备份；
- usage repository schema、事件数、最后 revision、备份 hash；
- 浏览器 partition 和 artifact 目录位置（不打包 cookie/密钥）；
- PTY/native 窗口关闭清单；
- 恢复步骤、验证命令、负责人、实际演练结果。

### 15.3 回滚演练要求

- 在隔离用户数据副本执行，不碰真实 profile。
- 验证旧版本能读迁移前备份；新版本产生的用户数据不丢失。
- 回滚后不得自动重放旧事件、重复发送消息或恢复过期审批。
- native 窗口、PTY、浏览器 view 在回滚前按 registry 有序关闭。
- OMP 桥退出是单独批准项；未批准前不删除 vendor、不强制用户迁移。

---

## 16. 批准门与阶段退出条件

| 门 | 必须回答/满足 | 未满足时 |
|---|---|---|
| XG0 基线门 | 协议事实表、审批修复方案、安全威胁模型、存储/多屏探针、脏工作树保护、失败测试基线 | 不写生产实现 |
| XG1 协议门 | 用户/评审明确批准 additive 方法；能力矩阵和 unsupported 降级；审批/事件测试通过 | 仅做 core/纯 fixture，不接真实多会话 |
| XG2 核心门 | 依赖边界、布局/拖放/租约/usage 单元与属性测试通过 | 不接 Electron 窗口 |
| XG3 窗口门 | ticket 安全、6px 预览、正文保持、双屏/DIP 真机通过 | 不启用 native 入口 |
| XG4 多会话门 | A/B 隔离、草稿/审批/工具独立、断线补齐、上限策略通过 | 保持单会话 |
| XG5 工具门 | 每个工具有真实服务或明确 unsupported；浏览器/PTY 安全通过 | 未接工具保持 disabled |
| XG6 用量门 | 真实字段、幂等、修正、存储恢复、四粒度/顶栏对照通过 | 不展示统计图表 |
| XG7 质量门 | 全量检查、真机、压力、可访问性、恢复演练通过；无 P0/P1 未关闭 | 不灰度 |
| XG8 发布门 | 用户明确批准发布；灰度/回滚包/监控/数据备份齐备 | 不发布、不提交、不推送 |

每个门提交的证据包包含：变更文件清单、命令与结果、fixture hash、真机配置、未验证项、回滚结论。只写“已完成”不算过门。

---

## 17. 真实设备验收脚本

### 17.1 环境记录

每次记录应用版本/构建哈希、Windows 版本、Electron/Node 版本、显示器数量/ID/DIP/scaleFactor、WSL distro/user、Runtime identity/version、测试工作区、功能开关；不记录密钥和 cookie。

### 17.2 窗口与拖放

1. 打开两个会话，各开 Files、Terminal、浏览器 tab。
2. 在输入框输入中文并保持 IME 组合，将面板从主区拖到右栏、底栏、浮窗、独立系统窗口。
3. 验证 6px 前不移动、6px 后真实正文预览、release 后输入/焦点/滚动保持。
4. 成组移动、最小化、恢复、Pin 五档逐项操作。
5. 拖到第二显示器，改 DPI、拔屏、重插、睡眠唤醒，验证窗口可见。
6. 退出并重启，验证布局、窗口、tab 和草稿恢复；PTY 不重复 spawn。

### 17.3 多会话与审批

1. A/B 同时运行；分别产生审批和工具结果。
2. 在 B 视图确认 A 审批不可见、不可操作；切回 A 可正常响应。
3. 断开/重连 Runtime，验证 sequence 补齐、无重复消息。
4. 将 Terminal 从 A 移到 B，选择“移动并改归属”；验证不复制 PTY。
5. 达到实例上限，验证明确拒绝且不杀现有进程。

### 17.4 浏览器与工具

1. 两个 workspace 登录同一测试站点，验证 cookie 隔离和 persistent/ephemeral 差异。
2. 多 tab 前进/后退/刷新、弹窗、重定向、危险 scheme、下载。
3. 打开/关闭 DevTools，确认无 Node 权限。
4. 拾取元素并生成 artifact；核对 URL、rect、尺寸、hash 和消息引用。
5. Files 冲突保存、Git stage/commit、Worktree/提交图逐项对照真实仓库。
6. Computer/ASR/SSH/fork 未接时确认 unsupported，不出现假执行。

### 17.5 用量

1. 用脱敏 usage fixture 和真实测试回执分别摄入。
2. 切换年/月/周/日、时区、周起始，核对 bucket 和总量。
3. 注入重复/partial/final/corrected/损坏行，验证覆盖和修正。
4. 对照 provider/Runtime 原始回执检查顶栏本轮、缓存率和 context。
5. 杀进程/磁盘满模拟后恢复，核对事件数、最后 revision 和首页一致。

---

## 18. 实施记录模板

每个 WBS 完成后记录：

```text
WBS:
状态: 已满足 / 未验证 / 外部阻塞
变更文件:
协议/接口:
新增测试:
执行命令与实际结果:
fixture/证据 hash:
真机配置（如适用）:
安全/隐私检查:
回滚验证:
遗留问题:
下一依赖:
```

每个阶段结束更新本文的 WBS 状态，但不降低验收标准；如需求变更，新增变更记录和批准人，不覆盖历史结果。

---

## 19. 完成定义（DoD）

只有同时满足以下条件，才能称“桌面产品扩展完成”：

- RP-01～RP-12 逐项映射到已通过的验收，unsupported 项不计为完成。
- 真实 Runtime/Host 驱动会话、工具和 usage；没有 OMP mock/固定空值进入产品。
- 审批、事件、工具、cookie、终端、usage 无跨会话泄漏。
- 独立系统窗口、第二显示器、DPI、重启恢复真机通过。
- 6px 拖放、真实预览、正文现场保持、键盘/取消语义通过。
- 全部工具要么真实可用，要么明确未接入且不伪装；外部阻塞单列。
- 用量真实、幂等、可修正、可恢复；首页和顶栏同源。
- 全量检查、真机、压力、安全、可访问性、备份/回滚证据齐备。
- 用户明确批准发布；提交、推送、发布分别按授权执行。
- 旧入口和用户数据可回退；OMP 桥退出未自动发生。

**当前状态**：以上均为目标，不是已实现结论。本文交付后等待 G0 评审；未获明确批准前不开始生产代码实施。
