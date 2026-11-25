# 二次开发修改追踪

## 项目列表

| 项目 | 原始仓库 | 集成方式 | 上游分支 | 基线 | 本地目录 | 最后同步 |
| --- | --- | --- | --- | --- | --- | --- |
| omp-studio | https://github.com/the-snowpear/omp-studio | 参考树 + 按文件采纳 | main | v0.2.8（commit 待补） | apps/renderer-omp + vendor/omp | 未同步（快照待拉取） |

## 约束

- 以 DSH 为唯一核心事实源；保留 omp-studio 的 UI/交互特性，但不伪造 DSH 不存在的数据。
- 上游代码只做只读参考（`upstream/omp-studio/`），不参与构建。
- 禁止整仓 subtree 合并；每次只采纳指定文件，并登记到 `dsh-overlay.json`。
- 与本地改动冲突时暂停并交用户确认，禁止自动解决。
- 契约新增集中在 `apps/renderer-omp/src/dsh/`，禁止直接修改 `vendor/omp`。

## 修改记录

### 运行时与桥（DSH 核心）

| ID | 日期 | 文件 | 类型 | 说明 | 上游影响 |
| --- | --- | --- | --- | --- | --- |
| M001 | 2026-11-22 | apps/desktop/src/studio-bridge.js | 修改 | 把 OMP query/command 契约翻译成 DSH 能力；假数据清零；模型目录与运行时状态接入 | 高：上游契约新增时需复核 case 映射 |
| M002 | 2026-11-22 | apps/desktop/src/main.js | 修改 | 无 dev URL 时直载 renderer-omp 构建产物；窗口生命周期日志 | 低 |
| M003 | 2026-11-22 | apps/desktop/src/preload.cjs | 修改 | 暴露 window.dshStudio 与多会话 PTY（ompStudioTerminal） | 中：终端接口名仍沿用上游 |
| M004 | 2026-11-22 | packages/host-services/src/index.js | 修改 | 会话读写/删除、系统文件、Git、凭证、会话运行时状态折叠 | 低（不属于上游） |
| M005 | 2026-11-22 | packages/host-services/src/dsh-assets.js | 新增 | 插件树/内置命令/工具/MCP/技能根/profile 的只读资产索引 | 低 |
| M006 | 2026-11-22 | packages/host-services/src/dsh-models.js | 新增 | 从 DSH 安装目录读取 llm-deepseek 内置模型表 | 低 |

### 渲染层接缝

| ID | 日期 | 文件 | 类型 | 说明 | 上游影响 |
| --- | --- | --- | --- | --- | --- |
| M010 | 2026-11-22 | apps/renderer-omp/src/main.tsx | 修改 | 客户端创建改为 createDshStudioClient | 高：上游入口改动需重新适配 |
| M011 | 2026-11-22 | apps/renderer-omp/src/dsh/client.ts | 新增 | DSH 传输客户端 | 低 |
| M012 | 2026-11-22 | apps/renderer-omp/src/dsh/read-models.ts | 新增 | DSH 专属读模型（SessionRuntimeState 等），不再改 vendored 契约 | 低 |
| M013 | 2026-11-22 | apps/renderer-omp/src/dsh/queries.ts | 新增 | DSH 扩展查询的类型化入口 | 低 |
| M014 | 2026-11-22 | apps/renderer-omp/src/runtimeState/RuntimeStateDock.tsx | 新增 | 运行时状态面板（权限/模型/目标/用量/命令史） | 低 |
| M015 | 2026-11-22 | apps/renderer-omp/src/runtimeState/runtimeState.css | 新增 | 运行时状态面板样式 | 低 |

### 渲染层 DSH 适配（与上游同文件）

| ID | 日期 | 文件 | 类型 | 说明 | 上游影响 |
| --- | --- | --- | --- | --- | --- |
| M020 | 2026-11-22 | apps/renderer-omp/src/CapabilitiesPage.tsx | 修改 | 能力中心改为 技能/插件/工具/MCP/命令 五页签，读真实资产 | 高 |
| M021 | 2026-11-22 | apps/renderer-omp/src/pageIntents.ts | 修改 | CapTab 收敛 | 中 |
| M022 | 2026-11-22 | apps/renderer-omp/src/SecondaryPage.tsx | 修改 | 导航移除评测/媒体入口 | 中 |
| M023 | 2026-11-22 | apps/renderer-omp/src/NavRail.tsx | 修改 | 一级导航与上游保持一致（DSH 可用项） | 中 |
| M024 | 2026-11-22 | apps/renderer-omp/src/workbench/AppShell.tsx | 修改 | 路由与模型页参数适配 DSH | 高 |
| M025 | 2026-11-22 | apps/renderer-omp/src/workbench/WorkbenchCanvas.tsx | 修改 | 挂载运行时状态面板；面板可用性按 DSH 能力收敛 | 高 |
| M026 | 2026-11-22 | apps/renderer-omp/src/workbench/menus.tsx | 修改 | 菜单移除无后端入口 | 中 |
| M027 | 2026-11-22 | apps/renderer-omp/src/HomePage.tsx | 修改 | 统计入口置空，保留真实用量展示 | 中 |
| M028 | 2026-11-22 | apps/renderer-omp/src/ModelConfigPage.tsx | 修改 | 模型目录来源与刷新走 DSH 运行时 | 高 |
| M029 | 2026-11-22 | apps/renderer-omp/src/models/ModelAvailabilityStrip.tsx | 修改 | 文案改为「可用模型 / 刷新模型目录」 | 中 |
| M030 | 2026-11-22 | apps/renderer-omp/src/models/useModelAuth.ts | 修改 | 无会话时也可读模型凭证 | 中 |
| M031 | 2026-11-22 | apps/renderer-omp/src/models/NativeModelAccessPane.tsx | 修改 | 多供应商 API Key 表单 | 中 |
| M032 | 2026-11-22 | apps/renderer-omp/src/panels/registry.ts | 修改 | 注册 runtime-state 与中文标题 | 中 |
| M033 | 2026-11-22 | apps/renderer-omp/src/dock/types.ts | 修改 | PANEL_IDS 增加 runtime-state | 中 |
| M034 | 2026-11-22 | apps/renderer-omp/src/dock/model.ts | 修改 | 默认布局加入隐藏位置 | 低 |
| M035 | 2026-11-22 | apps/renderer-omp/src/dock/windowTint.ts | 修改 | 新面板色标 | 低 |
| M036 | 2026-11-22 | apps/renderer-omp/src/dock/toolGroups.ts | 修改 | 工具分组归入「会话与上下文」 | 低 |
| M037 | 2026-11-22 | apps/renderer-omp/src/dock/DockLauncher.tsx | 修改 | 启动器说明文案 | 低 |
| M038 | 2026-11-22 | apps/renderer-omp/src/i18n/locales/zh.ts | 修改 | 中文化补齐与 DSH 文案 | 高：上游词条变动频繁 |
| M039 | 2026-11-22 | apps/renderer-omp/src/i18n/locales/en.ts | 修改 | 英文词条补齐 | 高 |
| M040 | 2026-11-22 | apps/renderer-omp/src/settings/startupNotice.ts | 修改 | 移除 OMP 仓库链接 | 中 |
| M041 | 2026-11-22 | apps/renderer-omp/src/StartupNotice.tsx | 修改 | 仓库区块条件渲染 | 中 |
| M042 | 2026-11-22 | apps/renderer-omp/src/AppUpdateDialog.tsx | 修改 | 无更新地址时不渲染 | 中 |
| M043 | 2026-11-22 | apps/renderer-omp/src/preview/fixtures.ts | 修改 | 更新地址替换为 example.com | 低 |

### 构建、脚本与元数据

