# DSH Studio 桌面产品扩展评审方案

版本：1.0  
日期：2026-11-24  
状态：待评审；本文件不授权修改生产源码、安装依赖、构建、测试、提交、推送或发布。  
上位方案：[DSH Studio 原生工作台建设方案 v2.3](DSH-WORKBENCH-LAYOUT-PLAN.md)  
上位计划：[DSH Studio 原生工作台落地计划书 v2.3](DSH-WORKBENCH-LAYOUT-IMPLEMENTATION-PLAN.md)

## 1. 本方案要解决的问题

在既定“DSH 原生、不 fork、不换皮、不长期桥接”的边界内，把工作台从面板布局原型推进为完整桌面产品：

1. 对话、工具、网页使用同一套窗口身份、放置、分组、最小化和恢复规则；应用内浮窗与真实 Electron 系统窗口只是同一窗口的不同宿主。
2. 多场对话真正并行，各自拥有独立的工具实例、工具布局、草稿、队列和权限视图；共享能力通过显式规则借用，不靠窗口名或当前活动会话猜测归属。
3. 工具覆盖面补齐，未实现能力明确显示为不可用，不把 OMP  mock 或静态截图当成 DSH 功能。
4. Token 统计来自可审计的真实事件；折线图、热力图和单轮详情共用同一用量账本，不用字符数冒充 Token。

本方案是 v2.3 的扩展，不覆盖其原生架构、视觉、许可和退出原则。用户本轮新增的工具与统计目标，取代 v2.3 中把 Browser、Computer、BTW、Evaluation 等一律列为非目标的旧范围判断；它们进入本轮实施范围，但仍必须原生化实现，不能恢复 OMP 功能运行时。

## 2. 源码现状与证据

### 2.1 桌面入口和原生窗口

| 结论 | 源码证据 | 对方案的影响 |
| --- | --- | --- |
| 桌面默认优先加载 `apps/renderer-omp/dist`，不是原生 `apps/renderer` | `apps/desktop/src/main.js:13-17` | 原生工作台仍是待实施目标，不能把当前 OMP 行为称为 DSH 已完成 |
| 只创建一个固定初始尺寸的主 `BrowserWindow` | `apps/desktop/src/main.js:518-562` | 主窗口几何恢复、多显示器、系统最小化/恢复均需新增 |
| `WebContentsView` 已用于浏览器叠层，但只有单例 | `apps/desktop/src/main.js:328-437` | 可复用 Electron 原生视图能力，不能复用单标签、单会话假设 |
| 主 preload 暴露 `dsh` 与 OMP 桥，没有独立工作台窗口 API | `apps/desktop/src/preload.cjs:3-111` | 新窗口通道必须新增窄 API；子窗口不能继承 Runtime/terminal/prepare/control |
| `packages/workbench-core`、`packages/workbench-ui` 尚不存在 | `package.json:6-9` | 先落实共享 core/UI，再扩展窗口与工具，避免在生产页面里继续堆状态 |

### 2.2 已有应用内窗口与多会话能力

| 结论 | 源码证据 | 可复用边界 |
| --- | --- | --- |
| 已有 float/dock/native/docked、最小化、最大化、Pin 和吸附模型 | `apps/renderer-omp/src/dock/windows.ts:5-159` | 只抽象行为与纯状态，不 import OMP reducer、类型或 store |
| 会话引用已区分 session/draft/history/preview，document 与 view 分离 | `apps/renderer-omp/src/conversationWorkspace/model.ts:4-31` | DSH 新身份只保留 session/draft，网页使用独立 BrowserRef |
| 同一引用复用 document，新引用创建 document；main/float 可并存 | `apps/renderer-omp/src/conversationWorkspace/store.ts:364-404` | 保留 document/view 分离，不把布局身份当业务身份 |
| 会话文档、窗口矩形、snap 和焦点已持久化恢复 | `apps/renderer-omp/src/conversationWorkspace/store.ts:104-133` | 迁移为 DSH 单一 schema，不继续写 OMP 键 |
| 工具栏布局按 target/project/session/draft 分 scope，草稿转正会话可继承 | `apps/renderer-omp/src/dock/store.ts:31-66,692-745` | 保留作用域继承；把“布局隔离”升级为“工具实例隔离” |
| 多会话事件按 context/sessionId 隔离，草稿会话按 context 分配稳定身份 | `apps/desktop/src/studio-bridge.js:502-569` | 迁移时保留事件 fence 和上下文隔离，不允许跨会话串流 |

说明：当前多会话实现属于 `apps/renderer-omp`，只作为一次性迁移与行为参考，不是最终 DSH 原生代码。旧 `apps/renderer` 虽能展示多会话消息，但输入、工具和审批仍有全局状态，不能直接承担本轮产品目标。

### 2.3 原生独立窗口的真实状态

- OMP 的 `placement: "native"` 只有在 `ompStudioChrome.prepareFloatWindow` 存在时才进入原生宿主，否则回退应用内浮窗：`apps/renderer-omp/src/conversationWorkspace/Workspace.tsx:257-301`。
- `NativeWindowHost` 的设计是票据开窗、同源 document portal、共享样式与正文节点：`apps/renderer-omp/src/dock/NativeFloat.tsx:62-128`。它依赖缺失的 preload API，当前不能形成真实系统窗口。
- 因此，独立任务栏图标、跨显示器拖动和系统窗口恢复属于“有界面模型、无可用桥接”，不能计为已实现。

### 2.4 按会话工具集的真实边界

当前 scope 只解决布局归属。DSH bridge 明确说明技能启停界面未实现：`apps/desktop/src/studio-bridge.js:334-335`。因此本轮必须区分：

- **工具布局**：某会话显示哪些面板、放在哪里，可由 DSH 工作台原生实现。
- **工具实例**：终端、浏览器、SSH、Computer Use 等资源属于哪个会话，必须由资源注册表保证。
- **执行权限**：Runtime 是否允许某会话调用某工具，只能以 Runtime capability/策略为权威。工作台可以展示和请求允许项，不能在前端伪造“已禁用”安全边界。

