import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { RunStore } from "@repo/jobs";

let store: RunStore | undefined;
export function runStore() {
  if (!process.env.DATABASE_URL || !process.env.CREDENTIAL_ENCRYPTION_KEY)
    throw new Error("Studio is not configured");
  store ??= new RunStore(process.env.DATABASE_URL);
  return store;
}
export async function owner(create = false) {
  const jar = await cookies();
  let token = jar.get("studio_session")?.value;
  if ((!token || !/^[a-f0-9]{64}$/.test(token)) && create) {
    token = randomBytes(32).toString("hex");
    jar.set("studio_session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 86400,
    });
  }
  return token && /^[a-f0-9]{64}$/.test(token)
    ? createHash("sha256").update(token).digest("hex")
    : null;
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = process.env.APP_ORIGIN ?? new URL(request.url).origin;
  return origin === expected;
}
export const privateHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};
