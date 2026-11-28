import type { ConversationOwner } from './session-view.js'
import type { WorkbenchRegistryLike } from './session-view.js'
import type { ToolId } from './toolset.js'

export const WORKBENCH_LIMITS_SCHEMA_VERSION: 1

export type WorkbenchLimitKey =
  | 'maxTabsPerWorkspace'
  | 'maxToolInstancesPerSession'
  | 'maxInstancesPerTool'
  | 'maxTerminalInstances'
  | 'maxBrowserTabs'
  | 'isolationQueueLength'

export interface WorkbenchLimits {
  readonly schemaVersion: 1
  readonly maxTabsPerWorkspace: number
  readonly maxToolInstancesPerSession: number
  readonly maxInstancesPerTool: number
  readonly maxTerminalInstances: number
  readonly maxBrowserTabs: number
  readonly isolationQueueLength: number
}

export const WORKBENCH_LIMIT_KEYS: readonly WorkbenchLimitKey[]
export const DEFAULT_WORKBENCH_LIMITS: WorkbenchLimits

export function createWorkbenchLimits(input?: Partial<WorkbenchLimits>): WorkbenchLimits

export function countLayoutTabs(layout: unknown): number

export interface TabCapacity {
  readonly allowed: boolean
  readonly resource: 'views'
  readonly used: number
  readonly limit: number
}

export function inspectTabCountCapacity(used: number, limits?: Partial<WorkbenchLimits>): TabCapacity
export function inspectTabCapacity(layout: unknown, limits?: Partial<WorkbenchLimits>): TabCapacity
export function assertTabCountCapacity(used: number, limits?: Partial<WorkbenchLimits>): TabCapacity
export function assertTabCapacity(layout: unknown, limits?: Partial<WorkbenchLimits>): TabCapacity

export interface ToolInstanceCapacity {
  readonly allowed: boolean
  readonly resource: 'sessionToolInstances' | 'toolInstances' | 'pty' | 'browserTabs' | null
  readonly scope: 'session' | 'tool' | 'host' | null
  readonly used: number
  readonly limit: number
  readonly toolId: ToolId
}

export function inspectToolInstanceCapacity(
  state: WorkbenchRegistryLike,
  input: {
    readonly owner: ConversationOwner
    readonly toolId: ToolId
    readonly limits?: Partial<WorkbenchLimits>
  },
): ToolInstanceCapacity

export function assertToolInstanceCapacity(
  state: WorkbenchRegistryLike,
  input: {
    readonly owner: ConversationOwner
    readonly toolId: ToolId
    readonly limits?: Partial<WorkbenchLimits>
  },
): ToolInstanceCapacity