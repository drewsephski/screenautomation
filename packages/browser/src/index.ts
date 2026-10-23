import { expect, type Locator, type Page } from "playwright/test";
import { CaptureEvent, WorkflowPlan, type Target } from "@repo/contracts";

function locate(page: Page, target: Target): Locator {
  return target.kind === "label"
    ? page.getByLabel(target.name, { exact: true })
    : page.getByRole(target.role, { name: target.name, exact: true });
}

async function verify(
  page: Page,
  condition: WorkflowPlan["steps"][number]["postcondition"],
  timeout: number,
) {
  const locator = locate(page, condition.target);
  await locator.waitFor({ state: condition.state, timeout });
  if (condition.text !== undefined)
    await expect(locator).toContainText(condition.text, { timeout });
}

export async function replay(
  page: Page,
  input: unknown,
  options: {
    startedAt?: number;
    evidenceDirectory?: string;
    onEvent?: (event: ReturnType<typeof CaptureEvent.parse>) => Promise<void>;
  } = {},
) {
  const plan = WorkflowPlan.parse(input);
  const startedAt = options.startedAt ?? performance.now();
  const events: ReturnType<typeof CaptureEvent.parse>[] = [];
  for (const step of plan.steps) {
    for (let attempt = 0; attempt <= step.retries; attempt++) {
      const target =
        "target" in step.action ? locate(page, step.action.target) : null;
      const emit = async (
        phase: "started" | "verified" | "failed",
        screenshot?: string,
      ) => {
        const event = CaptureEvent.parse({
          stepId: step.id,
          attempt,
          phase,
          atMs: performance.now() - startedAt,
          coordinateSpace: "viewport-css-pixels",
          box:
            target && (await target.isVisible())
              ? await target.boundingBox({ timeout: 100 }).catch(() => null)
              : null,
          scroll: await page
            .evaluate(() => ({ x: window.scrollX, y: window.scrollY }))
            .catch(() => ({ x: 0, y: 0 })),
          screenshot,
        });
        events.push(event);
        await options.onEvent?.(event);
      };
      await emit("started");
      try {
        // One deadline covers the precondition, action, and postcondition together.
        const deadline = performance.now() + step.timeoutMs;
        const remaining = () => Math.max(1, deadline - performance.now());
        if (step.precondition)
          await verify(page, step.precondition, remaining());
        switch (step.action.kind) {
          case "navigate":
            await page.goto(step.action.url, {
              waitUntil: "domcontentloaded",
              timeout: remaining(),
            });
            break;
          case "click":
            await target!.click({ timeout: remaining() });
            break;
          case "type":
            await target!.fill("", { timeout: remaining() });
            await target!.pressSequentially(step.action.text, {
              delay: 25,
              timeout: remaining(),
            });
            break;
          case "scroll":
            await target!.scrollIntoViewIfNeeded({ timeout: remaining() });
            break;
        }
        await verify(page, step.postcondition, remaining());
        const screenshot = options.evidenceDirectory
          ? `${step.id}.png`
          : undefined;
        if (screenshot)
          await page.screenshot({
            path: `${options.evidenceDirectory}/${screenshot}`,
          });
        await emit("verified", screenshot);
        break;
      } catch {
        await emit("failed");
        if (attempt === step.retries)
          throw new Error(
            `Workflow step ${step.id} failed; capture is not verified`,
          );
      }
    }
  }
  return events;
}
