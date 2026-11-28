/** Shared owner-scoped business state. The store is created by the host, never by React. */
import {
  acceptOwnerDraftSubmission,
  beginOwnerDraftSubmission,
  bindDraftOwnerToSession,
  cancelOwnerDraftSubmission,
  composeSessionView,
  failOwnerDraftSubmission,
  getOwnerDraft,
  queueOwnerDraftLocally,
  updateOwnerDraft,
  type ApprovalSummary,
  type ConversationIdentity,
  type DraftAttachment,
  type DraftState,
  type OwnerDraftSnapshot,
  type SessionViewProjection,
  type WorkbenchRegistryLike,
} from '@dsh-studio/workbench-core'

export type { ApprovalSummary, ConversationIdentity, OwnerDraftSnapshot, SessionViewProjection }

export interface OwnerDraftPatch {
  readonly body?: string
  readonly attachments?: readonly DraftAttachment[]
}

export type OwnerDraftCommand =
  | { readonly type: 'update'; readonly owner: ConversationIdentity; readonly expectedRevision: number; readonly patch: OwnerDraftPatch }
  | { readonly type: 'begin'; readonly owner: ConversationIdentity; readonly expectedRevision: number; readonly submissionId: string }
  | { readonly type: 'queue'; readonly owner: ConversationIdentity; readonly submissionId: string }
  | {
      readonly type: 'settle'
      readonly owner: ConversationIdentity
      readonly submissionId: string
      /** Revision immediately after begin; newer edits must survive an accepted send. */
      readonly expectedRevision: number
      readonly outcome: 'accepted' | 'failed' | 'cancelled'
      readonly error?: unknown
    }

export interface OwnerDraftMutation {
  readonly changed: boolean
  readonly revision: number
  readonly draft: OwnerDraftSnapshot | null
}

export interface SessionViewState {
  readonly revision: number
  readonly drafts: DraftState
  readonly approvals: readonly ApprovalSummary[]
  readonly usage: readonly unknown[]
  readonly registry: WorkbenchRegistryLike
}

const EMPTY_REGISTRY: WorkbenchRegistryLike = { workspaces: {}, toolInstances: {}, leases: {} }

/** Stable request IDs also work in non-secure browser test contexts. */
let requestSequence = 0
export function nextOwnerSubmissionId(): string {
  requestSequence += 1
  const random = globalThis.crypto?.randomUUID?.()
  return `draft-submit-${random ?? `${Date.now().toString(36)}-${requestSequence}`}`
}

export class SessionViewStore {
  private drafts: DraftState = { schemaVersion: 1, sessions: {} }
  private approvals: readonly ApprovalSummary[] = []
  private usage: readonly unknown[] = []
  private registry: WorkbenchRegistryLike = EMPTY_REGISTRY
  private current: SessionViewState
  private readonly projections = new Map<string, SessionViewProjection>()
  private readonly listeners = new Set<() => void>()

  constructor() {
    this.current = this.makeState()
  }

  getSnapshot = (): SessionViewState => this.current

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getProjection(owner: ConversationIdentity): SessionViewProjection {
    const key = `${owner.kind}:${owner.id}`
    const cached = this.projections.get(key)
    if (cached) return cached
    const projection = composeSessionView({
      owner,
      drafts: this.drafts,
      approvals: this.approvals,
      usage: this.usage,
      registry: this.registry,
    })
    this.projections.set(key, projection)
    return projection
  }

  getDraft(owner: ConversationIdentity): OwnerDraftSnapshot | null {
    const key = `${owner.kind}:${owner.id}`
    const cached = this.projections.get(key)
    return cached?.draft ?? getOwnerDraft(this.drafts, owner)
  }

  dispatchDraft(command: OwnerDraftCommand, now = new Date().toISOString()): OwnerDraftMutation {
    const before = this.current
    const existing = this.getDraft(command.owner)
    let drafts = this.drafts
    let expectedRevision = command.type === 'update' || command.type === 'begin' ? command.expectedRevision : existing?.revision ?? 0

    switch (command.type) {
      case 'update':
        drafts = updateOwnerDraft(drafts, command.owner, command.expectedRevision, command.patch, now)
        break
      case 'begin':
        // Two mounted views can click before React broadcasts the first store
        // notification. The store, not a view-local ref, is the final gate.
        if (existing?.submission && ['sending', 'local-queued'].includes(existing.submission.state)) {
          return { changed: false, revision: existing.revision, draft: existing }
        }
        drafts = beginOwnerDraftSubmission(drafts, command.owner, command.expectedRevision, command.submissionId, now)
        expectedRevision = getOwnerDraft(drafts, command.owner)?.revision ?? expectedRevision
        break
      case 'queue': {
        if (existing?.submission?.submissionId !== command.submissionId) {
          return { changed: false, revision: existing?.revision ?? 0, draft: existing }
        }
        drafts = queueOwnerDraftLocally(drafts, command.owner, command.submissionId, now)
        break
      }
      case 'settle': {
        const submission = existing?.submission
        if (!submission || submission.submissionId !== command.submissionId
          || !['sending', 'local-queued'].includes(submission.state)) {
          return { changed: false, revision: existing?.revision ?? 0, draft: existing }
        }
        drafts = command.outcome === 'accepted'
          ? acceptOwnerDraftSubmission(drafts, command.owner, command.submissionId, now)
          : command.outcome === 'failed'
            ? failOwnerDraftSubmission(drafts, command.owner, command.submissionId, command.error ?? { message: 'send failed' }, now)
            : cancelOwnerDraftSubmission(drafts, command.owner, command.submissionId, now)
        // A late response must not erase text/attachments edited while the request was in flight.
        if (command.outcome === 'accepted' && existing.revision === command.expectedRevision) {
          const settled = getOwnerDraft(drafts, command.owner)
          if (settled) drafts = updateOwnerDraft(drafts, command.owner, settled.revision, { body: '', attachments: [] }, now)
        }
        break
      }
    }

    const changed = drafts !== this.drafts
    if (changed) this.commit({ ...before, drafts })
    const draft = getOwnerDraft(drafts, command.owner)
    return { changed, revision: draft?.revision ?? expectedRevision, draft }
  }

