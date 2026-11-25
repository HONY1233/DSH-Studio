/**
 * 在工作台里打开一场会话：已开着就切焦点，没开就新开一个标签。
 *
 * 单独成文件是因为**左栏与主区共用同一份语义**：点侧栏、点空态里的
 * "最近打开"、新建会话之后，都走这一条路径。分散实现过一次，
 * 结果侧栏能开出重复标签 —— 这类"同一动作两个实现"最容易漂。
 */

import { conversationRef, sessionIdOf } from '../ui-session-views/index.js'
import type { WorkbenchController } from '../ui-workbench/controller.js'
import { panes } from '../workbench/layout.js'

export function openSessionInWorkbench(controller: WorkbenchController, sessionId: string): void {
  for (const pane of panes(controller.getState().root)) {
    const hit = pane.tabs.find((tab) => sessionIdOf(tab.ref) === sessionId)
    if (hit) {
      controller.dispatch({ kind: 'activateTab', pane: pane.id, tabId: hit.id })
      controller.dispatch({ kind: 'focus', id: pane.id })
      return
    }
  }
  controller.open(conversationRef(sessionId))
}

/** 工作台里已经有标签了吗（用于"首次挂载才自动铺开"的守卫）。 */
export function workbenchHasTabs(controller: WorkbenchController): boolean {
  return panes(controller.getState().root).some((pane) => pane.tabs.length > 0)
}
