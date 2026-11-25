# X0 协议与运行环境基线

- 记录日期：2026-11-24
- Git HEAD：`a6dbfd031bec494b1293f08181c88439d0215fbc`
- 基线工作树：149 个既有变化文件，1812 行新增、25965 行删除；全部保留，不做 reset/clean。
- 修改前测试：103 项，96 通过、7 失败。失败均来自 `studio-ui-shell.test.mjs` 的旧 JSX runtime 断言，属于既有缺口，不是本轮回归。

## 标准构建与安装包收尾（2026-11-25 · 当前结论）

用户明确授权安装构建/打包依赖后，已恢复 Windows 与 WSL 两套独立依赖，并完成标准 electron-builder NSIS x64 安装包。以下结论取代 2026-11-24 记录中的“未安装依赖、默认压缩构建失败、标准安装包未验证”；历史过程仍保留在后文。

### 已满足

| 项目 | 结果 | 证据 |
|---|---|---|
| 工具链恢复 | Windows 独立安装 410 个包，独立 `apps/renderer-omp` 安装 368 个包；WSL 使用独立 Linux `node_modules`，不再与 Windows 安装共用符号链接 | `F:\workbuddy data\deliverables\dsh-studio\dependency-recovery-20261125-02` |
| 标准构建依赖 | 固定 `electron-builder@26.18.0`、`electron-updater@6.8.11`；补回并合并 Linux/macOS/Windows 平台可选依赖到 lockfile | `package.json`、`package-lock.json`、交付证据 `evidence/package-lock.json` |
| 默认压缩 Renderer | WSL 主 Renderer 29 modules；WSL OMP 3082 modules；Windows 打包 OMP 3123 modules，均通过默认 `vite build` | `final-check-materialized-wsl.log`、`omp-build.log`、`windows-dist-materialized.log` |
| 完整回归 | `npm run check` 198/198；架构扫描 1151 文件/7 组规则；入口检查 renderer 79 queries/97 commands、bridge 99 cases/124 explicit reasons | `evidence/final-check-materialized-wsl.log` |
| Studio 回归 | 标准 Vitest 38 文件/525 项全部通过；`studio:typecheck` 退出码 0、无诊断 | `evidence/final-studio-test-materialized-wsl.log`、`evidence/final-studio-typecheck-materialized-wsl.log` |
| 标准安装包 | `DSH-Studio-0.1.0-x64-Setup.exe` 生成并在全新隔离目录安装，退出码 0；ASAR 内三个 `@dsh-studio/*` 工作区包已实体化，Windows `node-pty` binding 已解包 | `evidence/app-asar-list.txt`、`evidence/windows-dist-materialized.log` |
| 安装版真机冒烟 | 真实 `file://` Renderer 加载；Runtime ready；Files 读取 2 项；真实 Git status 返回 1 个变更；原生 PTY 输出、100×30 resize、kill 与 OS PID 退出通过；重载后 Runtime ready；0 Renderer exception、0 console error；关窗退出码 0，15 个跟踪子进程全部退出 | `evidence/installed-app-smoke.json`、`evidence/installed-app.png` |
| 安装版安全基线 | F12/Ctrl+Shift+I 未保持 DevTools，page target 1/devtools target 0；非法 `javascript:` 外链被 Main 拒绝 | `evidence/installed-app-smoke.json`、`evidence/installed-app-smoke.log` |
| 安装版 BrowserView 资源与虚拟媒体 | 未改动的安装包 `main.js` 经临时主进程调试作用域调用现有浏览器处理器；3 轮创建/导航/重载/销毁后 Renderer OS PID 全退出、13 类监听器归零、WebContents 回基线；popup、DevTools 与 `javascript:`/`data:`/`file:` 导航拒绝；fake audio/video input 可枚举但 `getUserMedia` 均返回 `NotAllowedError` | `evidence/installed-browser-probe.json`、`installed-browser-probe.log`、`installed-browser-view.png`；生产 `browser:*` preload 门仍关闭 |
| Git 证据边界 | Git 冒烟使用 `F:\workbuddy data\tmp\dsh-git-smoke-worktree-20261125` 临时真实仓库和 1 个未跟踪文件；导出源码树没有 `.git`，未伪造项目历史 | `evidence/verification-summary.json` |
| 交付归档 | 安装包、blockmap、win-unpacked、构建配置、日志、截图、JSON、ASAR 清单与 SHA-256 已归档 | `F:\workbuddy data\deliverables\dsh-studio\standard-package-20261125` |

安装包 SHA-256：`d2ba5762c4be2a4851e8513bdc8bcbf966823d8cc90d09f2595881026f979f66`；ASAR SHA-256：`c1a74c9fa775d401d39826be567b6cc4a3871ae9e704274410702c140895f357`。安装包未签名；`publish: null`，未配置更新源，真实签名与自动更新升级仍未验证。

## X1 纯核心实施与外部项延期（2026-11-25 · 当前结论）

按用户“跳过物理设备和授权，继续”的调度决定，物理设备与外部授权继续延期但保持“未验证”。X1 纯核心完成后，用户明确回复“批准”，Runtime additive 方法与真实多会话集成已经实施；XG1 协议门通过，但不代表 XG0 或全仓回归通过。

