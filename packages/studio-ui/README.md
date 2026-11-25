# @studio/ui-shell

DeepSeek Harness 前端的**工作台化**改造：把 DSH 的一屏三栏换成可停靠的工作台。

这是一个 **DSH 客户端插件**（方案 B：`dsh.client` + `window.__ModuleLoader__`），
不是独立前端。它接管两个座位：

| 座位 | 类型 | 我们注册的 key | 官方占位 |
|---|---|---|---|
| `sidebar` | single | `id: 'studio-sidebar'`, `priority: -1` | `@deepseek-ai/dsh-client-ui-sidebar` |
| `main` | keyed | `key: 'conversation'`, `priority: -1` | `@deepseek-ai/dsh-client-ui-conversation` |

`priority` **必须是负数**：数字小的赢，官方占 0。写成正数不会报错，只是官方继续渲染
（静默失败，最难查的那种）。

## 真机验证状态（0.2.2-rc.5，Windows + WSL2）

`spike/electron-render/probe-workbench-deep.cjs` 三阶段实测 **PASS**：

```json
{"hasSidebar":true,"sidebarItems":12,"hasWorkbench":true,"tabCount":1,
 "roles":{"system":1,"user":4},"refCount":1,"applies":20}

{"tabs":2,"bodies":2,"refCountAfter":[2],"leaseSizeAfter":1,"appliesAfter":20}
//        ↑ 两个窗口            ↑ 引用计数 2      ↑ 底层只有 1 条 retain   ↑ 不重折

{"leaseSize":0,"hubSize":0,"empty":"true","backdrop":true,"cachedSessions":1}
//  ↑ 关光即释放          ↑ UI 回空态                     ↑ 折叠结果仍留缓存
```

三条判据正好对应 `docs/composition.md` 的验收表 A/B/C —— 只是这次跑在真机上，
而不是 jsdom 里。

第二轮（`probe-workbench-v2.cjs`）验面板菜单与拖拽落区：

```json
{"hasTopbar":true,"hasMenuButton":true,"applies":20}
{"opened":true,"items":2,"names":["工作台状态","会话信息"],"tabsAfter":2,
 "panelHosts":["studio-debug"],"panelHostVisible":"true"}
{"previewKind":"zone","panesBefore":1,"panesAfter":2,"paneTabCounts":[1,1],
 "paneRects":[{"x":280,"w":572},{"x":853,"w":572}],"splitSizes":[0.5,0.5],
 "appliesAfter":20,"progress":{"min":0,"max":19}}
verdict PASS (菜单=true 拖拽分屏=true 不重折=true applies 20→20)
```

两点值得注意：
- `previewKind: "zone"` —— 拖动时真的出现了落区预览，说明热区几何在真实尺寸下算对了
  （`edge = clamp(w*0.08, 64, 112)`，1144px 宽的主区算出 91px）；
- `applies 20 → 20` —— 拖拽分屏让会话视图**卸载重挂**，但没有重复折叠。

第三轮（`probe-workbench-v3.cjs`）验输入框全链路（**唯一有写操作的一轮**，
先新建空会话再发，避免污染已有对话）：

```json
{"hasComposer":true,"inputPlaceholder":"输入消息，Enter 发送","sendDisabled":true}
{"sendDisabledAfterType":false,"activeSession":"session-74f45181…","tabCount":2}
{"targetSession":"session-74f45181…","after":[{"users":1,"systems":0,
  "userTexts":["你studio 输入框自检：这条消息来自 probe"]}],
 "inputValue":"","error":null}
verdict PASS (送达=true 输入框已清空=true 折叠注入=true users=1)
```

`users: 0 → 1` 是关键：Host 实际回推了 **4 条** `user/message`（我们的文本 +
3 条 system-reminder 注入），界面只显示 1 条 —— 说明按 `source.kind` 的折叠生效了。

第四轮（`probe-workbench-v4.cjs`）验附件：

```json
{"hasAttachButton":true,"attachDisabled":false,"attachTitle":"附件"}
{"chips":[{"status":"ready","visible":true,"text":"▤probe.txt · 14 B×"}],
 "chipStatus":"ready","activeSession":"session-1f3e4711…"}
{"users":1,"userTexts":["你附件自检：这条带一个 probe.txt"],
 "inputValue":"","attachmentsLeft":0,"error":null}
verdict PASS (上传=true 送达=true 清空=true)
```

`attachmentsLeft: 0` 说明发送成功后附件列表也清空了，不是只清文字。

第五轮（`probe-workbench-v5.cjs`）验**回显里的图片渲染**。图片用 canvas 现场生成，
不依赖磁盘样本：

```json
{"hasComposer":true,"hasAttach":true,"attachDisabled":false}
{"blobBytes":3408,"chipStatus":"ready","chipText":"probe-shot.png · 3 KB"}
{"before":{"images":0,"chips":0,"failedChips":0},
 "after":{"images":1,"imageSrcs":["blob:http://…"],"chips":0,"failedChips":0,
          "userTexts":["你图片附件自检：这条带一张 canvas 生成的图"]}}
verdict PASS (上传=true 渲染=true blob=true 无降级=true)
```

`imageSrcs` 是 `blob:` 开头这点很关键：它证明字节真的经过 `readAttachment` 走了
blob URL，而不是复用了上传时的本地预览。截图里那张蓝黄配色的 STUDIO 图就是渲染结果。

