import assert from "node:assert/strict";
import { test } from "node:test";
import { tourUrl, validateStory } from "./tour.ts";

test("tour stories can only select distinct observed operator-enabled pages", () => {
  const origin = "https://product.example";
  const paths = ["/workspace", "/reports"];
  const observation = {
    id: "tour" as const,
    url: origin + "/workspace",
    title: "Workspace",
    links: [{ label: "Reports", url: origin + "/reports" }],
  };
  const story = {
    title: "Review the product",
    summary: "Open the reports page.",
    scenes: [{ url: origin + "/reports", caption: "Reports" }],
  };
  assert.deepEqual(validateStory(story, observation, origin, paths), story);
  for (const url of [
    "https://evil.example/reports",
    origin + "/reports?delete=true",
    origin + "/reports#action",
    origin + "/workspace",
  ]) {
    assert.throws(() =>
      validateStory(
        { ...story, scenes: [{ url, caption: "Page" }] },
        observation,
        origin,
        paths,
      ),
    );
  }
  assert.throws(() =>
    validateStory(
      { ...story, scenes: [...story.scenes, ...story.scenes] },
      observation,
      origin,
      paths,
    ),
  );
  assert.throws(() => tourUrl(origin + "/settings", origin, paths));
});
