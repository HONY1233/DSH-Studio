export type WindowLifecycleState = {
  readonly id: string
  readonly minimized?: boolean
  readonly maximized?: boolean
  readonly topmost?: boolean
  readonly attachedTo?: string | null
}

export type WindowLifecycleOp =
  | { readonly kind: 'put'; readonly window: WindowLifecycleState }
  | { readonly kind: 'close'; readonly id: string }
  | { readonly kind: 'minimize'; readonly id: string; readonly x?: number; readonly y?: number }
  | { readonly kind: 'maximize'; readonly id: string }
  | { readonly kind: 'restore'; readonly id: string }
  | { readonly kind: 'setTopmost'; readonly id: string; readonly topmost: boolean }
  | { readonly kind: 'attach'; readonly id: string; readonly attachedTo: string }
  | { readonly kind: 'detach'; readonly id: string }

export declare function reduceWindowLifecycle<T extends WindowLifecycleState>(windows: readonly T[], op: WindowLifecycleOp): T[]
export declare function windowLifecycleProjection(window: WindowLifecycleState): {
  readonly id: string
  readonly minimized: boolean
  readonly maximized: boolean
  readonly topmost: boolean
  readonly attachedTo: string | null
}