| ID | 日期 | 文件 | 类型 | 说明 | 上游影响 |
| --- | --- | --- | --- | --- | --- |
| M050 | 2026-11-22 | apps/renderer-omp/package.json | 配置 | vendor 包与构建脚本 | 中 |
| M051 | 2026-11-22 | apps/renderer-omp/vite.config.ts | 配置 | 本地 vendor 与 omp-patch 解析 | 中 |
| M052 | 2026-11-22 | apps/renderer-omp/NOTICE.md | 修改 | fork 说明与基线版本 | 低 |
| M053 | 2026-11-22 | package.json | 配置 | workspaces 与质量门 | 低 |
| M054 | 2026-11-22 | scripts/launch-studio.vbs | 新增 | 静默启动 Electron | 低 |
| M055 | 2026-11-22 | packages/testkit/scripts/check-entrypoint-alignment.mjs | 新增 | 入口对齐审计 | 低 |
| M056 | 2026-11-22 | packages/testkit/test/dsh-assets.test.mjs | 新增 | 资产解析单测 | 低 |
| M057 | 2026-11-22 | packages/testkit/test/dsh-models.test.mjs | 新增 | 模型目录解析单测 | 低 |
| M058 | 2026-11-22 | sync-config.json | 配置 | 上游同步配置 | 低 |
| M059 | 2026-11-22 | dsh-overlay.json | 配置 | 修改清单（机器可读） | 低 |
| M060 | 2026-11-22 | .gitattributes | 配置 | 合并策略与行尾 | 低 |
| M061 | 2026-11-22 | scripts/upstream-fetch.ps1 | 新增 | 拉取上游快照（镜像/离线） | 低 |
| M062 | 2026-11-22 | scripts/upstream-triage.mjs | 新增 | 上游差异分类 | 低 |
| M063 | 2026-11-22 | scripts/upstream-adopt.mjs | 新增 | 按文件采纳上游 | 低 |

## G1 · 契约与投影层（2026-11-23）

> 通道从 SDK stdio 切到 Web Host API 的起点。本阶段只落地「契约 + 报文编解码」，不改渲染层。

### 契约拆分与读模型

| ID | 日期 | 文件 | 类型 | 说明 | 上游影响 |
| --- | --- | --- | --- | --- | --- |
| M070 | 2026-11-23 | packages/contract/src/provenance.js | 新增 | 三态读模型工厂（ready / empty / unavailable）；`empty()`、`unavailable()` 无 reason 直接抛错 | 低（不属于上游） |
| M071 | 2026-11-23 | packages/contract/src/read-models.js | 新增 | 会话状态卡 / 会话头 / 终端视图 / 用量 / 会话状态的读模型；字段取自 follow 首帧实测，缺失保持 null 不编造 | 低 |
| M072 | 2026-11-23 | packages/contract/src/legacy-sdk.js | 新增 | SDK stdio 通道常量迁出；保留供 headless 与评测批跑器使用 | 低 |
| M073 | 2026-11-23 | packages/contract/src/index.js | 修改 | 改为四路 re-export（legacy-sdk / projection / read-models / provenance），对外接口只增不减 | 低 |

### DSH Web 适配层（新增包）

| ID | 日期 | 文件 | 类型 | 说明 | 上游影响 |
| --- | --- | --- | --- | --- | --- |
| M074 | 2026-11-23 | packages/dsh-gateway/package.json | 新增 | 新工作区包 `@dsh-studio/dsh-gateway`，导出 `.` 与 `./wire` | 低 |
| M075 | 2026-11-23 | packages/dsh-gateway/src/wire/errors.js | 新增 | 错误码常量 + 三段式文案（what / why / todo）；未收录码有兜底；`isRetryable` / `needsReconnect` | 中：DSH 新增错误码需补表 |
| M076 | 2026-11-23 | packages/dsh-gateway/src/wire/frames.js | 新增 | unary 与 mux 报文编解码，**全部按 2026-11-23 实测**：`POST /api/<ns>/<method>`、`payload:{args}`、401/403 为纯文本、open 帧四键约束 | 高：DSH 改报文需同步 |
| M077 | 2026-11-23 | packages/dsh-gateway/src/{index.js,wire/index.js} | 新增 | 包入口与 wire 子路径导出 | 低 |

### 测试与工程

