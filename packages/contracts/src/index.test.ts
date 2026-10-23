import assert from "node:assert/strict";
import { test } from "node:test";
import { WorkflowPlan, BrowserFrameTiming } from "./index.ts";

const workflow = {
  schemaVersion: 1,
  id: "chat-benchmark",
  revision: "1",
  authorizedOrigins: ["http://127.0.0.1:4173"],
  initialState: { kind: "disposable-fixture", seed: "benchmark-v1" },
  permissions: ["fixture-write"],
  steps: [
    {
      id: "open",
      action: { kind: "navigate", url: "http://127.0.0.1:4173/" },
      postcondition: {
        target: { kind: "role", role: "heading", name: "Capture fixture" },
        state: "visible",
      },
      timeoutMs: 5000,
    },
  ],
};

test("browser frame timing rejects reversed observations and preserves uncalibrated status", () => {
  const timing = {
    eventOriginUnixMs: 1000,
    firstFrameUnixMs: 1010,
    lastFrameUnixMs: 1050,
    firstFrameReceivedAtMs: 15,
    lastFrameReceivedAtMs: 55,
    frameCount: 3,
    timestampRegressions: 0,
    largestTimestampRegressionMs: 0,
    alignment: "requires-review",
  };
  assert.equal(BrowserFrameTiming.safeParse(timing).success, true);
  assert.equal(
    BrowserFrameTiming.safeParse({
      ...timing,
      lastFrameUnixMs: 1005,
      timestampRegressions: 1,
      largestTimestampRegressionMs: 5,
    }).success,
    true,
  );
  for (const change of [
    { lastFrameUnixMs: 1009 },
    { lastFrameReceivedAtMs: 14 },
    { frameCount: 0 },
    { alignment: "verified" },
    { firstFrameUnixMs: Infinity },
  ])
    assert.equal(
      BrowserFrameTiming.safeParse({ ...timing, ...change }).success,
      false,
    );
});

test("workflow contracts reject navigation outside the authorized fixture and executable page code", () => {
  assert.equal(WorkflowPlan.safeParse(workflow).success, true);
  assert.equal(
    WorkflowPlan.safeParse({
      ...workflow,
      steps: [
        {
          ...workflow.steps[0],
          action: { kind: "navigate", url: "http://169.254.169.254/" },
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    WorkflowPlan.safeParse({
      ...workflow,
      steps: [
        {
          ...workflow.steps[0],
          action: { kind: "evaluate", script: "fetch('/delete')" },
        },
      ],
    }).success,
    false,
  );
});
