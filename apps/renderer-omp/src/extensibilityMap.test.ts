import { describe, expect, it } from "vitest";
import type { PluginRecord, SkillRecord } from "@omp-studio/client-contract";
import { pluginToPreview, skillToPreview } from "./extensibilityMap";
import { isDrawerItemAdded } from "./skillsPreview";

const skill: SkillRecord = {
  name: "review",
  desc: "Review changes",
  scope: "workspace",
  sourceKind: "native",
  sourceLabel: "DSH",
  enabled: true,
  hide: false,
};

const plugin: PluginRecord = {
  name: "mcp-client",
  version: "dsh",
  sourceKind: "npm",
  srcLabel: "npm",
  enabled: true,
  status: "configured",
  tools: 0,
  commands: 0,
  hooks: 0,
  ui: false,
  toolItems: [],
  commandItems: [],
  hookItems: [],
  uiItems: [],
};

describe("extensibility read-model projection", () => {
  it("does not turn a discovered skill into a loaded or session skill", () => {
    const preview = skillToPreview(skill);
    expect(preview.enabled).toBe(true);
    expect(preview.loaded).toBe(false);
    expect(preview.session).toBe(false);
    expect(isDrawerItemAdded(preview)).toBe(false);
  });

  it("keeps configured plugins distinct from loaded plugins", () => {
    const preview = pluginToPreview(plugin);
    expect(preview.status).toBe("configured");
    expect(preview.enabled).toBe(true);
    expect(isDrawerItemAdded(preview)).toBe(false);
  });
});
