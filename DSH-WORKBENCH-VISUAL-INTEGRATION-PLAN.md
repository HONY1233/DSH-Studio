# DSH Studio 工作台视觉融合计划

版本：1.0  
日期：2026-11-24  
状态：待评审；本文件只规定美化融合方法，不授权实现、安装、构建、测试、提交或发布。  
上位方案：[DSH Studio 原生工作台建设方案](DSH-WORKBENCH-LAYOUT-PLAN.md)  
实施追踪：[DSH Studio 原生工作台落地计划书](DSH-WORKBENCH-LAYOUT-IMPLEMENTATION-PLAN.md)

## 1. 目标与结论

本计划把四类参考源融合成一套 DSH 自有工作台视觉与交互，不拼装四套皮肤：

1. **OMP Studio `ui_reference/ver2`**：提供 Quiet Instrument 基础色、字体回退、间距、圆角、层级和动效基调。
2. **shadcn/ui**：提供可组合组件 anatomy、语义令牌和可访问交互模式。
3. **Seelen UI**：提供 Windows 桌面壳、Dock、任务切换、窗口管理和吸附反馈的交互模式。
4. **Oh My Zsh**：提供终端标题、路径、Git 与运行状态的分段信息语法。

最终运行产物只包含 DSH 自有 React/CSS/图标、既有 Electron 与 DSH Runtime 能力。四个上游项目均不是 DSH 运行时依赖。

“不需要依赖包，融入进来”在本计划中定义为：

- 不安装、不 import、不动态加载四个上游项目的包、主题、插件、资源包或脚本。
- 不运行 shadcn CLI、Seelen 安装器、Oh My Zsh 安装脚本或任何上游更新器。
- 不新增 npm/Cargo/Zsh 直接或传递运行时依赖；不改变根 lockfile 来引入上游 UI 栈。
- 不引入 Radix/Base UI、React Aria、Tailwind、CVA、clsx、tailwind-merge、cmdk、Sonner、next-themes、Tauri、Rust crate、Nerd Font 或远程字体。
- 需要的焦点管理、键盘导航、ARIA、分段布局、Dock 和吸附逻辑由 DSH 自己实现并测试。
- 既有 React、React DOM、Electron、Vitest、Testing Library、jsdom 和 xterm 等仍按 DSH 现有边界使用；本要求不是移除 DSH 已有基础依赖。

## 2. 来源快照与许可分类

以下提交是 2026-11-24 在线核查快照，不是已下载或已冻结的本地副本。P0 实施时必须重新核对上游 HEAD、下载指定文件、计算 SHA-256 后才能进入资产台账。

| 来源 | 核查快照 | 许可 | DSH 使用方式 |
| --- | --- | --- | --- |
| OMP Studio | 本地 `F:\projects\omp-studio-ref`，包版本 0.2.8，非 Git 仓库 | MIT；`Copyright (c) 2026 snowpear and OMP Studio contributors` | 白名单视觉资产可原生化抽取；不复制 mock 运行时 |
| shadcn/ui | `shadcn-ui/ui`，`main`，`055aa6b7837b1808456a24beb4c97a677864aa82` | MIT；`Copyright (c) 2023 shadcn` | 默认独立重实现组件模式；如复制实质代码，保留 MIT 与版权声明 |
| Seelen UI | `eythaann/Seelen-UI`，`master`，`bc08d1f1b1894653ce6be52738cc6ca4c0e43a85` | GNU AGPL v3 全文；`package.json` 标识 `AGPL-3.0-or-later` | 只读参考抽象交互；不复制源码、CSS、SVG、图片、字体、主题包、插件或资源 |
| Oh My Zsh | `ohmyzsh/ohmyzsh`，`master`，`6c31a91a3e82b4055b36cc088c2f27f81119ba60` | MIT；`Copyright (c) 2009-2026 Robby Russell and contributors (https://github.com/ohmyzsh/ohmyzsh/contributors)` | 默认只借鉴信息语法，以 React/CSS 独立重绘；不执行 shell 代码；如复制实质代码，保留 MIT 与声明 |

许可边界说明：

