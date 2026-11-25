import { registerHooks } from "node:module";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const i18nMock = "data:text/javascript," + encodeURIComponent("export const isZh = () => false; export const pickLocale = (zh, en) => en;");

/** Resolve the real composer sources under Node's built-in TypeScript stripping. */
export function installComposerLoader() {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "../i18n" || specifier === "./i18n" || specifier === "../i18n/index" || specifier === "./i18n/index") {
        return { url: i18nMock, shortCircuit: true };
      }
      if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
        const url = new URL(specifier, context.parentURL);
        for (const suffix of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
          const candidate = new URL(url.href + suffix);
          try {
            if (statSync(fileURLToPath(candidate)).isFile()) return { url: candidate.href, shortCircuit: true };
          } catch { /* try the next source extension */ }
        }
      }
      return nextResolve(specifier, context);
    },
  });
}
