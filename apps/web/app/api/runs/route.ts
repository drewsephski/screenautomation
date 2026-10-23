import { NextResponse } from "next/server";
import { RunInput } from "@repo/contracts";
import { publicAddresses } from "@repo/jobs";
import {
  owner,
  privateHeaders,
  runStore,
  sameOrigin,
} from "../../../lib/server";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return NextResponse.json(
      { error: "Refresh this page before starting a run." },
      { status: 403, headers: privateHeaders },
    );
  if (
    !process.env.DATABASE_URL ||
    !process.env.CREDENTIAL_ENCRYPTION_KEY ||
    !process.env.DAYTONA_SNAPSHOT ||
    !process.env.APP_ORIGIN
  )
    return NextResponse.json(
      {
        error:
          "The studio is not connected to its capture worker yet. Your credentials were not saved.",
      },
      { status: 503, headers: privateHeaders },
    );
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader)
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        return NextResponse.json(
          { error: "Request is too large." },
          { status: 413, headers: privateHeaders },
        );
      }
      chunks.push(chunk.value);
    }
  const body = Buffer.concat(chunks).toString("utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return NextResponse.json(
      { error: "Invalid request." },
      { status: 400, headers: privateHeaders },
    );
  }
  const result = RunInput.safeParse(raw);
  if (!result.success)
    return NextResponse.json(
      { error: result.error.issues[0]?.message ?? "Check the form." },
      { status: 400, headers: privateHeaders },
    );
  // A deployment operator approves origins before users can submit credentials.
  const allowed = (
    process.env.ALLOWED_TARGET_ORIGINS ?? "https://kraftybot.app"
  ).split(",");
  if (!allowed.includes(new URL(result.data.url).origin))
    return NextResponse.json(
      {
        error:
          "This website is not enabled on this studio yet. Ask the studio owner to add its origin.",
      },
      { status: 400, headers: privateHeaders },
    );
  try {
    await publicAddresses(result.data.url);
  } catch {
    return NextResponse.json(
      {
        error:
          "The website must be reachable on the public internet over HTTPS.",
      },
      { status: 400, headers: privateHeaders },
    );
  }
  try {
    const id = await runStore().create(
      (await owner(true))!,
      result.data,
      process.env.CREDENTIAL_ENCRYPTION_KEY!,
    );
    return NextResponse.json({ id }, { status: 201, headers: privateHeaders });
  } catch {
    return NextResponse.json(
      {
        error:
          "A run is already active, the queue is full, or storage is unavailable. Try again shortly.",
      },
      { status: 409, headers: privateHeaders },
    );
  }
}