- Seelen 的 AGPL 与本方案希望保持的 DSH 产品许可边界不同。直接复制、翻译或逐行移植其受版权保护表达可能形成衍生作品并触发相应义务，因此本方案采取更严格的**零 Seelen 代码/素材**边界。
- “干净房间”在本计划中不是法律结论，而是工程控制：先写 DSH 行为规格和状态机，再以 DSH 自有命名、几何、组件和图标实现；实现人员不得把 Seelen 文件作为复制模板。
- shadcn/ui、Oh My Zsh 与 OMP 的 MIT 许可不要求界面展示署名，但复制或改编实质代码时必须保留版权与许可文本；DSH 仍将在产品第三方声明中登记实际采用来源。
- 本计划不构成法律意见。发布前由用户指定的许可复核人确认最终资产分类；无法确认的资产一律不进入产品。

## 3. 四源融合规则与冲突优先级

### 3.1 职责边界

| 层面 | 主来源 | DSH 决策 |
| --- | --- | --- |
| 品牌、产品命名、窗口 IPC、数据语义 | DSH | 不因美化改变 |
| 基础表面、字体、字号、间距、圆角、动效 | OMP Quiet Instrument | 转为 DSH 唯一语义令牌，不加载上游 CSS |
| 通用组件组合与可访问行为 | shadcn/ui | 用 DSH 原生 React 原语重实现 |
| 应用内 Dock、任务切换、窗口/吸附反馈 | Seelen UI | 只作用于 DSH 工作台，不接管 Windows 桌面 |
| 终端标题与状态分段 | Oh My Zsh | 只显示 DSH 已提供的结构化事实 |
| 冲突裁决 | DSH 设计令牌与真实业务状态 | 业务可读性、可访问性和真实状态优先于参考源观感 |

冲突处理顺序：

1. DSH Runtime 真相、权限和安全约束。
2. 键盘可用性、焦点顺序、对比度和 28/32px 命中目标。
3. OMP Quiet Instrument 的安静层级。
4. shadcn 的组件状态与组合模式。
5. Seelen 的桌面壳密度与吸附反馈。
6. Oh My Zsh 的分段装饰。

不得为了贴近某个参考源而恢复 OMP mock 状态、增加 Windows 桌面接管、执行 shell 探测、隐藏真实错误或引入第二份主题。

### 3.2 禁止四套风格直接叠加

- Seelen 的透明/模糊表面不得覆盖 OMP 的不透明 Quiet Instrument 层级；Dock 可使用受限半透明，但必须先验证 Windows/Electron 实际效果并提供不透明回退。
- shadcn 的 New York/Nova 类名、Tailwind 工具类和注册表配置不进入 DSH；只保留可映射的语义 anatomy。
- Oh My Zsh 的 Powerline 尖角、Nerd Font 图标和 ANSI 色不作为 DSH 视觉依赖；改用圆角胶囊、DSH 线性图标和语义令牌。
- 不创建 `theme-omp`、`theme-shadcn`、`theme-seelen`、`theme-omz` 四套可切换皮肤。用户切换主题时只改变 DSH 令牌值。

## 4. DSH 共享设计令牌

唯一源文件为 `packages/workbench-ui/src/styles/tokens.css`；组件样式只引用变量，不写 raw hex、上游类名或远程字体。

### 4.1 shadcn 语义变量到 DSH 的映射

| shadcn 语义 | DSH 令牌 | 约束 |
| --- | --- | --- |
| `background` | `--dsh-surface-app` | OMP 暗色 `#0E1116`、亮色 `#F7F6F4` 为初始基线 |
| `foreground` | `--dsh-text-primary` | 正文组合对比度至少 4.5:1 |
| `card` | `--dsh-surface-panel` | 对话、工具和设置面板 |
| `popover` | `--dsh-surface-overlay` | 菜单、命令面板、Tooltip、Popover |
| `primary` | `--dsh-accent-solid` | 主操作；配单独 foreground |
| `secondary` | `--dsh-surface-secondary` | 次操作，不抢主视觉 |
| `muted` / `muted-foreground` | `--dsh-surface-muted` / `--dsh-text-secondary` | 辅助信息仍需可读 |
| `accent` / `accent-foreground` | `--dsh-state-selected` / `--dsh-text-on-selected` | 选中、hover 和当前项 |
| `destructive` | `--dsh-state-danger` | 错误与破坏性操作；配文本/图标 |
| `border` / `input` | `--dsh-border-default` / `--dsh-border-control` | 1px 清晰边框 |
| `ring` | `--dsh-focus-ring` | 2px `:focus-visible` 环 |
| `radius` | `--dsh-radius-control/panel/pill` | 使用 DSH 3/4/6/8/999px 档位，不照搬 shadcn 默认比例 |
| `sidebar-*` | `--dsh-sidebar-*` | DSH 左栏和紧凑栏专用语义 |

