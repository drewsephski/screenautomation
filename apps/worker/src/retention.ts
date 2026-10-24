import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  type S3Client,
} from "@aws-sdk/client-s3";

/** An independent bucket sweep also catches uploads orphaned before DB persistence. */
export async function purgeExpiredCaptures(
  client: S3Client,
  bucket: string,
  now = Date.now(),
) {
  const cutoff = now - 24 * 60 * 60 * 1000;
  let token: string | undefined;
  let deleted = 0;
  // A bounded pass prevents an unexpectedly large bucket from monopolizing the worker.
  for (let page = 0; page < 10; page++) {
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: "captures/",
        MaxKeys: 100,
        ContinuationToken: token,
      }),
      { abortSignal: AbortSignal.timeout(30000) },
    );
    for (const object of result.Contents ?? []) {
      if (
        !object.Key?.startsWith("captures/") ||
        !object.LastModified ||
        object.LastModified.getTime() >= cutoff ||
        !Number.isFinite(object.LastModified.getTime())
      )
        continue;
      await client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: object.Key }),
        { abortSignal: AbortSignal.timeout(30000) },
      );
      deleted++;
    }
    if (!result.IsTruncated) return deleted;
    if (!result.NextContinuationToken || result.NextContinuationToken === token)
      throw new Error("Invalid capture retention pagination");
    token = result.NextContinuationToken;
  }
  return deleted;
}
