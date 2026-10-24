import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

for (const name of [
  "S3_ENDPOINT",
  "S3_BUCKET",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
])
  if (!process.env[name]) throw new Error(`Missing ${name}`);
const directory = resolve(
  process.env.STORAGE_CHECK_OUTPUT ?? "../../artifacts/storage-check",
);
await mkdir(directory, { recursive: true, mode: 0o700 });
const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? "auto",
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
  maxAttempts: 2,
});
const key = `preflight/${randomUUID()}.txt`;
const bucket = process.env.S3_BUCKET;
const body = Buffer.from("SYNTHETIC STORAGE PREFLIGHT - NOT PRODUCT FOOTAGE\n");
const hash = createHash("sha256").update(body).digest("hex");
const report = {
  purpose: "synthetic-storage-preflight-not-product-evidence",
  startedAt: new Date().toISOString(),
  uploadVerified: false,
  privateAccessVerified: false,
  signedAccessVerified: false,
  signedExpiryVerified: false,
  cleanupVerified: false,
};
let failure;
async function cleanupObject() {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    throw new Error("Test object still exists");
  } catch (error) {
    if (error.$metadata?.httpStatusCode !== 404) throw error;
  }
  report.cleanupVerified = true;
}
try {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      Metadata: { sha256: hash },
    }),
  );
  const head = await client.send(
    new HeadObjectCommand({ Bucket: bucket, Key: key }),
  );
  assert.equal(head.ContentLength, body.length);
  assert.equal(head.Metadata?.sha256, hash);
  const get = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  const readback = await get.Body.transformToByteArray();
  assert.equal(createHash("sha256").update(readback).digest("hex"), hash);
  report.uploadVerified = true;
  const signed = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: 5 },
  );
  const unsigned = new URL(signed);
  unsigned.search = "";
  assert.ok(
    [401, 403].includes(
      (
        await fetch(unsigned, {
          redirect: "manual",
          signal: AbortSignal.timeout(10000),
        })
      ).status,
    ),
  );
  report.privateAccessVerified = true;
  assert.equal(
    (await fetch(signed, { signal: AbortSignal.timeout(10000) })).status,
    200,
  );
  report.signedAccessVerified = true;
  await new Promise((resolve) => setTimeout(resolve, 6500));
  assert.ok(
    [401, 403].includes(
      (
        await fetch(signed, {
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        })
      ).status,
    ),
  );
  report.signedExpiryVerified = true;
} catch (error) {
  failure = error;
} finally {
  try {
    await cleanupObject();
  } catch (error) {
    failure ??= error;
  }
  client.destroy();
  report.finishedAt = new Date().toISOString();
  await writeFile(
    resolve(directory, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
}
if (failure) {
  console.error(
    JSON.stringify({
      status: "failed",
      type: failure.constructor.name,
      report,
    }),
  );
  process.exitCode = 1;
} else console.log(JSON.stringify(report));
