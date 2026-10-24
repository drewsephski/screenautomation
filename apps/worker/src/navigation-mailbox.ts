import { readFile, writeFile, rename } from "node:fs/promises";
import {
  NavigationDecision,
  type NavigationObservation,
} from "./navigation-contract.ts";
import { DemoStory } from "@repo/contracts";
import type { TourObservation } from "./tour.ts";

export async function requestTour(root: string, observation: TourObservation) {
  await writeFile(`${root}/tour-request.tmp`, JSON.stringify(observation), {
    mode: 0o600,
  });
  await rename(`${root}/tour-request.tmp`, `${root}/tour-request.json`);
  const deadline = Date.now() + 7 * 60000;
  while (Date.now() < deadline) {
    try {
      const response = JSON.parse(
        await readFile(`${root}/tour-response.json`, "utf8"),
      );
      if (response.error) throw new Error("Story proposal or approval failed");
      return DemoStory.parse(response.story);
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Story review timed out");
}

/** Files are private sandbox IPC; the Anthropic key never enters the browser VM. */
export async function requestNavigation(
  root: string,
  observation: NavigationObservation,
) {
  const temporary = `${root}/navigation-request.tmp`;
  await writeFile(temporary, JSON.stringify(observation), { mode: 0o600 });
  await rename(temporary, `${root}/navigation-request.json`);
  const deadline = Date.now() + 65000;
  while (Date.now() < deadline) {
    let response: unknown;
    try {
      response = JSON.parse(
        await readFile(`${root}/navigation-response.json`, "utf8"),
      );
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    if (
      response &&
      typeof response === "object" &&
      "id" in response &&
      response.id === observation.id
    ) {
      if (!("decision" in response))
        throw new Error("Claude navigation failed");
      return NavigationDecision.parse(response.decision);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Claude navigation timed out");
}
