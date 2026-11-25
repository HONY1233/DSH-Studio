# DSH Studio Renderer 全量回归恢复报告

日期：2026-11-25  
范围：`/home/qtt199/projects/dsh-studio-xg0/apps/renderer-omp/src`  
归档：`F:\workbuddy data\deliverables\dsh-studio\renderer-regression-20261125`

## 1. 结论

**Renderer 全量套件已通过。**

- 288 个测试文件全部通过。
- 544 个 suites 全部通过。
- 2,132 项测试全部通过。
- 0 失败、0 跳过。
- 末次全量耗时 98.84 秒。
- 全量运行结束后未再修改生产代码或测试代码；后续仅更新文档与归档。

该结论只覆盖 `renderer-omp` 的 Vitest/jsdom 全量单元与集成测试。它不代表 Runtime 全仓回归、Renderer TypeScript 全量检查、XG0、物理设备、标准安装包重建、签名或发布通过。

## 2. 基线与可比性

| 运行 | 文件 | 失败文件 | Suites | 测试 | 通过 | 失败 | 跳过 | 用途 |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| 初始复现 `before-fix.json` | 307 | 228 | 551 | 1,874 | 829 | 936 | 109 | 证明原始失败可复现；收集范围不可与最终直接比较 |
| 仅源目录 jsdom 探针 `jsdom-src-probe.json` | 288 | 97 | 534 | 1,963 | 1,631 | 332 | 0 | 排除 vendor dist 与 node 环境噪声后的恢复轨迹 |
| 末次修复前 `after-card-column-full.json` | 288 | 9 | 544 | 2,132 | 2,118 | 14 | 0 | 与最终同文件、同 suites、同测试集合 |
| 正式最终 `after-final-full.json` | 288 | 0 | 544 | 2,132 | 2,132 | 0 | 0 | 本轮正式 Renderer 回归基线 |

最强同口径对照是末次修复前与最终：均为 288 文件、544 suites、2,132 tests，失败由 14 降为 0，通过由 2,118 增至 2,132。

必须保留以下限制：

1. **不存在 XG1 修改前的 Renderer clean baseline。** 初始运行已经发生在 XG1 实现之后，不能据此把所有历史失败归因于 XG1。
2. DSH Studio 源码目录不是 Git 仓库，不能提供 Git clean-tag diff 或回滚证明。
3. 初始 307 文件包含 node 环境、vendor dist 与缺失 testkit 等收集问题，不能与最终 288 文件计算通过率。
4. jsdom 探针与最终虽同为 288 文件，但恢复 testkit、setup 与测试修正后测试集合不同；332→0 是恢复轨迹，不是逐项基线差异证明。

机器可读对照见 `evidence/baseline-comparison.json`。

## 3. 根因与修复

### 3.1 测试基础设施

- `apps/renderer-omp/vitest.config.ts:13-33` 统一 React/React DOM 解析，注册 `src/test/setup.ts`，使用 jsdom，并只收集 `src/**/*.{test,spec}.{ts,tsx}`，避免 vendor dist 测试进入套件。
- `@tanstack/react-virtual` 改为 inline，消除虚拟列表使用第二份 React 导致的 `useReducer` / Invalid hook call。
- 在 `apps/renderer-omp/test-support/omp-testkit/` 恢复 OMP `v0.2.8`（commit `f27b73dd08ceed572bad7d56c24299611ca859b1`）的 testkit；六个源文件逐字节匹配上游，位于 vendor 之外。
- testkit 仅服务测试与独立 preview harness；生产 preview 边界仍 fail closed。生产构建不能因测试恢复而导入 fixture。
- 使用 WSL Node `v24.9.0` 运行 Vitest `5.1.1` / jsdom `29.1.1`，避免 Windows Node 对 WSL UNC 工作区包解析失败。

### 3.2 生产代码修复

