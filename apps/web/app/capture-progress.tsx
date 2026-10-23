export type Run = {
  id: string;
  url: string;
  status: string;
  detail: string;
  hasArtifact: boolean;
};
const stages = [
  "queued",
  "provisioning",
  "logging_in",
  "rehearsing",
  "capturing",
  "checking",
  "completed",
];
const labels: Record<string, string> = {
  queued: "Waiting for a browser",
  provisioning: "Preparing your browser",
  logging_in: "Signing in privately",
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
}: {
  run: Run | null;
  active: boolean;
  busy: boolean;
  statusError: string;
  cancel: () => void;
}) {
  return (
    <section className="output panel" aria-labelledby="capture-title">
      <div className="panel-heading">
        <span className="step-number">02</span>
        <div>
          <h2 id="capture-title">Follow the take</h2>
          <p>Every step, with its real result.</p>
        </div>
      </div>
      <div
        className={`capture-slate ${run?.status === "capturing" ? "recording" : ""}`}
      >
        <div className="slate-top">
          <span>
            <i />
            {run?.status === "capturing" ? "RECORDING" : "BROWSER CAPTURE"}
          </span>
          <span>1920 × 1080</span>
        </div>
        <div className="slate-center">
          <div className="frame-icon" aria-hidden="true">
            <span>↗</span>
          </div>
          <h3>
            {run
              ? (labels[run.status] ?? "Preparing capture")
              : "Your next take starts here"}
          </h3>
          <p>
            {run
              ? run.detail
              : "Real clicks. Real output. A clean source recording to build your film around."}
          </p>
        </div>
        <div className="slate-bottom">
          <span>16:9</span>
          <span>SILENT-FIRST · MP4 / WEBM</span>
        </div>
      </div>
      <div className="run-status" aria-live="polite" aria-atomic="true">
        <div className="status-heading">
          <h3>{run ? "Run progress" : "A deliberate process"}</h3>
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
              "Find a chat and verify the controls.",
            ],
            [
              "capturing",
              "Capture the conversation",
              "Send once. Wait for the actual reply.",
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
                  <p>{note}</p>
                </div>
              </li>
            );
          })}
        </ol>
        {statusError && (
          <p className="error-message" role="alert">
            {statusError}
          </p>
        )}
        {run?.hasArtifact && run.status === "completed" && (
          <a className="download-button" href={`/api/runs/${run.id}/download`}>
            Download source capture <span aria-hidden="true">↓</span>
          </a>
        )}
      </div>
      <div className="scope-note">
        <strong>First, get the footage right.</strong>
        <p>
          This beta records and verifies one conversation. Film editing and
          export follow the capture-quality benchmark.
        </p>
      </div>
    </section>
  );
}
