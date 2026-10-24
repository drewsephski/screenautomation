import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createHash } from "node:crypto";

export async function uploadVerifiedFile(
  s3: S3Client,
  bucket: string,
  key: string,
  path: string,
  contentType: string,
) {
  const bytes = (await stat(path)).size;
  if (!bytes || bytes > 512 * 1024 * 1024)
    throw new Error("Artifact is empty or too large");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  const checksum = hash.digest("hex");
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: createReadStream(path),
        ContentLength: bytes,
        ContentType: contentType,
        Metadata: { sha256: checksum },
      }),
    );
    const head = await s3.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    if (head.ContentLength !== bytes || head.Metadata?.sha256 !== checksum)
      throw new Error("Upload metadata mismatch");
    const stored = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    if (!stored.Body) throw new Error("Uploaded artifact has no body");
    const check = createHash("sha256");
    for await (const chunk of stored.Body as AsyncIterable<Uint8Array>)
      check.update(chunk);
    if (check.digest("hex") !== checksum)
      throw new Error("Uploaded artifact checksum mismatch");
    return { bytes, sha256: checksum };
  } catch (error) {
    await s3
      .send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
      .catch(() => undefined);
    throw error;
  }
}
