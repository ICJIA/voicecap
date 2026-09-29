/**
 * The live check, for any screen reader: the real driver against a tiny page served on
 * 127.0.0.1. The screen reader starts, the browser comes to the front, and speech is captured,
 * exactly as in a run. Windows' live test is this check with the NVDA driver.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import type { VoicecapConfig } from "../config/schema.js";
import type { EnvironmentInfo, ScreenReaderDriver, Speech } from "../drivers/types.js";
import { withTimeout } from "../passes/steps.js";

/** What the live check saw. */
export interface LiveCheck {
  environment: EnvironmentInfo;
  /** What the screen reader said for the check's steps (the top of the page, then the first Tab). */
  speech: Speech[];
  /** Average time per step. */
  stepMs: number;
}

const CHECK_PAGE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>voicecap doctor</title></head>
  <body>
    <main>
      <h1>voicecap doctor check</h1>
      <p>If the screen reader reads this, voicecap can hear it.</p>
      <button type="button">Doctor button</button>
    </main>
  </body>
</html>
`;

/** Serve the check page on 127.0.0.1 (a free port) until close(). */
export async function serveCheckPage(): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(CHECK_PAGE);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * Start the driver, open the page, and capture two steps, with a run's timeouts, stopping when
 * the signal (Ctrl+C) aborts. The screen reader and the browser are stopped however it ends.
 */
export async function runLiveCheck(
  driver: ScreenReaderDriver,
  url: string,
  config: VoicecapConfig,
  signal?: AbortSignal,
  onCleanup: (note: string) => void = () => {},
): Promise<LiveCheck> {
  const { stepMs, driverStartMs } = config.timeouts;
  const within = <T>(what: string, action: () => Promise<T>, ms: number) =>
    withTimeout(what, action, ms, signal);
  try {
    const notes = await within(
      "Cleaning up after earlier runs",
      () => driver.cleanupStale(),
      driverStartMs,
    );
    for (const note of notes) onCleanup(note);
    await within("Starting the screen reader and the browser", () => driver.start(), driverStartMs);
    const environment = await within(
      "Reading the environment",
      () => driver.getEnvironmentInfo(),
      stepMs,
    );
    await within(
      "Opening the check page",
      () => driver.openPage(url),
      config.readiness.networkIdleTimeoutMs + stepMs,
    );
    const started = performance.now();
    const speech = [
      await within("Moving to the top of the page", () => driver.toTop(), stepMs),
      await within("Pressing Tab", () => driver.nextFocusable(), stepMs),
    ];
    return { environment, speech, stepMs: (performance.now() - started) / speech.length };
  } finally {
    await driver.stop();
  }
}