顺带记一条：`capturePage` 在无 GPU 合成时可能抛 `UnknownVizError`。探针现在**先算判定
再截图**，并给截图加一层带 rect 的重试 —— 不能因为拿不到截图就丢掉已经拿到的结论。

第六轮（`probe-workbench-v8.cjs`）验**停止按钮真正打断生成**。发一条"数到 200"，
等生成开始后点停止：

```json
{"firstSeen":50,"stillThere":true,"clickedAt":1550,"charsBefore":6,
 "stopTextAtClick":"停止","stopVisibleNow":false,
 "assistantText":"DSH1 2 3 4 5 6 7 8 9 10 … 21","composerError":null}
verdict PASS (出现=true 持续存在=true 点到=true 点前已生成=true 点后消失=true 无错误=true 截断=true)
```

四个数字连起来才是完整证据：

- `stillThere: true` —— 按钮在 1.5 秒后**仍在**。同一时刻 `snapshot.running` 早已是
  false（见下一节），说明改用 `streaming` 判据是必须的，不是美化；
- `charsBefore: 6` —— 点击时助手**已经在输出**，不是取消一个还没开始的动作；
- `stopVisibleNow: false` —— 点后按钮消失；
- `assistantText` 停在 `21`（目标是 200）—— **真的被截断了**。

这一轮之前失败过三次，每次都不是代码问题而是**环境**：studio profile 没有可用模型
路由。根因是 base bundle 里 `llm-pi-ai` 是"休眠"挂载（零路由），默认路由指向
`deepseek-official` 而本机凭据只有 `OPENCODE_GO_API_KEY`。studio 的
`cordis.patch.yml` 里补了两条（声明 `opencode-go` 路由 + 指默认模型）之后才跑通，
web 主 profile 全程没动。

第七轮（`probe-workbench-v9.cjs`）验**历史加载入口的显隐判据 + 回归**：

```json
{"hasMoreAttr":"false","olderButtonVisible":false,"consistent":true,
 "messages":"1","synthetic":"4","hasComposer":true,"hasSend":true,
 "hasAttach":true,"stopVisible":false}
verdict PASS (判据一致=true 有输入框=true 有发送=true 有附件=true 无停止按钮=true)
```

**这一轮没能验加载本身**，如实说明：环境里最长的会话只有 1 轮（20 个事件），而一页
最多能装 500 条消息，`hasMore` 恒为 false —— 加载路径在真机上没有触发条件。造一个
500+ 消息的会话要跑几十轮，不现实。所以加载路径由 12 个单测覆盖（保真到
`deferConsumption` 配对与滚动换算），真机只验了"判据正确、不乱弹入口"。

第八轮（`probe-workbench-v10/v11.cjs` + 两个诊断脚本）验本轮四项：

```json
// 工具调用：状态迁移发生在**同一条 chip** 上（chipCount 恒为 1）
[{"t":0,"chipCount":0},{"t":300,"chipCount":1,"statuses":["running"]},
 {"t":2100,"chipCount":1,"statuses":["done"]},{"t":4300,"stopVisible":false}]
// 流式工具预览（采样降到 30ms + 多工具任务后才抓到）
{"sawLiveTool":true,"finalChips":[{"status":"done"} ×7]}
// lightbox：八项全绿
{"opened":true,"modal":"true","bodyOverflow":"hidden","focusedIsClose":true,
 "saveHref":"blob:http://…","closedByEsc":true,"focusRestored":true,"overflowRestored":true}
// steer：新消息接管，seq 时间线见「打断（steer）」一节
{"hasSteerMarker":true,"turns":{"start":1,"end":1},"assistantCount":2,"inputValue":""}
verdict PASS (lightbox=true steer=true)
```

**思考过程（`reasoning-delta`）在这一轮没能真机验证**，但原因查清了：
`probe-diag-chunks.cjs` 直接数窗口里的 chunk 类型，结果是

```
chunkTypes: { "block-start": 60, "text-delta": 4629 }
eventTypes: { "assistant/live-chunk": 4689 }
```

**完全没有 `reasoning-delta`** —— haiku-5-5 与 minimax-m3 在 opencode-go 这个路由下
都不产出思考增量（两个模型的元数据里都写着 `reasoning: true`，但实际流里没有）。
所以这是**模型/路由能力**问题，不是提取或渲染的缺陷。提取与渲染有 14 条单测覆盖
（含思考与正文交错、attempt 切换、只有思考没正文）。要真机验证得换一个真发
reasoning 的模型。

顺带用 `probe-diag-events.cjs` 做了一次折叠完整性核对：那个会话有
`assistant/attempt` 但**没有 `assistant/message`**（当时模型调用失败了），所以界面上
1 条用户消息、0 条助手消息是**正确反映日志**，不是折叠漏消息。同一份诊断还确认了
`synthetic: 4` 的来源 —— 4 条 `user/message` 里 3 条是注入
（`runtime-context` / `skill-catalog` / `time-context`），加 1 条 `system/message`。

第九轮（`probe-workbench-v12.cjs`）验工具结果全文与多图相册：

