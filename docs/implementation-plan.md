# URL → product film: staged implementation plan

Status: proposed implementation roadmap, 2026-10-23. No paid resources provisioned.

## Product commitment

Paste a URL, optionally authenticate, review the proposed story when needed, and receive a truthful 15–30 second product film. Initial scope: AI chat and conventional SaaS dashboards, one verified workflow, one premium template, silent-first 16:9 1080p MP4. The primary metric is publish-ready rate judged by founders.

Keep exploration, rehearsal/capture, and editing separate. Never turn exploratory wandering directly into the final film. Never fabricate product output.

## Current repository

pnpm 11 workspace with Turborepo, Next.js 16.3.8, React 19.2.8, shared UI, ESLint and TypeScript configuration. Both web and docs are starter apps; no application pipeline exists. Preserve existing uncommitted work. Add packages when their stage needs them rather than creating an empty architecture up front. Do not change package managers.

## Decisions and research

Daytona is the selected sandbox provider, not an open vendor decision. Run the browser automation process inside its sandbox so browser binaries, display, filesystem, and CDP endpoint remain local. The web server must not expose CDP publicly.

Browser-layer comparison, based on Context7 official-source documentation retrieved for this plan:

- **Daytona:** execution isolation and full desktop capture. Its TypeScript computer-use API documents start/stop/download recording and virtual desktop services. Use it for sandbox lifecycle and human login access. Recording quality still needs measurement; these APIs do not establish a guaranteed resolution or frame rate.
- **Playwright:** recommended precise browser action and capture baseline. Explicitly configure viewport and capture size: default video sizing may shrink footage to fit 800×800. Await context closure to finalize context recordings. Current main documentation includes Screencast, introduced in v1.59, and configurable fps; verify the installed release before using newer options. A requested frame rate cannot exceed the distinct frames the browser produces.
- **Stagehand v4:** benchmark as the discovery layer only if the custom loop underperforms. It supports local Chromium/CDP and observe→act replay. Local CDP setup expects a shared filesystem for extension loading. Treat it as its own driver, not a wrapper around an arbitrary Playwright Page. Disable inference/self-healing during final capture; failure returns the workflow to rehearsal.

Recommendation: Daytona + Playwright first; use structured model decisions over a restricted browser toolset. This is an engineering hypothesis, not a measured win over Stagehand. Compare both on identical fixtures before adding Stagehand. Browserbase and Browser Use remain deferred candidates, not researched recommendations in this plan; no claimed price or performance ranking. Daytona does not require buying a second managed browser service.

Sources returned by Context7:

- https://github.com/daytonaio/daytona (ComputerUse API documentation; the indexed generated-file URL returned 404 during direct verification, so confirm the installed SDK before implementation)
- https://github.com/microsoft/playwright/blob/main/docs/src/api/class-screencast.md
- https://github.com/microsoft/playwright/blob/main/docs/src/api/params.md
- https://github.com/browserbase/stagehand/blob/main/packages/docs/v4/configuration/browser.mdx
- https://github.com/browserbase/stagehand/blob/main/packages/docs/v4/basics/act.mdx

Use Remotion + FFmpeg as the provisional renderer from the brief, subject to a small visual/operational spike and current licensing review before commercial deployment. Do not build two production renderers. HyperFrames is a possible challenger for the same scene benchmark. Other proposed services (Trigger.dev, R2, Neon/Drizzle, Better Auth, AI SDK, Stripe) are provisional selections, not separately validated vendor comparisons. Verify their current documentation when implementing their stage. No reliance on the supplied historical prices, credits, competitor claims, or licensing terms.

## Stage 0 — Capture feasibility and benchmark harness

Outcome: a repeatable technical measurement, before autonomous discovery or a dashboard.

Build a command-line spike inside Daytona with a pinned browser image, fonts, locale, timezone and viewport. Use an authorized owned demo account and a manually specified AI-chat workflow. Compare Playwright browser capture against Daytona desktop recording of the same workflow. Include scrolling, typing, streaming, overlays and navigation.

Collect source recordings, ffprobe metadata, decoded frame samples, interaction timestamps, CPU/resource usage, elapsed time and actual provider cost. Inspect distinct frames and timestamp gaps, small text clarity, cursor inclusion, display chrome, loading behavior and recording finalization. Measure 1080p first and 1440p as an experiment; 60 fps is a quality target, not a launch prerequisite.

