# X0.9 浏览器威胁模型与拒绝基线

- 日期：2026-11-24
- 范围：Desktop Main / preload / `WebContentsView` / OMP 链接适配 / 便携生产包。
- 结论：**安全基线已建立，浏览器功能门未通过，XG0 未通过**。本文不把安全拒绝探针表述为正式浏览器已开放，也不授权直接扩建浏览器面板。

## 标准安装版补充（2026-11-25 · 当前结论）

标准 electron-builder NSIS x64 安装包已在全新隔离目录安装并启动。安装版加载真实 `file://` Renderer，Runtime ready，Files/Git/原生 PTY/重载/关窗清理通过；F12 与 Ctrl+Shift+I 未保持 DevTools，非法 `javascript:` 外链被 Main 拒绝。安装版截图与机器可读结果见 `F:\workbuddy data\deliverables\dsh-studio\standard-package-20261125\evidence\installed-app-smoke.json` 与 `installed-app.png`。

未改动的安装包 `main.js` 另经临时主进程调试作用域调用现有浏览器处理器，完成 3 轮真实 BrowserView 创建、导航、重载与销毁：Renderer OS PID 全部退出，13 类自定义监听器归零，WebContents 回基线；popup、DevTools 与 `javascript:`/`data:`/`file:` 导航均拒绝。Chromium fake audio/video input 可枚举，但 `getUserMedia` 均返回 `NotAllowedError`。证据见同目录 `installed-browser-probe.json`、`installed-browser-probe.log` 与 `installed-browser-view.png`；探针没有修改安装包，也没有向生产 preload 增加 `browser:*` API。

该结果关闭了 2026-11-24 记录中的“标准安装包未验证”“默认压缩构建失败”和“安装版 BrowserView OS 资源计数未验证”缺口，但不关闭浏览器功能门：preload 仍未暴露 `browser:*`，生产持久登录入口、物理媒体与 Windows 权限弹窗仍未验证。虚拟设备只证明软件权限路径 fail-closed，不代表真实摄像头/麦克风或系统弹窗通过。代码签名、签名更新源与真实自动更新升级也未验证。XG0 仍未通过，X1 未开始。

## 1. 资产与信任边界

| 边界 | 信任假设 | 可访问能力 |
|---|---|---|
| Desktop Main | 完全受信 | 文件、Git、PTY、Runtime、窗口与浏览器生命周期 |
| preload | 完全受信，但接口必须窄 | 将 Renderer 请求转成 IPC；浏览器 API 在 X5/XG5 前不暴露 |
| 主窗口 Renderer | 初始受信；XSS 或远程导航后不可继续视为完全受信 | `window.dsh`、`window.dshStudio`、终端与语义化外链桥 |
| `WebContentsView` 网页 | 不可信 | 不得访问 Node、preload、Runtime、PTY、文件或宿主 cookie |
| 弹窗、子框架、下载、权限请求、外部链接 | 不可信 | 默认拒绝，只有显式策略和票据可放行 |
| 浏览器存储空间 | 按 workspace 隔离 | 仅在用户选择的持久 partition 内保留登录态 |

默认 Electron `session` 不是隔离边界；主窗口与浏览器 view 未显式分区时，不能假设 cookie/localStorage 已隔离。

## 2. 当前已实现控制

