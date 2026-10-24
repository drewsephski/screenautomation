import { LivePreview } from "./live-preview";
import type { DemoStory } from "@repo/contracts";

export type Run = {
  id: string;
  url: string;
  status: string;
  detail: string;
  hasArtifact: boolean;
  needsCode?: boolean;
  step?: string | null;
  pageUrl?: string | null;
  frameAt?: number | null;
  createdAt?: number;
  hasFilm?: boolean;
  mode?: "chat" | "tour";
  story?: DemoStory | null;
  storyApproved?: boolean;
};
const stages = [
  "queued",
  "provisioning",
  "logging_in",
  "reviewing",
  "rehearsing",
  "capturing",
  "checking",
  "completed",
];
const labels: Record<string, string> = {
  queued: "Waiting for a browser",
  provisioning: "Preparing your browser",
  logging_in: "Signing in privately",
  reviewing: "Review your story",
  rehearsing: "Checking the chat",
  capturing: "Recording the workflow",
  checking: "Checking the footage",
  completed: "Capture ready",
  failed: "This run needs attention",
  cancelled: "Run cancelled",
};

export function CaptureProgress({
  run,
  active,
  busy,
  statusError,
  cancel,
  submitCode,
  draftUrl,
  draftMessage,
  approveStory,
}: {
  run: Run | null;
  active: boolean;
  busy: boolean;
  statusError: string;
  cancel: () => void;
  submitCode: (code: string) => Promise<string | null>;
  draftUrl: string;
  draftMessage: string;
  approveStory: () => Promise<void>;
}) {
  return (
    <section className="output panel" aria-labelledby="capture-title">
      <div className="panel-heading">
        <span className="step-number">02</span>
        <div>
          <h2 id="capture-title">Follow the take</h2>
          <p>
            {run
              ? "Watch the real browser, live, as each step happens."
              : "A preview of the run. Start a capture to watch it live."}
          </p>
        </div>
      </div>
      <div className="preview-stage">
        <LivePreview
          run={run}
          active={active}
          draftUrl={draftUrl}
          draftMessage={draftMessage}
          submitCode={submitCode}
        />
      </div>
      <div className="run-status" aria-live="polite" aria-atomic="true">
        {run?.story && run.status === "reviewing" && (
          <div className="story-review">
            <h3>{run.story.title}</h3>
            <p>{run.story.summary}</p>
            <ol>
              {run.story.scenes.map((scene) => (
                <li key={scene.url}>
                  <strong>{scene.caption}</strong>
                  <p>{new URL(scene.url).pathname}</p>
                </li>
              ))}
            </ol>
            <p>
              Only these pages will be recorded. No forms will be submitted.
            </p>
            <button
              className="primary-button"
              onClick={approveStory}
              disabled={busy || run.storyApproved}
            >
              {run.storyApproved
                ? "Approved — preparing…"
                : "Approve story and record"}
            </button>
          </div>
        )}
        <div className="status-heading">
          <h3>
            {run
              ? (labels[run.status] ?? "Run progress")
              : "A deliberate process"}
          </h3>
          {active && (
            <button onClick={cancel} disabled={busy} className="text-button">
              Cancel run
            </button>
          )}
        </div>
        <ol className="stage-list">
          {[
            [
              "logging_in",
              "Sign in privately",
              "Login stays outside the footage.",
            ],
            [
              "rehearsing",
              "Check the workflow",
              "Verify the selected pages or chat controls.",
            ],
            [
              "capturing",
              "Capture the workflow",
              "Record approved pages, or send once and wait for the real reply.",
            ],
            [
              "checking",
              "Verify and save",
              "Check media before releasing the browser.",
            ],
          ].map(([key, title, note]) => {
            const done =
              !!run && stages.indexOf(run.status) > stages.indexOf(key!);
            const current = run?.status === key;
            const waiting = current && key === "logging_in" && run?.needsCode;
            return (
              <li
                key={key}
                className={done ? "done" : current ? "current" : ""}
              >
                <span className="stage-dot" aria-hidden="true">
                  {done ? "✓" : ""}
                </span>
                <div>
                  <strong>{title}</strong>
                  <p>
                    {waiting
                      ? "Waiting for your verification code."
                      : current && run?.step
                        ? run.step
                        : note}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
        {run?.status === "failed" && (
          <p className="error-message" role="alert">
            {run.detail}
          </p>
        )}
        {statusError && (
          <p className="error-message" role="alert">
            {statusError}
          </p>
        )}
        {run?.hasArtifact && run.status === "completed" && (
          <>
            {run.hasFilm && (
              <>
                <video
                  controls
                  preload="metadata"
                  style={{ width: "100%", borderRadius: 12 }}
                  src={`/api/runs/${run.id}/film`}
                  aria-label="Edited product film"
                />
                <a
                  className="download-button"
                  href={`/api/runs/${run.id}/film`}
                >
                  Download edited MP4 <span aria-hidden="true">↓</span>
                </a>
              </>
            )}
            <a
              className="download-button"
              href={`/api/runs/${run.id}/download`}
            >
              Download source capture <span aria-hidden="true">↓</span>
            </a>
          </>
        )}
      </div>
      <div className="scope-note">
        <strong>Real footage. A concise story.</strong>
        <p>
          Review your 15–30 second film before publishing. Source recordings and
          evidence stay available in the capture archive.
        </p>
      </div>
    </section>
  );
}
