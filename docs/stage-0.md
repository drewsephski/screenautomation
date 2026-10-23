# Hosted capture: first implementation vertical

The user clarified the first deliverable: credentials belong in the deployed web app, so each user can let the browser sign in to their website. The default live benchmark is **kraftybot.app**, with explicit permission to send one chat message. This vertical brings forward the minimum durable intake from Stage 3; it does not declare Stage 0's quality gate complete.

## Implemented

- Next.js intake: website, email, password, one message, optional existing chat URL, explicit account/recording/chat consent. Passwords never enter browser storage, React state, URLs, workflow manifests, status APIs, or ordinary logs.
- Anonymous per-browser ownership using a random HttpOnly/SameSite session cookie; only its hash is stored with runs. Sessions last 24 hours. This supports isolated private-beta use, not account recovery, organizations, or cross-device access.
- PostgreSQL queue with atomic claims, one active run per session, ten pending/active runs globally, and twenty attempts per rolling 24 hours. No automatic re-execution after crashes: a send may already have happened. Credentials use AES-256-GCM, run-specific authenticated data, and a ten-minute expiry. They are cleared after login, cancellation, completion, failure, or the janitor's expiry pass.
- A separate worker runs the browser in Daytona. It pins approved public IPv4 destinations through the provider firewall and an HTTPS CONNECT proxy that rechecks every destination, including redirects. Browser routing adds another origin check; login fields are filled only on the submitted website origin. Only deployment-approved targets are accepted. DNS changes fail closed. Current provider restrictions allow up to ten IPv4 CIDRs; IPv6 is not enabled. The deployment must support strict per-sandbox firewall overrides.
- Email/password login happens without screenshots, tracing, or recording. State stays only inside the short-lived sandbox. A fresh browser context restores authorized state and checks the chat controls before sending once.
- Playwright 1.64.1 browser recording at explicit 1920x1080 / requested 60 fps and Daytona desktop recording of the same take. FFprobe metadata, full decoded frame hashes, four PNG samples, timing gaps, event/evidence manifest, worker-only CPU and memory, fonts, package versions, and recording provenance are archived.
- Private object upload, HEAD checks, and a streamed SHA-256 readback precede sandbox teardown. The verified artifact key is committed before cleanup; failures after upload recover the artifact without sending again. The web app signs a 60-second download only for the owning session. No database credentials or auth state enter the archive.

## Current support boundary

Krafty uses the inspected email/password sign-in flow, opens the first **existing** chat with an `Open …` accessible link, and uses the `Message` composer and `Submit` control. A specific chat URL is preferable for a dedicated demo account. A setup-only account without an existing bot/chat fails with an explanation; the worker never creates one.

Other approved sites currently need a conventional email/password form (`email`, `autocomplete=username`, or `identifier`; a password input; Continue/Next/Sign in/Log in controls), an authenticated target/chat URL, a textbox labelled `Message`, a Send/Submit button, recognized assistant-message containers, and an observed Stop/Stop generating to Send/Submit completion transition. A quiet partial reply cannot verify the run. Unsupported forms, MFA, bot challenges, SSO-only accounts, and changed selectors fail visibly. Universal discovery, model decisions, human-login resume, and arbitrary site support are **not implemented**. No generated scripts execute.

The initial rehearsal checks login and controls without sending a second message. It does not reset server data. Three separate benchmark attempts will add three messages to the authorized demo chat. Prepare the same initial chat state manually before each take; never silently delete production history.

## Railway deployment

Use the repository root for both services and the same Dockerfile. Select `railway.web.json` for the web service and `railway.worker.json` for the worker service. Add PostgreSQL and private S3-compatible object storage. No local disk stores durable runs or exports.

