# DSH Studio 原生工作台建设方案

版本：2.3  
日期：2026-11-24  
状态：待评审；本方案不授权实现、构建、测试、提交或发布。  
历史版本：1.0 OMP 二开迁移方案的历史思路已由本方案取代；2.1 完成 DSH 原生化重写；2.2 增加 OMP Quiet Instrument 美化资源来源、原生化抽取与许可门禁；2.3 增加 shadcn/ui、Seelen UI、Oh My Zsh 的零新增依赖原生化融合与许可边界。  
美化细则：[DSH Studio 工作台视觉融合计划](DSH-WORKBENCH-VISUAL-INTEGRATION-PLAN.md)

## 1. 结论

本次工作定义为：**把 OMP 工作台的交互能力沉淀为 DSH 自己的原生工作台产品，而不是继续维护一个 OMP fork。**

最终形态必须同时满足：

1. 桌面入口是 DSH 原生 `apps/renderer`，产品包名、模块名、IPC、全局 API、存储 schema 全部使用 DSH 命名。
2. 工作台只依赖 `@dsh-studio/*`、React 和明确列出的通用依赖；生产代码、包配置和构建入口中不得出现 `@omp-studio/*`、`vendor/omp`、`ompStudio*`、`dshStudio` OMP 桥或 `dockHost`。
3. 会话、文件、变更、终端、浏览器、日志、审批等能力直接适配 DSH Runtime/Host 与 `window.dsh`，不经过 OMP client、reducer、transport 或 capability manifest。
4. 布局核心从 DSH 已有的 `packages/studio-ui/src/workbench` 提炼为独立的 `@dsh-studio/workbench-core`；桌面端与 Web Host 插件共享同一套 DSH 布局模型。
5. OMP 只作为交互行为参考、旧布局的一次性迁移来源，以及 `ui_reference/ver2` 的 Quiet Instrument 视觉基线；shadcn/ui、Seelen UI、Oh My Zsh 分别作为组件可访问模式、Windows 桌面壳交互和状态分段语法的参考源。视觉资源一次性原生化到 DSH 自有令牌、React 组件和图标中，不引入上游页面、全局对象、包、脚本、运行时或长期兼容层；Seelen 因采用 AGPL 许可，只做零代码/素材的独立重实现。
6. 旧 `renderer-omp`、OMP vendor、OMP bridge 在切换验收通过后退出产品；删除动作单独批准，不在本方案阶段执行。

不建议继续在 `apps/renderer-omp` 上增加 DSH 接缝。当前目录已深度绑定 OMP 契约，仅改名称或替换存储键仍然是二开，不是原生。

## 2. 现状与可复用资产

### 2.1 当前 OMP 耦合事实

只读盘点结果：

- `apps/renderer-omp/package.json:23-27` 直接依赖 `vendor/omp/packages/{client,client-contract,studio-protocol,transport-desktop,transport-web}`。
- `src/dsh/client.ts:10-52` 用 `StudioClientImpl + createDesktopTransport` 把 `window.dshStudio` 适配成 OMP Desktop API。
- `src/conversationWorkspace/client.ts:1-3,52-125` 依赖 OMP `ClientState`、`ClientBootstrap`、事件 scope 和查询契约。
- 非测试源码中仍有约 242 个文件引用 `@omp-studio/client-contract`，约 201 个文件引用 `@omp-studio/studio-protocol`；其中大量是类型引用，但仍是删除 vendor 的阻塞项。
- `src/main.tsx`、`src/vite-env.d.ts` 及约 58 个非测试文件依赖 `ompStudioChrome`、`ompStudioPerf` 或 `ompStudioTerminal`。
- Dock 与 Conversation 仍写 `omp.dock.v1`、`omp.conversation-workspace.v1` 等键。
- `apps/desktop/src/preload.cjs:75-111` 暴露的 `dshStudio` 与 `ompStudioTerminal` 是 OMP 桥，不是 DSH 原生 API。

因此，“保留 OMP 状态机、只补 DSH 接缝”不能达到本次要求。

### 2.2 DSH 原生资产

| 资产 | 当前位置 | 原生改造中的用途 |
| --- | --- | --- |
| Runtime stdio 客户端 | `packages/runtime-client/src/index.js` | 保持 DSH Runtime 启动与 JSON-RPC 链路 |
| Renderer wire contract | `packages/contract/src/index.js` | 会话事件投影、read model、ready/empty/unavailable |
| Electron 原生 API | `apps/desktop/src/preload.cjs:3-73` 的 `window.dsh` | 会话、文件、Git、终端、浏览器、日志、审批的唯一桌面端口 |
| DSH 原生简单 Renderer | `apps/renderer/src/App.jsx` | 演进的桌面产品入口与真实 Runtime 回归基线 |
| 纯布局模型 | `packages/studio-ui/src/workbench/layout.ts` | 提炼 split/tab/float/pin/minimized 核心 |
| 六种模板 | `packages/studio-ui/src/workbench/templates.ts` | 作为 DSH 模板实现与测试基线 |
| 布局操作与历史 | `packages/studio-ui/src/workbench/ops.ts`、`ui-workbench/controller.ts` | 提炼为 DSH controller/history |
| 吸附几何 | `packages/studio-ui/src/workbench/snap.ts` | 提炼为 DSH 几何模块 |
| React 工作台组件 | `packages/studio-ui/src/ui-workbench/*` | 提炼为无 Runtime 依赖的 `workbench-ui` |
| 会话端口与租约 | `packages/studio-ui/src/ui-session-views/*` | 形成 DSH 会话订阅、保活、释放契约 |
| Web Host 插件组合 | `packages/studio-ui/src/shell/*` | 继续作为 Web Host 消费层，不反向依赖桌面端 |

