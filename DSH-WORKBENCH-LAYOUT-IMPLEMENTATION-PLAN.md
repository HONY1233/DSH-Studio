# DSH Studio 原生工作台落地计划书

版本：2.3  
日期：2026-11-24  
状态：待批准执行  
上位方案：[DSH Studio 原生工作台建设方案](DSH-WORKBENCH-LAYOUT-PLAN.md)  
美化细则：[DSH Studio 工作台视觉融合计划](DSH-WORKBENCH-VISUAL-INTEGRATION-PLAN.md)  
授权边界：本文件只规定实施方法；未经用户明确批准，不修改源码、不安装依赖、不构建、不测试、不提交、不推送、不发布。

## 1. 文档目的与执行原则

本计划书把“OMP 工作台能力原生化”拆成可指派、可检查、可回滚的实施任务。执行时以本文的需求编号、任务编号、验收编号和完成定义为准。

执行原则：

1. 最终桌面产品是 DSH 原生 `apps/renderer`，不是继续维护 `apps/renderer-omp`。
2. 工作台核心从 DSH 已有 `packages/studio-ui` 提炼，形成 `@dsh-studio/workbench-core` 与 `@dsh-studio/workbench-ui`。
3. 桌面端直接适配 `window.dsh` 与 `@dsh-studio/contract`，不经过 OMP client、reducer、transport 或 capability manifest。
4. OMP 只作为行为参考和一次性数据迁移来源；视觉上以 `ui_reference/ver2` 的 Quiet Instrument 为一次性基线，原生化进 DSH 令牌、组件与图标。迁移和美化代码均不得 import OMP 包或复制 OMP mock 运行时。
5. shadcn/ui、Seelen UI、Oh My Zsh 只作为零新增依赖的设计与交互参考；不安装包、CLI、主题、插件或 shell 框架。Seelen 为 AGPL，只做零代码/素材的独立重实现。
6. DSH Runtime/Host 是唯一业务事实源；布局与美化视图只是本地偏好和真实数据的展示。
7. 美化使用来源白名单、SHA-256、许可证、来源分类和 provenance 台账；无法确认许可的资产不得进入产品。
8. 所有改动在当前工作树上增量进行，不 reset、不 clean、不批量删除、不恢复用户既有 OMP 专属文件。
9. 每批改动保持单一主题，先验证再汇报；不自动创建 Git commit。
10. 测试失败必须保留并说明，不通过删测试、跳过测试、伪造数据或放宽断言制造绿色。
11. 用户回复“继续 / 进行 / 开始”后，按本计划进入下一批准批次；遇到方案冲突或破坏性操作先停下。

## 2. 基线、范围与默认决策

### 2.1 实施基线

| 项目 | 当前事实 | 执行要求 |
| --- | --- | --- |
| DSH 仓库 | `F:\projects\dsh-studio` | 所有实施限定在该仓库 |
| 当前工作树 | 已有大量修改、删除和未跟踪文件 | P0 全量登记，实施后逐项比对，禁止覆盖 |
| 桌面主进程 | `apps/desktop/src/main.js` 当前优先加载 `renderer-omp/dist` | 最终改为加载 `apps/renderer/dist` |
| DSH 原生 Renderer | `apps/renderer`，直接使用 `window.dsh` | 作为唯一目标产品入口 |
| OMP Renderer | `apps/renderer-omp`，深度依赖 OMP 包与 vendor | 只作参考，P6 退出产品 |
| DSH 布局资产 | `packages/studio-ui/src/workbench`、`ui-workbench`、`ui-session-views` | 提炼为 DSH 共享 core/UI |
| Runtime contract | `packages/contract/src/index.js` | 保持现有事件投影与 read model |
| Desktop API | `apps/desktop/src/preload.cjs` 的 `window.dsh` | 作为桌面唯一 Runtime/Host 端口 |
| OMP 参考 | `F:\projects\omp-studio-ref`，包版本 0.2.8，不是 Git 仓库 | 只冻结行为、迁移样本与 `ui_reference/ver2` 视觉来源；不声称官方 commit |
| OMP 美化来源 | `ui_reference/ver2/styles/**`、`js/icons.js`、`__shots/*.png` | 无可安装美化包；只原生化抽取白名单资源，不复制 mock JS |
| OMP 许可证 | 根 `LICENSE` 为 MIT；`NOTICE` 未覆盖全部图标 | P0 建立资产台账，产品保留 OMP MIT，第三方图标逐项核查 |
| shadcn/ui | 官方 `shadcn-ui/ui`，快照 `055aa6b7`，MIT | 只参考组件 anatomy/可访问模式；默认独立重实现，不运行 registry CLI |
| Seelen UI | 官方 `eythaann/Seelen-UI`，快照 `bc08d1f1`，AGPL v3/`AGPL-3.0-or-later` | 只读参考桌面壳交互；零源码/素材，不引入 Tauri/Rust/资源系统 |
| Oh My Zsh | 官方 `ohmyzsh/ohmyzsh`，快照 `6c31a91a`，MIT | 只参考分段状态语法；不执行 zsh，不依赖 Nerd Font，不读取 Token/环境变量 |
| 美化依赖约束 | 四个参考项目均不是 DSH 运行时依赖 | 无新增直接/传递依赖，生产 import、package.json、lock 与 bundle 门禁 |
| 主要平台 | Windows x64 | 真机验收以 Windows 为准 |

### 2.2 范围内

- DSH 原生工作台 core/UI、桌面组合层和 RuntimePort。
- 对话、工具、标签、Dock、浮窗、吸附、最小化、Pin、预设、撤销、锁定、最近关闭。
- workspace/session/draft 布局隔离。
- DSH 单一布局存储、备份、损坏恢复、一次性迁移与回滚。
- DSH 面板能力过滤与 ready/empty/unavailable 状态。
- Electron 独立系统窗口及 DSH 安全协议。
- 会话 lease、事件订阅、DocumentHost、终端和项目读取生命周期。
- 基于 OMP Quiet Instrument 的 DSH 原生工作台与内容美化，并融合 shadcn/ui 可访问组件模式、Seelen UI 应用内桌面壳交互、Oh My Zsh 真实状态分段：设计令牌、视觉层级、交互状态、可访问性、轻量动效、资产来源/许可、零新增依赖和多尺寸与多 DPI 截图回归。
- 根开发/检查入口、架构门禁、CDP/Electron 真机验收。
- OMP bridge、依赖、vendor 和 renderer-omp 的退出清单与实施。

### 2.3 范围外

- OMP Browser、Computer、BTW、Annotations、Evaluation、Selective Commit 等功能恢复。
- OMP Runtime fork、patch stack、TUI、tmux、更新器、安装器。
- 把 OMP client/reducer/transport 重命名后继续作为 DSH 核心。
- DSH Runtime、权限、审批、模型路由、附件 receipt 协议改造。
- DSH 产品命名、Logo 与关键品牌识别不重做；工作台配色与组件视觉以 OMP Quiet Instrument 为基线，并统一进 DSH 设计令牌。
- 为美化新增装饰图片、远程字体、CDN 资源或与业务无关的持续动画。
- 安装或 import shadcn/ui、Radix/Base UI、Tailwind、Tauri/Rust、Seelen 资源/插件、Zsh/Oh My Zsh、Nerd Font 或相关替代 UI 栈。
- 接管 Windows Explorer、任务栏、Alt+Tab、全局快捷键或 Windows shell hook。
- 执行 shell 主题/探测脚本、向 PTY 注入状态栏字符串或从终端文本猜测 Git/Runtime 状态。
- 复制 OMP mock data/store/bus/scenarios/screens/app、`window.OMP` 全局对象、安装向导或 `ui_reference/chat` CDN 原型。
- 草稿正文和附件的磁盘持久化；本次只保证现有内存生命周期与布局身份恢复。
- 自动删除旧目录、旧依赖或旧存储键；P6 删除动作需单独批准。
- Git 提交、推送、发布和线上部署。

### 2.4 默认决策

| 决策 | 采用方案 |
| --- | --- |
| 桌面产品入口 | `apps/renderer`，默认开发端口回到 5173 |
| 共享布局核 | 新增 `@dsh-studio/workbench-core`，零 React/DOM/Runtime |
| 共享展示层 | 新增 `@dsh-studio/workbench-ui`，只依赖 core 与 React |
| Web Host 插件 | `packages/studio-ui` 改为消费共享 core/UI，不依赖桌面端 |
| Runtime 适配 | `DshRuntimePort` 封装 `window.dsh`，会话投影使用 `@dsh-studio/contract` |
| 布局存储 | 单一 `dsh.workbench.state.v1` 与 backup，避免双键几何冲突 |
| 旧数据 | DSH v2 优先，OMP 键一次性迁移；旧键只读保留 |
| 系统窗口 API | `dshWorkbenchWindows` / `dshWorkbenchHost`，不使用 OMP 全局名 |
| 子窗口宿主参数 | `?workbenchHost=<key>`，不使用 `dockHost` |
| OMP 退出 | 切换验收后单独批准删除；未批准则停用并从产品入口移除 |
| 测试策略 | core/UI/Renderer/Desktop 分层门禁，全仓记录基线 |
| 语言策略 | 保留现有 JSX，新增平台层使用 TS；采用渐进式 mixed JS/TS 类型检查，不全仓重写 |
| 视觉策略 | OMP Quiet Instrument 提供唯一基础令牌；shadcn/ui 提供可访问组件模式；Seelen UI 提供应用内桌面壳交互；Oh My Zsh 提供真实状态分段。全部原生化，不形成四套主题 |
| 许可策略 | OMP/shadcn/Oh My Zsh 的 MIT 按实际复制/改编保留；Seelen AGPL 仅作干净房间参考，零代码/素材 |
| 依赖策略 | 四个参考项目零新增直接/传递运行时依赖，禁止 CLI、安装器、主题脚本和替代 UI 栈 |
| 动效策略 | opacity/transform 为主，120/180/260ms；支持 prefers-reduced-motion，不装饰流式输出，仅允许语义状态脉冲 |
| 提交策略 | 只形成可评审变更集，不自动 commit |

## 3. 需求与追踪矩阵

优先级：P0 为启动条件，P1 为交付阻断，P2 为后续增强。