DSH 另增 OMP 继承但 shadcn 基础语义未完整覆盖的令牌：

- `sunken / raised / inset` 表面。
- `run / ok / warn / danger / awaiting` 业务状态。
- `dock / tab / float / capsule / titlebar / statusbar` 区域令牌。
- `hover / selected / disabled / dragging / snap-valid / snap-invalid` 交互令牌。
- `font-ui / font-mono` 系统字体回退栈。

### 4.2 主题与密度

- 支持 DSH 已存在的 light/dark/system 语义；不额外引入四套上游主题。
- 紧凑与舒适密度只切换已登记的区域高度、间距和图标尺寸，不破坏布局最小尺寸。
- 系统窗口同步同一组令牌，不加载第二份 CSS 或调用上游主题脚本。
- 所有主题必须成对检查 foreground/background，禁止只验证色板声明。

## 5. shadcn/ui 原生组件适配

### 5.1 实现原则

- 默认不复制上游 JSX；按 DSH 需求写组件 API 与实现。
- 如 P0 后决定复制某段 MIT 代码，必须记录固定提交、文件、SHA-256、修改说明，并保留版权与 MIT；去掉缺失依赖时不得删掉可访问行为。
- 不把 `data-slot` 当作可访问性实现；ARIA、键盘和焦点行为必须由 DSH 原语提供。
- 不提供 `asChild` 兼容 API；链接、按钮和组合控件按真实 HTML 语义实现。

### 5.2 组件清单

| DSH 组件 | 参考模式 | 必须实现的行为 |
| --- | --- | --- |
| `Button` | variant/size、图标间距、focus ring | 原生 button/a 语义；disabled/invalid；加载不丢宽度 |
| `IconButton` | 紧凑图标按钮 | 必须有可访问名称；28×28 常规命中区 |
| `Dialog` | Trigger/Content/Title/Description/Close | 原生 `<dialog>` 或等价模态；焦点圈定、Escape、焦点归还 |
| `DropdownMenu` | 分区菜单、快捷键、勾选项 | 方向键、Home/End、类型 Ahead、Escape、`aria-expanded` |
| `CommandMenu` | Input/List/Group/Item/Empty | combobox/listbox、active descendant、过滤、空态、Enter |
| `Tabs` | List/Trigger/Panel | 横纵方向、roving tabindex、方向键、Home/End |
| `Tooltip` | hover/focus 延迟触发 | 碰撞定位、Escape、`aria-describedby`；不拦截点击 |
| `Popover` | 非模态轻量内容 | 外部点击/Escape 关闭；焦点策略明确 |
| `Select` | 触发项、分组、选中态 | 原生 select 或完整键盘列表行为；错误不伪造选项 |
| `Field` | Label/Description/Error | 稳定 ID、`htmlFor`、`aria-describedby`、`aria-invalid` |
| `Switch` | 开关状态 | `role=switch` 或原生 checkbox；Space 切换 |
| `Separator` | 语义分割 | 装饰分割不进入焦点顺序 |
| `ScrollArea` | 稳定滚动与边缘提示 | 不劫持终端/正文既有滚动；键盘可滚 |
| `ToastRegion` | 队列、action、close、live region | polite/assertive 分级；不抢焦点；错误可见 |
| `Skeleton` | loading 占位 | 减少动效；不伪装真实数据 |

### 5.3 弹层与焦点