  bindAcceptedDraft(input: { readonly draftId: string; readonly sessionId: string; readonly submissionId: string }, now = new Date().toISOString()): void {
    const drafts = bindDraftOwnerToSession(this.drafts, { ...input, updatedAt: now })
    if (drafts !== this.drafts) this.commit({ ...this.current, drafts })
  }

  /** Replace Host-owned approvals atomically. This never decides an approval locally. */
  replaceApprovals(approvals: readonly ApprovalSummary[]): void {
    // Validation is performed by the same pure projector used by every view.
    composeSessionView({ owner: { kind: 'session', id: '__approval_validation__' }, approvals })
    if (approvals === this.approvals) return
    this.commit({ ...this.current, approvals: [...approvals] })
  }

  /**
   * Reconcile one session's pending cards from `interaction.list`. Other
   * sessions are untouched: a context only ever recovers its own session, and
   * merging them here must not erase approvals still pending elsewhere.
   */
  replaceSessionApprovals(sessionId: string, approvals: readonly ApprovalSummary[]): void {
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new Error('sessionId 不能为空')
    }
    if (approvals.some((item) => item.sessionId !== sessionId)) {
      throw new Error('replaceSessionApprovals 只能包含同一会话的审批')
    }
    const others = this.approvals.filter((item) => item.sessionId !== sessionId)
    const next = [...others, ...approvals]
    composeSessionView({ owner: { kind: 'session', id: sessionId }, approvals: next })
    if (next.length === this.approvals.length && next.every((item, index) => item === this.approvals[index])) {
      return
    }
    this.commit({ ...this.current, approvals: next })
  }

  applyInteraction(event: { readonly kind: 'interaction.required'; readonly interaction: ApprovalSummary }
    | { readonly kind: 'interaction.resolved'; readonly interactionId: string; readonly leaseGeneration: number; readonly outcome: 'submitted' | 'cancelled' }): void {
    if (event.kind === 'interaction.required') {
      const existing = this.approvals.some((item) => item.interactionId === event.interaction.interactionId)
      if (!existing) this.replaceApprovals([...this.approvals, event.interaction])
      return
    }
    this.replaceApprovals(this.approvals.map((item) => item.interactionId === event.interactionId
      && item.leaseGeneration === event.leaseGeneration
      ? { ...item, status: event.outcome }
      : item))
  }

  /** Usage records are Host facts. Exact replay IDs are ignored; corrections remain explicit. */
  addUsageRecord(record: unknown): void {
    composeSessionView({ owner: { kind: 'session', id: '__usage_validation__' }, usage: [record] })
    const usageId = (record as { usageId?: unknown }).usageId
    if (typeof usageId === 'string' && this.usage.some((item) => (item as { usageId?: unknown }).usageId === usageId)) return
    this.commit({ ...this.current, usage: [...this.usage, record] })
  }

  replaceRegistry(registry: WorkbenchRegistryLike): void {
    if (!registry || typeof registry !== 'object' || !registry.workspaces || !registry.toolInstances) {
      throw new Error('registry 缺少 workspaces/toolInstances')
    }
    if (registry === this.registry) return
    this.commit({ ...this.current, registry })
  }

  dispose(): void {
    this.listeners.clear()
    this.projections.clear()
  }

  private makeState(): SessionViewState {
    return { revision: 0, drafts: this.drafts, approvals: this.approvals, usage: this.usage, registry: this.registry }
  }

  private commit(next: Omit<SessionViewState, 'revision'>): void {
    this.drafts = next.drafts
    this.approvals = next.approvals
    this.usage = next.usage
    this.registry = next.registry
    this.current = { ...next, revision: this.current.revision + 1 }
    this.projections.clear()
    for (const listener of [...this.listeners]) listener()
  }
}
