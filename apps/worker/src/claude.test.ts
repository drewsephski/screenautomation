import assert from "node:assert/strict";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { ClaudeNavigator } from "./claude.ts";
import {
  navigationUrl,
  validateDecision,
  type NavigationObservation,
} from "./navigation-contract.ts";

const observation: NavigationObservation = {
  id: "login-0",
  url: "https://product.example/workspace",
  title: "Workspace",
  ready: false,
  links: [
    {
      label: "Planning assistant",
      url: "https://product.example/chats/planning",
    },
  ],
};

function fixture(input: unknown = { action: "open", index: 0 }, tokens = 100) {
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const client = new Anthropic({
    apiKey: "synthetic-test-key",
    maxRetries: 0,
    fetch: async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return Response.json(
        String(url).includes("count_tokens")
          ? { input_tokens: tokens }
          : {
              id: "msg_test",
              type: "message",
              role: "assistant",
              model: "claude-haiku-5-5",
              content: [
                {
                  type: "tool_use",
                  id: "tool_test",
                  name: "choose_navigation",
                  input,
                },
              ],
              stop_reason: "tool_use",
              stop_sequence: null,
              usage: { input_tokens: tokens, output_tokens: 25 },
            },
      );
    },
  });
  return {
    navigator: new ClaudeNavigator(
      client,
      "https://product.example",
      "Give planning tips",
    ),
    requests,
  };
}

test("Claude receives a bounded tool and returns a validated page choice with usage", async () => {
  const { navigator, requests } = fixture();
  assert.deepEqual(await navigator.decide(observation), {
    action: "open",
    index: 0,
  });
  assert.equal(requests.length, 2);
  assert.deepEqual(navigator.usage, {
    model: "claude-haiku-5-5",
    calls: 1,
    inputTokens: 100,
    outputTokens: 25,
  });
  assert.equal(requests[1]!.body.max_tokens, 512);
  assert.deepEqual(requests[0]!.body.tool_choice, {
    type: "tool",
    name: "choose_navigation",
  });
  assert.deepEqual(requests[1]!.body.tool_choice, {
    type: "tool",
    name: "choose_navigation",
  });
  assert.equal(requests[1]!.body.thinking, undefined);
  assert.equal(requests[1]!.body.output_config, undefined);
  await assert.rejects(navigator.decide(observation), /repeated/);
});

test("invalid model output and premature readiness never become browser actions", async () => {
  for (const input of [
    { action: "open", index: 12 },
    { action: "ready" },
    { action: "execute", code: "unsafe" },
    { action: "open", index: 0, url: "https://evil.example" },
  ]) {
    await assert.rejects(fixture(input).navigator.decide(observation));
  }
});

test("navigation rejects cross-origin, credential, query, and mutating paths", () => {
  for (const path of [
    "https://evil.example/chats/a",
    "https://name:password@product.example/chats/a",
    "https://product.example/chats/a?delete=true",
    "https://product.example/chats/a#delete",
    "https://product.example/settings",
    "https://product.example/chats/a/delete",
    "https://product.example/logout",
  ]) {
    assert.throws(() => navigationUrl(path, "https://product.example"));
  }
  assert.throws(() =>
    validateDecision(
      { action: "ready" },
      { ...observation, ready: true, url: "https://evil.example/chats/a" },
      "https://product.example",
    ),
  );
});

test("token and call budgets stop before the next billable generation", async () => {
  const tooLarge = fixture({ action: "stop" }, 39500);
  await assert.rejects(tooLarge.navigator.decide(observation), /token limit/);
  assert.equal(tooLarge.requests.length, 1);
  const bounded = fixture({ action: "stop" });
  for (let i = 0; i < 8; i++) await bounded.navigator.decide(observation);
  await assert.rejects(bounded.navigator.decide(observation), /call limit/);
  assert.equal(bounded.requests.length, 16);
  const foreign = fixture();
  await assert.rejects(
    foreign.navigator.decide({ ...observation, url: "https://evil.example/" }),
    /origin/,
  );
  assert.equal(foreign.requests.length, 0);
});

test("cancellation prevents API dispatch and failed API calls do not retry", async () => {
  const cancelled = fixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    cancelled.navigator.decide(observation, controller.signal),
  );
  assert.equal(cancelled.requests.length, 0);
  let calls = 0;
  const client = new Anthropic({
    apiKey: "synthetic-key",
    maxRetries: 0,
    fetch: async () => {
      calls++;
      return Response.json(
        {
          type: "error",
          error: { type: "rate_limit_error", message: "Synthetic rate limit" },
        },
        { status: 429 },
      );
    },
  });
  await assert.rejects(
    new ClaudeNavigator(
      client,
      "https://product.example",
      "Planning tips",
    ).decide(observation),
  );
  assert.equal(calls, 1);
});
