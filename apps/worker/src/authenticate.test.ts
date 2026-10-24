import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { SignInFailure, signInWithCredentials } from "./authenticate.ts";

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

// Mirrors Clerk: an unfocusable autofill password sits in an aria-hidden,
// zero-height container that Playwright still reports as visible.
const clerkLike = (afterPassword: string) => `
<label>Email address<input name="identifier" autocomplete="email"></label>
<div aria-hidden="true" style="position:absolute;height:0;opacity:0;overflow:hidden"><input type="password" tabindex="-1"></div>
<div id="step"></div>
<button id="go">Continue</button>
<output></output>
<script>
const step = document.querySelector('#step');
let stage = 'email';
document.querySelector('#go').onclick = () => {
  if (stage === 'email') {
    stage = 'password';
    step.innerHTML = '<label>Password<input id="pw" type="password"></label>';
  } else if (stage === 'password') {
    const value = document.querySelector('#pw').value;
    step.innerHTML = ${JSON.stringify(afterPassword)};
    stage = 'next';
    if (value !== 'right-password') step.innerHTML = '<p role="alert">Password is incorrect. Try again, or use another method.</p>';
    const code = document.querySelector('[autocomplete="one-time-code"]');
    if (code) code.oninput = () => { if (code.value.length === 6) { document.querySelector('output').textContent = 'code:' + code.value; step.innerHTML = ''; } };
  }
};
</script>`;

test("a Clerk-style form waits for the real password step and relays a one-time code", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("https://clerk-like.example/", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: clerkLike(
          '<h2>Check your email</h2><input autocomplete="one-time-code" maxlength="6">',
        ),
      }),
    );
    const steps: string[] = [];
    const kinds: string[] = [];
    await signInWithCredentials(
      page,
      "https://clerk-like.example/",
      { email: "demo@example.com", password: "right-password" },
      {
        step: async (label) => {
          steps.push(label);
        },
        requestCode: async (kind) => {
          kinds.push(kind);
          return "123456";
        },
      },
    );
    assert.equal(await page.locator("output").innerText(), "code:123456");
    assert.deepEqual(kinds, ["email"]);
    assert.ok(steps.includes("Entering password"));
    assert.ok(steps.includes("Waiting for your verification code"));
  } finally {
    await browser.close();
  }
});

test("a rejected password becomes a specific reason without echoing page text", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("https://clerk-like.example/", (route) =>
      route.fulfill({ contentType: "text/html", body: clerkLike("") }),
    );
    await assert.rejects(
      signInWithCredentials(page, "https://clerk-like.example/", {
        email: "demo@example.com",
        password: "wrong-password",
      }),
      (error) =>
        error instanceof SignInFailure &&
        error.message ===
          "clerk-like.example rejected the password for this account. Check it and start a new capture.",
    );
  } finally {
    await browser.close();
  }
});
