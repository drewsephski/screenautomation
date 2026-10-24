import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { originAllowed, startEgressProxy } from "./proxy.ts";

test("redirects cannot connect to unapproved origins, even when route continuation would bypass interception", async () => {
  const proxy = await startEgressProxy({
    "https://approved.example": ["93.184.216.34"],
  });
  const browser = await chromium.launch({
    headless: true,
    proxy: { server: proxy.url, bypass: "<-loopback>" },
    args: ["--disable-http2"],
  });
  try {
    const page = await browser.newPage();
    await page.route("https://approved.example/", (route) =>
      route.fulfill({
        status: 302,
        headers: { Location: "https://unapproved.example/" },
      }),
    );
    await assert.rejects(
      page.goto("https://approved.example/", { timeout: 5000 }),
    );
    assert.notEqual(new URL(page.url()).hostname, "unapproved.example");
  } finally {
    await browser.close();
    await proxy.close();
  }
});

test("wildcard origins match one generated subdomain, never the bare suffix, other hosts, or custom ports", () => {
  const patterns = [
    "https://kraftybot.app",
    "https://*.client.protect.clerk.com",
  ];
  assert.equal(originAllowed("https://kraftybot.app", patterns), true);
  assert.equal(
    originAllowed("https://1-abc-p.client.protect.clerk.com", patterns),
    true,
  );
  assert.equal(
    originAllowed("https://client.protect.clerk.com", patterns),
    false,
  );
  assert.equal(
    originAllowed("https://1-abc-p.client.protect.clerk.com:8443", patterns),
    false,
  );
  assert.equal(
    originAllowed("https://evilclient.protect.clerk.com", patterns),
    false,
  );
  assert.equal(originAllowed("https://sub.kraftybot.app", patterns), false);
});