| 控制 | 证据 | 结论 |
|---|---|---|
| 主窗口 `contextIsolation:true`、`nodeIntegration:false`、固定 Renderer 入口 | `apps/desktop/src/main.js`、`src/browser-security.js` | 仅接受精确 dist file URL 或 loopback 开发入口；packaged 无 dist 时拒绝回退 5173；主窗口仍为 `sandbox:false`，不宣称 Renderer 进程沙箱化 |
| Electron 45 导航事件适配 | `apps/desktop/src/browser-security.js`、`apps/desktop/src/main.js` | details 对象优先读取 `url/isMainFrame`；deprecated 参数区分 `isSameDocument` 与 `isMainFrame`，`will-redirect` 区分 `isInPlace` 与 `isMainFrame` |
| 浏览器 view `contextIsolation:true`、`nodeIntegration:false`、`sandbox:true`，无 preload | `apps/desktop/src/main.js` | 基础隔离已配置，真实页面探针确认无 Node/桌面桥接全局对象 |
| 浏览器按 opaque workspace ID 使用独立非默认 session | `apps/desktop/src/main.js`、`src/browser-security.js` | 临时 `dsh-workspace-<id>`，持久候选 `persist:dsh-workspace-<id>`；真实探针确认 A/B/default session 不同 |
| 弹窗全部拒绝 | `apps/desktop/src/main.js` | 主窗口和浏览器 view 的 `window.open` 均 deny，不创建额外 webContents |
| 导航、重定向、子框架在 Main 层校验 | `apps/desktop/src/main.js`、`src/browser-security.js` | 仅 HTTP(S) 顶级导航；子框架仅同源 HTTP(S) 或 `about:blank`；真实跨域重定向/iframe/远程主导航已拒绝 |
| 下载与权限 fail closed | `apps/desktop/src/main.js`、`src/browser-security.js` | 下载真实阻止；权限 check/request 统一 false；fake-device `getUserMedia` 返回 `NotAllowedError`，不自动授权 |
| 特权 IPC 校验主 webContents、mainFrame 与精确 Renderer URL | `apps/desktop/src/main.js`、各 `ipcMain.handle` | 真实探针确认可信主 frame 成功，foreign webContents 与 child frame 均 `PERMISSION_DENIED` |
| preload 不暴露任何 `browser:*` API | `apps/desktop/src/preload.cjs` | Renderer 当前不能启用托管浏览器；Main 内实验 handler 仍受统一身份门保护 |
| 生产模式关闭 DevTools 菜单、快捷键与 `devtools-opened` | `apps/desktop/src/main.js` | loopback 与便携生产包均验证 F12/Ctrl+Shift+I 不能保持打开；生产包 page target 始终 1、devtools target 0 |
| 统一销毁与 renderer crash 清理 | `apps/desktop/src/main.js`、`browser-security-probe.cjs` | view 关闭使用 `waitForBeforeUnload:false`；3 轮真实创建/关闭后 Renderer OS PID 退出、监听器归零、WebContents 回基线；crash 触发销毁 |
| Renderer 外链统一 fail closed | `apps/renderer-omp/src/browser/urlSafety.ts`、`browserLinks.tsx` 及各链接入口 | 普通外链仅显式 HTTP(S)，mailto 单独严格解析，扩展 scheme 必须结构合法且已注册；非法值渲染为 inert span |
| 系统外链桥与 Main 复核 | `preload.cjs` 的 `ompStudioChrome.openUrl`、`shell:open-external`、`createExternalUrlIpcHandler` | Renderer 点击阻止默认导航，Main 再校验 sender 与 URL，仅调用 `shell.openExternal`；不创建 Electron 窗口；生产包桥已存在并拒绝 `javascript:` |

## 3. 威胁与控制落地

