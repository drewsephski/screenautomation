import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { verifyAuthenticatedPage, SessionExpiredFailure } from "./session.ts";
test("expired login is refused before recording while hidden autofill fields are ignored", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("https://product.example/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<main><input type="password" hidden><label>Message<textarea></textarea></label></main>',
      }),
    );
    await page.goto("https://product.example/chats/test");
    await verifyAuthenticatedPage(page, "https://product.example");
    await page
      .locator("input")
      .evaluate((element) => element.removeAttribute("hidden"));
    await assert.rejects(
      verifyAuthenticatedPage(page, "https://product.example"),
      SessionExpiredFailure,
    );
    await assert.rejects(
      verifyAuthenticatedPage(page, "https://other.example"),
      SessionExpiredFailure,
    );
  } finally {
    await browser.close();
  }
});
