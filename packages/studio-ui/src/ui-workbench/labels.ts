/**
 * 文案 —— 单独成文件，方便以后接 dsh 的 locale 插件。
 * 这里只给中英两份最小集合，真实产品应走 `@deepseek-ai/dsh-client-locale`。
 */

import type { WorkbenchLabels } from './workbench-view.js'

const zh: WorkbenchLabels = {
  workspace: '工作台',
  separator: '调整分栏比例',
  tabs: {
    list: '窗口标签',
    close: (title) => `关闭 ${title}`,
  },
  float: {
    list: '浮窗标签',
    close: (title) => `关闭 ${title}`,
    closeWindow: '关闭窗口',
    minimize: '最小化',
    restore: '恢复窗口',
    pin: {
      none: '浮窗',
      workspace: '固定在工作区',
      app: '固定在应用',
      window: '独立窗口',
      windowTop: '独立窗口并置顶',
    },
  },
  backdrop: {
    title: '当前没有打开的对话',
    hint: '新建一场对话，或把面板拖进来',
    newConversation: '新建对话',
    openPanel: '打开面板',
    recent: '最近打开',
  },
}

const en: WorkbenchLabels = {
  workspace: 'Workbench',
  separator: 'Resize split',
  tabs: {
    list: 'Window tabs',
    close: (title) => `Close ${title}`,
  },
  float: {
    list: 'Float tabs',
    close: (title) => `Close ${title}`,
    closeWindow: 'Close window',
    minimize: 'Minimize',
    restore: 'Restore window',
    pin: {
      none: 'Float',
      workspace: 'Pinned to workspace',
      app: 'Pinned to app',
      window: 'Separate window',
      windowTop: 'Separate window on top',
    },
  },
  backdrop: {
    title: 'No open conversation',
    hint: 'Start one, or drag a panel in',
    newConversation: 'New conversation',
    openPanel: 'Open panel',
    recent: 'Recent',
  },
}

export function createWorkbenchLabels(locale: 'zh' | 'en' = 'zh'): WorkbenchLabels {
  return locale === 'en' ? en : zh
}