### 已满足

| 项目 | 结果 | 证据 |
|---|---|---|
| 修改前文件基线 | 在非 Git 导出树上记录目标文件修改前副本、缺省新文件与 SHA-256 | `F:\workbuddy data\tmp\dsh-x1-baseline-20261124T234333Z` |
| X1.1 控制协议 | envelope/receipt、错误码、能力协商、进程内 requestId 幂等与冲突拒绝 | `packages/workbench-core/src/control.js` |
| X1.2 / X1.3 能力边界 | cancel/steer/queue 保持 unavailable；unsupported 在注入执行器前失败，不退化为普通 prompt | `workbench-x1.test.mjs` 前 5 项 |
| X1.4 草稿 | 按会话隔离、revision 冲突保护、本地未提交状态与恢复校验 | `packages/workbench-core/src/drafts.js` |
| X1.5 事件路由 | owner lease、sequence gap、有界缓冲、多视图 fan-out、重复/冲突/旧 lease 拒绝 | `packages/workbench-core/src/events.js` |
| X1.6 用量适配 | 原始 usage 哈希与归属、真实事件位置提取、normalized/raw 一致性校验 | `packages/workbench-core/src/usage.js` |
| X1.7 用量账本 | 幂等去重、可见冲突/损坏、乱序与多级修正、循环拒绝、快照恢复 | `packages/workbench-core/src/ledger.js` |
| X1.8 JSONL repository | 注入 IO、损坏行报告、append 失败不推进、压缩前备份、原子替换保护 | `packages/workbench-core/src/repository.js` |
| X1.9 wire 录制 | 既有默认关闭、脱敏、大小限制、轮转与 RuntimeClient 9 项回归继续通过；本轮未改 | `packages/testkit/test/runtime-client.test.mjs` |
| 架构与工作区注册 | 新增第 8 组纯核心边界；lockfile 仅新增 workbench-core link 与包条目 | `check-architecture.mjs`、`package-lock.json` |
| 回归 | 聚焦 22/22；完整 220/220；Studio 38 文件/525 项；typecheck 通过；主 Renderer 29 modules 构建通过 | `evidence/x1-core-20261125` |

### 未验证 / 未完成

| 项目 | 当前结论 | 下一步 / 前置条件 |
|---|---|---|
| XG0 物理显示器 | 用户决定本轮跳过，仍只有单屏与恢复 fixture 证据 | 第二块物理显示器；双屏、混合 DPI、负坐标、热插拔、旋转 |
| XG0 媒体与系统授权 | 用户决定本轮跳过，fake-device fail-closed 不等于真实媒体验收 | 真实摄像头/麦克风与 Windows 权限弹窗 |
| XG0 E-05 外部适配器 | 用户决定本轮跳过，仍无真实 provider/凭据/费用/回执 | 真实 ASR/judge/MCP/Agent 适配器与用户授权 |
| XG1 Runtime additive 方法 | **已批准并实现**；七方法、严格 capability、structured error、TS/Python client parity | 冻结契约与真实进程结果见 `F:\workbuddy data\deliverables\dsh-studio\xg1-runtime-20261125` |
| XG1 真实多会话 | **已通过**；真实四会话 queue/draft/steer/cancel、seq 0 连续事件、C 允许/D 拒绝审批隔离 | `runtime-control-e2e-run6.json`、`runtime-control-wire-run6.jsonl` |
| XG1 聚焦回归 | Runtime 88/88；Renderer 40/40；Studio Main 243 pass/1 skip/0 fail；Renderer 构建与 typecheck 通过 | `xg1-runtime-20261125` 归档日志 |
| X1 持久化生产接入 | JSONL IO 仍由测试内存适配器验证，未接 Electron Main | 宿主 IO 适配与真实磁盘故障测试 |
| Renderer 全量回归 | **已通过**；288 文件、544 suites、2,132 tests，0 失败、0 跳过 | `docs/evidence/renderer-regression-20261125/REPORT.md`；原始本地归档 `F:\workbuddy data\deliverables\dsh-studio\renderer-regression-20261125`；无 XG1 修改前 clean baseline |
| Runtime 全仓回归 | **未通过，未完成 clean-tag 基线对照**；17 files/68 tests failed | 实现阶段全仓日志；不得由 Renderer 全量通过推断 Runtime 全仓通过 |
| XG1 | **协议门通过**；Renderer 全量套件已通过；XG0 与 Runtime 全仓回归仍分别未通过 | 保留延期项、Runtime 失败簇与未验证边界 |

详细协议与验收口径见 `docs/X1-CONTROL-EVENT-USAGE.md`。

### 未验证 / 未完成