1. Build `apps/worker/sandbox/Dockerfile` for `linux/amd64`, register it as a uniquely versioned Daytona snapshot, and set `DAYTONA_SNAPSHOT` to that name. Its Playwright base is pinned by digest; the resulting snapshot also freezes apt packages/fonts. Keep the installed package list and font inventory for every benchmark. Building/provisioning that snapshot can cost money and has not been executed by this implementation.
2. Set the variables listed in `.env.example` privately in Railway. Use a random 32-byte base64 encryption key shared by web and worker. The web service needs the database/key, app origin, enabled targets, snapshot name, and S3 download credentials; the worker alone needs the Daytona key. Keep web and worker target settings consistent.
3. The worker pre-deploy command runs the additive schema migration. For another host run `pnpm --filter @repo/worker migrate` before starting either service. The image builds the browser/analysis bundles and Next app. The worker uses `pnpm --filter @repo/worker start`; web uses `pnpm --filter web start` and honors `PORT`.
4. Use TLS and set `APP_ORIGIN` to the exact public HTTPS origin. Keep the studio behind your host's private-beta access control until authentication, abuse controls, credential handling, and live-provider behavior receive deployment review. The anonymous session is a resource ownership boundary, not an invitation or billing system.
5. Set the S3 bucket to private, block public ACLs, and configure a **24-hour lifecycle expiry** for `captures/`. Database reads deny expired runs; the worker removes expired database rows once their sandbox cleanup is acknowledged. Database backups must have an appropriate retention policy for encrypted credential ciphertext and submitted messages.
6. Approve only necessary exact target, identity, image, and CDN origins. Krafty's current Clerk anti-bot loader uses instance-specific `*.client.protect.clerk.com` hosts: discover and explicitly configure the actual hosts for the deployment; do not add a wildcard or disable the firewall. The template is intentionally incomplete for these rotating hosts and fails closed until configured. Verify blocked metadata/private egress, allowed public egress, TLS, cookie scope, object access, worker restart, and cancellation in the hosted environment before accepting real credentials.

No deployment, paid snapshot, real credential submission, or live chat capture has been performed by local verification. Docker image execution was not verified: the local Docker daemon is unavailable. Next production build and browser-worker bundles were verified independently.

## Stage 0 acceptance checklist

Use a dedicated Krafty demo account containing no unrelated private conversations. The default message asks only for three short workday-planning tips, without tools or external actions. Submitting the form authorizes that one message and the recording, not additional site changes.

For each of three consecutive attempts retain the original archive and record:

- Real completed reply and matching screenshot evidence; readable small text; scrolling, typing, streaming, navigation and overlays reviewed (missing coverage requires a dedicated authorized take).
- Both recordings decode completely at measured dimensions; timestamp gaps and distinct-frame counts inspected. Requested 60 fps is not a claim of 60 unique frames.
- Cursor visibility and display chrome reviewed separately for browser and desktop paths.
- Source/event alignment reviewed. Browser events use a local monotonic clock; desktop recording API latency and host/sandbox clock differences mean exact desktop synchronization is **not yet proven**.
- Raw footage reviewed for sensitive content before publication. Login is excluded; the post-login page can still contain private account information.
- Provider billing reconciled against sandbox ID and wall-clock lifetime, including failures. Actual cost remains `null` until reconciliation; do not replace it with a historical price estimate.
- Upload-failure cleanup, cancellation, worker crash, and uncertain provisioning tested against live Daytona/storage.

Write the chosen capture path, limitations, reviewed frames, reviewer, and measured costs into a benchmark decision before advancing to Stage 1. There is no renderer or film template yet: adding one now would bypass the explicit capture-quality gate.

## Local verification

`pnpm lint`, `pnpm check-types`, `pnpm test`. Hosted intake tests additionally use `TEST_STUDIO_URL` against an isolated web service sharing the test database, with the real capture worker stopped. Queue integration tests use `TEST_DATABASE_URL` pointing to an isolated test database, never production. Browser replay tests need `pnpm --filter @repo/browser exec playwright install chromium`; media tests need local FFmpeg/FFprobe. Test media is explicitly synthetic and never used as Krafty footage.

The implementation has no issue tracker; the supplied plan and user clarifications are its spec. If adopting the code-review skill's issue integration later, run `/setup-matt-pocock-skills` to create `docs/agents/issue-tracker.md`.

Sources checked against the installed SDK/types: [Daytona computer use](https://www.daytona.io/docs/en/typescript-sdk/computer-use/), [desktop setup](https://www.daytona.io/docs/en/computer-use/), [network firewall](https://www.daytona.io/docs/en/network-limits/), [Playwright screencast](https://playwright.dev/docs/api/class-screencast). The installed SDK's `display.getInfo()` returns `displays[]`, unlike an example in its documentation; the implementation follows the installed types.
