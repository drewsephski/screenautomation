import { NextResponse } from "next/server";
import {
  owner,
  privateHeaders,
  runStore,
  sameOrigin,
} from "../../../../lib/server";

export const runtime = "nodejs";
async function lookup(params: Promise<{ id: string }>) {
  const { id } = await params;
  const tenant = await owner();
  if (!tenant || !/^[a-f0-9-]{36}$/.test(id)) return undefined;
  return runStore().get(id, tenant);
}
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const run = await lookup(params);
    if (!run)
      return NextResponse.json(
        { error: "Run not found or session expired." },
        { status: 404, headers: privateHeaders },
      );
    return NextResponse.json(
      {
        id: run.id,
        url: run.url,
        status: run.status,
        detail: run.detail,
        hasArtifact: !!run.artifact_key,
        needsCode: run.needs_code,
        step: run.step,
        pageUrl: run.page_url,
        frameAt: run.frame_at?.getTime() ?? null,
        createdAt: run.created_at.getTime(),
      },
      { headers: privateHeaders },
    );
  } catch {
    return NextResponse.json(
      { error: "Run status is temporarily unavailable." },
      { status: 503, headers: privateHeaders },
    );
  }
}
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!sameOrigin(request))
    return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  try {
    const run = await lookup(params);
    if (!run)
      return NextResponse.json(
        { error: "Run not found." },
        { status: 404, headers: privateHeaders },
      );
    await runStore().cancel(run.id, (await owner())!);
    return NextResponse.json({ ok: true }, { headers: privateHeaders });
  } catch {
    return NextResponse.json(
      { error: "Could not cancel. Please try again." },
      { status: 503, headers: privateHeaders },
    );
  }
}
