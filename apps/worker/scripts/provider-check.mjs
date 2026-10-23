import {
  Daytona,
  DaytonaNotFoundError,
  DaytonaGoneError,
} from "@daytonaio/sdk";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { analyzeMedia } from "../src/media.ts";

const { values } = parseArgs({
  options: {
    snapshot: { type: "string" },
    output: { type: "string", default: "../../artifacts/provider-check" },
  },
});
if (!values.snapshot || !process.env.DAYTONA_API_KEY)
  throw new Error("Set DAYTONA_API_KEY and pass --snapshot <versioned-name>.");
const output = resolve(values.output);
await mkdir(output, { recursive: true, mode: 0o700 });
const client = new Daytona({
  apiKey: process.env.DAYTONA_API_KEY,
  otelEnabled: false,
  requestTimeoutMs: 30000,
});
const report = {
  purpose: "synthetic-provider-preflight-not-product-evidence",
  snapshot: values.snapshot,
  startedAt: new Date().toISOString(),
  sandboxId: null,
  cleanupVerified: false,
};
let sandbox;
let recordingId;
let failure;
async function cleanupSandbox() {
  if (sandbox) {
    if (recordingId)
      await sandbox.computerUse.recording
        .stop(recordingId)
        .catch(() => undefined);
    await client.delete(sandbox, 30, true);
    try {
      await client.get(sandbox.id);
      throw new Error("Sandbox still exists after deletion");
    } catch (error) {
      if (!(
        error instanceof DaytonaNotFoundError ||
        error instanceof DaytonaGoneError
      ))
        throw error;
    }
    report.cleanupVerified = true;
  }
}

