import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { armReplyCompletion, waitForCompletedReply } from "./completion.ts";

test("a reply needs an observed streaming-to-idle transition, not a quiet partial paragraph", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<button aria-label="Submit">Send</button><div class="is-assistant">A partial paragraph</div>',
    );
    await armReplyCompletion(page);
    await assert.rejects(waitForCompletedReply(page, 0, 100));
    await page.setContent(
      "<button aria-label=\"Submit\" onclick=\"this.setAttribute('aria-label','Stop generating');document.querySelector('.is-assistant').textContent='Partial';setTimeout(()=>{document.querySelector('.is-assistant').textContent='Full verified reply';this.setAttribute('aria-label','Submit')},80)\">Send</button><div class=\"is-assistant\"></div>",
    );
    await armReplyCompletion(page);
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    assert.equal(
      await waitForCompletedReply(page, 0, 1000),
      "Full verified reply",
    );
  } finally {
    await browser.close();
  }
});
