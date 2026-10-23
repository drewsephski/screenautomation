import type { FormEvent, RefObject } from "react";

export function IntakeForm({
  form,
  submit,
  active,
  busy,
  error,
}: {
  form: RefObject<HTMLFormElement | null>;
  submit: (event: FormEvent<HTMLFormElement>) => void;
  active: boolean;
  busy: boolean;
  error: string;
}) {
  return (
    <section className="intake panel" aria-labelledby="setup-title">
      <div className="panel-heading">
        <span className="step-number">01</span>
        <div>
          <h2 id="setup-title">Set the scene</h2>
          <p>Start with a website you have permission to use.</p>
        </div>
      </div>
      <form ref={form} onSubmit={submit}>
        <fieldset disabled={active || busy}>
          <label htmlFor="url">Website URL</label>
          <input
            id="url"
            name="url"
            type="url"
            defaultValue="https://kraftybot.app"
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
          <label htmlFor="message">Message to send</label>
          <textarea
            id="message"
            name="message"
            rows={3}
            required
            maxLength={1000}
            defaultValue="In this chat only, write three short tips for planning a focused workday. Do not use any tools or contact anyone."
          />
          <p className="field-note">
            One chat message. No payments, deletions, or messages to other
            people.
          </p>
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
              Must belong to the same website. Otherwise, the agent looks for an
              existing chat.
            </p>
          </details>
          <label className="consent">
            <input name="consent" type="checkbox" required />
            <span>
              I have permission to access this account, record its screen, and
              send this chat message.
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
