import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { S3Client } from "@aws-sdk/client-s3";
import { purgeExpiredCaptures } from "./retention.ts";

test("capture retention paginates and deletes only expired capture objects", async () => {
  const deleted: string[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url!, "http://localhost");
    response.setHeader("Content-Type", "application/xml");
    if (request.method === "GET") {
      const contents = url.searchParams.has("continuation-token")
        ? "<Contents><Key>captures/old-2.tar.gz</Key><LastModified>2026-10-20T00:00:00Z</LastModified></Contents><Contents><Key>other/keep.txt</Key><LastModified>2026-10-20T00:00:00Z</LastModified></Contents>"
        : "<Contents><Key>captures/old-1.tar.gz</Key><LastModified>2026-10-20T00:00:00Z</LastModified></Contents><Contents><Key>captures/recent.tar.gz</Key><LastModified>2026-10-23T12:00:00Z</LastModified></Contents>";
      response.end(
        `<ListBucketResult>${contents}<IsTruncated>${!url.searchParams.has("continuation-token")}</IsTruncated>${url.searchParams.has("continuation-token") ? "" : "<NextContinuationToken>next</NextContinuationToken>"}</ListBucketResult>`,
      );
    } else if (request.method === "DELETE") {
      deleted.push(decodeURIComponent(url.pathname));
      response.statusCode = 204;
      response.end();
    } else {
      response.statusCode = 400;
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const client = new S3Client({
    endpoint: `http://127.0.0.1:${address.port}`,
    region: "auto",
    forcePathStyle: true,
    credentials: { accessKeyId: "fixture", secretAccessKey: "fixture" },
  });
  try {
    assert.equal(
      await purgeExpiredCaptures(
        client,
        "fixture",
        Date.parse("2026-10-24T00:00:00Z"),
      ),
      2,
    );
    assert.deepEqual(deleted, [
      "/fixture/captures/old-1.tar.gz",
      "/fixture/captures/old-2.tar.gz",
    ]);
  } finally {
    client.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
