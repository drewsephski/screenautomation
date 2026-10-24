import { z } from "zod";

export const NavigationObservation = z
  .object({
    id: z.string().regex(/^(login|capture)-[0-7]$/),
    url: z.url().max(2048),
    title: z.string().max(200),
    ready: z.boolean(),
    links: z
      .array(
        z
          .object({
            label: z.string().max(160),
            url: z.url().max(2048),
          })
          .strict(),
      )
      .max(60),
  })
  .strict();
export type NavigationObservation = z.infer<typeof NavigationObservation>;

export const NavigationDecision = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("open"),
      index: z.number().int().min(0).max(59),
    })
    .strict(),
  z.object({ action: z.literal("ready") }).strict(),
  z.object({ action: z.literal("stop") }).strict(),
]);
export type NavigationDecision = z.infer<typeof NavigationDecision>;

// Discovery only opens conventional read-only pages. No arbitrary URLs, query
// strings, form submissions, account mutations, or model-generated selectors.
export function navigationUrl(value: string, origin: string) {
  const url = new URL(value);
  if (
    url.origin !== origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Navigation URL is not permitted");
  if (
    !/^\/(?:workspace|(?:chats|chat|conversations|conversation)(?:\/[a-zA-Z0-9_-]+)?)\/?$/.test(
      url.pathname,
    ) ||
    /\/(?:new|create|delete|remove|archive|logout|settings)\/?$/i.test(
      url.pathname,
    )
  )
    throw new Error("Navigation path is not permitted");
  return url.href;
}

export function validateDecision(
  decision: NavigationDecision,
  observation: NavigationObservation,
  origin: string,
) {
  if (new URL(observation.url).origin !== origin)
    throw new Error("Unexpected observation origin");
  if (decision.action === "ready" && !observation.ready)
    throw new Error("Chat controls are not ready");
  if (decision.action === "ready") navigationUrl(observation.url, origin);
  if (decision.action === "open") {
    const link = observation.links[decision.index];
    if (!link) throw new Error("Unknown navigation target");
    navigationUrl(link.url, origin);
  }
  return decision;
}
