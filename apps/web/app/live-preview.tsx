"use client";

import { useEffect, useState, type FormEvent } from "react";
import { BrowserChrome } from "./browser-chrome";
import { DemoScreen } from "./demo-screen";
import type { Run } from "./capture-progress";

const bootSteps = [
  "Reserving a private computer",
  "Pinning the network to approved sites",
  "Starting a 1920 × 1080 display",
  "Opening Chromium",
];

function useElapsed(since: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [since]);
  return since === null ? 0 : Math.max(0, Math.floor((now - since) / 1000));
}
const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

/** Preloads each new frame before swapping it in, so the screen never blanks. */
function useFrames(run: Run | null) {
  const [frames, setFrames] = useState<{ runId: string; srcs: string[] }>({
    runId: "",
    srcs: [],
  });
  const target = run?.frameAt
    ? `/api/runs/${run.id}/frame?t=${run.frameAt}`
    : null;
  const runId = run?.id;
  useEffect(() => {
    if (!target || !runId) return;
    const image = new Image();
    image.onload = () =>
      setFrames((current) => {
        if (current.runId === runId && current.srcs.at(-1) === target)
          return current;
        return {
          runId,
          srcs:
            current.runId === runId
              ? [...current.srcs.slice(-1), target]
              : [target],
        };
      });
    image.src = target;
    return () => {
      image.onload = null;
    };
  }, [target, runId]);
  return run && frames.runId === run.id ? frames.srcs : [];
}

export function LivePreview({
  run,
  active,
  draftUrl,
  draftMessage,
  submitCode,
}: {
  run: Run | null;
  active: boolean;
  draftUrl: string;
  draftMessage: string;
  submitCode: (code: string) => Promise<string | null>;
}) {
  const elapsed = useElapsed(active && run?.createdAt ? run.createdAt : null);
  const frames = useFrames(run);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!expanded) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [expanded]);

  if (!run || (!active && !frames.length && run.status !== "failed"))
    return <DemoScreen url={draftUrl} message={draftMessage} />;

  const recording = run.status === "capturing";
  const failed = run.status === "failed";
  const done = run.status === "completed";
  let address = run.url;
  if (run.pageUrl) address = run.pageUrl;
  address = address.replace(/^https:\/\//, "");
  const bootIndex =
    run.status === "queued" ? 0 : Math.min(3, 1 + Math.floor(elapsed / 9));
  return (
    <>
      {expanded && (
        <button
          className="preview-backdrop"
          aria-label="Close enlarged preview"
          onClick={() => setExpanded(false)}
        />
      )}
      <div
        className={`device live ${expanded ? "expanded" : ""} ${failed ? "failed" : ""}`}
      >
        <BrowserChrome
          address={address}
          loading={active && !frames.length}
          badge={
            failed ? (
              <span className="live-badge stopped">STOPPED</span>
            ) : done ? (
              <span className="live-badge done">VERIFIED</span>
            ) : recording ? (
              <span className="live-badge rec">REC {clock(elapsed)}</span>
            ) : (
              <span className="live-badge on">LIVE {clock(elapsed)}</span>
            )
          }
          actions={
            frames.length ? (
              <button
                className="chrome-button"
                onClick={() => setExpanded((value) => !value)}
                aria-label={expanded ? "Shrink preview" : "Enlarge preview"}
              >
                {expanded ? "✕" : "⤢"}
              </button>
            ) : null
          }
        />
        <div className="screen">
          {frames.length ? (
            frames.map((src, index) => (
              // Private, same-origin frames that change every second; next/image adds nothing here.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={src}
                src={src}
                alt={
                  index === frames.length - 1
                    ? `Live view of the capture browser: ${run.step ?? "working"}`
                    : ""
                }
                className={
                  index === frames.length - 1 ? "frame current" : "frame"
                }
              />
            ))
          ) : failed ? null : (
            <div className="boot">
              <div className="boot-mark" aria-hidden="true">
                <span />
              </div>
              <ol>
                {bootSteps.map((label, index) => (
                  <li
                    key={label}
                    className={
                      index < bootIndex
                        ? "past"
                        : index === bootIndex
                          ? "now"
                          : ""
                    }
                  >
                    {label}
                  </li>
                ))}
              </ol>
              <small>
                {run.status === "queued"
                  ? "Waiting for a free browser…"
                  : "Live view appears as soon as the desktop is up, usually within a minute."}
              </small>
            </div>
          )}
          {run.needsCode && (
            <CodePrompt submit={submitCode} detail={run.detail} />
          )}
          {failed && (
            <div className="screen-alert" role="alert">
              <strong>This run needs attention</strong>
              <small>
                {run.step ? `Stopped at: ${run.step}. ` : ""}Details below.
              </small>
            </div>
          )}
          {!failed && frames.length > 0 && (
            <div className="screen-caption live">
              <span key={run.step ?? run.status}>
                {run.needsCode
                  ? "Waiting for your verification code"
                  : (run.step ?? run.detail)}
              </span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function CodePrompt({
  submit,
  detail,
}: {
  submit: (code: string) => Promise<string | null>;
  detail: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem(
      "code",
    ) as HTMLInputElement;
    setBusy(true);
    setError((await submit(input.value)) ?? "");
    setBusy(false);
  }
  return (
    <form className="code-prompt" onSubmit={send}>
      <strong>Verification code needed</strong>
      <p>{detail}</p>
      <div>
        <input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label="Verification code"
          placeholder="123456"
          maxLength={12}
          required
          autoFocus
        />
        <button type="submit" disabled={busy}>
          {busy ? "Sending…" : "Continue"}
        </button>
      </div>
      {error && <small role="alert">{error}</small>}
    </form>
  );
}