这些资产已经是 DSH 原生实现。原生建设应以它们为主底座，而不是把 OMP 代码搬进新目录。

## 3. 目标与非目标

### 3.1 目标

- 对话与工具可在主区、标签、左/紧凑/右/底栏、应用内浮窗、独立系统窗口之间移动。
- 六种吸附模板、分隔条约束、拖出、吸附预览、取消与焦点顺序完整可用。
- 五档 Pin：`none / workspace / application / window / topmost`。
- 每个 DSH workspace/session/draft 的布局隔离；应用默认、项目默认、继承、预设、锁定、撤销与最近关闭正确。
- 移动、最小化、隐藏、切换标签不复制会话、不停止生成、不重复订阅、不整窗重折。
- 独立 Electron 窗口只承载正文 DOM，不创建第二份 Runtime 连接。
- DSH Runtime 是唯一业务事实源；未实现能力不展示，不写假数据，不静默成功。
- 布局存储使用 DSH schema，损坏可恢复，旧 OMP/DSH v2 布局可一次性导入。
- 桌面端与 Web Host 共享 DSH 布局核心，但保持各自宿主适配边界。
- 工作台完成 DSH 原生视觉美化：以 OMP `ui_reference/ver2` 的 Quiet Instrument 为一次性视觉基线，融合 shadcn/ui 的可组合与可访问组件模式、Seelen UI 的应用内桌面壳/窗口交互模式、Oh My Zsh 的真实状态分段语法，统一原生化到 DSH 自有 `workbench-ui`；覆盖统一层级、间距、圆角、阴影、图标、交互状态和轻量动效，并覆盖对话与工具内容的可读性。四个参考项目均不成为依赖。
- 产品最终移除 OMP 运行时、vendor、全局桥和 `renderer-omp` 入口。

### 3.2 非目标

- 不恢复 OMP Browser、Computer、BTW、Annotations、Evaluation、Selective Commit 等无 DSH 真实能力的模块。
- 不移植 OMP Runtime fork、patch stack、TUI、tmux、更新器、安装器。
- 不把 OMP client/reducer/transport 重命名后伪装成 DSH 原生实现。
- 不修改 DSH Runtime 协议、权限、审批、模型路由或附件 receipt 语义。
- 不重做 DSH 产品命名、Logo 与关键品牌识别；工作台配色、表面和组件视觉采用 Quiet Instrument 基线，由 shadcn 组件模式、Seelen 应用内桌面壳交互和 Oh My Zsh 状态分段补充，并由 DSH 设计令牌统一管理。
- 不为美化安装或引入 shadcn CLI/registry、Radix/Base UI、Tailwind、Tauri/Rust、Seelen 资源/插件、Zsh/Oh My Zsh、Nerd Font、远程字体或相关替代 UI 依赖；不接管 Windows 桌面，不执行 shell 主题或探测脚本。
- 不为美化新增装饰图片、远程字体或与业务无关的动效，也不改变 Runtime、权限或数据语义。
- 不把消息、工具输出、运行状态、附件明文或终端实例写入布局。
- 不自动删除旧目录、旧依赖或旧存储键；退出动作需单独批准。

## 4. 原生目标架构

```text
packages/
  contract/                       DSH Runtime wire contract，保持现有边界
  workbench-core/                 新增，零 React/DOM/Runtime
    model.ts / ops.ts / history.ts DSH 内容身份、布局树、Pin、窗口状态
    geometry.ts / templates.ts     snap、六种模板、分隔条与 rect 校验
    persistence.ts / migration.ts  schema、备份、恢复与旧数据导入
  workbench-ui/                   新增，纯 React 展示与交互
    dock/ tab/ float/ panel-host/ document-host/
  studio-ui/                      DSH Web Host 插件，改为消费上述两个包

apps/
  renderer/                       DSH 桌面原生产品入口
    src/platform/dsh/             window.dsh 端口、能力、面板适配
    src/platform/native/          Electron 工作台窗口客户端
    src/workbench/                桌面组合层与页面
  desktop/
    src/workbench-windows.js      DSH Electron 系统窗口服务
    src/workbench-host-preload.cjs 子窗口最小 ready 握手
    src/preload.cjs               主窗口暴露 dsh + dshWorkbenchWindows
```

依赖方向：

- `workbench-core` 不依赖 React、DOM、Electron、Runtime 或任何 OMP 包。
- `workbench-ui` 只依赖 core 与 React，通过 props/ports 接收内容和能力。
- `apps/renderer` 负责把 DSH Runtime、文件系统、终端和 Electron 能力接入 UI。
- `packages/studio-ui` 负责把同一 core/UI 接入 DSH Web Host，不依赖桌面端。
- Desktop Main 只负责窗口、票据、安全和几何，不理解会话业务。

### 4.4 OMP Quiet Instrument 美化资源原生化

美化是原生工作台的正式交付要求，不是覆盖 OMP 页面或叠加装饰皮肤。只读核查确认：OMP Studio 0.2.8 没有独立、可安装的 theme/ui/design/beautify 包；实际可用来源是 `F:\projects\omp-studio-ref\ui_reference\ver2` 静态设计系统。

#### 4.4.1 来源边界

| 类别 | 处理 |
| --- | --- |
| `ui_reference/ver2/styles/tokens.css` | 作为配色、字体、字号、间距、控件高度、圆角、阴影和动效的首要基线 |
| `styles/base.css`、`components.css` 及区域 CSS | 提取适用于 DSH 的规则，重写为 DSH 语义类、React 组件和 CSS 层，不整页搬运 |
| `js/icons.js` | 只提取所需通用线性图标路径，转为 DSH TSX 图标组件；不复制 IIFE、`window.OMP` 注册或工具映射 |
| `__shots/*.png` | 仅作一次性视觉对照，不进入产品包，也不要求 DSH 与 OMP 布局逐像素一致 |
| `data/`、`js/store.js`、`bus.js`、`scenarios.js`、`screens.js`、`app.js` | 禁止复用，全部属于 mock 原型运行时 |
| `ui_reference/chat` | 不使用；其 CDN 依赖与“内部使用”标注尚未厘清 |
| `packaging/ui/styles.css` | 不使用；它属于 720×480 安装向导，不是工作台设计系统 |
| `apps/renderer/src/icons.tsx` | 不直接复制；GitHub 图标含 Primer Octicons 资产，品牌图标另有许可与商标核查要求 |

