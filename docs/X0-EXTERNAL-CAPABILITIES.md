# X0 外部能力门与降级契约

- 日期：2026-11-24
- 范围：Computer Use、语音输入/实时语音、SSH/WSL、MCP/Skills、Agent Hub、BTW、评测、fork/restore/time travel、浏览器与模型目录等宿主外部能力。
- 结论：**能力矩阵与拒绝契约已建立，XG0 仍未通过**。本文区分“协议存在”“磁盘可发现”“配置已声明”“运行时已加载/连接”“本次调用已执行”，禁止跨级推断。

## 标准构建与外部能力补充（2026-11-25 · 当前结论）

构建/打包依赖已按用户授权安装，默认压缩 Renderer 与完整 `npm run check` 已通过，标准 NSIS x64 安装包已完成隔离安装和核心真机冒烟。E-04 的默认压缩构建缺口已关闭；该结果不实现或替任何 E-05 外部适配器，也不把 MCP/Skills 的 `configured` 状态升级为 `connected`。

E-05 仍是“代码/契约层已关闭，真实能力未关闭”：ASR 音频适配器、Evaluation judge/评分集/provider、MCP 运行时客户端与 Agent 控制适配器仍不存在，真实权限、预算、费用确认与 provider 回执仍缺。标准安装版 BrowserView 已通过 3 轮独立资源回收与虚拟音频/视频权限拒绝回归；该探针未改包体，也未开放生产浏览器 IPC 门。双屏、物理摄像头/麦克风、Windows 权限弹窗、生产持久登录、代码签名与真实自动更新升级仍未验证。XG0 仍未通过，X1 未开始。

## 1. 状态词定义

| 状态 | 含义 | 是否允许呈现为可用 |
|---|---|---|
| `implemented` | 当前 Desktop 有真实适配器，且有本次运行证据 | 是，但只能陈述已验证范围 |
| `limited` | 有真实通道，但语义不等价或缺少部分生命周期 | 可以显示，但必须同时显示限制 |
| `configured` | 只在磁盘/profile 中发现声明 | 否；不得显示 connected/loaded/已加入会话 |
| `preview_only` | 数据来自 fixture 或演示交互 | 否；必须明显标为预览 |
| `unsupported` | 上游协议/宿主明确不提供该语义 | 否；命令返回明确失败 |
| `not_implemented` | 当前 Desktop 没有适配器 | 否；不得用本地假数据填补 |
| `unavailable` | 协议或适配器存在，但当前权限、进程、配置或设备不可用 | 否；给出前置条件和恢复路径 |
| `unknown` | 当前证据不足以判断 | 否；不得默认成功或默认失败为“未配置” |

“空数组”只表示已成功查询且结果确实为空，不表示能力不可用；“completed”只表示命令自身完成，不表示外部副作用或测试通过。

## 2. 当前能力矩阵