## 3. 统一窗口系统

### 3.1 身份模型

在 v2.3 的 `ConversationRef`、`PanelRef` 基础上增加持久窗口身份：

```text
ConversationRef =
  | { kind: "conversation"; sessionId: string }
  | { kind: "conversation"; draftId: string }

BrowserRef =
  | { kind: "browser"; browserId: string; tabId: string }

PanelRef =
  | { kind: "panel"; panelId: string; instanceId: string }

WindowContentRef = ConversationRef | PanelRef | BrowserRef

WindowRef = {
  windowId: string
  host: "main" | "internal" | "native"
  content: WindowContentRef
  placement: "main" | "float" | "snapped" | "minimized" | "native"
  groupId?: string
  native?: { displayId: string; normalBounds: Rect; isMaximized: boolean; isMinimized: boolean; topmost: boolean }
}
```

约束：

- `windowId`、`instanceId`、`browserId/tabId` 都是稳定 ID，不使用标题、路径、数组下标或当前活动会话生成。
- document/view 继续分离：同一 session 可有多个 view，但共享同一会话业务状态与事件订阅。
- 每个独占式工具实例同一时刻只能属于一个窗口；共享式只读面板可以多 view，但必须共享 lease。
- 主窗口是永久 host；内部窗口和系统窗口可以关闭、最小化、成组和恢复。
- 应用内浮窗与系统窗口执行同一 reducer；宿主差异只由 Electron adapter 实现。

### 3.2 单一状态源

`WorkbenchLayout` 是窗口、分组和正文布局的唯一状态源。Runtime 仍是会话与工具事实源。

```text
WorkbenchState
  hosts: { main: HostLayout, internal: {...}, native: {...} }
  windows: WindowRecord[]
  groups: WindowGroup[]
  activeWindowId
  minimizedRecords
  focusOrder
  revision
```

禁止再维护第二套“右栏状态”“浮动列表”“系统窗口顺序”或 OMP dock store。预览态、系统窗口异步回执和浏览器几何同步都是短期状态，提交后必须归并到同一 reducer。

### 3.3 真实系统窗口边界

- 用一次性票据控制 `window.open`，由 Electron 创建独立 `BrowserWindow`；每个系统窗口拥有自己的任务栏入口。
- 子窗口只挂载 DSH 宿主，不挂载 App、不启动 RuntimeClient、不创建第二个终端或会话客户端。
- 对话、终端等 DOM 工具通过同源 document host 移动真实正文节点，不复制 DOM，不重建输入、滚动、选区或终端现场。
- 浏览器使用 Electron 原生 `WebContentsView` 组合：Main 把同一个 view 从主窗口或旧系统窗口 detach，再 attach 到目标宿主并同步正文矩形。多标签就是多个受控 view，不是多个独立 Runtime。
- 浏览器与 DOM 工具成组时，浏览器 view 只覆盖其正文矩形，标题栏、标签和相邻工具仍由 DSH React 宿主绘制；跨宿主移动时保持 tab/webContents 身份。
- 独立窗口不得暴露通用 IPC、文件、终端、Runtime 或窗口控制 API。需要跨宿主的能力由父 Renderer 代理，并按 windowId/content owner 校验。
- 打开失败、票据过期、ready 超时或窗口崩溃时回退应用内浮窗，保留同一 content ID，显示可见原因。

### 3.4 多显示器与恢复

- 几何使用 DIP；Main 持有显示器快照与 `workArea`，Renderer 不直接假设主屏坐标。
- 每个系统窗口保存 `displayId`、normal bounds、最大/最小化、topmost 和 monochrome/taskbar 状态；主窗口同样保存。
- 启动恢复顺序：枚举显示器 → 恢复主窗口 → 校验每个 normal bounds → 越界窗口按最近可用显示器校正 → 创建窗口 → 恢复 portal/browser view → ready。
- 支持负坐标、不同 DPI、显示器重排、拔屏和分辨率变化。显示器消失时移动到剩余显示器，不丢弃窗口或内容。
- 最小化是系统状态；应用内最小化是布局状态。两者通过 adapter 同步，但不混淆任务栏图标与 Dock 胶囊。

### 3.5 拖放规则

- 单面板、整组标签、对话窗口和浏览器标签共用 6px 激活阈值。
- 未超过 6px：点击、选择或聚焦；超过 6px：进入拖动，显示真实正文落点预览，源布局保持可用。
- 拖影使用真实正文克隆；Terminal、Composer、审批等运行现场不进入克隆，不发送输入。
- pointerup 才提交 float/dock/snap/group/native 变更；Escape、pointercancel、blur 完整回滚。
- 键盘使用同一 reducer：Enter/Space 拿起、方向键移动、Shift 加速、Enter 放下、Escape 取消。
- 窗口最小化、最大化、locked、native 与 snapped 状态具有明确可拖/不可拖规则，不静默吞掉操作。
- 热区迟滞、递归分栏、最小尺寸、标签顺序和唯一性不变量必须由 core 单测覆盖。

## 4. 多会话并行

### 4.1 会话容器

每场对话是一个独立容器，而不是一组全局面板：

```text
ConversationWorkspace {
  owner: ConversationRef
  document: Composer/Draft/Queue/Approval state
  toolLayout: WorkbenchLayout
  toolInstances: ToolInstanceRef[]
  toolset: SessionToolset
  leases: SessionLease[]
  runtimeCapabilities: CapabilitySnapshot
}
```

- 草稿使用稳定 UUID；草稿转正 session 时按明确规则迁移布局和工具实例，不复制运行中的终端。
- 每场对话可同时显示在多个窗口，但只有一个 document owner 和一份派生状态缓存。
- 关闭视图只释放 UI lease，不取消 Runtime 任务，不删除会话。
- 最后引用释放时才退订；重连使用 epoch fence 丢弃旧事件。

### 4.2 工具实例与借用

