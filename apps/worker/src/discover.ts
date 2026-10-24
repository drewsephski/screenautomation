import type { Page } from "playwright";
import {
  NavigationDecision,
  NavigationObservation,
  navigationUrl,
  validateDecision,
} from "./navigation-contract.ts";

export async function observeNavigation(
  page: Page,
  id: string,
  origin: string,
) {
  if (new URL(page.url()).origin !== origin)
    throw new Error("Unexpected page origin");
  // Never expose form values, body text, cookies, credentials, or screenshots
  // to inference. Only visible link names and approved navigation paths.
  const candidates = await page.locator("a[href]").evaluateAll((elements) =>
    elements
      .filter((element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return (
          box.width > 0 &&
          box.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none"
        );
      })
      .slice(0, 300)
      .map((element) => ({
        label: [element.getAttribute("aria-label"), element.textContent]
          .filter(Boolean)
          .join(" ")
          .trim()
          .slice(0, 160),
        url: (element as HTMLAnchorElement).href,
      })),
  );
  const links = candidates
    .filter((link) => {
      try {
        navigationUrl(link.url, origin);
        return (
          link.url !== new URL(page.url()).origin + new URL(page.url()).pathname
        );
      } catch {
        return false;
      }
    })
    .filter(
      (link, index, all) =>
        all.findIndex((other) => other.url === link.url) === index,
    )
    .slice(0, 60);
  return NavigationObservation.parse({
    id,
    url: new URL(page.url()).origin + new URL(page.url()).pathname,
    title: (await page.title()).slice(0, 200),
    ready:
      (await page
        .getByRole("textbox", { name: "Message", exact: true })
        .isVisible()) &&
      (await page
        .getByRole("button", { name: /^(submit|send|send message)$/i })
        .isVisible()),
    links,
  });
}

/** Re-observe and verify each model choice; page data never becomes executable code. */
export async function discoverChat(
  page: Page,
  origin: string,
  phase: "login" | "capture",
  decide: (observation: NavigationObservation) => Promise<unknown>,
  step: (label: string) => Promise<void>,
) {
  for (let turn = 0; turn < 8; turn++) {
    await step("Claude is inspecting the workspace");
    // Allow asynchronously loaded navigation to settle without depending on
    // networkidle (chat applications often maintain long-lived connections).
    await page
      .locator('a[href], [role="textbox"], textarea')
      .first()
      .waitFor({ state: "attached", timeout: 10000 });
    // The sidebar arrives before the asynchronously loaded chat. Do not ask
    // Claude to navigate away while the message controls are still mounting.
    if (
      /^\/(?:chats|chat|conversations|conversation)\/[^/]+\/?$/.test(
        new URL(page.url()).pathname,
      )
    ) {
      await page
        .getByRole("textbox", { name: "Message", exact: true })
        .waitFor({ state: "visible", timeout: 20000 });
      await page
        .getByRole("button", { name: /^(submit|send|send message)$/i })
        .waitFor({ state: "visible", timeout: 20000 });
    }
    let observation = await observeNavigation(page, `${phase}-${turn}`, origin);
    const deadline = Date.now() + 10000;
    while (
      !observation.ready &&
      !observation.links.length &&
      Date.now() < deadline
    ) {
      await page.waitForTimeout(250);
      observation = await observeNavigation(page, `${phase}-${turn}`, origin);
    }
    const decision = validateDecision(
      NavigationDecision.parse(await decide(observation)),
      observation,
      origin,
    );
    if (decision.action === "stop")
      throw new Error("Claude could not find a safe existing chat");
    const current = await observeNavigation(page, observation.id, origin);
    if (current.url !== observation.url)
      throw new Error("Page changed during Claude navigation");
    if (decision.action === "ready") {
      validateDecision(decision, current, origin);
      return;
    }
    // Resolve the current DOM again. A disappeared/changed link is not a license
    // to navigate to the model's stale target or retry a potentially unsafe act.
    const target = observation.links[decision.index]!;
    if (!current.links.some((link) => link.url === target.url))
      throw new Error("Navigation target changed");
    await step("Claude is opening an existing chat page");
    await page.goto(navigationUrl(target.url, origin), {
      waitUntil: "domcontentloaded",
    });
    if (new URL(page.url()).origin !== origin)
      throw new Error("Chat navigation redirected outside the website");
  }
  throw new Error("Claude navigation step limit reached");
}
