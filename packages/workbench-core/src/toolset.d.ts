import type { ConversationOwner } from './session-view.js'
import type { WorkbenchRegistryLike } from './session-view.js'
import type { WorkbenchLimits } from './workbench-limits.js'

export type ToolId =
  | 'files'
  | 'changes'
  | 'git'
  | 'terminal'
  | 'browser'
  | 'computer'
  | 'ssh'
  | 'wsl'
  | 'mcp'
  | 'skills'
  | 'agents'
  | 'btw'
  | 'voice'
  | 'evaluation'
  | 'time-travel'

export type ToolCapabilityGrade =
  | 'available'
  | 'limited'
  | 'configured'
  | 'unavailable'
  | 'unsupported'
  | 'unknown'

export interface ToolCapability {
  readonly grade: ToolCapabilityGrade
  readonly reason?: string
  readonly evidence?: string
}

export interface ToolCapabilitySnapshot {
  readonly schemaVersion: 1
  readonly source: 'host'
  readonly revision: string
  readonly observedAt: string
  readonly tools: Readonly<Partial<Record<ToolId, ToolCapability>>>
}

export interface SessionToolsetState extends WorkbenchRegistryLike {
  readonly revision?: number
}

export interface SessionToolInstance {
  readonly instanceId: string
  readonly toolId: ToolId
  readonly owner: ConversationOwner
  readonly concurrency: 'shared-read' | 'exclusive' | 'stateless'
  readonly state: 'opening' | 'ready' | 'busy' | 'disconnected' | 'error' | 'closed'
  readonly leaseId?: string
  readonly metadata?: Readonly<Record<string, string>>
}

export const SESSION_TOOLSET_SCHEMA_VERSION: 1
export const TOOL_CAPABILITY_GRADES: readonly ToolCapabilityGrade[]

export function createToolCapabilitySnapshot(input: {
  readonly source: 'host'
  readonly revision: string
  readonly observedAt: string
  readonly tools: Readonly<Partial<Record<ToolId, ToolCapability>>>
}): ToolCapabilitySnapshot

export function validateToolCapabilitySnapshot(snapshot: ToolCapabilitySnapshot): ToolCapabilitySnapshot

export function toolCapabilityOf(snapshot: ToolCapabilitySnapshot, toolId: ToolId): ToolCapability | null

export function selectSessionToolset(snapshot: ToolCapabilitySnapshot, toolset: readonly ToolId[]): ToolId[]

export function effectiveSessionToolset(
  snapshot: ToolCapabilitySnapshot,
  toolset: readonly ToolId[],
): {
  readonly toolset: readonly ToolId[]
  readonly stale: readonly { readonly toolId: string; readonly reason: string }[]
}

export function setSessionToolset(
  state: SessionToolsetState,
  input: {
    readonly owner: ConversationOwner
    readonly toolset: readonly ToolId[]
    readonly capabilities: ToolCapabilitySnapshot
    readonly expectedRevision: number
    readonly updatedAt: string
  },
): SessionToolsetState

export function registerSessionToolInstance(
  state: SessionToolsetState,
  input: {
    readonly owner: ConversationOwner
    readonly expectedRevision: number
    readonly instanceId: string
    readonly toolId: ToolId
    readonly concurrency?: SessionToolInstance['concurrency']
    readonly metadata?: Readonly<Record<string, string>>
    readonly limits?: Partial<WorkbenchLimits>
  },
): SessionToolsetState

export function closeSessionToolInstance(
  state: SessionToolsetState,
  input: {
    readonly owner: ConversationOwner
    readonly expectedRevision: number
    readonly instanceId: string
  },
): SessionToolsetState