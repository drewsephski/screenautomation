import type { FormEvent, RefObject } from "react";
import { useState } from "react";

export const defaultUrl = "https://kraftybot.app";
export const defaultMessage =
  "In this chat only, write three short tips for planning a focused workday. Do not use any tools or contact anyone.";

export function IntakeForm({
  form,
  submit,
  active,
  busy,
  error,
  onDraft,
}: {
  form: RefObject<HTMLFormElement | null>;
  submit: (event: FormEvent<HTMLFormElement>) => void;
  active: boolean;
  busy: boolean;
  error: string;
  onDraft: (draft: { url: string; message: string }) => void;
}) {
  const [mode, setMode] = useState("chat");
  return (
    <section className="intake panel" aria-labelledby="setup-title">
      <div className="panel-heading">
        <span className="step-number">01</span>
        <div>
          <h2 id="setup-title">Set the scene</h2>
          <p>Start with a website you have permission to use.</p>
        </div>
      </div>
      <form
        ref={form}
        onSubmit={submit}
        onInput={(event) => {
          const values = new FormData(event.currentTarget);
          onDraft({
            url: String(values.get("url") ?? ""),
            message: String(values.get("message") ?? ""),
          });
        }}
      >
        <fieldset disabled={active || busy}>
          <label htmlFor="mode">What should we record?</label>
          <select
            id="mode"
            name="mode"
            value={mode}
            onChange={(event) => setMode(event.target.value)}
          >
            <option value="chat">A real chat and reply</option>
            <option value="tour">A read-only product tour</option>
          </select>
          <label htmlFor="url">Website URL</label>
          <input
            id="url"
            name="url"
            type="url"
            defaultValue={defaultUrl}
            required
            maxLength={2048}
            placeholder="https://your-product.com"
            autoComplete="url"
          />
          <div className="credentials">
            <div className="section-label">
              <span aria-hidden="true">⌑</span> Website login
            </div>
            <p className="field-note">
              The agent uses these details to sign in before recording starts.
            </p>
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              maxLength={320}
              placeholder="demo@your-product.com"
            />
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={1024}
              placeholder="Your website password"
            />
            <p className="privacy-note">
              Encrypted for this run. Removed after login or when the run ends.
              Use a prepared demo account.
            </p>
          </div>
          <label htmlFor="message">
            {mode === "tour"
              ? "What should the story show?"
              : "Message to send"}
          </label>
          <textarea
            id="message"
            name="message"
            rows={3}
            required
            maxLength={1000}
            defaultValue={defaultMessage}
          />
          <p className="field-note">
            {mode === "tour"
              ? "Claude proposes up to three enabled product pages. Review the story before recording. No forms are submitted."
              : "One chat message. No payments, deletions, or messages to other people."}
          </p>
          <p className="privacy-note">
            Claude receives your goal, visible page titles and enabled
            navigation links. Your password and cookies stay outside the model.
            An exact chat URL skips chat discovery.
          </p>
          {mode === "chat" && (
            <details>
              <summary>Already have a specific chat page?</summary>
              <label htmlFor="chatUrl">
                Chat URL <span className="optional">optional</span>
              </label>
              <input
                id="chatUrl"
                name="chatUrl"
                type="url"
                maxLength={2048}
                placeholder="https://your-product.com/chats/…"
              />
              <p className="field-note">
                Must belong to the same website. Otherwise, the agent looks for
                an existing chat.
              </p>
            </details>
          )}
          <label className="consent">
            <input name="consent" type="checkbox" required />
            <span>
              {mode === "tour"
                ? "I have permission to access this account and record its approved product pages."
                : "I have permission to access this account, record its screen, and send this chat message."}
            </span>
          </label>
          <button className="primary-button" type="submit">
            {busy
              ? "Starting…"
              : active
                ? "Capture in progress"
                : "Start a capture"}
            <span aria-hidden="true">↗</span>
          </button>
        </fieldset>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
