import assert from "node:assert/strict";
import { test } from "node:test";

const origin = process.env.TEST_STUDIO_URL;
test(
  "hosted intake creates an isolated durable run, rejects duplicate sends, and supports cancellation",
  { skip: !origin },
  async () => {
    const response = await fetch(`${origin}/api/runs`, {
      method: "POST",
      headers: { Origin: origin!, "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://kraftybot.app",
        email: "demo@example.com",
        password: "synthetic-test-only",
        message: "Do not execute: intake integration test",
        consent: true,
      }),
    });
    assert.equal(response.status, 201);
    const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
    assert.match(response.headers.get("set-cookie")!, /HttpOnly/i);
    const { id } = (await response.json()) as { id: string };
    assert.equal((await fetch(`${origin}/api/runs/${id}`)).status, 404);
    const status = await fetch(`${origin}/api/runs/${id}`, {
      headers: { Cookie: cookie },
    });
    const body = await status.text();
    assert.equal(status.status, 200);
    assert.equal(body.includes("synthetic-test-only"), false);
    assert.equal(body.includes("demo@example.com"), false);
    assert.equal(JSON.parse(body).status, "queued");
    const duplicate = await fetch(`${origin}/api/runs`, {
      method: "POST",
      headers: {
        Origin: origin!,
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: "https://kraftybot.app",
        email: "demo@example.com",
        password: "synthetic-test-only",
        message: "Do not execute",
        consent: true,
      }),
    });
    assert.equal(duplicate.status, 409);
    assert.equal(
      (
        await fetch(`${origin}/api/runs/${id}`, {
          method: "DELETE",
          headers: { Origin: "https://other.example", Cookie: cookie },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${origin}/api/runs/${id}`, {
          method: "DELETE",
          headers: { Origin: origin!, Cookie: cookie },
        })
      ).status,
      200,
    );
    const cancelled = await fetch(`${origin}/api/runs/${id}`, {
      headers: { Cookie: cookie },
    });
    assert.equal(
      ((await cancelled.json()) as { status: string }).status,
      "cancelled",
    );
  },
);
