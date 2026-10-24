# Approved product tours and edited films

Choose **Product tour** on the intake form and describe the walkthrough goal. The worker signs in, reads visible navigation metadata on operator-enabled pages, and sends only that bounded metadata and the goal to Claude Haiku 5.5. It proposes up to three distinct observed pages with captions. Review the proposed story and approve it before recording. Cancelling or allowing the five-minute review window to expire stops the run.

The replay uses a fresh browser context and authenticated session. It opens the approved exact paths and records their visible content without submitting forms. `BROWSER_TOUR_PATHS` enables exact read-only paths per deployment. Krafty defaults to `/workspace,/activity,/apps,/memory`; other products require explicit configuration. Query strings, cross-origin destinations and mutating path names are rejected. Operators must only enable routes whose GET navigation is safe.

Completed runs provide an MP4 preview, an edited MP4 download, and the original capture archive. The editor uses verified browser footage and the captured final frame, with generated title/caption cards. It verifies the source checksum, fully decodes the export, and checks the final resolution and duration. Both the source archive and film are uploaded privately, then downloaded internally to verify their checksums before the run is marked complete. Downloads require the owner's session and use short-lived signed storage URLs.

The current editor produces a silent landscape film. It trims waits and may hold a real captured frame; timeline metadata records these choices. Event-to-video timing is approximate. Review pacing, captions, privacy and exact visual timing before publishing. This is an operator-enabled navigation tour, not unrestricted autonomous discovery of arbitrary product actions.

## Local development storage

Use the existing Railway Postgres service with the isolated `screen_studio_development` database. Keep runtime credentials in `DATABASE_URL`, migrations in `DIRECT_DATABASE_URL`, and the local public-proxy certificate in `DATABASE_SSL_CA_FILE`. Never commit these files. Production services retain their original internal Railway database connection.

## Verified release, October 24, 2026

Railway web deployment `30ac5f9d-1227-4b97-a997-9ae02a132c91` and worker deployment `437239f5-14cc-4f7c-9a29-4e1fa0866f02` reached `SUCCESS`. The health endpoint returns 200, and the existing private-beta network gate remains active. The release used an isolated working-tree export without secrets or recordings; no commit was created. Three real local chat captures and an approved real local tour completed. See the sanitized files in `docs/evidence/` for validation and separate hosted workflow proof.
