import { describe, expect, it } from 'vitest'

import { allTabs } from '../workbench/index.js'
import { createEmptyController, type WorkbenchLimitError } from './controller.js'

describe('WorkbenchController view cap', () => {
  it('rejects the tab past the configured view limit and keeps the layout unchanged', () => {
    const controller = createEmptyController({ limits: { maxTabsPerWorkspace: 1 } })
    controller.open({ kind: 'conversation', contentId: 's1', instanceId: 'session:s1' })
    const before = controller.getState()

    let failure: WorkbenchLimitError | null = null
    try {
      controller.open({ kind: 'conversation', contentId: 's2', instanceId: 'session:s2' })
    } catch (error) {
      failure = error as WorkbenchLimitError
    }

    expect(failure?.code).toBe('LIMIT_EXCEEDED')
    expect(failure?.details).toMatchObject({ resource: 'views', used: 1, limit: 1 })
    expect(controller.getState()).toBe(before)
    expect(allTabs(controller.getState()).map((tab) => tab.ref.contentId)).toEqual(['s1'])
    expect(controller.limitError()?.message).toContain('view 已达上限（1）')

    controller.clearLimitError()
    expect(controller.limitError()).toBeNull()

    const pane = controller.focusedPane()
    const tab = allTabs(controller.getState())[0]
    if (!pane || !tab) throw new Error('missing tab')
    controller.dispatch({ kind: 'removeTab', pane, tabId: tab.id })
    controller.open({ kind: 'conversation', contentId: 's2', instanceId: 'session:s2' })
    expect(controller.limitError()).toBeNull()
    expect(allTabs(controller.getState()).map((row) => row.ref.contentId)).toEqual(['s2'])
  })

  it('counts region tabs against the same view limit', () => {
    const controller = createEmptyController({ limits: { maxTabsPerWorkspace: 1 } })
    const region = controller.getState().regions?.sidebar
    if (!region) throw new Error('no sidebar region')
    controller.dispatch({
      kind: 'insertRegionTab',
      region: 'sidebar',
      tab: { id: controller.mint.tab(), ref: { kind: 'panel', contentId: 'files', instanceId: 'files:1' } },
    })
    expect(allTabs(controller.getState())).toHaveLength(1)

    expect(() => controller.open({ kind: 'conversation', contentId: 's1', instanceId: 'session:s1' }))
      .toThrow(/view 已达上限/)
    expect(allTabs(controller.getState())).toHaveLength(1)
  })
})