import { AGENT_BTW_KINDS } from "./agent-btw.js";
import {} from "./resources.js";
export const SESSION_GUI_KINDS = ["resource.read", ...AGENT_BTW_KINDS, "prediction.control", "session.queue.list", "session.queue.ack", "session.queue.remove", "session.queue.steer", "session.queue.takeback", "session.tier.get", "session.tier.set", "session.skills.list"];
export const SESSION_GUI_READ_KINDS = ["resource.read", "agent.btw.read", "session.queue.list", "session.tier.get", "session.skills.list"];
export function isSessionGuiKind(kind) { return SESSION_GUI_KINDS.includes(kind); }
//# sourceMappingURL=session-gui.js.map