| 项目 | 当前结论 | 下一步 / 前置条件 |
|---|---|---|
| X0.8 / XC-07 | 单显示器环境与恢复 fixture 已验证 | 第二块物理显示器；验证双屏、负坐标、混合 DPI、热插拔与旋转 |
| X0.9 / E-06 | 标准安装版已验证 DevTools、Renderer 入口、危险外链拒绝、关窗清理，以及 3 轮 BrowserView OS 资源回收和虚拟媒体 fail-closed；浏览器 IPC 门仍关闭 | 生产持久登录入口、真实摄像头/麦克风与 Windows 权限弹窗 |
| X0.10 / E-05 | 34 个入口的代码/契约拒绝与无副作用回归已通过 | 真实 ASR/judge/MCP/Agent 适配器、provider、凭据、权限、预算、费用确认与回执 |
| XA-10 真机层 | 安装版 Runtime/PTY/Files/Git/重载/关窗清理与 BrowserView 3 轮资源回收已通过 | 真实 Runtime 拒退出与超时关闭 |
| 分发层 | 标准 NSIS 安装包已生成、隔离安装并启动 | 代码签名、签名更新源与真实自动更新升级；最终品牌图标定稿 |
| XG0 | **仍未通过**；XG1 协议门已通过 | 双屏、物理媒体与 E-05 外部项按用户决定延期但保持未验证；XG1 通过不解除 XG0 门禁 |

## Electron Main 实测

命令：`npx electron apps/desktop/scripts/environment-probe.cjs`

```json
{
  "capturedAt": "2026-11-24T08:39:39.563Z",
  "platform": "win32",
  "versions": {
    "electron": "45.4.1",
    "node": "24.22.3",
    "chrome": "156.0.8078.100"
  },
  "nodeSqlite": { "available": true, "databaseSync": true, "error": null },
  "safeStorage": { "available": true, "error": null },
  "displays": {
    "available": true,
    "count": 1,
    "displays": [
      {
        "id": 941220576,
        "label": "S2719DGF",
        "bounds": { "x": 0, "y": 0, "width": 1920, "height": 1080 },
        "workArea": { "x": 0, "y": 0, "width": 1920, "height": 1032 },
        "scaleFactor": 1,
        "rotation": 0,
        "internal": false
      }
    ],
    "error": null
  }
}
```

结论：Electron Main 的 Node、SQLite 和 safeStorage 能力均可用；本机当前只探到一个显示器，多显示器恢复策略不能在本机完成双屏实测。普通 Node 下 `require('electron')` 不能替代本探针。

## 修改前关键文件 SHA-256

```text
b15fe8c347f62b7a638d53bd0b824b66b81ff0f9562af870f402d24277b674c9  apps/desktop/src/main.js
0ce12c760f9321cb34d4cc0a233dd03b9fd6a65ef7008d9cf6ae48fed9bedd6b  apps/desktop/src/preload.cjs
c345bd8b6c3a8a511ee1052c7cb53ebc2d591e040afd4b5aee0ae0c392eec2ca  apps/desktop/src/studio-bridge.js
f3cc8b08558c3cd516aaca2692b283be5f8d6a347e1f81f7a9a53a633b0dadec  packages/runtime-client/src/index.js
52d0c8e9e9616e662777f4c63dd83f3d18ad6356646ab4466a5c2b99f08d556d  packages/host-services/src/index.js
623a6ea478156a2837100a237250cf311d1c960fe0c12fbdb6332290e1386177  packages/contract/src/projection.js
9f897604b8b1206fdbaec798fa038d57969110b9e27d063bfe37e2be41644131  package.json
2a95f5619114f5bd0230fc03a848b15f9278b77feff22fc8c41cad838a034f5c  package-lock.json
```

## P0 缺陷定位

| 级别 | 位置 | 问题 | X0 处理 |
|---|---|---|---|
| P0 | `packages/runtime-client/src/index.js` 的服务端请求分支 | 微任务内无人响应即自动取消，Main 异步 IPC 响应必然竞态 | 改为显式请求登记、超时取消、一次性幂等响应 |
| P0 | `apps/desktop/src/studio-bridge.js` | 无 owner 时以 `[undefined]` 广播，跨会话事件会串线 | 无 owner 不投递，审批校验响应者归属 |
| P0 | `packages/host-services/src/index.js` | 从 `turn/end` 读取 usage，真实事件在 `assistant/message.data.usage` | 按真实协议位置摄入并补回归 |
| P0 | `apps/desktop/src/main.js` | 原生终端与 OMP 终端分别记账，OMP 关窗未统一清理 | 统一 PTY Registry，按 owner 校验和清理 |
| P1 | `packages/runtime-client/src/index.js` | wire 原样 JSONL，桌面默认总开启录制 | 默认关闭，显式开启时脱敏并限制文件大小 |
| P1 | `apps/desktop/src/main.js` | 浏览器单例、无 partition、URL scheme 未收窄 | 本批做威胁模型与安全边界，宿主改造留待浏览器工作包 |
| P1 | `packages/testkit/test/studio-ui-shell.test.mjs` | 旧断言拒绝合法 `react/jsx-runtime`，只允许 sidebar | 按当前 main+sidebar 实现修正陈旧断言 |

## X0 本轮实施记录（2026-11-24）