```json
// 工具结果：预览 400 → 展开 20000（上限），总数 20994，越界提示同步出现
{"toolStatus":"done","beforeChars":400,"afterChars":20000,
 "toggleTextBefore":"展开全文（共 20994 字符）","toggleTextAfter":"收起全文",
 "clippedNote":"只保留前 20000 字符，完整输出在会话日志里（共 20994 字符）",
 "chipCount":1,"seen":["running","done"]}
// 相册：一条消息两张图，点第一张 → 1/2 → 按 → 2/2 且图真的换了
{"thumbs":2,"readyChips":2,"counterBefore":"1/2","counterAfter":"2/2",
 "imgChanged":true,"closed":true}
verdict PASS (工具全文=true 相册=true)
```

注意 `chipCount: 1` 且 `seen` 从 running → done：**结果合并回同一条 chip**，
不是两条。

第十轮（`probe-workbench-v13.cjs`）验面板落位：

```json
// 右侧：切出 row split，多一个格；浮窗数量不变
{"panelId":"studio-debug","chipLabel":"右侧",
 "before":{"panes":1,"rowSplits":0,"floats":0},
 "after":{"panes":2,"rowSplits":1,"floats":0},"menuClosed":true}
// 浮窗：浮窗 +1，格数回退（tab 从格里移走了）
{"panelId":"session-info","chipLabel":"浮窗",
 "before":{"panes":2,"rowSplits":1,"floats":0},
 "after":{"panes":2,"rowSplits":1,"floats":1},"menuClosed":true}
verdict PASS
```

截图同时确认了内容真的进去了：右栏显示「工作台状态」的计数表（打开标签 2 / 浮窗 1 /
折叠 applies 20…），浮窗标题栏是「浮窗 会话信息」。



## 目录

```
src/
  shell/                 真机接线层（只这一层认识 DSH）
    client-entry.tsx       apply()：建单例、注册两个座位、暴露 __STUDIO_DEBUG__
    main-panel.tsx         主区：WorkbenchView + SessionViewsProvider + renderContent
    sidebar.tsx            左栏：真实会话列表 + 新建
    conversation-body.tsx  会话正文：事件 → 折叠 → 渲染
    event-hub.ts           事件订阅唯一入口（同会话只订一次）+ 折叠进度
    event-adapter.ts       真实 SessionEvent → 派生折叠输入
    live-stream.ts         流式文本 + 思考过程提取（只读派生，不进折叠缓存）
    tool-call-view.tsx     工具调用：收起成一行 / 展开看参数与结果（结果可展开全文）
    image-lightbox.tsx     图片全屏查看：Esc / 点背景关闭、焦点还回、另存、多图翻页
    format.ts              字节数格式化（抽出来避免两个附件模块循环依赖）
    composer.tsx           输入框：文本 + 附件（选文件 / 粘贴 / 拖入）
    attachment-view.tsx    气泡里的附件：图片缩略图 / 文件 chip / 失败降级
    attachment-images.ts   图片字节读取与按 attachmentId 共享的缓存
    service-slot.ts        可选服务的可订阅槽（配 ctx.inject 条件注入）
    session-pane.tsx       正文 + 输入框的 flex 布局；订阅 streaming 供停止按钮判据
    topbar.tsx             顶栏 + 面板菜单
    builtin-panels.tsx     内建面板：工作台状态 / 会话信息
    error-boundary.tsx     面板级错误边界（一个面板炸了不影响工作台）
    styles.ts              光标动画与滚动条
    open-session.ts        "打开会话"的唯一实现（左栏与主区共用）
  workbench/              停靠状态机（零 React、零 DOM）
  session-derived/        事件折叠缓存（零依赖）
  ui-panel-host/          面板契约 / 注册表 / 尺寸档位 / PanelHost
  ui-session-views/       会话多视图绑定（retain 引用计数 + 宽限期）
  ui-workbench/           窗口宿主（标签条 / 停靠面 / 浮窗 / 拖动；`placement.ts` 区域→切分）
  qa/                     装配验收（8 条跨包判据，纯测试）
scripts/build.mjs         rolldown → lib/client.js
```

依赖方向严格单向：`shell` → `ui-workbench` / `ui-session-views` / `ui-panel-host` → `workbench` / `session-derived`。
前四层不认识任何 DSH 类型，所以能在 Node / jsdom 里全测（**491 个用例**）。

## 构建

```bash
npm -w @studio/ui-shell run build     # → lib/client.js（约 113 KB）
```

产物形状（与官方插件逐字对齐）：

```js
window.__ModuleLoader__.load({ id: '@studio/ui-shell', factory: function (require) {
  var module = { exports: {} }; var exports = module.exports;
  ...                              // rolldown 输出的 CJS
  exports.apply = apply; exports.inject = inject;
  return module.exports;
}});
```

**所有 `react` / `react-dom` / `@deepseek-ai/*` 必须 external**。打进来会出现第二份
React 实例，hooks 立刻报错；`@deepseek-ai/*` 打进来则与官方的 context 不共享。

## 真机验证

