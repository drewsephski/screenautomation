import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import {
  encryptCredentials,
  decryptCredentials,
  publicAddresses,
} from "./index.ts";

test("credentials are encrypted, bound to one run, and expire", () => {
  const key = randomBytes(32).toString("base64");
  const sealed = encryptCredentials(
    { email: "demo@example.com", password: "private-password" },
    "run-a",
    key,
    1000,
  );
  assert.equal(sealed.includes("private-password"), false);
  assert.deepEqual(decryptCredentials(sealed, "run-a", key, 999), {
    email: "demo@example.com",
    password: "private-password",
  });
  assert.throws(() => decryptCredentials(sealed, "run-b", key, 999));
  assert.throws(
    () => decryptCredentials(sealed, "run-a", key, 1001),
    /expired/,
  );
});

test("public target validation rejects mixed public/private DNS and metadata destinations", async () => {
  await assert.rejects(
    publicAddresses("https://example.com", async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]),
    /public/,
  );
  await assert.rejects(publicAddresses("https://169.254.169.254"), /public/);
  await assert.rejects(publicAddresses("https://[::ffff:127.0.0.1]"), /public/);
  assert.deepEqual(
    await publicAddresses("https://example.com", async () => [
      { address: "93.184.216.34", family: 4 },
    ]),
    ["93.184.216.34/32"],
  );
});