- Terminal、SSH、WSL2、Computer Use、浏览器 tab 默认 `exclusive`，绑定 owner session/workspace。
- Files、Changes、Git 查询默认 `shared-read`，可按 workspace 共享，但写操作必须带 owner 与当前审批上下文。
- MCP/Skills 的“启用”来自真实 capability/profile；会话覆盖只能是允许列表的子集，不能越权开启。
- `workspace` Pin 允许同项目借用；`application` Pin 跨项目借用必须显式确认并重新校验 workspace/权限；`window/topmost` 只改变宿主。
- 跨会话移动独占工具时显示“移动并改归属”或“创建新实例”两种明确结果，不隐式共享 PTY 或浏览器登录空间。

### 4.3 并行验收

- A/B 两场对话可同时流式输出；切换、最小化、移动、拖到第二显示器均不增加订阅、不停止生成、不串 token/chunk。
- A 的 Terminal、浏览器登录空间、Computer Use 目标和工具布局不出现在 B，除非显式借用。
- 任一窗口崩溃只影响其宿主；正文回退后 session、队列、审批和工具实例仍可恢复。
- 所有恢复、预设、最近关闭和 Pin 都重新经过 capability/owner 过滤，悬空引用进入隔离区。

## 5. 工具全覆盖实施原则

工具统一通过 `PanelRegistry` 注册，但底层资源可以是 DOM 面板或 Electron 原生 view：

```text
PanelDefinition {
  id, title, category, icon, minSize
  mountPolicy: "keep-alive" | "release-on-close"
  resourceMode: "dom" | "webcontents"
  ownership: "shared-read" | "exclusive"
  requiredCapabilities
  component / nativeAdapter
}
```

能力状态固定为 `not-implemented / unsupported / unavailable / empty / ready`。未实现不开放入口；Host 不支持则禁用并说明；读取失败保留重试；空结果显示 empty；任何状态都不写演示业务数据。

### 5.1 工具能力矩阵

“已实现”仅指当前 OMP 桌面入口背后的真实链路，不代表已进入 DSH 原生 renderer；所有复用都必须经过新的 DSH port 重新接线。

| 工具 | 当前结论 | 真实证据 | 原生补齐方案 |
| --- | --- | --- | --- |
| Files | 已实现真实查看/编辑/保存，含外部修改冲突处理 | `apps/renderer-omp/src/files/FilePane.tsx:34-62`；`apps/desktop/src/studio-bridge.js:2105-2124` | 迁入 DSH FilePort；保留草稿/冲突/版本检查，增加稳定 PanelInstance 与多窗口 lease |
| Changes | 部分实现：状态和 diff 真实，Git 写命令被拒绝 | `apps/desktop/src/studio-bridge.js:414`；`apps/renderer-omp/src/git/GitStatusPanel.tsx:275-327` | 先接真实 read model；stage/unstage/commit 走独立 GitWritePort，操作前展示变更与确认，不复用前端假回执 |
| Git / 提交图 | 读模型已实现，包括 branches、log parents/refs、commit files/diff | `apps/desktop/src/studio-bridge.js:948-1077,1317-1363` | 原生化 GitReadPort 与提交图；补 ahead/behind、stash、操作回执和仓库级 revision |
| Worktree | 未实现：列表固定为空 | `apps/desktop/src/studio-bridge.js:1348-1349` | 通过受控 Git CLI 实现 list/create/lock/unlock/remove/prune；路径、分支、脏工作区、删除前检查全部在 Main 执行 |
| Terminal | 已实现 node-pty + xterm；OMP 多 PTY 上限 8，无录制/tmux | `apps/desktop/src/main.js:175-326` | 改为稳定 terminalId + owner + lease；跨系统窗口 detach/attach 同一 PTY；保留 scrollback，补中断/退出/重连 |
| SSH | 未实现 | `apps/desktop/src/preload.cjs:78-111` 未暴露 SSH 通道 | 用系统 SSH + node-pty 建立真实会话；host key 校验、known_hosts、超时、认证失败和日志脱敏；凭据优先 SSH agent/密钥，密码交互不落布局 |
| WSL2 工作区 | 部分实现：可启动固定 distro/user 的 WSL shell，不能按会话切换工作区 | `apps/desktop/src/main.js:175-247` | 扩展 launch profile：distro、user、cwd、env allowlist；按 workspace/session 绑定，校验 WSL 可用性，不默认提升权限 |
| 托管浏览器 | 部分实现：单例 WebContentsView 可导航；OMP 页面是演示占位 | `apps/desktop/src/main.js:328-437`；`apps/renderer-omp/src/preview/ManagedBrowserDemoPage.tsx:8-14` | Main 管理多 tab/view；统一地址栏、下载、权限、导航白名单、宿主几何与跨窗口 attach |
| DevTools / 元素截图引用 | 部分实现：引用结构可序列化，但截图字节被剥离；DevTools 未接 | `apps/renderer-omp/src/composer/browserReference.ts:12-21` | 用 Electron/CDP 做元素定位、区域截图、控制台/网络检查；截图走 artifact receipt，引用保存 tabId/selector/frame/rect/hash，不把大字节塞进布局 |
| 持久登录空间 | 未实现 | 当前单例浏览器未设置 `partition`：`apps/desktop/src/main.js:351-365` | 每个 owner 使用 `persist:dsh-browser-<ownerHash>` partition；会话借用显式授权，清除存储需单独确认，不把 cookie 写入状态文件 |
| Computer Use | 未实现 | `apps/desktop/src/studio-bridge.js:280-387` 的不可用能力表没有对应真实服务 | 先完成 Windows 驱动 spike：桌面捕获、可访问性树、受控输入、审批、截图审计；驱动不可用时保持 unsupported，不用脚本演示冒充执行 |
| MCP | 部分实现：可发现 profile 中服务器；刷新/启停/测试/日志不可用 | `apps/desktop/src/studio-bridge.js:329-334,849-868` | 原生 MCPReadPort 展示服务器、scope、状态与诊断；配置变更必须走已验证的 profile API，否则只读 |
| Skills | 部分实现：可读取；会话启停界面未实现 | `apps/desktop/src/studio-bridge.js:335,1385-1388` | 展示 skill 元数据、依赖、来源和当前 capability；会话 toolset 只能裁剪允许项，不能越权开启 |
| Agent Hub 星图 | 部分实现：真实子 Agent 生命周期快照可驱动父子轨道图；控制能力缺失 | `apps/desktop/src/studio-bridge.js:574-650,1268-1283`；`apps/renderer-omp/src/agents/deck/OrbitView.tsx:54-82` | 原生化 AgentGraphPort；主/子 Agent、状态、开始/结束、transcript 入口使用真实 ID；kill/revive/send 在接口缺失时禁用 |
| BTW 旁路追问 | 未实现 | `apps/desktop/src/studio-bridge.js:322-326` | 创建独立 BTW draft session，携带用户选定的消息引用；结果显示来源和 token 消耗，用户确认后插入主 Composer，不静默改写主会话 |
| 语音输入 | 未实现：有 UI 状态机，但桌面音频桥不存在；WebRTC 不可用 | `apps/renderer-omp/src/composer/dictationSession.ts:61-63`；`apps/desktop/src/studio-bridge.js:292-295` | 新增音频采集/ASR provider port；先验证服务商、协议、权限与隐私，未配置时不可用；不把实时语音网关当已有能力 |
| 评测工作区 | 部分实现：可从工具调用投影测试命令、退出码并重跑；不是独立评测系统 | `apps/renderer-omp/src/conversation/agentTestRuns.ts:60-110` | 建 EvaluationRun/EvaluationCase 模型，关联 commit、命令、fixture、日志与结果；支持本地回归和基线比较，不虚构 benchmark 账号 |
| Time Travel | 未实现：快照列表、预览、恢复均不可用 | `apps/desktop/src/studio-bridge.js:286-291,375` | 先做真实 transcript 时间线；再建 touched-file/Git 快照 manifest、恢复预览与显式确认。当前会话分叉/回滚需 Runtime 新能力，不能由前端伪造 |

