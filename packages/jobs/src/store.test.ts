import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { RunStore } from "./index.ts";

test(
  "durable runs isolate tenants, claim once, and erase credentials on cancellation",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const store = new RunStore(process.env.TEST_DATABASE_URL!);
    const owner = randomUUID();
    const other = randomUUID();
    try {
      const migrations = process.env.TEST_DIRECT_DATABASE_URL
        ? new RunStore(process.env.TEST_DIRECT_DATABASE_URL)
        : store;
      try {
        await migrations.migrate();
      } finally {
        if (migrations !== store) await migrations.close();
      }
      const id = await store.create(
        owner,
        {
          url: "https://kraftybot.app",
          email: "test@example.com",
          password: "hidden",
          message: "Hello",
          consent: true,
        },
        randomBytes(32).toString("base64"),
      );
      assert.equal(await store.get(id, other), undefined);
      const claims = await Promise.all([store.claim(), store.claim()]);
      assert.equal(claims.filter((run) => run?.id === id).length, 1);
      await store.cancel(id, other);
      assert.equal((await store.get(id, owner))?.status, "provisioning");
      await store.cancel(id, owner);
      assert.equal((await store.get(id, owner))?.credentials, null);
      assert.equal(
        await store.update(id, "completed", "should not happen"),
        false,
      );
      assert.equal((await store.get(id, owner))?.status, "cancelled");
      const recovered = await store.create(
        owner,
        {
          url: "https://kraftybot.app",
          email: "test@example.com",
          password: "hidden",
          message: "Hello",
          consent: true,
        },
        randomBytes(32).toString("base64"),
      );
      // Claim by public API, then simulate the external worker losing its lease.
      await store.claim();
      await store.update(recovered, "checking", "Verified media");
      assert.equal(
        await store.saveArtifact(recovered, "captures/recovered.tar.gz"),
        true,
      );
      await store.pool.query(
        "UPDATE capture_runs SET lease_until=now()-interval '1 second' WHERE id=$1",
        [recovered],
      );
      await store.expire();
      assert.equal((await store.get(recovered, owner))?.status, "completed");
      assert.equal(
        (await store.get(recovered, owner))?.artifact_key,
        "captures/recovered.tar.gz",
      );
      const tour = await store.create(
        owner,
        {
          url: "https://kraftybot.app",
          email: "demo@example.com",
          password: "hidden",
          message: "Show the workspace",
          mode: "tour",
          consent: true,
        },
        randomBytes(32).toString("base64"),
      );
      await store.claim();
      await store.update(tour, "logging_in", "Authenticated");
      assert.equal(
        await store.proposeStory(tour, {
          title: "Workspace tour",
          summary: "Visit the observed workspace.",
          scenes: [
            { url: "https://kraftybot.app/workspace", caption: "Workspace" },
          ],
        }),
        true,
      );
      assert.equal((await store.get(tour, owner))?.credentials, null);
      assert.equal(await store.approveStory(tour, other), false);
      assert.equal(await store.storyApproved(tour), false);
      assert.equal(await store.approveStory(tour, owner), true);
      assert.equal(await store.approveStory(tour, owner), false);
      await store.cancel(tour, owner);
      assert.equal(await store.storyApproved(tour), false);
    } finally {
      await store.pool.query("DELETE FROM capture_runs WHERE owner=$1", [
        owner,
      ]);
      await store.close();
    }
  },
);
