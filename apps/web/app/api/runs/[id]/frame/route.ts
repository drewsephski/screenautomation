import { NextResponse } from "next/server";
import { owner, privateHeaders, runStore } from "../../../../../lib/server";

export const runtime = "nodejs";
/** Latest desktop frame of the owner's run, for the live preview. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const tenant = await owner();
  if (!tenant || !/^[a-f0-9-]{36}$/.test(id))
    return NextResponse.json(
      { error: "Frame not found." },
      { status: 404, headers: privateHeaders },
    );
  try {
    const frame = await runStore().frame(id, tenant);
    if (!frame)
      return NextResponse.json(
        { error: "No frame yet." },
        { status: 404, headers: privateHeaders },
      );
    return new Response(new Uint8Array(frame.image), {
      headers: {
        ...privateHeaders,
        "Content-Type": "image/jpeg",
        "X-Content-Type-Options": "nosniff",
        "Last-Modified": frame.captured_at.toUTCString(),
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Preview is temporarily unavailable." },
      { status: 503, headers: privateHeaders },
    );
  }
}
