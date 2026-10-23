import { z } from "zod";

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
export const viewport = z
  .object({
    width: z.number().int().min(320).max(2560),
    height: z.number().int().min(240).max(1440),
  })
  .strict();
export const Target = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("role"),
      role: z.enum([
        "button",
        "heading",
        "textbox",
        "link",
        "dialog",
        "status",
        "region",
      ]),
      name: z.string().min(1).max(200),
    })
    .strict(),
  z
    .object({ kind: z.literal("label"), name: z.string().min(1).max(200) })
    .strict(),
]);
const condition = z
  .object({
    target: Target,
    state: z.enum(["visible", "hidden"]),
    text: z.string().max(2000).optional(),
  })
  .strict();
const action = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("navigate"), url: z.url() }).strict(),
  z
    .object({
      kind: z.literal("click"),
      target: Target,
      permission: z.enum(["read-only", "fixture-write", "send-chat"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("type"),
      target: Target,
      text: z.string().min(1).max(2000),
    })
    .strict(),
  z.object({ kind: z.literal("scroll"), target: Target }).strict(),
]);

const origin = z.enum(["http://127.0.0.1:4173", "https://kraftybot.app"]);
const permission = z.enum(["fixture-write", "send-chat"]);
export const WorkflowPlan = z
  .object({
    schemaVersion: z.literal(1),
    id,
    revision: id,
    authorizedOrigins: z.array(origin).length(1),
    initialState: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("disposable-fixture"),
          seed: z.literal("benchmark-v1"),
        })
        .strict(),
      z.object({ kind: z.literal("restored-auth"), secretRef: id }).strict(),
    ]),
    permissions: z.array(permission).max(2),
    steps: z
      .array(
        z
          .object({
            id,
            action,
            precondition: condition.optional(),
            postcondition: condition,
            timeoutMs: z.number().int().min(100).max(30000),
            // Only read-only and idempotent actions may be retried. Writes never retry.
            retries: z.number().int().min(0).max(2).default(0),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict()
  .superRefine((plan, ctx) => {
    const seen = new Set<string>();
    for (const [index, step] of plan.steps.entries()) {
      if (seen.has(step.id))
        ctx.addIssue({
          code: "custom",
          message: "Duplicate step ID",
          path: ["steps", index, "id"],
        });
      seen.add(step.id);
      if (step.action.kind === "navigate") {
        const url = new URL(step.action.url);
        if (
          !plan.authorizedOrigins.some((origin) => origin === url.origin) ||
          url.username ||
          url.password
        )
          ctx.addIssue({
            code: "custom",
            message: "Unauthorized navigation",
            path: ["steps", index],
          });
      }
      if (
        step.action.kind === "click" &&
        step.action.permission !== "read-only" &&
        (!plan.permissions.includes(step.action.permission) || step.retries > 0)
      )
        ctx.addIssue({
          code: "custom",
          message: "Writes require permission and cannot retry",
          path: ["steps", index],
        });
    }
  });
export type WorkflowPlan = z.infer<typeof WorkflowPlan>;
export type Target = z.infer<typeof Target>;

export const RunInput = z
  .object({
    url: z
      .url()
      .max(2048)
      .refine((value) => {
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          !url.username &&
          !url.password &&
          !url.hash &&
          (!url.port || url.port === "443")
        );
      }, "Use an HTTPS page without embedded credentials or a custom port."),
    email: z.email().max(320),
    password: z.string().min(1).max(1024),
    message: z.string().trim().min(1).max(1000),
    chatUrl: z.url().max(2048).optional(),
    consent: z.literal(true),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.chatUrl) {
      const url = new URL(input.chatUrl);
      if (
        url.origin !== new URL(input.url).origin ||
        url.username ||
        url.password ||
        url.hash
      )
        ctx.addIssue({
          code: "custom",
          message: "Chat page must belong to the same website.",
          path: ["chatUrl"],
        });
    }
  });
export type RunInput = z.infer<typeof RunInput>;

export const CaptureEvent = z
  .object({
    stepId: id,
    attempt: z.number().int().nonnegative(),
    phase: z.enum(["started", "verified", "failed"]),
    atMs: z.number().nonnegative(),
    coordinateSpace: z.literal("viewport-css-pixels"),
    box: z
      .object({
        x: z.number(),
        y: z.number(),
        width: z.number().nonnegative(),
        height: z.number().nonnegative(),
      })
      .strict()
      .nullable(),
    scroll: z.object({ x: z.number(), y: z.number() }).strict(),
    screenshot: z
      .string()
      .regex(/^[a-zA-Z0-9_-]+\.png$/)
      .optional(),
  })
  .strict();

export const BrowserFrameTiming = z
  .object({
    eventOriginUnixMs: z.number().positive(),
    firstFrameUnixMs: z.number().positive(),
    lastFrameUnixMs: z.number().positive(),
    firstFrameReceivedAtMs: z.number().nonnegative(),
    lastFrameReceivedAtMs: z.number().nonnegative(),
    frameCount: z.number().int().positive(),
    timestampRegressions: z.number().int().nonnegative(),
    largestTimestampRegressionMs: z.number().nonnegative(),
    alignment: z.literal("requires-review"),
  })
  .strict()
  .superRefine((timing, ctx) => {
    if (
      (timing.timestampRegressions === 0 &&
        timing.lastFrameUnixMs < timing.firstFrameUnixMs) ||
      timing.lastFrameReceivedAtMs < timing.firstFrameReceivedAtMs
    )
      ctx.addIssue({
        code: "custom",
        message: "Reversed browser frame timeline",
      });
    if (
      timing.timestampRegressions >= timing.frameCount ||
      (timing.timestampRegressions === 0) !==
        (timing.largestTimestampRegressionMs === 0)
    )
      ctx.addIssue({
        code: "custom",
        message: "Inconsistent browser frame regressions",
      });
  });
export type BrowserFrameTiming = z.infer<typeof BrowserFrameTiming>;

export const CaptureManifest = z
  .object({
    schemaVersion: z.literal(1),
    attemptId: id,
    workflowId: id,
    workflowRevision: id,
    status: z.enum(["verified", "failed"]),
    startedAt: z.iso.datetime(),
    elapsedMs: z.number().nonnegative(),
    environment: z
      .object({
        browser: z.string(),
        playwright: z.string(),
        node: z.string(),
        platform: z.string(),
        image: z.string(),
        locale: z.literal("en-US"),
        timezone: z.literal("UTC"),
        viewport,
        deviceScaleFactor: z.literal(1),
        headless: z.boolean(),
      })
      .strict(),
    media: z
      .object({
        path: z.literal("browser.webm"),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        bytes: z.number().int().positive(),
        recordingStartedAt: z.iso.datetime(),
        requestedFps: z.literal(60),
        // Optional for older captures. New captures retain raw frame observations.
        frameTiming: BrowserFrameTiming.optional(),
      })
      .strict(),
    events: z.array(CaptureEvent),
    evidence: z.array(
      z
        .object({
          stepId: id,
          screenshot: z.string(),
          atMs: z.number().nonnegative(),
        })
        .strict(),
    ),
    resources: z
      .object({
        userCpuMs: z.number().nonnegative(),
        systemCpuMs: z.number().nonnegative(),
        maxRssKb: z.number().nonnegative(),
        scope: z.literal("worker-process-only"),
      })
      .strict(),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    let previous = 0;
    for (const event of manifest.events) {
      if (
        manifest.media.frameTiming &&
        event.atMs < manifest.media.frameTiming.firstFrameReceivedAtMs
      )
        ctx.addIssue({
          code: "custom",
          message: "Action preceded first browser frame",
        });
      if (event.atMs < previous || event.atMs > manifest.elapsedMs)
        ctx.addIssue({
          code: "custom",
          message: "Invalid monotonic event timeline",
        });
      previous = event.atMs;
    }
    for (const evidence of manifest.evidence) {
      if (
        !manifest.events.some(
          (event) =>
            event.phase === "verified" &&
            event.stepId === evidence.stepId &&
            event.screenshot === evidence.screenshot &&
            event.atMs === evidence.atMs,
        )
      )
        ctx.addIssue({
          code: "custom",
          message: "Evidence must refer to a verified event",
        });
    }
  });
export type CaptureManifest = z.infer<typeof CaptureManifest>;