运行时只允许使用 DSH 仓库内的 `packages/workbench-ui/src/styles`、DSH 图标组件和组件样式。产品不得 import OMP 包、读取 OMP 绝对路径、请求 OMP CDN 或依赖 `window.OMP`。

#### 4.4.2 视觉基线

- 方向：Quiet Instrument。结构由边框和表面层级建立，不堆叠厚重阴影；颜色主要表达语义；静止时安静，仅 Running、Awaiting Approval、Error 主动吸引注意。
- 字体：沿用 OMP 的系统字体回退栈，不下载字体；UI 使用 Inter/Segoe UI/PingFang SC/微软雅黑等回退，代码使用 JetBrains Mono/SF Mono/Cascadia Code/Consolas 等回退。
- 文本尺度：10.5/11.5/12.5/13/14.5/16/20/26px；正文、辅助文字和代码分别映射到语义令牌，不直接写死字号。
- 间距与几何：使用 2/4/6/8/12/16/20/24/32/48px 阶梯；圆角使用 3/4/6/8/999px；侧栏参考 272px，最小 208px、最大 440px、迷你 48px，但由 DSH 布局约束最终决定。
- 表面与语义：以 OMP 暗色 `#0E1116 / #151A21 / #1C222B`、亮色 `#F7F6F4 / #FFFFFF` 及紫、蓝、绿、黄、红语义色为初始基线；DSH 令牌层负责主题映射，组件禁止 raw hex。
- 状态：hover 只提升一级背景，不位移、不缩放；focus-visible 使用 2px accent ring；selected 使用低对比强调背景和状态指示；disabled 保持可读。
- 动效：fast/base/slow 采用 120/180/260ms，缓动采用 `cubic-bezier(.2,.8,.2,1)`；主要动画 opacity/transform，`prefers-reduced-motion` 将时长降至 0.01ms。Running 可有语义脉冲，流式正文不做持续装饰动画。

#### 4.4.3 DSH 原生适配

- 视觉范围覆盖应用壳、侧栏、Dock、标签、面板头、浮窗、最小化胶囊、系统窗口标题栏、Composer、消息、工具块、代码、Diff、终端边框、滚动条及 empty/loading/unavailable/error。
- OMP 的 26px 小按钮只作为视觉高度参考；DSH 通过内边距或独立命中层保证常规点击目标至少 28×28px、主要操作至少 32×32px，不为美观牺牲可访问性。
- 不继承 `base.css` 的 `body { min-width: 880px; }`；DSH 仍按 1024/1280/1440/1920 宽度做响应式验收，小视口优先折叠非关键装饰。
- OMP 专用类名、env 菜单、mock 状态和页面结构改为 DSH 语义；不保留跨系统 CSS 选择器或全局覆盖层。
- 主题与密度由 DSH 单一令牌源管理，桌面端与 Web Host 共用；系统窗口只同步令牌，不加载第二份 OMP 样式。
- 正文对比度至少 4.5:1，大字与关键 UI 至少 3:1；所有 OMP 色值必须经 DSH 实际前景/背景组合复测，不能把源项目声明当作验收结果。

#### 4.4.4 许可与资产台账

- OMP 根许可证为 MIT，版权声明为 `Copyright (c) 2026 snowpear and OMP Studio contributors`。复制或修改实质视觉内容时，产品第三方声明必须保留 MIT 全文及该声明。
- P0 冻结来源文件清单、SHA-256、来源路径、许可证、抽取内容和 DSH 目标文件，形成 `visual-asset-provenance.json`；来源本地目录不是 Git 仓库，不能虚构官方 commit。
- 只使用根 MIT 已覆盖且能证明来源的资产；无法确认许可的图标、品牌图、字体或图片不得进入产品。
- GitHub 图标如需保留，必须单独保留 Primer Octicons MIT 署名；默认不复制品牌图标、OMP Logo 或产品截图。
- 视觉门禁检查生产源码和构建产物无 mock JS、`window.OMP`、OMP 绝对路径、CDN 资源、远程字体、data URI 装饰图或未登记许可资产。

#### 4.4.5 验收

建立固定视口、固定 DSH fixture、字体栈、主题、密度和 DPI 的截图基线。OMP 截图只用于方向对照，DSH 原生截图才是产品回归基线。动态时间、流式文本、光标和系统阴影按固定规则屏蔽，不能用扩大容差隐藏截断、越界或状态缺失。

### 4.5 shadcn/ui、Seelen UI 与 Oh My Zsh 原生化融合

三个 GitHub 项目只提供设计模式与交互参考，不安装包、不 import 上游代码、不执行 CLI/安装器/主题脚本，也不改变 DSH Runtime 与权限边界。详细组件映射、Dock 状态模型、状态分段和来源白名单见 [DSH Studio 工作台视觉融合计划](DSH-WORKBENCH-VISUAL-INTEGRATION-PLAN.md)。

#### 4.5.1 来源与许可冻结

