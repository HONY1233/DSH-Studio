/**
 * 文案 —— 与 ui-workbench 一致：单独成文件，等接 dsh 的 locale 插件时替换。
 */

import type { SessionTabViewLabels } from './session-tab-view.js'

const zh: SessionTabViewLabels = {
  opening: '正在打开对话…',
  failed: '这场对话打不开',
  missing: '这个标签不是对话',
}

const en: SessionTabViewLabels = {
  opening: 'Opening conversation…',
  failed: "This conversation can't be opened",
  missing: 'This tab is not a conversation',
}

export function createSessionTabViewLabels(locale: 'zh' | 'en' = 'zh'): SessionTabViewLabels {
  return locale === 'en' ? en : zh
}
