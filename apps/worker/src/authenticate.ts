import type { Locator, Page } from "playwright";

/** A sign-in outcome safe to show the run owner: written by us, never page text. */
export class SignInFailure extends Error {}

export interface SignInHooks {
  step?: (label: string) => Promise<void>;
  /** Resolves with a one-time code the owner typed into the studio. */
  requestCode?: (kind: "email" | "authenticator") => Promise<string>;
}

type Screen =
  | { kind: "done" }
  | { kind: "password"; input: Locator }
  | { kind: "code"; input: Locator; channel: "email" | "authenticator" }
  | { kind: "error"; reason: string };

const errorSelector =
  '[role="alert"], .cl-formFieldErrorText, .cl-alert, [id$="-error"], [id$="-error-feedback"]';
const codeSelector =
  'input[autocomplete="one-time-code"], input[name="code"], input[name^="codeInput"]';

/** Identity providers such as Clerk keep an invisible, unfocusable password
 * input for autofill. Only a field a person could see and type into counts. */
async function usablePassword(page: Page) {
  const all = page.locator('input[type="password"]');
  const index = await all.evaluateAll((elements) =>
    elements.findIndex((element) => {
      if (
        (element as HTMLInputElement).tabIndex < 0 ||
        element.closest('[aria-hidden="true"]')
      )
        return false;
      const box = element.getBoundingClientRect();
      if (box.width < 4 || box.height < 4) return false;
      for (
        let node: Element | null = element;
        node;
        node = node.parentElement
      ) {
        const style = getComputedStyle(node);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.opacity === "0"
        )
          return false;
      }
      return true;
    }),
  );
  return index < 0 ? undefined : all.nth(index);
}

function classify(text: string, host: string) {
  if (/password is incorrect|incorrect password|wrong password/i.test(text))
    return `${host} rejected the password for this account. Check it and start a new capture.`;
  if (
    /couldn.t find your account|no account|account not found|doesn.t exist/i.test(
      text,
    )
  )
    return `${host} couldn't find an account with that email address.`;
  if (/breach|compromised|pwned/i.test(text))
    return `${host} flagged this password as exposed in a data breach and requires a reset before signing in.`;
  if (/too many|locked|try again later|rate limit/i.test(text))
    return `${host} temporarily blocked sign-in after too many attempts. Wait a few minutes, then try again.`;
  if (/code/i.test(text) && /incorrect|invalid|expired|wrong/i.test(text))
    return "The verification code wasn't accepted. Start a new capture and enter the newest code.";
  if (/bot|captcha|human|suspicious|unusual/i.test(text))
    return `${host}'s bot protection blocked the sign-in from the capture browser.`;
  return `${host} showed a sign-in error. Check the email and password, then try again.`;
}

async function currentScreen(
  page: Page,
  host: string,
  signedIn: () => Promise<boolean>,
  urlSignals: boolean,
): Promise<Screen | undefined> {
  const errors = await page
    .locator(errorSelector)
    .filter({ visible: true })
    .allInnerTexts();
  const error = errors.map((text) => text.trim()).find(Boolean);
  // A known signed-in URL wins over stray alerts; otherwise errors come first,
  // because a form that removes its password field on rejection looks "done".
  if (await signedIn())
    return error && !urlSignals
      ? { kind: "error", reason: classify(error, host) }
      : { kind: "done" };
  if (error) return { kind: "error", reason: classify(error, host) };
  const code = page.locator(codeSelector).first();
  if (await code.count()) {
    const prompt = await page
      .getByText(/authenticator/i)
      .filter({ visible: true })
      .count();
    return {
      kind: "code",
      input: code,
      channel: prompt ? "authenticator" : "email",
    };
  }
  const password = await usablePassword(page);
  if (password && !(await password.inputValue()))
    return { kind: "password", input: password };
  return undefined;
}

async function waitForScreen(
  page: Page,
  host: string,
  signedIn: () => Promise<boolean>,
  urlSignals: boolean,
  accept: Screen["kind"][],
  timeout: number,
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const screen = await currentScreen(page, host, signedIn, urlSignals).catch(
      () => undefined,
    );
    if (screen && accept.includes(screen.kind)) return screen;
    await page.waitForTimeout(250);
  }
  return undefined;
}

