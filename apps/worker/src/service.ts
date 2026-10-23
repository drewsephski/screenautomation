import {
  Daytona,
  DaytonaNotFoundError,
  DaytonaGoneError,
} from "@daytonaio/sdk";
import { S3Client } from "@aws-sdk/client-s3";
import { RunStore } from "@repo/jobs";
import { captureRun } from "./capture.ts";

for (const name of [
  "DATABASE_URL",
  "CREDENTIAL_ENCRYPTION_KEY",
  "DAYTONA_API_KEY",
  "DAYTONA_SNAPSHOT",
  "S3_BUCKET",
  "S3_ENDPOINT",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
])
  if (!process.env[name]) throw new Error(`Missing configuration: ${name}`);
const store = new RunStore(process.env.DATABASE_URL!);
const daytona = new Daytona({
  apiKey: process.env.DAYTONA_API_KEY,
  requestTimeoutMs: 60000,
  otelEnabled: false,
});
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? "auto",
  forcePathStyle: true,
});
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
try {
  while (!stopping) {
    try {
      const expired = await store.expire();
      for (const run of expired) {
        try {
          await daytona.delete(
            await daytona.get(run.sandbox_id ?? `capture-${run.id}`),
            30,
          );
          await store.sandboxDeleted(run.id);
        } catch (error) {
          if (
            error instanceof DaytonaNotFoundError ||
            error instanceof DaytonaGoneError
          )
            await store.sandboxDeleted(run.id);
          else
            console.error(
              JSON.stringify({ event: "cleanup_pending", runId: run.id }),
            );
        }
      }
      const run = await store.claim();
      if (!run) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }
      try {
        const key = await captureRun(run, store, daytona, s3);
        await store.update(
          run.id,
          "completed",
          "Source capture verified and saved. Review footage before publishing.",
          undefined,
          key,
        );
      } catch {
        await store.fail(run.id);
        console.error(
          JSON.stringify({ event: "capture_failed", runId: run.id }),
        );
      }
    } catch {
      console.error(JSON.stringify({ event: "worker_cycle_failed" }));
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
} finally {
  await store.close();
  s3.destroy();
}