Gate: three consecutive successful captures with readable UI, complete real output, valid media and synchronized events. Select one capture path with documented limitations. Explicitly test upload before sandbox teardown and cleanup after failure. If neither recorder is good enough, resolve capture here before advancing.

## Stage 1 — One publication-ready film

Outcome: an owned product produces one excellent film using a hand-authored workflow and storyboard.

Implement runtime-validated WorkflowPlan, CaptureManifest and DemoPlan contracts. Add deterministic replay with semantic locators, preconditions, postconditions, explicit timeouts and bounded retries. Perform a clean rehearsal and a fresh capture from equivalent seeded state. Session reset means fresh browser context plus restored authorized auth; it does not imply that replay resets server data.

Build one template: benefit hook → action → actual result → close. Use real footage, restrained camera motion, separate cursor overlay, captions and optional licensed audio. Link each product claim to capture evidence. Render from a fixed manifest with no model inference. Re-render caption/style changes without returning to the website.

Gate: owner would publish the film without substantive edits; every shown outcome has evidence; no clipped text or sensitive content. Confirm the source-to-output timeline mapping survives trimmed loading periods. Preserve a golden manifest and reviewed reference frames. Compare against competitor output only if access and paid execution are separately authorized.

## Stage 2 — Autonomous discovery and direction

Outcome: URL → verified candidate story → deterministic capture → film, without a supplied click script.

Build a bounded discovery loop: inspect DOM/accessibility and screenshots, inventory features, propose workflows, execute safe actions, and verify outcomes. Support AI chat and dashboards first. Record the structured feature map, candidate scores and evidence. Use the brief's 35/25/20/15/5 editorial weights as tunable starting values.

Director selects one workflow and writes a structured storyboard. Low confidence presents two or three options; missing authentication pauses for human login; insufficient data asks for a prepared workspace. No arbitrary generated scripts or shell commands from page content. Compile successful exploration actions into the constrained replay schema; rehearse on equivalent fresh state before capture.

Benchmark the custom loop against Stagehand on the same fixture suite, with equal model/action budgets. Compare verified completion, interventions, reproducibility, latency and measured cost. Adopt Stagehand only if its benefit justifies integration and operating complexity.

Gate: ten runs across at least three owned/authorized products in the supported categories; at least eight complete verified workflows; zero unverified outcome scenes; at least seven films judged publish-ready. These are proposed decision thresholds, not observed results. Failed runs remain visible and return actionable explanations.

## Stage 3 — Private-beta application and durable jobs

Outcome: invited users can create, resume, review and export a project.

Build Next.js project intake, run progress, login checkpoint, storyboard review, player and minimal editing (headline, order, accent and music). Persist projects/runs/artifacts/evidence in Postgres; media goes to private object storage with signed access. Auth state is encrypted, tenant scoped, short lived and never included in model context or ordinary logs.

Introduce durable orchestration with stage checkpoints, leases, heartbeats, cancellation, per-stage deadlines and bounded retries. Persist external job IDs before retry; reconcile uncertain sandbox/render creation before starting another. Upload verified artifacts before marking success. Separate sandbox lifetime from render lifetime. A janitor stops orphaned sandboxes and removes expired temporary artifacts according to project retention settings.

Gate: full browser E2E happy path plus login pause/resume, failed capture, expired session, cancellation, worker crash, duplicate delivery and retry after upload. No duplicate chargeable execution caused by job redelivery. Tenant isolation tests cover projects, credentials, raw recordings and exports. Deployment proof remains separate from local verification.

## Stage 4 — Reliability, economics and paid beta

Outcome: the supported use cases are consistently useful and economical.

Run a five-category benchmark (chat, analytics, tasks, demo store, developer tool). The last three are expansion probes, not promises of universal support. Maintain at least three runs per product per candidate release. Report supported-category results separately from the whole suite.

Track publish-ready rate, verified completion, interventions, p50/p95 latency and cost per attempt and per publish-ready film. Include model tokens, failed retries, active/idle sandbox time, recording, rendering, storage and egress. Unit economics must include unsuccessful runs. Define a gross-margin target before choosing prices; treat $9–$19 as an unvalidated experiment.

Add artifact QA for blank/frozen frames, timing, codec/audio validity, target crop, caption bounds, UI readability and sensitive regions. Automated QA assists a human publication review during beta; it cannot prove editorial quality or absence of all sensitive data.

