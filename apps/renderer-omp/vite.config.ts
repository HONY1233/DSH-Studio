import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createProductionPreviewAliases } from "./productionPreviewBoundary";

const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** X0 external-capability preview modules are physically excluded from product builds. */
const PRODUCTION_PREVIEW_ALIASES = createProductionPreviewAliases(local);

export function createRendererConfig(previewHarness = false) {
  return defineConfig({
    plugins: [react()],
    base: "./",
    resolve: {
      alias: [
        {
          find: "@oh-my-pi/pi-tui/html-form/data",
          replacement: local("../../omp-patch/vendor/oh-my-pi/packages/tui/src/html-form/data.ts"),
        },
        {
          find: "@oh-my-pi/pi-tui/html-form/model",
          replacement: local("../../omp-patch/vendor/oh-my-pi/packages/tui/src/html-form/model.ts"),
        },
        {
          find: "@oh-my-pi/pi-utils/dom",
          replacement: local("../../omp-patch/vendor/oh-my-pi/packages/utils/src/dom.ts"),
        },
        // Upstream test fixtures are available only to the local preview harness.
        // The production/default config deliberately has no testkit alias.
        ...(previewHarness ? [{
          find: "@omp-studio/testkit",
          replacement: local("./test-support/omp-testkit/src/index.ts"),
        }] : []),
        ...(previewHarness ? [] : PRODUCTION_PREVIEW_ALIASES),
      ],
    },
    ...(previewHarness ? {
      build: { rollupOptions: { input: local("./preview-app-harness.html") } },
    } : {}),
    server: {
      cors: { origin: ["null", /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/] },
    },
  });
}

// Product/default builds always fail closed. Only vite.preview.config.ts opts
// into fixture modules, and that config builds the harness HTML as its sole input.
export default createRendererConfig(false);