```bash
# 1) 起 DSH（web profile 变体；studio 是带我们插件的独立 profile）
wsl -d Ubuntu -e bash -c 'dsh --profile studio --port 3099 --host 127.0.0.1 --no-open'
# 从 stdout 里取 token

# 2) 用 Electron 加载它（DSH 没有官方 Electron 壳，这就是客户端窗口的等价物）
#    PowerShell：必须先清 ELECTRON_RUN_AS_NODE，否则 Electron 以纯 Node 运行
$env:ELECTRON_RUN_AS_NODE = $null
& "F:\projects\dsh-studio\node_modules\electron\dist\electron.exe" `
  "F:\projects\dsh-studio\spike\electron-render\probe-workbench-deep.cjs" `
  "http://127.0.0.1:3099/?token=<token>"

# 3) 看日志
Get-Content "F:\workbuddy data\tmp\studio-probe\probe-deep.log"
```

三个必须记住的坑（都踩过）：
1. **`ELECTRON_RUN_AS_NODE` 是 Windows 全局设的（=1）**，WSL 里 `env -u` 清不掉，
   必须用 PowerShell 设 `$null`；
2. `pkill -f "dsh --profile studio"` 会匹配到自己那条 bash 命令行 → 自杀；
3. 改完 `lib/client.js` **必须重启 dsh**：boot graph 按 rev 哈希，不重启还是旧产物。

## 三处真机核对出来的契约修正

scaffold 阶段是照文档推断的，真机 `.d.ts` 逐字核对后改了三处：

| 项 | 原假设 | 实际 |
|---|---|---|
| retain 选项 | `{ source, connection, facets }` | **只有 `{ source, signal? }`** |
| retain 返回 | `{ ready, released, release() }` | `{ sessionId, binding, ready, release() }` —— **`binding` 同步可得**，没有 `released` |
| `retainInfo` | 同步返回 `{ connectionCount }` | `ObservableSnapshot<{ referenceCount, retainedBy }>`，要 `.getSnapshot()` |

`binding` 同步可得这点被用上了：租约注册表在 `retain` 当场就记下 binding，
首帧即可渲染外壳，少一次空白。

## 三处由真机数据驱动的设计修正

**1. 事件订阅必须按会话共享**（`event-hub.ts`）

每个视图各自订阅时，第二个窗口挂载会读到 `change.kind === 'replace'`（初次建窗就是整体替换），
而 `replace` 的处理是 `reset` + 整窗重折 —— 于是第一个窗口已经折好的 20 条状态被清空重来。
实测 `applies` 从 20 直接变 40。改成按 `sessionId` 引用计数只订一次后，稳定在 20。

**2. 折叠进度要自己记，不能信 `change.kind`**

修完上一条后，拖拽分屏又让 `applies` 变 40。原因是 `change` 是"最近一次变更"的快照字段，
**不会因为有人重读而更新**；视图卸载重挂时重新读窗口，拿到的是上一版 `replace`，被误判成
"窗口起点变了"。改成记自己的 `{min, max}` 进度后，判断依据只剩"窗口有没有朝更早方向扩展"：
内容没变就什么都不折（真机复验 `applies 20 → 20`）。

**3. 「首次铺开」必须用 ref 锁死**（`main-panel.tsx`）

`ctx.sessions.list` 的快照身份在列表更新时会换，effect 因此重跑；重跑时若工作台刚好被
用户关空，`workbenchHasTabs` 为 false，就又自动开一个标签 —— 表现为"关掉最后一个标签
它自己又回来了"。实测抓到多出来的 `wb-4`，改用 `useRef` 一次性锁死。

**附带修掉的一个更严重的问题**：调试面板最初用
`useSyncExternalStore(subscribe, () => derived.stats())`，而 `stats()` 每次构造新对象，
React 判定快照一直在变 → 无限重渲染 → 抛错 → **整棵工作台被卸载**（实测：点开面板后
标签从 1 变 0，主区空白）。两处修法：
- 面板内部改用版本号触发重渲染（原始值天然稳定）；
- 面板正文外面包 `PanelErrorBoundary`，一个面板炸了只影响那一格。

## 流式输出

`live-stream.ts` 从事件窗口尾部读出连续的 transient（`assistant/live-chunk`），按 attempt
聚合 `text-delta` 拼成文本，渲染成末尾的气泡。三条约定：

1. **不进折叠缓存**。transient 的 seq 插在 durable 之间，还可能被 `settle-assistant` 整体撤掉，
   塞进只增折叠的缓存等于让缓存背一份随时作废的中间状态；而且它每几十毫秒变一次，
   会让所有视图跟着重折。
2. **只扫尾部连续段**，碰到第一条 durable 就停 —— 不会把上一轮残留的 transient 当成"正在生成"。
3. **settle 之后自动消失**：transient 从窗口里被移除，`readLiveStream` 返回 `undefined`，
   由折叠出的 durable 消息接手，不会出现两段重复正文。

`text-delta` 的真实形状是 `{ type: 'text-delta', index, text }`，从 `data.chunk` 里取
（`data` 是 `{ attemptId, turn, step, chunk }`）。

## 输入框

```ts
session.prompt([{ type: 'text', text }], 'queue')  // → RemoteResult<{ accepted: true }>
```

三个取舍：

1. **只用 `mode: 'queue'`**，不自己判断该 queue 还是 steer。判据是会话是否在跑，
   这个状态会瞬变；猜错的后果是"想排队却打断了正在生成的回答"。
2. **不调 `beginSubmission`**（那套乐观回显）。正文直接来自事件窗口，回显会变成
   第二条真相源 —— 窗口里迟早也会出现那条消息，于是重复。慢几十毫秒换"列表里只有一份事实"。
