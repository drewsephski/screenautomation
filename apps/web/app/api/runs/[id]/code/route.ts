import { NextResponse } from "next/server";
import { sealCode } from "@repo/jobs";
import {
  owner,
  privateHeaders,
  runStore,
  sameOrigin,
} from "../../../../../lib/server";

export const runtime = "nodejs";
/** The owner relays a one-time sign-in code to the waiting browser. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!sameOrigin(request))
    return NextResponse.json(
      { error: "Refresh this page before sending a code." },
      { status: 403, headers: privateHeaders },
    );
  const { id } = await params;
  const tenant = await owner();
  let code: unknown;
  try {
    code = (await request.json())?.code;
  } catch {
    code = undefined;
  }
  const normalized = typeof code === "string" ? code.replace(/[\s-]/g, "") : "";
  if (!tenant || !/^[a-f0-9-]{36}$/.test(id))
    return NextResponse.json(
      { error: "Run not found." },
      { status: 404, headers: privateHeaders },
    );
  if (!/^[A-Za-z0-9]{4,10}$/.test(normalized))
    return NextResponse.json(
      { error: "Enter the code exactly as it appears, usually six digits." },
      { status: 400, headers: privateHeaders },
    );
  try {
    const accepted = await runStore().submitCode(
      id,
      tenant,
      sealCode(normalized, id, process.env.CREDENTIAL_ENCRYPTION_KEY!),
    );
    if (!accepted)
      return NextResponse.json(
        { error: "This run isn't waiting for a code anymore." },
        { status: 409, headers: privateHeaders },
      );
    return NextResponse.json({ ok: true }, { headers: privateHeaders });
  } catch {
    return NextResponse.json(
      { error: "Could not send the code. Try again." },
      { status: 503, headers: privateHeaders },
    );
  }
}