| 能力 | 当前状态 | 真实证据与边界 | 用户可见行为 / 门禁 |
|---|---|---|---|
| 本地 WSL 终端 | `implemented` | `apps/desktop/src/terminal-service.js` 启动真实 `wsl.exe` + `node-pty`；native/OMP 共用 Registry；Registry 释放探针 OS 存活 2→0；loopback 关窗代理进程 6→0；便携生产包与标准安装版均完成 PTY ready/write/resize/kill 与 OS PID 退出 | 可用；按 owner 校验 write/resize/kill/dispose；标准安装版已验证 |
| SSH / Remote 工作区 | `not_implemented` | preload 未暴露 `ompStudioRemote`；`workspaces/ExecutionTargets.tsx` 读取不存在的 API | 禁用；不得声称已连接远端 |
| SSH 准备流程 | `not_implemented`（生产）/ `preview_only`（独立 harness） | `workspaces/SshPreparationDialog.tsx` 只有 UI 文案，没有同步模型/API Key 的真实执行链；生产 Vite alias 整模块替换为禁用提示 | 生产标为未实现且不出现准备步骤；仅独立预览 harness 可展示 fixture；不得读取或上传凭据 |
| Computer Use | `not_implemented`（生产）/ `preview_only`（独立 harness） | `preview/computerPreview.ts` 返回 `available:true`、权限 granted 与截图 fixture；preload 无 Computer API；生产 alias 排除 fixture 与 native tool gallery | 生产入口禁用；仅独立预览 harness 可展示 fixture，且强制预览标识；fixture 不得计入能力验收 |
| 语音输入（无音频 API） | `unavailable` | `composer/dictationSession.ts` 在缺少 `ompStudioChrome` 音频能力时进入 review，不录音；Bridge 对 `dictation.*` 七个入口统一前置拒绝；fake-device 媒体探针只验证权限拒绝，不提供音频 API | 说明缺少宿主音频接口；不伪造转写，不把输入转成普通 prompt |
| 云 ASR / 模型下载 | `not_implemented` | `composer/dictationClient.ts` 只有客户端同意逻辑；Bridge 没有已核验的 Desktop 音频→ASR 适配器，`dictation.inspect/open/status/prepare/start/stop/cancel` 均回 `CAPABILITY_UNAVAILABLE` | 不发起识别、不下载模型、不计费；需用户明确同意与真实适配器 |
| 实时语音 / WebRTC | `unsupported` | Bridge `live.webrtc.*` 明确不可用；DSH SDK 无对应服务 | 明确失败；不得用 TTS 冒充实时对话 |
| fork | `unsupported` | SDK 白名单无 fork；Web descriptor 有 `session/fork` 但 Desktop 未接 | `CAPABILITY_UNAVAILABLE`；Web 端点只登记为后续候选 |
| restore / time travel | `unsupported` | Bridge timeline/settings/storage/restore 全部明确拒绝；SDK 无快照/工作区回滚方法 | 明确失败；不得仅恢复消息而声称恢复工作区 |
| 运行中 steer | `unsupported` | SDK `session/query` 无 `mode`；`core.steer` 已回 `CAPABILITY_UNAVAILABLE` | 不发送 prompt，保留本地输入 |
| Runtime 队列读取/编辑 | `unsupported` | SDK 无队列读取/mutation；`session.queue.list` 已回 `CAPABILITY_UNAVAILABLE` | 不显示“Runtime 队列为空”；本地待发送队列单独命名 |
| 取消当前 turn | `unsupported` | SDK 白名单无 cancel；`core.abort` 回 `UNSUPPORTED` | 不显示 stop accepted；不承诺取消即停止计费 |
| MCP 配置清单 | `configured` | `dsh-assets.js` 优先解析当前 `dsh-mcp-client` 插件注册，安全投影 name/transport/enabled/status；无连接、认证或健康检查 | enabled/disabled 只表示 profile 配置；未知 transport fail closed；client 未挂载时不标 enabled；不得显示 connected |
| MCP 启停 / 测试 / 日志 | `not_implemented` | Bridge `mcp.refresh`、`mcp.setEnabled`、`mcp.setInstructions`、`mcp.test`、`mcp.logs.get` 明确不可用；Web `mcpManager/*` 未接 | 明确失败；不得自动启动服务器或调用工具 |
| Skills 文件清单 | `configured` | `scanSkills()` 扫描文件并解析 frontmatter；SDK 无技能查询 | 显示“已发现”；`loaded:false`、`session:false`；enabled 仅由 user-invocable 控制调用面，不等于 Runtime 已加载或已加入会话 |
| 会话 Skills 身份清单 | `unsupported` | `session.skills.list` 无 SDK 适配器，已改为明确 `CAPABILITY_UNAVAILABLE`；不再回传磁盘扫描结果 | 技能抽屉、能力页和提及候选使用 configured 读模型；不得标记 loaded/session 或“已加入” |
| Skills 运行时启停 | `not_implemented` | `skills.setEnabled` 明确不可用；技能调用由 DSH tool-skill 决定 | 明确失败；不得仅改本地布尔值后声称已生效 |
| Plugins / Tools 清单 | `configured` | `dsh --profile sdk --dump-config` 提供插件树；工具目录来自配置 | 显示 configured；配置启用不等于本次 Runtime 已完成注册 |
| Agent Hub 关系投影 | `implemented` | SDK `subagent.started` / `subagent.finished` 提供 child ID、状态、摘要 | 可展示真实派生关系；不虚构 roster |
| Agent send / kill / revive | `unsupported` | Bridge `agent.send`、`agent.kill`、`agent.revive` 明确不可用；Web `subagents/*` 未接 | 明确失败；不发送控制指令 |
| BTW 旁路追问 | `not_implemented` | 只有遗留协议类型，没有 DSH 适配器；`/btw` 最终未知能力失败 | 禁用；不得回落为普通 prompt 后宣称 BTW |
| Evaluation 测试投影 | `limited` | 只识别 bash/powershell argv 中的测试命令，不解析 runner stdout；无 exitCode 的终态为 `unknown` | 显示命令与真实退出码；没有退出码不得判 pass |
| Evaluation judge / 基准评测 | `not_implemented` | 当前没有已核验的 judge、评分集或 provider 调用链；Bridge 对 `evaluations.*` 13 个入口与 `benchmarks.*` 6 个入口统一前置拒绝，能力清单均为 `unavailable` | 不执行、不计费；不得返回模拟分数、空成功或把 spec 转成普通 prompt |
| 模型目录刷新 | `limited` | Bridge 可读取 DeepSeek Key 并请求官方模型列表；属于真实外部请求 | 仅在用户主动刷新时调用；不打印 Key，不承诺其他 provider 已同步 |
| 托管浏览器 | `not_implemented`（安全门） | B-T01～B-T10 生产控制已接线；26 项安全单测、真实 Electron 拒绝、真实 React 外链点击、标准安装版 BrowserView 3 轮资源回收、fake-device 权限拒绝与生产包 DevTools/外链拒绝通过 | 保持禁用；探针未开放 `browser:*` preload。持久登录入口、真实媒体设备与系统权限弹窗仍未覆盖 |
| 普通模型 prompt | `limited` | `session/query` 返回 durable enqueue receipt，完成来自后续 `session.event` | 可发送；receipt 不得显示为 turn 已完成；可能产生 provider 费用 |

