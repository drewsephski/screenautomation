import type { Page } from "playwright";

type CompletionWindow = Window & {
  captureCompletion?: {
    busySeen: boolean;
    finished: boolean;
    observer: MutationObserver;
  };
};

export async function armReplyCompletion(page: Page) {
  await page.evaluate(() => {
    const state = window as CompletionWindow;
    state.captureCompletion?.observer.disconnect();
    const observer = new MutationObserver(() => {
      const current = state.captureCompletion!;
      const buttons = Array.from(document.querySelectorAll("button"));
      const busy = buttons.some((button) =>
        /^stop( generating)?$/i.test(button.getAttribute("aria-label") ?? ""),
      );
      if (busy) current.busySeen = true;
      const idle = buttons.some((button) =>
        /^(submit|send|send message)$/i.test(
          button.getAttribute("aria-label") ?? "",
        ),
      );
      if (current.busySeen && !busy && idle) current.finished = true;
    });
    state.captureCompletion = { busySeen: false, finished: false, observer };
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-label"],
    });
  });
}
export async function waitForCompletedReply(
  page: Page,
  before: number,
  timeout = 120000,
) {
  try {
    await page.waitForFunction(
      (count) => {
        const state = window as CompletionWindow;
        const replies = document.querySelectorAll(
          '.is-assistant, [data-message-author-role="assistant"], [data-role="assistant"]',
        );
        return (
          state.captureCompletion?.finished &&
          replies.length > count &&
          !!replies.item(replies.length - 1)?.textContent?.trim()
        );
      },
      before,
      { timeout },
    );
    return (
      await page
        .locator(
          '.is-assistant, [data-message-author-role="assistant"], [data-role="assistant"]',
        )
        .last()
        .innerText()
    ).trim();
  } finally {
    await page
      .evaluate(() => {
        (window as CompletionWindow).captureCompletion?.observer.disconnect();
      })
      .catch(() => undefined);
  }
}
