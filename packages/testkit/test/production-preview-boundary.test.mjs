import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createProductionPreviewAliases } from "../../../apps/renderer-omp/productionPreviewBoundary.ts";

const APP = new URL("../../../apps/renderer-omp/", import.meta.url);
const CONFIG = new URL("vite.config.ts", APP);
const local = path => fileURLToPath(new URL(path, CONFIG));
const aliases = createProductionPreviewAliases(local);

const previewModules = [
  "src/preview/computerPreview.ts",
  "src/preview/sshPreview.ts",
  "src/preview/agentBtwPreview.ts",
  "src/preview/nativeToolGallery.ts",
  "src/workspaces/SshPreparationDialog.tsx",
  "src/workspaces/ExecutionTargetPicker.tsx",
];

function aliasFor(specifier) {
  return aliases.find(alias => alias.find.test(specifier))?.replacement;
}

function sourceFile(path) {
  for (const candidate of [path, `${path}.ts`, `${path}.tsx`, `${path}.js`, `${path}.mjs`, `${path}/index.ts`, `${path}/index.tsx`]) {
    try { if (statSync(candidate).isFile()) return candidate; } catch { /* try the next extension */ }
  }
  return undefined;
}

function productionGraph(entry = "src/main.tsx") {
  const seen = new Set();
  const pending = [resolve(fileURLToPath(APP), entry)];
  const imports = /(?:from\s*|import\s*|import\(\s*)['"]([^'"]+)['"]/g;
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(imports)) {
      const specifier = match[1];
      const replacement = aliasFor(specifier);
      let target;
      if (replacement) target = sourceFile(replacement);
      else if (specifier.startsWith(".")) target = sourceFile(resolve(dirname(file), specifier));
      // Package imports and pre-existing missing legacy modules are outside this
      // focused boundary check; the complete build remains the authority.
      if (target) pending.push(target);
    }
  }
  return seen;
}

test("all six external-capability preview modules have fail-closed product replacements", () => {
  assert.equal(aliases.length, 6);
  for (const relative of previewModules) {
    const name = relative.split("/").at(-1).replace(/\.(tsx?|js)$/, "");
    const specifier = `./preview/${name}`;
    const alias = aliasFor(specifier) ?? aliasFor(`./workspaces/${name}`);
    assert.ok(alias, `missing alias for ${relative}`);
    assert.match(alias, /\.production\.tsx?$/);
    assert.ok(statSync(alias).isFile());
  }
});

test("regex aliases replace complete relative and absolute specifiers with an absolute product path", () => {
  for (const alias of aliases) {
    for (const prefix of ["./", "../", "../../", "/home/project/"]) {
      const name = basename(alias.replacement).replace(/\.production\.tsx?$/, "");
      const replaced = `${prefix}${name}`.replace(alias.find, alias.replacement);
      assert.equal(isAbsolute(replaced), true, `${prefix}${name} produced ${replaced}`);
      assert.equal(replaced, alias.replacement);
    }
  }
});

test("the production import closure cannot reach Computer, SSH/WSL preparation, BTW, or preview gallery fixtures", () => {
  const graph = productionGraph();
  assert.ok(graph.size > 100, `expected a broad product graph, got ${graph.size} modules`);
  for (const relative of previewModules) {
    assert.equal(graph.has(resolve(fileURLToPath(APP), relative)), false, `${relative} leaked into the product graph`);
  }
  // These three replacements are reached today; the other aliases are guards
  // for future imports of the currently unreferenced Computer/BTW/SSH fixtures.
  for (const relative of [
    "src/preview/nativeToolGallery.production.ts",
    "src/workspaces/SshPreparationDialog.production.tsx",
    "src/workspaces/ExecutionTargetPicker.production.tsx",
  ]) {
    assert.equal(graph.has(resolve(fileURLToPath(APP), relative)), true, `${relative} missing from the product boundary`);
  }
});

test("only the explicit preview harness config opts out of the product boundary", () => {
  const product = readFileSync(CONFIG, "utf8");
  const harness = readFileSync(new URL("vite.preview.config.ts", APP), "utf8");
  assert.match(product, /previewHarness \? \[\] : PRODUCTION_PREVIEW_ALIASES/);
  assert.match(product, /export default createRendererConfig\(false\)/);
  assert.match(harness, /createRendererConfig\(true\)/);
  const entry = readFileSync(new URL("src/preview-app-harness-entry.tsx", APP), "utf8");
  assert.match(entry, /<App client=\{client\} preview \/>/);
  const productEntry = readFileSync(new URL("src/main.tsx", APP), "utf8");
  assert.doesNotMatch(productEntry, /<App[^>]*\bpreview\b/);
  const productHtml = readFileSync(new URL("index.html", APP), "utf8");
  const harnessHtml = readFileSync(new URL("preview-app-harness.html", APP), "utf8");
  assert.match(productHtml, /\/src\/main\.tsx/);
  assert.doesNotMatch(productHtml, /preview-app-harness-entry/);
  assert.match(harnessHtml, /\/src\/preview-app-harness-entry\.tsx/);
});

test("production preview activation cannot be restored through URL parameters or stored preferences", () => {
  const context = readFileSync(new URL("src/preview/PreviewContext.tsx", APP), "utf8");
  const mode = readFileSync(new URL("src/preview/mode.ts", APP), "utf8");
  assert.match(mode, /PREVIEW_MODE_SWITCH_ENABLED = false/);
  assert.match(context, /if \(import\.meta\.env\.MODE !== "test"\) return false/);
  assert.match(context, /const marks = preview/);
  assert.match(context, /preview && !mode\.preview/);
  assert.doesNotMatch(context, /get\("marks"\)|PREVIEW_MARKS_QUERY_KEY|previewMarksHidden/);
});

test("native float documents receive an independent mandatory preview marker", () => {
  const float = readFileSync(new URL("src/dock/NativeFloat.tsx", APP), "utf8");
  const css = readFileSync(new URL("src/styles/base.css", APP), "utf8");
  assert.match(float, /targetRoot\.setAttribute\("data-preview-dom", "float"\)/);
  assert.match(float, /"data-preview", "data-preview-marks"/);
  assert.match(css, /html\[data-preview-dom="float"\]\[data-preview="on"\]\[data-preview-marks="on"\]::after/);
  assert.match(css, /content: "PREVIEW · Preview fixtures"/);
});
