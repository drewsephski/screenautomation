import type { Page } from "playwright";
export class SessionExpiredFailure extends Error {}
export async function verifyAuthenticatedPage(page: Page, origin: string) {
  if (
    new URL(page.url()).origin !== origin ||
    (await page
      .locator('input[type=password],input[autocomplete="one-time-code"]')
      .filter({ visible: true })
      .count())
  )
    throw new SessionExpiredFailure(
      "The website asked to sign in again before recording. Start a new capture with a current login.",
    );
}
