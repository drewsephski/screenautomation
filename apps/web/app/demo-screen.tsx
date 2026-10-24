"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { BrowserChrome } from "./browser-chrome";

/** A rehearsal of what the agent does, so the preview is never an empty slate.
 * It is clearly labelled as a preview; live frames replace it during a run. */
const TOTAL = 16800;
const scenes = [
  { until: 1800, caption: "Opens your website in a private browser" },
  { until: 5600, caption: "Signs in privately. Login is never recorded" },
  { until: 8200, caption: "Opens an existing chat" },
  { until: 14800, caption: "Types once and records the real reply" },
  { until: TOTAL, caption: "Verifies the footage, frame by frame" },
];
// Cursor keyframes in screen percentages.
const path: [number, number, number][] = [
  [0, 78, 82],
  [1800, 78, 82],
  [2400, 50, 47],
  [3600, 50, 47],
  [4100, 50, 70],
  [4400, 50, 70],
  [5200, 50, 70],
  [6200, 34, 82],
  [6600, 14, 30],
  [7400, 14, 30],
  [8600, 52, 88],
  [11000, 52, 88],
  [11500, 92, 88],
  [12000, 92, 88],
  [14800, 70, 60],
  [TOTAL, 78, 82],
];
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
function cursorAt(t: number) {
  for (let i = 1; i < path.length; i++) {
    const [end, x, y] = path[i]!;
    const [start, px, py] = path[i - 1]!;
    if (t <= end) {
      const k = end === start ? 1 : ease((t - start) / (end - start));
      return { x: px + (x - px) * k, y: py + (y - py) * k };
    }
  }
  return { x: 78, y: 82 };
}
const typed = (text: string, t: number, start: number, end: number) =>
  text.slice(
    0,
    Math.round(
      text.length * Math.min(1, Math.max(0, (t - start) / (end - start))),
    ),
  );
const clicks = [4100, 5200, 7200, 11600];
const reply = [
  "1. Pick one outcome that would make today a win.",
  "2. Block a 90-minute focus window before noon.",
  "3. Batch messages into two short check-ins.",
];

function subscribeMotion(callback: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

export function DemoScreen({ url, message }: { url: string; message: string }) {
  const reduced = useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
  const [clock, setClock] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const started = performance.now();
    const timer = setInterval(
      () => setClock((performance.now() - started) % TOTAL),
      60,
    );
    return () => clearInterval(timer);
  }, [reduced]);
  // Reduced motion holds on the finished conversation.
  const t = reduced ? 14600 : clock;
  let host = "your-product.com";
  try {
    host = new URL(url).host || host;
  } catch {
    // Keep the placeholder while the URL is being typed.
  }
  const scene = scenes.findIndex((item) => t < item.until);
  const cursor = cursorAt(t);
  const clicking = clicks.some((at) => t >= at && t < at + 260);
  const address =
    scene === 0
      ? typed(host, t, 200, 1300)
      : `${host}${["", "/sign-in", "/workspace", "/chats/launch-notes", "/chats/launch-notes"][scene]}`;
  const prompt =
    message.trim() || "Write three short tips for a focused workday.";
  const shortPrompt = prompt.length > 120 ? `${prompt.slice(0, 117)}…` : prompt;
  const recording = scene >= 3;
  return (
    <div className="device demo" aria-label="Animated preview of a capture run">
      <BrowserChrome
        address={address}
        loading={scene === 0 && t > 1300}
        badge={
          recording ? (
            <span className="live-badge rec">REC</span>
          ) : (
            <span className="live-badge preview">PREVIEW</span>
          )
        }
      />
      <div className="screen" aria-hidden="true">
        {scene === 0 && <div className="mock-blank" />}
        {scene === 1 && (
          <div className="mock-signin">
            <div className="mock-card">
              <b>Sign in to {host.split(".")[0]}</b>
              <small>Welcome back</small>
              <span
                className={`mock-input ${t > 2400 && t < 3700 ? "focus" : ""}`}
              >
                {typed("demo@your-product.com", t, 2400, 3500)}
              </span>
              <span className={`mock-input ${t > 4300 ? "focus" : ""}`}>
                {"•".repeat(
                  Math.round(Math.min(1, Math.max(0, (t - 4300) / 700)) * 12),
                )}
              </span>
              <span className="mock-button">Continue</span>
            </div>
            <span className="mock-lock">Private sign-in · not recorded</span>
          </div>
        )}
        {scene >= 2 && (
          <div className="mock-app">
            <aside>
              <i className="mock-logo" />
              {["Launch notes", "Weekly plan", "Ideas"].map((name, index) => (
                <span
                  key={name}
                  className={index === 0 && t > 7200 ? "active" : ""}
                >
                  {name}
                </span>
              ))}
            </aside>
            <section>
              {scene === 2 ? (
                <div className="mock-empty">
                  <b>Your workspace</b>
                  <small>Pick a conversation to continue</small>
                </div>
              ) : (
                <>
                  <div className="mock-thread">
                    {t > 11600 && <p className="bubble user">{shortPrompt}</p>}
                    {t > 11800 && t < 12600 && (
                      <p className="bubble assistant typing">
                        <i />
                        <i />
                        <i />
                      </p>
                    )}
                    {t >= 12600 && (
                      <p className="bubble assistant">
                        {reply.map((line, index) => (
                          <span key={line}>
                            {typed(
                              line,
                              t,
                              12600 + index * 550,
                              13150 + index * 550,
                            )}
                          </span>
                        ))}
                      </p>
                    )}
                  </div>
                  <div className="mock-composer">
                    <span>
                      {t < 11600 ? typed(shortPrompt, t, 8600, 11000) : ""}
                      {t >= 8600 && t < 11600 && <i className="caret" />}
                      {t >= 11600 || t < 8600 ? <em>Message</em> : null}
                    </span>
                    <b>↑</b>
                  </div>
                </>
              )}
            </section>
          </div>
        )}
        {scene === 4 && (
          <div className="mock-toast">
            <b>✓</b> Take verified · 1920 × 1080 · 60 fps
          </div>
        )}
        <svg
          className={`mock-cursor ${clicking ? "clicking" : ""}`}
          style={{ left: `${cursor.x}%`, top: `${cursor.y}%` }}
          viewBox="0 0 16 22"
        >
          <path
            d="M1 1v17l4.4-4.2 3 6.7 2.8-1.2-3-6.6H14z"
            fill="#17243b"
            stroke="#fff"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
        <div className="screen-caption">
          <span key={scene}>{scenes[scene]?.caption}</span>
        </div>
      </div>
    </div>
  );
}