本轮只做可靠底座，不修改视觉、窗口系统、Runtime 上游协议或 `apps/renderer-omp/vendor/omp`；未安装依赖，未提交、推送或发布。**历史记录：依赖安装状态已被 2026-11-25 授权操作取代；提交、推送、发布仍未执行。**

### 已满足且有回归证据

| WBS / 验收 | 结果 | 证据 |
|---|---|---|
| X0.1 / XA-01 | 已记录 HEAD、既有脏工作树、修改前测试和关键文件哈希；未 reset/clean | 本文“修改前关键文件 SHA-256”及 Git 基线 |
| X0.3 / XA-02 | 服务端请求跨微任务存活；带稳定 requestId/expiresAt；超时 fail-closed；响应和审计均只结算一次 | `packages/testkit/test/runtime-client.test.mjs` 前 2 项 |
| X0.4 / XA-03、XA-04 | bridge 按 session owner 投递；无 owner 不广播；foreign context 不能响应审批；最后 owner 离开即取消 | `packages/testkit/test/subagents.test.mjs` 后 3 项 |
| X0.5 / XA-07 | usage 从真实 `assistant/message.data.usage` 读取，`turn/end` 仅兼容回退且不覆盖已有 assistant usage | `packages/testkit/test/host-services-usage.test.mjs` 3 项 |
| X0.6 / XA-10（代码与 PTY 真机层） | native/OMP 共用 PTY Registry；按 owner 校验 write/resize/dispose；PTY 复用 ID 后旧 data/exit 回调被 generation 身份丢弃；真实 Electron 启动 2 个 WSL PTY，输出 ready 标记后经 Registry 释放，OS 存活进程 2→0、Registry 2→0；loopback 测试页进一步通过真实主窗口关窗验证 Runtime/PTY 代理进程 6→0 | `packages/testkit/test/terminal-service.test.mjs` 4 项；`terminal-process-probe.cjs`、`desktop-lifecycle-probe.mjs` 真实 Electron 45.4.1 通过；生产 renderer/打包 App 未验 |
| X0.7 / XA-09（环境层） | Electron Main 内实测 Node、SQLite、safeStorage、显示器矩阵 | 本文 Electron Main 实测 JSON |
| X0.11（失败测试部分） | 旧 `studio-ui-shell` 测试按当前 main+sidebar 与 JSX runtime 修正，未删断言掩盖回归 | `packages/testkit/test/studio-ui-shell.test.mjs` 8 项 |
| X0.2 / XA-01 | Runtime 协议事实表已落盘；Web descriptor、SDK stdio 与 Desktop Bridge 分层，R-01～R-08 已同步 | `docs/X0-RUNTIME-CAPABILITIES.md` |
| X0.9 / XA-11、XA-13（审计与工程层） | 浏览器威胁模型、B-T01～B-T10 与 B-SEC-01～B-SEC-11 基线已建立；B-T01～B-T10 生产安全控制已接线，26 项浏览器单测、真实 Electron 拒绝探针、真实 React 外链点击与 fake-device 权限拒绝通过；真实跨域重定向/iframe/远程主导航、3 轮 BrowserView OS 清理和持久 partition 重启恢复已用 loopback 验证；4 个危险 scheme 与 2 个主窗口远程导航事件另有合成分派证据 | `docs/X0-BROWSER-THREAT-MODEL.md`；生产包已启动并验证 DevTools/外链拒绝/关窗清理，但含 BrowserView 的生产包资源计数、生产持久登录入口、真实媒体设备与系统权限弹窗仍未覆盖，浏览器功能门仍未通过 |
| X0.10 / XA-14、XD-17（审计层） | 外部能力矩阵、disabled/unsupported 条件、凭据/费用边界与最小拒绝契约已建立 | `docs/X0-EXTERNAL-CAPABILITIES.md` |
| Runtime 假成功修复 | resume 失败不 completed；conversation.open 在 resume 成功后才切会话；steer 不退化 prompt；queue read 不伪造空；模型无适配层时 adaptation 明确失败；manifest 分级；MCP configured 不伪装 connected；Skills 磁盘发现不伪装运行时身份 | `packages/testkit/test/runtime-capabilities.test.mjs` 15 项 |
| X0.10 / E-05（代码/契约层） | 34 个云听写、Evaluation、Benchmark、MCP 与 Agent 控制入口在 query/command 分支前拒绝；manifest 全为 `unavailable`；68 次回归调用无 Runtime query/fetch、无 result、无输入修改 | `runtime-capabilities.test.mjs` 后 4 项；真实 ASR/judge/MCP/Agent 适配器、权限、费用与 provider 回执仍未实现 |
| Evaluation 假通过修复 | 工具终态但无 exitCode 为 `unknown`，只有显式 0 为 pass | `agentTestRuns.test.ts` 已纳入标准 Vitest；`studio:test` 525/525 通过 |
| X0.10 / E-01～E-03 | MCP 按当前插件注册解析，配置状态不等于连接；Skills 保持 discovered/configured 与 loaded/session 分离；configured plugin 不再显示为 loaded 或计入已加入 | `dsh-assets.test.mjs` 2 项、`runtime-capabilities.test.mjs` 后 2 项；`extensibilityMap.test.ts` 2 场景已纳入标准 Vitest |
| X0.10 / E-04（代码/契约与构建层） | Computer/SSH/BTW/gallery 六类 fixture 由生产 Vite alias 排除；独立 preview harness 是唯一 opt-out；URL/存储不能开启生产 preview；主文档、局部 surface、native float 强制标识；`/btw`、`/computer` 在普通发送、follow-up、排队立即纠偏的副作用前拒绝；修复 Vite 8 正则 alias 保留 `./` 的缺陷；两个 renderer 已用 `--minify=false` 完成真实生产构建 | `production-preview-boundary.test.mjs` 6 项、`external-slash-boundary.test.mjs` 7 项；PreviewContext 4/4、NativeFloat 1/1 已纳入标准 Vitest。默认压缩 build 的 LightningCSS 缺口已在 2026-11-25 关闭，当前结果见本文顶部 |
| X1.9 前置 / XA-12 | wire 录制默认关闭；显式开启时仅诊断副本脱敏，真实 wire 不变；大小限制与轮转生效；Runtime 启动失败/stdin EPIPE 可恢复，旧进程退出不污染新进程，stop 等待退出，超时或拒退出的进程明确失败并终止；真实 SDK 两轮正常启停/重启及 OS PID 退出通过 | `packages/testkit/test/runtime-client.test.mjs` 9 项；`runtime-lifecycle-probe.mjs` 两轮真实 SDK 通过，未发送 prompt |
| Main IPC 收窄 | `runtime:respond-request`、terminal IPC 仅接受主窗口主 frame；审批结算同步 bridge/renderer | `apps/desktop/src/main.js`、`preload.cjs`、`apps/renderer/src/App.jsx` |
| X0.9 / E-06（安全工程层） | 全部特权 IPC 增加 webContents/mainFrame/精确 Renderer URL 门；浏览器 view 使用独立内存 session，导航/重定向/子框架、弹窗、下载、权限、DevTools 与 crash 清理已接线；packaged 无 dist 时拒绝开发入口回退；BrowserView 关闭不等待 beforeunload；preload 浏览器 API 保持关闭 | `src/browser-security.js`、`browser-security.test.mjs` 26/26、`browser-security-probe.cjs` 真实 Electron 45.4.1 通过；正式浏览器仍未开放 |
| X0.9 / B-T10（渲染层安全） | 普通外链统一严格 HTTP(S) 解析，mailto 单独校验，扩展 scheme 必须结构合法且已注册；Markdown、资源、搜索引用、GitHub、更新、凭证、Skillshare、终端与后台任务均走同一激活/渲染边界；非法值不可点击；合法点击经 `ompStudioChrome.openUrl` 到 Main 再校验后调用 OS handler，主窗口不创建新 Electron 窗口 | `browser/urlSafety.ts`、`browserLinks.tsx`、`renderer-link-safety.test.mjs` 8/8；全渲染层 raw anchor/window.open 静态审计通过；真实 Electron + React 点击 `isTrusted:true`，非法链接为 inert span，未产生导航或新窗口；生产包桥存在且拒绝 `javascript:` |