export async function signInWithCredentials(
  page: Page,
  targetUrl: string,
  credentials: { email: string; password: string },
  hooks: SignInHooks = {},
) {
  const target = new URL(targetUrl);
  const krafty = target.hostname === "kraftybot.app";
  const host = target.hostname;
  let passwordSubmitted = false;
  // Krafty lands on its workspace; elsewhere, success is the login form leaving.
  const signedIn = async () => {
    const url = new URL(page.url());
    if (url.origin !== target.origin) return false;
    if (krafty) return /^\/(workspace|chats)(\/|$)/.test(url.pathname);
    return (
      passwordSubmitted &&
      !(await usablePassword(page)) &&
      !(await page.locator(codeSelector).count())
    );
  };
  try {
    await hooks.step?.("Opening the sign-in page");
    await page.goto(
      krafty ? `${target.origin}/sign-in?redirect_url=%2Fworkspace` : targetUrl,
      { waitUntil: "domcontentloaded" },
    );
    const email = page.locator(
      'input[type="email"], input[autocomplete="username"], input[autocomplete="email"], input[name="identifier"]',
    );
    await email
      .first()
      .waitFor({ state: "visible" })
      .catch(() => {
        throw new SignInFailure(
          `${host} didn't show an email sign-in field. Check the website URL.`,
        );
      });
    if (new URL(page.url()).origin !== target.origin)
      throw new Error("Unexpected login origin");
    await hooks.step?.("Entering email");
    await email.first().fill("");
    await email.first().pressSequentially(credentials.email, { delay: 30 });
    if (!(await usablePassword(page))) {
      await page
        .getByRole("button", { name: /^(continue|next|sign in|log in)$/i })
        .first()
        .click();
    }
    let screen = await waitForScreen(
      page,
      host,
      signedIn,
      krafty,
      ["password", "code", "error", "done"],
      30_000,
    );
    if (!screen)
      throw new SignInFailure(
        `${host} didn't ask for a password after the email. This account may only use Google, Apple, or a passkey; use an email-and-password demo account.`,
      );
    if (screen.kind === "password") {
      if (new URL(page.url()).origin !== target.origin)
        throw new Error("Unexpected password origin");
      await hooks.step?.("Entering password");
      await screen.input.fill(credentials.password);
      credentials.password = "";
      passwordSubmitted = true;
      await page
        .getByRole("button", { name: /^(continue|sign in|log in|login)$/i })
        .filter({ visible: true })
        .first()
        .click();
      await hooks.step?.("Signing in");
      screen = await waitForScreen(
        page,
        host,
        signedIn,
        krafty,
        ["code", "error", "done"],
        60_000,
      );
    }
    for (let attempt = 0; screen?.kind === "code" && attempt < 2; attempt++) {
      if (!hooks.requestCode)
        throw new SignInFailure(
          `${host} asked for a verification code, which this run can't receive.`,
        );
      await hooks.step?.("Waiting for your verification code");
      const code = await hooks.requestCode(screen.channel);
      if (new URL(page.url()).origin !== target.origin)
        throw new Error("Unexpected verification origin");
      await hooks.step?.("Entering verification code");
      await screen.input.click();
      await screen.input.pressSequentially(code, { delay: 60 });
      // Many code forms submit themselves on the last digit; others need a button.
      const submit = page
        .getByRole("button", { name: /^(continue|verify|submit|sign in)$/i })
        .filter({ visible: true })
        .first();
      await page.waitForTimeout(800);
      if (!(await signedIn()) && (await submit.count()))
        await submit.click().catch(() => undefined);
      passwordSubmitted = true;
      screen = await waitForScreen(
        page,
        host,
        signedIn,
        krafty,
        ["code", "error", "done"],
        45_000,
      );
      // The same code form still showing an empty field means it wants a new code.
      if (screen?.kind === "code" && (await screen.input.inputValue()))
        screen = undefined;
    }
    if (screen?.kind === "error") throw new SignInFailure(screen.reason);
    if (screen?.kind !== "done")
      throw new SignInFailure(
        `Sign-in on ${host} didn't finish. Check the last screen in the live preview for what the site asked for.`,
      );
  } finally {
    credentials.password = "";
    credentials.email = "";
  }
}
