# DSH Studio

把 [omp-studio](https://github.com/the-snowpear/omp-studio) 的桌面工作台形态迁到 DeepSeek Harness 上：Electron 壳 + Vite/React 渲染层，Agent 运行时通过 `dsh --profile sdk` 的 stdio JSON-RPC 接入。

当前是 P0/P1 骨架 + P4 五个本机面板，尚未打包发行。

## 前置条件

- Windows 10/11，Node 26 / npm 11，Git。
- WSL2 里已安装 `Ubuntu`，用户默认 `qtt199`，且 `/usr/local/bin/dsh` 可用（本机验证版本 `0.2.2-rc.5`）。
- 本仓库放在 Windows 盘（例如 `F:\projects\dsh-studio`）；运行时在 WSL 里，通过 `wsl.exe` 传帧，`node_modules` 不放在 9p 上。

## 安装

```powershell
npm install
```

npm 11 默认拦截依赖的安装脚本，两个二进制需要手动补：

```powershell
npm install-scripts approve node-pty
npm rebuild node-pty

$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
node node_modules/electron/install.js
```

`node-pty@1.1.0` 是 N-API 预编译包，不需要 electron-rebuild。

## 启动

```powershell
npm run dev          # 同时起 Vite(5173) 与 Electron
```

分开跑（调试时更常用）：

```powershell
npm -w @dsh-studio/renderer run dev
$env:Path=[System.Environment]::GetEnvironmentVariable('Path','Machine')+';'+[System.Environment]::GetEnvironmentVariable('Path','User')
& ".\node_modules\.bin\electron.cmd" --remote-debugging-port=9333 apps/desktop
```

`--remote-debugging-port` 是给下面的 CDP 冒烟用的，平时可以不带。

## 验收

```powershell
npm run check        # 架构约束 + vite build + 契约单测
npm test             # 只跑契约单测
```

UI 冒烟（需要上面带 `--remote-debugging-port=9333` 启动）：

```powershell
node packages/testkit/scripts/cdp-smoke.mjs --terminal
node packages/testkit/scripts/cdp-smoke.mjs --files package.json
node packages/testkit/scripts/cdp-smoke.mjs --changes
node packages/testkit/scripts/cdp-smoke.mjs --browser
node packages/testkit/scripts/cdp-smoke.mjs --logs
node packages/testkit/scripts/cdp-smoke.mjs --multi
node packages/testkit/scripts/cdp-smoke.mjs --recent <sessionId>
```

这些路径都不需要模型 Key；真实对话、审批、子 Agent 需要先配置 `DEEPSEEK_API_KEY`（见下）。

## 目录

```
apps/desktop            Electron 主进程 + preload（运行时子进程、终端 PTY、浏览器视图、日志缓冲）
apps/renderer           Vite + React（对话流、多会话、文件/变更/终端/浏览器/日志面板）
packages/contract       渲染层读模型与投影（唯一事实源，纯函数）
packages/runtime-client SDK JSON-RPC 客户端（NDJSON、帧录制）
packages/host-services  会话日志/文件/Git（走 \\wsl.localhost 与 Windows git）
packages/testkit        fixtures、契约单测、CDP 冒烟、架构检查
```

## 已知边界

- **没有 token 级流式**：SDK 只在 `assistant/message` 一次性给正文，UI 是轮次级刷新。
- **没有按会话关闭 / 按 prompt 取消**：关标签只是隐藏，运行时仍持有会话；同一会话被别的进程占用时 `session/resume` 会报 `already owned by an active write handle`。
- **模型 Key 未内置**：`turn/end` 会返回 `MISSING_CREDENTIAL`。写入方式：在 `dsh web`（127.0.0.1:3080）的 Models 页保存，或启动前导出 `DEEPSEEK_API_KEY`。
- **窗口被判隐藏时**（远程桌面/锁屏），Chromium 会暂停 rAF 与 ResizeObserver，xterm 不绘制、浏览器视图首帧同步要同步调用；CDP 冒烟因此读 xterm 缓冲区而非 DOM。

## 参考

- 迁移计划、阶段进度与实测记录：`F:\tare data\dsh-studio-plan.md`。
- 上游 UI 参考：`the-snowpear/omp-studio`（MIT）。
