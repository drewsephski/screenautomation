import { Daytona, type Sandbox } from "@daytonaio/sdk";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decryptCredentials,
  openCode,
  publicAddresses,
  type StoredRun,
  type RunStore,
} from "@repo/jobs";
import { CaptureManifest } from "@repo/contracts";
import { captureLifecycle } from "./lifecycle.ts";
import { CaptureFailure } from "./failure.ts";
import { createClaudeNavigator } from "./claude.ts";
import { NavigationObservation } from "./navigation-contract.ts";

const root = "/tmp/screen-studio";
interface RemoteStatus {
  mode: "login" | "capture";
  step: string;
  state: "running" | "needs-code" | "failed";
  url: string | null;
  codeRequests: number;
  codeKind?: "email" | "authenticator";
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function captureRun(
  run: StoredRun,
  store: RunStore,
  daytona: Daytona,
  s3: S3Client,
  progress: { phase: string } = { phase: "provisioning" },
) {
  // Validate opt-in configuration before allocating a billable sandbox.
  const navigator = run.chat_url
    ? undefined
    : createClaudeNavigator(new URL(run.url).origin, run.message);
  const navigationAbort = new AbortController();
  const directory = await mkdtemp(join(tmpdir(), "screen-studio-"));
  let sandbox: Sandbox | undefined;
  let recordingId: string | undefined;
  let aborted = false;
  let heartbeatRunning = false;
  const heartbeat = setInterval(async () => {
    if (heartbeatRunning) return;
    heartbeatRunning = true;
    try {
      if (!(await store.heartbeat(run.id))) {
        aborted = true;
        navigationAbort.abort();
        if (sandbox) await daytona.delete(sandbox, 30, true);
      }
    } catch {
      aborted = true;
      navigationAbort.abort();
    } finally {
      heartbeatRunning = false;
    }
  }, 10000);
  // Live preview: relay the desktop and the browser's current step to the owner.
  let desktopReady = false;
  let monitoring = true;
  let navigationHandled: string | undefined;
  const navigationMonitor = (async () => {
    while (monitoring) {
      if (navigator && sandbox && desktopReady && !aborted) {
        let request: unknown;
        try {
          request = JSON.parse(
            (
              await sandbox.fs.downloadFile(
                `${root}/navigation-request.json`,
                10,
              )
            ).toString(),
          );
        } catch {
          // No discovery request yet. Atomic publication prevents partial JSON.
        }
        if (request) {
          const parsed = NavigationObservation.safeParse(request);
          if (parsed.success && parsed.data.id !== navigationHandled) {
            navigationHandled = parsed.data.id;
            let decision;
            let error: string | undefined;
            try {
              decision = await navigator.decide(
                parsed.data,
                navigationAbort.signal,
              );
            } catch {
              error =
                "Claude navigation failed; check API access and run limits.";
            }
            if (monitoring && !aborted) {
              await sandbox.fs.uploadFile(
                Buffer.from(
                  JSON.stringify({ id: navigationHandled, decision, error }),
                ),
                `${root}/navigation-response.tmp`,
              );
              await sandbox.process.executeCommand(
                `mv ${root}/navigation-response.tmp ${root}/navigation-response.json`,
                "/opt/capture",
                undefined,
                10,
              );
            }
          }
        }
      }
      await sleep(500);
    }
  })().catch(() => {
    navigationAbort.abort();
    console.error(
      JSON.stringify({
        event: "claude_navigation_transport_failed",
        runId: run.id,
      }),
    );
  });
  let live: RemoteStatus | undefined;
  async function readStatus() {
    try {
      live = JSON.parse(
        (await sandbox!.fs.downloadFile(`${root}/status.json`, 10)).toString(),
      );
    } catch {
      // Not written yet, or mid-replacement; keep the previous status.
    }
    return live;
  }
  const monitor = (async () => {
    while (monitoring) {
      const started = Date.now();
      if (sandbox && desktopReady && !aborted)
        try {
          await readStatus();
          const shot = await sandbox.computerUse.screenshot.takeCompressed({
            format: "jpeg",
            quality: 60,
            scale: 0.5,
            showCursor: true,
          });
          if (monitoring && shot.screenshot)
            await store.saveFrame(
              run.id,
              Buffer.from(shot.screenshot, "base64"),
              live?.step ?? "Desktop ready",
              live?.url ?? null,
            );
        } catch {
          // A missed frame only delays the preview.
        }
      await sleep(Math.max(300, 1200 - (Date.now() - started)));
    }
  })();
  /** Stop the preview on the browser's own failure screen and return its reason. */
  async function remoteFailure() {
    monitoring = false;
    let reason: string | undefined;
    try {
      const failure = JSON.parse(
        (await sandbox!.fs.downloadFile(`${root}/failure.json`, 10)).toString(),
      );
      if (typeof failure.error === "string") reason = failure.error;
      const image = await sandbox!.fs.downloadFile(`${root}/failure.jpg`, 20);
      await store.saveFrame(
        run.id,
        image,
        failure.step ?? null,
        live?.url ?? null,
      );
    } catch {
      // Fall back to the phase explanation.
    }
    return reason ? new CaptureFailure(reason) : undefined;
  }
  async function checkpoint(
    status: Parameters<RunStore["update"]>[1],
    detail: string,
  ) {
    progress.phase = status;
    if (aborted || !(await store.update(run.id, status, detail, sandbox?.id)))
      throw new Error("Run cancelled or lease lost");
  }
  async function execute(command: string, timeout = 60) {
    if (aborted) throw new Error("Run cancelled");
    const result = await sandbox!.process.executeCommand(
      command,
      "/opt/capture",
      { DISPLAY: ":0" },
      timeout,
    );
    if (result.exitCode !== 0) throw new Error("Browser operation failed");
  }
  try {
    return await captureLifecycle({
      capture: async () => {
        // Resolve and pin public IPs at the sandbox network boundary, including
        // identity subresources. DNS changes cannot widen this CIDR allowlist.
        const targetOrigin = new URL(run.url).origin;
        const targets = (
          process.env.ALLOWED_TARGET_ORIGINS ?? "https://kraftybot.app"
        ).split(",");
        if (!targets.includes(targetOrigin))
          throw new Error("Target is not enabled");
        const configured = (
          process.env.BROWSER_ALLOWED_ORIGINS ??
          "https://kraftybot.app,https://clerk.kraftybot.app,https://img.clerk.com,https://api.trigger.dev,https://cdn.protect.clerk.com,https://*.client.protect.clerk.com"
        ).split(",");
        const origins = [...new Set([targetOrigin, ...configured])];
        progress.phase = "network";
        const destinations = Object.fromEntries(
          await Promise.all(
            origins.map(
              async (origin) =>
                [
                  origin,
                  // A wildcard is pinned to what one generated hostname resolves to.
                  (
                    await publicAddresses(
                      origin.replace(
                        "https://*.",
                        `https://probe-${randomBytes(6).toString("hex")}.`,
                      ),
                    )
                  )
                    .filter((cidr) => !cidr.includes(":"))
                    .map((cidr) => cidr.split("/")[0]!),
                ] as const,
            ),
          ),
        );
        const cidrs = [
          ...new Set(
            Object.values(destinations)
              .flat()
              .map((address) => `${address}/32`),
          ),
        ];
        if (!cidrs.length || cidrs.length > 10)
          throw new CaptureFailure(
            `The approved origins resolve to ${cidrs.length} addresses; the browser firewall allows at most ten. Ask the studio owner to reduce BROWSER_ALLOWED_ORIGINS.`,
          );
        progress.phase = "provisioning";
        if (!run.credentials)
          throw new CaptureFailure(
            "The sign-in details expired before a browser was free. Start a new capture.",
          );
        const credentials = decryptCredentials(
          run.credentials,
          run.id,
          process.env.CREDENTIAL_ENCRYPTION_KEY!,
        );
        const beforeCreate = Date.now();
        sandbox = await daytona.create(
          {
            snapshot: process.env.DAYTONA_SNAPSHOT!,
            name: `capture-${run.id}`,
            public: false,
            networkAllowList: cidrs.join(","),
            autoStopInterval: 5,
            autoDeleteInterval: 0,
            // Room for a verification code: login may wait five minutes for the owner.
            ttlMinutes: 25,
            labels: { app: "screen-studio", run: run.id },
            envVars: {
              VNC_RESOLUTION: "1920x1080",
              DISPLAY: ":0",
              TZ: "UTC",
              LANG: "en_US.UTF-8",
            },
          },
          { timeout: 90 },
        );
        await checkpoint(
          "logging_in",
          "Signing in. Recording has not started.",
        );
        await execute(
          "mkdir -p /tmp/screen-studio/output && chmod 700 /tmp/screen-studio /tmp/screen-studio/output",
        );
        await sandbox.fs.uploadFile(
          new URL("../dist/remote.mjs", import.meta.url).pathname,
          "/opt/capture/remote.mjs",
        );
        await sandbox.fs.uploadFile(
          new URL("../dist/remote-analysis.mjs", import.meta.url).pathname,
          "/opt/capture/remote-analysis.mjs",
        );
        await sandbox.fs.uploadFile(
          Buffer.from(
            JSON.stringify({
              url: run.url,
              chatUrl: run.chat_url ?? undefined,
              message: run.message,
              width: 1920,
              height: 1080,
              image: process.env.DAYTONA_SNAPSHOT,
              origins,
              destinations,
              claudeNavigation: !!navigator,
            }),
          ),
          "/tmp/screen-studio/config.json",
        );
        await sandbox.fs.uploadFile(
          Buffer.from(JSON.stringify(credentials)),
          "/tmp/screen-studio/credentials.json",
        );
        credentials.email = "";
        credentials.password = "";
        await execute(
          "chmod 600 /tmp/screen-studio/credentials.json /tmp/screen-studio/config.json",
        );
        await sandbox.computerUse.start();
        const display = await sandbox.computerUse.display.getInfo();
        if (
          !display.displays?.some(
            (item) =>
              item.isActive && item.width === 1920 && item.height === 1080,
          )
        )
          throw new Error("Unexpected desktop dimensions");
        desktopReady = true;
        await sandbox.process.createSession("login");
        const login = await sandbox.process.executeSessionCommand(
          "login",
          {
            command: "cd /opt/capture && node remote.mjs login",
            runAsync: true,
            suppressInputEcho: true,
          },
          30,
        );
        // Sign-in may pause for a one-time code the owner types into the studio.
        let handledRequests = 0;
        let asked = false;
        const loginDeadline = Date.now() + 8 * 60_000;
        for (;;) {
          if (aborted) throw new Error("Run cancelled");
          if (Date.now() > loginDeadline)
            throw new CaptureFailure(
              "Sign-in took longer than eight minutes and was stopped.",
            );
          const state = await sandbox.process.getSessionCommand(
            "login",
            login.cmdId!,
          );
          if (state.exitCode !== undefined && state.exitCode !== null) {
            if (state.exitCode === 0) break;
            throw (
              (await remoteFailure()) ??
              new CaptureFailure(
                "Sign-in stopped unexpectedly. Check the last screen in the live preview, then try again.",
              )
            );
          }
          const current = await readStatus();
          if (
            current?.state === "needs-code" &&
            current.codeRequests > handledRequests &&
            !asked
          ) {
            asked = await store.requestCode(
              run.id,
              current.codeKind === "authenticator"
                ? "Enter the code from your authenticator app to finish signing in."
                : "The site emailed you a verification code. Enter it here to finish signing in.",
            );
          }
          if (asked) {
            const sealed = await store.takeCode(run.id);
            if (sealed) {
              await sandbox.fs.uploadFile(
                Buffer.from(
                  JSON.stringify({
                    code: openCode(
                      sealed,
                      run.id,
                      process.env.CREDENTIAL_ENCRYPTION_KEY!,
                    ),
                  }),
                ),
                `${root}/code.json`,
              );
              handledRequests = current?.codeRequests ?? handledRequests + 1;
              asked = false;
            }
          }
          await sleep(1000);
        }
        await store.clearCredentials(run.id);
        if (navigator) {
          await sandbox.fs.uploadFile(
            Buffer.from(JSON.stringify(navigator.usage, null, 2)),
            `${root}/output/claude-usage.json`,
          );
        }
        await checkpoint(
          "rehearsing",
          "Login verified. Preparing a fresh browser context.",
        );
        await sandbox.process.createSession("capture");
        const command = await sandbox.process.executeSessionCommand(
          "capture",
          {
            command: "cd /opt/capture && node remote.mjs capture",
            runAsync: true,
            suppressInputEcho: true,
          },
          30,
        );
        async function waitForMarker(
          name: "capture-ready" | "capture-finalized" | "capture-done",
          seconds: number,
        ) {
          await execute(
            `node --input-type=module -e "import {access} from 'node:fs/promises';import {existsSync} from 'node:fs';const deadline=Date.now()+${seconds}000;for(;;){if(existsSync('/tmp/screen-studio/failure.json'))process.exit(1);try{await access('/tmp/screen-studio/${name}.json');break;}catch{if(Date.now()>deadline)process.exit(1);await new Promise(r=>setTimeout(r,250));}}"`,
            seconds + 5,
          );
        }
        try {
          await waitForMarker("capture-ready", 60);
        } catch (error) {
          throw (await remoteFailure()) ?? error;
        }
        await checkpoint(
          "capturing",
          "Recording one chat message and its actual reply.",
        );
        const recordRequestAt = Date.now();
        const recording = await sandbox.computerUse.recording.start(
          `capture-${run.id}`,
        );
        const recordResponseAt = Date.now();
        recordingId = recording.id;
        await sandbox.fs.uploadFile(
          Buffer.from("start"),
          "/tmp/screen-studio/capture-start",
        );
        try {
          await waitForMarker("capture-finalized", 240);
        } catch (error) {
          throw (await remoteFailure()) ?? error;
        }
        await sandbox.computerUse.recording.stop(recordingId);
        await waitForMarker("capture-done", 60);
        const result: unknown = JSON.parse(
          (
            await sandbox.fs.downloadFile(
              "/tmp/screen-studio/capture-done.json",
            )
          ).toString(),
        );
        if (
          !result ||
          typeof result !== "object" ||
          !("exitCode" in result) ||
          result.exitCode !== 0
        )
          throw new Error("Capture did not finish");
        await sandbox.computerUse.recording.download(
          recordingId,
          join(directory, "desktop.mp4"),
        );
        recordingId = undefined;
        await sandbox.fs.uploadFile(
          join(directory, "desktop.mp4"),
          "/tmp/screen-studio/output/desktop.mp4",
        );
        await checkpoint(
          "checking",
          "Checking both recordings and saving the source artifacts.",
        );
        await execute(
          "node --input-type=module -e \"import('./remote-analysis.mjs').then(async m=>{await m.analyzeMedia('/tmp/screen-studio/output/browser.webm','/tmp/screen-studio/output/browser-analysis');await m.analyzeMedia('/tmp/screen-studio/output/desktop.mp4','/tmp/screen-studio/output/desktop-analysis');})\"",
          180,
        );
        // Collect reproducibility inputs, never browser storage, credentials, traces,
        // network headers, or arbitrary sandbox directories.
        await execute(
          "cp /opt/capture/system-packages.txt /opt/capture/fonts.txt /tmp/screen-studio/output/ && tar -czf /tmp/screen-studio/artifacts.tar.gz -C /tmp/screen-studio/output .",
          60,
        );
        await sandbox.fs.downloadFile(
          "/tmp/screen-studio/output/manifest.json",
          join(directory, "manifest.json"),
        );
        CaptureManifest.parse(
          JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")),
        );
        const provenance = {
          sandboxId: sandbox.id,
          provider: "daytona",
          commandId: command.cmdId,
          sdk: "0.226.0",
          snapshot: process.env.DAYTONA_SNAPSHOT,
          provisioningStartedAt: new Date(beforeCreate).toISOString(),
          recordingRequestAt: new Date(recordRequestAt).toISOString(),
          recordingResponseAt: new Date(recordResponseAt).toISOString(),
          desktopTimeline:
            "Alignment requires review; API latency and cross-machine clocks are not an exact offset.",
          actualProviderCost: null,
          costStatus:
            "Await provider billing reconciliation; no estimate is reported as actual cost.",
          gate: "pending-three-consecutive-captures-and-human-review",
        };
        await sandbox.fs.uploadFile(
          Buffer.from(JSON.stringify(provenance, null, 2)),
          "/tmp/screen-studio/output/provenance.json",
        );
        await execute(
          "tar -czf /tmp/screen-studio/artifacts.tar.gz -C /tmp/screen-studio/output .",
          60,
        );
        await sandbox.fs.downloadFile(
          "/tmp/screen-studio/artifacts.tar.gz",
          join(directory, "capture.tar.gz"),
        );
        const path = join(directory, "capture.tar.gz");
        const bytes = (await stat(path)).size;
        if (!bytes || bytes > 512 * 1024 * 1024)
          throw new Error("Artifact is empty or too large");
        return { path, bytes };
      },
      upload: async ({ path, bytes }) => {
        if (aborted || !(await store.heartbeat(run.id)))
          throw new Error("Run cancelled");
        const hash = createHash("sha256");
        for await (const chunk of createReadStream(path)) hash.update(chunk);
        const checksum = hash.digest("hex");
        const key = `captures/${run.owner}/${run.id}/capture.tar.gz`;
        await s3.send(
          new PutObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: key,
            Body: createReadStream(path),
            ContentLength: bytes,
            ContentType: "application/gzip",
            Metadata: { sha256: checksum },
          }),
        );
        const saved = await s3.send(
          new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
        );
        if (
          saved.ContentLength !== bytes ||
          saved.Metadata?.sha256 !== checksum
        )
          throw new Error("Upload verification failed");
        const stored = await s3.send(
          new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
        );
        if (!stored.Body) throw new Error("Uploaded object has no body");
        const verification = createHash("sha256");
        for await (const chunk of stored.Body as AsyncIterable<Uint8Array>)
          verification.update(chunk);
        if (verification.digest("hex") !== checksum)
          throw new Error("Uploaded object checksum mismatch");
        if (aborted || !(await store.heartbeat(run.id))) {
          await s3.send(
            new DeleteObjectCommand({
              Bucket: process.env.S3_BUCKET,
              Key: key,
            }),
          );
          throw new Error("Run cancelled");
        }
        if (!(await store.saveArtifact(run.id, key))) {
          await s3.send(
            new DeleteObjectCommand({
              Bucket: process.env.S3_BUCKET,
              Key: key,
            }),
          );
          throw new Error("Run cancelled before artifact commit");
        }
        return key;
      },
      cleanup: async () => {
        clearInterval(heartbeat);
        monitoring = false;
        navigationAbort.abort();
        await navigationMonitor;
        await monitor;
        if (sandbox) {
          if (recordingId)
            await sandbox.computerUse.recording
              .stop(recordingId)
              .catch(() => undefined);
          try {
            await daytona.delete(sandbox, 30, true);
            await store.sandboxDeleted(run.id);
          } catch {
            console.error(
              JSON.stringify({ event: "cleanup_pending", runId: run.id }),
            );
          }
        }
      },
    });
  } finally {
    clearInterval(heartbeat);
    monitoring = false;
    navigationAbort.abort();
    await navigationMonitor;
    await monitor;
    if (navigator)
      console.info(
        JSON.stringify({
          event: "claude_navigation_usage",
          runId: run.id,
          ...navigator.usage,
        }),
      );
    try {
      await store.clearCredentials(run.id);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