- 所有弹层使用 DSH 统一 z-index 令牌和 portal 容器，禁止组件各自写死层级。
- Dialog 关闭后焦点回到触发项；触发项消失时回到当前 pane 的合理入口。
- 命令面板支持中文、英文、路径和命令描述过滤；过滤只处理真实注册项。
- Tooltip 不承载唯一操作入口；触摸与键盘不依赖 hover。
- 弹层打开不创建 Runtime 订阅，不重新挂载会话正文。

## 6. Seelen UI 桌面壳交互原生化

### 6.1 允许参考的模式

| 模式 | DSH 落点 | 不做的事 |
| --- | --- | --- |
| 左/中/右分区 Dock | 应用内 Dock 分组 | 不替换 Windows 任务栏 |
| 固定项与运行项 | 面板快捷入口和活动会话 | 不读取 Explorer 固定任务栏 |
| 运行/注意徽标 | DSH Running、Awaiting Approval、Error | 不轮询或猜测任务状态 |
| Dock 自动隐藏与边缘提示 | DSH 用户偏好与应用窗口内布局 | 不注册全局桌面热键 |
| 任务切换与窗口预览 | DSH 活动标签、浮窗和系统窗口切换器 | 不接管 Alt+Tab |
| BSP/列/堆栈布局 | 复用 DSH 六种模板与 core geometry | 不引入 Seelen 窗口树协议 |
| 吸附边缘与半屏预览 | DSH snap preview | 不 hook Explorer 或系统窗口事件 |
| 快速设置式紧凑面板 | DSH 主题、密度、显示选项 | 不提供系统电源、亮度或设备控制 |
| 工具栏三分区与自动隐藏 | DSH 标题栏和面板头 | 不实现第三方插件系统 |

### 6.2 Dock 状态模型

Dock 只消费 DSH 已注册的面板和真实会话状态：

```text
DockItemRef = panel instance | conversation ref
DockItemView = {
  ref
  label
  icon
  pinned
  active
  running?
  attention?
  unavailable?
  badgeCount?
}
```

规则：

- `pinned` 是 DSH 布局偏好，`active` 是 DSH 焦点，`running/attention` 来自 RuntimePort/contract。
- `unavailable` 来自面板能力过滤，不显示可点击假入口。
- 未知状态省略对应徽标；不得默认显示 clean、success 或 running。
- 同一 ref 在 Dock、标签、胶囊和任务切换器中共享同一身份，不产生第二业务状态。
- Dock 重排只修改布局，不改变会话顺序、订阅或生成状态。

### 6.3 应用内窗口与吸附

- 吸附预览只读取 core geometry，不维护第二套矩形状态。
- 拖出、取消、边缘热区、半屏、四角和顶部最大化沿用 DSH 既定六种模板。
- Seelen 式反馈仅表现为边框、表面提升和语义遮罩；不增加装饰图片、厚重阴影或持续动画。
- 浮窗标题栏提供最小化、最大化/恢复、关闭、Pin；系统窗口使用同一视觉组件但不同能力门禁。
- 任务切换器支持键盘上下/左右导航，并显示真实标题、Runtime 状态和窗口类型；不渲染虚假缩略图，没有真实预览能力时使用图标与文本。

### 6.4 Windows 原生边界

- 本次美化不实现 `SetWinEventHook`、Explorer hook、托盘接管、任务栏二进制解析、全局快捷键、Tauri、WebView2、Rust、Seelen 资源加载器或插件 IPC。
- 半透明和 `backdrop-filter` 是视觉增强；不支持或性能不足时使用不透明 DSH 表面。
- DSH Electron 子窗口继续使用自有票据与最小 preload，不借用 Seelen 窗口管理代码。

## 7. Oh My Zsh 状态分段原生化

### 7.1 参考主题

只参考以下信息组织方式，不复制或执行 zsh 代码：

- `agnoster`：条件显示的 Git/状态胶囊、clean/dirty、ahead/behind、冲突状态。
- `af-magic`：左侧路径/VCS、右侧退出码的非对称分段。
- `robbyrussell`、`sunaku`：克制的成功/失败与 `exit N` 表达。
- `minimal`：路径收缩与低装饰密度。

