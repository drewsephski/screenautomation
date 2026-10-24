# Claude navigation

## Decision

Use the official `@anthropic-ai/sdk` TypeScript client, direct Claude API billing,
and the existing Playwright browser in Daytona. The installed SDK is pinned to
1.2.0. The default model is `claude-haiku-5-5`; `ANTHROPIC_MODEL` can select another
model available to the API key's organization. Live Haiku 5.5 access was verified
with the configured key on October 24, 2026; see the live smoke test below.

The Haiku 5.5 request uses a named `tool_choice` to return one navigation action
without a thinking block. Its
[migration notes](https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide)
explicitly support this mode. Application validation still checks every action.
A Sonnet 5.5 override retains its compatible auto-tool/low-effort settings; other
model overrides require separate validation.

Research checked on October 24, 2026:

- [Anthropic's SDK comparison](https://code.claude.com/docs/en/agent-sdk/overview)
  distinguishes the client SDK (direct API and custom tool loops) from the Agent
  SDK (the Claude Code binary, tools, hooks, and sessions). This application
  already owns its browser, queue, permissions, and recording lifecycle, so a
  Claude Code subprocess adds capabilities it does not need.
- [Anthropic's browser tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/browser-use-tool)
  supports page structure and screenshots; Anthropic recommends it over desktop
  computer use when work stays inside webpages. The
  [SDK toolsets](https://platform.claude.com/docs/en/agents-and-tools/tool-use/browser-use-sdk)
  still require an application-supplied driver. This first integration uses one
  custom, validated navigation tool rather than implementing a general browser
  driver and its full action surface.
- [Computer use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool)
  is appropriate for applications without browser semantics. It requires
  screenshot/coordinate handling and stronger desktop action controls. There is
  no measured evidence that it improves this app's conventional chat navigation;
  it is not enabled in this implementation.
- [Stagehand](https://docs.stagehand.dev/v3/configuration/models) can use models
  through multiple providers. Its Browserbase Model Gateway bills Browserbase,
  which is not the desired route for spending Claude Platform credits. Direct
  provider configuration is possible, but another browser agent dependency is
  unnecessary for this bounded workflow. No performance benchmark against
  Stagehand or desktop computer use has been run.
- [Claude API credits](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers)
  apply to the linked Claude Console organization, including direct API use.
  Claim/link the credit first, then create a key in that organization. Requests
  through unrelated gateways or separately billed cloud providers do not draw
  from that balance. All keys in that organization share its credit balance.

## Implemented flow

1. Existing deterministic sign-in handles email, password, and verification codes.
2. With Claude enabled and no explicit chat URL, the browser publishes a bounded
   observation: page title/path, visible approved link labels/URLs, and whether
   the known chat controls are visible. Query strings, form values, body text,
   screenshots, cookies, and storage state are not part of the observation.
3. The worker sends that observation and the user's exact message to Claude.
   Claude chooses a link index, reports readiness, or stops. Page content is
   framed as untrusted data; application validation enforces action boundaries.
4. The browser rechecks the choice against its current DOM and opens the selected
   same-origin page. Discovery supports `/workspace`, chat/conversation listing
   paths, and a single existing ID beneath those paths. Known mutation paths,
   nested routes, query strings, fragments, and external URLs are refused.
5. Once the known `Message` textbox and Send/Submit button are visible, the
   verified URL stays inside the sandbox. Rehearsal reopens that same URL without
   another model call. Recording uses the existing deterministic, single-send
   flow and waits for the actual target application's completed reply.

This is real model-directed chat discovery, not a general dashboard agent, film
director, renderer, arbitrary-site sign-in agent, or automatic message writer.
The existing supported composer/reply selectors still apply. Only deployment-
approved websites can be used. Use prepared demo data: page and chat titles may
themselves contain private information. A GET route is not inherently read-only;
the operator must approve the target app's route semantics as well as its origin.

## Configure

Set these in the **worker service's private environment**:

```dotenv
CLAUDE_NAVIGATION=true
ANTHROPIC_API_KEY=<key from the organization holding your credits>
ANTHROPIC_MODEL=claude-haiku-5-5
```

Do not put the key in a `NEXT_PUBLIC_` variable, the web form, sandbox config,
committed files, or conversation. The API client explicitly uses
`https://api.anthropic.com`; the browser firewall does not need an Anthropic
exception. The worker and browser exchange private JSON files; the API key never
enters the sandbox. Existing worker startup must receive these environment
variables from the process/deployment environment; `start` does not automatically
load the root `.env.local`.

With `CLAUDE_NAVIGATION=false` or unset, scripted discovery remains available.
An explicit chat URL bypasses inference even when Claude discovery is enabled.
Enabling Claude without a key fails before provisioning a sandbox. Changes need
a worker rebuild/restart; do not enable production before setting the private
key and verifying model access. The web copy explains what automatic discovery
shares with Anthropic.

## Limits and evidence

- At most eight generations per run, 512 output tokens per generation, and a
  40,000-token preflight budget shared across observations. The count-tokens API
  is called before generation; the budget includes previous reported usage plus
  the next input estimate and maximum output allowance. Token counts are not a
  dollar balance check or an organization-wide spending limit.
- SDK retries are disabled. Each API operation has a 25-second timeout; a browser
  decision waits at most 65 seconds. Cancellation/lease loss aborts inference.
  An uncertain chat send is never automatically replayed.
- The [published model prices](https://platform.claude.com/docs/en/about-claude/pricing)
  list Haiku 5.5 at $0.10 per million input tokens and $0.50 per million output
  tokens for prompts up to 100,000 tokens (above this app's per-run budget).
  An example decision with 2,000 input and 100 output tokens is about $0.00025.
  This is an estimate, not measured run cost. Daytona, storage, and target-app AI
  usage are separate. Set a Claude Console workspace spending limit to control
  total consumption; this app does not read the remaining $100 credit balance.
- Successful archives include `claude-usage.json` with model, generation count,
  and reported input/output tokens. Worker logs emit the same metadata on run
  completion/failure. Failed API requests may have unknown usage; reconcile with
  the Claude Console. Prompts, page titles, and API responses are not logged.
- Local tests use a synthetic HTTP transport for the Anthropic SDK and real
  Playwright pages for browser navigation. They establish action validation,
  budget enforcement, metadata filtering, and no sends during discovery; they
  do not establish model quality, access to credits, live login, production
  deployment, billed cost, or real-product capture quality.

The next live check is one owner-authorized capture with a key from the linked
organization and a prepared Krafty demo account. Compare the chosen chat and
`claude-usage.json` with the Claude Console before increasing volume.

## Live smoke test — October 24, 2026

The configured key successfully called the real Anthropic API with
`claude-haiku-5-5`. An initial synthetic observation selected the workday chat
over a meal-planning chat (868 input / 53 output tokens).

A second test ran the production `discoverChat` and `ClaudeNavigator` functions
against real Chromium with a synthetic website. Haiku selected the relevant
workday chat, Playwright navigated to it, and Haiku returned `ready` after the
known chat controls appeared. The two-call browser flow passed in 4,372 ms and
reported 1,681 input / 86 output tokens. There were no mutating requests and no
chat message was sent. Sanitized evidence:
[claude-haiku-navigation-2026-10-24.json](./evidence/claude-haiku-navigation-2026-10-24.json).

This proves live model access, compatible tool calling, and the browser discovery
loop. It does not verify whether Anthropic deducted promotional or purchased
credits, production deployment, Krafty login, recording, or artifact upload.
At the time of this smoke test the local environment had no `DATABASE_URL`, so a
complete queued capture was not attempted. A dedicated Neon database was
subsequently configured; see [database setup and verification](./neon.md).

## Real Krafty capture — October 24, 2026

A dedicated password-enabled demo account and an Atlas planning-assistant chat
were created in the owner's Krafty instance. Credentials stay in the ignored,
private `artifacts/demo/krafty-account.json` file; they are not included here or
in capture evidence.

The real test exposed two discovery problems: topic matching was too strict for
an ambiguously named existing chat, and sidebar navigation arrived before the
chat composer. Discovery now treats topic as a preference, includes visible link
text alongside its accessible name, and waits for known chat controls on a
conversation route. A delayed-composer regression test covers the loading race.
Navigation logs include action, link count and error type/status only, never
page labels, prompts, credentials or provider response bodies.

After three discovery failures before any test message was sent, run
`4af94d6d-38ec-4f0b-9c1d-7b15174dcacd` completed the actual password login,
two-call Haiku discovery, fresh-context rehearsal, one authorized message and
verified reply, browser/desktop recording, media checks, private upload and
sandbox cleanup. Provider readback confirmed sandbox deletion, the database
confirmed credential clearance, and the downloaded browser media matched its
manifest SHA-256. Haiku reported 2,164 input and 86 output tokens for the
successful discovery. Browser footage is 1920×1080, 32.15 seconds; desktop footage
is 33.37 seconds. Initial, waiting and completed-reply frames were inspected.

The capture archive and extracted recordings are under ignored `artifacts/demo/`.
Sanitized evidence:
[krafty-demo-capture-2026-10-24.json](./evidence/krafty-demo-capture-2026-10-24.json).
All 19 worker tests, lint, type checking and browser bundling passed. This is one
successful real-product capture, not the three-consecutive-capture quality gate,
founder publication approval, exact cross-source synchronization, or reconciled
provider billing.
