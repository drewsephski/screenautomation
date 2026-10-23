import { Daytona, type Sandbox } from "@daytonaio/sdk";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decryptCredentials,
  publicAddresses,
  type StoredRun,
  type RunStore,
} from "@repo/jobs";
import { CaptureManifest } from "@repo/contracts";
import { captureLifecycle } from "./lifecycle.ts";

export async function captureRun(
  run: StoredRun,
  store: RunStore,
  daytona: Daytona,
  s3: S3Client,
) {
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
        if (sandbox) await daytona.delete(sandbox, 30, true);
      }
    } catch {
      aborted = true;
    } finally {
      heartbeatRunning = false;
    }
  }, 10000);
  async function checkpoint(
    status: Parameters<RunStore["update"]>[1],
    detail: string,
  ) {
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
          "https://kraftybot.app,https://clerk.kraftybot.app,https://img.clerk.com,https://api.trigger.dev,https://cdn.protect.clerk.com"
        ).split(",");
        const origins = [...new Set([targetOrigin, ...configured])];
        const destinations = Object.fromEntries(
          await Promise.all(
            origins.map(
              async (origin) =>
                [
                  origin,
                  (await publicAddresses(origin))
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
          throw new Error(
            "Daytona supports at most ten public IPv4 CIDRs; reduce the approved origins",
          );
        if (!run.credentials) throw new Error("Credentials expired");
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
            ttlMinutes: 15,
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
        await execute("node /opt/capture/remote.mjs login", 120);
        await store.clearCredentials(run.id);
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
        await waitForMarker("capture-ready", 60);
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
        await waitForMarker("capture-finalized", 240);
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
    try {
      await store.clearCredentials(run.id);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