### 5.2 不可削减的安全边界

- Git 写操作、Worktree 删除、hard reset、force push、SSH、Computer Use 和快照恢复都必须有真实回执与确认；失败不显示成功。
- 浏览器外部协议、文件下载、权限、新窗口和 DevTools 暴露面按 tab/owner 隔离。
- 终端和 SSH 输出按不可信文本处理；状态栏不执行输出中的命令，不把输出写进 Git/Runtime 状态。
- 截图、录音、密钥、cookie、终端内容和用户文件不进入布局快照、日志、错误上报或遥测正文。
- 旧 OMP mock、preview fixture 和演示页面只允许留在原型/测试目录，不进入 DSH 产品 bundle。

## 6. 用量统计

### 6.1 当前真实状态

- 首页已有年/月/周/日切换、SVG Token 折线图、日历热力图、模型图例、缓存命中和顶栏展开 UI：`apps/renderer-omp/src/HomePage.tsx:319-375,681-838`。
- 真实 `usage.get` 返回空 `days/models/byModel/hours`：`apps/desktop/src/studio-bridge.js:1216-1223`。
- `session.telemetry.read` 只返回 sessionId/generatedAt，不返回 token 或 context：`apps/desktop/src/studio-bridge.js:1295-1296`。
- `usage.openDashboard` 明确标记 DSH 无对应数据：`apps/desktop/src/studio-bridge.js:354`。

结论：当前是“图表组件已具备、数据链路为空”，不能通过接现有 query 得到真实统计。

### 6.2 用量账本

新增 DSH 原生 `UsageLedger`，由 Desktop/Host 从 Runtime/provider 的**实际 usage 回执**写入，UI 只读：

```text
UsageEvent {
  eventId, schemaVersion
  hostId, workspaceId, sessionId, turnId, requestId
  model, provider
  occurredAt, completedAt
  inputTokens, outputTokens, cachedInputTokens?
  reasoningTokens?
  inputTokensIncludesCache: boolean
  context?: { usedTokens, windowTokens, source, observedAt }
  source: "provider" | "runtime"
  status: "partial" | "final" | "corrected"
  revision
}
```

规则：

- 事件使用不可变 ID 和 revision；重复通知幂等，迟到/修正事件覆盖同一 request，不重复累计。
- provider 未返回 usage 时记录 `unknown`，不估算 Token；未知数据不绘制为 0。
- `inputTokensIncludesCache` 必须由适配器明确给出。若 input 已含缓存，则 `uncachedInput = max(input - cached, 0)`；否则 `uncachedInput = input`。缓存命中率只用输入侧计算，不含 output。
- reasoning token 若已包含在 output 中就是子集，不再次相加。
- context 是观测快照，不等于累计用量；记录窗口大小、来源和观测时间，不把不同模型窗口混为一条曲线。
- 时间以 UTC 存储，按用户时区聚合；默认周起始日为周一。修改时区后重新聚合，不改写原始事件。
- 本地账本先落 SQLite；备份、保留期、导出和清除由设置管理，不把业务正文写入账本。

### 6.3 数据来源门禁

实施顺序必须是“真实 usage 回执 → 账本 → 聚合 → 图表”，不能反过来：

1. 核对 Runtime/provider 响应与通知中实际存在的 usage 字段，保存样本与 schema 证据。
2. 增加尽量小的 additive usage envelope，保留既有 query/event 语义；若必须改变 Runtime 协议，先单独评审。
3. 对缺失字段做能力标记；只有权威回执齐全才启用精确 Token、缓存和上下文指标。
4. 历史无数据时段显示“未采集”，不能用当前模型 tokenizer 对旧文本做估算后冒充真实账单。
5. 多模型、子 Agent 与主 Agent 的 usage 按 session/turn/request 归属；无法归属时进入“未归属”而不是随机摊给主会话。

### 6.4 首页与对话顶栏

