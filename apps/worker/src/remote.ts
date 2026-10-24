import {
  readFile,
  writeFile,
  mkdir,
  rm,
  access,
  rename,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { chromium, type Page } from "playwright";
import { CaptureManifest } from "@repo/contracts";
import { SignInFailure, signInWithCredentials } from "./authenticate.ts";
import { originAllowed, startEgressProxy } from "./proxy.ts";
import { armReplyCompletion, waitForCompletedReply } from "./completion.ts";
import { startBrowserRecording } from "./recording.ts";

interface Config {
  url: string;
  chatUrl?: string;
  message: string;
  width: number;
  height: number;
  image: string;
  origins: string[];
  destinations: Record<string, string[]>;
}
const root = "/tmp/screen-studio";
/** A failure reason written by us for the run owner; never page text. */
class StepFailure extends Error {}
const config: Config = JSON.parse(
  await readFile(`${root}/config.json`, "utf8"),
);
const mode = process.argv[2];
const proxy = await startEgressProxy(config.destinations);
const browser = await chromium.launch({
  proxy: { server: proxy.url, bypass: "<-loopback>" },
  headless: false,
  args: [
    "--kiosk",
    `--window-size=${config.width},${config.height}`,
    "--force-device-scale-factor=1",
    "--disable-quic",
    "--disable-http2",
    "--disable-extensions",
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
  ],
});
const context = await browser.newContext({
  viewport: { width: config.width, height: config.height },
  deviceScaleFactor: 1,
  locale: "en-US",
  timezoneId: "UTC",
  serviceWorkers: "block",
  acceptDownloads: false,
  ...(mode === "capture" ? { storageState: `${root}/state.json` } : {}),
});
await context.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (
    !["https:"].includes(url.protocol) ||
    !originAllowed(url.origin, config.origins)
  )
    return route.abort("blockedbyclient");
  await route.continue();
});
await context.routeWebSocket("**/*", (socket) => {
  const url = new URL(socket.url());
  if (originAllowed(`https://${url.host}`, config.origins))
    socket.connectToServer();
  else socket.close();
});
context.on("page", (popup) => {
  if (context.pages().length > 1) void popup.close();
});
const page = await context.newPage();
page.setDefaultTimeout(20_000);
page.setDefaultNavigationTimeout(30_000);
// The worker relays this status and desktop frames to the owner's live preview.
let step = "Starting the browser";
let codeRequests = 0;
let writes = 0;
async function status(
  label: string,
  state: "running" | "needs-code" | "failed" = "running",
  extra: Record<string, unknown> = {},
) {
  step = label;
  let url: string | null = null;
  try {
    const current = new URL(page.url());
    if (current.protocol === "https:") url = current.origin + current.pathname;
  } catch {
    // about:blank before the first navigation.
  }
  const temporary = `${root}/status.${++writes}.tmp`;
  await writeFile(
    temporary,
    JSON.stringify({ mode, step, state, url, codeRequests, ...extra }),
  );
  await rename(temporary, `${root}/status.json`);
}
page.on("framenavigated", (frame) => {
  if (frame === page.mainFrame()) void status(step).catch(() => undefined);
});
async function requestCode(kind: "email" | "authenticator") {
  codeRequests++;
  await rm(`${root}/code.json`, { force: true });
  await status(step, "needs-code", { codeKind: kind });
  const deadline = Date.now() + 5 * 60_000;
  for (;;) {
    try {
      const { code } = JSON.parse(await readFile(`${root}/code.json`, "utf8"));
      await rm(`${root}/code.json`);
      if (typeof code !== "string") throw new StepFailure("Invalid code");
      await status(step);
      return code;
    } catch (error) {
      if (error instanceof StepFailure) throw error;
      if (Date.now() > deadline)
        throw new StepFailure(
          "No verification code was entered within 5 minutes. Start a new capture when you can check the code.",
        );
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}
await status(
  mode === "login" ? "Opening the browser" : "Reopening the browser",
);
const output = `${root}/output`;
await mkdir(output, { recursive: true, mode: 0o700 });
let recording = false;
async function chatPage(page: Page) {
  const krafty = new URL(config.url).hostname === "kraftybot.app";
  await status(config.chatUrl ? "Opening your chat" : "Opening your workspace");
  await page.goto(
    config.chatUrl ??
      (krafty ? `${new URL(config.url).origin}/workspace` : config.url),
    { waitUntil: "domcontentloaded" },
  );
  if (new URL(page.url()).origin !== new URL(config.url).origin)
    throw new StepFailure(
      "The chat page redirected to a different website. Check the chat URL.",
    );
  if (krafty && !config.chatUrl) {
    await page.waitForURL("**/workspace**", { timeout: 30000 }).catch(() => {
      throw new StepFailure(
        "Signed in, but the Krafty workspace didn't open. Try again, or paste a chat URL.",
      );
    });
    await status("Finding an existing chat");
    const chat = page.locator('a[href^="/chats/"][aria-label^="Open "]');
    await chat
      .first()
      .waitFor({ state: "visible" })
      .catch(() => {
        throw new StepFailure(
          "Signed in, but no existing chat was found in this Krafty workspace. Start one conversation in Krafty first, or paste its chat URL.",
        );
      });
    // Open an existing conversation; never create a bot or change server state.
    await status("Opening an existing chat");
    await chat.first().click();
  }
  await status("Finding the message box");
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .waitFor({ state: "visible" })
    .catch(async () => {
      if (await page.locator('input[type="password"]').isVisible())
        throw new StepFailure(
          "The site asked to sign in again before the chat opened.",
        );
      throw new StepFailure(
        "The chat opened, but no message box labelled “Message” was found. Paste the exact chat URL and try again.",
      );
    });
  if (await page.locator('input[type="password"]').isVisible())
    throw new StepFailure("The session expired before the capture started.");
}
try {
  if (mode === "login") {
    const credentials: { email: string; password: string } = JSON.parse(
      await readFile(`${root}/credentials.json`, "utf8"),
    );
    await rm(`${root}/credentials.json`);
    await signInWithCredentials(page, config.url, credentials, {
      step: (label) => status(label),
      requestCode,
    });
    await chatPage(page);
    await status("Signed in and ready");
    await context.storageState({ path: `${root}/state.json` });
    const { chmod } = await import("node:fs/promises");
    await chmod(`${root}/state.json`, 0o600);
    await writeFile(`${root}/ready.json`, JSON.stringify({ ready: true }));
  } else if (mode === "capture") {
    await chatPage(page);
    await status("Ready to record");
    await writeFile(
      `${root}/capture-ready.json`,
      JSON.stringify({ ready: true }),
    );
    const startDeadline = Date.now() + 60000;
    for (;;) {
      try {
        await access(`${root}/capture-start`);
        break;
      } catch {
        if (Date.now() > startDeadline)
          throw new Error("Capture start deadline expired");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    const composer = page.getByRole("textbox", {
      name: "Message",
      exact: true,
    });
    const submit = page.getByRole("button", {
      name: /^(submit|send|send message)$/i,
    });
    const replies = page.locator(
      '.is-assistant, [data-message-author-role="assistant"], [data-role="assistant"]',
    );
    const before = await replies.count();
    await submit.waitFor({ state: "visible" });
    const startedAt = new Date().toISOString();
    const start = performance.now();
    const cpu = process.cpuUsage();
    const events: CaptureManifest["events"] = [];
    const evidence: CaptureManifest["evidence"] = [];
    const browserRecording = await startBrowserRecording(page, {
      path: `${output}/browser.webm`,
      size: { width: config.width, height: config.height },
      eventOriginMonotonicMs: start,
    });
    recording = true;
    const recordingStartedAt = new Date().toISOString();
    async function event(
      stepId: string,
      phase: "started" | "verified",
      target: ReturnType<Page["locator"]>,
      screenshot?: string,
    ) {
      const box = await target.boundingBox({ timeout: 1000 }).catch(() => null);
      const scroll = await page.evaluate(() => ({
        x: window.scrollX,
        y: window.scrollY,
      }));
      const atMs = performance.now() - start;
      events.push({
        stepId,
        attempt: 0,
        phase,
        atMs,
        coordinateSpace: "viewport-css-pixels",
        box,
        scroll,
        screenshot,
      });
      if (screenshot) evidence.push({ stepId, atMs, screenshot });
    }
    await status("Typing your message");
    await event("type", "started", composer);
    await composer.fill("");
    await composer.pressSequentially(config.message, {
      delay: 25,
      timeout: 40000,
    });
    await event("type", "verified", composer);
    await event("send", "started", submit);
    await armReplyCompletion(page);
    await submit.click(); // Never retried, including on an uncertain network failure.
    await status("Waiting for the reply");
    await waitForCompletedReply(page, before).catch(() => {
      throw new StepFailure(
        "The message was sent, but no completed reply appeared within two minutes. Review the chat before sending again.",
      );
    });
    await status("Saving the take");
    const reply = replies.last();
    await reply.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/reply.png` });
    await event("send", "verified", reply, "reply.png");
    const frameTiming = await browserRecording.stop();
    recording = false;
    await writeFile(
      `${root}/capture-finalized.json`,
      JSON.stringify({ finalized: true }),
    );
    await context.close(); // Finalize before checksums, uploads, or sandbox deletion.
    const media = await readFile(`${output}/browser.webm`);
    const usage = process.cpuUsage(cpu);
    const manifest = CaptureManifest.parse({
      schemaVersion: 1,
      attemptId: "capture",
      workflowId: "login-chat",
      workflowRevision: "1",
      status: "verified",
      startedAt,
      elapsedMs: performance.now() - start,
      environment: {
        browser: browser.version(),
        playwright: "1.64.1",
        node: process.version,
        platform: process.platform,
        image: config.image,
        locale: "en-US",
        timezone: "UTC",
        viewport: { width: config.width, height: config.height },
        deviceScaleFactor: 1,
        headless: false,
      },
      media: {
        path: "browser.webm",
        sha256: createHash("sha256").update(media).digest("hex"),
        bytes: media.length,
        recordingStartedAt,
        requestedFps: 60,
        frameTiming,
      },
      events,
      evidence,
      resources: {
        userCpuMs: usage.user / 1000,
        systemCpuMs: usage.system / 1000,
        maxRssKb: process.resourceUsage().maxRSS,
        scope: "worker-process-only",
      },
    });
    await writeFile(
      `${output}/manifest.json`,
      JSON.stringify(manifest, null, 2),
    );
  } else throw new Error("Unknown mode");
} catch (error) {
  // Browser exceptions can contain input values and page text. Never serialize
  // them; only our own reasons and the step name reach the run owner.
  const reason =
    error instanceof SignInFailure || error instanceof StepFailure
      ? error.message
      : error instanceof Error && error.name === "TimeoutError"
        ? `The page didn't respond in time while: ${step.toLowerCase()}.`
        : `The browser stopped while: ${step.toLowerCase()}.`;
  // Keep the screen that explains the failure for the owner's preview.
  await page
    .screenshot({ path: `${root}/failure.jpg`, type: "jpeg", quality: 60 })
    .catch(() => undefined);
  await writeFile(
    `${root}/failure.json`,
    JSON.stringify({ stage: mode, step, error: reason }),
  );
  await status(step, "failed").catch(() => undefined);
  process.exitCode = 1;
} finally {
  if (recording) await page.screencast.stop().catch(() => undefined);
  await context.close().catch(() => undefined);
  await browser.close();
  await proxy.close();
  if (mode === "capture")
    await writeFile(
      `${root}/capture-done.json`,
      JSON.stringify({ exitCode: process.exitCode ?? 0 }),
    );
}