## 3. 已修复的“假成功 / 假空结果”

| 缺陷 | 修复 | 回归 |
|---|---|---|
| `session.resume` 失败仍回 `completed` | Runtime 接受后才切 context；`conversation.open` 等待恢复成功；失败回 `failed / UNAVAILABLE`，不发目标 snapshot；切换后取消旧会话孤儿审批 | `runtime-capabilities.test.mjs` 前 2 项、审批切换回归 |
| `core.steer` 退化为普通 query | 拆出命令分支，明确 `CAPABILITY_UNAVAILABLE`，不调用 query | `runtime-capabilities.test.mjs` 第 3 项 |
| 缺失/未知审批 decision 默认放行 | 仅接受 `submit\|cancel`；畸形输入回 `INVALID_ARGUMENT`，不响应 Runtime，随后合法请求仍可结算一次 | `runtime-capabilities.test.mjs` 畸形 decision 回归 |
| `models.adaptation.resolve` 无适配层仍假成功 | 明确 `CAPABILITY_UNAVAILABLE`，不解析或应用模型选择，不调用 Runtime query | `runtime-capabilities.test.mjs` adaptation 回归 |
| `session.queue.list` 固定返回空 | 明确 `CAPABILITY_UNAVAILABLE` | `runtime-capabilities.test.mjs` 第 3 项 |
| capability manifest 未分级 | steer/queue read 为 `unavailable`；普通 query 近似为 `limited` | `runtime-capabilities.test.mjs` 第 4 项 |
| 测试工具终态但无 exitCode 默认 pass | 新增 `unknown`；只有显式 exitCode 0 为 pass | `agentTestRuns.test.ts` 已纳入标准 Vitest；`studio:test` 525/525 通过 |
| MCP 配置被当成已启用，未知 transport 回落为 stdio | 解析当前插件注册；仅从显式 transport/command/url 推断旧格式；未知 transport 不执行连接；未挂载 client 不标 enabled；不产生 connected | `dsh-assets.test.mjs` 后 2 项；`runtime-capabilities.test.mjs` 后 2 项 |
| Skills 磁盘发现被当成 loaded/session | `skills.get` 保持 `loaded:false`、`session:false`，enabled 仅由 user-invocable 投影；`session.skills.list` 明确拒绝磁盘结果冒充运行时身份；UI 三个消费点改用 configured 读模型 | `runtime-capabilities.test.mjs` 第 5、6 项；`extensibilityMap.test.ts` 第 1 场景 |
| Plugin configured 被显示成 loaded 并计入已加入 | 保留原始 configured 状态；仅 loaded 且启用才计入 added | `extensibilityMap.test.ts` 第 2 场景 |
| 生产 URL/本地存储可开启 preview | 普通入口只接受显式 `<App preview />`；query 仅为 test seam；生产构建静态移除；预览标识不可由 `marks=off` 关闭 | `production-preview-boundary.test.mjs` 第 4 项；`PreviewContext.test.tsx` 4 场景已纳入标准 Vitest |
| Computer/SSH/BTW fixture 进入生产导入闭包 | 六类外部能力模块使用生产 Vite alias；独立 harness 是唯一关闭边界的构建配置；修复 Vite 8 正则 alias 只消费尾部斜杠、导致绝对替换前残留 `./` 的缺陷 | `production-preview-boundary.test.mjs` 前 3 项与完整 specifier 回归，6/6；真实非压缩生产构建确认六类 fixture 不在产物 |
| 独立浮窗丢失预览标识 | 主文档属性同步到 float 根，并用独立 CSS `::after` 强制标识 | `production-preview-boundary.test.mjs` 第 5 项；`NativeFloat.test.tsx` 1 个行为已纳入标准 Vitest |
| `/btw`、`/computer` 回落普通 prompt | catalog 隐藏、planner/execute/Workbench 多层拒绝；拒绝先于排队、审批 steer、创建会话和清空草稿；follow-up 与排队立即纠偏也先拒绝、再执行任何草稿/队列/审批副作用；保留原 snapshot | `external-slash-boundary.test.mjs` 7 项；`App.modelSelection.test.tsx` 2 个 Workbench 场景已纳入标准 Vitest |
| E-05 外部控制只有通用兜底、未在能力清单分级 | 34 个 dictation/evaluations/benchmarks/MCP/Agent 控制入口在 query 与 command 分支前统一拒绝；全部分级 `unavailable`，回 `CAPABILITY_UNAVAILABLE`，不返回 result，不调用 Runtime query/fetch，不修改输入 | `runtime-capabilities.test.mjs` 后 4 项：34 查询 + 34 命令均无外部调用，manifest 34/34 为 unavailable |

