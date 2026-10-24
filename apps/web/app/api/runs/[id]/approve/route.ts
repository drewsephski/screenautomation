import {
  owner,
  privateHeaders,
  runStore,
  sameOrigin,
} from "../../../../../lib/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!sameOrigin(request))
    return Response.json(
      { error: "Invalid origin." },
      { status: 403, headers: privateHeaders },
    );
  const tenant = await owner();
  const { id } = await params;
  if (!tenant || !/^[a-f0-9-]{36}$/.test(id))
    return Response.json(
      { error: "Run not found." },
      { status: 404, headers: privateHeaders },
    );
  const approved = await runStore().approveStory(id, tenant);
  return Response.json(
    approved ? { ok: true } : { error: "This story cannot be approved now." },
    { status: approved ? 200 : 409, headers: privateHeaders },
  );
}