3. **不吞错误**：`ok: false` 的 `RemoteFailure` 原样展示在输入框下方，正文区保持干净。

### 系统上下文默认折叠

真机上第一个版本的界面是这样的：一场对话里 4 条 `user/message`，其中 3 条是 Host
注入的 `<system-reminder>`（工具说明、技能列表、时间采样），另外还有一条几千字的
`system/message`（模型可见的系统提示词）——**整个视口被系统文本占满，用户翻半天
看不到自己说的话**。

判据在 `source.kind` 上（`dsh-llm/message.d.ts` 原文："a direct human prompt …
source tells them apart"）：

| 来源 | `source.kind` | 处理 |
|---|---|---|
| 真人输入 | `'user'` | 正常气泡 |
| system-reminder / 技能 / 时间采样 | `'system-prompt'` 或插件自定义 kind | 折叠 |
| 真正的 `system/message` | — | 折叠 |

折叠成一行「已折叠 N 条系统上下文」，点一下展开。**数据照常折叠进缓存**（它们确实在
日志里、也确实影响模型行为），只是默认不占版面。

### 附件

```ts
// 上传（浏览器服务 ctx.fileUpload）
fileUpload.upload(sessionId, blob, name?, signal?, onProgress?)        → { receiptId, file }
fileUpload.uploadImage(sessionId, blob, mediaType, name?, …)          → { receiptId, image }

// 发送：图片和文件统一用 file part
session.prompt([{ type: 'text', text }, { type: 'file', receiptId }], 'queue')
```

**附件统一走 `receiptId`，图片也一样。** `PromptContentPart` 的注释写得很清楚：
"File parts carry the opaque receipt returned by a preceding upload on the same
Session; the receipt of an image upload enters the message as that image."
所以不必自己 base64 塞 `image.data` —— 上传一次，发送时只带 receipt。

支持三条入口：点「+」选文件、粘贴（`paste` 的 `clipboardData.files`）、拖拽（`dragover`/`drop`）。
选文件即上传（DSH 的 staged receipt 就是为此设计），带字节进度；上传中禁用发送；
移除附件会 `revokeObjectURL`，不会泄漏 blob。

#### 可选服务的正确处理（踩过两次）

`ctx.fileUpload` 是可选能力。**不能加进插件级 `inject`** —— 硬依赖会让整个插件在
缺包时不激活，等于"为了附件把工作台也弄没了"。但也不能直接读：

```ts
ctx.fileUpload          // ← 抛错，不是返回 undefined！
```

真机上这行把 `apply()` 整个炸掉，工作台一行都没渲染。正确做法是 Cordis 的
**条件注入 + 一个可订阅的槽**：

```ts
const slot = new ServiceSlot<unknown>()
ctx.inject(['fileUpload'], (sub) => { slot.set(sub.fileUpload) })
// React 侧：const uploader = useServiceSlot(slot)
```

`ServiceSlot` 就是 `get / set / subscribe` 三个方法，配 `useSyncExternalStore` 用。
服务从无到有时附件入口自动从禁用变可用，不需要重启。

顺带两条纪律：
1. `apply()` 整体包 `try/catch`，且**两个 slot 注册放在最前面** —— 后面任何可选能力
   失败都不能影响工作台渲染；
2. 读可选服务一律走 `optionalService(ctx, key)` 那种 try/catch 包装。

### 历史消息里的附件渲染

上传与发送只是前半程；回显里的附件要单独处理，因为**上游给两种附件的东西不对等**：

| | 日志里有什么 | 能做什么 |
|---|---|---|
| 图片 | `{ type:'image', attachment: ImageAttachmentRef }`（id / 媒体类型 / 字节 / 宽高 / 名字） | `session.readAttachment(ref)` 拿字节 → blob URL → `<img>` |
| 文件 | `{ type:'file', attachment: FileAttachmentRef }`（只有 id / 名字 / 字节） | **只能显示 chip**，没有内容读取接口 |

文件没有读取接口不是遗漏：`request assembly` 会把文件投影成"名字 + 字节数 + 只读路径"
的文本给模型，日志里保留结构化引用只是为了展示与授权。所以界面上**不提供"点开预览"**
—— 给了入口却点不开比不给更糟。

三条设计：

1. **字节缓存按 `attachmentId` 全局共享**（`attachment-images.ts`）。`attachmentId` 是
   内容寻址的，天然幂等。同一张图出现在两条消息、或同一会话开两个窗口，都只读一次字节。
   缓存放在模块级单例，两个视图 `ensure` 同一个 id 时 inflight 去重。
2. **读取失败降级成 chip，不留坏图也不留转圈**。`title` 里放**具体原因**
   （"附件已被清理"）而不是通用文案 —— 用户需要知道为什么打不开。
3. **blob URL 不 revoke**。同一张图可能被多个视图同时持有，任何一方 revoke 都会让
   另一方变成裂图；而附件数量有界，页面关闭时浏览器统一回收。用引用计数换来的
   精确性不值得这个复杂度。

图片未展开时限高 220px（一张竖图会把整个对话挤下去），点击在原位放大到容器宽度。

### 图片查看与另存

点缩略图打开全屏遮罩。五个必须做对的细节：

