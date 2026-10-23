import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { owner, privateHeaders, runStore } from "../../../../../lib/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const tenant = await owner();
  const { id } = await params;
  if (!tenant || !/^[a-f0-9-]{36}$/.test(id))
    return Response.json(
      { error: "Not found." },
      { status: 404, headers: privateHeaders },
    );
  try {
    const run = await runStore().get(id, tenant);
    if (run?.status !== "completed" || !run.artifact_key)
      return Response.json(
        { error: "Capture is not ready." },
        { status: 404, headers: privateHeaders },
      );
    const client = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION ?? "auto",
      forcePathStyle: true,
    });
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: run.artifact_key,
        ResponseContentDisposition: 'attachment; filename="capture.tar.gz"',
      }),
      { expiresIn: 60 },
    );
    return Response.redirect(url, 303);
  } catch {
    return Response.json(
      { error: "Download is unavailable." },
      { status: 503, headers: privateHeaders },
    );
  }
}
