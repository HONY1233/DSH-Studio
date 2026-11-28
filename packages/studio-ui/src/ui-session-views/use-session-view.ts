import { useCallback, useSyncExternalStore } from 'react'

import { useSessionViewStore } from './provider.js'
import type { ConversationIdentity, OwnerDraftCommand, SessionViewProjection, SessionViewStore } from './session-view-store.js'

const subscribeNone = (): (() => void) => () => {}
const getNull = (): null => null
const dispatchNone = (_command: OwnerDraftCommand): { changed: false; revision: 0; draft: null } => ({ changed: false, revision: 0, draft: null })

export interface OwnerSessionView {
  readonly store: SessionViewStore | null
  readonly projection: SessionViewProjection | null
  readonly dispatchDraft: (command: OwnerDraftCommand) => { changed: boolean; revision: number; draft: import('@dsh-studio/workbench-core').OwnerDraftSnapshot | null }
}

/** Multiple views of one identity read the same cached projection and mutation path. */
export function useOwnerSessionView(owner: ConversationIdentity): OwnerSessionView {
  const store = useSessionViewStore()
  const subscribe = useCallback((listener: () => void) => store ? store.subscribe(listener) : subscribeNone(), [store])
  const getSnapshot = useCallback(() => store ? store.getProjection(owner) : null, [owner, store])
  const projection = useSyncExternalStore(subscribe, getSnapshot, getNull)
  const dispatchDraft = useCallback(
    (command: OwnerDraftCommand) => store ? store.dispatchDraft(command) : dispatchNone(command),
    [store],
  )
  return { store, projection, dispatchDraft }
}
