import { SELECTIVE_COMMIT_QUERY_KINDS } from "./selective-commit.js";
import { PROMPT_HISTORY_QUERY_KINDS } from "./prompt-history.js";
import { MODEL_SERVICES_QUERY_KINDS } from "./model-services.js";
export const RUNTIME_VIEW_KINDS = [...SELECTIVE_COMMIT_QUERY_KINDS, ...PROMPT_HISTORY_QUERY_KINDS, ...MODEL_SERVICES_QUERY_KINDS, "runtime.close.confirm", "interaction.form.read", "agent.spawn.options.read", "agent.messages.list", "session.lease.read", "extensions.links.list", "browser.webmcp.list", "session.cache.get", "shell.view.read", "shell.view.release", "live.webrtc.connect", "live.webrtc.status", "live.webrtc.mute", "live.webrtc.release"];
export function isRuntimeViewKind(kind) {
    return RUNTIME_VIEW_KINDS.includes(kind);
}
//# sourceMappingURL=runtime-views.js.map