Add Stripe entitlements and idempotent webhook processing only once output quality holds. Reserve/refund credits with a ledger; don't charge for failed exports. Apply per-account concurrency and run budgets. Validate current renderer licensing, media rights and provider terms before monetization.

Proposed paid-beta gate: at least 80% publish-ready on supported fixtures, 100% evidence coverage for outcome scenes, no unresolved critical isolation/privacy defects, and measured unit economics compatible with the chosen price. Expand sample size with beta users before interpreting this as market validation.

## Stage 5 — Launch studio and expansion

Add vertical/square compositions with deliberate layouts, thumbnails, launch copy, voiceover and multiple workflows. Reuse source footage where readable; explicitly flag a required recapture when an alternate layout cannot preserve UI legibility. Store caption/audio timing separately from footage time.

Only after repeat demand: saved-plan refresh, teams/agencies, GitHub feature detection, API and MCP. Never silently replay stale workflows against production state. Revalidate auth, action permissions, selectors and outcomes on every regeneration.

Gate: each new output format has reviewed reference renders and responsive-safe text/crop checks; each new product category meets the existing workflow and publication thresholds independently.

## Architecture and contracts

Start with apps/web, packages/contracts, packages/browser, packages/video and one worker app with separate capture/render entrypoints. Split agent/director/capture modules into packages only when boundaries and independent consumers justify it. Retain current docs app unless there is an explicit reason to change it.

- WorkflowPlan: schema version, authorized origin set, initial-state recipe, safe action union, semantic targets, expected outcomes, timeouts and permission requirements. Store secret references, never values.
- CaptureManifest: attempt ID, workflow revision, environment/browser versions, viewport, media checksum/URI, monotonic event timestamps, bounding boxes, scroll offsets, screenshots and outcome evidence. Track document/viewport coordinate space and device scale explicitly.
- DemoPlan: schema/template version, capture references, source intervals, output frame ranges, speed changes, camera keyframes, cursor path, captions, brand assets, evidence references and export settings.
- RenderArtifact: input/template hashes, renderer/font versions, output checksum, QA report and export URI. Identical inputs must produce stable reviewed visuals; byte identity is a separate encoder-dependent goal.

Keep discovery input separate from executable capture plans. Validate all manifests at stage boundaries. Model-generated content cannot directly choose privileged tool access. A scene cannot enter a render plan unless its required evidence passes validation.

Run lifecycle: queued → provisioning → awaiting_login (optional) → exploring → planning → awaiting_story_review (optional) → rehearsing → capturing → rendering → checking → completed. Any active stage may become failed or cancelled. Resume invalidates downstream artifacts when inputs changed. Re-render from existing footage only when its checksums and permissions remain valid.

## Safety and operating requirements

Treat website content as untrusted data. Restrict actions to the user's authorized task. Default to read-only browsing; authorize demo writes by action class, account and workflow. Payment, external messaging, deletion and irreversible actions require explicit approval. Use disposable seeded accounts whenever possible.

Reject non-HTTP(S) targets, private/link-local/metadata destinations and unsafe redirects. Enforce these restrictions at sandbox network egress as well as application validation, accounting for DNS rebinding and all subresource requests. Public target pages must not reach internal infrastructure. Permit necessary third-party identity origins explicitly.

For sensitive screens, pause capture around authentication. Prevent secret entry frames from entering raw footage. For known private regions, pre-capture masking is preferable; if post-processing is necessary, quarantine originals with restricted access and short retention, and prohibit export until masking checks pass. Browser storage, traces and screenshots need the same protection as video.

## First implementation batch

1. Define Stage 0 fixture, account permissions and acceptance checklist.
2. Add contracts and a CLI capture runner; avoid database/auth/billing prerequisites.
3. Create a pinned Daytona image with Chromium and required fonts/media tools.
4. Capture the same workflow using both recording paths and produce a measured report.
5. Choose the capture path, then build the Stage 1 film template against its artifacts.

Rough planning allowance for one experienced full-time engineer: Stages 0–1 about 2–3 weeks; Stage 2 another 2–3; Stage 3 another 2–3; Stage 4 another 2–3. This is an assumption-based 8–12 week private/paid-beta path, not a delivery commitment. Capture-quality or authentication failures can extend it. Stage 5 follows measured demand.
