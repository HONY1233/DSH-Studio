/**
 * @deepseek-ai/dsh-client-ui-session-views
 *
 * 会话多视图绑定：`sessions.retain` 的引用计数 + tab 容器的会话作用域子树。
 * 解决的是"同一场对话出现在两个窗口里"这件事：
 * 两条流不打架、搬家不掉线、关掉才释放。
 */

export * from './port.js'
export * from './leases.js'
export * from './provider.js'
export * from './use-session-lease.js'
export * from './session-tab-view.js'
export { createSessionTabViewLabels } from './labels.js'
