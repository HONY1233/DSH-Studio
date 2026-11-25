import type { AgentTranscriptPage } from "./contracts/agents-jobs.js";
import { type FrameHeader, type StudioEventEnvelope, type StudioHelloRequest, type StudioHelloResponse, type StudioReceipt, type StudioSnapshotResponse } from "./contracts/protocol.js";
import type { OperatorStateSnapshot } from "./contracts/state.js";
import { type StudioRuntimeSettingKey } from "./contracts/runtime-settings.js";
import type { OperatorCommandManifest } from "./contracts/manifests.js";
export { ContractValidationError } from "./contract-error.js";
export { isBtwErrorCode, isBtwStatus, parseBtwSnapshot } from "./btw-validation.js";
export { isParsedConversationRuntimeEvent, parseConversationContentBlock, parseConversationItem, parseConversationOpenResult, parseConversationRuntimeEvent, parseConversationTranscriptPage, parseOpaqueConversationCursor, parseSessionTranscriptReadLimit, } from "./conversation-validation.js";
export { isSessionTelemetryEventKind, parseSessionTelemetryEvent, parseSessionTelemetryReadResult, parseSessionTelemetrySnapshot, } from "./telemetry-validation.js";
export declare function validateRuntimeSettingValue(key: StudioRuntimeSettingKey, value: unknown, path: string): void;
export declare function parseFrameHeader(value: unknown): FrameHeader;
export declare function parseStudioHelloRequest(value: unknown): StudioHelloRequest;
export declare function parseStudioHelloResponse(value: unknown): StudioHelloResponse;
export declare function parseOperatorCommandManifest(value: unknown): OperatorCommandManifest;
export declare function parseOperatorStateSnapshot(value: unknown): OperatorStateSnapshot;
export declare function parseStudioSnapshotResponse(value: unknown): StudioSnapshotResponse;
export declare function parseStudioEventEnvelope(value: unknown): StudioEventEnvelope;
export declare function parseStudioReceipt(value: unknown): StudioReceipt;
/** Structural parser for the Runtime Agent Hub transcript page result. */
export declare function parseAgentTranscriptPage(value: unknown): AgentTranscriptPage;
//# sourceMappingURL=validation.d.ts.map