import type { Page } from "playwright";

export async function signInWithCredentials(
  page: Page,
  targetUrl: string,
  credentials: { email: string; password: string },
) {
  await page.goto(
    new URL(targetUrl).hostname === "kraftybot.app"
      ? `${new URL(targetUrl).origin}/sign-in?redirect_url=%2Fworkspace`
      : targetUrl,
    { waitUntil: "domcontentloaded" },
  );
  const email = page.locator(
    'input[type="email"], input[autocomplete="username"], input[name="identifier"]',
  );
  await email.first().waitFor({ state: "visible" });
  if (new URL(page.url()).origin !== new URL(targetUrl).origin)
    throw new Error("Unexpected login origin");
  await email.first().fill(credentials.email);
  const password = page.locator('input[type="password"]:visible');
  if (!(await password.count()))
    await page
      .getByRole("button", { name: /^(continue|next|sign in|log in)$/i })
      .click();
  await password.first().waitFor({ state: "visible" });
  if (new URL(page.url()).origin !== new URL(targetUrl).origin)
    throw new Error("Unexpected password origin");
  await password.first().fill(credentials.password);
  await page
    .getByRole("button", { name: /^(continue|sign in|log in|login)$/i })
    .click();
  credentials.password = "";
  credentials.email = "";
  if (new URL(targetUrl).hostname === "kraftybot.app")
    await page.waitForURL("**/workspace**", { timeout: 60000 });
  else
    await page
      .locator('input[type="password"]:visible')
      .waitFor({ state: "hidden", timeout: 60000 });
}
