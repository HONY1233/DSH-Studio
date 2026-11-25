/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PreviewModeProvider, PreviewSurface, usePreviewMode } from "./PreviewContext";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  document.documentElement.removeAttribute("data-preview");
  document.documentElement.removeAttribute("data-preview-marks");
});

function Mode() {
  const mode = usePreviewMode();
  return <output data-testid="mode">{mode.preview ? "preview" : "production"}:{mode.marks ? "marked" : "unmarked"}</output>;
}

it("ignores preview and marks query parameters in the production entry", () => {
  vi.stubEnv("MODE", "production");
  localStorage.setItem("omp.previewMode", "1");
  window.history.replaceState(null, "", "/?preview=1&marks=off");
  render(<PreviewModeProvider><Mode /></PreviewModeProvider>);
  expect(screen.getByTestId("mode").textContent).toBe("production:unmarked");
  expect(screen.queryByTestId("preview-mode-mark")).toBeNull();
  expect(document.documentElement.getAttribute("data-preview")).toBe("off");
});

it("keeps the explicit harness preview visibly marked when marks=off is requested", () => {
  vi.stubEnv("MODE", "production");
  window.history.replaceState(null, "", "/?marks=off");
  render(<PreviewModeProvider preview><Mode /></PreviewModeProvider>);
  expect(screen.getByTestId("mode").textContent).toBe("preview:marked");
  expect(screen.getByTestId("preview-mode-mark").textContent).toBe("PREVIEW · Preview fixtures");
  expect(document.documentElement.getAttribute("data-preview-marks")).toBe("on");
});

it("retains the query switch only as a test seam", () => {
  vi.stubEnv("MODE", "test");
  window.history.replaceState(null, "", "/?preview=1&marks=off");
  render(<PreviewModeProvider><Mode /></PreviewModeProvider>);
  expect(screen.getByTestId("mode").textContent).toBe("preview:marked");
  expect(screen.getByTestId("preview-mode-mark")).toBeTruthy();
});

it("marks a local PreviewSurface even under a global production provider", () => {
  vi.stubEnv("MODE", "production");
  render(<PreviewModeProvider><PreviewSurface preview><Mode /></PreviewSurface></PreviewModeProvider>);
  expect(screen.getByTestId("mode").textContent).toBe("preview:marked");
  expect(screen.getByTestId("preview-mode-mark")).toBeTruthy();
  expect(document.documentElement.getAttribute("data-preview")).toBe("off");
});