| 来源 | 2026-11-24 核查快照 | 许可 | 产品边界 |
| --- | --- | --- | --- |
| shadcn/ui | `shadcn-ui/ui`，`main`，`055aa6b7837b1808456a24beb4c97a677864aa82` | MIT；`Copyright (c) 2023 shadcn` | 默认独立重实现；复制或改编实质代码时保留 MIT 与声明 |
| Seelen UI | `eythaann/Seelen-UI`，`master`，`bc08d1f1b1894653ce6be52738cc6ca4c0e43a85` | GNU AGPL v3；包声明 `AGPL-3.0-or-later` | 只读参考抽象交互；零源码、CSS、SVG、图片、字体、主题包和插件 |
| Oh My Zsh | `ohmyzsh/ohmyzsh`，`master`，`6c31a91a3e82b4055b36cc088c2f27f81119ba60` | MIT；`Copyright (c) 2009-2026 Robby Russell and contributors (https://github.com/ohmyzsh/ohmyzsh/contributors)` | 默认只借鉴分段语法，React/CSS 独立重绘；不执行 shell；复制实质代码时保留 MIT 与声明 |

P0 必须重新核对 HEAD，冻结实际引用文件与 SHA-256。在线提交只作为本轮核查快照，不冒充已下载或已完成资产审查。

#### 4.5.2 四源分工

| 设计层 | 主参考 | DSH 原生化结果 |
| --- | --- | --- |
| 表面、字体、字号、间距、圆角、动效 | OMP Quiet Instrument | `tokens.css` 唯一 DSH 语义令牌 |
| 通用组件 anatomy、组合和可访问行为 | shadcn/ui | DSH Button/Dialog/Menu/Tabs/Tooltip/Command/Field/Toast 等原语 |
| 应用内 Dock、任务切换、窗口和吸附反馈 | Seelen UI | DSH Dock、任务切换器、WindowFrame、snap preview |
| 终端标题、路径、Git、运行与退出状态分段 | Oh My Zsh | DSH StatusSegments 与真实数据 view model |
| 冲突裁决 | DSH Runtime 真相与 Quiet Instrument | 可读性、可访问性和业务状态优先 |

不形成四套主题。Seelen 透明/模糊效果、shadcn Tailwind 类名、Oh My Zsh Powerline 字形均不得覆盖 DSH 令牌和 Quiet Instrument 层级。

#### 4.5.3 零新增依赖定义

- 不安装或 import shadcn/Seelen/Oh My Zsh 的包、主题、插件、资源或脚本。
- 不引入 Radix/Base UI、React Aria、Tailwind、CVA、clsx、tailwind-merge、cmdk、Sonner、next-themes、Tauri、Rust crate 或 Nerd Font。
- 焦点管理、键盘导航、ARIA、Dock、吸附和分段逻辑由 DSH 自己实现并测试。
- 既有 React、React DOM、Electron、Vitest、Testing Library、jsdom 和 xterm 按现有边界使用；本要求不是移除 DSH 基础依赖。
- 通过 package.json、lockfile、生产 import 和构建产物检查直接与传递依赖，禁止把上游 UI 栈换名引入。

#### 4.5.4 原生化范围

- **shadcn/ui**：Button、IconButton、Dialog、DropdownMenu、CommandMenu、Tabs、Tooltip、Popover、Select、Field、Switch、Separator、ScrollArea、ToastRegion、Skeleton。必须补齐 Dialog 焦点圈定/归还、Escape、Tabs roving tabindex、Command active descendant、Field 错误关联和 Toast live region。
- **Seelen UI**：Dock 左/中/右分组、固定/运行项、活动/运行/注意徽标、溢出、自动隐藏、任务切换、应用内吸附预览、标题栏和快速设置式紧凑面板。只作用于 DSH 应用；不接管 Explorer、任务栏、Alt+Tab、全局快捷键或 Windows shell hook。
- **Oh My Zsh**：Workspace/Path → Git → Runtime → Exit/Duration → Attention 分段。未知状态省略，不伪造 clean/success；路径和分支按不可信文本处理；不执行 shell、不读取 Token/环境变量、不向 PTY 注入状态栏字符串。

#### 4.5.5 验收要求

- 新增 `NV-14～NV-22`：shadcn 可访问原语、Seelen 桌面壳交互、Seelen 干净房间、Oh My Zsh 真值分段、状态栏安全、四源一致性、主题/密度覆盖、新表面动效性能、GitHub 来源许可台账。
- 新增 `NQ-14`：四个上游项目及其替代 UI 栈无新增直接/传递依赖。
- `visual-asset-provenance.json` 用 `extracted-asset / adapted-code / clean-room-reference` 区分资产类型；Seelen 只允许 `clean-room-reference`。
- `THIRD_PARTY_NOTICES.md` 按实际复制/改编情况保留 OMP、shadcn/ui、Oh My Zsh 的 MIT 全文与精确版权声明；不把 AGPL 参考误登记为已复制资产。
- 生产源码、包配置和构建产物不得包含上游源码路径、CLI 片段、shell 安装代码、Tauri/Rust 资源、CDN、远程字体或未登记资产。

## 5. DSH Runtime 与面板适配

### 5.1 唯一会话端口

桌面端新增 `DshRuntimePort`，只封装 `window.dsh` 的现有能力：

- `info/createSession/query/listSessions/openSession`
- `onNotification/onState/onReady/onRequest`
- `listDir/readFile/gitChanges/gitDiff`
- `terminalStart/Write/Resize/Kill` 与终端事件
- `browserShow/Bounds/Hide/Navigate/State` 与浏览器事件
- `logsTail/logsClear/onLogAppend`

端口层负责错误归一化、订阅取消和 epoch fence，不发明新的 Runtime 协议。会话事件投影继续使用 `@dsh-studio/contract`。

### 5.2 面板注册表

每个面板必须声明：

```text
id
title
minSize
requiredCapabilities
mountPolicy: keep-alive | release-on-close
component
```

能力分三层：

