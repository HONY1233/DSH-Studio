import { type AgentBtwOperation, type AgentBtwResultMap } from "./agent-btw.js";
import { type ResourceOperation, type ResourcePage } from "./resources.js";
export type SessionTier = "standard" | "slow" | "priority" | "ultrafast";
export interface SessionTierState {
    selector: string;
    configured: string;
    effective: SessionTier;
    choices: Array<{
        id: SessionTier;
        available: boolean;
        reason?: string;
    }>;
    usageStatus?: string;
}
export interface SessionQueueItem {
    id: string;
    queue: "steering" | "followUp";
    state: "pending" | "delivering" | "recovering";
    text: string;
    imageCount: number;
}
export interface SessionQueueSnapshot {
    sessionId: string;
    items: SessionQueueItem[];
    total: number;
    followUpMode: "all" | "one-at-a-time";
    steeringMode: "all" | "one-at-a-time";
}
export interface QueueImageAsset {
    artifactId: string;
    kind: "image";
    name: string;
    mimeType: string;
    bytes: number;
    sha256: string;
}
export interface QueueTakeback {
    recoveryId?: string;
    removed: boolean;
    text?: string;
    images: QueueImageAsset[];
}
export interface RuntimeSkillIdentity {
    id: string;
    name: string;
    description: string;
    namespace?: string;
    source: string;
    scope?: "workspace" | "global" | "builtin" | "runtime";
    conflict: boolean;
}
export type SessionGuiOperation = ResourceOperation | AgentBtwOperation | {
    kind: "prediction.control";
    sessionId: string;
    action: PredictionControlAction;
} | {
    kind: "session.queue.list";
    sessionId: string;
    offset?: number;
} | {
    kind: "session.queue.steer";
    sessionId: string;
    id: string;
} | {
    kind: "session.queue.remove";
    sessionId: string;
    id: string;
} | {
    kind: "session.queue.ack";
    sessionId: string;
    id: string;
} | {
    kind: "session.queue.takeback";
    sessionId: string;
    id: string;
} | {
    kind: "session.tier.get";
    sessionId: string;
} | {
    kind: "session.tier.set";
    sessionId: string;
    selector: string;
    tier: SessionTier;
} | {
    kind: "session.skills.list";
    sessionId: string;
};
export interface SessionGuiResultMap extends AgentBtwResultMap {
    "resource.read": ResourcePage;
    "prediction.control": PredictionControlState;
    "session.queue.list": SessionQueueSnapshot;
    "session.queue.remove": {
        removed: boolean;
    };
    "session.queue.steer": {
        removed: boolean;
    };
    "session.queue.ack": {
        removed: boolean;
    };
    "session.queue.takeback": QueueTakeback;
    "session.tier.get": SessionTierState;
    "session.tier.set": SessionTierState;
    "session.skills.list": {
        skills: RuntimeSkillIdentity[];
        warnings: string[];
    };
}
export declare const SESSION_GUI_KINDS: readonly ["resource.read", "agent.btw.read", "agent.btw.ask", "agent.btw.abort", "prediction.control", "session.queue.list", "session.queue.ack", "session.queue.remove", "session.queue.steer", "session.queue.takeback", "session.tier.get", "session.tier.set", "session.skills.list"];
export declare const SESSION_GUI_READ_KINDS: readonly ["resource.read", "agent.btw.read", "session.queue.list", "session.tier.get", "session.skills.list"];
export declare function isSessionGuiKind(kind: string): kind is SessionGuiOperation["kind"];
import type { PredictionControlAction, PredictionControlState } from "./prediction.js";
//# sourceMappingURL=session-gui.d.ts.map