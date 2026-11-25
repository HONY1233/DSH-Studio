import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import { createRendererConfig } from "./vite.config";

const rootModule = (path: string) => fileURLToPath(new URL(`../../node_modules/${path}`, import.meta.url));

// The standalone renderer has its own React copy while the root workspace
// provides Vitest/Testing Library. Dedupe both so DOM tests use one dispatcher.
export default mergeConfig(
  createRendererConfig(false),
  defineConfig({
    resolve: {
      dedupe: ["react", "react-dom"],
      alias: [
        { find: /^react$/, replacement: rootModule("react/index.js") },
        { find: /^react\/jsx-runtime$/, replacement: rootModule("react/jsx-runtime.js") },
        { find: /^react\/jsx-dev-runtime$/, replacement: rootModule("react/jsx-dev-runtime.js") },
        { find: /^react-dom$/, replacement: rootModule("react-dom/index.js") },
        { find: /^react-dom\/client$/, replacement: rootModule("react-dom/client.js") },
        {
          find: "@omp-studio/testkit",
          replacement: fileURLToPath(new URL("./test-support/omp-testkit/src/index.ts", import.meta.url)),
        },
      ],
    },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      // The virtualizer must resolve the same deduplicated React instance as
      // Testing Library and renderer source; externalized deps bypass Vite aliases.
      server: { deps: { inline: ["@tanstack/react-virtual"] } },
      // Vendor source and compiled dist are dependencies, not this renderer's suite.
      include: ["src/**/*.{test,spec}.{ts,tsx}"],
    },
  }),
);