try {
  sandbox = await client.create(
    {
      snapshot: values.snapshot,
      name: `screen-studio-check-${Date.now()}`,
      public: false,
      networkBlockAll: true,
      autoStopInterval: 5,
      autoDeleteInterval: 0,
      ttlMinutes: 10,
      labels: { app: "screen-studio", purpose: "provider-check" },
      envVars: {
        DISPLAY: ":0",
        VNC_RESOLUTION: "1920x1080",
        TZ: "UTC",
        LANG: "en_US.UTF-8",
      },
    },
    { timeout: 90 },
  );
  report.sandboxId = sandbox.id;
  await writeFile(
    join(output, "provider.json"),
    JSON.stringify(report, null, 2),
  );
  await sandbox.computerUse.start();
  const display = await sandbox.computerUse.display.getInfo();
  if (
    !display.displays?.some(
      (item) => item.isActive && item.width === 1920 && item.height === 1080,
    )
  )
    throw new Error("Unexpected desktop resolution");
  const source = `import {chromium} from 'playwright';
import {writeFile,access} from 'node:fs/promises';
const browser=await chromium.launch({headless:false,args:['--kiosk','--window-size=1920,1080']});
const context=await browser.newContext({viewport:{width:1920,height:1080},locale:'en-US',timezoneId:'UTC',deviceScaleFactor:1});
const page=await context.newPage();
await page.setContent('<style>body{margin:0;padding:100px;font:24px "DejaVu Sans";background:#f4f6fa;color:#17243b}small{font-size:12px}textarea{display:block;width:900px;height:140px;font:24px "DejaVu Sans";margin:32px 0}.cursor{position:absolute;width:18px;height:18px;border-radius:50%;background:#345ce7;animation:move 4s linear infinite}@keyframes move{from{transform:translateX(0)}to{transform:translateX(1000px)}}</style><h1>Capture measurement fixture</h1><p>SYNTHETIC FIXTURE — NEVER PRODUCT FOOTAGE</p><small>Small text readability: Aa Bb 0123456789, 12px</small><textarea aria-label="Message"></textarea><output></output><div class="cursor"></div>');
await writeFile('/tmp/provider-ready','ready');
const deadline=Date.now()+45000;
for(;;){try{await access('/tmp/provider-start');break;}catch{if(Date.now()>deadline)throw new Error('Start timeout');await new Promise(r=>setTimeout(r,100));}}
await page.screencast.start({path:'/tmp/browser.webm',size:{width:1920,height:1080},fps:60});
await page.getByRole('textbox',{name:'Message'}).pressSequentially('Measure real browser typing and source frame timing.',{delay:35});
for(const word of 'This is a deterministic streaming measurement. It is not an AI response or real product output.'.split(' ')){await page.locator('output').evaluate((node,word)=>node.textContent+=' '+word,word);await new Promise(r=>setTimeout(r,70));}
await page.screenshot({path:'/tmp/provider.png'});
await page.screencast.stop();
await writeFile('/tmp/provider-finalized','done');
await context.close();
await browser.close();
await writeFile('/tmp/provider-done.json',JSON.stringify({browser:browser.version(),node:process.version,playwright:'1.64.1'}));`;
  await sandbox.fs.uploadFile(
    Buffer.from(source),
    "/opt/capture/provider-check.mjs",
  );
  await sandbox.process.createSession("provider-check");
  const command = await sandbox.process.executeSessionCommand(
    "provider-check",
    {
      command: "cd /opt/capture && node provider-check.mjs",
      runAsync: true,
      suppressInputEcho: true,
    },
    30,
  );
  async function waitFor(path) {
    const deadline = Date.now() + 45000;
    for (;;) {
      const state = await sandbox.process.getSessionCommand(
        "provider-check",
        command.cmdId,
      );
      if (state.exitCode !== undefined && state.exitCode !== 0)
        throw new Error(
          "Browser preflight process failed. Inspect its private sandbox log before cleanup.",
        );
      const found = await sandbox.process.executeCommand(
        `test -f ${path}`,
        "/opt/capture",
        undefined,
        5,
      );
      if (found.exitCode === 0) return;
      if (Date.now() > deadline)
        throw new Error("Browser preflight deadline exceeded");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  await waitFor("/tmp/provider-ready");
  const recording = await sandbox.computerUse.recording.start("provider-check");
  recordingId = recording.id;
  await sandbox.fs.uploadFile(Buffer.from("start"), "/tmp/provider-start");
  await waitFor("/tmp/provider-finalized");
  await sandbox.computerUse.recording.stop(recordingId);
  await sandbox.computerUse.recording.download(
    recordingId,
    join(output, "desktop.mp4"),
  );
  recordingId = undefined;
  await waitFor("/tmp/provider-done.json");
  for (const name of ["browser.webm", "provider.png", "provider-done.json"])
    await sandbox.fs.downloadFile(`/tmp/${name}`, join(output, name));
  const browser = await analyzeMedia(
    join(output, "browser.webm"),
    join(output, "browser-analysis"),
  );
  const desktop = await analyzeMedia(
    join(output, "desktop.mp4"),
    join(output, "desktop-analysis"),
  );
  await writeFile(
    join(output, "comparison.json"),
    JSON.stringify(
      {
        purpose: report.purpose,
        display,
        browser,
        desktop,
        gate: "not-a-real-product-capture",
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      status: "recordings-decoded",
      sandboxId: sandbox.id,
      browser: {
        width: browser.width,
        height: browser.height,
        frames: browser.frameCount,
      },
      desktop: {
        width: desktop.width,
        height: desktop.height,
        frames: desktop.frameCount,
      },
    }),
  );
} catch (error) {
  failure = error;
  if (sandbox) {
    try {
      const session = await sandbox.process.getSession("provider-check");
      for (const command of session.commands ?? []) {
        const logs = await sandbox.process.getSessionCommandLogs(
          "provider-check",
          command.id,
        );
        await writeFile(join(output, "browser-process.log"), logs.output ?? "");
      }
    } catch {
      /* A missing session is expected if provisioning failed. */
    }
  }
} finally {
  try {
    await cleanupSandbox();
  } catch (error) {
    failure = failure
      ? new AggregateError(
          [failure, error],
          "Provider check and cleanup both failed",
        )
      : error;
  }
  report.finishedAt = new Date().toISOString();
  await writeFile(
    join(output, "provider.json"),
    JSON.stringify(report, null, 2),
  );
}

if (failure) {
  console.error(
    JSON.stringify({
      status: "failed",
      type: failure.constructor.name,
      message: String(failure.message)
        .replaceAll(process.env.DAYTONA_API_KEY, "[redacted]")
        .slice(0, 600),
    }),
  );
  process.exitCode = 1;
}