| ID | 日期 | 文件 | 类型 | 说明 | 上游影响 |
| --- | --- | --- | --- | --- | --- |
| M078 | 2026-11-23 | packages/testkit/test/wire.test.mjs | 新增 | 18 条：请求构造、四种响应形态（ok/业务错/401/403）、404、非 JSON、mux 帧 exactKeys、错误码三段式 | 低 |
| M079 | 2026-11-23 | packages/testkit/test/provenance.test.mjs | 新增 | 6 条：三态约束，重点验证 empty/unavailable 缺 reason 必须抛错 | 低 |
| M080 | 2026-11-23 | packages/testkit/package.json | 修改 | `node --test test` → `node --test`：旧写法在 Node 22 + Windows 下把 `test` 当模块入口，直接 MODULE_NOT_FOUND；同时加 dsh-gateway 依赖 | 低 |
| M081 | 2026-11-23 | packages/dsh-gateway/src/supervisor/launch.js | 新增 | supervisor 的纯函数层：启动行解析（含 ANSI 剥离）、脱敏、/connect URL、Set-Cookie 解析、指数退避、WSL spawn 计划、行分割。全部不碰进程，可单测 | 中 |
| M082 | 2026-11-23 | packages/dsh-gateway/src/supervisor/index.js | 新增 | 进程守护：spawn → 抓 token → /connect 换 Cookie → 健康检查 → 崩溃退避重启。含 WSL 内 pkill 收尾、旧实例 exit 忽略、error 事件无监听器时不崩进程 | 高：生命周期与认证链路的核心 |
| M083 | 2026-11-23 | packages/dsh-gateway/src/wire/descriptors.js | 新增 | descriptor 查询层：`buildArgs` 按官方 descriptor 构造 args、`checkArgs` 发包前校验顶层参数名、`suggestEndpoints` 拼错给候选。**手写 args 是禁止的** | 高：参数名无统一规律，猜必错 |
| M084 | 2026-11-23 | packages/dsh-gateway/src/wire/descriptors.json | 新增 | DSH 0.2.2-rc.5 的 remote descriptor 快照：39 个包 / 224 个 endpoint / 参数名与 jsonSchema。226KB，勿手改 | 高：DSH 升级必须重跑提取器并 diff |
| M085 | 2026-11-23 | packages/testkit/scripts/extract-descriptors.mjs | 新增 | descriptor 提取器（须在 WSL 内运行）：遍历 `dsh-api-*/lib/typert.remote-client.js`，读 `default.spec.methods`，剥 description 后落盘 | 中 |
| M086 | 2026-11-23 | packages/testkit/scripts/supervisor-smoke.mjs | 新增 | 真机冒烟：用 supervisor 起真 DSH，再用它交出的 base+cookie 调 `/api/session/list`，验证凭证可用。`npm run smoke:supervisor` | 中 |
| M087 | 2026-11-23 | packages/dsh-gateway/src/index.js | 修改 | 导出 supervisor 与 descriptor 层 | 低 |
| M088 | 2026-11-23 | packages/dsh-gateway/package.json | 修改 | exports 增加 `./supervisor` 子路径 | 低 |
| M089 | 2026-11-23 | packages/testkit/test/supervisor.test.mjs | 新增 | 31 条：启动行/脱敏/退避/spawn 计划/行分割的纯函数测试，加上用 fixture 进程跑 start→ready→stop、重复 start、refreshCookie、超时、命令不存在、stop 幂等、dispose | 低 |
| M090 | 2026-11-23 | packages/testkit/test/descriptors.test.mjs | 新增 | 21 条：**守护 DSH 升级**。断言 `session/list` 参数名是 `_request`、`session/create` 是 `request`、`terminal/*` 用 `agent` 或 `sessionId`；`buildArgs` 标量不多包一层；`checkArgs` 抓顶层参数名错误 | 中：DSH 改签名时这里先红 |
| M091 | 2026-11-23 | package.json | 修改 | 新增 `descriptors:extract`、`smoke:supervisor` 两个脚本 | 低 |
| M092 | 2026-11-23 | spike/dsh-ui-slot/ | 新增 | 实验：最小 DSH UI 插件（package.json + node 半 + 浏览器半，无构建工具）。验证了第三方包可进入 boot graph 并执行 `apply(ctx)`、`ctx.slots.register` 成功 | 无（隔离在 ui-spike profile，不影响 web） |
| M093 | 2026-11-23 | spike/electron-render/main.cjs | 新增 | 渲染验证脚本：Electron 加载 DSH 页面，收集 console、探测 DOM、截图。注意 Electron 需 `env -u ELECTRON_RUN_AS_NODE` | 无 |
| M094 | 2026-11-23 | packages/testkit/scripts/boot-check.mjs | 新增 | 检查指定 profile 的首页 boot graph 是否包含目标包。用法 `node ... [profile] [package]` | 低 |
| M095 | 2026-11-23 | ~/.dsh/profiles/ui-spike/（仓库外） | 新增 | 独立实验 profile（`--from-default-profile web` 复制），用于 UI 插件注入实验。**日常 web profile 未改动** | 无 |
| M096 | 2026-11-23 | packages/studio-ui/ | 新增 | **B 路线首个正式 UI 插件**。「@studio/ui-shell」替换 DSH 左栏：package.json 带 `dsh.client`、`lib/client.js` 用 `window.__ModuleLoader__.load` 包装、`lib/index.js` 空 node 半。P0 用假数据，P1 接会话服务 | 高：这是新架构的前端入口 |
| M097 | 2026-11-23 | packages/testkit/test/studio-ui-shell.test.mjs | 新增 | 8 条：在 vm 沙箱里模拟 `ModuleLoader` + mock React，验证格式、exports、slot 注册、**priority 必须 < 0**、组件渲染、折叠态 | 中：priority 方向极易猜反，用断言钉死 |
| M098 | 2026-11-23 | spike/electron-render/shot.cjs | 新增 | 截图 + DOM 探测脚本。日志写文件（Electron GUI 模式吞 stdout）。运行时须 `env -u ELECTRON_RUN_AS_NODE`，且**不要传带空格的路径参数**（会 exit 127） | 低 |
| M099 | 2026-11-23 | ~/.dsh/profiles/studio/（仓库外） | 新增 | 正式 studio profile（复制 web + patch 挂载 @studio/ui-shell）。**日常 web profile 未改动** | 无 |
| M100 | 2026-11-23 | packages/studio-ui/src/{workbench,session-derived,ui-panel-host,ui-session-views,ui-workbench}/ | 新增 | 工作台五层从 scaffold 迁入：停靠状态机（零 React）、事件折叠缓存、面板契约、会话多视图绑定、窗口宿主。包间引用改为相对路径（原为 `@deepseek-ai/dsh-client-*` 虚拟包名） | 低：不依赖上游 |
| M101 | 2026-11-23 | packages/studio-ui/src/shell/ | 新增 | 真机接线层：`client-entry`（apply + 注册 sidebar/main 两个座位 + `__STUDIO_DEBUG__` 只读钩子）、`main-panel`、`sidebar`（读真实 `ctx.sessions.list`）、`conversation-body`、`event-hub`（同会话只订一次事件）、`event-adapter`（真实 SessionEvent → 折叠输入）、`open-session` | **高**：唯一认识 DSH 契约的一层 |
| M102 | 2026-11-23 | packages/studio-ui/scripts/build.mjs | 新增 | rolldown 构建：TS/TSX → CJS → 外层拼 `window.__ModuleLoader__.load({id, factory})`。**react/react-dom/@deepseek-ai/* 全部 external**（打进来会出现第二份 React） | 高：产物形态必须与官方插件逐字对齐 |
| M103 | 2026-11-23 | packages/studio-ui/src/ui-session-views/{port,leases,client}.ts | 修改 | 按 DSH 0.2.2-rc.5 真实契约修正三处：retain 选项只有 `{source, signal?}`（删 connection/facets）；返回值有同步 `binding`、无 `released`；`retainInfo` 是 `ObservableSnapshot` 需 getSnapshot。租约注册表利用同步 binding 省一帧空白 | **高**：原假设全部来自文档推断，真机核对后纠正 |
| M104 | 2026-11-23 | packages/studio-ui/src/session-derived/cache.ts | 修改 | 新增 `reset(sessionId)`：就地清空折叠状态但保留 slot 与引用。事件窗口的 `prepend`（向上加载历史）/`replace` 会让 seq 起点变小，而折叠只支持递增，必须重置后按整窗重折；不用 `drop` 是因为它会失效所有已发出的 handle | 中 |
| M105 | 2026-11-23 | packages/studio-ui/src/shell/event-hub.ts | 新增 | 事件订阅按 sessionId 引用计数共享。**真机实测**：每视图各自订阅时，第二个窗口挂载读到 `change.kind==='replace'` 触发 reset，`applies` 从 20 变 40 —— 第一个窗口的折叠结果被清空重来 | **高**：这是多窗口正确性的前提 |
| M106 | 2026-11-23 | packages/studio-ui/src/shell/main-panel.tsx | 修改 | 「首次铺开最近会话」改用 `useRef` 一次性锁死。`ctx.sessions.list` 快照身份会随列表更新而变，effect 重跑时会自动重开标签（实测多出 `wb-4`），违反"空态不自动新建会话" | 中 |
| M107 | 2026-11-23 | spike/electron-render/probe-workbench{,-deep}.cjs | 新增 | 真机探测：浅层查 DOM 接管情况，深层分三阶段验证引用计数（同会话两窗口 → refCount 2 / retain 1 / 不重折；关光 → 引用归零但缓存保留）。日志写文件 | 无 |
| M108 | 2026-11-23 | packages/studio-ui/{package.json,tsconfig.json,vitest.config.ts,README.md} | 新增 | 包配置与文档。README 记录真机验证结论（PASS + 实测数字）、三处契约修正、两处数据驱动的设计修正、五条已知边界 | 中 |
| M109 | 2026-11-23 | package.json | 修改 | 新增 `studio:build` / `studio:test` / `studio:typecheck` 三个脚本 | 低 |
| M110 | 2026-11-23 | packages/studio-ui/src/shell/live-stream.ts | 新增 | 流式文本提取：从事件窗口尾部读连续 transient，按 attempt 聚合 `text-delta`。**不进折叠缓存**（transient 会被 settle 整体撤掉，且每几十毫秒变一次会拖累所有视图重折） | 中 |
| M111 | 2026-11-23 | packages/studio-ui/src/shell/{topbar,builtin-panels,error-boundary,styles}.tsx | 新增 | 面板闭环：顶栏「面板」下拉（读注册表）、内建 `studio-debug` / `session-info` 两个只读派生面板、面板级错误边界、光标动画与滚动条样式 | 中 |
| M112 | 2026-11-23 | packages/studio-ui/src/shell/event-hub.ts | 修改 | 折叠判断改为**基于自身进度 `{min,max}`**，不再依赖 `change.kind`。`change` 是"最近一次变更"的快照字段、不会因重读而更新，导致视图卸载重挂时被误判成 `replace` 而整窗重折（真机实测 `applies` 20→40）。现在内容没变则空操作，只有窗口向前扩展才 reset | **高**：这是幂等折叠的关键 |
| M113 | 2026-11-23 | packages/studio-ui/src/shell/{conversation-body,main-panel}.tsx | 修改 | 会话正文接入流式气泡（settle 后自动消失，不会与 durable 消息重复）；`renderContent` 两条分支都包错误边界 | 中 |
| M114 | 2026-11-23 | spike/electron-render/probe-workbench-v2.cjs | 新增 | 第二轮探测：面板菜单点击 → 面板渲染断言；模拟 PointerEvent 拖拽到左边缘热区 → 断言分屏几何（`paneRects` / `splitSizes`）与**不重折**（`applies` 前后一致） | 无 |
| M115 | 2026-11-23 | packages/studio-ui/src/shell/{event-hub,live-stream}.test.ts | 新增 | 20 条：订阅共享与幂等释放、搬家不重折、重投空操作、prepend 必须重折、append 增量、畸形输入不抛错；`text-delta` 提取、attempt 切换丢弃、尾部边界 | 中 |
| M116 | 2026-11-23 | packages/studio-ui/src/shell/{composer,session-pane}.tsx | 新增 | 输入框 + 正文布局。`prompt([{type:'text',text}], 'queue')`；只用 queue 不猜 steer；不调 `beginSubmission`（回显会与事件窗口重复）；`ok:false` 的 `RemoteFailure` 原样显示在输入框下方。`session-pane` 负责 flex 布局（`SessionTabView` 是 `display:contents`） | **高**：这是"能真正发消息"的最后一步 |
| M117 | 2026-11-23 | packages/studio-ui/src/{session-derived/conversation,shell/event-adapter}.ts | 修改 | **按 `source.kind` 区分真人输入与 Host 注入**。真机实测：一场对话 4 条 `user/message` 有 3 条是 `<system-reminder>`（工具说明/技能列表/时间采样），全渲染成"你"等于满屏噪音。`kind === 'user'` 才算真人，其余标记 `synthetic` | **高**：直接影响界面可读性 |
| M118 | 2026-11-23 | packages/studio-ui/src/shell/conversation-body.tsx | 修改 | 系统上下文（`synthetic` 与 `role==='system'`）默认折叠成一行「已折叠 N 条系统上下文」，可点开。真机上 `system/message` 是几千字的系统提示词，一个人就占满整个视口 | 中 |
| M119 | 2026-11-23 | packages/studio-ui/src/shell/event-adapter.ts | 修改 | `seq` 校验用 `Number.isFinite` 而非 `typeof === 'number'`：`NaN` 会通过 typeof 检查，但让 `seq > lastSeq` 永远为假 —— 那条消息会静默消失 | 中 |
| M120 | 2026-11-23 | spike/electron-render/probe-workbench-v3.cjs | 新增 | 第三轮探测（唯一有写操作）：新建空会话 → 输入 → 发送 → 断言目标 pane 里出现我们发的文本、输入框清空、注入已折叠。**统计必须按可见 pane**：保活隐藏标签也在 DOM 里，全局统计会得到"多了 4 条"的假信号 | 无 |
| M121 | 2026-11-23 | packages/studio-ui/src/shell/{composer,event-adapter}.test.ts(x) | 新增 | 24 条：`asSessionFace` 形状识别、Enter/Shift+Enter、空白不发、成功清空、失败保留输入、抛错不炸、发送中不重复；`source.kind` 三种映射、`assistant/message` 取 `data.message.content`、NaN seq 拒绝、transient 丢弃 | 中 |
| M122 | 2026-11-23 | packages/studio-ui/src/shell/composer.tsx | 修改 | 附件：`fileUpload.upload` / `uploadImage` → `receiptId` → prompt 的 `file` part。三条入口（+ 按钮 / 粘贴 / 拖拽）、字节进度、上传中禁发、移除时 `revokeObjectURL`。**图片与文件统一用 receipt**：`PromptContentPart` 注释明确"图片上传的 receipt 以该图片进入消息"，不必自己塞 base64 | **高**：日常可用性的关键一步 |
| M123 | 2026-11-23 | packages/studio-ui/src/shell/service-slot.ts | 新增 | `ServiceSlot<T>` + `useServiceSlot`：把 Cordis 条件注入的服务包装成可订阅状态，服务就绪时 React 自动重渲染 | 中 |
| M124 | 2026-11-23 | packages/studio-ui/src/shell/client-entry.tsx | 修改 | **两处修正**：① 可选服务改用 `ctx.inject(['fileUpload'], …)` 条件注入 —— Cordis 有服务隔离，未注入的 `ctx.fileUpload` **会抛错**（不是 undefined），真机上直接把 `apply()` 炸掉、工作台一行没渲染；② `apply` 整体包 try/catch 并把两个 slot 注册提到最前，任何可选能力失败都不影响 UI | **高**：这是"插件静默消失"的根因 |
| M125 | 2026-11-23 | packages/studio-ui/src/shell/composer-attachments.test.tsx | 新增 | 13 条：入口可用性（缺服务/缺 sessionId 两种禁用）、普通文件走 upload、图片走 uploadImage、多选、失败标记、上传中禁发、移除、text+file 顺序、纯附件可发、失败附件被排除、成功后清空 | 中 |
| M126 | 2026-11-23 | spike/electron-render/probe-workbench-v4.cjs | 新增 | 第四轮探测（写操作）：新建空会话 → 页面内构造 `File` + `DataTransfer` 塞进 input → 轮询 chip 到 ready → 带附件发送。**踩坑**：file input 自身带 `hidden`，永远 `offsetParent===null`，必须按"可见 composer"归属去找，否则会塞进保活的隐藏标签 | 无 |
| M127 | 2026-11-23 | packages/studio-ui/src/shell/event-adapter.ts | 修改 | 新增 `attachmentsOfBlocks`：从 `ContentBlock[]` 提取 image/file 引用（缺 `attachmentId` 整条丢弃、`bytes` 非有限数归零、无名图片省略字段）。空数组不写 `attachments` 字段，保持信封最小 | 中 |
| M128 | 2026-11-23 | packages/studio-ui/src/session-derived/conversation.ts | 修改 | `MessageAttachment` 定义放在这里（纯逻辑包，零依赖），`ConversationMessage` 增加 `attachments?`；`apply` 原样搬运不复制 | 中 |
| M129 | 2026-11-23 | packages/studio-ui/src/shell/attachment-images.ts | 新增 | `AttachmentImageCache`：按 `attachmentId` 全局共享（内容寻址天然幂等）、inflight 去重、失败可重试、订阅通知。blob URL 故意不 revoke（多视图共享，revoke 会裂图） | 中 |
| M130 | 2026-11-23 | packages/studio-ui/src/shell/attachment-view.tsx | 新增 | 图片缩略图（限高 220、点击放大）+ 文件 chip；未就绪与失败都降级成 chip，`title` 放**具体原因**而非通用文案 | 中 |
| M131 | 2026-11-23 | packages/studio-ui/src/shell/{conversation-body,session-pane}.tsx | 修改 | 正文接收 `session` 取 `readAttachment`；空文本消息不渲染空 span | 中 |
| M132 | 2026-11-23 | packages/studio-ui/src/shell/{attachment-images,attachment-view,conversation-body,event-adapter}.test.ts(x) | 新增 | 34 条：附件提取（顺序/畸形/缺 id/NaN bytes）、缓存（共享/并发去重/失败重试/通知）、渲染（chip/img/降级/放大/自定义文案）、端到端（事件→折叠→渲染、注入消息附件不渲染、同图两条消息只读一次） | 中 |
| M133 | 2026-11-23 | spike/electron-render/probe-workbench-v5.cjs | 新增 | 第五轮探测：canvas 生成 PNG → 上传 → 发送 → 断言出现 `message-attachment-image` 且 `src` 是 `blob:`。**判定先算再截图**：`capturePage` 会抛 `UnknownVizError` | 无 |
| M134 | 2026-11-23 | packages/studio-ui/src/shell/client-entry.tsx | 修改 | 启动日志「等待中就绪」改为「尚未就绪」——原文案读起来像已在等待，实际含义是条件注入还没触发 | 无 |
| M135 | 2026-11-23 | packages/studio-ui/src/shell/composer.tsx | 修改 | 停止按钮：`cancel()` + `stopping` 8 秒兜底 + `sessionStateOf` / `useSessionRunning`。运行中保留发送（排队能力） | 中 |
| M136 | 2026-11-23 | packages/studio-ui/src/shell/{session-pane,composer}.tsx | 修改 | **停止按钮判据从 `snapshot.running` 改为折叠事件流的 `streaming`**。真机实测 running 在 turn 开始 50ms 后就落回 false，而 assistant 还在输出到 69 行 —— 用它做判据按钮会在最该点时消失 | 高 |
| M137 | 2026-11-23 | packages/studio-ui/src/session-derived/conversation.ts | 修改 | 导出共享单例 `CONVERSATION_MODEL`（缓存按 key 索引，多实例命中同一 slot；导出只为省一个对象并让"谁在用同一模型"可见） | 低 |
| M138 | 2026-11-23 | packages/studio-ui/src/shell/composer-stop.test.tsx | 新增 | 21 条：running 出现/消失、无 cancel 不显示、点击调一次、连点去重、拒绝与抛错的文案、排队能力不被夺走、disabled 时隐藏、DOM 顺序；以及 streaming 为独立主信号的 5 条 | 中 |
| M139 | 2026-11-23 | spike/electron-render/probe-workbench-{v6,v7,v8}.cjs | 新增 | v6 抓到按钮但采样慢；v7 高频采样发现 running 50ms 后失效；v8（无嵌套模板字符串）完整验证打断：按钮持续 1.5s、点前已生成、点后消失、输出截断在 21/200 | 无 |
| M140 | 2026-11-23 | ~/.dsh/profiles/studio/cordis.patch.yml（仓库外） | 修改 | 补 `llm-pi-ai.providers.opencode-go`（apiKeyEnv 引用凭据）+ `agent-default-model` 指向它。**只影响 studio 测试 profile**，web 主 profile 未动；备份为 `cordis.patch.yml.before-model` | 中 |
| M141 | 2026-11-23 | packages/studio-ui/src/shell/conversation-body.tsx | 修改 | 向上加载历史：`loadOlder({deferConsumption:true})` → 量锚点 → `consumeOlder()` 三步；`useLayoutEffect` 按 `scrollHeight` 差换算 scrollTop；滚到顶部 120px 自动加载（仅 active）；空态保留入口 | 中 |
| M142 | 2026-11-23 | packages/studio-ui/src/shell/conversation-history.test.tsx | 新增 | 12 条：显隐判据、无 loadOlder 不显示、空态保留入口、**deferConsumption 配对断言**、发布后消息出现、consume 返回 false、抛错重试、加载中禁用、滚动换算（1600-1000+30=630）、内容变短不为负、隐藏标签不自动加载 | 中 |
| M143 | 2026-11-23 | spike/electron-render/{probe-workbench-v9,probe-diag-events}.cjs | 新增 | v9 验显隐判据一致 + 四功能回归；diag 直接数事件窗口类型分布，确认"1 user 0 assistant"是日志本身如此（有 attempt 无 message），不是折叠漏消息 | 无 |
| M144 | 2026-11-23 | packages/studio-ui/src/session-derived/chunked.ts | 修改 | 新增 `update(index, value)`：只复制命中块（≤256）与块表，其余块共享；越界/非法下标/值未变均返回自身 | 中 |
| M145 | 2026-11-23 | packages/studio-ui/src/session-derived/conversation.ts | 修改 | `MessageRole` 加 `tool`；`ConversationState.openCalls`（callId→下标，放 state 保持纯函数）；`tool/call` 建记录、`tool/result` 用 `update` 合并回同一条；结果截断 400 字符 | 高 |
| M146 | 2026-11-23 | packages/studio-ui/src/shell/event-adapter.ts | 修改 | `tool/call` 带出 callId/name/arguments（不解析 JSON）；`tool/result` 从 `message.content` 取文本、透传 isError、错误码取 `error.code` 退回 `reason` | 中 |
| M147 | 2026-11-23 | packages/studio-ui/src/shell/tool-call-view.tsx | 新增 | 收起成一行（状态图标+工具名+参数摘要+状态）；展开看美化后的参数与结果；`summarizeArguments` 优先 path/command/pattern，**非法 JSON 原样显示** | 中 |
| M148 | 2026-11-23 | packages/studio-ui/src/shell/{live-stream,conversation-body}.tsx | 修改 | `reasoning-delta` 与 `text-delta` 分开累计；思考默认收起（斜体小字）；只有思考没有正文时也返回 LiveStream，避免界面空白 | 中 |
| M149 | 2026-11-23 | packages/studio-ui/src/{session-derived,shell}/*.test.ts(x) | 新增 | 63 条：`update` 结构共享与原实例不变、tool 折叠配对/孤儿结果/并发/纯函数、适配层字段提取、渲染收起展开/非法 JSON/无障碍、思考与正文分离、端到端顺序 | 中 |
| M150 | 2026-11-23 | packages/studio-ui/src/shell/live-stream.ts | 修改 | 新增 `toolCallDeltaOf` 与 `LiveToolCall`：按 id 分组拼接 `argumentsDelta`，后续 delta 无 name 时不覆盖；只有工具调用时也返回 LiveStream | 中 |
| M151 | 2026-11-23 | packages/studio-ui/src/shell/{tool-call-view,conversation-body}.tsx | 修改 | 流式预览复用 ToolCallView 的 running 形态；ToolCallState 加 `interrupted` 第四态（turn 结束仍挂着的调用） | 中 |
| M152 | 2026-11-23 | packages/studio-ui/src/session-derived/conversation.ts | 修改 | **`turn/end` 收尾未完成的工具调用**：标成 `interrupted` 并清空 `openCalls`。实测 5000 次未配对调用从 3075ms 降到 9.26ms（332×），且避免下次 result 错配旧下标 | 高 |
| M153 | 2026-11-23 | packages/studio-ui/src/shell/composer.tsx | 修改 | steer：`send(mode)` 默认 queue，Ctrl/Cmd+Enter 才 steer，无 busy 时降级 queue；运行中按钮文案变「排队发送」+ title 给快捷键提示 | 中 |
| M154 | 2026-11-23 | packages/studio-ui/src/shell/{image-lightbox.tsx,format.ts,attachment-view.tsx} | 新增/修改 | lightbox：Esc/点背景关闭、点图不关、焦点进出、背景滚动锁、`download` 另存；`formatBytes` 抽到 format.ts 避免循环依赖；缩略图点击改为开 lightbox | 中 |
| M155 | 2026-11-23 | packages/studio-ui/src/shell/{composer-steer,image-lightbox}.test.tsx | 新增 | 25 条：Enter 排队/Ctrl+Enter steer/Cmd 同样/无 busy 降级/Shift 换行/带附件/清空输入/按钮文案；lightbox 八项行为 + 自定义文案 | 中 |
| M156 | 2026-11-23 | packages/studio-ui/scripts/bench-fold-tools.ts + package.json | 新增 | 折叠成本基线（配对/未配对/带 turn-end 三组），证明 openCalls 清理是 332× 的差异；新增 `studio:bench:tools` 脚本 | 低 |
| M157 | 2026-11-23 | spike/electron-render/{probe-workbench-v10,v11,probe-diag-chunks}.cjs | 新增 | v10 验工具调用与流式预览（30ms 采样 + 多工具任务才抓到）；v11 验 lightbox 与 steer（含 seq 时间线）；diag-chunks 证明该路由不产 reasoning-delta | 无 |
| M158 | 2026-11-23 | packages/studio-ui/src/session-derived/conversation.ts | 修改 | 工具结果不再在折叠层截成 400：保留全文（上限 20000），越界才标 `resultChars` / `resultClipped`；空结果不写字段（信封最小） | 高 |
| M159 | 2026-11-23 | packages/studio-ui/src/shell/tool-call-view.tsx | 修改 | 结果区默认 400 字符 + 「展开全文（共 N 字符）」/「收起全文」；越界时说明其余在会话日志；错误码与结果正文分开渲染，不再互相遮蔽 | 中 |
| M160 | 2026-11-23 | packages/studio-ui/src/shell/image-lightbox.tsx | 修改 | 多图翻页：`items` + `index`、←/→、带 `2 / 3` 计数、两端禁用；键盘监听改用 ref 只注册一次（顺带修掉每次渲染都抢焦点）；空列表不渲染遮罩 | 中 |
| M161 | 2026-11-23 | packages/studio-ui/src/shell/attachment-images.ts | 修改 | 缓存加 `revision` 版本号 + 新增 `useAttachmentImages` 批量订阅；effect 依赖改用 id 串，避免 `ensure`→通知→重渲染的死循环 | 高 |
| M162 | 2026-11-23 | packages/studio-ui/src/shell/attachment-view.tsx | 修改 | 消息级一次订阅整组图，相册只收已就绪的图（失败的不进相册，否则翻页闪空图）；`images` 用 `useMemo` 固定身份 | 中 |
| M163 | 2026-11-23 | packages/studio-ui/src/{session-derived,shell}/*.test.ts(x) | 新增 | 21 条：结果保留全文/越界标记/空结果、渲染展开收起与越界提示/错误码并列/aria、多图翻页计数与边界/方向键/空列表、相册定位/失败图不入册/缓存幂等 | 中 |
| M164 | 2026-11-23 | spike/electron-render/probe-workbench-v12.cjs | 新增 | 真机验两项：工具结果 400→20000（总数 20994，越界提示）、相册 1/2→2/2 且图真的换了 | 无 |
| M165 | 2026-11-24 | packages/studio-ui/src/ui-workbench/placement.ts | 新增 | 区域 → 布局操作的纯翻译层：`center/left/right/bottom/float`，右栏 ratio 0.35、底部 0.4、浮窗两步（先 insertTab 再 float）；`PLACEMENT_LABELS` 统一中文名 | 中 |
| M166 | 2026-11-24 | packages/studio-ui/src/shell/{topbar,main-panel}.tsx | 修改 | 菜单每行加 `▾` 展开落位选项（只列该面板 `regions` 声明过的），互斥展开、关菜单重置；`openPanel(panelId, placement?)` 走 `placeOps` + `dispatchMany`，缺省用 `defaultRegion` | 中 |
| M167 | 2026-11-24 | packages/studio-ui/src/ui-workbench/index.ts | 修改 | 导出 placement 的公开面（不导出内部常量） | 低 |
| M168 | 2026-11-24 | packages/studio-ui/src/{ui-workbench,session}/placement.test.ts + shell/topbar.test.tsx | 新增 | 16 条：五种落位在真实 `applyOps` 上的树形状（含连续两次切分）、float 不变量、菜单默认区域一步到位/只列声明区域/互斥展开/关菜单重置/aria | 中 |
| M169 | 2026-11-24 | spike/electron-render/probe-workbench-v13.cjs | 新增 | 真机验右侧（row split 0→1、格 1→2）与浮窗（floats 0→1、格不变），截图确认面板内容真的进了新容器 | 无 |

## X0 · 外部能力与真机安全门（2026-11-24）

| ID | 日期 | 文件 | 类型 | 说明 | 上游影响 |
| --- | --- | --- | --- | --- | --- |
| M170 | 2026-11-24 | apps/desktop/src/studio-bridge.js | 修改 | E-05 的 34 个听写/评测/基准/MCP/Agent 控制入口在 query/command 分支前统一拒绝；能力清单均为 unavailable，不调用 Runtime/网络、不返回模拟结果 | 中：上游新增同类入口需补拒绝矩阵 |
| M171 | 2026-11-24 | packages/testkit/test/runtime-capabilities.test.mjs | 修改 | 新增 E-05 四项回归：34 查询 + 34 命令无副作用、输入冻结、manifest 34/34 unavailable；能力聚焦 12/12 | 低 |
| M172 | 2026-11-24 | apps/desktop/scripts/browser-security-probe.cjs | 修改 | 分开记录真实导航与 handler 分派：4 个危险 scheme、2 个主窗口远程导航 handler 均 preventDefault；主窗口 hide/show 3 轮保持 view 安全 | 无 |
| M173 | 2026-11-24 | apps/desktop/scripts/terminal-process-probe.cjs | 新增 | 真实 Electron 启动 native/OMP 两个 WSL PTY；ready 后 Registry 释放，OS 存活进程 2→0、Registry 2→0 | 无 |
| M174 | 2026-11-24 | docs/X0-{BASELINE,EXTERNAL-CAPABILITIES,BROWSER-THREAT-MODEL}.md | 修改 | 同步 166/166 回归、E-05 契约层闭环、浏览器/PTY 真机证据与剩余外部阻塞；XG0 仍未通过 | 无 |
| M175 | 2026-11-24 | apps/desktop/src/studio-bridge.js | 修改 | 审批 decision 严格校验；会话切换清理孤儿审批；open 等待 resume；tool/result 释放 owner；无适配层时 adaptation 明确失败 | 中 |
| M176 | 2026-11-24 | packages/runtime-client/src/index.js | 修改 | 子进程 generation 隔离；spawn/stdin 失败清理；write/pending fail-closed；stop 等待 OS exit，拒退出超时终止并抛错 | 高 |
| M177 | 2026-11-24 | packages/runtime-client/src/index.js、packages/host-services/src/index.js | 修改 | assistant usage 优先于 legacy turn/end；抽出纯事件折叠入口用于持久日志回放回归 | 中 |
| M178 | 2026-11-24 | apps/desktop/src/terminal-service.js | 修改 | PTY data/exit 回调验证 Registry entry 身份，旧 PTY 迟到事件不污染复用 ID | 中 |
| M179 | 2026-11-24 | apps/renderer-omp/src/workbench/WorkbenchCanvas.tsx | 修改 | follow-up 与排队立即纠偏先拒绝外部斜杠命令，再清草稿/删队列/取消审批；不退化普通 prompt | 中 |
| M180 | 2026-11-24 | apps/desktop/src/{main,browser-security}.js | 修改 | packaged 无 renderer dist 时拒绝开发入口回退；App 退出等待 Runtime；BrowserView 强制无 beforeunload 关闭 | 高 |
| M181 | 2026-11-24 | packages/testkit/test/{runtime-client,runtime-capabilities,subagents,terminal-service,host-services-usage,external-slash-boundary,browser-security}.test.mjs | 修改 | 补跨模块审计回归；全量 npm test 180/180，RuntimeClient 9/9，能力 15/15，浏览器安全 20/20，外部斜杠 7/7 | 低 |
| M182 | 2026-11-24 | docs/X0-{BASELINE,EXTERNAL-CAPABILITIES,RUNTIME-CAPABILITIES,BROWSER-THREAT-MODEL}.md | 修改 | 同步审计修复、最终回归计数与 fake/真实探针边界；保留 XG0 未通过及 X1 门禁 | 无 |
| M183 | 2026-11-24 | apps/desktop/scripts/runtime-lifecycle-probe.mjs | 新增 | 真实 WSL DSH SDK 两轮 initialize/shutdown/restart；逐轮验证 OS PID 退出、pending 归零、无 server request 与 prompt | 无 |
| M184 | 2026-11-24 | apps/desktop/scripts/{desktop-lifecycle-probe.mjs,desktop-lifecycle-renderer.html} | 新增 | 明确标记的 loopback 测试页驱动真实 Electron Main：Runtime 与 native/OMP PTY ready 后关窗，Electron 退出码 0，Runtime/PTY 代理 OS 进程 6→0；不冒充生产构建 | 无 |
| M185 | 2026-11-24 | docs/X0-{BASELINE,EXTERNAL-CAPABILITIES,RUNTIME-CAPABILITIES,BROWSER-THREAT-MODEL}.md | 修改 | 记录真实 SDK 正常启停与真实 Main 关窗证据；保留拒退出真机、生产包、BrowserView、双屏及外部授权缺口，XG0 仍未通过 | 无 |
| M186 | 2026-11-24 | apps/renderer-omp/src/browser/{urlSafety.ts,browserLinks.tsx} | 新增/修改 | 建立严格外链边界：显式 HTTP(S)、独立 mailto、注册扩展 scheme；拒绝凭证、控制字符、空白、反斜杠、畸形 authority、危险协议与超长值；无效链接渲染为 inert span | 中：上游新增链接入口必须复用该边界 |
| M187 | 2026-11-24 | apps/renderer-omp/src/{conversation,capabilities,git,models,skillshare,composer}/相关组件及 AppUpdateDialog.tsx、StartupNotice.tsx | 修改 | Markdown、资源、搜索引用、GitHub、更新、凭证、Skillshare、启动通知与终端/后台任务外链统一归一化；全渲染层 raw anchor/window.open 审计无未保护外链 | 中 |
| M188 | 2026-11-24 | packages/testkit/test/renderer-link-safety.test.mjs | 新增 | 8 项 URL 策略与全渲染层 sink 回归；覆盖 javascript/vbscript/livescript/mocha/data/file/about/blob、凭证、控制字符、超长、mailto、扩展注册及内部/native 例外 | 低 |
| M189 | 2026-11-24 | apps/desktop/scripts/{wsl-path.mjs,desktop-lifecycle-probe.mjs}、packages/testkit/test/desktop-lifecycle-path.test.mjs | 新增/修改 | 生命周期探针通过真实 wslpath 规则转换 Windows cwd，移除 /mnt/f 硬编码；Windows 反斜杠先转正斜杠，避免 wsl.exe 命令行吞掉分隔符；3 项回归覆盖命令参数、POSIX 直通与非法路径拒绝；修正后真实 Electron 关窗探针再次 6→0 | 无 |
| M190 | 2026-11-24 | docs/X0-{BASELINE,BROWSER-THREAT-MODEL}.md | 修改 | B-T10/B-SEC-11 记录渲染层安全边界、191/191 回归与真实 Chromium/生产 bundle 未验证项；XG0 仍未通过 | 无 |
| M191 | 2026-11-24 | apps/desktop/src/{browser-security,main}.js | 修改 | 修复 Electron 45 导航事件适配：details 对象优先读取 `url/isMainFrame`，deprecated 位置参数不再把 `will-frame-navigate` 的 `isSameDocument` 误作 `isMainFrame`；主窗口重定向按第四位置参数读取主框架身份 | 高：Electron 导航签名升级须保留双形态回归 |
| M192 | 2026-11-24 | apps/desktop/scripts/browser-security-probe.cjs | 修改 | 记录真实导航事件形态；真实 BrowserView/主窗口远程主导航均到达 handler 并拒绝，跨域重定向/iframe 阻断；新增 3 轮独立 BrowserView OS 清理检查（PID 退出、监听器归零、WebContents 回基线），与危险 scheme 合成分派证据分开计数 | 无 |
| M193 | 2026-11-24 | apps/desktop/scripts/browser-partition-restart-probe.cjs | 新增 | 两个独立 Electron 进程 seed/verify：持久 cookie 与 localStorage 跨重启恢复，sessionStorage 清空，control partition 隔离且非 default session；使用 loopback HTTP 与带 Max-Age 的 cookie，不冒充生产入口验收 | 无 |
| M194 | 2026-11-24 | packages/testkit/test/browser-security.test.mjs | 修改 | 新增 Electron details/位置参数、`isSameDocument` 与 `isMainFrame` 区分、真实导航/OS 清理/持久重启探针接线回归；浏览器安全聚焦 23/23 | 低 |
| M195 | 2026-11-24 | docs/X0-{BASELINE,BROWSER-THREAT-MODEL}.md | 修改 | 同步 194/194 全量回归、23/23 浏览器安全回归、真实远程导航、3 轮 OS 清理和持久 partition 重启证据；保留生产包、媒体设备、真实 Renderer 点击、双屏与 E-05 阻塞，XG0 仍未通过、浏览器保持禁用 | 无 |
| M196 | 2026-11-24 | apps/renderer-omp/productionPreviewBoundary.ts、packages/testkit/test/production-preview-boundary.test.mjs | 修改/新增 | 修复 Vite 8 正则 alias 只消费尾部斜杠、导致绝对替换前残留 `./`/`../` 的缺陷；完整 specifier 替换回归 6/6，真实非压缩生产构建通过 | 中：升级 Vite 必须保留该回归 |
| M197 | 2026-11-24 | packages/studio-ui、packages/testkit、X0 文档 | 验证/文档 | 离线恢复现有工具链，不安装依赖、不改 lockfile；标准 Vitest 38 文件/525 项、npm test 198 项、typecheck、studio build、架构与入口检查通过；浏览器 26/26、链接 8/8，聚焦合计 34/34 | 无 |
| M198 | 2026-11-24 | apps/renderer-omp/src/browser/browserLinks.tsx、apps/desktop/scripts/browser-ipc-probe.html | 修改 | 合法外链先 preventDefault 再走语义桥，避免主窗口导航抢先发生；真实 React/Windows 可信点击验证合法 HTTP(S)/mailto 到达桥、危险链接 inert、preventDefault 去重、导航与新窗口 0 | 中：上游链接组件变更须复用该边界 |
| M199 | 2026-11-24 | apps/desktop/scripts/browser-ipc-probe.html | 修改 | fake-device getUserMedia 到达权限 handler 返回 NotAllowedError，证明不自动授权；明确与真实媒体设备、系统权限弹窗验收分开 | 无 |
| M200 | 2026-11-24 | F:\workbuddy data\deliverables\dsh-studio\xg0-production-20261124-2330、docs/X0-*.md | 验证/文档 | 组装并真机验证便携生产包：生产 Renderer、Runtime ready、Files/Git、node-pty、DevTools、外链拒绝、重载与关窗进程清理通过；记录 ASAR/截图/JSON 哈希与剩余阻塞。不是标准安装包；XG0 仍未通过 | 无 |

## X0 · 依赖恢复、标准安装包与最终回归（2026-11-25）

| ID | 日期 | 文件 | 类型 | 说明 | 上游影响 |
| --- | --- | --- | --- | --- | --- |
| M201 | 2026-11-25 | package.json | 修改 | 固定 `electron-builder@26.18.0`、`electron-updater@6.8.11`；补根 `main: apps/desktop/src/main.js` 与 `build:omp`、`dist`、`dist:dir` 脚本；自动更新依赖已装但 `publish: null` | 中：升级打包器需重验 ASAR 路径与 NSIS 行为 |
| M202 | 2026-11-25 | package-lock.json、apps/renderer-omp/package-lock.json | 修改 | 恢复 Linux/macOS/Windows 可选依赖；移除错误的直接 Linux Rolldown binding 依赖；独立安装非 workspace 的 renderer-omp；Windows 安装 410 包、renderer 安装 368 包通过 | 高：不得用会裁剪其他平台可选依赖的 lock-only 命令覆盖最终合并结果 |
| M203 | 2026-11-25 | electron-builder.yml | 新增 | 配置 NSIS x64 per-user 安装、ASAR、`node-pty` 解包、关闭 npmRebuild；以实际包目录 `from`/`to` 将 contract/host-services/runtime-client 实体化进 `node_modules/@dsh-studio/*`，修复 Windows workspace 符号链接未被复制导致的 `ERR_MODULE_NOT_FOUND` | 高：打包器需持续验证三个裸导入包与 Windows native binding |
| M204 | 2026-11-25 | build/icon.ico | 新增 | 使用既有 `apps/renderer-omp/public/favicon.ico` 作为安装器图标，未宣称品牌视觉已定稿 | 低 |
| M205 | 2026-11-25 | Windows 标准构建与隔离安装 | 验证 | 默认压缩 OMP Renderer 3123 modules；生成 128,763,377 字节 NSIS 安装包与 15,738,444 字节 ASAR；隔离安装退出码 0；ASAR 553 条目含三个工作区包和 Windows `node-pty` prebuild | 无 |
| M206 | 2026-11-25 | F:\workbuddy data\tmp\dsh-packaged-smoke.mjs、交付证据 installed-app-smoke.json | 验证 | 修复 Electron 参数拼接、CDP session envelope、嵌套 Runtime Promise 与重载 readyState 等待；安装版 Runtime ready、Files 2 项、真实 Git status 1 项、PTY 输出/resize/kill/PID 退出、重载、危险外链拒绝、DevTools 拦截、0 Renderer 错误、15 子进程关窗清理全部通过 | 无 |
| M207 | 2026-11-25 | F:\workbuddy data\tmp\dsh-git-smoke-worktree-20261125 | 验证夹具 | 因导出源码树无 `.git`，创建仅含 1 个未跟踪文件的临时真实 Git 仓库验证 Git bridge；不冒充用户项目历史、不提交 | 无 |
| M208 | 2026-11-25 | WSL 最终回归日志 | 验证 | `npm run check` 198/198；架构 1151 文件/7 组；入口 renderer 79 queries/97 commands、bridge 99 cases/124 reasons；Studio 38 文件/525 项；typecheck 通过；WSL 默认主 Renderer 29 modules、OMP 3082 modules | 无 |
| M209 | 2026-11-25 | F:\workbuddy data\deliverables\dsh-studio\standard-package-20261125 | 交付 | 归档标准安装包、blockmap、win-unpacked、配置、锁文件、日志、截图、冒烟 JSON、ASAR 清单与 SHA-256；安装包 SHA-256 `d2ba5762c4be2a4851e8513bdc8bcbf966823d8cc90d09f2595881026f979f66`，ASAR SHA-256 `c1a74c9fa775d401d39826be567b6cc4a3871ae9e704274410702c140895f357` | 无 |
| M210 | 2026-11-25 | docs/X0-{BASELINE,BROWSER-THREAT-MODEL,EXTERNAL-CAPABILITIES}.md、evidence/verification-summary.json | 文档 | 用 2026-11-25 标准构建/安装版结果取代旧缺口，保留历史证据；双屏、物理媒体、E-05 真实适配器/授权/费用/回执、安装版 BrowserView、生产持久登录、Runtime 拒退出、签名/自动更新与品牌定稿仍未验证；XG0 未通过、X1 未开始 | 无 |
| M211 | 2026-11-25 | evidence/{dsh-installed-browser-probe.mjs,installed-browser-probe.json,installed-browser-probe.log,installed-browser-view.png}、docs/X0-{BASELINE,BROWSER-THREAT-MODEL,EXTERNAL-CAPABILITIES}.md、evidence/verification-summary.json | 验证/文档 | 未改动的标准安装版 `main.js` 经临时调试作用域完成 3 轮 BrowserView 创建/导航/重载/销毁：Renderer OS PID 全退出、13 类监听器归零、WebContents 回基线、Runtime 保持 ready；popup/DevTools/`javascript:`/`data:`/`file:` 拒绝；fake-device 音频/视频输入可枚举但 `getUserMedia` 均返回 `NotAllowedError`；退出码 0、10 个跟踪子进程退出。生产 `browser:*` preload 未开放，物理媒体、Windows 权限弹窗与生产持久登录仍未验证；XG0 未通过、X1 未开始 | 无 |

## X1 · 纯客户端控制、事件与用量核心（2026-11-25）

| ID | 日期 | 文件 | 类型 | 说明 | 上游影响 |
| --- | --- | --- | --- | --- | --- |
| M212 | 2026-11-25 | packages/workbench-core/、packages/testkit/test/workbench-x1.test.mjs、packages/testkit/scripts/check-architecture.mjs、package-lock.json、docs/X1-CONTROL-EVENT-USAGE.md、docs/X0-BASELINE.md | 新增/修改 | 在非 Git 导出树建立文件级基线后新增纯核心包：控制 envelope/receipt、能力矩阵与 unsupported 前置拒绝、requestId 幂等；按会话草稿与 revision；owner/sequence 事件路由；UsageAdapter、UsageLedger 与注入 IO JSONL repository。新增第 8 组架构边界，lockfile 仅注册 workspace。聚焦 22/22、完整 220/220、Studio 525/525、typecheck 通过；证据归档于 `evidence/x1-core-20261125`。Runtime additive 方法未获单独批准，cancel/steer/queue 保持 unavailable；物理设备与外部授权按用户决定延期但未验证；XG0/XG1 均未通过，不接真实多会话，未提交/推送/发布 | 中：未来 Runtime additive descriptor 必须显式协商，客户端本地状态不得映射为 Runtime queue/position |

## XG1 · Runtime additive 控制与真实多会话验收（2026-11-25）

| ID | 日期 | 文件 | 类型 | 说明 | 上游影响 |
| --- | --- | --- | --- | --- | --- |
| M213 | 2026-11-25 | Runtime `packages/sdk/{protocol,server,client}`、`python/sdk`；Studio `packages/{contract,runtime-client,workbench-core}`、`apps/desktop/src/{studio-bridge,local-drafts,draft-store}.js`、`apps/renderer-omp/src/{composer,workbench}`、聚焦测试与 `docs/X1-CONTROL-EVENT-USAGE.md` | 实现/验证 | 用户明确批准后实现七个 additive 方法、严格 capability、structured error、session-scoped replay、真实 cancel/steer/inbox queue、process-local draft CAS、approval attribution 与 TS/Python parity。Studio 接入 capability gate、generation fencing、owner lease、seq 0→一基 envelope 归一化、独立 `runtimeEventSeq`、安全本地 draft fallback 与 dispatch ownership。真实 built Runtime 四会话验收通过：C allowed-once 执行成功、D rejected 且 `SANDBOX_ESCALATION_REJECTED`，审批 ID/决定隔离，native seq 0 起连续。Runtime 聚焦 88/88、Renderer 聚焦 40/40、Studio Main 243 pass/1 skip/0 fail、Renderer 3083 modules 构建与 typecheck 通过；证据归档 `F:\workbuddy data\deliverables\dsh-studio\xg1-runtime-20261125`。XG1 协议门通过；XG0、Runtime/Renderer 全仓回归、生产 JSONL IO、物理设备与分发签名仍未通过或未验证；未提交/推送/发布 | 高：additive wire 与 SDK 行为变更；既有 session/query、审批 outcome、模型/权限策略保持兼容 |
| M214 | 2026-11-25 | `apps/renderer-omp/{vitest.config.ts,vite.config.ts,package.json,tsconfig.app.json,test-support/omp-testkit/}`、`src/{dock,composer,conversation,preview}` 相关生产修复与测试、`docs/{X0-BASELINE,X1-CONTROL-EVENT-USAGE}.md`、Renderer 回归归档 | 修复/验证/文档 | 恢复 jsdom/setup/源目录收集与 OMP v0.2.8 testkit，去重 React 并 inline 虚拟列表；清理 dock 已删除 panel ID、BTW-only 迁移与浏览器实例 preset，修复 `/btw` 键盘规划、Eval 媒体引用和 preview predictions 默认。按当前契约修正过时断言/fixture。末次同口径 288 文件、544 suites、2,132 tests 从 14 失败恢复为 2,132 通过、0 失败/跳过；架构 1,162 文件/8 组、入口 79/97 与 bridge 103/130、生产 preview 边界 6/6 通过。证据与 SHA-256 位于 `docs/evidence/renderer-regression-20261125/`（原始本地归档 `F:\workbuddy data\deliverables\dsh-studio\renderer-regression-20261125`）。无 XG1 修改前 clean baseline；Runtime 全仓 68 项失败、XG0、`renderer-omp` 全量 typecheck、生产入口对齐与发布仍未通过或未验证 | 中：testkit/setup/React 解析与 dock registry 变更须保留全量回归；不能以聚焦或 jsdom 通过冒充真机/发布验收 |

