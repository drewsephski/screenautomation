import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { analyzeMedia, benchmarkGate } from "./media.ts";

test("benchmark decodes frames, reports measured timing, and cannot pass without three reviewed captures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "capture-media-"));
  try {
    const media = join(directory, "sample.mp4");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x240:rate=12:duration=2",
      "-c:v",
      "libx264",
      "-y",
      media,
    ]);
    const report = await analyzeMedia(media, join(directory, "analysis"));
    assert.equal(report.frameCount, 24);
    assert.equal(report.width, 320);
    assert.equal(report.distinctFrames, 24);
    assert.ok(report.maxFrameGapMs < 85);
    assert.ok(
      (await readFile(join(directory, "analysis/sample-0.png"))).length > 100,
    );
    assert.equal(benchmarkGate([report]).passed, false);
    assert.equal(benchmarkGate([report, report, report]).passed, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("truncated media cannot pass verification using an incomplete decoded prefix", async () => {
  const directory = await mkdtemp(join(tmpdir(), "capture-truncated-"));
  try {
    const original = join(directory, "original.mp4");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x240:rate=12:duration=4",
      "-c:v",
      "libx264",
      "-movflags",
      "+faststart",
      "-g",
      "12",
      "-y",
      original,
    ]);
    const bytes = await readFile(original);
    const truncated = join(directory, "truncated.mp4");
    await writeFile(
      truncated,
      bytes.subarray(0, Math.floor(bytes.length * 0.55)),
    );
    await assert.rejects(analyzeMedia(truncated, join(directory, "analysis")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
