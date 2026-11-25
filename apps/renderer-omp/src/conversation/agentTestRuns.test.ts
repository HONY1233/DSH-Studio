import { describe, expect, it } from "vitest";
import type { TimelineRow, ToolView } from "./conversationViewModel";
import { agentTestRunSummary, projectAgentTestRuns } from "./agentTestRuns";

function row(tool: ToolView): TimelineRow {
  return {
    type: "assistant",
    itemId: `item-${tool.toolCallId}`,
    createdAt: "2026-11-24T00:00:00.000Z",
    status: "completed",
    segments: [{ type: "batch", key: "tools", tools: [tool] }],
  };
}

function testTool(overrides: Partial<ToolView> = {}): ToolView {
  return {
    toolCallId: "call-1",
    toolName: "bash",
    arguments: { command: "npm test" },
    status: "succeeded",
    ...overrides,
  };
}

describe("agent test result projection", () => {
  it("does not invent a pass when a completed tool has no exit code", () => {
    const [run] = projectAgentTestRuns([row(testTool())]);
    expect(run?.status).toBe("unknown");
    expect(run?.exitCode).toBeUndefined();
    expect(agentTestRunSummary([run!]).passed).toBe(0);
    expect(agentTestRunSummary([run!]).unknown).toBe(1);
  });

  it("uses an explicit zero exit code as pass and a nonzero code as failure", () => {
    const runs = projectAgentTestRuns([
      row(testTool({ toolCallId: "pass", result: { type: "toolResult", toolCallId: "pass", output: [], data: { exitCode: 0 } } })),
      row(testTool({ toolCallId: "fail", result: { type: "toolResult", toolCallId: "fail", output: [], data: { exitCode: 2 } } })),
    ]);
    expect(runs.map((run) => run.status)).toEqual(["fail", "pass"]);
    expect(agentTestRunSummary(runs)).toMatchObject({ passed: 1, failed: 1, unknown: 0 });
  });

  it("keeps failed and aborted tool states distinct from an unknown result", () => {
    const runs = projectAgentTestRuns([
      row(testTool({ toolCallId: "failed", status: "failed" })),
      row(testTool({ toolCallId: "aborted", status: "aborted" })),
    ]);
    expect(runs.map((run) => run.status)).toEqual(["aborted", "fail"]);
  });
});