### 跨模块审计修复（2026-11-24）

三组只读审计分别覆盖 Runtime/Bridge/PTY、Browser/Main、E-04/E-05。以下问题已全部修复并补回归；审计本身与单测不等于真机门禁通过。

| 级别 | 位置 | 缺陷 | 修复与证据 |
|---|---|---|---|
| 高 | `studio-bridge.js` `interaction.respond` | 缺失或未知 decision 默认按允许一次处理 | 只接受 `submit\|cancel`；缺失/未知/大小写变体均 `INVALID_ARGUMENT`，不响应 Runtime；`runtime-capabilities.test.mjs` |
| 中 | `terminal-service.js` data/exit 回调 | kill 后复用同一终端 ID，旧 PTY 迟到回调污染新终端 | 回调验证当前 Registry entry 身份；kill→重建→旧 data/exit→新 data/exit 回归；`terminal-service.test.mjs` |
| 中 | `studio-bridge.js` 会话切换 | query/command 切会话遗留旧会话孤儿审批；`conversation.open` 先切后 resume | 切换后取消孤儿审批；open 等待 Runtime resume 成功后才切；`runtime-capabilities.test.mjs`、`subagents.test.mjs` |
| 中 | `host-services/src/index.js` 事件折叠 | legacy `turn/end.usage` 覆盖真实 assistant usage | assistant usage 优先；纯事件回放回归；`host-services-usage.test.mjs` 3/3 |
| 低 | `runtime-client/src/index.js` 生命周期 | spawn error 后 child/record 残留；stdin EPIPE 无监听；旧 exit 清新 child；stop 不等待退出 | 按 child generation 清理；stdin error fail-closed；pending 即时失败；stop 等待 exit，超时明确失败并终止拒退出进程；9 项 fake ChildProcess 回归覆盖故障注入，另有真实 SDK 两轮正常启停/重启探针，未冒充拒退出真机证据 |
| 低 | `studio-bridge.js` tool/result | `callOwner` 不释放，长会话无界增长 | result 后立即删除；重复 result 不得继承旧 turn 归属；`subagents.test.mjs` |
| 高 | `main.js`、`browser-security.js` | packaged 无 dist 时回退 loopback 5173，可能信任本机恶意监听 | packaged 禁止开发回退；缺失入口直接失败；`browser-security.test.mjs` |
| 中 | `main.js` App 退出 | before-quit 不等待 Runtime 与 PTY 清理 | preventDefault 后 await `runtime.stop()`，失败也走 finally 退出；静态接线回归；真实 Electron + loopback 测试页关窗后 Runtime/PTY 代理 OS 进程 6→0，生产包仍未验 |
| 中 | `main.js` BrowserView 关闭 | 默认 close 等待 beforeunload，存在关闭竞态 | 强制 `waitForBeforeUnload:false`；静态回归与真实 Electron 浏览器探针复跑通过 |
| 高 | `WorkbenchCanvas.tsx` 排队立即纠偏 | 排队消息改为 `/btw`、`/computer` 后仍取消审批并 steer | reject 前移到删队列、取消审批、steer 之前；拒绝顺序静态回归 |
| 低 | `WorkbenchCanvas.tsx` follow-up | 拒绝外部命令前已清草稿 | 先 plan/reject，再清草稿；保留原输入；拒绝顺序静态回归 |
| 中 | `studio-bridge.js` `models.adaptation.resolve` | 无适配层仍返回 resolved 假成功 | 明确 `CAPABILITY_UNAVAILABLE`，不返回选择；`runtime-capabilities.test.mjs` |

