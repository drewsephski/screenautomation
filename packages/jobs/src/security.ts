import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

function encryptionKey(encoded: string) {
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32)
    throw new Error("CREDENTIAL_ENCRYPTION_KEY must encode 32 random bytes");
  return key;
}

export function encryptCredentials(
  credentials: { email: string; password: string },
  runId: string,
  key: string,
  expiresAt: number,
) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(key), iv);
  cipher.setAAD(Buffer.from(runId));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify({ ...credentials, expiresAt })),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}

export function decryptCredentials(
  sealed: string,
  runId: string,
  key: string,
  now = Date.now(),
): { email: string; password: string } {
  const data = Buffer.from(sealed, "base64");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(key),
    data.subarray(0, 12),
  );
  decipher.setAAD(Buffer.from(runId));
  decipher.setAuthTag(data.subarray(12, 28));
  const value: unknown = JSON.parse(
    Buffer.concat([
      decipher.update(data.subarray(28)),
      decipher.final(),
    ]).toString(),
  );
  if (
    !value ||
    typeof value !== "object" ||
    !("expiresAt" in value) ||
    typeof value.expiresAt !== "number" ||
    value.expiresAt <= now
  )
    throw new Error("Credentials expired; start a new run");
  if (
    !("email" in value) ||
    typeof value.email !== "string" ||
    !("password" in value) ||
    typeof value.password !== "string"
  )
    throw new Error("Invalid credential envelope");
  return { email: value.email, password: value.password };
}

export async function publicAddresses(
  target: string,
  resolve: (host: string) => Promise<{ address: string; family: number }[]> = (
    host,
  ) => lookup(host, { all: true }),
) {
  const url = new URL(target);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  )
    throw new Error("Only public HTTPS destinations are allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await resolve(host);
  if (
    !addresses.length ||
    addresses.some(
      ({ address }) =>
        !ipaddr.isValid(address) ||
        ipaddr.process(address).range() !== "unicast",
    )
  )
    throw new Error("Destination must resolve exclusively to public addresses");
  return [
    ...new Set(
      addresses.map(
        ({ address, family }) => `${address}/${family === 6 ? 128 : 32}`,
      ),
    ),
  ];
}