| ID | 威胁 | 已落地控制 | 剩余边界 |
|---|---|---|---|
| B-T01 | 任意 IPC 上下文导航、改 bounds、读浏览器状态 | 特权 handler 校验 webContents、mainFrame、精确 Renderer URL；preload 不暴露浏览器 API | 正式浏览器 IPC 尚未开放；开放前必须补真实端到端用例 |
| B-T02 | `file:`、`data:`、`javascript:`、自定义协议进入 view | 统一解析器仅允许 HTTP(S)，拒绝用户信息和控制字符；导航、重定向、子框架共用策略 | 编码混淆全量语料未覆盖；真实 Chromium 提前拒绝与 handler 合成分派分开记录 |
| B-T03 | 弹窗绕过导航入口 | `setWindowOpenHandler` 对主窗口和浏览器 view 一律 deny | 未来放行票据机制尚未实现，当前不存在票据重放面 |
| B-T04 | 登录态跨 workspace 或与主窗口共享 | 独立非默认 session；`persist:` 命名与跨重启恢复有独立真机探针 | 生产入口仍使用非持久 session；生产持久登录空间尚未开放，生产包恢复未验收 |
| B-T05 | 页面重定向或嵌入不可信 frame | Main 拦截顶级导航、重定向、`will-frame-navigate`；子框架仅同源 HTTP(S) 或 `about:blank` | 真实跨域重定向/iframe/远程主导航已通过；编码混淆语料未覆盖，Chromium 提前拒绝与 handler 合成分派分开记录 |
| B-T06 | 页面触发下载、定位、摄像头或麦克风 | `will-download` 默认阻止；权限 check/request 统一 false | 标准安装版 BrowserView 连续 3 轮验证 fake-device 音频/视频输入可枚举且 `getUserMedia` 均返回 `NotAllowedError`；物理设备与 Windows 系统权限弹窗未验证 |
| B-T07 | 生产模式暴露 DevTools | 生产关闭菜单项、F12/Ctrl+Shift+I、`devtools-opened`；开发开关显式开启 | loopback、便携生产包与标准安装版均验证 F12/Ctrl+Shift+I 不能保持打开；标准安装版 page target 1、devtools target 0 |
| B-T08 | view 泄漏、监听器残留、状态回调继续运行 | `disposeBrowserView` 统一 detach、移除监听、关闭 webContents、清 bounds；crash 触发销毁 | 标准安装版 3 轮 BrowserView 创建/导航/重载/销毁后 Renderer OS PID 全退出、13 类监听器归零、WebContents 回基线，Runtime 保持 ready；未改包体或开放生产浏览器 API |
| B-T09 | Renderer 被导航到攻击者页面后仍调用特权接口 | `DSH_RENDERER_URL` 只接受精确 dist file URL 或 loopback；主导航与 IPC 均校验身份 | 真实 foreign/child IPC 与 loopback 导航已通过；标准安装版加载真实 `file://` Renderer、重载无异常并拒绝非法外链；编码混淆与未来新增 browser IPC 仍需回归 |
| B-T10 | OMP 链接组件渲染危险 `href` 或默认主导航 | 共享严格 URL 边界；合法点击主动 `preventDefault` 后经语义桥到 Main；Main 再校验并调用 OS handler；非法值 inert | 真实 React 点击 `isTrusted:true`、无导航/新窗口、危险值 inert 已通过；标准安装版桥存在且非法 URL 被拒；未实际启动系统浏览器或邮件客户端 |

## 4. Partition 与持久化策略

1. 每个 workspace 使用独立 partition，命名只包含服务端生成的 workspace ID，不使用用户路径或 URL。
2. 临时浏览使用非持久 partition；关闭即销毁，不写入磁盘。
3. 主窗口 Renderer 与浏览器 view 使用不同 session，禁止共享登录态。
4. partition 创建、切换、清除均由 Main 授权；Renderer 只能传 opaque workspace/session ID。
5. 持久化只覆盖 cookie 与显式允许的 storage；不持久化 DevTools、页面脚本状态或下载文件。
6. 退出和 workspace 关闭时按策略清理临时 session；持久 session 的清除必须由用户明确确认。

以上是开放持久登录空间前的目标策略。当前生产 `ensureBrowserView()` 仍使用非持久 partition，preload 浏览器门保持关闭。独立真机探针已证明 `persist:dsh-workspace-<id>` 在 Electron 完整退出重启后恢复带 `Max-Age` 的 cookie 与 localStorage，sessionStorage 不恢复，其他 partition 与 default session 不受影响；该证据不等于生产入口已开放。

## 5. 安全拒绝测试基线

以下用例必须在 X5.6/X5.7 和 X7.3 执行；本轮已建立自动拒绝回归、真实 Electron/Chromium 探针与便携生产包运行证据，但**未全部闭环**。