### 回归结果

- `npm test`：**198/198 通过，0 失败**（修改前为 96/103；修复 7 项旧失败，新增架构、显示恢复、Runtime、MCP、Skills、E-04、E-05、浏览器安全、跨模块审计、Renderer 外链、WSL 路径、Electron 45 导航事件与 Vite 8 alias 回归后总数 198）。
- `node packages/testkit/scripts/check-architecture.mjs`：**PASS**，扫描 1151 个文件、7 组规则；`packages/studio-ui` 的 Node/Electron/Runtime/Host 依赖边界由 4 项反例测试锁定。
- `node packages/testkit/scripts/check-entrypoint-alignment.mjs`：**PASS**，renderer 79 queries / 97 commands，bridge 99 cases / 124 explicit reasons。
- `runtime-capabilities.test.mjs`：**15/15 通过**。E-05 的 34 个入口分别从 query 与 command 调用，共 68 次：全部 `CAPABILITY_UNAVAILABLE`，Runtime query/fetch 均为 0，命令无 result，冻结输入不变，manifest 34/34 为 `unavailable`。
- `external-slash-boundary.test.mjs`：**7/7**；`production-preview-boundary.test.mjs`：**6/6**；两项聚焦回归合计 **13/13**。
- `browser-security.test.mjs`：**26/26 通过**。真实 Electron **45.4.1** 探针确认 workspace session 与 default 不同、页面无 Node/桌面桥接全局对象、真实跨域重定向 1、iframe 1、BrowserView 远程主导航 1 与主窗口远程导航 1 均到达 handler 并拒绝、下载 1/1 阻止、popup 1 拒绝、DevTools 打开事件 1 后关闭、可信 IPC 成功而 foreign/child IPC 拒绝、workspace B/default session 的 cookie/localStorage 为空、主窗口 hide/show 3 轮后 view 保持安全、renderer crash 后销毁。导航事件确认 `detailsObject:true`、主框架 `isMainFrame:true`；已修复把 deprecated 第三位置参数 `isSameDocument` 误读为 `isMainFrame` 的缺陷。真实 `file:`/`data:` location 尝试未离开安全页且未产生 Electron 导航事件；另行向已安装 handler 分派 4 个危险 scheme 与 2 个主窗口远程导航事件并全部 preventDefault，二者证据分开记录。fake-device 探针让 `getUserMedia` 到达已安装权限 handler，返回 `NotAllowedError`；该结果证明 fail-closed，不代表真实设备或 Windows 系统权限弹窗已验收。
- BrowserView 真机资源回归：同一 Electron 探针完成 **3 轮独立创建/关闭**，Renderer OS PID 5432、9188、25424 在关闭后均退出，`will-frame-navigate` 监听器为 0，WebContents 数量回到基线；PID 为该次运行证据，不是稳定标识。这仍是 loopback Electron 证据，不是打包 App 证据。
- `browser-partition-restart-probe.cjs`：以两个独立 Electron **45.4.1** 进程 seed/verify，`persist:dsh-workspace-restart-…` 的持久 cookie（含 `Max-Age`）与 localStorage 在重启后恢复，sessionStorage 不恢复，control partition 的 cookie/localStorage 为空，且未使用 default session。生产入口仍为非持久 session，生产包恢复验收未完成。
- `renderer-link-safety.test.mjs`：**8/8 通过**。覆盖严格 HTTP(S)、危险/凭证/控制字符/畸形/超长 URL、地址栏裸主机推断、mailto、扩展 scheme 拒绝，以及全渲染层 raw anchor 和 `window.open` sink 审计；仅允许归一化变量、内部 hash 链接、受 `parseFileReference` 保护的本地文件链接和 Main 签发的 native float ticket。
- `desktop-lifecycle-path.test.mjs`：**3/3 通过**。Windows 路径按 `wsl.exe -d <distro> -- wslpath -u` 契约转换，反斜杠先归一为正斜杠以避免 WSL 命令行转义；POSIX 路径直通，相对路径/控制字符/非法输出拒绝；生命周期探针不再写死 `/mnt/f`。
- `terminal-process-probe.cjs`：真实 Electron **45.4.1** + Ubuntu/qtt199 启动 native/OMP 两个 WSL PTY，均收到 ready 标记；foreign write/dispose 被拒；Registry 释放 2 个后 OS 存活进程为 0、Registry 为 0。
- `runtime-lifecycle-probe.mjs`：真实 WSL DSH SDK 连续两轮 `initialize → shutdown → OS PID 退出 → restart` 通过；出站方法严格为 `initialize/shutdown` 两轮，server requests 为 0，pending 为 0，prompts 为 0；拒退出/超时仍只有 fake ChildProcess 证据。
- `desktop-lifecycle-probe.mjs`：真实 Electron **45.4.1** Main 使用明确标记的 loopback 测试页，Windows cwd 经真实 `wslpath` 转换，Runtime ready 且 native/OMP PTY ready 后关闭真实主窗口；Electron 退出码 0，native PID 已退出，Runtime/PTY 相关 `wsl.exe`/ConPTY 代理 OS 进程 6→0，prompts 为 0。这不是生产 renderer build、Chromium 浏览器 view 或打包 App 证据。
- `PreviewContext.test.tsx` 4 个场景、`NativeFloat.test.tsx` 1 个行为、`agentTestRuns.test.ts` 3 个场景与 `extensibilityMap.test.ts` 2 个场景均已纳入标准 Vitest；`npm run studio:test` 总计 **38 个文件、525/525 通过**，不再以 Node 类型剥离或直接执行替代标准测试。
- `node --check apps/desktop/src/main.js apps/desktop/src/browser-security.js apps/desktop/scripts/browser-security-probe.cjs apps/desktop/scripts/browser-partition-restart-probe.cjs`：通过；架构、入口与浏览器聚焦回归在跨模块修复后复跑通过。
- `git diff --check`：无空白错误；仅有 `package-lock.json` 的既有 CRLF→LF 提示。
- 工具链已在 WSL 构建副本 `/home/qtt199/projects/dsh-studio-xg0` 恢复，未执行 npm install、未改 lockfile。`npm run studio:typecheck` 与 `npm run studio:build` 通过（`lib/client.js` 220.9 KB）；标准 Vitest 525/525 通过。两个 renderer 使用 `vite build --minify=false` 分别完成 **29 modules / 224ms** 与 **3082 modules / 1.96s** 的真实生产构建，产物已进入便携生产包并完成真机启动。**历史记录：依赖与 lockfile 状态已被 2026-11-25 的授权安装与恢复取代。**
- 默认 `vite build` 仍失败于 `vite:css-post`：缺少 `lightningcss.linux-x64-gnu.node`。搜索现有依赖与 npm cache 未找到该 Linux binding；本阶段禁止安装依赖，因此**不宣称默认压缩构建或完整 `npm run check` 通过**。Vite 8 的 configLoader/esbuild/optimizeDeps 弃用警告不影响已观察到的非压缩构建成功。**历史记录：该缺口已在 2026-11-25 关闭，当前结果见本文顶部。**