1. 本地是否注册真实适配器。
2. 当前 DSH Host/Desktop 是否提供所需 API。
3. 本次读取是 `ready / empty / unavailable`。

规则：

- 本地未实现：隐藏。
- Host 不支持：禁用并说明，不发送假命令。
- 读取失败：保留入口，显示 unavailable 与重试。
- 空结果：显示 empty，不替换为演示数据。
- 恢复布局、预设、Pin、菜单和回收站统一经过同一能力过滤器。

### 5.3 会话生命周期

- 同一 session 只保留一个事件订阅和一份派生状态缓存。
- 多个视图通过 lease 共享引用；最后一个引用释放时才退订。
- 关闭视图只释放 UI lease，不调用 `session.cancel()`，不删除 Runtime session。
- Runtime 断线保留布局、草稿和队列；重连后按 epoch 丢弃旧事件。
- 窗口移动复用 document host 和 Composer DOM，不重新创建会话客户端。

## 6. 布局模型与身份

### 6.1 DSH 内容身份

```text
ConversationRef =
  | { kind: "conversation"; sessionId: string }
  | { kind: "conversation"; draftId: string }

PanelRef =
  | { kind: "panel"; panelId: string; instanceId: string }
```

不再使用 OMP 的 target/workspace/session/draft/thread/history/preview 八元组。DSH 桌面 scope 使用：

```text
(hostId, workspaceId, sessionId | draftId)
```

- `hostId` 标识当前 DSH Runtime/Host 实例。
- `workspaceId` 来自 DSH 项目/工作区，不用显示名称代替。
- 草稿使用本地稳定 UUID，不因窗口移动或 React 重挂载变化。
- 同一 session 的多个 tab/view 共享同一业务状态。

### 6.2 单一布局状态源

`WorkbenchLayout` 是唯一布局真相：

- root split/pane/tab tree。
- floats 与 minimized records。
- focused pane/tab/window。
- Pin 与窗口几何。

禁止再维护第二套“右栏状态”“浮动列表”“窗口顺序”或“会话运行状态”。DSH 业务状态由 RuntimePort 和 read model 提供。

### 6.3 五档 Pin

| Pin | DSH 语义 |
| --- | --- |
| `none` | 当前工作区普通浮窗 |
| `workspace` | 同 workspace 共享实例 |
| `application` | 跨 workspace 借用，按 owner 规则 |
| `window` | 独立 Electron 窗口 |
| `topmost` | 独立 Electron 窗口并置顶 |

`window/topmost` 只有在 Main、preload、Renderer 三层能力都 ready 时开放。能力缺失时回退应用内浮窗，不留空白宿主。

## 7. 存储与一次性迁移

### 7.1 DSH 原生存储

主键：

```text
dsh.workbench.state.v1
dsh.workbench.state.v1.backup
```

结构：

```text
{
  schema: "dsh.workbench.state",
  version: 1,
  revision: number,
  preferences: {
    applicationDefault?: WorkbenchLayout,
    locked?: boolean,
    recentClosed?: [...]
  },
  presets: [...],
  workspaces: {
    [workspaceKey]: {
      sessions: { [sessionKey]: WorkbenchLayout },
      projectDefault?: WorkbenchLayout
    }
  }
}
```

- `workspaceKey` 是 `(hostId, workspaceId)` 的无歧义编码；`sessionKey` 显式区分 session 与 draft。
- 应用默认、项目默认、会话布局的继承顺序为：应用默认 → 项目默认 → 会话布局。
- 单一主键拥有全部布局几何，避免 Dock/Conversation 双写冲突。
- 外层 envelope 版本与 `WorkbenchLayout.version` 分开。
- 200ms 防抖；`pagehide` 同步 flush。
- backup 是最近一次成功快照，每次成功写入前滚动更新。
- 主备均损坏时使用默认布局，不阻止应用启动。
- 写入失败保留内存状态并显示一次非阻塞错误。
- 预览状态只驻留内存，不写真实布局键。

### 7.2 读取优先级

1. `dsh.workbench.state.v1` 主备快照。
2. 已有 DSH Web Host 布局键 `dsh.workbench.v2:*`。
3. 旧 OMP 键 `omp.dock.v1`、`omp.conversation-workspace.v1`、`omp.layoutMemory.*`。
4. DSH 默认布局。

### 7.3 迁移原则

- 迁移器是纯数据转换，不 import `@omp-studio/*`，不启动 OMP Runtime。
- 首次导入前保存迁移报告和源快照哈希；旧键保持不变，不自动删除。
- 过滤未知面板、悬空引用、非法几何和不可用 native Pin。
- 无法解析的内容进入隔离备份，不跨 workspace/session 合并。
- 新键存在后不重复导入旧数据。
- 完整回滚时恢复迁移前快照；回滚版本不读新键，布局可能回到迁移前状态。

## 8. DSH 独立系统窗口

### 8.1 原生协议

通道：

| 通道 | 方向 | 用途 |
| --- | --- | --- |
| `dsh:workbench-window:prepare` | 主 Renderer → Main | 创建一次性票据 |
| `dsh:workbench-window:control` | 主 Renderer → Main | ready/focus/minimize/maximize/close/topmost/showMain |
| `dsh:workbench-window:ready` | 子 Renderer → Main | 子窗口宿主完成挂载 |
| `dsh:workbench-window:changed` | Main → 主 Renderer | close-request/closed/state |

全局 API：

- 主窗口：`dshWorkbenchWindows`，只暴露 prepare/control/changed。
- 子窗口：`dshWorkbenchHost.ready(key)`，不暴露 `dsh`、terminal、Runtime 或控制 API。

子窗口 URL 使用 `?workbenchHost=<key>`，不再使用 `dockHost`。

### 8.2 安全与生命周期