- `apps/renderer-omp/src/dock/model.ts:200`：浏览器页按 opener、最近浏览器页、相邻页与右侧区域落位，不再依赖已删除的固定 `browser` panel；preset 应用保留每个真实页面实例的目标位置。
- `apps/renderer-omp/src/dock/model.ts:314`：完整面板到快捷栏映射只保留 `git ↔ git-quick`，不再恢复不存在的 `browser`、`disassembler` 等固定 ID。
- `apps/renderer-omp/src/dock/store.ts:106-111`：旧布局只迁移当前注册表中的有效面板；BTW-only 旧几何字段不再单独触发迁移，X0 不恢复 BTW 标签。
- `apps/renderer-omp/src/dock/DockMenus.tsx:128`：移动目标使用真实 `panel.id`，删除固定 Browser 目标分支。
- `apps/renderer-omp/src/dock/DockRegions.tsx:45`：初始 body 高度同时满足面板最小值与声明高度，删除无效 annotations 关闭标签。
- `apps/renderer-omp/src/composer/ChipComposer.tsx:1223`：键盘发送统一使用 `planComposerSend` 的权威规划；运行中的 `/btw` execute/reject 分支直接提交或拒绝，不再错误进入 `onQueue`。
- `apps/renderer-omp/src/conversation/ToolBody.tsx:1114`：Eval 不再走 `ToolMedia` 的 Computer 媒体分支，消除未定义 `hasComputerMedia` 引用。
- `apps/renderer-omp/src/preview/featureSettingsPreview.ts:68`：`composer.predictions` 默认改为 `false`，预览不再绕过显式 opt-in。

### 3.3 过时测试与 fixture 修正

修正的是测试对当前契约的错误假设，没有为让旧断言通过而恢复已删除能力：

- 左右栏可见性、旧 Git launcher 可访问名称、当前中文文案与 X0 仅“对话/详情”标签。
- 删除的 BTW、annotations、固定 Browser 等旧 panel ID 改为当前注册表 ID。
- jsdom 缺少 `:focus-visible`：测试显式模拟键盘焦点，不改变生产可访问性行为。
- jsdom 可能返回 `transitionDuration: 0s`：动画测试提供非零 transition，不把生产 reduced-motion 行为改成永久无动画。
- `NativeFloat` 不再假设 Vitest 转换后的 `import.meta.url` 是 file URL，直接读取源码 CSS。
- `BackgroundTasksDock` 使用无 preview URL 的第二个服务验证 dock 详情；`FileBrowserPanel` 按当前排序验证 Desktop 的首个子项。
- Workspace/residency 的延迟门只作用于 session context，不再阻塞初始 project context；保持仅一个 document engine 实际挂载。
- 需要 preview picker 的 App 测试显式 mock preview 实现；生产 SSH/WSL picker 仍是禁用 stub。
- 原“离线 token 计数”交互替换为真实 Changes 工具浮窗流程，按嵌套菜单先“Move to”再“Float”；临时调试标签已从源码清除。

## 4. 验证结果

### 4.1 最终聚焦回归

9 个相关文件、96 项测试全部通过，耗时 64.59 秒。覆盖 dock、Agent、资源工作区、任务进度、context strip、composer 性能、residency 与 Workspace integration。

日志：`evidence/after-remaining-focused.stdout.log`、`evidence/after-remaining-focused.stderr.log`。

### 4.2 最终全量回归

```text
Test Files  288 passed (288)
Tests       2132 passed (2132)
Duration    98.84s
```

JSON 校验值：

```json
{
  "success": true,
  "numTotalTestSuites": 544,
  "numPassedTestSuites": 544,
  "numFailedTestSuites": 0,
  "numTotalTests": 2132,
  "numPassedTests": 2132,
  "numFailedTests": 0,
  "numPendingTests": 0
}
```

证据：

- `evidence/after-final-full.json`
- `evidence/after-final-full.stdout.log`
- `evidence/after-final-full.stderr.log`
- `evidence/after-final-full.summary.json`
- `evidence/failure-index-after-final.txt`（`No failed tests.`）