| 需求 ID | 优先级 | 需求 | 主要验收 |
| --- | --- | --- | --- |
| NW-01 | P0 | 默认桌面入口切换为 DSH 原生 renderer | NA-01、NQ-07、NQ-11 |
| NW-02 | P0 | 产品生产链路去除 OMP 运行时、vendor、全局桥和命名 | NA-02、NA-06、NM-13、NQ-10、ND-01～ND-08 |
| NW-03 | P0 | 桌面直接适配 DSH RuntimePort 与 contract | NA-03、NA-04、NA-05、NL-15 |
| NW-04 | P1 | 形成 DSH 共享布局 core/UI 与单一状态源 | NA-06～NA-08、NC-01～NC-04、NC-08、NC-09 |
| NW-05 | P1 | 六种吸附模板与分隔条约束完整 | NC-10～NC-16 |
| NW-06 | P1 | 标签、浮窗、最小化、五档 Pin、预设和最近关闭完整 | NC-03～NC-07、NL-01～NL-04、NL-12～NL-14 |
| NW-07 | P1 | 窗口操作不重建会话、不重复订阅、不停止生成 | NL-01～NL-11、NL-16 |
| NW-08 | P1 | DSH 独立系统窗口真实可用 | WX-01～WX-20、NC-07 |
| NW-09 | P1 | 系统窗口 IPC、票据、URL、导航和 bridge 暴露面安全 | WX-01～WX-09、WX-17～WX-20 |
| NW-10 | P1 | 不可用能力不展示、不恢复、不写假数据 | NA-05、NL-15、NM-06～NM-08 |
| NW-11 | P1 | DSH 存储、备份、一次性迁移和回滚完整 | NM-01～NM-15 |
| NW-12 | P0 | core/UI/Renderer/Desktop 质量门可重复执行 | NQ-01～NQ-11、NQ-14 |
| NW-13 | P1 | DSH 真数据、断线、附件、审批、停止和 steer 不回归 | NA-03～NA-05、NL-07、NL-09～NL-11、NL-15、NL-16 |
| NW-14 | P1 | OMP bridge、依赖、vendor 和旧入口退出产品 | ND-01～ND-08 |
| NW-15 | P1 | 功能、数据、代码三层回滚可演练 | NR-01～NR-06、NM-14 |
| NW-16 | P1 | 需求、任务、验收、风险和未验证项完整闭环 | NR-05、NR-06、NQ-10 |
| NW-17 | P1 | 工作台与内容基于 Quiet Instrument，融合 shadcn 组件模式、Seelen 桌面壳交互、Oh My Zsh 状态分段，完成 DSH 原生美化、可访问性、资产合规、零新增依赖和视觉回归 | NV-01～NV-22、NQ-12～NQ-14 |

## 4. 原生目标架构

### 4.1 模块边界

```text
packages/
  contract/                       既有 DSH Runtime wire contract
  workbench-core/                 新增
    model.ts / ops.ts / history.ts ContentRef、WorkbenchLayout、Pin、Scope
    geometry.ts / templates.ts     snap、templates、separator、rect 校验
    persistence.ts / migration.ts  schema、backup、decode/encode、迁移
  workbench-ui/                   新增
    dock/ tab/ float/ panel-host/ document-host/
    components/primitives/        DSH 可访问组件原语
    components/window-frame/      主窗口与系统窗口标题栏
    components/status-segments/   Workspace/Git/Runtime 状态分段
    styles/                        DSH 共享设计令牌与组件样式
  studio-ui/                      DSH Web Host 插件，消费 core/UI

apps/
  renderer/                       DSH 桌面原生产品入口
    src/platform/dsh/             RuntimePort、capabilities、panel adapters
    src/platform/native/          Electron workbench window client
    src/workbench/                桌面组合层
  desktop/
    src/workbench-windows.js      Electron 系统窗口服务
    src/workbench-windows-shared.js 通道与数据结构
    src/workbench-host-preload.cjs 子窗口最小 ready 握手
    src/preload.cjs               主窗口暴露 dsh + dshWorkbenchWindows
```

### 4.2 依赖规则

- `workbench-core` 不得 import React、DOM、Electron、Runtime 或任何 OMP 包。
- `workbench-ui` 只依赖 core、React 和 React DOM。
- `apps/renderer` 是唯一允许直接读取 `window.dsh` 和 `dshWorkbenchWindows` 的应用层。
- `packages/studio-ui` 通过 SessionPort 接入 Web Host，不 import 桌面端。
- Desktop Main 不知道会话业务，只处理窗口、票据、安全和几何。
- 生产代码禁止 import `@omp-studio/*`、`vendor/omp`、`omp-patch` 或读取 OMP 全局桥。
- 生产代码禁止 import shadcn/Seelen/Oh My Zsh 包、主题、插件或资源；禁止 Radix/Base UI、Tailwind、Tauri/Rust、Zsh 和 Nerd Font 等替代依赖。
- 四个参考项目不作为直接或传递依赖；仅允许 DSH 自有组件和既有 React/Electron 基础能力。

### 4.3 单一状态源

| 状态 | 唯一 owner |
| --- | --- |
| 布局树、标签、浮窗、最小化、Pin、焦点、几何 | `WorkbenchLayout` / core |
| 撤销重做 | core history |
| 会话事实与事件投影 | RuntimePort + `@dsh-studio/contract` |
| Workspace/Git/Runtime/Exit 状态分段 | `statusViewModel`，只投影真实 DSH 结构化数据 |
| 会话订阅与保活 | SessionLeaseRegistry / SessionEventHub |
| 跨窗口正文 DOM | DocumentHost |
| 本地偏好与持久化 | `dsh.workbench.state.v1` |

禁止新增第二套右栏状态、浮动列表、窗口顺序、会话运行状态或 OMP 兼容 client。Dock 徽标和状态分段只读取唯一状态 owner，不形成新的业务事实源。

### 4.4 OMP Quiet Instrument 美化资源原生化

美化直接进入 DSH 原生组件和共享样式层，不通过覆盖 OMP 页面、注入装饰层、安装所谓“美化包”或复制第二套主题实现。OMP Studio 0.2.8 没有独立可安装的 theme/ui/design/beautify 包；本计划使用 `ui_reference/ver2` 静态设计系统作为一次性视觉来源。

#### 4.4.1 来源白名单与禁用项

| 来源 | 允许操作 | 禁止操作 |
| --- | --- | --- |
| `ui_reference/ver2/styles/tokens.css` | 记录并改写颜色、字体、字号、行高、间距、控件高度、圆角、阴影、动效令牌 | 运行时直接 import；将源文件声明当作 DSH 对比度验收 |
| `styles/base.css`、`components.css` | 按 DSH 语义提取基础规则与共享状态，重写选择器 | 整文件覆盖全局样式；保留 OMP 专用 env/菜单语义 |
| `styles/layout.css`、`sidebar.css`、`topbar.css`、`conversation.css`、`tool-card.css`、`minimap.css`、`composer.css`、`changes.css`、`preview.css`、`panels.css`、`screens.css` | 仅参考层级、密度、边框、状态与内容排版 | 搬运 OMP 页面 DOM、布局状态或 mock 数据绑定 |
| `js/icons.js` | 提取所需通用线性路径，改写为 DSH TSX 组件 | 复制 IIFE、`window.OMP`、`TOOL_ICONS` 全局映射或品牌图标 |
| `__shots/*.png` | 人工视觉对照 | 打包进产品，或把 OMP 布局截图当 DSH 回归基线 |
| `data/**`、`js/store.js`、`bus.js`、`scenarios.js`、`screens.js`、`app.js` | 不进入产品 | 任何生产 import、复制或桥接 |
| `ui_reference/chat` | 不采用 | CDN 资源或“内部使用”标注不清的资产 |
| `packaging/ui/styles.css` | 不采用 | 将安装向导样式当工作台主题 |
| `apps/renderer/src/icons.tsx` | 仅作许可核查线索 | 直接复制 GitHub/Octicons 或未核查品牌图标 |

P0 为每个实际抽取文件记录相对路径、SHA-256、许可证、版权声明、修改说明、DSH 目标文件和复查人，写入 `packages/workbench-ui/visual-asset-provenance.json`。来源目录不是 Git 仓库，只记录本地快照哈希，不虚构 commit。

#### 4.4.2 覆盖范围

| 区域 | 美化内容 |
| --- | --- |
| 应用壳与侧栏 | 表面层级、导航选中、分区边界、密度、滚动条 |
| Dock、标签与面板头 | 激活指示条、关闭与菜单状态、溢出、拖拽反馈 |
| 浮窗与胶囊 | 圆角、边框、阴影、标题栏、最小化与 Pin 状态 |
| 系统窗口标题栏 | 与主窗口一致的按钮、焦点、置顶、最大化/恢复状态 |
| Composer 与对话 | 输入区层级、消息间距、角色标识、长内容换行、附件与队列 |
| 工具、代码、Diff、终端 | 标题、状态徽标、等宽字体、行背景、错误与成功层级 |
| 状态反馈 | loading、empty、unavailable、error、断线、审批与 steer 提示 |

#### 4.4.3 DSH 共享设计令牌

共享令牌由 `packages/workbench-ui/src/styles/tokens.css` 导出，桌面端与 Web Host 共用。DSH 运行时只消费这一份令牌，不加载 OMP 原始 CSS：

- 颜色：以 OMP 暗色 `#0E1116 / #0A0D11 / #151A21 / #1C222B / #11151B` 和亮色 `#F7F6F4 / #FFFFFF` 为初始表面基线；accent/run/ok/warn/danger 使用 OMP 紫、蓝、绿、黄、红语义。所有 foreground/background 组合在 DSH 中重新测对比度。
- 文本：primary/secondary/tertiary/disabled，以及代码与数字等宽字体栈；使用系统字体回退，不下载字体。
- 字号：10.5/11.5/12.5/13/14.5/16/20/26px；正文、辅助文字和代码映射到语义令牌。
- 表面：base/sunken/surface/raised/inset/overlay/selected/hover；主区、浮窗和系统窗口层级可辨。
- 边框：subtle/default/strong/focus；常规使用清晰 1px，避免半像素在 Windows 缩放下发虚。
- 间距：2/4/6/8/12/16/20/24/32/48px；紧凑/舒适密度只改已登记语义档位。
- 控件高度：以 OMP row/menu/btn/tab/table/field/topbar/statusbar 为参考；26px 视觉按钮通过命中层扩展至至少 28×28px，主要操作至少 32×32px。
- 圆角：3/4/6/8/999px；输入框、面板、浮窗、胶囊使用固定语义档位。
- 阴影：只用于浮窗/弹层抬升；结构主要依赖边框和表面，不堆叠厚重阴影。
- 图标：常规 16px、标题 20px，统一 1.5px 线性线宽与 currentColor；表情符号不充当功能图标。
- 动效：fast/base/slow 为 120/180/260ms，缓动 `cubic-bezier(.2,.8,.2,1)`；只动画 opacity/transform，减少动效时降至 0.01ms。

DSH 适配覆盖：不继承 OMP `body { min-width: 880px; }`；保留 DSH 1024 宽度响应式目标；OMP 专用类名重写为 DSH 语义；系统窗口同步同一令牌，不加载第二份主题。

#### 4.4.4 交互与状态

- 每个可操作区域至少定义 default/hover/active/focus-visible/disabled。
- hover 只提升一级背景，不位移、不缩放；focus-visible 使用 2px accent ring；selected 使用低对比强调背景与指示条。
- 拖拽定义 grabbed、drop-target、snap-preview、invalid；吸附高亮不能遮挡正文。
- 选中、焦点、运行中、错误、成功、待审批同时有颜色和文本/图标语义，不能只靠颜色。
- loading 使用轻量骨架或进度；empty 提供下一步；unavailable 说明缺失能力；error 提供重试与诊断入口。
- 静止时保持安静；仅 Running、Awaiting Approval、Error 可主动吸引注意。Running 可有语义脉冲，流式正文与终端不做持续装饰动画。
- 不美化或隐藏 Runtime 原始错误、审批状态、工具失败和断线提示。
- 系统窗口与主窗口共用视觉令牌，但保留各自窗口焦点与置顶状态。

#### 4.4.5 许可与第三方声明

- OMP 根许可证为 MIT，版权声明为 `Copyright (c) 2026 snowpear and OMP Studio contributors`。产品 `THIRD_PARTY_NOTICES.md` 必须保留 MIT 全文和该声明。
- 只进入能证明来源且许可允许的资产；无法确认许可的图标、品牌 SVG/PNG、字体或图片不复制、不打包。
- GitHub 图标涉及 Primer Octicons MIT；默认不复制。若业务必须保留，在第三方声明中单独署名并核对上游许可证。
- OMP `NOTICE` 未覆盖全部第三方图标，不能替代逐资产核查。
- 视觉资产门禁检查生产源码、包配置和构建产物无 mock JS、`window.OMP`、OMP 绝对路径、CDN、远程字体、未登记 data URI 或未许可资产。