## 4. 最小“不支持”契约

查询失败与命令失败都必须可机器识别。现有 Bridge 使用 `CAPABILITY_UNAVAILABLE` / `UNSUPPORTED` / `UNAVAILABLE`；新增跨面板能力应统一投影为以下最小结构，不得只返回空数据：

```ts
{
  capability: string;
  availability: "not_implemented" | "unsupported" | "unavailable";
  adapter: {
    kind: "desktop" | "runtime-sdk" | "preview";
    protocol?: string;
    evidence: string;
  };
  reason: { code: string; message: string };
  prerequisites: string[];
  retryable: false;
  outcome: "not_attempted";
  sideEffects: { performed: false; cost: "none" };
}
```

规则：

1. 查询不得把“不支持”伪装成 `servers: []`、`skills: []`、`entries: []` 或 `available:false` 的成功结果；必须同时给 `unavailableReason` 或 typed error。
2. 命令可以先 accepted，但最终回执必须 `failed`；未尝试外部副作用时 `outcome` 必须是 `not_attempted`。
3. UI 必须保留原始输入，不得因拒绝而清空草稿或静默改成另一条 prompt。
4. 不得用 preview、fixture、本地缓存或旧 OMP 桥接层冒充生产能力。
5. 能力恢复必须由真实探活/连接结果驱动，不得由用户手动勾选布尔值驱动。

## 5. 凭据、隐私与费用边界

- Main 可读取凭证引用名和值并写入 DSH 凭证文件；UI 不得显示值，诊断/录制必须脱敏。
- 刷新 DeepSeek 模型目录会发送带 Key 的官方外部请求；只能在用户主动刷新时执行。
- 普通 prompt 会向 provider 发送用户内容，可能计费；入队回执不是免费或完成承诺。
- 云 ASR、BTW、Evaluation judge、MCP 工具调用、Agent 控制均可能产生费用或外部副作用；未实现时不得代为执行。
- SSH 同步、远端命令、浏览器登录空间、MCP header/env 均属于敏感边界；未授权时不读取、不上传、不代登录。
- 用户授权一次能力调用，不等于授权后续自动重试、批量调用或跨会话复用凭据。

## 6. XG0 阻塞项