1. **Esc 关闭 + 点背景关闭**，但点图片本身不关（看图时误触很烦）；
2. **焦点进到关闭按钮，关闭时还给触发元素** —— 否则键盘用户关掉后焦点丢在 body 上；
3. **背景滚动锁住**（`body.overflow = hidden`），否则遮罩里滚到底会穿透到正文；
4. **另存用 `download` + blob URL**：附件是内容寻址的 blob，没有可分享 URL，
   想留住图片只能触发下载（Electron 里会弹保存对话框）；
5. **多图可翻页**（← → 或按钮，带 `2 / 3` 计数，两端禁用）。同一条消息里贴 5 张
   截图时，单图遮罩逼人"关掉 → 找到下一张 → 再点开"。

相册只收**已就绪**的图：读取失败的图在缩略图位置已经是 chip，进相册只会在翻页时
闪一张空图。为此消息级渲染改成一次批量订阅（`useAttachmentImages`，依赖缓存版本号
而不是某个 id 的快照），否则第二张图读完时第一张的组件不会重渲染，相册里就少一张。

> 探针踩过两个坑：`position: fixed` 的元素 `offsetParent` **恒为 null**，用
> "可见性 = offsetParent 非空"判断会把遮罩本身判成不可见（改用
> `getClientRects().length > 0`）；另外批量订阅里若 effect 依赖数组身份，
> `ensure()` 写缓存 → 通知 → 重渲染会直接死循环（依赖改成 id 串）。

### 工具结果展开全文

折叠层**不再把结果截成 400 字符**。以前只给前 400，400 之外连"展开看看"的机会都
没有 —— 排查 `grep` 命中在第几行、`read_file` 的报错写在末尾时只能去翻日志压缩包。

现在的分工是：折叠层保留全文（上限 20000），渲染层默认显示 400 并给
「展开全文（共 N 字符）」；超过上限时展开后额外说明"只保留前 20000，完整输出在
会话日志里"。另外错误码与结果正文**分开渲染**，不再互相遮蔽。

真机数字（读一个 20994 字符的文件）：预览 400 → 展开 20000，按钮文案从
`展开全文（共 20994 字符）` 变 `收起全文`，越界提示同步出现。


### 流式工具调用预览

`tool-call-delta` 是增量的（`name` 可能只在第一个 delta 出现，`argumentsDelta`
要按序拼接）。不发预览的话，"模型决定调工具"到"`tool/call` 落库"之间有几百
毫秒空窗，界面看起来像卡住。

按 `id` 分组累积（`Map` 保序），后续 delta 没有 `name` 时**不覆盖**已有的名字。
渲染复用 `ToolCallView` 的 running 形态，保证落库前后视觉一致。

真机验证过：把采样降到 30ms 并换成多工具任务后能稳定抓到（`sawLiveTool: true`）。
100ms 采样 + 单工具任务时抓不到 —— 窗口只有几十毫秒。这一点值得记：
**不是功能没生效，是采样太慢**。

### 打断正在生成的回答

```ts
session.cancel(): Promise<RemoteResult<{ accepted: true }>>
```

契约原文：*Pending queued work remains and resumes in FIFO order after the Host
reaches cancellation quiescence* —— 所以它**只停当前这一轮**，不动已排队的消息。

两个产品决定：

1. **运行中保留"发送"按钮**（发送 = 排队）。如果把发送改成停止，就顺手废掉了
   queue 模式，而"停止的同时再排一条"恰恰是最常见的动作。所以停止是**另一个**
   按钮，排在发送左边。
2. **停止带 8 秒兜底**。工具调用中途不响应取消是常态，`stopping` 不能永远灰着；
   8 秒后恢复可点，允许再试。

#### `snapshot.running` 不能用来判断"是否在生成"

这是本轮最贵的一个教训。第一版用 `session.getSnapshot().running` 做按钮判据，
真机表现是**按钮在生成过程中消失**：

```
t=50ms    running=true    ← 按钮出现
t=2850ms  running=false   ← 按钮消失
          而此时 assistant 还在继续输出，最终写到了 69 行
```

`running` 来自 Host 的 list metadata 投影（`manager.js` 里从 `summary.running`
同步），它会抖动/滞后，**不是 turn 的生命周期**。拿它做 UI 判据，恰好会在最该点
停止的时候把按钮藏起来。

正解是用**自己折叠出来的事件状态**：

```ts
// conversation.ts 的 folding
case 'turn/start': return { ...state, streaming: true }
case 'turn/end':   return state.streaming ? { ...state, streaming: false } : state
```

`SessionPane` 订阅 `ConversationState.streaming` 传给输入框，`running` 只作补充信号
（`busy = streaming || running`）。事件流说在跑就是在跑，与 Host 的投影抖动无关。

这条判断也顺带解释了流式输出为什么不进折叠缓存、`streaming` 却必须在里面：
**它是这个会话唯一可靠的"在跑"事实**。

### 打断（steer）

```ts
session.prompt(content, 'steer')   // 契约：'queue' appends a turn; 'steer' interrupts the running one.
```

**Enter 永远排队，Ctrl/Cmd+Enter 才打断**。不猜"用户大概想打断"——猜错的代价是
正在生成的回答被截断。运行中按钮文字变成"排队发送"，title 里给出快捷键提示，
否则没人会发现还有这条路径。