### XG0 完整验证收尾（2026-11-24 · 历史便携包）

- 生产包位置：`F:\workbuddy data\deliverables\dsh-studio\xg0-production-20261124-2330`。由现有 Electron 45.4.1 Windows 发行目录、`@electron/asar 4.2.0` 生成的 `resources/app.asar`、解包的 `node-pty` Windows prebuild 与非压缩生产 Renderer 组成；**不是 electron-builder/electron-packager 标准安装包验收**。
- ASAR SHA-256：`cf70c3f4576970675e404eae4fed9ccf31f32879164f8c2229c6bc944029140a`；含 360 个文件，Main 25930 字节、preload 5392 字节、RuntimeClient 15071 字节；`node-pty` Windows binding 303104 字节且位于 `app.asar.unpacked`。Renderer 338 个文件，入口 `index.html` SHA-256 为 `d9274c6469f653a7fa39e37e20682900f1f1184c4413ec49a72610c0cd7fb263`。
- 生产包真实启动并加载 `file:///F:/workbuddy%20data/.../resources/renderer-omp/dist/index.html`，Runtime `state:ready`，serverInfo 为 `deepseek-harness-sdk-runtime / 0.0.1`，cwd 为真实项目 `/mnt/f/projects/dsh-studio`；未使用开发服务器回退。Renderer 重载后 `readyState:complete`、Runtime 仍 ready、exception 与 console error 均为 0。
- 生产包 Files/Git：目录读取 26 项，包含 `.git/apps/docs/node_modules`；`package.json` 的 name 为 `dsh-studio`；Git changes 返回 258 条。生产包原生 node-pty：create、写入 `DSH_PACKAGED_PTY_OK`、读取标记、resize 100×30 均通过，kill 后 OS PID 24412 不存在。
- 生产包 DevTools：F12 与 Ctrl+Shift+I 前后均只有 1 个 page target、0 个 devtools target。`ompStudioChrome.openUrl` 已进入 ASAR，非法 `javascript:` URL 被拒绝；合法 URL 的真实 React 点击另在 Electron 探针中到达桥边界，未实际启动系统浏览器或邮件客户端。
- 生产包关窗：主进程 PID 26052、Runtime `wsl.exe` PID 27788、Renderer PID 24996、GPU PID 24000、Network PID 26800 与 PTY PID 24412 均已确认不存在；stdout 记录 `[studio] main window closed`。截图与 JSON 证据为 `packaged-run-3.png`、`packaged-run-3.json`。
- 媒体与硬件：fake device 下 `getUserMedia` 返回 `NotAllowedError`，证明权限 handler fail-closed；Pnp 核查为 0 摄像头、0 麦克风，Electron 仅 1 个活动显示器。物理媒体采集、Windows 系统权限弹窗、双屏/异 DPI/拔插/旋转不能由 fixture 替代。
- 机器可读证据汇总：`F:\workbuddy data\deliverables\dsh-studio\xg0-production-20261124-2330\verification-summary.json`，记录最终回归、构建状态、包哈希、进程清理、硬件盘点与未关闭门禁；与本文及 `packaged-run-3.json` 分开保留。

