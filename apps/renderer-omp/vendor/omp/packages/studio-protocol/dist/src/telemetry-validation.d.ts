import type { SessionTelemetryEvent, SessionTelemetryReadResult, SessionTelemetrySnapshot } from "./contracts/telemetry.js";
export declare function parseSessionTelemetrySnapshot(value: unknown, path?: string): SessionTelemetrySnapshot;
export declare function parseSessionTelemetryReadResult(value: unknown, path?: string): SessionTelemetryReadResult;
export declare function parseSessionTelemetryEvent(value: unknown, path?: string): SessionTelemetryEvent;
export declare function isSessionTelemetryEventKind(kind: unknown): kind is "session.telemetry.changed";
//# sourceMappingURL=telemetry-validation.d.ts.map