#### 4.4.6 可访问性、响应式与性能

- 正文对比度至少 4.5:1，大字和关键 UI 至少 3:1；源色值必须按 DSH 实际组合复测。
- 键盘焦点清晰可见，常规桌面目标不小于 28×28px，主要操作不小于 32×32px。
- 支持键盘完成标签切换、浮窗移动入口、最小化、恢复和关闭。
- `prefers-reduced-motion` 开启时取消非必要过渡与动画。
- 覆盖 1024/1280/1440/1920 宽度和 100%/150%/200% DPI；小视口优先折叠装饰，不截断关键状态。
- 拖拽与吸附预览在参考 Windows 设备上的输入到绘制 p95 目标不超过 32ms；不得通过整窗重挂载实现动效。
- 流式输出和终端刷新不增加持续装饰动画，不阻断文字绘制。

#### 4.4.7 截图回归规则

- 固定 viewport、DPR、主题、字体栈、DSH fixture 和布局状态。
- 截图前等待字体、图片、CSS 与动效稳定，并移除光标和输入法合成状态。
- 动态时间、滚动位置、流式文本、终端闪烁和系统阴影按固定 mask 处理。
- OMP `__shots` 只用于方向对照；DSH 原生截图才是产品基线，不要求复制 OMP 页面布局。
- 布局差异必须修复；像素容差只允许已登记的渲染器/字体差异，不能用容差掩盖截断、越界或状态缺失。
- 基线更新需人工检查并记录原因，不允许测试失败后直接覆盖全部截图。

### 4.5 三类 GitHub 参考源原生化

详细规则见 [DSH Studio 工作台视觉融合计划](DSH-WORKBENCH-VISUAL-INTEGRATION-PLAN.md)。实施时遵守以下硬边界：

| 来源 | 允许 | 禁止 |
| --- | --- | --- |
| shadcn/ui | 独立重实现 Button/Dialog/Menu/Tabs/Tooltip/Command/Field/Toast 等模式；复制实质 MIT 代码时登记并保留声明 | registry CLI、Radix/Base UI、Tailwind、CVA、clsx、tailwind-merge、cmdk、Sonner、next-themes；丢失焦点/键盘行为 |
| Seelen UI | 只读参考 Dock、任务切换、吸附、标题栏、紧凑面板；以 DSH 状态机独立重实现 | 复制/翻译源码、CSS、SVG、图片、字体、主题包、插件；Explorer hook、任务栏接管、Tauri/Rust、全局快捷键 |
| Oh My Zsh | React/CSS 独立重绘 Workspace/Path/Git/Runtime/Exit 分段；只显示真实 DSH 数据 | 执行 zsh/主题/插件/探测脚本；读取 Token/环境变量；Powerline/Nerd Font 依赖；PTY 注入；从终端文字猜状态 |

P0 冻结三个仓库的固定提交、实际引用文件与 SHA-256。Seelen 在 provenance 中只能标为 `clean-room-reference`；shadcn/Oh My Zsh 如复制或改编实质代码，必须标为 `adapted-code` 并保留 MIT 与版权。

冲突裁决：DSH 真相与安全 → 可访问性 → Quiet Instrument → shadcn 组件状态 → Seelen 桌面壳密度 → Oh My Zsh 分段装饰。不形成四套主题。

## 5. DSH Runtime 与面板适配

### 5.1 DshRuntimePort

最小接口：

```text
info()
createSession()
query(sessionId, text)
listSessions()
openSession(sessionId)
subscribeState(listener)
subscribeNotification(listener)
subscribeRequest(listener)
listDir(relativePath)
readFile(relativePath)
gitChanges()
gitDiff(path, staged)
terminalStart/Write/Resize/Kill
browserShow/Bounds/Hide/Navigate/State
logsTail/logsClear
```

实现要求：

- 只调用 preload 已存在的 `window.dsh` 方法，不新增 Runtime 协议。
- 所有订阅返回取消函数；组件卸载必须调用。
- 错误统一转换为 DSH 错误类型，不把失败伪装为空结果。
- 会话事件通过 `@dsh-studio/contract` 的 `projectSessionEvent`、`applySessionStatus` 等纯函数投影。
- Runtime epoch 变化后 fence 旧事件和未决操作。

### 5.2 面板注册表

```text
PanelDescriptor {
  id
  title
  minSize
  requiredCapabilities
  mountPolicy
  component
}
```

能力状态：

- `implemented`：本地有真实适配器。
- `supported`：当前 DSH Host/Desktop 提供所需 API。
- `readState`：`ready / empty / unavailable`。

入口规则：

- 本地未实现：隐藏。
- Host 不支持：禁用并说明，不发送假命令。
- 读取失败：保留入口，显示 unavailable 与重试。
- 空结果：显示 empty，不替换演示数据。
- 所有恢复、预设、Pin、菜单、回收站入口共用同一过滤器。

### 5.3 会话 lease 与事件 hub

- 同一 session 只创建一个事件订阅和派生缓存。
- 每个视图持有 lease；最后一个 lease 释放时才退订和销毁缓存。
- 关闭视图不调用 `session.cancel()`，不删除 Runtime session。
- 多视图、多标签、系统窗口共享同一 session 业务状态。
- 终端按 session/view owner 引用计数；最后一个引用释放时 kill。

## 6. 布局模型与身份

### 6.1 内容身份

```text
ConversationRef =
  | { kind: "conversation"; sessionId: string }
  | { kind: "conversation"; draftId: string }

PanelRef =
  | { kind: "panel"; panelId: string; instanceId: string }
```

桌面 scope：

```text
(hostId, workspaceId, sessionId | draftId)
```

约束：

- `hostId` 标识 DSH Runtime/Host 实例。
- `workspaceId` 使用 DSH 稳定身份，不用显示名称。
- 草稿使用稳定 UUID。
- 同一 session 多视图共享业务状态，不为每个窗口创建新 session。
- workspace 切换不把 A 的布局、草稿或工具状态写入 B。

### 6.2 布局树

```text
WorkbenchLayout {
  version
  root: PaneNode | SplitNode
  floats: FloatNode[]
  minimized: MinimizedRecord[]
  focused?
}
```

- 存储树允许空 pane 和单子 split，保证撤销精确。
- 渲染树通过 `view()` 折叠空 pane、提升单子节点。
- 所有布局修改通过不可变 op，一次手势可合并为一条历史。
- 工具与对话共用同一布局树和几何规则。

### 6.3 五档 Pin

| Pin | 语义 |
| --- | --- |
| `none` | 当前工作区普通浮窗 |
| `workspace` | 同 workspace 共享实例 |
| `application` | 跨 workspace 借用 |
| `window` | 独立 Electron 窗口 |
| `topmost` | 独立 Electron 窗口并置顶 |

`window/topmost` 需要 Main、preload、Renderer 三层能力 ready。不可用时回退 `none` 或应用内浮窗，并通过统一回并逻辑恢复面板，不只修改字符串。

## 7. 存储、迁移与恢复

### 7.1 DSH 原生 schema

