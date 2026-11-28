export type ConversationIdentity = { readonly kind: 'draft' | 'session'; readonly id: string }
export type ConversationOwner = ConversationIdentity & { readonly hostId: string; readonly windowId: string }
export interface DraftAttachment {
  readonly id: string
  readonly name?: string
  readonly size?: number
  readonly mediaType?: string
  readonly receiptId?: string
  readonly [key: string]: unknown
}
export interface OwnerDraftSnapshot {
  readonly ownerKey: string
  readonly sessionId: string
  readonly draftId: string
  readonly revision: number
  readonly body: string
  readonly attachments: readonly DraftAttachment[]
  readonly updatedAt: string | null
  readonly submission: {
    readonly submissionId: string
    readonly state: 'sending' | 'local-queued' | 'accepted' | 'failed'
    readonly draftRevision: number
    readonly runtimeAccepted: boolean
    readonly runtimeQueued: boolean
    readonly snapshot: { readonly body: string; readonly attachments: readonly DraftAttachment[] }
    readonly error: unknown
  } | null
}
export interface DraftState {
  readonly schemaVersion: 1
  readonly sessions: Readonly<Record<string, OwnerDraftSnapshot>>
}
export interface ApprovalSummary {
  readonly interactionId: string
  readonly sessionId: string
  readonly leaseGeneration: number
  readonly kind: string
  readonly approvalType: string
  readonly detail: Readonly<Record<string, unknown>>
  readonly status: 'pending' | 'submitted' | 'cancelled'
  readonly title?: string
}
export interface UsageReadModel {
  readonly schemaVersion: 1
  readonly revision: number | null
  readonly totals: Readonly<Record<string, number | null>>
  readonly recordCount: number
  readonly requestCount: number
  readonly range: { readonly from: string | null; readonly to: string | null }
  readonly context: unknown
  readonly currentTurn: unknown
  readonly buckets: readonly unknown[]
}
export interface SessionViewToolProjection {
  readonly instances: readonly Readonly<Record<string, unknown>>[]
  readonly layout: unknown
  readonly leases: readonly Readonly<Record<string, unknown>>[]
}
export interface SessionViewProjection {
  readonly schemaVersion: 1
  readonly owner: ConversationIdentity
  readonly draft: OwnerDraftSnapshot | null
  readonly approvals: readonly ApprovalSummary[]
  readonly usage: UsageReadModel | null
  readonly tools: SessionViewToolProjection
}
export interface WorkbenchRegistryLike {
  readonly workspaces: Readonly<Record<string, unknown>>
  readonly toolInstances: Readonly<Record<string, unknown>>
  readonly leases?: Readonly<Record<string, unknown>>
}
export const SESSION_VIEW_SCHEMA_VERSION: 1
export const APPROVAL_STATUSES: readonly ['pending', 'submitted', 'cancelled']
export function validateConversationIdentity(owner: ConversationIdentity): ConversationIdentity
export function getOwnerDraft(state: DraftState, owner: ConversationIdentity): OwnerDraftSnapshot | null
export function updateOwnerDraft(
  state: DraftState,
  owner: ConversationIdentity,
  expectedRevision: number,
  patch: { readonly body?: string; readonly attachments?: readonly DraftAttachment[] },
  updatedAt: string,
): DraftState
export function beginOwnerDraftSubmission(
  state: DraftState,
  owner: ConversationIdentity,
  expectedRevision: number,
  submissionId: string,
  updatedAt: string,
): DraftState
export function queueOwnerDraftLocally(state: DraftState, owner: ConversationIdentity, submissionId: string, updatedAt: string): DraftState
export function acceptOwnerDraftSubmission(state: DraftState, owner: ConversationIdentity, submissionId: string, updatedAt: string): DraftState
export function failOwnerDraftSubmission(state: DraftState, owner: ConversationIdentity, submissionId: string, error: unknown, updatedAt: string): DraftState
export function cancelOwnerDraftSubmission(state: DraftState, owner: ConversationIdentity, submissionId: string, updatedAt: string): DraftState
export function bindDraftOwnerToSession(
  state: DraftState,
  input: { readonly draftId: string; readonly sessionId: string; readonly submissionId: string; readonly updatedAt: string },
): DraftState
export function projectDraftForOwner(state: DraftState, owner: ConversationIdentity): OwnerDraftSnapshot | null
export function projectApprovalsForOwner(input: readonly ApprovalSummary[] | null | undefined, owner: ConversationIdentity): ApprovalSummary[]
export function projectUsageForOwner(
  input: readonly unknown[] | unknown | null | undefined,
  owner: ConversationIdentity,
  options?: Readonly<Record<string, unknown>>,
): UsageReadModel | null
export function projectToolsForOwner(input: WorkbenchRegistryLike | null | undefined, owner: ConversationIdentity): SessionViewToolProjection
export function composeSessionView(input: {
  readonly owner: ConversationIdentity
  readonly drafts?: DraftState
  readonly approvals?: readonly ApprovalSummary[] | null
  readonly usage?: readonly unknown[] | unknown | null
  readonly usageOptions?: Readonly<Record<string, unknown>>
  readonly registry?: WorkbenchRegistryLike | null
}): SessionViewProjection