不引用当前官方目录中不存在的 `gentle` 或 `gitster`。

### 7.2 DSH 分段顺序

```text
[Workspace / Path] [Git branch] [Git state] [Runtime state] [Exit / Duration] [Attention]
```

显示规则：

- Workspace/Path：只使用 DSH 已提供的稳定工作区身份和真实 cwd；默认缩写 Home 路径，不主动展开敏感目录。
- Git branch/state：只使用 `gitChanges/gitDiff` 或等价 DSH 结构化读取结果；未知不等于 clean。
- Runtime state：idle/running/awaiting approval/error/disconnected 来自 DSH contract，不从终端文字猜测。
- Exit/Duration：只在真实退出码或计时事实存在时显示；`null` 不显示为 0。
- Attention：有待审批或错误时显示文本和图标，不只改变颜色。

### 7.3 视觉与安全

- 分段采用 flex、圆角、边框和 DSH 线性图标，不依赖 Powerline 字形或 Nerd Font。
- 路径、分支、会话名均作为 React 文本节点渲染；禁止 `innerHTML`、ANSI 拼接和 `eval`。
- 清洗 ESC、OSC、CSI 和控制字符；绝不把状态栏字符串注入 PTY。
- 不执行 zsh、Oh My Zsh、主题脚本、Git 探测子进程或插件；不读取环境变量、Token 或云端凭据。
- 窄视口按 Workspace → Runtime → Attention → Git → Duration 的优先级收缩；关键错误和审批不省略。
- 异步 Git/Runtime 结果带 epoch/request fence，旧响应不得覆盖新会话状态。

## 8. DSH 文件落点

| 文件 | 责任 |
| --- | --- |
| `packages/workbench-ui/src/styles/tokens.css` | 四源融合后的唯一 DSH 语义令牌 |
| `packages/workbench-ui/src/styles/workbench.css` | 基础 DSH 组件样式 |
| `packages/workbench-ui/src/components/primitives/**` | Button、Dialog、Menu、Tabs、Tooltip、Command、Field 等原生原语 |
| `packages/workbench-ui/src/components/dock/**` | 应用内 Dock、活动项、徽标、溢出和任务切换 |
| `packages/workbench-ui/src/components/window-frame/**` | 主窗口与系统窗口共享标题栏 |
| `packages/workbench-ui/src/components/status-segments/**` | Workspace/Git/Runtime/Exit 分段视图模型与组件 |
| `packages/workbench-ui/src/icons.tsx` | DSH 自有线性图标，不引用 Seelen 或上游品牌资产 |
| `packages/workbench-ui/visual-asset-provenance.json` | OMP 可抽取资产及三个 GitHub 来源分类、快照、SHA-256、修改说明 |
| `apps/renderer/src/platform/dsh/statusViewModel.ts` | 从真实 DSH 数据构造分段状态，缺失字段省略 |
| `apps/renderer/src/workbench/workbench.css` | 桌面组合布局，不复制 UI 令牌 |
| `apps/renderer/src/workbench/visual-baseline/**` | 固定 fixture、mask 和截图基线 |
| `packages/testkit/scripts/check-workbench-visual-assets.mjs` | 来源、许可、依赖、Seelen 零代码/素材和残留门禁 |
| `packages/testkit/scripts/check-workbench-dependencies.mjs` | 新增依赖与禁止 import 门禁 |
| `packages/testkit/scripts/native-workbench-visual.mjs` | 截图、对比度、焦点和响应式探针 |
| `THIRD_PARTY_NOTICES.md` | 实际复制/改编资产的 MIT 全文与版权声明 |

## 9. Provenance 与许可台账

P0 冻结时，每条记录至少包含：

```text
id
sourceName
sourceKind: extracted-asset | adapted-code | clean-room-reference
repositoryOrSnapshot
commitOrLocalVersion
sourcePath
sourceUrl
sha256
license
copyrightNotice
allowedUse
modifications
dshTarget
reviewer
```

门禁规则：

