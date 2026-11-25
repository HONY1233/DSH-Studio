import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  PREVIEW_MODE_SWITCH_ENABLED,
  readStoredPreviewMode,
  writeStoredPreviewMode,
} from "./mode";

export type PreviewModeValue = {
  readonly enabled: boolean;
  readonly preview: boolean;
  /** Preview markings are mandatory whenever fixture data is active. */
  readonly marks: boolean;
  readonly setPreview: (next: boolean) => void;
};

const PreviewModeContext = createContext<PreviewModeValue>({
  enabled: false,
  preview: false,
  marks: true,
  setPreview: () => undefined,
});

function previewForcedByQuery(): boolean {
  // Query-string preview is a test seam only. Vite removes this branch from
  // production builds; packaged users cannot opt into fixture data by URL.
  if (import.meta.env.MODE !== "test") return false;
  try {
    return new URLSearchParams(window.location.search).get("preview") === "1";
  } catch {
    return false;
  }
}

export function PreviewModeProvider({
  children,
  preview: explicitPreview = false,
  switchEnabled = PREVIEW_MODE_SWITCH_ENABLED,
}: {
  children: ReactNode;
  /** Only a preview/harness entry or test may opt into fixture data. */
  preview?: boolean;
  /** Tests keep the switch so fixture surfaces stay exercisable after ship. */
  switchEnabled?: boolean;
}) {
  const forced = previewForcedByQuery();
  const [stored, setStored] = useState(() => (switchEnabled ? readStoredPreviewMode() : false));
  const preview = explicitPreview || forced || (switchEnabled ? stored : false);
  const marks = preview;

  useEffect(() => {
    document.documentElement.setAttribute("data-preview", preview ? "on" : "off");
    document.documentElement.setAttribute("data-preview-marks", marks ? "on" : "off");
  }, [marks, preview]);

  const setPreview = useCallback((next: boolean) => {
    if (!switchEnabled) return;
    setStored(next);
    writeStoredPreviewMode(next);
  }, [switchEnabled]);

  const value = useMemo<PreviewModeValue>(
    () => ({ enabled: switchEnabled, preview, marks, setPreview }),
    [marks, preview, setPreview, switchEnabled],
  );

  return <PreviewModeContext.Provider value={value}>
    {children}
    {preview ? <div className="preview-mode-mark" role="note" aria-label="Preview fixture data" data-testid="preview-mode-mark">PREVIEW · Preview fixtures</div> : null}
  </PreviewModeContext.Provider>;
}

export function usePreviewMode(): PreviewModeValue {
  return useContext(PreviewModeContext);
}

/** Parked workspaces keep their own data source while the global switch changes. */
export function PreviewSurface({ preview, children }: { preview: boolean; children: ReactNode }) {
  const mode = usePreviewMode();
  const value = useMemo(() => ({ ...mode, preview, marks: preview }), [mode, preview]);
  return <PreviewModeContext.Provider value={value}>{children}{preview && !mode.preview ? <div className="preview-mode-mark" role="note" aria-label="Preview fixture data" data-testid="preview-mode-mark">PREVIEW · Preview fixtures</div> : null}</PreviewModeContext.Provider>;
}