| 测试 ID | 场景 | 本轮证据 | 结论 |
|---|---|---|---|
| B-SEC-01 | 伪造 webContents、frame、origin 调用特权 IPC | 单测拒绝 foreign contents/child frame/错误 URL；真实探针可信主 frame 成功、foreign main 与 child frame 均拒绝 | 已覆盖；正式 `browser:*` 仍不暴露 |
| B-SEC-02 | 直接导航、页面重定向、iframe 使用危险 scheme | 危险 scheme 单测通过；真实跨域重定向与 iframe 拒绝；真实 `file:`/`data:` location 尝试后页面保持安全、Electron 导航事件 0；另向 handler 分派 4 个危险 scheme 均 preventDefault | 当前观察路径已覆盖；Chromium 提前拒绝与 handler 拒绝分开记录；编码混淆语料未覆盖 |
| B-SEC-03 | `window.open` 无票据、票据重放、跨 workspace 使用 | 真实探针触发 popup，handler 返回 deny，未创建额外 webContents | 无票据拒绝已覆盖；票据机制未实现 |
| B-SEC-04 | 页面触发下载和定位/摄像头/麦克风权限 | 真实下载 1/1 阻止；标准安装版 3 轮 fake-device 音频/视频 `getUserMedia` 均返回 `NotAllowedError`；权限处理器 fail-closed | 虚拟设备拒绝路径已覆盖；本机无物理摄像头/麦克风，真实设备与系统权限弹窗未验证 |
| B-SEC-05 | 两个 workspace 与主窗口分别写入 cookie/localStorage | 真实 A/B/default session 隔离；独立 seed/verify 两个 Electron 进程证明持久 cookie/localStorage 恢复、sessionStorage 清空、control partition 隔离 | 临时与持久机制已用 loopback 覆盖；生产入口尚未开放 |
| B-SEC-06 | 浏览器页面探测 `require`、`process`、`window.dsh`、Node API | 真实页面四类全局对象均为 `undefined` | 已覆盖 |
| B-SEC-07 | 生产模式 F12、菜单、远程页面请求 DevTools | loopback、便携生产包与标准安装版均验证 F12/Ctrl+Shift+I 不能保持打开；标准安装版 page target 1、devtools target 0 | 已覆盖 |
| B-SEC-08 | 主窗口远程导航、错误 file 入口、子 frame 调用特权 IPC | Renderer 入口身份单测、真实 child/foreign IPC 拒绝、loopback 真实远程导航拒绝；标准安装版加载精确 `file://` 入口且重载无异常 | loopback 与标准安装版入口已覆盖；编码混淆与未来新增 browser IPC 仍需回归 |
| B-SEC-09 | 反复 hide/show、renderer crash、主窗口关闭 | loopback hide/show 3 轮、crash 销毁、3 轮 BrowserView OS 清理；标准安装版 BrowserView 3 轮独立资源回收及关窗后 10 个跟踪子进程全部退出、退出码 0 | 安装版 Runtime/PTY/Renderer/BrowserView 清理均已覆盖；真实 Runtime 拒退出与超时仍未验证 |
| B-SEC-10 | 非有限数、负数、超大浏览器 bounds | 单测拒绝非有限/空/超大，允许负 DIP 坐标 | 已覆盖 |
| B-SEC-11 | Renderer Markdown、引用、GitHub、更新、扩展链接含危险协议/凭证/控制字符/未注册 scheme | `renderer-link-safety.test.mjs` 8/8；真实 React 19.3.1 点击合法 HTTP(S)/mailto 到达桥，危险链接 inert，调用方 preventDefault 不重复打开，导航 0、新窗口 0；标准安装版桥存在且非法 URL 被拒 | 渲染、真实点击与安装版桥已覆盖；未实际启动 OS 浏览器/邮件客户端 |

## 6. 回归证据与未验证项

