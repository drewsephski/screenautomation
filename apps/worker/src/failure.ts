/** A run failure explained in words safe to show the run owner. */
export class CaptureFailure extends Error {}

const byPhase: Record<string, string> = {
  network:
    "The approved website addresses couldn't be pinned for the browser firewall. Try again shortly.",
  provisioning:
    "A private browser computer couldn't be started. The capture provider may be busy; try again in a minute.",
  logging_in:
    "Sign-in stopped unexpectedly. Check the last screen in the live preview, then try again.",
  rehearsing: "Signed in, but the chat couldn't be prepared for recording.",
  capturing:
    "Recording stopped before a complete reply was verified. Review the site before retrying; a message may already have been sent.",
  checking:
    "The take was recorded, but its media couldn't be verified or saved. Review the site before retrying; the message was sent.",
};
export function failureReason(error: unknown, phase: string) {
  return error instanceof CaptureFailure
    ? error.message
    : (byPhase[phase] ?? byPhase.provisioning!);
}
