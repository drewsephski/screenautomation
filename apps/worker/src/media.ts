import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, stat, writeFile } from "node:fs/promises";
const exec = promisify(execFile);

export interface MediaReport {
  width: number;
  height: number;
  codec: string;
  durationSeconds: number;
  frameCount: number;
  distinctFrames: number;
  adjacentChanges: number;
  maxFrameGapMs: number;
  averageFps: string;
  humanReview: "pending";
  limitations: string[];
}
export async function analyzeMedia(
  path: string,
  directory: string,
): Promise<MediaReport> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const { stdout, stderr: probeErrors } = await exec(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_streams",
      "-show_format",
      "-show_frames",
      "-show_entries",
      "frame=best_effort_timestamp_time:stream=width,height,codec_name,avg_frame_rate:format=duration",
      "-of",
      "json",
      path,
    ],
    { maxBuffer: 64 * 1024 * 1024, timeout: 120000 },
  );
  if (probeErrors.trim())
    throw new Error("Media probe reported decoding errors");
  await writeFile(`${directory}/ffprobe.json`, stdout);
  const probe: {
    streams?: {
      width: number;
      height: number;
      codec_name: string;
      avg_frame_rate: string;
    }[];
    format?: { duration: string };
    frames?: { best_effort_timestamp_time?: string }[];
  } = JSON.parse(stdout);
  const stream = probe.streams?.[0];
  const duration = Number(probe.format?.duration);
  const times =
    probe.frames?.map((frame) => Number(frame.best_effort_timestamp_time)) ??
    [];
  if (
    !stream ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 600 ||
    !times.length ||
    times.some((time) => !Number.isFinite(time))
  )
    throw new Error("Invalid or unbounded media");
  const { stdout: hashes, stderr: decodeErrors } = await exec(
    "ffmpeg",
    [
      "-v",
      "error",
      "-xerror",
      "-err_detect",
      "explode",
      "-i",
      path,
      "-map",
      "0:v:0",
      "-f",
      "framemd5",
      "-",
    ],
    { maxBuffer: 32 * 1024 * 1024, timeout: 180000 },
  );
  if (decodeErrors.trim()) throw new Error("Media decode was incomplete");
  await writeFile(`${directory}/frames.md5`, hashes);
  const frames = hashes
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split(",").at(-1)!.trim());
  if (frames.length !== times.length)
    throw new Error("Decoded frame count mismatch");
  const gaps = times
    .slice(1)
    .map((time, index) => (time - times[index]!) * 1000);
  if (gaps.some((gap) => gap < 0))
    throw new Error("Non-monotonic media timestamps");
  const report: MediaReport = {
    width: stream.width,
    height: stream.height,
    codec: stream.codec_name,
    durationSeconds: duration,
    frameCount: frames.length,
    distinctFrames: new Set(frames).size,
    adjacentChanges: frames.filter(
      (hash, index) => index > 0 && hash !== frames[index - 1],
    ).length,
    maxFrameGapMs: Math.max(0, ...gaps),
    averageFps: stream.avg_frame_rate,
    humanReview: "pending",
    limitations: [
      "Encoded timestamps do not prove distinct browser presentations.",
      "Readability, cursor, chrome, sensitive regions, and event synchronization require human review.",
      "Worker CPU excludes Chromium, the desktop recorder, and provider overhead.",
    ],
  };
  for (const [index, time] of [
    0,
    duration / 3,
    (2 * duration) / 3,
    Math.max(0, duration - 0.2),
  ].entries()) {
    const sample = `${directory}/sample-${index}.png`;
    const { stderr: sampleErrors } = await exec(
      "ffmpeg",
      [
        "-v",
        "error",
        "-xerror",
        "-err_detect",
        "explode",
        "-ss",
        String(time),
        "-i",
        path,
        "-frames:v",
        "1",
        "-y",
        sample,
      ],
      { timeout: 30000 },
    );
    if (sampleErrors.trim() || (await stat(sample)).size < 8)
      throw new Error("Required frame sample is missing or invalid");
  }
  await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2));
  return report;
}
export function benchmarkGate(reports: MediaReport[]) {
  return {
    passed:
      reports.length >= 3 &&
      reports
        .slice(-3)
        .every(
          (report) =>
            report.width === 1920 &&
            report.height === 1080 &&
            report.distinctFrames > 1 &&
            (report.humanReview as string) === "approved",
        ),
    reason:
      "Three consecutive verified captures plus approved readability, output completeness, synchronization, and privacy review are required. Provider cost is recorded separately; no capture path is selected automatically.",
  };
}
