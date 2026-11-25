/**
 * DSH 专属读模型。
 *
 * 上游 `@omp-studio/client-contract` 是 vendored 代码，不再直接修改；
 * 所有 DSH 新增的读模型集中在这里，通过 `src/dsh/queries.ts` 做一次类型收窄。
 */

/**
 * 会话事件流里的一条斜杠命令记录（不是当前可用命令清单）。
 */
export interface SessionRuntimeCommand {
  readonly name: string;
  readonly input: string;
  readonly status: "running" | "done" | "failed";
  /** 事件时间戳，epoch 毫秒。 */
  readonly time: number | null;
  readonly text?: string;
}

/**
 * 从持久化事件流折叠出的会话运行时状态。
 *
 * DSH SDK 没有独立的状态接口：权限预设、沙箱、审批策略、模型与请求参数、
 * 命令历史、轮次和用量都只写在事件里。缺失字段保持 null，界面据此显示
 * “本会话没有设置”，而不是编造默认值。
 */
export interface SessionRuntimeState {
  readonly sessionId: string | null;
  /** 会话创建时间，epoch 毫秒。 */
  readonly createdAt: number | null;
  readonly cwd: string | null;
  readonly title: string | null;
  readonly permissionPreset: string | null;
  readonly sandboxMode: string | null;
  readonly approvalPolicy: string | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly contextWindow: number | null;
  readonly reasoningEffort: string | null;
  readonly maxTokens: number | null;
  readonly goal: string | null;
  readonly turnCount: number;
  readonly userMessageCount: number;
  readonly compactionCount: number;
  readonly usage: Readonly<Record<string, number>> | null;
  readonly lastError: { readonly message: string; readonly code: string | null } | null;
  readonly commands: ReadonlyArray<SessionRuntimeCommand>;
  readonly eventCount: number;
}
