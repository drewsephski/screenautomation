import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { uploadVerifiedFile } from "./upload.ts";

test("an upload with intact metadata but corrupted bytes is removed and never accepted", async () => {
  const directory = await mkdtemp(join(tmpdir(), "upload-check-"));
  const client = new S3Client({ region: "auto" });
  let metadata: Record<string, string> | undefined;
  let deleted = false;
  client.send = (async (command: unknown) => {
    if (command instanceof PutObjectCommand) {
      metadata = command.input.Metadata;
      command.input.Body && (command.input.Body as Readable).destroy();
      return {};
    }
    if (command instanceof HeadObjectCommand)
      return { ContentLength: 4, Metadata: metadata };
    if (command instanceof GetObjectCommand)
      return { Body: Readable.from([Buffer.from("evil")]) };
    if (command instanceof DeleteObjectCommand) {
      deleted = true;
      return {};
    }
    throw new Error("Unexpected storage operation");
  }) as typeof client.send;
  try {
    const path = join(directory, "film.mp4");
    await writeFile(path, "good");
    await assert.rejects(
      uploadVerifiedFile(client, "bucket", "new-key", path, "video/mp4"),
      /checksum mismatch/,
    );
    assert.equal(deleted, true);
  } finally {
    client.destroy();
    await rm(directory, { recursive: true, force: true });
  }
});