- 随机、一次性、30 秒 TTL 票据，绑定 sender、document、key 和完整 URL。
- 开发模式校验完整 URL；file 模式校验实际 dist 路径，不信任 `null` origin。
- 只允许精确匹配的 URL/frameName 开窗。
- 子窗口 `contextIsolation:true`、`nodeIntegration:false`、`sandbox:true`。
- 禁止任意导航和新开窗口；外部 URL 在 DSH allowlist 落地前全部拒绝。
- 子窗口只承载 portal DOM，不挂载 App，不创建第二个 Runtime 连接。
- 主窗口关闭时清理子窗口、票据和监听器。
- 关闭子窗口不停止 Runtime 任务。
- 打开失败、ready 超时或票据失败时回退应用内浮窗并显示可见原因。
- 几何使用 DIP 与目标显示器 `workArea`；保存 normal bounds。

## 9. 文件级改造方向

### 新增 DSH 原生模块

- `packages/workbench-core/**`：模型、操作、几何、模板、Pin、历史、持久化、迁移。
- `packages/workbench-ui/**`：Dock、Tab、Float、PanelHost、DocumentHost 等纯 React 组件。
- `packages/workbench-ui/src/components/primitives/**`：DSH 原生 Button/Dialog/Menu/Tabs/Tooltip/Command/Field/Toast 等可访问原语。
- `packages/workbench-ui/src/components/dock/**`：应用内 Dock、任务切换与活动项状态。
- `packages/workbench-ui/src/components/window-frame/**`：主窗口与系统窗口共享标题栏。
- `packages/workbench-ui/src/components/status-segments/**`：Workspace/Git/Runtime/Exit 状态分段。
- `apps/renderer/src/platform/dsh/statusViewModel.ts`：真实 DSH 状态到分段 view model 的投影。
- `packages/workbench-ui/src/styles/tokens.css`：从 OMP Quiet Instrument 原生化抽取并融合三类参考模式的 DSH 唯一主题令牌源。
- `packages/workbench-ui/src/styles/workbench.css`：DSH 组件基础样式，不加载 OMP 原始 CSS。
- `packages/workbench-ui/src/icons.tsx`：DSH 线性图标组件与必要路径数据。
- `packages/workbench-ui/visual-asset-provenance.json`：OMP 可抽取资产与 shadcn/ui、Seelen UI、Oh My Zsh 的来源分类、固定快照、SHA-256、许可证、抽取/修改范围与 DSH 目标文件。
- 产品 `THIRD_PARTY_NOTICES.md`：OMP MIT 全文、版权声明及实际采用资产的第三方许可；Seelen 仅登记只读参考，不复制 AGPL 资产。
- `apps/renderer/src/platform/dsh/**`：RuntimePort、能力注册表、DSH 面板适配。
- `apps/renderer/src/platform/native/**`：系统窗口类型化客户端。
- `apps/renderer/src/workbench/**`：桌面工作台组合层。
- `apps/desktop/src/workbench-windows.js`
- `apps/desktop/src/workbench-windows-shared.js`
- `apps/desktop/src/workbench-host-preload.cjs`
- `packages/testkit/scripts/check-native-workbench.mjs`
- `packages/testkit/scripts/check-workbench-visual-assets.mjs`：视觉资产来源、许可、Seelen 零代码/素材、mock/全局 API/CDN 残留门禁。
- `packages/testkit/scripts/check-workbench-dependencies.mjs`：禁止上游 UI/Shell/Zsh 栈与新增直接/传递依赖门禁。
- `packages/testkit/scripts/native-workbench-smoke.mjs`

### 修改 DSH 原生入口

- `apps/renderer/package.json`：工作台构建、类型检查、测试与 core/UI 依赖。
- `apps/renderer/src/main.jsx`：切换到原生工作台入口。
- `apps/renderer/src/App.jsx`：保留为 DSH 原生紧急回退 UI，不依赖 OMP。
- `apps/desktop/src/main.js`：加载 `apps/renderer/dist`，注册 DSH 工作台窗口服务。
- `apps/desktop/src/preload.cjs`：保留 `window.dsh`，新增 `dshWorkbenchWindows`；OMP 桥在切换后移除。
- 根 `package.json`：默认 dev/check 指向 DSH 原生 renderer；增加 workbench-core/UI 质量门。
- `packages/studio-ui/package.json` 与内部 import：改为消费 `@dsh-studio/workbench-core`、`@dsh-studio/workbench-ui`。

### 切换后退出，需单独批准

- `apps/renderer-omp/**`
- `apps/renderer-omp/vendor/omp/**`
- `omp-patch/vendor/oh-my-pi/**`
- 五个 `@omp-studio/*` 依赖及 lock 记录
- `apps/desktop/src/studio-bridge.js`
- `dshStudio`、`ompStudioTerminal`、`ompStudioChrome` 等全局桥
- OMP 专用 harness、fixture、patch 和入口脚本

退出前必须提供文件清单、哈希、消费者归零证明和回滚包，不自动删除。

## 10. 分阶段实施

### P0：原生基线冻结

- 登记当前脏工作树与用户既有改动。
- 盘点全部 OMP 运行时、类型、存储、全局桥和构建依赖。
- 冻结 OMP `ui_reference/ver2` 美化来源文件、SHA-256、MIT/第三方许可与允许抽取清单。
- 冻结 shadcn/ui、Seelen UI、Oh My Zsh 的仓库快照、许可与使用分类；Seelen 只能登记为干净房间参考，三类来源均不进入运行时依赖。
- 冻结 DSH RuntimePort、内容身份、布局 schema 和面板能力契约。
- 记录现有 DSH Renderer 与 studio-ui 测试基线。
- 输出 OMP 退出清单，不在本阶段删除。

退出条件：原生边界无歧义，所有现有改动有保护清单。

### P1：提炼 DSH 工作台核心

