import {
  Daytona,
  DaytonaNotFoundError,
  DaytonaGoneError,
} from "@daytonaio/sdk";
import { S3Client } from "@aws-sdk/client-s3";
import { RunStore } from "@repo/jobs";
import { captureRun } from "../src/capture.ts";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

if (
  !process.env.TEST_DATABASE_URL ||
  !process.env.DAYTONA_API_KEY ||
  !process.env.DAYTONA_SNAPSHOT
)
  throw new Error(
    "Set TEST_DATABASE_URL, DAYTONA_API_KEY, and DAYTONA_SNAPSHOT. Use a disposable test database and stop the capture worker.",
  );
const directory = resolve("../../artifacts/production-capture-failure");
await mkdir(directory, { recursive: true, mode: 0o700 });
const store = new RunStore(process.env.TEST_DATABASE_URL);
const client = new Daytona({
  apiKey: process.env.DAYTONA_API_KEY,
  otelEnabled: false,
  requestTimeoutMs: 30000,
});
// This endpoint is deliberately unreachable. A failure before bundle upload
// must never reach site login, chat submission, or object storage.
const storage = new S3Client({
  endpoint: "https://storage.invalid",
  region: "auto",
  credentials: {
    accessKeyId: "unused-in-failure-test",
    secretAccessKey: "unused-in-failure-test",
  },
});
const tenant = randomUUID();
const report = {
  purpose: "production-capture-failure-before-credential-upload",
  runId: null,
  provisionedSandboxId: null,
  bundleUploadFailed: false,
  faultInjectedAtProviderBoundary: true,
  workflowFailed: false,
  credentialsCleared: false,
  sandboxDeletionVerified: false,
  siteLoginAttempted: false,
  objectUploadAttempted: false,
};
const injectedUploadFailure = new Error(
  "Controlled provider bundle-upload interruption",
);
const createSandbox = client.create.bind(client);
client.create = async (...args) => {
  const sandbox = await createSandbox(...args);
  report.provisionedSandboxId = sandbox.id;
  const upload = sandbox.fs.uploadFile.bind(sandbox.fs);
  sandbox.fs.uploadFile = async (source, destination, ...rest) => {
    if (destination === "/opt/capture/remote.mjs") throw injectedUploadFailure;
    return upload(source, destination, ...rest);
  };
  return sandbox;
};
let run;
try {
  await store.migrate();
  const pending = await store.pool.query(
    "SELECT count(*)::text AS count FROM capture_runs WHERE status NOT IN ('completed','failed','cancelled')",
  );
  if (Number(pending.rows[0]?.count) > 0)
    throw new Error(
      "Test database has active runs; stop its worker and use an empty queue.",
    );
  process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const id = await store.create(
    tenant,
    {
      url: "https://kraftybot.app",
      email: "failure-check@example.com",
      password: randomBytes(24).toString("hex"),
      message: "Must not be submitted",
      consent: true,
    },
    process.env.CREDENTIAL_ENCRYPTION_KEY,
  );
  report.runId = id;
  run = await store.claim();
  if (run?.id !== id)
    throw new Error(
      "Another queued run exists. Use an isolated database with its worker stopped.",
    );
  try {
    await captureRun(run, store, client, storage);
  } catch (error) {
    report.workflowFailed = true;
    report.failureType = error.constructor.name;
    report.bundleUploadFailed = error === injectedUploadFailure;
  }
  await store.fail(id);
  const saved = await store.get(id, tenant);
  report.credentialsCleared = saved?.credentials === null;
  const deadline = Date.now() + 45000;
  for (;;) {
    let exists = true;
    try {
      await client.get(`capture-${id}`);
    } catch (error) {
      if (
        error instanceof DaytonaNotFoundError ||
        error instanceof DaytonaGoneError
      )
        exists = false;
      else throw error;
    }
    if (!exists) {
      report.sandboxDeletionVerified = true;
      break;
    }
    if (Date.now() > deadline)
      throw new Error("Sandbox cleanup was not verified");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (
    !report.provisionedSandboxId ||
    !report.bundleUploadFailed ||
    !report.workflowFailed ||
    !report.credentialsCleared ||
    !report.sandboxDeletionVerified
  )
    throw new Error("Failure-path invariants were not met");
  console.log(JSON.stringify(report));
} finally {
  try {
    await writeFile(
      join(directory, "report.json"),
      JSON.stringify(report, null, 2),
    );
    if (report.sandboxDeletionVerified && run?.id === report.runId)
      await store.pool.query(
        "DELETE FROM capture_runs WHERE id=$1 AND owner=$2",
        [run.id, tenant],
      );
    else if (report.runId)
      console.error(
        JSON.stringify({
          event: "test_cleanup_pending",
          runId: report.runId,
          sandboxId: report.provisionedSandboxId,
        }),
      );
  } finally {
    await store.close();
    storage.destroy();
  }
}
