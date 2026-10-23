import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { signInWithCredentials } from "./authenticate.ts";

test("the browser signs in through a two-step email/password form and refuses credentials after an origin redirect", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("https://login.example/", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<label>Email<input type="email"></label><button onclick="this.remove();document.querySelector('#password').hidden=false">Continue</button><div id="password" hidden><label>Password<input type="password"></label><button onclick="document.querySelector('output').textContent=document.querySelector('input[type=email]').value+':'+document.querySelector('input[type=password]').value;document.querySelector('#password').remove()">Sign in</button></div><output></output>`,
      }),
    );
    const credentials = {
      email: "demo@example.com",
      password: "test-password",
    };
    await signInWithCredentials(page, "https://login.example/", credentials);
    assert.equal(
      await page.locator("output").innerText(),
      "demo@example.com:test-password",
    );
    assert.deepEqual(credentials, { email: "", password: "" });
    await page.route("https://redirect.example/", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<script>location.replace("https://login.example/")</script>',
      }),
    );
    await assert.rejects(
      signInWithCredentials(page, "https://redirect.example/", {
        email: "must-not-leak@example.com",
        password: "do-not-leak",
      }),
      /Unexpected login origin/,
    );
    assert.equal(await page.locator('input[type="email"]').inputValue(), "");
  } finally {
    await browser.close();
  }
});