```text
key: dsh.workbench.state.v1
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

backup 键：`dsh.workbench.state.v1.backup`。

约束：

- `workspaceKey` 是 `(hostId, workspaceId)` 的无歧义编码；`sessionKey` 显式区分 session 与 draft。
- 布局继承顺序为：应用默认 → 项目默认 → 会话布局。
- 单一主键拥有全部布局、几何、Pin 和焦点，不采用 Dock/Conversation 双键。
- 外层 envelope 版本与 `WorkbenchLayout.version` 独立。
- 所有 ID、矩形、比例、枚举和引用必须校验。
- 拒绝 `__proto__`、`constructor`、`prototype` 等危险键。
- 未知字段忽略并记录告警，不原样进入执行逻辑。
- 消息、chunk、工具输出、Runtime 状态、审批、模型参数、附件明文和终端实例不得进入布局。

### 7.2 写入与备份

- 普通变更 200ms 防抖。
- `pagehide`、`beforeunload` 同步 flush。
- 每次成功写入前滚动更新 backup 为最近成功快照。
- 首次迁移、schema 升级、主数据损坏时先备份源快照。
- 主键损坏且 backup 有效：恢复 backup。
- 主备均损坏：默认布局，应用仍可启动。
- 写入失败：保留内存状态，显示一次非阻塞错误。
- 容量不足：先丢派生缓存；仍失败则停止本次持久化，不删 presets/sessions/preferences。
- 不在迁移时删除任何旧键。

### 7.3 读取优先级

1. DSH 原生 `dsh.workbench.state.v1` current/backup。
2. DSH Web Host `dsh.workbench.v2:*`。
3. OMP `omp.dock.v1`、`omp.conversation-workspace.v1`、`omp.layoutMemory.*`。
4. DSH 默认布局。

### 7.4 一次性迁移规则

| 源 | 迁移规则 | 失败处理 |
| --- | --- | --- |
| DSH v2 layout | 映射 split/tab/float/pin/minimized 到原生 schema | 保留源键，回默认 |
| OMP Dock | 只迁移 DSH 支持的 panels、sessions、presets、pins、几何 | 未知项过滤，原快照保留 |
| OMP Conversation | 映射真实 session/draft 身份、窗口、snap、focus | 未知身份隔离，不跨 scope 合并 |
| `omp.layoutMemory.*` | 仅迁移仍有效布局字段 | 禁止复活 browser/computer/btw 等旧默认项 |
| 未知 panel | 从 tabs、floats、presets、pins、hidden 中过滤 | 原快照保留 |
| native 无能力 | 回退应用内浮窗并回并 Pin | 原几何保留在迁移报告 |
| 非法几何/比例 | 拒绝该几何，使用默认值 | 记录字段路径 |
| 悬空引用 | 删除无效引用，不删有效文档 | 记录数量 |
| 危险键/非法枚举 | 拒绝该条目 | 无原型污染 |
| 新键已存在 | 不重复导入旧数据 | 直接使用新键 |

迁移器不得 import `@omp-studio/*`，不得创建 OMP client，不得启动 OMP Runtime。允许出现旧键字符串的唯一位置是 migration 模块及其测试。

### 7.5 回滚

- 功能回滚：关闭原生工作台或系统窗口能力，回到 DSH 原生简单 UI。
- 数据回滚：恢复迁移前快照或 DSH backup。
- 代码回滚：只撤销本任务点名改动，不 reset 整仓，不丢弃用户既有修改。

## 8. 资源生命周期契约

| 操作 | 必须发生 | 禁止发生 |
| --- | --- | --- |
| 拖动、停靠、snap | 移动同一 DOM/宿主，保留滚动位置 | 重新创建 session、整窗重折 |
| 最小化、隐藏、切标签 | 保留 client、订阅、终端、工具实例 | 卸载正文或停止生成 |
| 主区替换 | 延迟释放旧 host，允许新挂载接管 | 旧 cleanup 删除新 host |
| 关闭视图 | 释放 owned lease、订阅、项目引用、终端 | 删除或取消 Runtime session |
| Runtime 断线 | 保留布局、草稿和宿主，进入重连 | 伪造 running=false 或清空队列 |
| Runtime epoch 变化 | fence 旧事件，未决操作标 unknown/失败 | 把旧 epoch 结果写入新状态 |

实现要求：

- `DocumentHosts.retain` 使用 owner token。
- React cleanup 增加 generation fence；新 setup 取消旧 timeout。
- StrictMode 与同 tick 关闭再打开不得关闭新 client 或删除新 host。
- 诊断至少覆盖 mounted views、hosts、leases、event subscriptions、terminal instances、native tickets/windows。
- 敏感路径、token、用户内容和 Runtime 凭据不得进入日志。

## 9. Electron 独立系统窗口实施细则

### 9.1 文件与协议

新增：

- `apps/desktop/src/workbench-windows.js`
- `apps/desktop/src/workbench-windows-shared.js`
- `apps/desktop/src/workbench-host-preload.cjs`
- `apps/renderer/src/platform/native/workbenchWindows.ts`

| 通道 | 方向 | 允许内容 |
| --- | --- | --- |
| `dsh:workbench-window:prepare` | 主 Renderer → Main | 创建票据 |
| `dsh:workbench-window:control` | 主 Renderer → Main | ready/focus/minimize/maximize/close/topmost/showMain |
| `dsh:workbench-window:ready` | 子 Renderer → Main | 本窗口宿主已挂载 |
| `dsh:workbench-window:changed` | Main → 主 Renderer | close-request/closed/state |

主 preload 暴露 `dshWorkbenchWindows`；子 preload 只暴露 `dshWorkbenchHost.ready(key)`。子窗口不得继承 `dsh`、terminal、Runtime 或主窗口控制 API。所有 preload 不提供通用 `invoke`。

### 9.2 票据与打开流程

1. Main 在 `createWindow()` 前注册协议。
2. Renderer 提交窗口 ID、标题、几何、最小尺寸、最小化/最大化/置顶状态。
3. Main 校验主 Renderer mainFrame、完整 URL、输入类型和尺寸。
4. 开发模式比较完整 URL；file 模式比较实际 dist 路径。
5. 同 ID 未消费 prepare 幂等；参数冲突则拒绝。
6. 新 key 使用安全随机值；URL 添加 `workbenchHost=<key>`，移除 hash。
7. `setWindowOpenHandler` 只接受 URL 和 frameName 都匹配的未消费票据。
8. 子窗口 `show:false`，使用独立最小 preload。
9. 父 Renderer 完成 portal 后调用 ready；Main 校验 sender/key 后显示。
10. 票据一次性、30 秒 TTL；超时、崩溃、ready 超时均清理并通知父 Renderer。

### 9.3 窗口配置与几何

- 使用 Electron `BrowserWindow`，无系统边框，由 DSH WindowFrame 提供标题栏。
- `contextIsolation:true`、`nodeIntegration:false`、`sandbox:true`。
- 使用目标显示器 `workArea` 校正越界与尺寸。
- `sourceRect` 从主窗口 content bounds 换算，考虑 zoom factor。
- 坐标使用 DIP；保存 normal bounds。
- 显示器拔除、负坐标、DPI 变化时将窗口移回可用区域。
- 最小尺寸取请求值与工作台最小值的合法组合。

### 9.4 安全规则

- prepare/control 只接受主窗口 webContents；ready 只接受票据子窗口 mainFrame。
- control 只能操作票据所属窗口；未知 key、跨窗口 key、非 mainFrame 全部拒绝。
- 子窗口禁止任意 `will-navigate` 和 `will-redirect`。
- 子窗口禁止任意 `window.open`；外部 URL 在 DSH allowlist 落地前全部拒绝。
- 不向 Renderer 暴露 bridge token、Runtime 文件路径或原始 IPC。
- 错误日志不记录完整用户内容或票据 URL。
- 主窗口销毁时关闭全部子窗口和未消费票据。
- 打开失败、ready 超时、票据失败时回退应用内浮窗并显示可见原因。

### 9.5 Renderer 接入

- 子窗口入口只提供 DOM 宿主，不挂载 App，不创建 RuntimePort，不初始化性能 reporter、主题、tier listener 或 pagehide。
- 主窗口拥有业务状态；子窗口通过 portal 显示同一正文实例。
- 主题、密度、语言、样式表和标题由父 Renderer 同步。
- 所有 native 判定统一读取 `dshWorkbenchWindows` 能力。
- `window/topmost` 只在能力 ready 时启用。
- 恢复最近关闭、预设和布局时也必须经过 native 能力过滤。

## 10. WBS 与依赖

### 10.1 阶段总览

| 阶段 | 目标 | 依赖 | 退出条件 |
| --- | --- | --- | --- |
| P0 | 原生基线冻结与契约确定 | 计划批准 | 基线、OMP 清单、DSH 契约、四源视觉来源与许可台账完整 |
| P1 | 提炼 DSH core/UI | P0 | core 零 OMP/Runtime 依赖，布局测试全绿 |
| P2 | DSH 原生桌面组合层 | P1 | RuntimePort、面板、会话 lease 可用 |
| P3 | 完整布局行为与四源美化 | P2 | 布局矩阵、生命周期、可访问原语、桌面壳交互、状态分段与视觉基线通过 |
| P4 | DSH 独立系统窗口 | P3 | 协议安全与真机窗口验收通过 |
| P5 | 迁移、切换与真数据验收 | P4 | 默认入口原生，迁移和回滚可重复 |
| P6 | OMP 退出与交付 | P5 | 消费者归零，退出清单和验收报告完整 |

### 10.2 详细任务

| 任务 | 内容 | 依赖 | 交付物 | 完成定义 |
| --- | --- | --- | --- | --- |
| T0.1 | 登记 DSH 脏工作树 | 无 | 改动前文件清单 | 用户既有修改逐文件可还原 |
| T0.2 | 盘点 OMP 运行时与退出阻塞 | T0.1 | OMP 依赖/消费者清单 | 每个 import、全局桥、键和入口有分类 |
| T0.3 | 冻结 DSH RuntimePort、身份与 schema | T0.1 | 原生契约文档 | 桌面与 Web Host 边界无歧义 |
| T0.4 | 冻结交互行为与测试样本 | T0.2、T0.3 | 行为矩阵、迁移样本 | 六种布局、Pin、窗口行为可断言 |
| T0.5 | 冻结 OMP 美化来源与许可 | T0.1 | 来源白名单、SHA-256、provenance、许可清单 | 只允许 ver2 白名单；mock/全局 API/安装向导/CDN 禁用；MIT 与第三方声明策略明确 |
| T0.6 | 冻结 shadcn/ui、Seelen UI、Oh My Zsh 来源与许可 | T0.1 | GitHub 快照、文件 SHA-256、来源分类、依赖禁用清单 | 三仓库HEAD/许可复核；Seelen仅clean-room-reference；无CLI/包/脚本/字体依赖 |
| T1.1 | 创建 workbench-core/UI 包 | T0.3 | 包骨架与构建配置 | 无 OMP、Electron、Runtime 或上游 UI 依赖 |
| T1.2 | 实现 DSH 内容身份与布局模型 | T1.1 | model 模块 | scope、tab、float、pin 不变量通过 |
| T1.3 | 实现布局 op 与历史 | T1.2 | ops/history | 一次手势一条历史，撤销精确 |
| T1.4 | 实现几何、六种模板与分隔条 | T1.2 | geometry/templates | 最小尺寸、比例、热区测试通过 |
| T1.5 | 实现持久化 schema 与校验 | T1.2 | persistence | 主备、损坏、危险键、容量测试通过 |
| T1.6 | 建立 core 质量门 | T1.3～T1.5 | typecheck/test/build | core 全绿且零 OMP import |
| T2.1 | 创建 workbench-ui 展示层 | T1.1 | Dock/Tab/Float/PanelHost | 只通过 props/ports 接收内容 |
| T2.2 | 实现 DshRuntimePort | T0.3 | RuntimePort | 只调用 window.dsh，订阅可取消 |
| T2.3 | 实现面板能力注册表 | T2.2 | capabilities | 本地/Host/readState 三态一致 |
| T2.4 | 实现 SessionLeaseRegistry/EventHub | T2.2 | 会话保活层 | 同 session 单订阅，最后引用释放 |
| T2.5 | 接入文件、变更、终端、浏览器、日志面板 | T2.3、T2.4 | DSH 面板适配 | 全部读取真实 DSH 数据 |
| T2.6 | 接入 Composer、草稿、队列、审批 | T2.4 | 对话输入与审批 | 不伪造执行结果，断线可恢复 |
| T3.1 | 构建 apps/renderer 工作台壳 | T2.1、T2.4 | WorkbenchApp | 默认不 import OMP |
| T3.2 | 实现主区、标签与 Dock | T3.1 | 桌面布局 UI | 对话/工具跨区移动正常 |
| T3.3 | 实现拖拽、吸附与模板应用 | T3.2、T1.4 | 拖拽交互 | 六种模板、预览、取消、拖出通过 |
| T3.4 | 实现浮窗、最小化与五档 Pin | T3.2 | 窗口行为 | 前三档可用，后两档按能力门禁 |
| T3.5 | 实现预设、默认、继承、锁定、最近关闭 | T3.2、T1.3 | 布局管理 | scope 隔离与完整恢复通过 |
| T3.6 | 实现 DocumentHost 与 generation fence | T3.1、T2.4 | 稳定正文宿主 | StrictMode/同 tick 关开无竞态 |
| T3.7 | 基于 OMP Quiet Instrument 原生化抽取 DSH 令牌、图标与工作台/内容美化 | T3.2、T3.4、T3.5、T2.1、T0.5 | tokens.css、icons.tsx、视觉样式、状态组件、资产台账 | NV-01～NV-13 通过，无第二套主题、mock 运行时或未登记资产 |
| T3.8 | 原生化 shadcn/ui 可访问组件模式 | T3.2、T3.7、T0.6 | DSH 原生 primitives | NV-14、NV-20通过；无Radix/Base/Tailwind/CVA等依赖，焦点与键盘行为完整 |
| T3.9 | 原生化 Seelen UI 应用内桌面壳交互 | T3.2、T3.4、T3.7、T0.6 | Dock、任务切换器、snap反馈、紧凑面板 | NV-15、NV-16通过；零Seelen代码/素材，无Explorer hook/Tauri/Rust/桌面接管 |
| T3.10 | 原生化 Oh My Zsh 真实状态分段 | T2.5、T3.7、T0.6 | statusViewModel、StatusSegments | NV-17、NV-18通过；未知省略，无shell执行/特殊字体/PTY注入 |
| T3.11 | 四源视觉、主题、密度与依赖一致性收口 | T3.7～T3.10 | 统一令牌、视觉回归、依赖门 | NV-19～NV-22、NQ-14通过；无第二套主题或新增直接/传递依赖 |
| T4.1 | 实现 DSH 工作台窗口 shared 协议 | T3.6 | shared 模块 | 通道与类型一致 |
| T4.2 | 实现 Main 窗口服务 | T4.1 | workbench-windows.js | 票据、sender、URL、几何、关闭规则通过 |
| T4.3 | 实现主/子 preload 与 Renderer 客户端 | T4.1、T4.2 | 窄 API | 子窗口无业务桥，门禁生效 |
| T4.4 | 接入 portal、Pin 与失败回退 | T4.3、T3.11 | 系统窗口行为 | 同一会话实例，无空白宿主，标题栏与主窗口视觉一致 |
| T4.5 | 安全单测与 Windows 真机探针 | T4.4 | WX 测试报告 | WX-01～WX-20 全绿 |
| T5.1 | 实现 DSH v2/OMP 一次性迁移器 | T1.5、T0.4 | migration | 不 import OMP 包，旧键只读 |
| T5.2 | 迁移、损坏、回滚测试 | T5.1 | NM 测试报告 | NM-01～NM-15 全绿 |
| T5.3 | 切换根入口与 Desktop 加载路径 | T3.6、T4.5、T5.2 | 原生入口 | 默认启动 apps/renderer，旧入口不参与产品 |
| T5.4 | DSH 真数据整体回归 | T5.3、T3.11 | 真数据报告 | 会话、工具、断线、steer/cancel/附件通过 |
| T5.5 | 独立 profile 试运行与回滚演练 | T5.4、T5.6 | 验收/回滚报告 | 迁移、恢复、重开、回退、视觉回归可重复 |
| T5.6 | 视觉截图基线与多尺寸/DPI 验收 | T3.11、T4.4、T5.4 | NV/NQ 视觉报告 | NV-01～NV-22、NQ-12～NQ-14 通过 |
| T6.1 | 移除 OMP bridge 与全局 API | T5.5 | preload/main 清理 | dshStudio/ompStudio* 消费者归零 |
| T6.2 | 移除 OMP 包依赖并退出 vendor/renderer-omp | T6.1 | 退出清单、回滚包 | 删除单独批准；未批准则停用并隔离 |
| T6.3 | studio-ui 对齐共享 core/UI | T1.6、T5.3 | Web Host 回归 | 不依赖桌面端，行为不回归 |
| T6.4 | 全仓门禁、台账与最终验收 | T6.1～T6.3 | 最终报告 | 所有 NW 有证据，未验证项如实列出 |

### 10.3 关键依赖路径

```text
T0 → T1 → T2 → T3 → T4 → T5 → T6
T1.2 → T1.3/T1.4/T1.5 → T1.6
T2.2 → T2.3/T2.4 → T2.5/T2.6
T3.1 → T3.2 → T3.3/T3.4/T3.5 → T3.6
T3.2/T3.4/T3.5/T2.1/T0.5 → T3.7
T3.2/T3.7/T0.6 → T3.8
T3.2/T3.4/T3.7/T0.6 → T3.9
T2.5/T3.7/T0.6 → T3.10
T3.7～T3.10 → T3.11
T3.6 → T4.1 → T4.2 → T4.3 → T4.4 → T4.5
T1.5 → T5.1 → T5.2 → T5.3 → T5.4 → T5.6 → T5.5
T3.11 → T4.4/T5.4/T5.6
```

并行限制：

- T1.3、T1.4、T1.5 可在模型冻结后并行，但不得同时改同一文件。
- T2.3 与 T2.4 可并行，但必须共用 T2.2 的端口错误和 epoch 契约。
- T3.8、T3.9、T3.10 可在 T3.7 后并行，但必须共用 DSH 令牌、状态 owner 和 z-index；不得同时改 `tokens.css` 或形成局部主题。
- T4 的 Main 与 Renderer 可并行，但必须先冻结 shared 协议。
- 同一时间只允许一个工作树变更集进入真机验收。

## 11. 文件级实施清单

### 11.1 新增文件

| 文件 | 责任 |
| --- | --- |
| `packages/workbench-core/package.json` | DSH 原生布局核包定义 |
| `packages/workbench-core/tsconfig.json` | core 严格类型与声明产物配置 |
| `packages/workbench-core/vitest.config.ts` | core 测试入口与环境 |
| `packages/workbench-core/src/model.ts` | ContentRef、Scope、Layout、Pin、Window 状态 |
| `packages/workbench-core/src/ops.ts` | 不可变布局操作 |
| `packages/workbench-core/src/history.ts` | undo/redo |
| `packages/workbench-core/src/geometry.ts` | rect、比例、最小尺寸、snap |
| `packages/workbench-core/src/templates.ts` | 六种 DSH 模板 |
| `packages/workbench-core/src/pins.ts` | 五档 Pin 与 scope 规则 |
| `packages/workbench-core/src/persistence.ts` | schema、备份、decode/encode |
| `packages/workbench-core/src/migration.ts` | DSH v2/OMP 一次性导入 |
| `packages/workbench-core/src/**/*.test.ts` | core 回归 |
| `packages/workbench-ui/package.json` | DSH 原生 React 展示层 |
| `packages/workbench-ui/tsconfig.json` | UI 类型与声明产物配置 |
| `packages/workbench-ui/vitest.config.ts` | UI/jsdom 测试入口 |
| `packages/workbench-ui/src/styles/tokens.css` | 从 OMP Quiet Instrument 原生化抽取的 DSH 唯一颜色、字体、间距、圆角、阴影、动效令牌 |
| `packages/workbench-ui/src/styles/workbench.css` | Dock、Tab、Float、PanelHost、DocumentHost 基础样式，不加载 OMP 原始 CSS |
| `packages/workbench-ui/src/icons.tsx` | DSH 线性图标组件与已核查路径数据 |
| `packages/workbench-ui/visual-asset-provenance.json` | OMP 与三个 GitHub 来源的快照/哈希、许可、extracted-asset/adapted-code/clean-room-reference 分类和 DSH 目标 |
| `THIRD_PARTY_NOTICES.md` | OMP/shadcn/Oh My Zsh 实际采用资产的 MIT 全文与版权声明；Seelen 仅登记只读参考 |
| `packages/workbench-ui/src/**` | Dock、Tab、Float、PanelHost、DocumentHost |
| `packages/workbench-ui/src/components/primitives/**` | shadcn 模式原生化后的 DSH 可访问组件，不依赖上游 UI 栈 |
| `packages/workbench-ui/src/components/window-frame/**` | 主窗口与系统窗口共享标题栏和按钮 |
| `packages/workbench-ui/src/components/status-segments/**` | Oh My Zsh 语法原生化后的真实状态分段 |
| `apps/renderer/src/platform/dsh/statusViewModel.ts` | Workspace/Git/Runtime/Exit 真实数据投影与 epoch fence |
| `apps/renderer/src/platform/dsh/runtimePort.ts` | window.dsh 端口 |
| `apps/renderer/src/platform/dsh/capabilities.ts` | 面板能力注册表 |
| `apps/renderer/src/platform/dsh/sessionLeases.ts` | 会话保活与事件订阅 |
| `apps/renderer/src/platform/dsh/panels/**` | DSH 真实面板适配 |
| `apps/renderer/src/platform/native/workbenchWindows.ts` | 系统窗口类型化客户端 |
| `apps/renderer/src/platform/native/globals.d.ts` | DSH 全局 API 声明 |
| `apps/renderer/tsconfig.json` | mixed JS/TS 工作台类型检查边界 |
| `apps/renderer/vitest.config.ts` | Renderer 单测/集成测试配置 |
| `apps/renderer/src/workbench/**` | 桌面工作台组合层 |
| `apps/renderer/src/workbench/workbench.css` | 仅组合桌面主题变量与工作台布局，不复制 UI 令牌 |
| `apps/renderer/src/workbench/visual-baseline/**` | 固定 fixture 的截图基线、mask 与差异说明 |
| `apps/desktop/src/workbench-windows.js` | Electron 窗口服务 |
| `apps/desktop/src/workbench-windows-shared.js` | 通道与数据结构 |
| `apps/desktop/src/workbench-host-preload.cjs` | 子窗口最小 ready 握手 |
| `packages/testkit/scripts/check-native-workbench.mjs` | OMP 残留与依赖方向门禁 |
| `packages/testkit/scripts/check-workbench-visual-assets.mjs` | 来源白名单、许可、provenance、Seelen 零代码/素材与 mock/全局 API/CDN 残留门禁 |
| `packages/testkit/scripts/check-workbench-dependencies.mjs` | 禁止上游 UI/Shell/Zsh 栈、新增直接/传递依赖和 CLI/安装脚本门禁 |
| `packages/testkit/scripts/native-workbench-smoke.mjs` | CDP/Electron 工作台探针 |
| `packages/testkit/scripts/native-workbench-visual.mjs` | 固定视口、主题、fixture 的截图与差异门禁 |

### 11.2 修改文件

| 文件 | 允许改动 |
| --- | --- |
| `apps/renderer/package.json` | core/UI 依赖、typecheck/test/build 脚本 |
| `apps/renderer/src/main.jsx` | 切换到原生工作台入口 |
| `apps/renderer/src/App.jsx` | 保留为 DSH 原生紧急回退 UI |
| `apps/renderer/vite.config.js` | 原生工作台构建与测试 alias |
| `apps/desktop/src/main.js` | 加载 apps/renderer/dist、注册窗口服务、清理生命周期 |
| `apps/desktop/src/preload.cjs` | 保留 dsh，新增 dshWorkbenchWindows；切换后移除 OMP 桥 |
| `packages/studio-ui/package.json` | 改为依赖 workbench-core/UI |
| `packages/studio-ui/src/workbench/**` | 迁移到共享 core，避免双实现 |
| `packages/studio-ui/src/ui-workbench/**` | 迁移到共享 UI，保留 Web Host 组合层 |
| `packages/studio-ui/src/shell/**` | 更新 import，保持插件行为 |
| 根 `package.json` | 默认 dev/check、core/UI/renderer 质量门 |
| 根 `package-lock.json` | 仅由包管理器按依赖变化生成 |
| `dsh-overlay.json` | 登记 DSH 原生改动与参考来源 |
| `MODIFICATIONS.md` | 分批实施与验证记录 |

### 11.3 切换后退出，需单独批准

| 对象 | 退出条件 |
| --- | --- |
| `apps/renderer-omp/**` | 产品入口、测试、构建、文档消费者归零 |
| `apps/renderer-omp/vendor/omp/**` | 包依赖和 import 归零 |
| `omp-patch/vendor/oh-my-pi/**` | 图形/表格等运行时消费者归零 |
| `@omp-studio/*` 依赖 | package.json/lock/构建产物无引用 |
| `apps/desktop/src/studio-bridge.js` | `dshStudio` 所有消费者移除 |
| `dshStudio` / `ompStudioTerminal` / `ompStudioChrome` | 主/子 preload、类型声明、测试 stub 归零 |
| OMP harness/fixture/patch | DSH 原生 fixture 和测试替代完成 |

退出前必须提供：文件清单、SHA-256、消费者归零报告、回滚包和用户批准。未批准时只停用并隔离，不自动删除。

### 11.4 禁止改动

- DSH Runtime 协议、权限、审批、模型路由。
- 与本任务无关的页面、面板、样式和依赖升级。
- 用户既有未提交修改，除非逐项确认属于本任务。
- 不在迁移器之外新增 OMP 兼容代码。

## 12. 质量门与测试策略

### 12.1 目标命令

以下为实施后的目标入口，当前不声称已可运行：

```text
npm run workbench:core:typecheck
npm run workbench:core:test
npm run workbench:core:build
npm run workbench:ui:typecheck
npm run workbench:ui:test
npm run workbench:ui:build
npm run workbench:typecheck
npm run workbench:test
npm run workbench:test:integration
npm run workbench:test:visual
npm run workbench:check:visual-assets
npm run workbench:check:dependencies
npm run workbench:build
npm run studio:typecheck
npm run studio:test
npm run studio:build
npm test
npm run check
npm run smoke:supervisor
npm run smoke:workbench
```

依赖验证：

```text
npm ci
```

`check:workbench` 顺序：

1. core/UI 类型检查与单测。
2. Renderer 类型检查、单测、集成测试。
3. Renderer 生产构建。
4. Desktop 协议测试。
5. 原生架构与入口对齐检查。
6. 视觉资产、Seelen 干净房间与零新增依赖门禁。

### 12.2 测试分层

| 层级 | 工具 | 覆盖 |
| --- | --- | --- |
| 纯模型单测 | Vitest | 身份、布局 op、历史、snap、模板、Pin、持久化、迁移 |
| React 组件单测 | Vitest + jsdom + testing-library | Dock、Tab、Float、胶囊、预设、错误回退 |
| Workspace 集成 | Vitest + DSH fixture | 多会话、标签、拖拽、lease、DocumentHost |
| Desktop 协议单测 | Node test/Vitest | sender、URL、票据、动作、窗口状态、几何 |
| CDP 探针 | 既有桌面调试通道 | 几何、DOM 身份、事件计数 |
| 视觉回归 | CDP + 固定截图基线 | 令牌、布局、主题、状态、多尺寸、多 DPI、减少动效 |
| 视觉资产静态门 | Node + provenance | 来源白名单、SHA-256、许可证、mock/全局 API/CDN/远程字体、Seelen 零代码/素材残留 |
| 依赖静态门 | Node + package.json/lock/bundle | 四个上游项目及替代 UI/Shell/Zsh 栈无新增直接/传递依赖 |
| Electron 真机 | Windows 手动+自动 | 多窗口、DPI、置顶、关闭、断线、流式 |

### 12.3 fixture 策略

- 使用 DSH 原生 fixture，不复制 OMP Host Runtime。
- RuntimePort fixture 只模拟 `window.dsh` 的实际方法签名和事件形状。
- `@dsh-studio/contract` 使用真实纯函数投影，不伪造业务成功。
- 迁移样本可来自旧 OMP 键，但测试不 import OMP 包。
- fixture 不进入生产 bundle。

### 12.4 专项与全仓门禁

- 新增/修改测试必须全部通过。
- core 零 OMP/Runtime/React/DOM 依赖由架构检查强制执行。
- Renderer 与 Desktop 修改文件不得新增类型错误。
- 全仓测试记录实施前通过/失败清单；实施后不得新增失败或减少通过数。
- 全仓基线已全绿时，全仓 typecheck/test 纳入强制门；已有失败则单独跟踪。
- Vite build 成功不能替代类型检查或真机验收。

### 12.5 视觉质量门

- 截图测试必须使用固定数据、固定主题、固定视口和稳定字体，不读取真实用户内容。
- 每个已支持主题至少覆盖默认工作区、三列布局、浮窗、最小化胶囊、消息/工具内容和错误状态。
- 至少覆盖 1024/1280/1440/1920 宽度及 100%/150%/200% DPI。
- 视觉差异分为 layout、content、style、allowed-renderer 四类；layout/content 差异直接失败。
- 禁止用全局放大像素容差、关闭断言或失败后自动更新基线来通过门禁。
- 键盘焦点、对比度、减少动效和 28/32px 点击目标纳入自动或人工检查。
- 视觉回归与生命周期回归共同执行，确认美化没有引入重挂载、额外订阅或流式中断。
- 视觉资产静态门逐项核对 provenance/SHA-256 与第三方声明；生产代码和构建产物出现 mock JS、`window.OMP`、OMP 绝对路径、CDN、远程字体或未登记资产时直接失败。
- Seelen 只能以 `clean-room-reference` 登记；生产源码/产物出现其可识别代码、样式或素材表达时失败并移除。
- 依赖门检查 package.json、lockfile、生产 import 和构建产物，禁止 shadcn/Seelen/Oh My Zsh 包、Radix/Base UI、Tailwind、Tauri/Rust、Zsh、Nerd Font 及替代 UI 栈。

## 13. 验收用例清单

### 13.1 原生架构与适配 NA

| ID | 用例 | 通过标准 |
| --- | --- | --- |
| NA-01 | 默认桌面入口 | 根 dev/Desktop 加载 `apps/renderer/dist`，不加载 renderer-omp |
| NA-02 | OMP 运行时残留 | 生产源码、包配置、构建入口无 OMP import/全局桥/vendor |
| NA-03 | RuntimePort | 只调用 window.dsh，订阅可取消，错误不伪装空结果 |
| NA-04 | DSH contract | 会话事件通过 contract 投影，无 OMP reducer |
| NA-05 | 面板能力 | 本地/Host/readState 三态一致，入口统一过滤 |
| NA-06 | core 依赖 | 零 React/DOM/Electron/Runtime/OMP 依赖 |
| NA-07 | UI 依赖 | workbench-ui 只依赖 core/React，通过 props 接收内容 |
| NA-08 | studio-ui 复用 | Web Host 消费共享 core/UI，行为不回归 |

### 13.2 布局核心 NC

| ID | 用例 | 通过标准 |
| --- | --- | --- |
| NC-01 | 内容身份 | session/draft/panel instance 身份稳定且不碰撞 |
| NC-02 | split 操作 | 拆分、合并、比例更新不可变且可撤销 |
| NC-03 | tab 操作 | 打开、关闭、激活、跨 pane 移动正确 |
| NC-04 | float 操作 | 拖出、回并、移动、缩放正确 |
| NC-05 | minimize | 胶囊位置与恢复正确，正文保留 |
| NC-06 | 前三档 Pin | none/workspace/application scope 与 owner 正确 |
| NC-07 | 后两档 Pin | window/topmost 仅能力 ready 时开放 |
| NC-08 | undo/redo | 最近20步，一次手势一条历史 |
| NC-09 | scope 隔离 | host/workspace/session/draft 互不污染 |
| NC-10 | halves | 左右半屏几何正确 |
| NC-11 | wide-left | 2:1 比例与最小宽度正确 |
| NC-12 | columns | 三列分隔与比例正确 |
| NC-13 | stack-left | 左侧上下、右侧整高 |
| NC-14 | stack-right | 右侧上下、左侧整高 |
| NC-15 | quarters | 四宫格与横纵分隔正确 |
| NC-16 | 分隔条/小视口 | 比例受限，窗口不小于最小值，不越界 |

### 13.3 生命周期与 UI NL

| ID | 用例 | 通过标准 |
| --- | --- | --- |
| NL-01 | 拖动/snap | 不重建 session，不增加订阅 |
| NL-02 | 最小化/隐藏 | client、订阅、终端、工具实例保持 |
| NL-03 | 切标签 | 正文保活，滚动位置不丢 |
| NL-04 | DOM 身份 | document host 节点身份保持 |
| NL-05 | 流式输出中移动 | chunk 不丢、不重复、不停止生成 |
| NL-06 | 多视图共享 | 同 session 单订阅，最后引用释放 |
| NL-07 | 关闭视图 | lease/订阅/终端归零，Runtime session 仍存在 |
| NL-08 | StrictMode/同 tick 关开 | 旧 cleanup 不关闭新 client 或删除新 host |
| NL-09 | Runtime 断线 | 布局/草稿/队列保留，重连恢复 |
| NL-10 | epoch 切换 | 旧事件被 fence，未决操作不伪装成功 |
| NL-11 | 草稿与附件 | 内存身份稳定，移动不丢，关闭规则不变 |
| NL-12 | 最近关闭 | 最多10条，placement/rect/snap/pin 可恢复，重启清空 |
| NL-13 | 预设/默认/继承 | 应用、项目、会话规则正确，无重复状态 |
| NL-14 | 锁定布局 | 拖动和移动入口禁用，读取不受影响 |
| NL-15 | 能力状态 | ready/empty/unavailable 与 provenance 正确，无假数据 |
| NL-16 | 真实/预览隔离 | 存储、身份、事件不交叉 |

### 13.4 原生窗口 WX

| ID | 用例 | 通过标准 |
| --- | --- | --- |
| WX-01 | 非主 Renderer prepare/control | 拒绝 |
| WX-02 | 非受信任 URL | 拒绝 |
| WX-03 | 畸形输入/未知动作 | 拒绝且不崩溃 |
| WX-04 | 未知 key | 拒绝 |
| WX-05 | 同 ID 重复 prepare | 幂等，只开一个窗 |
| WX-06 | 票据超时/重复消费 | 清理并拒绝 |
| WX-07 | URL/frameName 不匹配 | 拒绝开窗 |
| WX-08 | 子窗口导航 | 阻止非票据 URL |
| WX-09 | 子窗口新开窗口 | 拒绝；外部链接仅在 allowlist 存在时处理 |
| WX-10 | 关闭系统窗口 | 不取消 Runtime 任务 |
| WX-11 | 主窗口关闭 | 子窗口、票据、监听器全部清理 |
| WX-12 | 窗口创建与 portal | 同一会话实例，无第二 RuntimePort |
| WX-13 | 置顶/取消置顶 | 状态与 Pin 一致 |
| WX-14 | 移动/最大化/恢复 | normal bounds 正确保存 |
| WX-15 | 多屏 DPI/负坐标/拔屏 | 窗口保持可用且不丢失 |
| WX-16 | 打开失败/刷新恢复 | 可见回退，刷新后布局可恢复 |
| WX-17 | 跨 frame/伪造 sender/篡改 URL | 全部拒绝，不影响其他窗口 |
| WX-18 | ready 超时/子进程崩溃 | 票据清理，父窗口可见回退 |
| WX-19 | 子窗口 bridge 暴露面 | 不存在 dsh/terminal/prepare/control |
| WX-20 | 外部协议/任意新窗 | allowlist 未配置时全部拒绝 |

### 13.5 迁移 NM

| ID | 用例 | 通过标准 |
| --- | --- | --- |
| NM-01 | DSH v2 布局 | split/tab/float/pin/minimized 完整迁移 |
| NM-02 | OMP Dock | 有效字段迁移，未知面板过滤，旧键不变 |
| NM-03 | OMP Conversation | 身份、窗口、snap、focus 恢复，不串会话 |
| NM-04 | layoutMemory | 只迁移有效字段，不复活 OMP 默认面板 |
| NM-05 | 新键优先 | 不重复导入旧数据 |
| NM-06 | 未知面板/预设项 | 过滤且保留源快照 |
| NM-07 | 未知身份 | 不自动打开，不跨 scope 合并 |
| NM-08 | native 无能力 | 回退浮窗并回并 Pin，无空白宿主 |
| NM-09 | 非法几何/比例 | 拒绝并记录，使用默认值 |
| NM-10 | 危险键/非法枚举 | 拒绝，无原型污染 |
| NM-11 | 主备损坏 | 恢复 backup；双损坏回默认且可启动 |
| NM-12 | localStorage 满/pagehide | 内存状态保留，flush 与降级正确 |
| NM-13 | 迁移器依赖 | 不 import OMP 包，不创建 OMP client |
| NM-14 | 完整回滚 | 恢复迁移前快照，行为符合回滚版本 |
| NM-15 | 几何单 owner | 全部几何只从 DSH 主键恢复，无第二写入源 |

### 13.6 质量门 NQ

| ID | 用例 | 通过标准 |
| --- | --- | --- |
| NQ-01 | core typecheck | 零错误 |
| NQ-02 | core test | 全部通过，无 skip/todo 冒充通过 |
| NQ-03 | UI typecheck | 零错误 |
| NQ-04 | UI test | 全部通过 |
| NQ-05 | Renderer typecheck | 零新增错误 |
| NQ-06 | Renderer test/integration | 全部通过，无资源竞态 |
| NQ-07 | Renderer build | DSH 原生 dist 生成，Desktop 可加载 |
| NQ-08 | Desktop 协议测试 | sender、票据、窗口生命周期通过 |
| NQ-09 | 全仓回归 | 无新增失败，不减少通过数 |
| NQ-10 | 架构门禁 | 无 OMP 生产依赖，依赖方向正确 |
| NQ-11 | 干净安装 | `npm ci` 成功，lock 由包管理器生成 |
| NQ-12 | 视觉回归门禁 | 固定 fixture 截图、mask、差异分类和基线更新规则可重复执行 |
| NQ-13 | 视觉资产门禁 | 来源白名单、SHA-256、许可证与第三方声明一致；生产源码/产物无 mock JS、OMP 全局 API、绝对路径、CDN、远程字体或未登记资产 |
| NQ-14 | 零新增依赖门禁 | package.json、lock、生产 import 与 bundle 无 shadcn/Seelen/Oh My Zsh 包及 Radix/Base UI、Tailwind、Tauri/Rust、Zsh、Nerd Font 等替代栈；无新增直接/传递运行时依赖 |

### 13.7 OMP 退出 ND

| ID | 用例 | 通过标准 |
| --- | --- | --- |
| ND-01 | bridge 消费者 | dshStudio/ompStudio* 生产消费者归零 |
| ND-02 | 包依赖 | package.json/lock 无五个 @omp-studio 包 |
| ND-03 | vendor 引用 | 生产源码/构建无 vendor/omp 或 omp-patch 引用 |
| ND-04 | 旧入口 | renderer-omp 不在默认 dev/build/Desktop 入口 |
| ND-05 | 全局 API | preload/类型声明不再暴露 OMP 全局名 |
| ND-06 | 旧存储键 | 仅 migration 与测试可读，无运行写入 |
| ND-07 | lock 一致性 | 干净安装通过，无手改 extraneous |
| ND-08 | 退出清单 | 删除/停用对象有哈希、批准和回滚包 |

### 13.8 回滚与交付 NR

| ID | 用例 | 操作与证据 | 通过标准 |
| --- | --- | --- | --- |
| NR-01 | 原生工作台回退 | 切回 DSH 原生简单 UI，记录 Runtime/窗口计数 | 会话不丢，系统窗口清理，无空白宿主 |
| NR-02 | 数据恢复 | 恢复 backup/迁移前快照并重启，保存哈希 | 布局符合目标版本，不混用新旧 |
| NR-03 | 代码反向变更 | 隔离副本中仅撤销本任务改动并执行质量门 | 可构建启动，无整仓 reset/clean |
| NR-04 | 用户工作树保护 | 比对实施前后非本任务文件 | 用户既有修改逐文件不变 |
| NR-05 | 交付门禁 | 缺少任一 NW 证据或存在阻断项时执行 G4 | 不得标记完成，未验证项如实列出 |
| NR-06 | 发布边界 | 检查 commit/push/publish 状态 | 未提交、未推送、未发布，除非另有授权 |

### 13.9 视觉与美化 NV

| ID | 用例 | 通过标准 |
| --- | --- | --- |
| NV-01 | 设计令牌一致性 | 工作台与内容样式来自共享令牌，视觉基线可追溯到 OMP ver2 白名单，无第二套颜色、字体或主题源 |
| NV-02 | 层级与间距 | 主区、面板、浮窗、胶囊、系统窗口层级清晰，2/4/6/8/12/16/20/24/32/48 网格一致 |
| NV-03 | Dock/标签/浮窗/标题栏 | 激活、关闭、溢出、拖拽、Pin 与系统窗口按钮视觉一致 |
| NV-04 | 交互状态 | default/hover/active/focus/disabled/drag/snap/invalid 完整且可辨；hover 不位移/缩放 |
| NV-05 | 状态反馈 | loading/empty/unavailable/error/断线/审批有清晰层级和下一步，不遮挡业务 |
| NV-06 | 内容可读性 | 消息、工具块、代码、Diff、终端和滚动条在长内容下无截断、错位或不可读 |
| NV-07 | 主题一致 | 每个 DSH 已支持主题通过令牌、对比度与截图检查，无未适配硬编码色 |
| NV-08 | 响应式 | 1024/1280/1440/1920 宽度无关键内容截断，小视口正确折叠装饰，不继承 OMP 880px body 约束 |
| NV-09 | DPI 清晰度 | 100%/150%/200% DPI 边框、图标、文字和阴影清晰，无半像素发虚 |
| NV-10 | 可访问性 | 对比度、键盘焦点、焦点顺序和 28/32px 点击目标通过；26px 视觉按钮有扩展命中区 |
| NV-11 | 动效与性能 | 仅 opacity/transform，120/180/260ms，减少动效生效，仅语义状态可脉冲，拖拽 p95 ≤32ms |
| NV-12 | 截图回归 | 固定 DSH fixture 基线通过，mask 与差异分类可重复，OMP 截图仅作方向对照，布局差异不被容差掩盖 |
| NV-13 | 资产来源与许可 | provenance/SHA-256 完整；OMP MIT 全文与版权声明存在；第三方图标逐项核查；无 mock JS、window.OMP、OMP 绝对路径、CDN、远程字体或未登记资产 |
| NV-14 | shadcn 模式可访问原语 | Dialog焦点圈定/归还、Escape、Tabs roving tabindex、Command active descendant、菜单方向键、Field错误关联和Toast live region通过；无上游UI依赖 |
| NV-15 | Seelen 模式桌面壳交互 | Dock分组/固定与运行项/徽标/溢出/自动隐藏、任务切换、吸附预览和标题栏状态正确；只作用于DSH应用 |
| NV-16 | Seelen 干净房间 | provenance仅clean-room-reference；生产源码/产物无Seelen代码、CSS、SVG、图片、字体、主题包、插件、Explorer hook、Tauri/Rust或桌面接管 |
| NV-17 | Oh My Zsh 真值分段 | Workspace/Path/Git/Runtime/Exit仅消费真实DSH结构化数据；未知省略，不伪造clean/success，异步旧响应被fence |
| NV-18 | 状态栏安全与字体 | 路径/分支按不可信文本渲染，无innerHTML/PTY注入/shell执行/Token或环境变量读取；无Powerline/Nerd Font依赖 |
| NV-19 | 四源一致性 | OMP令牌、shadcn组件状态、Seelen壳交互、OMZ分段职责明确；冲突按优先级裁决，无第二套主题 |
| NV-20 | 主题与密度覆盖 | 新原语、Dock、标题栏和分段在light/dark/system及紧凑/舒适密度下无状态缺失、硬编码色或截断 |
| NV-21 | 新表面动效与性能 | Dock/弹层/分段仅动画opacity/transform，减少动效生效，拖拽与任务切换p95≤32ms，不增加订阅或重挂载 |
| NV-22 | GitHub来源许可台账 | 三仓库快照、实际文件SHA-256、来源分类、MIT版权/许可与第三方声明一致；Seelen无误登记为复制/改编资产 |

## 14. 真机验收脚本

### 14.1 环境

- Windows x64，至少一个显示器；多屏与 100%/150%/200% DPI 必测。
- 视觉回归覆盖 1024/1280/1440/1920 宽度、DSH 已支持主题和 `prefers-reduced-motion`。
- 使用独立 Electron profile，不触碰用户真实布局数据。
- Runtime 使用已有 DSH 本地配置，不读取或外传凭据。
- 默认开发入口使用 `apps/renderer` 5173；生产验证 `apps/renderer/dist`。

### 14.2 自动探针场景

1. 创建两个真实会话和一个草稿。
2. 打开文件、变更、终端、浏览器、日志面板。
3. 依次应用六种模板，校验 cell、rect、最小尺寸和 DOM 身份。
4. 工具跨区移动、拖出浮窗、回并。
5. 对话浮窗、最小化、恢复、停靠标签、拖出。
6. 真实流式输出期间重复移动、最小化、恢复。
7. 记录 session lease、订阅、终端、host 计数。
8. 创建系统窗口、置顶、最大化、恢复、关闭。
9. 重启应用，验证布局和系统窗口恢复。
10. 断线再重连，验证草稿、队列和布局。
11. 执行 DSH v2/OMP 迁移与回滚。
12. 固定 fixture 采集主题、布局、浮窗、消息/工具与错误状态截图，校验多尺寸、DPI 和减少动效。
13. 检查生产 bundle 和包依赖无 OMP 运行时残留。
14. 核对视觉资产 provenance/SHA-256、MIT/第三方声明，并检查生产 bundle 无 mock JS、OMP 全局 API、绝对路径、CDN、远程字体或未登记资产。
15. 运行 shadcn 原生化原语的键盘/焦点探针，验证 Dialog、Tabs、Command、Field 和 Toast。
16. 验证 Seelen 模式的应用内 Dock/任务切换/吸附反馈，并确认无 Windows 桌面接管或 Seelen 代码/素材。
17. 验证 Oh My Zsh 分段在真实/未知/断线/非零退出态下的显示与安全行为。
18. 检查 package.json、lock、生产 import 和 bundle 无四源及替代 UI/Shell/Zsh 栈的新增直接/传递依赖。

### 14.3 手动场景

- 键盘菜单、Esc、焦点切换、布局锁定。
- Dialog/Tabs/Command/Tooltip/Toast 的纯键盘操作与焦点归还。
- Windows 贴边、多屏拖拽、任务栏、Alt+Tab；确认 DSH 美化不接管这些系统行为。
- 显示器分辨率与 DPI 变化。
- 主窗口最小化时操作子窗口。
- 快速连续开关窗口。
- Runtime 无响应、审批等待、工具执行中、模型切换。
- 键盘遍历主要工作台操作，检查焦点、对比度、点击目标和减少动效。

### 14.4 通过标准

- 无空白窗口、无假面板、无重复会话、无串会话。
- 无丢失 chunk、无异常整窗重折、无 lease/订阅/终端泄漏。
- 所有窗口在可用 workArea 内，最小尺寸正确。
- 重启后布局可恢复，关闭视图不停止 Runtime 任务。
- 失败场景有可见原因和恢复路径。
- 产品默认入口与生产依赖均为 DSH 原生。
- 工作台与内容美化在设计令牌、主题、响应式、DPI、可访问性和截图基线检查中通过。
- shadcn 原语、Seelen 应用内桌面壳交互、Oh My Zsh 真值分段和四源一致性通过。
- 生产依赖与产物无四个参考项目、替代 UI/Shell/Zsh 栈、Seelen 代码/素材或未登记资产。

## 15. 分阶段批准门

| 门 | 需要用户确认 | 必须提交的材料 | 不通过时 |
| --- | --- | --- | --- |
| G0 | 批准本计划书开始 P0 | 本文档 | 停在文档阶段 |
| G1 | P0 完成后继续 P1 | 基线、OMP 清单、DSH 契约、OMP+GitHub四源来源/许可台账、Seelen干净房间边界 | 先修边界，不提炼 core |
| G2 | P1/P2 完成后继续 P3 | core/UI 门禁、RuntimePort、面板回归、来源分类与依赖禁用清单 | 回退包或修适配，不进入完整布局 |
| G3 | P3 完成后进入 P4 | 布局矩阵、生命周期计数、设计令牌、视觉基线、NV-22资产合规、NQ-14零依赖 | 修核心或视觉，不进入系统窗口 |
| G4 | P5 完成后进入 P6 | 迁移、真数据、回滚、原生入口、NV-01～NV-22、NQ-12～NQ-14 | 不退出 OMP，不标记完成 |
| G5 | P6 删除/停用 OMP 对象 | 文件清单、哈希、消费者归零、回滚包 | 只停用隔离，不删除 |

每门只确认进入下一阶段，不代表授权提交、推送或发布。G5 是破坏性退出操作的单独批准门。

## 16. 回滚预案

### 16.1 触发条件

- 原生工作台无法启动或真实会话不可用。
- 出现窗口空白、重复会话、串会话、流式中断。
- lease、订阅或终端数量在关闭后不归零。
- 系统窗口造成主窗口失焦、无法关闭或坐标不可用。
- 不可用面板重新出现或产生假成功。
- 新增测试失败、类型错误或构建失败。
- 迁移造成跨 scope 污染或旧数据不可恢复。
- 视觉来源或许可分类不清、Seelen 代码/素材进入产品、四源或替代 UI 栈形成新增依赖。
- 状态分段伪造事实、泄漏敏感路径/凭据或向 PTY 注入控制字符。

### 16.2 功能回滚

1. 关闭原生工作台入口，回到 DSH 原生简单 UI。
2. 关闭系统窗口能力，已有 native 布局回退应用内浮窗。
3. 保留 Runtime 会话和业务数据。
4. 显示回滚原因，不静默切换。

### 16.3 数据回滚

1. 停止新布局写入。
2. 保留 DSH 新键、backup 和迁移报告。
3. 关闭应用后备份 Electron userData；不得运行时直接复制 LevelDB。
4. 经用户确认后恢复迁移前快照或 DSH backup。
5. 不在回滚过程中自动删除旧键或覆盖其他偏好。

### 16.4 代码回滚

- 只撤销本任务点名改动，使用新的反向变更集。
- 不 reset 整个仓库，不丢弃用户既有未提交修改。
- 代码回滚与数据回滚分开执行，先明确问题层级。

## 17. 风险登记

| 风险 ID | 风险 | 概率 | 影响 | 预防 | 应急 |
| --- | --- | --- | --- | --- | --- |
| R-01 | OMP fork 改名后继续运行 | 中 | 高 | 架构门禁、产物依赖检查 | 停止切换，回原生简单 UI |
| R-02 | core 与 studio-ui 形成两套布局 | 中 | 高 | 直接提炼现有 DSH core | 回退包消费，统一共享核 |
| R-03 | RuntimePort 语义与 OMP 桥不一致 | 高 | 高 | 真实 DSH fixture 与契约测试 | 回退适配层，修端口 |
| R-04 | 多视图重复订阅 | 中 | 高 | lease registry、单 EventHub、计数断言 | 关闭窗口功能，保留主区 |
| R-05 | DocumentHost 重挂载竞态 | 中 | 高 | owner token、generation fence | 回退 P3 相关改动 |
| R-06 | 系统窗口 IPC 滥用 | 低 | 高 | sender/URL/票据/导航门禁 | 禁用 native 能力 |
| R-07 | 多屏 DPI 坐标错误 | 高 | 中 | workArea/DIP/zoom 真机测试 | 回退应用内浮窗 |
| R-08 | 旧布局跨 scope 污染 | 中 | 高 | 未知身份隔离，不合并 null | 恢复源快照，回默认 |
| R-09 | 删除 OMP 后无法回滚 | 中 | 高 | G5 单独批准、哈希、回滚包 | 停止删除，使用回滚包 |
| R-10 | 覆盖既有脏工作树 | 高 | 高 | P0 文件清单、点名编辑 | 停止实施，逐项恢复 |
| R-11 | 测试补全暴露既有失败 | 高 | 中 | 先记录基线，按归属修复 | 不删测试，单独跟踪 |
| R-12 | 真机使用真实用户数据 | 低 | 高 | 独立 profile | 停止试运行，保护原 profile |
| R-13 | Web Host 与桌面端行为分叉 | 中 | 中 | 共享 core/UI、双宿主测试 | 回退共享包版本 |
| R-14 | 新包依赖扩张 | 中 | 中 | 只引入 React/Vitest 等已有工具 | 缩范围，保留核心门禁 |
| R-15 | 美化形成第二套主题或遮挡业务状态 | 中 | 高 | 共享令牌、真实数据截图、状态可访问性门禁 | 回退视觉样式，保留原生组件与行为 |
| R-16 | 误用 mock/安装向导/CDN 资源或遗漏图标许可 | 中 | 高 | 来源白名单、SHA-256、provenance、MIT/第三方声明、静态资产门禁 | 移除问题资产，换用已核查 DSH 图标/样式，重跑 NV-13/NQ-13 |
| R-17 | Seelen AGPL 源码/素材被误复制 | 中 | 高 | 只读参考、独立状态机、clean-room-reference、零代码/素材门禁 | 立即移除并重写，复核发布许可边界 |
| R-18 | 为三个参考项目引入新UI/Shell/Zsh依赖 | 中 | 高 | 禁止CLI/安装器/import；package.json/lock/bundle依赖门禁 | 回退新增依赖，保留DSH原生实现 |
| R-19 | OMZ式状态分段伪造事实或泄漏敏感信息 | 中 | 高 | 只消费DSH结构化字段、未知省略、文本渲染、控制字符清洗、epoch fence | 关闭分段，保留原始终端与真实状态 |
| R-20 | 四源风格叠加形成第二套主题或状态不一致 | 高 | 中 | Quiet Instrument单一令牌、职责优先级、共享z-index、主题/密度截图 | 回退局部视觉层，保留真实状态与原生行为 |

## 18. 交付物与完成定义

### 18.1 阶段交付物

- D1：P0 基线、OMP 退出清单、DSH 原生契约、OMP+GitHub 四源视觉来源/许可台账。
- D2：P1 workbench-core/UI 与质量门报告。
- D3：P2 RuntimePort、能力注册表、会话 lease 报告。
- D4：P3 布局矩阵、生命周期、shadcn原语、Seelen桌面壳、Oh My Zsh分段与视觉基线报告。
- D5：P4 系统窗口协议、安全测试、多屏验收。
- D6：P5 迁移、真数据、NV/NQ视觉回归、零依赖、入口切换与回滚报告。
- D7：P6 OMP 退出清单、消费者归零、最终验收。

### 18.2 整体完成定义

只有同时满足以下条件才算完成：

- NW-01～NW-17 有对应验收证据。
- core/UI/Renderer/Desktop 专项 typecheck/test/build 全部通过。
- NA、NC、NL、WX、NM、NQ、ND、NR、NV 全部通过。
- 六种吸附、五档 Pin、预设、撤销、锁定、最近关闭可用。
- 工作台与内容美化完成，Quiet Instrument 已原生化，shadcn 组件模式、Seelen 应用内桌面壳交互、Oh My Zsh 真实状态分段已融合；设计令牌、主题、可访问性、响应式、DPI、视觉回归、许可、provenance 和零新增依赖通过。
- 生产源码、包配置和构建产物无 OMP 运行时、mock 原型、OMP 全局 API、四个参考项目及替代 UI/Shell/Zsh 栈、Seelen 代码/素材、CDN 或未登记视觉资产。
- 默认入口是 DSH 原生 `apps/renderer`。
- DSH 真会话不断流、不取消、不串会话。
- 旧布局可迁移、损坏可恢复、回滚已演练。
- OMP 退出对象有批准和回滚包；未批准删除时已停用并隔离。
- 文档、台账、限制与未验证项完整。
- 未提交、未推送、未发布，除非用户另行明确授权。

### 18.3 当前源码核对结论

| 源码事实 | 对计划的影响 |
| --- | --- |
| `renderer-omp/package.json:23-27` 依赖五个 OMP 包 | 不能仅改存储键，必须更换产品入口与运行时 |
| `src/dsh/client.ts:10-52` 使用 OMP StudioClientImpl/transport | 桌面改用 DshRuntimePort |
| `conversationWorkspace/client.ts:1-3,52-125` 依赖 OMP 类型与事件 | 会话层按 DSH contract 重建 |
| `preload.cjs:3-73` 已有原生 window.dsh | 作为桌面唯一 Runtime/Host 端口 |
| `packages/studio-ui/src/workbench/*` 已有 DSH 布局模型 | 提炼共享 core，不从 OMP 复制状态机 |
| `studio-ui/src/ui-session-views/client.ts` 已有 SessionPort | 桌面另建窄 RuntimePort，Web Host 保持 SessionPort |
| `studio-ui/src/workbench/presets.ts:27-35` 已使用 DSH v2 键 | 迁移来源增加 DSH v2，优先级高于 OMP |
| `main.js` 当前优先加载 renderer-omp/dist | P5 切换 apps/renderer/dist |
| 非测试源码仍有数百个 OMP 类型引用 | P6 退出前必须完成消费者归零 |
| OMP 根/全部 workspace 均 private，无独立美化 npm 包 | 不安装或虚构 theme 包，使用 ver2 静态视觉来源 |
| `ui_reference/ver2/styles/tokens.css` 声明 Quiet Instrument | 作为 DSH 令牌的一次性基线，所有色值重新验收 |
| `ui_reference/ver2/js/**` 注册 `window.OMP.mod` 并依赖 mock data | 只提取图标路径；JS 运行时全部禁用 |
| OMP `LICENSE` 为 MIT，`NOTICE` 未覆盖全部图标 | 产品保留 OMP MIT，第三方图标逐项核查 |
| `ui_reference/chat` 依赖 CDN 且标注内部使用 | 不采用 |
| `packaging/ui/styles.css` 属于安装向导 | 不作为工作台美化来源 |
| shadcn/ui 根 `LICENSE.md` 为 MIT，版权 `Copyright (c) 2023 shadcn` | 只参考可访问组件模式；复制实质代码时保留许可，不引入registry/Radix/Tailwind |
| Seelen UI `LICENSE` 为 GNU AGPL v3，包声明 `AGPL-3.0-or-later` | 只读参考桌面壳交互，零代码/素材，不做Windows桌面接管 |
| Oh My Zsh `LICENSE.txt` 为 MIT，版权含2009-2026 Robby Russell and contributors | 只参考分段语法；不执行zsh/主题/插件，不依赖Nerd Font或读取凭据 |

## 19. 当前状态与下一步

当前已完成：

- DSH/OMP 文档与关键源码只读核对。
- 确认继续 OMP fork 不符合“完全适配 DSH”的要求。
- 完成 DSH 原生工作台总体方案。
- 完成原生落地计划书的需求、WBS、存储、窗口、测试、退出和回滚细则。
- 将 DSH 原生美化纳入范围、设计令牌、WBS、文件清单、质量门、视觉验收与回滚。
- 核查 OMP 美化资源：确认没有独立可安装美化包，`ui_reference/ver2` 是可用 Quiet Instrument 来源；已加入原生化抽取、来源白名单、MIT/第三方许可、provenance 与资产门禁。
- 核查 shadcn/ui、Seelen UI、Oh My Zsh 官方仓库、许可和可参考模式；已加入四源融合、零新增依赖、Seelen 干净房间、T0.6、T3.8～T3.11、NV-14～NV-22、NQ-14 和对应风险。

当前未执行：

- 源码修改、依赖安装、构建、类型检查、单测、CDP/Electron 真机操作。
- 旧布局迁移、原生工作台实现、OMP 删除、提交、推送、发布。

下一批准动作：G0 批准后进入 P0，先冻结当前工作树、盘点 OMP 退出阻塞、冻结 OMP ver2 与三个 GitHub 美化来源/许可台账、确定 DSH RuntimePort 与布局契约；在 G1 材料完成前不进入 core 提炼和产品行为改造。
