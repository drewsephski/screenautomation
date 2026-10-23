"use client";

import Link from "next/link";
import { IntakeForm } from "./intake-form";
import { CaptureProgress, type Run } from "./capture-progress";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";

function subscribeRun(callback: () => void) {
  window.addEventListener("capture-run-change", callback);
  return () => window.removeEventListener("capture-run-change", callback);
}
function saveRunId(id: string | null) {
  if (id) sessionStorage.setItem("capture-run", id);
  else sessionStorage.removeItem("capture-run");
  window.dispatchEvent(new Event("capture-run-change"));
}

export function CaptureStudio() {
  const [run, setRun] = useState<Run | null>(null);
  const runId = useSyncExternalStore(
    subscribeRun,
    () => sessionStorage.getItem("capture-run"),
    () => null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [statusError, setStatusError] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const terminal =
    !!run && ["completed", "failed", "cancelled"].includes(run.status);
  useEffect(() => {
    if (!runId || terminal) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`/api/runs/${runId}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const data = await response.json();
        if (!response.ok) {
          setStatusError(data.error);
          if (response.status === 404) {
            saveRunId(null);
          }
        } else {
          setRun(data);
          setStatusError("");
        }
      } catch {
        if (!controller.signal.aborted)
          setStatusError("Connection interrupted. Reconnecting to your run…");
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 3000);
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [runId, terminal]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || (runId && !terminal)) return;
    setBusy(true);
    setError("");
    const values = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: values.get("url"),
          email: values.get("email"),
          password: values.get("password"),
          message: values.get("message"),
          chatUrl: values.get("chatUrl") || undefined,
          consent: values.get("consent") === "on",
        }),
      });
      const data = await response.json();
      // Password is never kept in React state, browser storage, or the run URL.
      const password = form.current?.elements.namedItem(
        "password",
      ) as HTMLInputElement | null;
      if (password) password.value = "";
      if (!response.ok) {
        setError(data.error ?? "Could not start the run.");
        return;
      }
      const next = {
        id: data.id,
        url: String(values.get("url")),
        status: "queued",
        detail: "Waiting for a browser",
        hasArtifact: false,
      };
      setRun(next);
      saveRunId(data.id);
    } catch {
      setError(
        "Could not reach the studio. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!runId) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/runs/${runId}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      setRun((current) =>
        current
          ? {
              ...current,
              status: "cancelled",
              detail:
                "Cancellation requested. An action already sent to the site may finish.",
            }
          : current,
      );
    } catch {
      setStatusError("Could not cancel the run. Try again.");
    } finally {
      setBusy(false);
    }
  }
  const active = !!runId && !terminal;
  return (
    <div className="studio-shell">
      <header className="topbar">
        <Link className="wordmark" href="/" aria-label="Screen studio home">
          <span className="brand-mark" aria-hidden="true">
            ▣
          </span>{" "}
          screen<span>studio</span>
        </Link>
        <span className="beta-label">
          CAPTURE LAB <span>Private beta</span>
        </span>
      </header>
      <main>
        <div className="intro">
          <div>
            <p className="eyebrow">YOUR PRODUCT. IN MOTION.</p>
            <h1>
              Show the work.
              <br />
              <span>Keep it real.</span>
            </h1>
          </div>
          <p className="intro-note">
            Give the browser a place to go and a message to send. Capture a real
            conversation, from the first keystroke to the reply.
          </p>
        </div>
        <div className="workspace">
          <IntakeForm
            form={form}
            submit={submit}
            active={active}
            busy={busy}
            error={error}
          />
          <CaptureProgress
            run={run}
            active={active}
            busy={busy}
            statusError={statusError}
            cancel={cancel}
          />
        </div>
      </main>
      <footer>
        <span>Built around evidence, frame by frame.</span>
        <span>Login screens are never recorded.</span>
      </footer>
    </div>
  );
}