| 编号 | 状态 | 事项 / 关闭证据 |
|---|---|---|
| E-01 | 已关闭 | MCP 按当前插件注册解析 transport/disabled；未知 transport fail closed；client 未挂载不标 enabled；不推断 connected。见第 3 节及能力回归 |
| E-02 | 已关闭 | Skills 保持 configured 与 loaded/session 分离；`session.skills.list` 明确拒绝；enabled 仅表示 user-invocable，UI 不显示已加载/已加入 |
| E-03 | 已关闭 | Plugin 保留 configured 状态，不映射为 loaded，也不计入 added；2 个投影场景通过 |
| E-04 | 已关闭 | 六类 fixture 已由生产 alias 与默认压缩 Vite build 排除；普通入口不能由 URL/存储开启 preview；外部斜杠命令在副作用前拒绝；标准 Vitest 525/525、alias 6/6、`npm run check` 198/198 与标准安装版构建通过。无构建缺口；`ExecutionTargets.tsx` 仍有遗留远端 UI，但无真实 remote API，不宣称 SSH 已实现 |
| E-05 | 代码/契约层已关闭；真实能力未关闭 | 34 个外部控制入口已统一前置拒绝、分级 `unavailable` 并完成 68 次无副作用调用回归。云 ASR 音频适配器、Evaluation judge/评分集/provider、MCP 运行时客户端与 Agent 控制适配器仍不存在；需真实适配器、provider、凭据、权限、预算、费用确认与回执。安装包通过不代表这些能力已实现 |
| E-06 | 未关闭 | 浏览器安全控制已接线；26/26 单测、真实 Electron 拒绝、真实 React 外链点击、fake-device 权限拒绝、持久 partition 重启、标准安装版 DevTools/入口/危险外链拒绝/Runtime/PTY 关窗清理通过。安装版 BrowserView 另完成 3 轮资源回收，Renderer PID 全退出、13 类监听器归零、WebContents 回基线；虚拟音频/视频 `getUserMedia` 均返回 `NotAllowedError`。生产持久登录入口、真实媒体设备与系统权限弹窗、双屏仍未完成。见 `X0-BROWSER-THREAT-MODEL.md` 与 `X0-BASELINE.md` |

## 7. 验收记录

