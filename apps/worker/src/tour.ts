import { z } from "zod";
import type { Page } from "playwright";
import { DemoStory } from "@repo/contracts";

export const TourObservation = z
  .object({
    id: z.literal("tour"),
    url: z.url().max(2048),
    title: z.string().max(200),
    links: z
      .array(
        z
          .object({ label: z.string().min(1).max(160), url: z.url().max(2048) })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict();
export type TourObservation = z.infer<typeof TourObservation>;

export function tourPaths(origin: string) {
  const configured = process.env.BROWSER_TOUR_PATHS;
  return (
    configured
      ? configured.split(",")
      : origin === "https://kraftybot.app"
        ? ["/workspace", "/activity", "/apps", "/memory"]
        : []
  ).filter(
    (path) =>
      /^\/[a-zA-Z0-9/_-]{1,120}$/.test(path) &&
      !/(?:^|\/)(new|edit|delete|remove|logout|billing|upgrade|invite|send|purchase|connect|disconnect|settings)(?:\/|$)/i.test(
        path,
      ),
  );
}
export function tourUrl(value: string, origin: string, paths: string[]) {
  const url = new URL(value);
  if (
    url.origin !== origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !paths.includes(url.pathname)
  )
    throw new Error("Tour route is not enabled");
  return url.href;
}
export function validateStory(
  raw: unknown,
  observation: TourObservation,
  origin: string,
  paths: string[],
) {
  const story = DemoStory.parse(raw);
  const seen = new Set<string>();
  for (const scene of story.scenes) {
    tourUrl(scene.url, origin, paths);
    if (
      seen.has(scene.url) ||
      !observation.links.some((link) => link.url === scene.url)
    )
      throw new Error("Story must use distinct observed pages");
    seen.add(scene.url);
  }
  return story;
}
export async function observeTour(page: Page, origin: string, paths: string[]) {
  if (new URL(page.url()).origin !== origin)
    throw new Error("Unexpected tour origin");
  await page
    .locator("main, [role=main]")
    .first()
    .waitFor({ state: "visible", timeout: 20000 });
  const links = await page.locator("a[href]").evaluateAll((elements) =>
    elements
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return (
          box.width > 0 &&
          box.height > 0 &&
          getComputedStyle(element).visibility !== "hidden"
        );
      })
      .slice(0, 200)
      .map((element) => ({
        label: [element.getAttribute("aria-label"), element.textContent]
          .filter(Boolean)
          .join(" ")
          .trim()
          .slice(0, 160),
        url: (element as HTMLAnchorElement).href,
      })),
  );
  links.unshift({
    label: (await page.title()).slice(0, 160) || "Current page",
    url: page.url(),
  });
  const allowed = links
    .filter((link) => {
      try {
        tourUrl(link.url, origin, paths);
        return !!link.label;
      } catch {
        return false;
      }
    })
    .filter(
      (link, index, all) =>
        all.findIndex((other) => other.url === link.url) === index,
    )
    .slice(0, 30);
  return TourObservation.parse({
    id: "tour",
    url: new URL(page.url()).origin + new URL(page.url()).pathname,
    title: (await page.title()).slice(0, 200),
    links: allowed,
  });
}
