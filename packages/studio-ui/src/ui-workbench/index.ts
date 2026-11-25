export * from './controller.js'
export * from './drag.js'
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
export { DockSurface, type SurfaceContext } from './surface.js'
export { FloatLayer, type FloatLayerProps, type FloatLayerLabels } from './float-layer.js'
export { WorkspaceBackdrop, type BackdropProps, type BackdropLabels } from './backdrop.js'
export {
  WorkbenchView,
  hasOnlyFloatWindows,
  type WorkbenchViewProps,
  type WorkbenchLabels,
} from './workbench-view.js'
export { createWorkbenchLabels } from './labels.js'
