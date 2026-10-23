import assert from "node:assert/strict";
import { test } from "node:test";
import { captureLifecycle } from "./lifecycle.ts";

test("capture is saved before teardown; failed uploads never produce success and still clean up", async () => {
  const operations: string[] = [];
  await assert.rejects(
    captureLifecycle({
      capture: async () => {
        operations.push("finalized-and-verified");
        return "media";
      },
      upload: async () => {
        operations.push("upload-failed");
        throw new Error("Object storage unavailable");
      },
      cleanup: async () => {
        operations.push("sandbox-deleted");
      },
    }),
    /Object storage/,
  );
  assert.deepEqual(operations, [
    "finalized-and-verified",
    "upload-failed",
    "sandbox-deleted",
  ]);
  const successful: string[] = [];
  assert.equal(
    await captureLifecycle({
      capture: async () => "media",
      upload: async () => {
        successful.push("verified-upload");
        return "artifact-key";
      },
      cleanup: async () => {
        successful.push("sandbox-deleted");
      },
    }),
    "artifact-key",
  );
  assert.deepEqual(successful, ["verified-upload", "sandbox-deleted"]);
});
