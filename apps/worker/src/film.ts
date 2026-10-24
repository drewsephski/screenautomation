import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CaptureManifest, DemoStory } from "@repo/contracts";
import { chromium } from "playwright";
const exec = promisify(execFile);

async function ffmpeg(args: string[]) {
  await exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    timeout: 180000,
    maxBuffer: 2 * 1024 * 1024,
  });
}
const encoding = [
  "-an",
  "-c:v",
  "libx264",
  "-preset",
  "veryfast",
  "-crf",
  "20",
  "-pix_fmt",
  "yuv420p",
  "-r",
  "30",
];
/** Deterministic edit from verified footage. No model calls or generated UI. */
export async function renderFilm(directory: string) {
  directory = resolve(directory);
  const manifest = CaptureManifest.parse(
    JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")),
  );
  if (manifest.status !== "verified")
    throw new Error("Film requires verified source capture");
  const source = join(directory, "browser.webm");
  const bytes = await readFile(source);
  if (
    createHash("sha256").update(bytes).digest("hex") !== manifest.media.sha256
  )
    throw new Error("Film source checksum mismatch");
  let story: DemoStory | undefined;
  try {
    story = DemoStory.parse(
      JSON.parse(await readFile(join(directory, "story.json"), "utf8")),
    );
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  const { stdout } = await exec(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "json", source],
    { timeout: 30000 },
  );
  const duration = Number(JSON.parse(stdout).format?.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 300)
    throw new Error("Unbounded film source");
  const work = join(directory, "film-edit");
  await mkdir(work, { recursive: true, mode: 0o700 });
  const chunks: string[] = [];
  const timeline: {
    kind: string;
    duration: number;
    sourceStart?: number;
    sourceEnd?: number;
    caption: string;
  }[] = [];
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  await page.route("**/*", (route) => route.abort());
  try {
    async function frame(
      name: string,
      title: string,
      subtitle = "",
      full = false,
    ) {
      await page.setContent(
        `<style>*{box-sizing:border-box}body{margin:0;background:#101318;color:white;font-family:Arial,sans-serif}.card{position:absolute;left:96px;top:370px;width:1500px}.accent{width:64px;height:6px;background:#8faaff;margin-bottom:48px}h1{font-size:54px;line-height:1.2;font-weight:500;max-width:1450px;margin:0 0 36px;overflow-wrap:anywhere}p{font-size:26px;line-height:1.5;color:#a9b0bf;max-width:1400px;margin:0}.caption{position:absolute;top:28px;left:96px;font-size:28px;max-width:1728px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}</style>${full ? '<div class="card"><div class="accent"></div><h1></h1><p></p></div>' : '<div class="caption"></div>'}`,
      );
      await page.evaluate(
        ({ title, subtitle, full }) => {
          document.querySelector(full ? "h1" : ".caption")!.textContent = title;
          if (full) document.querySelector("p")!.textContent = subtitle;
        },
        { title, subtitle, full },
      );
      const path = join(work, name + ".png");
      await page.screenshot({ path });
      return path;
    }
    async function card(
      name: string,
      title: string,
      subtitle: string,
      seconds: number,
    ) {
      const image = await frame(name, title, subtitle, true);
      const output = join(work, name + ".mp4");
      await ffmpeg([
        "-loop",
        "1",
        "-i",
        image,
        "-t",
        String(seconds),
        ...encoding,
        output,
      ]);
      chunks.push(output);
      timeline.push({ kind: "title", duration: seconds, caption: title });
    }
    async function footage(
      name: string,
      start: number,
      end: number,
      caption: string,
    ) {
      if (end - start < 0.2) return;
      const image = await frame(name, caption);
      const output = join(work, name + ".mp4");
      await ffmpeg([
        "-ss",
        String(start),
        "-i",
        source,
        "-loop",
        "1",
        "-i",
        image,
        "-t",
        String(end - start),
        "-filter_complex",
        "[0:v]scale=1728:972,setsar=1[screen];[1:v][screen]overlay=96:90:shortest=1[out]",
        "-map",
        "[out]",
        ...encoding,
        output,
      ]);
      chunks.push(output);
      timeline.push({
        kind: "source",
        duration: end - start,
        sourceStart: start,
        sourceEnd: end,
        caption,
      });
    }
    await card(
      "intro",
      story?.title ?? "One message. A real reply.",
      story?.summary ??
        "Recorded in the actual product. No simulated interface.",
      2.5,
    );
    if (story) {
      // Replayed tours deliberately dwell on each page. Preserve their order;
      // trim only a tail beyond the short-film budget.
      const limit = Math.min(duration, 18);
      for (const [index, scene] of story.scenes.entries()) {
        const event = manifest.events.find(
          (event) =>
            event.stepId === `scene-${index + 1}` && event.phase === "verified",
        );
        const start = Math.max(0, (event?.atMs ?? 0) / 1000 - 0.5);
        const end = Math.min(limit, start + 3.5);
        await footage(`scene-${index + 1}`, start, end, scene.caption);
      }
    } else {
      const sent = manifest.events.find(
        (event) => event.stepId === "send" && event.phase === "started",
      );
      const firstEnd = Math.min(
        duration,
        8,
        Math.max(3, (sent?.atMs ?? 3000) / 1000 + 0.7),
      );
      await footage("action", 0, firstEnd, "One message, sent once");
      await footage(
        "response",
        Math.max(firstEnd, duration - 5),
        duration,
        "Actual reply · waiting time shortened",
      );
    }
    const resultFrame = await frame(
      "result",
      story ? story.scenes.at(-1)!.caption : "The completed reply",
    );
    const result = join(work, "result.mp4");
    await ffmpeg([
      "-loop",
      "1",
      "-i",
      join(directory, "reply.png"),
      "-loop",
      "1",
      "-i",
      resultFrame,
      "-t",
      "7",
      "-filter_complex",
      "[0:v]scale=1728:972,setsar=1[screen];[1:v][screen]overlay=96:90:shortest=1[out]",
      "-map",
      "[out]",
      ...encoding,
      result,
    ]);
    chunks.push(result);
    timeline.push({
      kind: "verified-still",
      duration: 7,
      caption: story?.scenes.at(-1)?.caption ?? "The completed reply",
    });
    await card(
      "outro",
      "See the product in action.",
      "Authentic screen capture · edited by Screen Studio",
      2.5,
    );
    const list = join(work, "concat.txt");
    await writeFile(
      list,
      chunks
        .map((path) => `file '${path.replaceAll("'", "'\\''")}'`)
        .join("\n"),
    );
    const output = join(directory, "film.mp4");
    await ffmpeg([
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      list,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      output,
    ]);
    const { stdout: probe } = await exec(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,codec_name:format=duration",
        "-of",
        "json",
        output,
      ],
      { timeout: 30000 },
    );
    const media = JSON.parse(probe);
    const seconds = Number(media.format?.duration);
    if (
      seconds < 15 ||
      seconds > 30 ||
      media.streams?.[0]?.width !== 1920 ||
      media.streams?.[0]?.height !== 1080
    )
      throw new Error("Film failed duration or resolution checks");
    await ffmpeg(["-xerror", "-i", output, "-f", "null", "-"]);
    const report = {
      schemaVersion: 1,
      path: "film.mp4",
      status: "verified",
      durationSeconds: seconds,
      width: 1920,
      height: 1080,
      sha256: createHash("sha256")
        .update(await readFile(output))
        .digest("hex"),
      sourceSha256: manifest.media.sha256,
      timeline,
      limitations: [
        "Silent film; no generated product UI.",
        "Event-to-frame alignment remains approximate and requires review.",
        "Captions and publication readiness require owner review.",
      ],
    };
    await writeFile(
      join(directory, "film.json"),
      JSON.stringify(report, null, 2),
    );
    await rm(work, { recursive: true, force: true });
    return report;
  } finally {
    await browser.close();
  }
}