- Runtime / MCP / Skills / E-05 能力回归：**15/15 通过**。
- 完整 `npm test`：**198/198 通过，0 失败**；其中浏览器安全 **26/26**、Renderer 链接安全 **8/8**、外部斜杠边界 **7/7**、生产 preview 边界 **6/6**；浏览器与链接聚焦合计 **34/34**。
- 标准 `npm run studio:test`：**38 个文件、525/525 通过**；`studio:typecheck` 与 `studio:build` 通过（`lib/client.js` 220.9 KB）。架构检查扫描 1151 个文件、7 组规则；入口检查 renderer 79 queries / 97 commands，bridge 99 cases / 124 explicit reasons，均 PASS。
- `PreviewContext.test.tsx` 4 个场景、`NativeFloat.test.tsx` 1 个行为、测试结果投影 3 个场景、扩展状态投影 2 个场景均已纳入标准 Vitest；不再以 Node 类型剥离或直接函数执行替代标准测试。
- 浏览器安全：`browser-security.test.mjs` **26/26 通过**；真实 Electron **45.4.1** 探针确认 session 隔离、无 Node/桌面全局对象、真实跨域重定向 1、iframe 1、BrowserView 远程主导航 1、主窗口远程主导航 1、下载 1/1、popup 1、DevTools 打开后关闭、可信 IPC 成功而 foreign/child IPC 拒绝、workspace B/default session 存储为空、主窗口 hide/show 3 轮后 view 保持安全、renderer crash 后销毁。4 个危险 scheme 与 2 个主窗口远程导航事件的合成分派均被拒绝，与真实导航证据分开计数；3 轮独立 BrowserView 创建/关闭的 Renderer OS PID 均退出、监听器为 0、WebContents 回基线。
- Renderer 外链：`renderer-link-safety.test.mjs` **8/8**；真实 React 19 + Windows 可信点击确认合法 HTTP(S)/mailto 到达语义桥，危险链接为 inert `SPAN`，调用方 `preventDefault` 可阻止重复打开，主窗口导航与新 Electron 窗口均为 0。该链路未实际启动系统浏览器或邮件客户端，BrowserView popup 仍为拒绝策略。
- 媒体权限：fake-device 下 `getUserMedia` 到达权限 handler 并返回 `NotAllowedError`，证明 fail-closed 与不自动授权；这不是摄像头/麦克风采集或 Windows 系统权限弹窗验收。Windows PnP 核查为 0 摄像头、0 麦克风端点。
- RuntimeClient 生命周期：fake ChildProcess 回归 **9/9**，覆盖 spawn error 清理与重启、stdin EPIPE fail-closed、旧 generation exit 隔离、stop 等待退出、拒退出超时终止；`runtime-lifecycle-probe.mjs` 另以真实 SDK 连续两轮验证正常 initialize/shutdown/restart 与 OS PID 退出，pending 与 prompt 均为 0。真实拒退出/超时仍未覆盖。
- 真实 PTY：`terminal-process-probe.cjs` 在 Electron 45.4.1 中启动 Ubuntu/qtt199 的 native/OMP 两个 WSL PTY，ready 标记均到达；foreign write/dispose 被拒；Registry 释放后 OS 存活进程 2→0、Registry 2→0。`desktop-lifecycle-probe.mjs` 进一步以真实 Main + loopback 测试页完成 Runtime ready、两个 PTY ready、关窗、Electron 退出码 0 与 Runtime/PTY 代理 OS 进程 6→0。
- 便携生产包（历史）：现有 Electron 45.4.1 发行目录 + ASAR + 非压缩生产 Renderer + 解包 node-pty。真实 `file://` 页面加载，Runtime ready，Files/Git 读取、生产原生 PTY ready/write/resize/kill、DevTools 拒绝、非法外链拒绝、Renderer 重载与关窗后全部跟踪进程退出均通过。该包不是标准安装包；其结论已由下方标准安装版补充，但便携包保留作历史证据。
- 标准安装版（2026-11-25）：electron-builder NSIS x64 生成、隔离安装退出码 0；真实 `file://` Renderer、Runtime ready、Files 2 项、临时真实 Git 仓库 status 1 项、PTY 输出/resize/kill/PID 退出、重载、危险外链拒绝、DevTools 拦截、0 Renderer exception/console error、关窗退出码 0 与 15 个跟踪子进程全部退出通过。证据为 `F:\workbuddy data\deliverables\dsh-studio\standard-package-20261125\evidence\installed-app-smoke.json` 与 `installed-app.png`。
- 安装版 BrowserView（2026-11-25）：未改动的安装包 `main.js` 经临时主进程调试作用域调用现有浏览器处理器，不增加生产 `browser:*` preload API；3 轮创建/导航/重载/销毁后 Renderer OS PID 全退出、13 类监听器归零、WebContents 回基线，Runtime 保持 ready。popup、DevTools 与 `javascript:`/`data:`/`file:` 导航拒绝；fake-device 音频/视频输入可枚举，`getUserMedia` 均返回 `NotAllowedError`；退出码 0、10 个跟踪子进程全部退出。证据为交付目录 `evidence/installed-browser-probe.json`、`installed-browser-probe.log`、`dsh-installed-browser-probe.mjs` 与 `installed-browser-view.png`。这不等于生产浏览器入口开放，也不等于物理媒体或 Windows 权限弹窗通过。
- 未执行任何云 ASR、MCP 连接、SSH、Computer Use、provider 模型刷新、Agent 控制或付费评测。E-05 回归以 34 个入口分别走 query 与 command，共 68 次调用：Runtime query 与 fetch 均为 0，命令均无 result，冻结输入保持不变，能力清单 34/34 为 `unavailable`。
- 未把 Web descriptor 的潜在端点计入 Desktop 已实现能力。
- 默认压缩构建已恢复：WSL 主 Renderer 29 modules、OMP 3082 modules，Windows 打包 OMP 3123 modules；完整 `npm run check` 198/198 通过。2026-11-24 的 LightningCSS 缺失记录为历史状态。
- `ExecutionTargets.tsx` 仍在生产导入图中，并含遗留远端 UI 分支；当前 preload 未暴露真实 remote API，本批只隔离 SSH 准备/picker fixture，不宣称完整 SSH 代码已从生产 bundle 排除，更不宣称 SSH 已实现。
- XG0 保持未通过；E-05 真实外部适配器/权限/费用/回执、E-06 剩余覆盖、双屏与物理媒体真机、真实 Runtime 拒退出/超时、代码签名与真实自动更新升级关闭前，不进入 X1 外部能力生产实现。