### 未验证 / 未完成（2026-11-25 更新）

| 项目 | 当前结论 | 下一步 / 前置条件 |
|---|---|---|
| X0.2 完整协议事实表 | 已完成控制、事件、usage、fork/restore 与 unsupported 状态事实表 | `docs/X0-RUNTIME-CAPABILITIES.md`；Web 端点在线可用性仍未验证 |
| X0.8 / XC-07 | Electron 显示器探针可用；已冻结 DIP、负坐标、不同 DPI、旋转、拔屏、屏外与超大窗口的恢复策略 fixture；生产环境确认只有 1 个活动显示器 | 双屏、负坐标、不同 DPI、拔屏和旋转仍需真实双显示器环境；fixture 位于 `packages/testkit/fixtures/x0/display-recovery.json` |
| X0.9 / XA-11、XA-13 | B-T01～B-T10 生产控制已接线；26/26 浏览器安全单测、真实 Electron 拒绝、真实 React 外链点击、持久 partition 跨重启恢复、安装版 DevTools/入口/危险外链拒绝通过；安装版 BrowserView 3 轮 OS 资源回收与 fake-device 音频/视频权限拒绝通过 | `docs/X0-BROWSER-THREAT-MODEL.md` 与交付 `evidence/installed-browser-probe.json`；生产持久登录入口、真实媒体设备与系统权限弹窗仍未覆盖，不开放正式浏览器 |
| X0.10 / XA-14、XD-17 | 外部能力矩阵与拒绝契约已完成；resume/steer/queue/Evaluation 假成功已修；E-01～E-03 已修复并有回归；E-04 标准构建已关闭，E-05 代码/契约层已关闭 | E-05 真实 ASR/judge/MCP/Agent 适配器、provider、凭据、权限、预算、费用确认与回执仍缺；E-06 仍阻塞 |
| X0.11 / XF-01（工程层） | 旧失败测试已修；默认压缩主 Renderer 29 modules、OMP 3082/3123 modules；`npm run check` 198/198、标准 Vitest 525/525、`studio:typecheck`、`studio:build`、架构/入口检查均通过 | 无构建缺口；后续依赖升级需保留平台可选依赖与 alias 回归 |
| E-04 生产 bundle 层 | 六类 fixture 已由生产 alias 与默认压缩 Vite build 排除；alias 完整 specifier 回归 6/6；标准安装版构建通过 | `ExecutionTargets.tsx` 仍在生产图且有遗留远端 UI 分支，但 preload 无真实 remote API，不宣称完整 SSH 实现或代码已排除 |
| XA-10 真机层 | 安装版 Runtime ready、Files/Git、PTY ready→输出→resize→kill→PID 退出、Renderer 重载、15 个子进程关窗清理，以及独立 BrowserView 3 轮资源回收通过 | 真实 Runtime 拒退出/超时仍只有 fake ChildProcess 证据；BrowserView 探针关窗后 10 个跟踪子进程全部退出 |
| 分发层 | 标准 NSIS 安装包已生成、隔离安装并完成核心真机冒烟；安装包与 ASAR 哈希已归档 | 代码签名、签名更新源与真实自动更新升级未验证；最终品牌图标未定稿 |
| XG0 | **未通过**，不得据此进入 X1 生产实现 | E-05 真实适配器/权限/费用/回执、E-06 剩余浏览器覆盖、真实媒体设备与双屏真机、Runtime 拒退出、签名/自动更新关闭后再评审；硬件/外部授权阻塞不伪造通过 |
