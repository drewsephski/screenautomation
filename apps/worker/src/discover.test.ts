import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { discoverChat, observeNavigation } from "./discover.ts";
import type { NavigationObservation } from "./navigation-contract.ts";

test("AI navigation observes only approved link metadata and reaches the verified composer without sending", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    let sends = 0;
    await page.route("https://product.example/**", (route) => {
      if (route.request().method() !== "GET") sends++;
      return route.fulfill({
        contentType: "text/html",
        body: route.request().url().includes("/chats/")
          ? '<label>Message<textarea></textarea></label><button aria-label="Send">Send</button>'
          : `<title>Workspace</title><input type="password" value="never-share-this"><p>private body text</p>
          <a href="/workspace">Home</a><a href="/chats/planning">Planning assistant</a>
          <a href="/chats/new">Create</a><a href="/chats/old/delete">Delete</a>
          <a href="https://evil.example/chats/a">External</a><a href="/chats/token?secret=value">Token</a>
          <a style="display:none" href="/chats/hidden">Hidden</a>`,
      });
    });
    await page.goto(
      "https://product.example/workspace?session=never-share-this",
    );
    const initial = await observeNavigation(
      page,
      "login-0",
      "https://product.example",
    );
    assert.equal(initial.links.length, 1);
    assert.equal(initial.url, "https://product.example/workspace");
    assert.doesNotMatch(
      JSON.stringify(initial),
      /never-share|private body|secret=value/,
    );
    const observations: NavigationObservation[] = [];
    await discoverChat(
      page,
      "https://product.example",
      "login",
      async (observation) => {
        observations.push(observation);
        return observation.ready
          ? { action: "ready" }
          : { action: "open", index: 0 };
      },
      async () => {},
    );
    assert.equal(observations.length, 2);
    assert.equal(page.url(), "https://product.example/chats/planning");
    assert.equal(
      await page.getByRole("textbox", { name: "Message" }).inputValue(),
      "",
    );
    assert.equal(sends, 0);
  } finally {
    await browser.close();
  }
});

test("an invalid model choice stops before navigation", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("https://product.example/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<a href="/chats/planning">Planning</a>',
      }),
    );
    await page.goto("https://product.example/workspace");
    await assert.rejects(
      discoverChat(
        page,
        "https://product.example",
        "login",
        async () => ({ action: "open", index: 59 }),
        async () => {},
      ),
      /Unknown navigation/,
    );
    assert.equal(page.url(), "https://product.example/workspace");
  } finally {
    await browser.close();
  }
});
