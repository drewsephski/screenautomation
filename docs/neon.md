# Database status

Local development now uses the isolated `screen_studio_development` database in the existing Railway Postgres service. Production Railway connections remain unchanged. The nine Neon development runs and three frames were backed up and compared row-for-row after transfer. See [cutover evidence](./evidence/railway-local-cutover-2026-10-24.json). Neon project `quiet-lab-53973272` and both branches were deleted after exact-project confirmation. An active-project search returned no matches. The historical setup below is superseded; do not pull its environment into the app.

Local Railway TCP access verifies the project CA and the internal Postgres certificate identity. `DATABASE_SSL_CA_FILE` points to the private local certificate file; internal Railway connections do not use this override. Runtime and migration roles are separate.

# Screen Studio database

Provisioned October 24, 2026 in Neon project `screen-studio`
(`quiet-lab-53973272`), organization `org-shiny-recipe-95327934`, AWS Ohio
(`aws-us-east-2`), PostgreSQL 18. The owner explicitly approved deleting archived
project `goose` (`dark-sound-34063816`) and its two branches to free the project
slot. Both branches listed no tables before deletion.

## Connections and environments

- `production`: `br-mute-union-b4ly1hnx`, endpoint `ep-holy-art-b4sry0ol`;
  protected against accidental branch deletion/reset and project deletion.
- `development`: `br-bitter-cell-b4bm5bo1`, endpoint `ep-quiet-mode-b4puv2ko`.
- Both computes are fixed at 0.25 CU, use transaction pooling, and suspend after
  five idle minutes. The project retains one day of history. The continuously
  polling capture worker can keep its database active; idle suspension does not
  guarantee zero compute cost while the worker is running.
- `DATABASE_URL` uses the pooled endpoint and `screen_studio_app`, a login role
  with access to the two capture tables and no permission to create tables.
  Runtime defaults are a 10-second statement timeout, 3-second lock timeout, and
  15-second idle transaction timeout.
- `DIRECT_DATABASE_URL` uses the direct endpoint and `neondb_owner` for additive
  schema migrations. `migrate.ts` prefers this value and falls back to
  `DATABASE_URL` for existing deployments.
- Both connection strings use `sslmode=verify-full` and channel binding.
  Verification checked the client's encrypted TLS connection and validated
  certificate, not `pg_stat_ssl` on the Postgres backend behind Neon's proxy.
- Owner and runtime passwords are different between branches. The initial
  production owner password was rotated after a CLI parsing error exposed it;
  only the replacement is configured.

The ignored root `.env.local` points to development and preserves existing Claude
and Daytona configuration. The ignored `apps/web/.env.local` contains development
runtime configuration; the worker-only Claude key is not copied there. The worker
`start` and `migrate` commands load the root `.env.local` when present. Provider-
injected process environment variables take precedence over that file.

The ignored `.neon` file links the CLI to development. Linking used
`--no-env-pull` to avoid overwriting the existing secrets or adding unused Neon
services. Only Postgres was provisioned; Claude still calls Anthropic directly.

Private connection bundles are in `artifacts/neon/development.env` and
`artifacts/neon/production.env`, with file permissions `0600`. Do not commit or
paste them. The new production branch is initialized and ready for deployment;
existing Railway services have not been moved from their current PostgreSQL
database. A production cutover must preserve any existing Railway capture data
and update both services together.

## Migration and testing

```sh
pnpm --filter @repo/worker migrate
```

The migration command uses the direct owner connection. The application continues
to use the limited pooled connection.

Integration tests accept `TEST_DATABASE_URL` for runtime and an optional
`TEST_DIRECT_DATABASE_URL` for migration setup. Supply these from a private
environment, never literal credentials in a shell command or transcript. Run
against an isolated database with its capture worker stopped; queue claims are
global within that database.

Live verification established:

- migrations succeed with the separate owner connection;
- production and development runtime connections verify TLS certificates;
- the runtime role can access the queue but cannot create tables;
- the actual pooled connection receives the configured query/lock timeouts;
- queue integration tests pass for isolation, atomic claims, credential erasure,
  cancellation, and recovery after interruption.
- the local production-mode Next server passes HTTP intake, duplicate rejection,
  session isolation and cancellation against Neon; its synthetic row was removed
  and the temporary server stopped afterward.

Sanitized setup evidence is in
[neon-setup-2026-10-24.json](./evidence/neon-setup-2026-10-24.json).
These checks do not prove a completed Krafty capture, artifact upload, or a
production deployment using the new database.