- 首页折线图与热力图从同一聚合 query 读取，保证总额、模型分布和日期格一致。
- 年：按月聚合；月：按日；周：按日；日：按小时。热力图使用相同时间范围和口径，不另算一套总量。
- 支持 hover/focus 显示精确值、模型分布、数据完整性和未知时段；键盘可访问，颜色不是唯一信息载体。
- 对话顶栏展开显示本轮 input/output/cache hit/reasoning/context、模型、起止时间、数据来源与是否 final。
- 流式过程中显示 provisional；结束后用 final 回执替换；修正事件显示修订标记。
- 顶栏与首页共用 `UsageReadModel`，不各自请求不同接口或维护不同缓存。
- 无 usage 能力时显示“当前模型未返回用量”，不展示 0 tok，不打开空白仪表盘伪装成功。

### 6.5 统计验收口径

- 同一 fixture 的日/周/月/年总和可对账；跨时区、夏令时（若启用）、周一/周日边界、模型切换和修正事件有单测。
- 主 Agent、子 Agent、BTW 的消耗能按规则归属；重复通知只计一次。
- 缓存率公式有明确分子/分母；context 不超过窗口时显示比例，超过时显示异常而非静默截断。
- 首页与顶栏在同一 session/turn 上显示一致；未知与 0 使用不同视觉和文本状态。
- 不读取或上报 prompt、回复、终端内容、密钥、cookie 作为统计维度。

## 7. 原生模块与文件边界

在 v2.3 的 `workbench-core/UI` 与 Desktop 窗口服务之上新增以下 DSH 模块；均为规划路径，当前不存在：

```text
packages/
  workbench-core/src/
    windowModel.ts              WindowRef、HostLayout、分组、最小化、唯一性
    sessionScope.ts             session/draft/workspace owner 与继承
    toolRegistry.ts             PanelDefinition、ownership、capability 类型
    usage/
      model.ts                  UsageEvent、聚合、缓存率、context 规则
      aggregate.ts              年/月/周/日/小时聚合
      persistence.ts            schema、revision、备份、保留期

apps/desktop/src/
  workbench-windows.js          系统窗口、票据、多显示器与恢复
  workbench-host-preload.cjs    子窗口最小宿主 API
  browser-windows.js            多 tab WebContentsView 与跨宿主 attach
  browser-security.js           导航、下载、权限、partition 与 DevTools 策略
  tool-instances.js             terminal/SSH/Computer Use/browser 资源 owner
  ssh-workspaces.js             SSH/WSL launch profile、host key、连接生命周期
  git-write-service.js          stage/commit/worktree 等受控 Git 操作
  computer-use/
    capability.js               Windows 驱动能力探测与 unsupported 状态
    capture.js                  桌面捕获、截图审计
    accessibility.js            可访问性树与元素定位
    input.js                    受控输入与审批
  snapshot-service.js           Time Travel manifest、预览、恢复计划
  usage-ledger.js               权威 usage 回执、幂等、修正与本地存储
  usage-ipc.js                  窄查询与订阅，不暴露通用 invoke

apps/renderer/src/
  platform/dsh/
    runtimePort.ts
    windowPort.ts
    browserPort.ts
    toolPorts.ts
    usagePort.ts
  workbench/
    windows/ sessions/ tools/ usage/

packages/testkit/scripts/
  check-desktop-product-architecture.mjs
  desktop-window-smoke.mjs
  desktop-tools-smoke.mjs
  usage-ledger-smoke.mjs
```

存储选型：优先验证 Electron 45 内置 Node 的 `node:sqlite` 能力，可用时用于 usage/snapshot manifest；不可用时使用同一 repository 接口的 append-only JSONL +  compaction，不新增未经验证的数据库依赖。两种实现都必须通过崩溃恢复、重复事件、备份和损坏测试。

## 8. 扩展需求与追踪

| 需求 ID | 优先级 | 需求 | 主要 WBS | 验收前缀 |
| --- | --- | --- | --- | --- |
| DP-01 | P0 | 统一窗口系统、真实系统窗口、任务栏、多显示器与重启恢复 | G0.3、P1.1、P2.2、P3.1～P3.3、P3.5、P3.7、P6.1、P6.4 | DW-01～DW-12 |
| DP-02 | P0 | 多会话并行、独立工具实例/布局、借用与权限视图 | P1.2、P2.1～P2.5、P3.2、P4.3～P4.5、P4.8、P4.9 | DS-01～DS-10 |
| DP-03 | P1 | 用户点名的全部工具具备真实能力或明确不可用状态 | G0.4、P1.5、P3.4～P3.6、P4.1～P4.9 | DT-01～DT-16 |
| DP-04 | P0 | 真实 Token 账本、首页折线/热力图、顶栏用量/缓存/context | G0.2、P1.3、P5.1～P5.5 | DU-01～DU-12 |
| DP-05 | P1 | 安全、迁移、质量门、回滚和零 OMP 运行时依赖 | G0.1、G0.5、P1.4、P6.1～P6.5 | DQ-01～DQ-08 |

这些需求与 v2.3 的 NW/NL/WX/NM/NQ/NV 叠加执行。已有 WX 安全验收继续有效；本文件新增的是多宿主、多会话、工具服务与用量数据验收，不替换旧编号。

## 9. WBS 与阶段顺序

### G0：实施前基线冻结

| 任务 | 内容 | 依赖 | 交付物 | 完成定义 |
| --- | --- | --- | --- | --- |
| G0.1 | 登记脏工作树、现有构建入口和用户改动 | 计划批准 | 基线清单/哈希 | 实施前后可逐文件比对，不覆盖用户改动 |
| G0.2 | 冻结 Runtime/provider usage 实际字段与样本 | G0.1 | usage schema 证据 | 每个指标可追溯到真实回执；缺失字段明确标记 |
| G0.3 | 冻结窗口、浏览器、工具 owner 与 capability 契约 | G0.1 | 接口契约 | core/UI/Main/Renderer 字段一致，无第二状态源 |
| G0.4 | 验证语音 ASR 与 Computer Use 驱动可行性 | G0.1 | 能力探针报告 | 有真实可用路径才进入实现；否则保持 unsupported |
| G0.5 | 冻结快照、SSH、浏览器 partition 的安全模型 | G0.3 | 威胁模型/数据分级 | 凭据、截图、cookie、用户内容不进入布局和日志 |

