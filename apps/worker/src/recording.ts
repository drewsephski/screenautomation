import type { Page } from "playwright";
import { BrowserFrameTiming } from "@repo/contracts";

export async function startBrowserRecording(
  page: Page,
  options: {
    path: string;
    size: { width: number; height: number };
    eventOriginMonotonicMs: number;
  },
): Promise<{ stop(): Promise<BrowserFrameTiming> }> {
  let timing: BrowserFrameTiming | undefined;
  let invalidFrame: string | undefined;
  let ready!: () => void;
  const firstFrame = new Promise<void>((resolve) => {
    ready = resolve;
  });
  await page.screencast.start({
    path: options.path,
    size: options.size,
    fps: 60,
    onFrame(frame) {
      const receivedAtMs = performance.now() - options.eventOriginMonotonicMs;
      if (!Number.isFinite(frame.timestamp) || receivedAtMs < 0) {
        invalidFrame = `Invalid browser frame timeline: timestamp=${frame.timestamp}, previous=${timing?.lastFrameUnixMs}, received=${receivedAtMs}`;
        ready();
        return;
      }
      if (!timing) {
        timing = {
          eventOriginUnixMs:
            performance.timeOrigin + options.eventOriginMonotonicMs,
          firstFrameUnixMs: frame.timestamp,
          lastFrameUnixMs: frame.timestamp,
          firstFrameReceivedAtMs: receivedAtMs,
          lastFrameReceivedAtMs: receivedAtMs,
          frameCount: 1,
          timestampRegressions: 0,
          largestTimestampRegressionMs: 0,
          alignment: "requires-review",
        };
        ready();
      } else {
        if (frame.timestamp < timing.lastFrameUnixMs) {
          timing.timestampRegressions++;
          timing.largestTimestampRegressionMs = Math.max(
            timing.largestTimestampRegressionMs,
            timing.lastFrameUnixMs - frame.timestamp,
          );
        }
        timing.lastFrameUnixMs = frame.timestamp;
        timing.lastFrameReceivedAtMs = receivedAtMs;
        timing.frameCount++;
      }
    },
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      firstFrame,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("No browser frame received")),
          10000,
        );
      }),
    ]);
    if (invalidFrame) throw new Error(invalidFrame);
  } catch (error) {
    await page.screencast.stop().catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  return {
    async stop() {
      await page.screencast.stop();
      if (invalidFrame || !timing)
        throw new Error(invalidFrame ?? "Missing browser frame timeline");
      return BrowserFrameTiming.parse(timing);
    },
  };
}
