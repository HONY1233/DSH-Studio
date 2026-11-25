import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installComposerLoader } from "../fixtures/x0/composer-loader.mjs";

installComposerLoader();
const {
  composerSlashExecute,
  mergeSlashCatalogWithManifest,
  planComposerSend,
  resolveSlashExecute,
  visibleSlashCatalog,
} = await import("../../../apps/renderer-omp/src/composer/commands.ts");
const { snapshotFromText } = await import("../../../apps/renderer-omp/src/composer/serialize.ts");

function entry(overrides = {}) {
  return {
    id: "builtin.test", name: "test", aliases: [], description: "test", source: "builtin",
    implementation: "shared-service", interactionKinds: [], presentation: "native",
    availability: "available", risk: "normal", effect: "read", contractTestId: "test.contract",
    ...overrides,
  };
}

for (const text of ["/btw why the rename?", "/BTW private question", "/computer status"]) {
  test(`${text} is rejected with the exact original snapshot`, () => {
    const snapshot = snapshotFromText(text);
    const plan = planComposerSend(snapshot);
    assert.equal(plan.kind, "reject");
    assert.equal(plan.snapshot, snapshot);
    assert.equal(plan.snapshot.text, text);
    assert.equal(composerSlashExecute(snapshot), undefined);
  });
}

test("Runtime side commands stay disabled and cannot fall through to a prompt", () => {
  const catalog = mergeSlashCatalogWithManifest({
    generatedAt: "2026-11-24T00:00:00Z", upstreamCommit: "test", hash: "test", unclassifiedBuiltins: [],
    commands: [entry({ id: "builtin.private", name: "private", side: true })],
  });
  assert.equal(catalog[0].availability, "disabled");
  assert.deepEqual(resolveSlashExecute(catalog[0], "question"), { kind: "none" });
  const snapshot = snapshotFromText("/private question");
  const plan = planComposerSend(snapshot, catalog);
  assert.equal(plan.kind, "reject");
  assert.equal(plan.snapshot, snapshot);
  assert.equal(composerSlashExecute(snapshot, catalog), undefined);
});

test("external commands are absent from the visible catalog without changing ordinary fallback", () => {
  assert.equal(visibleSlashCatalog().some(command => command.name === "btw" || command.name === "computer"), false);
  assert.equal(planComposerSend(snapshotFromText("/ordinary-unknown")).kind, "prompt");
});

test("follow-up and queued immediate-send reject before draft, queue, approval, or steer side effects", () => {
  const source = readFileSync(new URL("../../../apps/renderer-omp/src/workbench/WorkbenchCanvas.tsx", import.meta.url), "utf8");
  for (const [name, endMarker, sideEffects] of [
    ["sendFollowUp", "const takeComposerSnapshot", ["replaceDraft(", "dispatchPrompt("]],
    ["sendQueuedNow", "// 一次有界遍历", ['respond("cancel"', "client.command(", "setQueuedMessages((queue) => queue.filter"]],
  ]) {
    const start = source.indexOf(`const ${name} = async`);
    assert.ok(start >= 0, name);
    const body = source.slice(start, source.indexOf(endMarker, start));
    const rejection = body.indexOf('if (planned.kind === "reject")');
    assert.ok(rejection >= 0, `${name} must reject external commands`);
    for (const sideEffect of sideEffects) {
      const position = body.indexOf(sideEffect);
      assert.ok(position > rejection, `${name}: ${sideEffect} must follow external-command rejection`);
    }
  }
});

test("workbench rejection precedes queueing, approval steering, session creation, and draft clearing", () => {
  const source = readFileSync(new URL("../../../apps/renderer-omp/src/workbench/WorkbenchCanvas.tsx", import.meta.url), "utf8");
  const start = source.indexOf("const sendPrompt = async () =>");
  assert.ok(start >= 0);
  const body = source.slice(start);
  const rejection = body.indexOf('if (plan.kind === "reject")');
  assert.ok(rejection >= 0);
  for (const sideEffect of ["setPreviewQueue(", 'respond("cancel"', "ensureNewSession?.(", "replaceDraft(emptySnapshot())"]) {
    const position = body.indexOf(sideEffect);
    assert.ok(position > rejection, `${sideEffect} must happen after external-command rejection`);
  }
});
