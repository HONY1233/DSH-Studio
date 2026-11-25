import type { PanelDefinition } from "../dock/types";

const PANEL_ZH_LABELS: Record<string, { title?: string; menuTitle?: string }> = {
  files: { title: "资源管理器" },
  changes: { title: "变更" },
  terminal: { title: "终端" },
  problems: { title: "问题" },
  tests: { title: "测试" },
  output: { title: "输出" },
  logs: { title: "运行日志" },
  pvlogs: { title: "预览日志" },
  environment: { title: "环境" },
  context: { title: "上下文" },
  "runtime-state": { title: "运行时状态", menuTitle: "运行时状态 · 权限 / 模型 / 用量" },
  agents: { title: "智能体", menuTitle: "智能体" },
  jobs: { title: "后台任务", menuTitle: "后台任务 · Background tasks" },
  "file-browser": { title: "文件浏览器", menuTitle: "文件浏览器 · File Browser" },
  "git-quick": { menuTitle: "Git 快捷卡" },
  "agent-detail": { title: "子 Agent" },
  "context-viewer": { title: "上下文查看器" },
  "local-files": { title: "会话本地文件" },
  "spill-output": { title: "完整输出" },
};

export function localizePanelDefinition(definition: PanelDefinition, zh: boolean): PanelDefinition {
  if (!zh) return definition;
  const labels = PANEL_ZH_LABELS[definition.id];
  return labels ? { ...definition, ...labels } : definition;
}

export const WORKBENCH_PANELS: readonly PanelDefinition[] = [
  { id: "files", title: "Explorer", icon: "file-tree" },
  { id: "file-browser", title: "File Browser", icon: "drive", minHeight: 260, initialHeight: 420 },
  { id: "changes", title: "Changes", icon: "diff", meter: true },
  { id: "git", title: "Git", icon: "branch", meter: true },
  { id: "git-quick", title: "Git", menuTitle: "Git Quick Card", icon: "branch", initialHeight: 320, meter: true },
  { id: "agents", title: "Agents", icon: "bot", meter: true },
  { id: "agent-detail", title: "Subagent", icon: "message", initialHeight: 480 },
  { id: "environment", title: "Environment", icon: "cpu" },
  { id: "context", title: "Context", icon: "layers", meter: true, initialHeight: 320 },
  { id: "runtime-state", title: "Runtime state", menuTitle: "Runtime State · permission / model / usage", icon: "layers", minHeight: 260, initialHeight: 520 },
  { id: "context-viewer", title: "Context Inspector", icon: "layers", minHeight: 260, initialHeight: 500 },
  { id: "local-files", title: "Session-local files", icon: "folder-open", minHeight: 260, initialHeight: 500 },
  { id: "spill-output", title: "Full output", icon: "console", minHeight: 200, initialHeight: 460 },
  { id: "terminal", title: "Terminal", icon: "terminal", minHeight: 240, initialHeight: 280 },
  { id: "jobs", title: "Background tasks", icon: "terminal", meter: true, initialHeight: 256 },
  { id: "problems", title: "Problems", icon: "alert-c" },
  { id: "tests", title: "Tests", icon: "test" },
  { id: "output", title: "Output", icon: "console" },
  { id: "logs", title: "DSH Logs", icon: "book" },
  { id: "pvlogs", title: "Preview Logs", icon: "globe" },
];
