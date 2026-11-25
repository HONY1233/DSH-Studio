import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionId, StudioClient } from "@omp-studio/client-contract";
import { readSessionRuntimeState } from "../dsh/queries";
import type { SessionRuntimeCommand, SessionRuntimeState } from "../dsh/read-models";
import { usePreviewMode } from "../preview/PreviewContext";
import { useI18n } from "../i18n";
import { hostErrorMessage } from "../hostError";
import { Icon } from "../icons";
import { WorkspaceEmpty } from "../workspaces/Workspace";
import "./runtimeState.css";

/**
 * 会话运行时状态。
 *
 * DSH 没有独立的 state 接口：权限预设、沙箱、审批策略、模型参数、命令历史、
 * 轮次和用量都只写在会话事件流里。这里读的是折叠后的真实事件数据，
 * 任何缺失项都显示“本会话没有设置”，不补默认值。
 */
export type RuntimeStateDockProps = {
  readonly client: StudioClient | null;
  readonly sessionId?: SessionId | undefined;
  readonly available: boolean;
  readonly visible?: boolean;
};

const USAGE_LABELS: Record<string, string> = {
  inputTokens: "输入",
  outputTokens: "输出",
  cachedInputTokens: "缓存输入",
  reasoningTokens: "推理",
  totalTokens: "合计",
};

const PREVIEW_STATE: SessionRuntimeState = {
  sessionId: "preview-session",
  createdAt: 1763740800000,
  cwd: "/workspace/demo",
  title: "演示会话",
  permissionPreset: "workspace-write",
  sandboxMode: "workspace-write",
  approvalPolicy: "ask",
  provider: "deepseek-official",
  model: "deepseek-flash",
  contextWindow: 1048576,
  reasoningEffort: "high",
  maxTokens: 256000,
  goal: null,
  turnCount: 3,
  userMessageCount: 4,
  compactionCount: 0,
  usage: { inputTokens: 1820, outputTokens: 640, totalTokens: 2460 },
  lastError: null,
  commands: [
    { name: "plan", input: "", status: "done", time: 1763740801000, text: "Plan mode is already inactive." },
  ],
  eventCount: 42,
};

function formatTime(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return new Date(value).toLocaleString();
}

function formatCount(value: number): string {
  return value.toLocaleString();
}