- Seelen 条目只能是 `clean-room-reference`；任何 DSH 目标文件标记为 `adapted-code` 或 `extracted-asset` 均失败。
- shadcn/Oh My Zsh 如为纯模式参考，可标 `clean-room-reference`；如复制或改编实质代码，必须标 `adapted-code` 并保留 MIT/版权。
- OMP `data/**`、mock JS、`window.OMP`、安装向导、CDN 原型和品牌图不得进入产品。
- 生产 bundle 禁止上游源码绝对路径、CDN、远程字体、Zsh 安装片段、Tauri/Rust 资源和未登记 data URI。
- 第三方声明与 provenance 必须一致；有资产记录但无许可，或许可已标明但构建产物无法解释，均判失败。

## 10. 验收映射

本文件对应实施计划中的新增验收：

| ID | 重点 |
| --- | --- |
| NV-14 | shadcn 模式原生化后的键盘、ARIA、焦点与组合行为 |
| NV-15 | Seelen 模式原生化后的 Dock、任务切换、吸附与窗口反馈 |
| NV-16 | Seelen AGPL 干净房间边界，零源码/素材 |
| NV-17 | Oh My Zsh 分段只显示真实、条件可见的 DSH 状态 |
| NV-18 | 状态栏文本安全、无 shell 执行、无特殊字体依赖 |
| NV-19 | 四源职责和冲突优先级一致，无第二套主题 |
| NV-20 | 新组件在 light/dark/system 和 DSH 密度下无状态缺失 |
| NV-21 | Dock/弹层/分段动效与性能符合减少动效和 p95 要求 |
| NV-22 | 三个 GitHub 来源的许可、快照、SHA-256 与第三方声明一致 |
| NQ-14 | 无四个上游项目及替代 UI 栈的新增直接/传递依赖 |

## 11. 当前验证边界

本轮已完成：

- 三个 GitHub 官方仓库、默认分支、在线提交和许可证核查。
- 确认 Seelen UI 为 AGPL v3/`AGPL-3.0-or-later`，采用零代码/素材参考边界。
- 确认 shadcn/ui 与 Oh My Zsh 为 MIT，并记录精确版权声明。
- 完成四源融合、组件映射、Dock/窗口交互、状态分段、文件落点和门禁设计。

本轮未完成：

- 未下载或冻结上游文件，未计算本地来源 SHA-256。
- 未创建 provenance、第三方声明或任何产品源码。
- 未安装依赖、未构建、未执行组件或 Electron 测试、未做截图和对比度实测。
- 未提交、未推送、未发布。

## 12. 一手来源

- [shadcn/ui 仓库](https://github.com/shadcn-ui/ui)
- [shadcn/ui MIT 许可](https://github.com/shadcn-ui/ui/blob/055aa6b7837b1808456a24beb4c97a677864aa82/LICENSE.md)
- [shadcn/ui 当前 New York v4 registry](https://github.com/shadcn-ui/ui/tree/055aa6b7837b1808456a24beb4c97a677864aa82/apps/v4/registry/new-york-v4/ui)
- [Seelen UI 官方仓库](https://github.com/eythaann/Seelen-UI)
- [Seelen UI AGPL v3 许可](https://github.com/eythaann/Seelen-UI/blob/bc08d1f1b1894653ce6be52738cc6ca4c0e43a85/LICENSE)
- [Seelen UI 设计系统](https://github.com/eythaann/Seelen-UI/blob/bc08d1f1b1894653ce6be52738cc6ca4c0e43a85/documentation/design-system.md)
- [Oh My Zsh 仓库](https://github.com/ohmyzsh/ohmyzsh)
- [Oh My Zsh MIT 许可](https://github.com/ohmyzsh/ohmyzsh/blob/6c31a91a3e82b4055b36cc088c2f27f81119ba60/LICENSE.txt)
- [agnoster](https://github.com/ohmyzsh/ohmyzsh/blob/6c31a91a3e82b4055b36cc088c2f27f81119ba60/themes/agnoster.zsh-theme)
- [af-magic](https://github.com/ohmyzsh/ohmyzsh/blob/6c31a91a3e82b4055b36cc088c2f27f81119ba60/themes/af-magic.zsh-theme)