stderr 保留 CodeMirror/jsdom 测量噪声；相关测试均通过，未将其冒充产品失败，也未为消除噪声修改生产测量行为。

### 4.3 架构与生产边界

| 检查 | 结果 | 证据 |
|---|---|---|
| 架构约束 | PASS；1,162 文件、8 组规则 | `evidence/architecture-after-cleanup.stdout.log` |
| 入口对齐 | PASS；Renderer 79 queries / 97 commands；Bridge 103 cases / 130 explicit reasons；无沉默接口 | `evidence/entrypoint-after-cleanup.stdout.log` |
| 生产 preview 边界 | 6/6 通过；六类外部能力 fail closed；preview 标记不可由 URL 恢复 | `evidence/preview-boundary-after-cleanup.stdout.log` |

这些检查在最终生产代码修复后执行；最终全量之后只修改了文档与归档。

## 5. 执行命令

以下命令均从 WSL 项目根目录或 `apps/renderer-omp` 执行。

最终全量：

```bash
MSYS2_ARG_CONV_EXCL='*' wsl.exe -- bash -lc 'cd /home/qtt199/projects/dsh-studio-xg0/apps/renderer-omp && node ../../node_modules/vitest/vitest.mjs run --reporter=default --reporter=json; status=$?; node -e "process.stdout.write(require(\"fs\").readFileSync(\".vitest/json/output.json\", \"utf8\"))"; exit $status'
```

9 文件聚焦：

```bash
MSYS2_ARG_CONV_EXCL='*' wsl.exe -- bash -lc 'cd /home/qtt199/projects/dsh-studio-xg0/apps/renderer-omp && node ../../node_modules/vitest/vitest.mjs run src/App.dockRegion.test.tsx src/agents/AgentDetailPanel.test.tsx src/agents/AgentRosterMeter.test.tsx src/capabilities/ResourcesWorkspace.test.tsx src/conversation/TaskProgressDock.test.tsx src/App.contextStrip.test.tsx src/App.composerPerf.test.tsx src/conversationWorkspace/residency.test.tsx src/conversationWorkspace/Workspace.integration.test.tsx'
```

架构、入口与生产边界：

```bash
node packages/testkit/scripts/check-architecture.mjs
node packages/testkit/scripts/check-entrypoint-alignment.mjs
node --test packages/testkit/test/production-preview-boundary.test.mjs
```

## 6. 未满足与未验证

- **Runtime 全仓回归仍未通过**：17 个文件、68 项测试失败，且未完成 clean-tag 基线对照。Renderer 全量通过不能覆盖它。
- **XG0 仍未通过**：双屏、混合 DPI、负坐标、热插拔、旋转、真实摄像头/麦克风、Windows 权限弹窗与 E-05 真实外部能力按用户决定延期。
- **Renderer 全量 TypeScript 检查未清零**：本轮绿色结论仅是 Vitest 全量，不把旧 XG1 的空 typecheck 日志扩展为 `renderer-omp` 全量 typecheck 通过。
- **生产 Renderer 入口尚未完成最终对齐**：当前桌面包仍加载 `apps/renderer-omp/dist/index.html`，目标生产 Renderer 是 `apps/renderer`。
- Electron Main 的 JSONL 生产 IO、真实磁盘故障、Runtime draft 升级 authority/CAS、事件 reset/resync 仍未完成。
- 本轮之后的 Windows 包重建、代码签名、自动更新通道、发布与提交/推送均未执行或未获授权。
- XG1 归档中的“Renderer 全量未通过”是当时的历史快照；仅该项由本报告与 `renderer-regression-20261125` 更新，其他 XG1 边界不变。

## 7. 证据完整性

归档包含 49 个原始证据文件及本报告、机器可读汇总和 `SHA256SUMS.txt`。校验和覆盖报告、汇总与递归证据文件；`SHA256SUMS.txt` 不覆盖自身。