没在跑的时候按 Ctrl+Enter 会**降级成 queue**（没有可打断的对象，不报错、不空转）。

#### 真机实测出的两个语义细节

用 seq 时间线读出来（`probe-workbench-v11.cjs`）：

```
seq=18  assistant/message  8892 字  "1 2 3 …"          ← 完整数完
seq=19  step/end
seq=21  step/start
seq=22  user/message        15 字  "停下，改回复：STEER-OK"   ← steer 的消息
seq=23  assistant/message    8 字  "STEER-OK"
seq=24  step/end
```

1. **steer 不新开 turn，而是同一 turn 内开新 step**（`turns: {start: 1, end: 1}`，
   但 `step/start` 出现两次）。所以"打断"的粒度是 step，不是 turn。
2. **在快模型上观测不到"截断"**。上面那条 8892 字的输出在 steer 消息落库**之前**
   就已经完成 —— 模型的生成速度远超我在 DOM 上看到的进度（`charsBefore: 129`
   是渲染滞后，不是真实进度）。此时 Host 把 steer 当成"追加新 step"处理。

所以这一块的真机结论要分开说：**提交路径验证通过**（新消息落库、产生新回复、
输入框清空），**"打断进行中的生成"未能在本环境观测到** —— 需要一个慢模型或
人造延迟才能复现。单测覆盖了 `mode` 的传递与降级逻辑（12 条）。

### 向上加载历史

```ts
loadOlder(options?: { deferConsumption?: boolean }): Promise<void>
consumeOlder(): boolean
```

`deferConsumption` 是保持滚动位置的关键，整个流程是三步而不是两步：

```
① loadOlder({ deferConsumption: true })   让 Host 准备好页面，但先别发布
② anchor = { scrollHeight, scrollTop }    此时视图还没变，量到的才对
③ consumeOlder()                          同步发布 → 重折 → layout effect 换算
```

如果直接用默认的"加载完就发布"，量高度时内容已经变了，换算必然算错。这是这一块
唯一容易写反的地方。

滚动复原的公式就一行，但必须放在 `useLayoutEffect` 里（paint 之前）：

```ts
el.scrollTop = el.scrollHeight - anchor.height + anchor.top  // 再夹到 [0, max]
```

依赖 `messages.length`：prepend 重折会让它变大；**没有锚点时什么都不做**，所以实时
追加不受影响（那本来就该停在底部）。

三处防误用：

- `hasMore` 取自事件窗口（`window.hasMore`），不是 `snapshot.hasMore` —— 与正文同源；
- 自动加载只在**可见标签**里触发（保活的隐藏标签不该偷偷拉历史）；
- 空态分支也保留入口：整页都是被折叠的系统上下文时，用户不能被困在"还没有消息"里。

## 工具调用

日志里是两条事件，界面上是**一次调用**：

```ts
tool/call   { turn, step, callId, name, arguments }        // arguments 是原始 JSON 字符串
tool/result { turn, step, message: ToolResultMessage, error?: { name, code }, reason? }
```

`tool/call` 建一条 `role: 'tool'` 的消息并把 `callId → 下标` 记进 `state.openCalls`；
`tool/result` 用这个下标把状态与结果**合并回同一条**。拆成两条的后果很具体：
同一件工具上下两行，第一行永远停在"运行中"。

三个实现细节：

1. **`openCalls` 放在折叠 state 里，不放模块级 Map**。`apply` 必须是纯函数 ——
   两个视图共享同一份缓存，任何外部可变状态都会让第二个视图读到别人的顺序。
   用对象展开复制，成本是 O(正在跑的工具数)，真实并发通常 ≤3。
2. **`ChunkedList` 新增 `update(index, value)`**。合并要"替换第 i 项"，而列表原本只
   支持 append。`update` 只复制命中的那一块（≤256）与块表，其余块继续共享 ——
   与 `append` 同量级，不是退化成整份复制。
3. **结果在折叠时截断到 400 字符**，并注明原长度。一个 `read_file` 的返回可能几万字，
   直接塞进气泡会把对话冲到看不见底；完整内容在日志里，界面上给前 400 字符够判断
   "跑通了没"。截断**只做一次**（折叠层），渲染层不再截 —— 否则排查时复制不到完整内容。

界面上收起成一行：`状态图标 + 工具名 + 参数摘要 + 状态文字`。参数摘要优先取
`path` / `command` / `pattern` 这类有信息量的键；**非法 JSON 原样显示**（模型确实会
产出坏 JSON，这时给原文比给空白强）。

## 流式思考过程

`reasoning-delta` 与 `text-delta` **分开累计**（`LiveStream.reasoning` / `.text`）：
模型先想后答，混在一起会变成"标题写着 DSH、正文一半是思考"的怪东西。

界面上思考默认收起，点一下展开成斜体小字。只有一个开关，不占正文位置。

一个必须处理的边界：**只有思考、还没开始答**时也要返回 `LiveStream`（`text` 为空
但 `reasoning` 非空），否则界面一片空白，看起来像卡死。

## 面板

顶栏「面板」按钮 → 下拉列表（读注册表）→ 选一个 → 工作台里多一个标签。

内建两个面板，都是**只读派生状态**、不需要额外 Host 能力：

