import type { StudioClient } from "@omp-studio/client-contract";
import type { RuntimeSkillIdentity } from "@omp-studio/studio-protocol";
import { waitReceipt } from "../hostError";

type SkillsReceipt = { result: { skills: RuntimeSkillIdentity[] } };
const cache = new WeakMap<StudioClient, Map<string, { at: number; value: Promise<RuntimeSkillIdentity[]> }>>();

async function fetchSkills(client: StudioClient, sessionId: string): Promise<RuntimeSkillIdentity[]> {
  const handle = await client.command("session.skills.list", { sessionId });
  return (await waitReceipt<SkillsReceipt>(client, handle.requestId)).result.skills;
}

export function loadRuntimeSkills(client: StudioClient, sessionId: string): Promise<RuntimeSkillIdentity[]> {
  let entries = cache.get(client);
  if (!entries) { entries = new Map(); cache.set(client, entries); }
  const found = entries.get(sessionId);
  if (found && Date.now() - found.at < 15000) return found.value;
  const value = (async () => {
    try {
      return await fetchSkills(client, sessionId);
    } catch {
      // 首次加载可能撞上客户端重同步：bootstrap 会把在途命令标成 outcome unknown。
      // 等重同步落定后重取一次；仍然失败就把错误交给调用方。
      await client.bootstrap().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 300));
      return await fetchSkills(client, sessionId);
    }
  })();
  const entry = { at: Date.now(), value };
  // 失败结果不留在缓存里，下次打开抽屉/页面还能重试。
  value.catch(() => { if (entries.get(sessionId) === entry) entries.delete(sessionId); });
  if (entries.size > 20) entries.clear();
  entries.set(sessionId, entry);
  return value;
}
