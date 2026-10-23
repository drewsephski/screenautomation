# Hosted capture implementation review

Baseline approved by the user: `e4aa7114206743b95defbd83569230fe9eefef69`. Review scope: this implementation and the necessary previously uncommitted workspace scaffold; unrelated README edits and icon deletion were excluded. Spec: `docs/implementation-plan.md`, with the user's clarification that email/password intake belongs in the hosted app and Krafty is the live benchmark.

Two independent axes ran in parallel using the code-review skill. Each received the spec, standards, scoped diff, prior findings, and responses in its second round. The issue-tracker integration is absent; the supplied plan is the originating spec.

## Standards

- **P1 — Redirects bypass the origin allowlist.** The original Playwright route handler could not enforce redirect hops, allowing synthetic password entry outside the approved origin. **Addressed:** origin-pinned HTTPS CONNECT proxy, public IP pins, disabled proxy bypass/HTTP2/QUIC, and same-origin checks before filling email/password. Actual Chromium tests cover blocked redirects and denied credential entry after navigation.
- **P2 — Database failure skips local artifact cleanup.** The original `finally` cleared credentials before deleting temporary files; a database failure prevented the latter. **Addressed:** nested `finally` always removes the generated local artifact directory. Sandbox cleanup remains independently tracked and retryable; its failure cannot discard an already saved capture.
- **P2 — Truncated recordings pass media verification.** FFmpeg can successfully exit after decoding an incomplete prefix, and sample extraction can succeed without a file. **Addressed:** probe stderr rejection, fatal decoding flags, explicit decoder stderr checks, and file-size checks for all four required samples. A four-second MP4 truncated to 55% failed this regression test before the fix and is rejected afterward.

The independent follow-up reported the two original findings resolved and no additional material code smells. Its new truncated-media finding was then fixed and verified with the regression above.

## Spec

- **P1 — Redirects bypass the approved-origin boundary.** Requirement: reject unsafe redirects and explicitly permit identity origins. **Addressed** by the proxy and credential-origin guards described above.
- **P1 — An incomplete reply can be marked verified.** Requirement: complete real output. **Addressed:** require an observed Stop/Stop generating to Send/Submit transition plus a new nonempty assistant message. Quiet partial text without that protocol fails. Generic sites with another completion protocol are unsupported until a verified adapter exists.
- **P2 — Successful uploads can become inaccessible.** Requirement: durable intake and verified upload before teardown. **Addressed:** verify object length/metadata and streamed SHA-256 readback; persist its key before teardown; recover completed captures after a worker lease expires; retain cleanup state independently.
- **P2 — Stop desktop recording before analyzing browser footage.** Requirement: compare both recording paths of the same workflow. The desktop originally included browser analysis and closed-desktop time. **Addressed:** signal browser recording finalization immediately, stop desktop recording, then analyze both media files. A ready handshake also keeps login and fresh-context preparation outside either recording.

The independent follow-up reported the three original findings resolved. Its new timing finding was then fixed and checked through the typed worker build and explicit phase ordering.

Standards: 3 findings, highest P1, all addressed. Spec: 4 findings, highest P1, all addressed. No known unresolved review finding in the chosen hosted Stage 0 scope.

## Verification and limits

Repository lint and type checks, production Next.js build, remote browser/analysis bundles, actual Chromium regression tests, FFmpeg decoding tests, PostgreSQL queue integration, and hosted intake/cancellation/isolation API checks passed locally. The final suite runs with the isolated database and a web service; no real capture worker is started during API tests.

No real website credentials were submitted. Live Krafty login, Daytona recording/firewall behavior, private object-store behavior, real costs, and the three-consecutive-capture gate remain unverified. Docker daemon execution was unavailable. Railway configuration and deployment prerequisites are in `stage-0.md`; no deployment or paid provisioning was performed. Later rendering/discovery stages remain gated rather than represented as completed.

## Live provider preflight follow-up

The added Daytona key was used for an actual remote snapshot build, browser/desktop recording comparison, unauthenticated Krafty login-form load, direct provider firewall controls, and a controlled interruption through the production capture function. Sanitized evidence and repeatable commands are in `stage-0.md` and `docs/evidence/`.

### Standards

One P2 finding: the fault-check initially removed its test row even when deletion could not be verified. Fixed: remove the test row only after verified deletion; otherwise retain `cleanup_pending` and emit recovery IDs. The independent re-review found no remaining material standards breach or blocking smell.

### Spec

One P2 finding: the initial network report lacked repeatable direct probes and positive controls. Fixed: a committed direct TCP script records destination, port, transport, error, timing, each policy's exact CIDRs, and the same public destination's blocked → allowed → blocked result. Private-address claims are limited to the tested observations. The independent re-review found no remaining material spec issue in this unit.

Standards: 1 finding, P2, resolved. Spec: 1 finding, P2, resolved. Full-plan completion remains unproven: real Krafty credentials/chat, three real captures, successful private upload, billing reconciliation, and hosted deployment are still pending.
