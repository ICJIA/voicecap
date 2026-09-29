/**
 * voicecap doctor: run a platform's preflight, then (when it's ready) its live test, and print
 * one summary to paste into a bug report. Platform-neutral: works from any PlatformReadiness
 * (Windows, Mac, or Linux's), with no driver imports of its own.
 */
import type { Check, PlatformReadiness } from "./model.js";
import { runPreflight } from "./preflight.js";
import { renderCheckingNotice, renderPreflight } from "./render.js";
import { InterruptedError } from "../passes/steps.js";
import { ExitCode } from "../util/errors.js";
import type { Logger } from "../util/log.js";

/**
 * What doctor says on the first Ctrl+C (or SIGTERM, or SIGHUP): the test stops, and the screen
 * reader it uses and the browser are shut down.
 */
export function interruptMessage(screenReader: string | null): (signal: NodeJS.Signals) => string {
  const name = screenReader ?? "the screen reader";
  return (signal) =>
    `${signal} received: stopping the test and shutting down ${name} and the browser. Press Ctrl+C again to exit immediately.`;
}

/**
 * Says the platform's checking notice, then runs the preflight. If it's ready and the platform has
 * a live test, logs the live-test notice, runs it, and folds its checks into the report,
 * recomputing ready. Logs one rendered report and returns 0 (ready), 2 (not ready). Ctrl+C during
 * the live test (InterruptedError) skips the report: logs a warning instead and returns 130.
 */
export async function runDoctor(options: {
  platform: PlatformReadiness;
  logger: Logger;
  signal?: AbortSignal;
  now?: () => Date;
}): Promise<number> {
  const { platform, logger } = options;
  const now = options.now ?? (() => new Date());

  const notice = renderCheckingNotice(platform.checkingNotice);
  if (notice) logger.info(notice);
  const preflight = await runPreflight(platform);
  let checks: Check[] = preflight.checks;
  let ready = preflight.ready;

  if (preflight.ready && platform.liveTest) {
    for (const line of platform.liveTestNotice) logger.info(line);
    let liveChecks: Check[];
    try {
      liveChecks = await platform.liveTest(options.signal);
    } catch (error) {
      if (!(error instanceof InterruptedError)) throw error;
      logger.warn("Interrupted: the screen reader and the browser were shut down.");
      return ExitCode.interrupted;
    }
    checks = [...checks, ...liveChecks];
    ready = checks.every((check) => check.status !== "FAIL");
  }

  logger.info(
    renderPreflight(
      { info: preflight.info, checks, ready },
      {
        kind: "doctor",
        when: now(),
        screenReader: platform.screenReader,
        canRunYet: platform.cannotRunYet === null,
        tip: platform.readyTip,
        offerSetup: true,
      },
    ),
  );
  return ready ? ExitCode.ok : ExitCode.environment;
}