export function RuntimeStateDock({ client, sessionId, available, visible = true }: RuntimeStateDockProps) {
  const { preview } = usePreviewMode();
  const { resolvedLanguage } = useI18n();
  const zh = resolvedLanguage === "zh";
  const [state, setState] = useState<SessionRuntimeState>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const serial = useRef(0);
  const canRead = preview || (available && !!sessionId && !!client);

  const refresh = useCallback(async () => {
    if (preview) {
      setState(PREVIEW_STATE);
      setError("");
      return;
    }
    if (!client || !sessionId) return;
    const ticket = ++serial.current;
    setLoading(true);
    setError("");
    try {
      const next = await readSessionRuntimeState(client, sessionId);
      if (ticket === serial.current) setState(next);
    } catch (cause) {
      if (ticket === serial.current) setError(hostErrorMessage(cause, zh ? "无法读取会话运行时状态" : "Could not read session runtime state"));
    } finally {
      if (ticket === serial.current) setLoading(false);
    }
  }, [client, sessionId, preview, zh]);

  useEffect(() => {
    serial.current++;
    setState(undefined);
    setError("");
    if (!visible || !canRead) return;
    void refresh();
    return () => { serial.current++; };
  }, [visible, canRead, refresh]);

  if (!canRead) {
    return <WorkspaceEmpty icon="plug" title={zh ? "连接 Runtime 后可查看" : "Connect a Runtime to inspect"}>
      {zh ? "运行时状态来自具体会话的事件记录，需要活动的会话连接。" : "Runtime state lives in the event log of a concrete session, so an active session is required."}
    </WorkspaceEmpty>;
  }

  const created = formatTime(state?.createdAt ?? null);
  const title = zh ? "运行时状态" : "Runtime state";
  const none = zh ? "本会话没有设置" : "Not set in this session";
  const notReported = zh ? "本次会话尚未记录" : "Not recorded yet";
  const missing = <span className="rts-muted">{none}</span>;
  const value = (text: string | null) => text ? <span className="rts-value">{text}</span> : missing;

  const usageRows = state?.usage
    ? Object.entries(state.usage)
        .filter(([, count]) => typeof count === "number" && Number.isFinite(count))
        .map(([key, count]) => ({ key, label: USAGE_LABELS[key] ?? key, count: count as number }))
    : [];

  const commandStatus = (row: SessionRuntimeCommand) => row.status === "failed"
    ? <span className="rts-command-status is-failed">{zh ? "失败" : "Failed"}</span>
    : row.status === "running"
      ? <span className="rts-command-status is-running">{zh ? "运行中" : "Running"}</span>
      : <span className="rts-command-status">{zh ? "完成" : "Done"}</span>;

  return <section className="runtime-state" aria-label={title}>
    <header className="rts-header">
      <span className="rts-heading"><Icon name="layers" />{title}</span>
      <span className="rts-actions">
        {preview ? <span className="chip xs">{zh ? "演示" : "Demo"}</span> : null}
        <button type="button" className="icon-btn" aria-label={zh ? "刷新运行时状态" : "Refresh runtime state"} data-tip={zh ? "刷新" : "Refresh"} disabled={loading || !canRead} onClick={() => void refresh()}><Icon name="refresh" /></button>
      </span>
    </header>

    <p className="rts-note">
      <Icon name="info" extra="sm" />
      {zh
        ? "来自本会话事件记录：DSH 没有独立的状态接口，缺失项即表示会话里没有写入。"
        : "Read from this session's event log. DSH has no standalone state API; a missing field means nothing was written."}
    </p>

    {error ? <p className="rts-error" role="alert"><Icon name="alert-c" extra="sm" />{error}</p> : null}

    <div className="rts-stats">
      <div><strong>{state ? formatCount(state.turnCount) : "—"}</strong><span>{zh ? "轮次" : "Turns"}</span></div>
      <div><strong>{state ? formatCount(state.userMessageCount) : "—"}</strong><span>{zh ? "用户消息" : "User messages"}</span></div>
      <div><strong>{state ? formatCount(state.compactionCount) : "—"}</strong><span>{zh ? "压缩次数" : "Compactions"}</span></div>
      <div><strong>{state ? formatCount(state.eventCount) : "—"}</strong><span>{zh ? "事件数" : "Events"}</span></div>
    </div>

    <section className="rts-section" aria-label={zh ? "权限与沙箱" : "Permission and sandbox"}>
      <h3><Icon name="shield" extra="sm" />{zh ? "权限与沙箱" : "Permission and sandbox"}</h3>
      <dl className="rts-facts">
        <div><dt>{zh ? "权限预设" : "Permission preset"}</dt><dd>{value(state?.permissionPreset ?? null)}</dd></div>
        <div><dt>{zh ? "沙箱模式" : "Sandbox mode"}</dt><dd>{value(state?.sandboxMode ?? null)}</dd></div>
        <div><dt>{zh ? "审批策略" : "Approval policy"}</dt><dd>{value(state?.approvalPolicy ?? null)}</dd></div>
      </dl>
    </section>

    <section className="rts-section" aria-label={zh ? "模型与请求参数" : "Model and request"}>
      <h3><Icon name="cpu" extra="sm" />{zh ? "模型与请求参数" : "Model and request"}</h3>
      <dl className="rts-facts">
        <div><dt>{zh ? "供应商" : "Provider"}</dt><dd>{value(state?.provider ?? null)}</dd></div>
        <div><dt>{zh ? "模型" : "Model"}</dt><dd>{value(state?.model ?? null)}</dd></div>
        <div><dt>{zh ? "上下文窗口" : "Context window"}</dt><dd>{state?.contextWindow === null || state?.contextWindow === undefined ? missing : <span className="rts-value mono">{formatCount(state.contextWindow)}</span>}</dd></div>
        <div><dt>{zh ? "最大输出" : "Max output"}</dt><dd>{state?.maxTokens === null || state?.maxTokens === undefined ? missing : <span className="rts-value mono">{formatCount(state.maxTokens)}</span>}</dd></div>
        <div><dt>{zh ? "推理强度" : "Reasoning effort"}</dt><dd>{value(state?.reasoningEffort ?? null)}</dd></div>
      </dl>
    </section>

    <section className="rts-section" aria-label={zh ? "目标" : "Goal"}>
      <h3><Icon name="sparkles" extra="sm" />{zh ? "目标" : "Goal"}</h3>
      {state?.goal
        ? <p className="rts-goal">{state.goal}</p>
        : <p className="rts-muted">{zh ? "本会话没有设置目标。可用 /goal 开始一个。" : "No goal set in this session. Use /goal to start one."}</p>}
    </section>

    <section className="rts-section" aria-label={zh ? "用量" : "Usage"}>
      <h3><Icon name="layers" extra="sm" />{zh ? "Token 用量" : "Token usage"}</h3>
      {usageRows.length
        ? <dl className="rts-facts">{usageRows.map(row => <div key={row.key}><dt>{row.label}</dt><dd><span className="rts-value mono">{formatCount(row.count)}</span></dd></div>)}</dl>
        : <p className="rts-muted">{zh ? "本会话没有记录到用量。请求失败（例如缺少 API Key）时不会产生用量。" : "No usage recorded. Failed requests (for example a missing API key) produce no usage."}</p>}
      {state?.lastError ? <div className="rts-last-error" role="alert">
        <strong>{zh ? "最近一次失败" : "Last failure"}{state.lastError.code ? ` · ${state.lastError.code}` : ""}</strong>
        <span>{state.lastError.message}</span>
      </div> : null}
    </section>

    <section className="rts-section" aria-label={zh ? "会话信息" : "Session"}>
      <h3><Icon name="bot" extra="sm" />{zh ? "会话信息" : "Session"}</h3>
      <dl className="rts-facts">
        <div><dt>{zh ? "标题" : "Title"}</dt><dd>{value(state?.title ?? null)}</dd></div>
        <div><dt>{zh ? "工作目录" : "Working directory"}</dt><dd>{value(state?.cwd ?? null)}</dd></div>
        <div><dt>{zh ? "创建时间" : "Created"}</dt><dd>{created ? <span className="rts-value">{created}</span> : <span className="rts-muted">{notReported}</span>}</dd></div>
      </dl>
    </section>

    <section className="rts-section" aria-label={zh ? "斜杠命令历史" : "Slash command history"}>
      <h3><Icon name="terminal" extra="sm" />{zh ? "斜杠命令" : "Slash commands"}</h3>
      {state?.commands.length
        ? <ol className="rts-commands">{state.commands.map((row, index) => <li key={`${row.name}-${row.time ?? index}`}>
            <span className="rts-command-main"><code>/{row.name}{row.input ? ` ${row.input}` : ""}</code>{commandStatus(row)}</span>
            {row.text ? <span className="rts-command-text">{row.text}</span> : null}
            {formatTime(row.time) ? <span className="rts-command-time">{formatTime(row.time)}</span> : null}
          </li>)}</ol>
        : <p className="rts-muted">{zh ? "本会话没有运行过斜杠命令。" : "No slash commands were run in this session."}</p>}
    </section>
  </section>;
}