- 从 studio-ui 提炼 `workbench-core` 与 `workbench-ui`。
- 统一 Pin 命名、内容身份、几何、历史、持久化和校验。
- 补六种模板、最小尺寸、撤销、scope、损坏恢复测试。
- 先冻结共享 core/UI 接口；P6 再把 studio-ui 切换到新包并完成 Web Host 回归。

退出条件：core 零 React/DOM/Runtime/OMP 依赖，布局单测全绿。

### P2：构建 DSH 原生桌面工作台

- 在 `apps/renderer` 实现 RuntimePort、能力注册表和会话 lease。
- 接入对话、文件、变更、终端、浏览器、日志与审批。
- 实现主区、标签、Dock、浮窗、最小化和稳定 DocumentHost。
- 保持草稿、队列、断线重连和真实/预览隔离。

退出条件：桌面工作台不 import OMP，真实 DSH 会话可用。

### P3：完整布局行为

- 拖拽、吸附、六种模板、分隔条、Pin、预设、锁定、撤销和最近关闭。
- 应用默认、项目默认、继承与 workspace/session 隔离。
- 流式输出中移动窗口不重折、不断流、不增订阅。
- 将 OMP Quiet Instrument 令牌、基础规则、组件规则和必要图标原生化到 DSH `workbench-ui`，补齐 DSH 命中区、响应式与语义状态。
- 以 DSH 原生 React/CSS 实现 shadcn 模式的可访问组件原语、Seelen 模式的应用内 Dock/任务切换/吸附反馈、Oh My Zsh 模式的真实状态分段；不引入上游包、shell、字体或 Windows 桌面接管。
- 完成工作台组件、消息与工具内容的状态化美化，并建立 DSH 自己的截图基线。
- 执行视觉资产来源/许可门禁和零新增依赖门禁，确保无 mock JS、OMP 全局 API、CDN、远程字体、Seelen 代码/素材或第二套主题。

退出条件：完整布局矩阵与视觉基线通过，无第二状态源或第二套主题样式。

### P4：DSH 独立系统窗口

- 实现 DSH IPC、主/子 preload、票据与 Renderer 客户端。
- 接入 portal、主题、标题、几何、置顶和失败回退，系统窗口标题栏与主窗口视觉一致。
- 完成 Windows 多屏、DPI、负坐标、拔屏和安全测试。

退出条件：系统窗口真实可用，安全门禁通过。

### P5：迁移与入口切换

- 实现 DSH v2/OMP 一次性迁移器。
- 用独立 Electron profile 做迁移、损坏、回滚演练。
- 完成工作台、消息与工具内容的视觉验收和多 DPI 截图回归。
- 验收 shadcn 原语键盘行为、Seelen 应用内桌面壳交互、Oh My Zsh 真值分段、四源视觉一致性、GitHub 来源许可和零新增依赖。
- 将默认入口切到 DSH 原生 renderer。
- 保留 DSH 原生简单 UI 作为紧急回退，不保留 OMP 产品入口。

退出条件：新入口默认启动，迁移可恢复，真实 Runtime 与视觉回归通过。

### P6：OMP 退出与交付

- 删除或停用 OMP bridge、依赖、vendor 和 renderer-omp。
- 仓库级架构门禁确保生产代码无 OMP 运行时残留。
- 更新台账、限制与未验证项。
- 提交、推送、发布仍须用户另行明确授权。

退出条件：产品是 DSH 原生工作台，OMP 仅存在于迁移代码、历史记录和明确标注的参考资料中。

## 11. 验收摘要

### 11.1 原生性

- [ ] 生产包、源码、构建配置无 `@omp-studio/*`、`vendor/omp`、`ompStudio*`、`dshStudio`、`dockHost`。
- [ ] 桌面工作台直接使用 `window.dsh` 与 `@dsh-studio/contract`。
- [ ] 默认入口是 `apps/renderer`，不再启动 `renderer-omp`。
- [ ] core/UI 可独立测试，不依赖 OMP Runtime 或 vendor。

### 11.2 布局与窗口

- [ ] 六种吸附模板、分隔条、拖出、取消、焦点正确。
- [ ] 五档 Pin、预设、撤销、锁定、最近关闭正确。
- [ ] workspace/session/draft 布局互不污染。
- [ ] 独立系统窗口、置顶、最大化、恢复、关闭正确。
- [ ] 能力缺失时回退应用内浮窗，无空白窗口。

### 11.3 DSH 真值与生命周期

- [ ] 所有开放面板读取 DSH 真实数据。
- [ ] 移动窗口不增加 Runtime 订阅，不停止生成，不丢 chunk。
- [ ] 关闭视图释放 lease，但不取消 Runtime 任务。
- [ ] 断线重连、附件、审批、停止和 steer 不回归。
- [ ] 子窗口不继承宽 preload，不创建第二 client。

### 11.4 存储与退出

- [ ] DSH schema 主备恢复、写入失败降级、滚动备份通过。
- [ ] DSH v2/OMP 旧布局一次性迁移，旧键不删除。
- [ ] 迁移不 import OMP 包，不启动 OMP Runtime。
- [ ] OMP 退出清单、回滚包和消费者归零证明完整。

### 11.5 视觉与美化

