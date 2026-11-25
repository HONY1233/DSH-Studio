/** Fail-closed production replacement for the preview-only native tool gallery. */
import type { JsonValue } from "@omp-studio/client-contract";

export function getNativeToolGallery(): readonly { readonly [key: string]: JsonValue }[] {
  return [];
}

export const NATIVE_TOOL_GALLERY: readonly { readonly [key: string]: JsonValue }[] = [];
