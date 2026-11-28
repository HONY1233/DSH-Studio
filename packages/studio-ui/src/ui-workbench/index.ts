export * from './controller.js'
export * from './drag.js'
export {
  WORKBENCH_LAYOUT_STORAGE_FORMAT,
  WORKBENCH_LAYOUT_STORAGE_VERSION,
  LayoutPersistenceError,
  createLayoutPersistence,
  type CreateLayoutPersistenceOptions,
  type LayoutPersistenceErrorCode,
  type LayoutPersistenceReport,
  type LayoutPersistenceStorage,
  type PersistedWorkbenchLayout,
  type WorkbenchLayoutPersistence,
} from './layout-persistence.js'
export {
  DEFAULT_FLOAT_RECT,
  PLACEMENT_LABELS,
  placeOps,
  type Placement,
  type PlacementContext,
  type PlacementIds,
} from './placement.js'
export {
  browserStorage,
  isPlacement,
  PlacementMemory,
  type PlacementStorage,
} from './placement-memory.js'
export { TabStrip, type TabStripProps, type TabStripLabels } from './tab-strip.js'
export { TabPanel, type TabPanelProps } from './tab-panel.js'
export {
  WorkbenchContentLayer,
  type WorkbenchContentEntry,
  type WorkbenchContentLayerProps,
} from './content-layer.js'
export { DockSurface, type SurfaceContext } from './surface.js'
export { FloatLayer, type FloatLayerProps, type FloatLayerLabels } from './float-layer.js'
export { WorkspaceBackdrop, type BackdropProps, type BackdropLabels } from './backdrop.js'
export {
  WorkbenchView,
  hasOnlyFloatWindows,
  type ExclusiveTransferBinding,
  type WorkbenchViewProps,
  type WorkbenchLabels,
} from './workbench-view.js'
export {
  ExclusiveTransferDialog,
  defaultExclusiveTransferLabels,
  type ExclusiveTransferDialogLabels,
  type ExclusiveTransferDialogProps,
} from './exclusive-transfer-dialog.js'
export {
  ToolTransferError,
  beginToolTransfer,
  normalizeToolTransferRequest,
  requiresExclusiveChoice,
  resolveToolTransfer,
  type ExclusiveTransferPrompt,
  type ResolveTransferOptions,
  type ToolConcurrency,
  type ToolTransferAction,
  type ToolTransferDecision,
  type ToolTransferMode,
  type ToolTransferRequest,
  type ToolTransferSource,
  type ToolTransferState,
  type ToolTransferTarget,
} from './exclusive-transfer.js'
export { createWorkbenchLabels } from './labels.js'
export { makeTab, storageKey } from '../workbench/index.js'