- `node --test packages/testkit/test/browser-security.test.mjs packages/testkit/test/renderer-link-safety.test.mjs`：**34/34 通过**，其中浏览器安全 **26/26**、Renderer 链接安全 **8/8**。
- `npm run check`：**198/198 通过，0 失败**；`production-preview-boundary.test.mjs` **6/6**。
- `npm run studio:test`：**38 个文件、525/525 通过**；`studio:typecheck`、`studio:build`、架构与入口检查均通过。
- 默认压缩构建已通过：WSL 主 Renderer 29 modules、WSL OMP 3082 modules、Windows 打包 OMP 3123 modules。2026-11-24 的 LightningCSS 缺失记录为历史状态。
- `browser-security-probe.cjs`：Electron **45.4.1** 真实进程确认 session 隔离、无 Node/桌面全局对象、真实跨域重定向 1、iframe 1、远程主导航 1、下载 1/1、popup 1、DevTools 打开 1 后关闭、foreign/child IPC 拒绝、存储隔离、hide/show 3 轮与 crash 销毁。3 轮独立 BrowserView 创建/关闭的 Renderer OS PID 5432、9188、25424 均退出、监听器 0、WebContents 回基线。
- `browser-partition-restart-probe.cjs`：两个独立 Electron 进程完成 seed/verify，持久 cookie/localStorage 恢复，sessionStorage 清空，control partition 隔离且非 default session。生产入口仍关闭。
- `browser-links-component-probe.cjs`：真实 Electron + React **19.3.1**，Windows `user32 SetCursorPos + mouse_event` 产生 `isTrusted:true` 点击；合法 HTTP(S)/mailto 到达 `ompStudioChrome.openUrl`，危险 URL 渲染为 `SPAN` 且无 href，调用方 preventDefault 后不重复打开，导航事件 0、新窗口 0。Electron `sendInputEvent`/CDP 未产生点击的失败尝试不计入通过证据。
- `browser-ipc-probe.html`：fake-device `getUserMedia` 返回 `NotAllowedError`，合法 Renderer 点击与 IPC 点击均 `isTrusted:true`，非法 external IPC 与 foreign IPC 被拒，外链创建窗口 0。fake device 只提供确定性 Chromium 设备，不自动授予权限，也不代表真实硬件验收。
- 便携生产包（历史）：ASAR SHA-256 `cf70c3f4576970675e404eae4fed9ccf31f32879164f8c2229c6bc944029140a`；真实 `file://` Renderer、Runtime ready、Files/Git、node-pty、DevTools、Renderer 重载、非法外链拒绝与关窗进程清理通过。`packaged-run-3.png/json` 为最终运行证据。该包是手工 ASAR + Electron 发行目录，不是标准安装包。
- 标准安装版（2026-11-25）：electron-builder NSIS x64 隔离安装退出码 0；真实 `file://` Renderer、Runtime ready、Files/Git、原生 PTY、Renderer 重载、危险外链拒绝、DevTools 拦截与关窗 15 个子进程清理通过。安装包 SHA-256 `d2ba5762c4be2a4851e8513bdc8bcbf966823d8cc90d09f2595881026f979f66`，ASAR SHA-256 `c1a74c9fa775d401d39826be567b6cc4a3871ae9e704274410702c140895f357`。证据位于 `F:\workbuddy data\deliverables\dsh-studio\standard-package-20261125\evidence`。该核心冒烟未创建 BrowserView；另以未改动的安装版 `main.js` 完成 3 轮独立 BrowserView 资源回收，Renderer OS PID 全退出、13 类监听器归零、WebContents 回基线，Runtime 保持 ready，关窗后 10 个跟踪子进程全部退出。虚拟音频/视频输入可枚举但 `getUserMedia` 均返回 `NotAllowedError`；生产 `browser:*` preload API 未开放。证据为同目录 `installed-browser-probe.json`、`installed-browser-probe.log`、`dsh-installed-browser-probe.mjs` 与 `installed-browser-view.png`。
- 未验证：生产持久登录入口、实际 OS 浏览器/邮件客户端启动、物理摄像头/麦克风、Windows 系统权限弹窗、双屏/异 DPI/热插拔、代码签名、签名更新源与真实自动更新升级、最终品牌图标定稿，以及 E-05 真实 ASR/judge/MCP/Agent 适配器与授权/费用/回执。

**门禁**：B-T01～B-T10 的生产控制已接线，B-T10 与 B-SEC-11 已有真实点击和安装版桥证据；安装版 BrowserView 资源与虚拟媒体拒绝路径已通过，B-SEC-04/05/09 仍保留物理设备、系统权限弹窗、生产持久登录与真实 Runtime 拒退出缺口。默认压缩构建、完整回归与标准安装版核心真机回归已通过，但托管浏览器仍须保持禁用，不得作为正式工具开放；XG0 仍未通过，X1 未开始。