退出条件：G0.2/G0.4 的外部能力缺口有明确结论；不要求现在安装依赖或执行真实写操作。

### P1：共享核心与原生桌面骨架

| 任务 | 内容 | 依赖 | 交付物 | 完成定义 |
| --- | --- | --- | --- | --- |
| P1.1 | 实现 WindowRef/HostLayout/window reducer | G0.3 | `windowModel.ts` | float/snap/group/minimize/native 不变量与历史通过 |
| P1.2 | 实现 SessionScope 与 ToolRegistry | G0.3 | scope/registry | session/draft/workspace 隔离、owner/lease/capability 可测试 |
| P1.3 | 实现 UsageEvent 与纯聚合 | G0.2 | usage core | 重复/修正/时区/缓存公式/context 测试通过 |
| P1.4 | 搭建 DSH Runtime/Window/Tool/Usage ports | P1.1～P1.3 | Renderer platform ports | 不 import OMP，不暴露通用 IPC |
| P1.5 | 接入 Files、Changes、Git 读模型、Terminal | P1.2、P1.4 | 基础工具面板 | 真实数据/写入回执/错误状态完整 |

退出条件：原生 renderer 可用真实会话与基础工具，不启动 OMP client/store。

### P2：多会话与统一窗口

| 任务 | 内容 | 依赖 | 交付物 | 完成定义 |
| --- | --- | --- | --- | --- |
| P2.1 | 每会话 document/toolLayout/toolInstances | P1.2、P1.5 | ConversationWorkspace | 两场会话并行，草稿/队列/审批/订阅互不污染 |
| P2.2 | 应用内 float/snap/group/minimize | P1.1、P2.1 | 统一窗口 UI | 6px 阈值、真实正文预览、取消/键盘/焦点通过 |
| P2.3 | 终端跨窗口持久化与 lease | P1.5、P2.2 | ToolInstanceRegistry | 同一 PTY 不因移动/最小化重建，owner 明确 |
| P2.4 | 会话工具集与借用 | P2.1 | Toolset editor | 只允许 capability 子集；跨会话移动有明确结果 |
| P2.5 | 多会话压力与断线回归 | P2.1～P2.4 | 回归报告 | 流式输出不串会话、不增订阅、不停止生成 |

退出条件：多会话并行和应用内窗口系统通过 DW/DS 基础验收。

### P3：真实系统窗口与托管浏览器

| 任务 | 内容 | 依赖 | 交付物 | 完成定义 |
| --- | --- | --- | --- | --- |
| P3.1 | Main 窗口服务、票据、窄 preload | P2.2 | workbench-windows | sender/URL/frame/TTL/ready/control 安全测试通过 |
| P3.2 | DOM document host 跨系统窗口 | P3.1、P2.3 | portal host | 同一正文节点、Composer/终端/焦点/选区保留 |
| P3.3 | 多显示器几何与启动恢复 | P3.1 | display/bounds service | 负坐标、DPI、拔屏、重启、任务栏状态恢复通过 |
| P3.4 | 多 tab 浏览器与 partition | P3.1 | browser-windows | 每 tab 稳定 webContents，登录空间按 owner 持久化 |
| P3.5 | 浏览器跨宿主 attach 与几何同步 | P3.2、P3.4 | browser host | 同 tab 跨窗口不重载，DOM/原生 view 边界正确 |
| P3.6 | DevTools、元素拾取、截图引用 | P3.4 | browser reference service | CDP 定位/截图/console/network 可追溯，字节走 artifact |
| P3.7 | Windows 双屏真机验收 | P3.1～P3.6 | 真机报告 | 独立任务栏图标、拖屏、恢复、崩溃回退实测 |

退出条件：DW 全绿，浏览器不是演示页，系统窗口不创建第二 Runtime。

### P4：高级工具

| 任务 | 内容 | 依赖 | 交付物 | 完成定义 |
| --- | --- | --- | --- | --- |
| P4.1 | Git 写服务与 Worktree | P1.5 | GitWritePort | stage/commit/worktree 操作有预检、确认、真实回执 |
| P4.2 | SSH/WSL launch profiles | P2.3、G0.5 | ssh-workspaces | host key/认证/超时/断线/日志脱敏通过 |
| P4.3 | MCP/Skills 原生只读管理 | P1.2 | capability panels | 展示真实来源/状态；无 profile API 时不提供假启停 |
| P4.4 | Agent Hub 原生星图 | P2.1 | AgentGraphPort | 主/子关系来自真实生命周期；缺失控制明确禁用 |
| P4.5 | BTW 独立旁路会话 | P2.1 | BTW panel | 来源引用、独立消耗、确认插入主 Composer |
| P4.6 | 语音输入 | G0.4、P2.1 | DictationPort | 真实音频→ASR→文本；权限/失败/隐私路径通过 |
| P4.7 | Computer Use | G0.4、P2.1 | ComputerUsePort | 捕获/定位/输入/审批/审计闭环；无驱动则未完成 |
| P4.8 | 评测工作区 | P1.5、P2.1 | EvaluationWorkspace | 命令、commit、fixture、日志、结果和重跑可关联 |
| P4.9 | Time Travel | G0.5、P2.1 | snapshot-service | transcript 时间线、manifest、恢复预览和显式恢复通过 |

退出条件：DT 全绿或明确记录外部能力阻塞；不得以“界面完成”替代后端完成。

### P5：真实用量与首页/顶栏

