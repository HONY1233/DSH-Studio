/**
 * 面板契约层导出面。
 *
 * 与 scaffold 的差别：**不再包含插件入口**（原 index.ts 里的 `apply` / `inject`）。
 * 现在整个工作台是单插件（`@studio/ui-shell`），`PanelRegistry` 由 shell 直接
 * new 出来并往下传，所以这一层只需要纯库导出。
 */

export * from './contract.js'
export * from './registry.js'
export * from './size.js'
export { PanelHost, MULTIPLE_ROOTS_HINT, type PanelHostProps } from './host.js'
export { usePanelSize } from './use-panel-size.js'
