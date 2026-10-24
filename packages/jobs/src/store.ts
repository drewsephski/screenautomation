import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { RunInput, DemoStory } from "@repo/contracts";
import { encryptCredentials } from "./security.ts";
import { readFileSync } from "node:fs";
import { checkServerIdentity } from "node:tls";

export type RunStatus =
  | "queued"
  | "provisioning"
  | "logging_in"
  | "rehearsing"
  | "reviewing"
  | "capturing"
  | "checking"
  | "completed"
  | "failed"
  | "cancelled";
export interface StoredRun {
  id: string;
  owner: string;
  url: string;
  chat_url: string | null;
  message: string;
  status: RunStatus;
  detail: string;
  credentials: string | null;
  sandbox_id: string | null;
  artifact_key: string | null;
  created_at: Date;
  lease_until: Date | null;
  needs_code: boolean;
  verification_code: string | null;
  mode: "chat" | "tour";
  story: DemoStory | null;
  story_approved: boolean;
  film_key: string | null;
}
/** Latest desktop frame of an active run, shown only to its owner. */
export interface LiveFrame {
  image: Buffer;
  step: string | null;
  page_url: string | null;
  captured_at: Date;
}

export class RunStore {
  readonly pool: Pool;
  constructor(connectionString: string) {
    // Railway's public TCP proxy presents the database's private-CA certificate.
    // Trust only the CA obtained through authenticated provider SSH, and verify
    // its certified internal hostname instead of weakening TLS verification.
    const url = new URL(connectionString);
    const caFile = process.env.DATABASE_SSL_CA_FILE;
    const railwayTls = caFile && url.hostname.endsWith(".proxy.rlwy.net");
    if (railwayTls) url.searchParams.delete("sslmode");
    this.pool = new Pool({
      connectionString: railwayTls ? url.href : connectionString,
      ...(railwayTls
        ? {
            ssl: {
              ca: readFileSync(caFile, "utf8"),
              checkServerIdentity: (_host, certificate) =>
                checkServerIdentity("postgres.railway.internal", certificate),
              rejectUnauthorized: true,
            },
          }
        : {}),
      max: 5,
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
    });
  }
  async migrate() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS capture_runs (
      id uuid PRIMARY KEY, owner text NOT NULL, url text NOT NULL, chat_url text, message text NOT NULL,
      status text NOT NULL, detail text NOT NULL, credentials text,
      sandbox_id text, artifact_key text, created_at timestamptz NOT NULL DEFAULT now(),
      lease_until timestamptz, heartbeat_at timestamptz, expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours'
    ); ALTER TABLE capture_runs ADD COLUMN IF NOT EXISTS cleanup_pending boolean NOT NULL DEFAULT true;
    ALTER TABLE capture_runs ADD COLUMN IF NOT EXISTS needs_code boolean NOT NULL DEFAULT false;
    ALTER TABLE capture_runs ADD COLUMN IF NOT EXISTS verification_code text;
    ALTER TABLE capture_runs ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'chat';
    ALTER TABLE capture_runs ADD COLUMN IF NOT EXISTS story jsonb;
    ALTER TABLE capture_runs ADD COLUMN IF NOT EXISTS story_approved boolean NOT NULL DEFAULT false;
    ALTER TABLE capture_runs ADD COLUMN IF NOT EXISTS film_key text;
    CREATE INDEX IF NOT EXISTS capture_runs_queue ON capture_runs (created_at) WHERE status = 'queued';
    CREATE TABLE IF NOT EXISTS capture_frames (
      run_id uuid PRIMARY KEY REFERENCES capture_runs (id) ON DELETE CASCADE,
      image bytea NOT NULL, step text, page_url text, captured_at timestamptz NOT NULL DEFAULT now()
    );`);
  }
  async create(owner: string, raw: unknown, key: string) {
    const input = RunInput.parse(raw);
    const id = randomUUID();
    const sealed = encryptCredentials(
      { email: input.email, password: input.password },
      id,
      key,
      Date.now() + 10 * 60_000,
    );
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(722108)");
      const { rows } = await client.query<{ count: string; own: string }>(
        "SELECT count(*)::text AS count, count(*) FILTER (WHERE owner=$1)::text AS own FROM capture_runs WHERE status NOT IN ('completed','failed','cancelled')",
        [owner],
      );
      if (Number(rows[0]?.count) >= 10 || Number(rows[0]?.own) >= 1)
        throw new Error(
          "A run is already active or the queue is full. Try again after it finishes.",
        );
      const daily = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM capture_runs WHERE created_at > now()-interval '24 hours'",
      );
      if (Number(daily.rows[0]?.count) >= 20)
        throw new Error("Daily studio capture limit reached");
      await client.query(
        "INSERT INTO capture_runs (id,owner,url,chat_url,message,status,detail,credentials,mode) VALUES ($1,$2,$3,$4,$5,'queued','Waiting for a browser', $6,$7)",
        [
          id,
          owner,
          input.url,
          input.chatUrl ?? null,
          input.message,
          sealed,
          input.mode,
        ],
      );
      await client.query("COMMIT");
      return id;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async get(id: string, owner: string) {
    return (
      await this.pool.query<
        StoredRun & {
          frame_at: Date | null;
          step: string | null;
          page_url: string | null;
        }
      >(
        "SELECT r.*, f.captured_at AS frame_at, f.step, f.page_url FROM capture_runs r LEFT JOIN capture_frames f ON f.run_id=r.id WHERE r.id=$1 AND r.owner=$2 AND r.expires_at > now()",
        [id, owner],
      )
    ).rows[0];
  }
  async saveFrame(
    id: string,
    image: Buffer,
    step: string | null,
    pageUrl: string | null,
  ) {
    await this.pool.query(
      "INSERT INTO capture_frames (run_id,image,step,page_url,captured_at) SELECT $1,$2,$3,$4,now() FROM capture_runs WHERE id=$1 AND status NOT IN ('completed','failed','cancelled') ON CONFLICT (run_id) DO UPDATE SET image=EXCLUDED.image, step=EXCLUDED.step, page_url=EXCLUDED.page_url, captured_at=EXCLUDED.captured_at",
      [id, image, step, pageUrl],
    );
  }
  async frame(id: string, owner: string) {
    return (
      await this.pool.query<LiveFrame>(
        "SELECT f.image, f.step, f.page_url, f.captured_at FROM capture_frames f JOIN capture_runs r ON r.id=f.run_id WHERE f.run_id=$1 AND r.owner=$2 AND r.expires_at > now()",
        [id, owner],
      )
    ).rows[0];
  }
  /** The site asked for a one-time code; the owner supplies it from the studio. */
  async requestCode(id: string, detail: string) {
    return (
      (
        await this.pool.query(
          "UPDATE capture_runs SET needs_code=true, verification_code=NULL, detail=$2 WHERE id=$1 AND status='logging_in' RETURNING id",
          [id, detail],
        )
      ).rowCount === 1
    );
  }
  async submitCode(id: string, owner: string, sealed: string) {
    return (
      (
        await this.pool.query(
          "UPDATE capture_runs SET verification_code=$3, needs_code=false, detail='Code received. Finishing sign-in.' WHERE id=$1 AND owner=$2 AND needs_code AND status='logging_in' RETURNING id",
          [id, owner, sealed],
        )
      ).rowCount === 1
    );
  }
  async takeCode(id: string) {
    return (
      await this.pool.query<{ verification_code: string }>(
        "UPDATE capture_runs r SET verification_code=NULL FROM (SELECT id, verification_code FROM capture_runs WHERE id=$1 AND verification_code IS NOT NULL FOR UPDATE) old WHERE r.id=old.id RETURNING old.verification_code",
        [id],
      )
    ).rows[0]?.verification_code;
  }
  async claim() {
    // No automatic replay: a crashed worker may already have sent the chat.
    return (
      await this.pool
        .query<StoredRun>(`UPDATE capture_runs SET status='provisioning', detail='Starting a private browser', lease_until=now()+interval '2 minutes', heartbeat_at=now()
      WHERE id=(SELECT id FROM capture_runs WHERE status='queued' AND created_at > now()-interval '10 minutes' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`)
    ).rows[0];
  }
  async update(
    id: string,
    status: RunStatus,
    detail: string,
    sandboxId?: string,
    artifactKey?: string,
  ) {
    const terminal = ["completed", "failed", "cancelled"].includes(status);
    const result = await this.pool.query(
      `UPDATE capture_runs SET status=$2,detail=$3,needs_code=false,sandbox_id=COALESCE($4,sandbox_id),artifact_key=COALESCE($5,artifact_key),credentials=CASE WHEN $6 THEN NULL ELSE credentials END,verification_code=CASE WHEN $6 THEN NULL ELSE verification_code END WHERE id=$1 AND status NOT IN ('completed','failed','cancelled') RETURNING id`,
      [id, status, detail, sandboxId ?? null, artifactKey ?? null, terminal],
    );
    return result.rowCount === 1;
  }
  async heartbeat(id: string) {
    return (
      (
        await this.pool.query(
          "UPDATE capture_runs SET lease_until=now()+interval '2 minutes', heartbeat_at=now() WHERE id=$1 AND status NOT IN ('completed','failed','cancelled') RETURNING id",
          [id],
        )
      ).rowCount === 1
    );
  }
  async clearCredentials(id: string) {
    await this.pool.query(
      "UPDATE capture_runs SET credentials=NULL WHERE id=$1",
      [id],
    );
  }
  async saveArtifact(id: string, key: string, filmKey?: string) {
    return (
      (
        await this.pool.query(
          "UPDATE capture_runs SET artifact_key=$2,film_key=$3, detail='Capture saved; releasing the browser' WHERE id=$1 AND status='checking' RETURNING id",
          [id, key, filmKey ?? null],
        )
      ).rowCount === 1
    );
  }
  async proposeStory(id: string, raw: unknown) {
    const story = DemoStory.parse(raw);
    return (
      (
        await this.pool.query(
          "UPDATE capture_runs SET story=$2::jsonb,status='reviewing',detail='Review the proposed story before recording.',credentials=NULL WHERE id=$1 AND status='logging_in' AND mode='tour' RETURNING id",
          [id, JSON.stringify(story)],
        )
      ).rowCount === 1
    );
  }
  async approveStory(id: string, owner: string) {
    return (
      (
        await this.pool.query(
          "UPDATE capture_runs SET story_approved=true,detail='Story approved. Preparing the recording.' WHERE id=$1 AND owner=$2 AND status='reviewing' AND story IS NOT NULL AND NOT story_approved RETURNING id",
          [id, owner],
        )
      ).rowCount === 1
    );
  }
  async storyApproved(id: string) {
    const { rows } = await this.pool.query<{ story_approved: boolean }>(
      "SELECT story_approved FROM capture_runs WHERE id=$1 AND status='reviewing'",
      [id],
    );
    return rows[0]?.story_approved === true;
  }
  /** `reason` is a user-facing explanation; it must never contain page text or input values. */
  async fail(id: string, reason?: string) {
    await this.pool.query(
      "UPDATE capture_runs SET status=CASE WHEN artifact_key IS NOT NULL THEN 'completed' ELSE 'failed' END, detail=CASE WHEN artifact_key IS NOT NULL THEN 'Source capture saved; browser cleanup is pending.' ELSE COALESCE($2, 'Login or capture could not be verified. Check credentials, MFA, enabled origins, and the chat URL. Review the site before retrying; a message may already have been sent.') END, credentials=NULL, verification_code=NULL, needs_code=false WHERE id=$1 AND status NOT IN ('completed','failed','cancelled')",
      [id, reason ?? null],
    );
  }
  async cancel(id: string, owner: string) {
    await this.pool.query(
      "UPDATE capture_runs SET status='cancelled', detail='Cancelled. No further actions will be started.', credentials=NULL, verification_code=NULL, needs_code=false WHERE id=$1 AND owner=$2 AND status NOT IN ('completed','failed','cancelled')",
      [id, owner],
    );
  }
  async expire() {
    await this.pool.query(
      "UPDATE capture_runs SET status=CASE WHEN artifact_key IS NOT NULL THEN 'completed' ELSE 'failed' END, detail=CASE WHEN artifact_key IS NOT NULL THEN 'Source capture recovered after interruption; cleanup is pending.' ELSE 'Run interrupted or credentials expired. Review the site before starting again.' END, credentials=NULL WHERE (status='queued' AND created_at < now()-interval '10 minutes') OR (status NOT IN ('queued','completed','failed','cancelled') AND lease_until < now())",
    );
    await this.pool.query(
      "DELETE FROM capture_runs WHERE expires_at < now() AND NOT cleanup_pending",
    );
    // The last frame explains a finished run; keep it briefly, not for the run's lifetime.
    await this.pool.query(
      "DELETE FROM capture_frames f USING capture_runs r WHERE r.id=f.run_id AND r.status IN ('completed','failed','cancelled') AND f.captured_at < now()-interval '2 hours'",
    );
    return (
      await this.pool.query<StoredRun>(
        "SELECT * FROM capture_runs WHERE status IN ('completed','failed','cancelled') AND cleanup_pending",
      )
    ).rows;
  }
  async sandboxDeleted(id: string) {
    await this.pool.query(
      "UPDATE capture_runs SET sandbox_id=NULL, cleanup_pending=false WHERE id=$1",
      [id],
    );
  }
  async close() {
    await this.pool.end();
  }
}