| 任务 | 内容 | 依赖 | 交付物 | 完成定义 |
| --- | --- | --- | --- | --- |
| P5.1 | Runtime/provider usage 回执接入 | G0.2、P1.4 | usage ingestion | 真实字段映射、幂等、partial/final/corrected 通过 |
| P5.2 | UsageLedger 持久化与恢复 | P1.3、P5.1 | ledger repository | 崩溃/重复/修正/备份/损坏/清除通过 |
| P5.3 | 首页折线图与热力图 | P5.2 | Usage dashboard | 年/月/周/日、模型分布、未知状态、键盘访问通过 |
| P5.4 | 对话顶栏本轮详情 | P5.1、P5.2 | TurnUsagePopover | input/output/cache/context/source/final 与首页一致 |
| P5.5 | 主/子 Agent/BTW 归属与对账 | P4.5、P5.2 | attribution report | 可归属/未归属清楚，总额与模型/日期聚合一致 |

退出条件：DU 全绿；真实回执缺失时显示未采集，不允许估算冒充精确值。

### P6：迁移、质量门与交付

| 任务 | 内容 | 依赖 | 交付物 | 完成定义 |
| --- | --- | --- | --- | --- |
| P6.1 | DSH v2/OMP 一次性布局迁移 | P2.2、P3.3 | migration report | 旧键只读，owner/实例/几何校验，损坏隔离 |
| P6.2 | 工具/窗口/usage 架构与安全门 | P1～P5 | check scripts | 无 OMP 运行时、宽 IPC、明文凭据、mock 业务数据 |
| P6.3 | 全量真实 Runtime 回归 | P6.1 | 回归报告 | 会话、附件、审批、停止、断线、工具与统计不回归 |
| P6.4 | 多屏/DPI/可访问/视觉回归 | P3.7、P5.3 | 验收报告 | v2.3 NV/NQ 与本文件 DW/DS/DT/DU 同时通过 |
| P6.5 | 回滚包与退出清单 | P6.2～P6.4 | rollback package | 功能/数据/代码回滚可演练；OMP 删除仍单独批准 |

退出条件：产品是 DSH 原生工作台；所有“已实现”均有源码与真机/真实数据证据。

## 10. 验收清单

### 10.1 窗口 DW

- [ ] DW-01 对话、DOM 工具、浏览器 tab 使用同一 WindowRef/reducer。
- [ ] DW-02 单面板和整组可在主区、侧栏、底栏、浮窗、标签和系统窗口间移动。
- [ ] DW-03 移动超过 6px 显示真实正文落点预览；pointerup 前不改真实布局。
- [ ] DW-04 Escape/pointercancel/blur 回滚，布局、正文、焦点、输入和 PTY 不变。
- [ ] DW-05 应用内最小化与系统最小化状态一致，Dock/任务栏入口正确。
- [ ] DW-06 每个系统窗口有独立任务栏图标，可拖到第二显示器。
- [ ] DW-07 主窗口和系统窗口的 normal bounds、displayId、DPI、最大化/置顶重启恢复。
- [ ] DW-08 拔屏、负坐标、分辨率变化后窗口仍可见可用。
- [ ] DW-09 系统窗口不创建第二 Runtime/client，不重复订阅或停止任务。
- [ ] DW-10 浏览器 tab 跨宿主保持 webContents/partition/历史，不重新登录。
- [ ] DW-11 票据过期、ready 超时、窗口崩溃有可见回退且不丢 content ID。
- [ ] DW-12 子窗口无 `dsh`、terminal、文件或通用 invoke 暴露面。

### 10.2 多会话 DS

- [ ] DS-01 至少两场 session 与两个 draft 可并行流式输出。
- [ ] DS-02 每场对话有独立 Composer、队列、审批、工具布局和工具实例。
- [ ] DS-03 Terminal、浏览器登录空间、SSH、Computer Use 默认不跨会话共享。
- [ ] DS-04 Files/Changes/Git 共享读取有 lease；写操作带 owner 和确认。
- [ ] DS-05 跨会话移动独占工具时明确“移动归属/新建实例”，无隐式共享。
- [ ] DS-06 workspace/application Pin 借用重新校验 workspace/capability。
- [ ] DS-07 同一 session 多 view 共享业务状态，但可停靠不同工具布局。
- [ ] DS-08 草稿转正 session 保留草稿与布局，不复制运行中 PTY。
- [ ] DS-09 关闭视图不取消 Runtime 任务；最后 lease 释放后才退订。
- [ ] DS-10 恢复/预设/最近关闭重新过滤 owner 与 capability，无悬空引用。

### 10.3 工具 DT

- [ ] DT-01 Files 真实读写、冲突、版本检查和错误状态通过。
- [ ] DT-02 Changes/Git 读模型与提交图真实；写操作有真实回执。
- [ ] DT-03 Worktree list/create/lock/unlock/remove/prune 与脏工作区保护通过。
- [ ] DT-04 Terminal/WSL profile、scrollback、退出和跨窗口保留通过。
- [ ] DT-05 SSH host key、认证、超时、断线和敏感日志脱敏通过。
- [ ] DT-06 浏览器多 tab、前进后退、下载、导航与权限策略通过。
- [ ] DT-07 DevTools、元素定位、截图引用和 artifact receipt 可追溯。
- [ ] DT-08 owner partition 的登录状态持久化，借用与清除需明确授权。
- [ ] DT-09 Computer Use 的捕获/定位/输入/审批/审计真实闭环。
- [ ] DT-10 MCP/Skills 展示真实 profile/capability，不提供越权启停。
- [ ] DT-11 Agent Hub 星图的主/子关系来自真实生命周期与 transcript。
- [ ] DT-12 BTW 使用独立会话和来源引用，确认后才插入主 Composer。
- [ ] DT-13 语音输入有真实音频与 ASR 结果，权限和失败状态可见。
- [ ] DT-14 评测工作区关联命令、commit、fixture、日志、结果并支持重跑。
- [ ] DT-15 Time Travel 有真实时间线、快照 manifest、恢复预览与显式恢复。
- [ ] DT-16 所有工具具备 ready/empty/unavailable/not-implemented 状态，无 mock 业务数据。

### 10.4 用量 DU

