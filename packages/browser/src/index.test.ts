import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { WorkflowPlan } from "@repo/contracts";
import { replay } from "./index.ts";

test("replay verifies real browser output and never retries a write with a failed outcome", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(
      "<button onclick=\"this.textContent='Sent'\">Send</button>",
    );
    const plan = WorkflowPlan.parse({
      schemaVersion: 1,
      id: "test",
      revision: "1",
      authorizedOrigins: ["http://127.0.0.1:4173"],
      initialState: { kind: "disposable-fixture", seed: "benchmark-v1" },
      permissions: ["fixture-write"],
      steps: [
        {
          id: "send",
          action: {
            kind: "click",
            target: { kind: "role", role: "button", name: "Send" },
            permission: "fixture-write",
          },
          postcondition: {
            target: { kind: "role", role: "button", name: "Sent" },
            state: "visible",
          },
          timeoutMs: 500,
        },
      ],
    });
    const events = await replay(page, plan);
    assert.deepEqual(
      events.map((event) => event.phase),
      ["started", "verified"],
    );
    await page.setContent(
      "<button onclick=\"this.textContent='Sent'\">Send</button>",
    );
    const broken = structuredClone(plan);
    broken.steps[0]!.postcondition.target = {
      kind: "role",
      role: "button",
      name: "Impossible",
    };
    await assert.rejects(replay(page, broken), /send/);
    assert.equal(
      await page.getByRole("button", { name: "Sent", exact: true }).count(),
      1,
    );
  } finally {
    await browser.close();
  }
});
