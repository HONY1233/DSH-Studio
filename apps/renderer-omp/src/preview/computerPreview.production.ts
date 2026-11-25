/** Fail-closed production replacement for preview-only Computer Use fixtures. */
import type { ComputerAction, ComputerFrame, ComputerStructureSnapshot, ComputerWorkspaceSnapshot, FeatureSettingRow, StudioComputerStatus } from "@omp-studio/studio-protocol";

export const COMPUTER_PREVIEW_SCENARIOS: readonly string[] = [];
export const COMPUTER_PREVIEW_SCENARIO_LABELS: Readonly<Record<string, string>> = {};
export const COMPUTER_PREVIEW_TIME = 0;
export const PREVIEW_COMPUTER: StudioComputerStatus = {
  enabled: false, available: false, backend: "unavailable", capturePermission: "unavailable",
  inputPermission: "unavailable", axPermission: "unavailable", running: 0, targets: [],
};
export const PREVIEW_COMPUTER_SETTINGS: FeatureSettingRow[] = [];
export const PREVIEW_COMPUTER_IMAGE = "";
export const PREVIEW_COMPUTER_TOOL_MEDIA: never[] = [];

export function getComputerPreviewScenarioLabels(): Readonly<Record<string, string>> { return COMPUTER_PREVIEW_SCENARIO_LABELS; }
export function previewComputerFrame(_sessionId: string, _index?: number): ComputerFrame { throw new Error("Computer Use is not implemented in production"); }
export function buildComputerPreview(_sessionId: string, _scenario?: string, _zh?: boolean): { snapshot: ComputerWorkspaceSnapshot; actions: ComputerAction[] } { throw new Error("Computer Use is not implemented in production"); }
export function previewComputerStructure(_sessionId: string, _targetId: string): ComputerStructureSnapshot { throw new Error("Computer Use is not implemented in production"); }