- [ ] OMP `ui_reference/ver2` 的 Quiet Instrument 基线已原生化到 DSH 自有令牌、组件和图标；运行时不依赖 OMP 路径、包或全局对象。
- [ ] 工作台与内容样式全部来自统一 DSH 设计令牌，无第二套主题源、raw hex 或远程字体。
- [ ] Dock、标签、浮窗、胶囊、系统窗口标题栏和面板头层级一致。
- [ ] 消息、工具块、代码、Diff、终端与滚动条清晰可读，业务状态不被遮挡。
- [ ] hover/active/focus/disabled/drag/snap/loading/empty/error 状态完整。
- [ ] 已有主题、键盘焦点、对比度、28/32px 点击目标、减少动效设置通过。
- [ ] 1024–1920 宽度及 100%/150%/200% DPI 无截断、发虚或越界。
- [ ] 固定 DSH fixture 截图基线通过，OMP 截图仅作来源对照，动态内容屏蔽规则可重复。
- [ ] MIT 全文、版权声明、第三方图标许可和视觉资产 provenance/SHA-256 台账完整。
- [ ] shadcn/ui 原生原语的 ARIA、键盘、焦点圈定/归还、Tabs/Command 导航和表单错误关联通过。
- [ ] Seelen 模式只落入 DSH 应用内 Dock、任务切换、吸附和窗口反馈；无 Seelen 源码/素材、Explorer hook、Tauri/Rust 或桌面接管。
- [ ] Oh My Zsh 分段只显示真实 DSH 状态，未知字段省略；无 shell 执行、PTY 注入、Token 读取或特殊字体依赖。
- [ ] 四源职责与冲突优先级一致，主题/密度完整，无第二套主题或新增直接/传递依赖。
- [ ] 生产源码与构建产物无 mock JS、`window.OMP`、OMP 绝对路径、CDN、远程字体、上游安装/CLI 片段或未登记资产。

## 12. 风险与回滚

| 风险 | 处理 |
| --- | --- |
| 把 OMP fork 改名后继续运行 | 架构门禁禁止 OMP import/全局桥，验收检查产物依赖 |
| 新建 core 与 studio-ui 形成两套布局 | 直接提炼现有 DSH core，studio-ui 与桌面共用 |
| 桌面与 Web Host 会话语义不同 | RuntimePort 保持窄端口，Web Host 继续使用 SessionPort |
| 窗口移动触发重复订阅 | 单一 SessionEventHub + lease registry + 计数断言 |
| 系统窗口暴露过宽权限 | 独立最小 preload、一次性票据、sender/URL/frame 校验 |
| 迁移跨 workspace 污染 | 未知身份隔离，不合并 null scope，保留源快照 |
| 删除 OMP 后无法回滚 | 切换验收后再退出，保留哈希与回滚包，删除单独批准 |
| 当前大量未提交改动被覆盖 | 只改点名文件，不 reset、不 clean、不批量删除 |
| 美化形成第二套主题或遮挡业务状态 | 统一设计令牌，真实数据截图与可访问性门禁 |
| 误把 OMP mock 原型或安装向导当美化包 | 来源白名单、原生抽取清单、mock/全局 API/CDN 零依赖门禁 |
| 复制图标或视觉资产但遗漏许可 | P0 来源哈希与许可台账，产品第三方声明，发布前资产核查 |
| 误把 Seelen AGPL 代码或素材当作可直接复用美化包 | Seelen 仅登记 clean-room-reference；零代码/素材与独立实现审查 |
| 为参考三个项目引入新 UI/Shell/Zsh 依赖 | 禁止 import/CLI/安装器；package.json、lock 与构建产物依赖门禁 |
| Oh My Zsh 分段伪造 Git/运行状态或泄漏路径/控制字符 | 仅消费 DSH 结构化事实，未知省略，React 文本渲染与控制字符清洗 |
| 四源风格叠加形成第二套主题或降低可读性 | Quiet Instrument 单一令牌、职责优先级、固定 DSH 截图基线 |

回滚分三层：

1. **功能回滚**：关闭系统窗口或新工作台开关，回到 DSH 原生简单 UI。
2. **数据回滚**：恢复迁移前快照或 DSH backup。
3. **代码回滚**：只撤销本任务点名改动，不丢弃用户既有修改。

## 13. 默认决策与验证边界

默认决策：

1. 目标产品是 `apps/renderer`，不是继续演进 `renderer-omp`。
2. 共享布局核放 `packages/workbench-core`，React 展示层放 `packages/workbench-ui`。
3. 桌面直接适配 `window.dsh`；Web Host 继续通过 SessionPort 接入。
4. 布局使用单一 DSH 主键，避免双键几何冲突。
5. OMP 仅用于行为参考、一次性迁移和 Quiet Instrument 视觉基线，不作为运行时依赖。
6. 独立系统窗口纳入原生目标。
7. 旧目录、依赖和桥的删除在 P6 单独批准。
8. 不提交、不推送、不发布。
9. 美化以 OMP `ui_reference/ver2` 为一次性来源，原生化进 DSH 自有设计令牌与组件；不安装所谓“美化包”，不复制 OMP 页面、mock 状态或全局 API。
10. shadcn/ui、Seelen UI、Oh My Zsh 只作为零新增依赖的设计与交互参考；Seelen 因 AGPL 许可只做零代码/素材的独立重实现。
11. 不提交、不推送、不发布。

本轮已完成 DSH/OMP 文档、关键源码和 OMP `ui_reference/ver2` 美化资源的只读核对，确认了 OMP 依赖规模、DSH 原生入口、studio-ui 布局资产、Quiet Instrument 视觉来源和退出阻塞；并完成 shadcn/ui、Seelen UI、Oh My Zsh 官方仓库、许可和原生化边界核查，形成四源融合细则。

Seelen UI 的许可证为 GNU AGPL v3，包声明为 `AGPL-3.0-or-later`，因此本方案不复制或翻译其源码与素材，只做独立重实现。shadcn/ui 与 Oh My Zsh 为 MIT；如后续复制或改编实质代码，必须保留对应版权和许可。

本轮**没有**执行构建、类型检查、单测或 Electron 真机操作。现有测试通过情况、Runtime 真数据行为、旧布局迁移结果和系统窗口多屏表现均未验证，需要在批准实施后由 P0 基线逐批闭环。