- [ ] DU-01 UsageEvent 来自真实 provider/Runtime 回执，字段有 schema 证据。
- [ ] DU-02 重复通知幂等，partial/final/corrected 不重复累计。
- [ ] DU-03 input/cache/reasoning/output 不重复计数，缓存率公式可复算。
- [ ] DU-04 context 显示 used/window/source/observedAt，异常不静默截断。
- [ ] DU-05 年/月/周/日聚合和时区/周边界测试通过。
- [ ] DU-06 首页折线图、热力图、模型图例和总额来自同一 query。
- [ ] DU-07 顶栏显示本轮用量、缓存命中、context、模型和 final 状态。
- [ ] DU-08 主/子 Agent/BTW 用量可归属，未归属单独显示。
- [ ] DU-09 未知数据显示未采集，不显示为 0，不用估算冒充分账。
- [ ] DU-10 账本崩溃恢复、备份、损坏、保留期和清除通过。
- [ ] DU-11 键盘/hover/focus 可读取图表，颜色不是唯一信息通道。
- [ ] DU-12 统计不存储或上报 prompt、回复、终端内容、密钥或 cookie。

### 10.5 公共质量 DQ

- [ ] DQ-01 生产源码/bundle 无 OMP import、全局桥、mock 运行时和旧存储写入。
- [ ] DQ-02 core 零 React/DOM/Electron/Runtime 依赖，端口边界可独立测试。
- [ ] DQ-03 所有写操作有 owner、能力、确认、审计和真实回执。
- [ ] DQ-04 所有跨窗口移动保持唯一性，不重复 panel/tool/session 实例。
- [ ] DQ-05 凭据、cookie、截图、录音和用户内容不进入布局、日志、错误上报。
- [ ] DQ-06 迁移、备份、回滚和损坏恢复可重复执行。
- [ ] DQ-07 Windows 真机、真实 Runtime、多屏/DPI 与既有 NV/NQ 回归通过。
- [ ] DQ-08 需求→WBS→验收→证据闭环，未验证项单独列出。

## 11. 风险与处置

| 风险 | 等级 | 触发条件 | 处置 |
| --- | --- | --- | --- |
| Runtime 无真实 usage 字段 | 高 | provider 只返回文本或缺失 cache/context | G0 先取真实样本； additive envelope 单独评审；缺字段显示未采集 |
| Computer Use 无可用 Windows 驱动 | 高 | 无法取得受控输入/可访问性树 | 能力 spike 未通过则不宣称完成；保持 unsupported，不用模拟点击替代 |
| 语音 ASR 服务未确定 | 高 | 无 provider/协议/凭据/隐私方案 | 先实现 provider port 与不可用态；服务确定前不接入第三方，不伪造听写 |
| DOM 与 WebContentsView 跨宿主组合复杂 | 高 | 浏览器成组、缩放、DPI 下几何错位 | Main 统一 attach 和 DIP 几何；先做单 tab 跨宿主，再扩多 tab；保留崩溃回退 |
| 多会话工具越权共享 | 高 | owner 丢失或 Pin 借用绕过 capability | 独占资源默认 owner-bound；借用重新鉴权；所有恢复重新过滤 |
| 系统窗口安全暴露面扩大 | 高 | 子窗口继承宽 preload 或任意导航 | 最小子 preload、票据绑定 sender/frame/URL、禁通用 invoke、外部协议默认拒绝 |
| 多显示器恢复坐标失效 | 中 | 拔屏/重排/DPI 变化 | displayId + workArea 校正，保存 normal bounds，真机演练 |
| 终端/SSH 生命周期泄漏 | 中 | 关闭窗口不 dispose 或重连重复创建 | stable instanceId、lease、sender 校验、最后引用释放、诊断计数 |
| Time Travel 恢复破坏脏工作区 | 高 | 快照覆盖未提交修改或 untracked 文件 | touched-file manifest、恢复预览、冲突检查、显式确认；优先恢复到新 Worktree |
| 用量重复/修正导致总额漂移 | 高 | 重放通知、迟到 final、重复轮询 | eventId/revision 幂等，ledger 唯一约束，聚合对账测试 |
| 工具状态被误当执行权限 | 高 | 前端禁用被当成 Runtime 安全边界 | capability 以 Runtime 为权威；工具集只做允许子集，不声称替代策略执行 |
| OMP 代码被复制成长期兼容层 | 高 | 新原生模块 import OMP store/type/runtime | 架构门禁；只迁移纯数据与已验证行为；旧入口退出单独批准 |

## 12. 默认决策与待确认边界

### 12.1 本轮默认决策

1. 继续使用 DSH 原生 `apps/renderer`，不继续扩展 `renderer-omp` 产品入口。
2. 新增一个统一窗口 reducer；内部浮窗和系统窗口不是两套产品。
3. 多会话的工具布局、工具实例和执行权限分层处理，不用前端状态冒充 Runtime 权限。
4. 浏览器使用 Electron 原生多 view + owner partition；DOM 面板使用 document host。
5. 统计只使用真实 usage 回执；历史缺失保持未知。
6. SSH/WSL 优先复用系统程序与 node-pty；Git 写操作使用受控参数化 CLI，不拼接 shell 字符串。
7. 快照恢复优先在新 Worktree 预览和执行；当前工作区覆盖需逐次明确确认。
8. 不在本方案阶段安装依赖、修改 Runtime 协议、执行真实 Git 写操作或删除 OMP。

### 12.2 实施前必须关闭的外部边界

- Runtime/provider usage 回执是否提供 input/output/cache/context；不提供时需批准 additive telemetry 改造。
- 语音输入使用哪个 ASR provider、音频保存在哪里、保留多久；未确定前只能交付不可用态。
- Computer Use 的 Windows 驱动方案与权限模型；未通过 spike 前不能承诺完整工具闭环。
- Time Travel 若要求“当前会话分叉/回滚”，需 Runtime 提供 fork/restore；仅有 transcript 与 Worktree 不能冒充该能力。

### 12.3 授权边界

当前已完成只读源码审计和评审方案，未修改生产源码，未安装依赖，未执行构建、测试、Git 写操作、提交、推送或发布。收到明确批准后，先执行 G0；G0 的外部能力结论可能调整 P4/P5 排期，但不得降低验收或改用假数据补齐。
