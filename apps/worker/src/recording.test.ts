import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBrowserRecording } from "./recording.ts";
import { analyzeMedia } from "./media.ts";

test("recording is ready only after a real browser frame and retains frame clock measurements", async () => {
  const directory = await mkdtemp(join(tmpdir(), "capture-clock-"));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 640, height: 360 },
    });
    await page.setContent("<label>Message<textarea></textarea></label>");
    const origin = performance.now();
    const before = Date.now();
    const path = join(directory, "browser.webm");
    const recording = await startBrowserRecording(page, {
      path,
      size: { width: 640, height: 360 },
      eventOriginMonotonicMs: origin,
    });
    const readyAt = performance.now() - origin;
    await page
      .getByRole("textbox", { name: "Message" })
      .pressSequentially("Measured typing", { delay: 20 });
    const timing = await recording.stop();
    assert.ok(timing.frameCount >= 2);
    assert.ok(timing.firstFrameReceivedAtMs <= readyAt);
    assert.ok(timing.firstFrameUnixMs >= before - 1000);
    assert.ok(timing.lastFrameUnixMs >= timing.firstFrameUnixMs);
    assert.ok(timing.lastFrameReceivedAtMs >= timing.firstFrameReceivedAtMs);
    assert.ok(
      Math.abs(timing.eventOriginUnixMs - (performance.timeOrigin + origin)) <
        1,
    );
    assert.equal(timing.alignment, "requires-review");
    const media = await analyzeMedia(path, join(directory, "analysis"));
    assert.equal(media.width, 640);
    assert.ok(media.frameCount > 0);
  } finally {
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});
