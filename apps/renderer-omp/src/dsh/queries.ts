/**
 * DSH 扩展查询的类型化入口。
 *
 * 查询名与返回类型不在上游契约里，所以这里只做一次收窄；
 * 组件不再各自写 `as unknown as`，也避免为此修改 vendored 契约。
 */
import type { SessionId, StudioClient } from "@omp-studio/client-contract";
import type { SessionRuntimeState } from "./read-models";

type ExtendedQuery = (name: string, input: unknown) => Promise<unknown>;

/** 读取会话运行时状态：权限、沙箱、模型参数、用量、命令历史。 */
export function readSessionRuntimeState(client: StudioClient, sessionId: SessionId): Promise<SessionRuntimeState> {
  const query = client.query as unknown as ExtendedQuery;
  return query("session.runtime.state.read", { sessionId }) as Promise<SessionRuntimeState>;
}
