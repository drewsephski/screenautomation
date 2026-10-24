import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requestNavigation } from "./navigation-mailbox.ts";

test("private navigation IPC correlates replies and never accepts a stale decision", async () => {
  const root = await mkdtemp(join(tmpdir(), "navigation-test-"));
  const observation = {
    id: "login-0",
    url: "https://product.example/workspace",
    title: "Workspace",
    ready: true,
    links: [],
  };
  try {
    await writeFile(
      join(root, "navigation-response.json"),
      JSON.stringify({ id: "older", decision: { action: "stop" } }),
    );
    const pending = requestNavigation(root, observation);
    const published = join(root, "navigation-request.json");
    let request;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        request = JSON.parse(await readFile(published, "utf8"));
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
    assert.deepEqual(request, observation);
    await writeFile(
      join(root, "response.tmp"),
      JSON.stringify({ id: "login-0", decision: { action: "ready" } }),
    );
    await rename(
      join(root, "response.tmp"),
      join(root, "navigation-response.json"),
    );
    assert.deepEqual(await pending, { action: "ready" });
    await writeFile(
      join(root, "navigation-response.json"),
      JSON.stringify({
        id: "login-1",
        error: "Provider response must not leak",
      }),
    );
    await assert.rejects(
      requestNavigation(root, { ...observation, id: "login-1" }),
      { message: "Claude navigation failed" },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