| id | 标题 | 内容 |
|---|---|---|
| `studio-debug` | 工作台状态 | 标签/浮窗数、会话引用代数、事件订阅数、折叠统计、每个会话的引用分解 |
| `session-info` | 会话信息 | 焦点会话的 id / 代 / 视图引用 / 状态 / 来源分解 |

排查"流没释放""重折了"这类问题时，`studio-debug` 是唯一一眼能看出真相的地方，
比翻 console 快。给插件加自己的面板只需 `panels.register(contribution)` ——
契约校验（`ui-panel-host/contract.ts`）会在注册当场报出非法声明。

### 放哪：区域 → 切分操作

菜单里每个面板行右边有个 `▾`，展开后只列该面板 `regions` 里声明过的区域
（`当前格 / 左侧 / 右侧 / 底部 / 浮窗`）。点面板名本身仍然一步到位，按
`defaultRegion` 开 —— 常用路径不该被迫做选择。

关键认知：**工作台布局里根本没有"右栏"这种东西**，只有 split 树和浮窗。
所谓"放右边"就是"把焦点格按 row 轴切一刀、新格放后面"，这一层翻译在
`ui-workbench/placement.ts` 里，是个纯函数：

```ts
placeOps('right',   ctx) // split(row, after, seed: tab, ratio 0.35) → 一步
placeOps('bottom',  ctx) // split(column, after, ratio 0.4)
placeOps('float',   ctx) // insertTab → float（两步，tab 必须先在树上存在过）
placeOps('center',  ctx) // insertTab（不切分）
```

三个决定值得记：

- **区域不是状态**。切完之后它就是一个普通的格，可以再拖、合并、关掉。工作台不记
  "这个面板属于右栏" —— 那会引入第二个真相源，且和拖拽会打架。
- **浮窗必须两步**。直接造 `FloatNode` 会绕开"tab 必须先在某个格里存在"这条不变量。
- **区域由面板自己声明**，菜单只是照着列。面板说"我只能浮窗"，菜单就不该给它左/右。

测试直接在真实的 `applyOps` 上跑，断言的是树形状（`['row','pane(0)','pane(1)']`）
而不是操作字面量 —— 只断言参数会漏掉"split 找不到 pane""float 时 tab 不在格里"
这类不变量。

## 已知边界

1. **`prepend` 走整窗重折**。折叠只支持 seq 递增，加载更早的历史必须 `reset` 后重来
   （滚动位置靠 anchor 换算保持）。500 条的历史重折一次约几十毫秒，可接受；
   但**没有做增量前插**，真要支持"边滚边加载几十页"就得改成双向折叠。
2. **思考过程在真机上没能验证**。提取与渲染都有（14 条单测），但 opencode-go 路由下的
   haiku-5-5 / minimax-m3 **实际流里没有 `reasoning-delta`**（诊断脚本数过，只有
   `block-start` 与 `text-delta`）。换一个真发 reasoning 的模型即可验证，代码不用改。
3. **附件只能看图片，文件只有 chip**。`readAttachment` 只接受 `ImageAttachmentRef`；
   文件在上游被投影成"名字 + 字节数 + 只读路径"的文本，没有内容读取接口。
   想做得让 Host 提供文件读取端点。
4. **lightbox 只能翻同一条消息里的图**。跨消息没有相册（要串起整个会话的图片得在
   正文层维护一份全局索引）；也没有缩放/拖拽，长图只能靠浏览器缩放看。
5. **steer 在快模型上观测不到"截断"**。提交路径验证通过（新消息落库、产生新回复、
   输入框清空），但模型在 steer 到达前就把输出写完了（seq 时间线证明），此时 Host
   表现为"同一 turn 内追加新 step"。要观测真正的中断需要慢模型或人造延迟。
6. **落位是打开那一刻的一次性决定**。菜单里能选当前格 / 左 / 右 / 底部 / 浮窗（只列面板
   `regions` 声明过的），但选完之后它就是普通的格 —— 想换位置得拖拽或重开，没有
   "记住这个面板上次放哪"的偏好，也没有"把整个面板区切三栏"的批量操作。
7. **拖拽坐标只在单屏 1× 缩放下验过**。多屏 + 不同 DPI 时 `clientX` 与 `getBoundingClientRect`
   仍会一致（都走 CSS 像素），但没实测。
8. **会话选中态是我们自己维护的**，不与官方 `Session selection` 同步。官方 sidebar 被
   我们替换掉了，所以目前没有第二个真相源。
9. **工具结果保留上限 20000 字符**。超过部分界面拿不到（会明说"完整输出在会话日志里"）。
   为什么不上不封顶：折叠结果常驻内存且被所有视图共享，一个 `read_file` 几 MB 的返回
   复制进去会拖垮整个工作台；真要看得从会话日志的 zstd 里解，那是另一个入口。

## 调试

`apply()` 末尾挂了只读钩子：

```js
window.__STUDIO_DEBUG__.inspect()   // 每个会话的引用计数与来源分解
window.__STUDIO_DEBUG__.stats()     // 折叠统计（applies / skipped / evicted）
window.__STUDIO_DEBUG__.hub.size    // 当前订阅了几个会话的事件
```

排查"流没释放"时把 `createSessionLeaseRegistry({ trace: true })` 打开，
每次 retain / release 会打一行带 generation 的日志。
