/**
 * voicecap preflight: the quick checks init and doctor start with, on their own. It shows this
 * computer's details and each check, how to fix what failed, and one verdict at the end. It never
 * starts the screen reader or the browser, and never runs the live test (doctor adds that), so it
 * needs no site and changes nothing. Platform-neutral, as doctor is: it works from any
 * PlatformReadiness (Windows, Mac, or Linux's), with no driver imports of its own.
 */
import type { PlatformReadiness, PreflightResult } from "./model.js";
import { runPreflight } from "./preflight.js";
import {
  renderCheckingNotice,
  renderChecks,
  renderFixes,
  renderHeader,
  renderMachineInfo,
} from "./render.js";
import { ExitCode } from "../util/errors.js";
import type { Logger, Outcome } from "../util/log.js";

const DOCTOR = "npx @icjia/voicecap doctor";
const INIT = "npx @icjia/voicecap init";

/** The verdict, shown green or red where color is shown, and the line that follows it, if any. */
interface Ending {
  outcome: Outcome;
  verdict: string;
  after: string | null;
  exitCode: number;
}

/**
 * How the report ends. Not ready: how many things to fix, and how to check again, except where
 * there's no screen reader to drive (Linux), which no fix changes. Ready: where voicecap can't run
 * the screen reader yet (a Mac, until its VoiceOver driver exists), that the checks passed and why
 * a run has to wait; anywhere else, what to do next.
 */
function ending(result: PreflightResult, platform: PlatformReadiness, again: string): Ending {
  if (!result.ready) {
    if (platform.screenReader === null) {
      return {
        outcome: "fail",
        verdict: "✗ Not ready: voicecap can't drive a screen reader on this computer.",
        after: null,
        exitCode: ExitCode.environment,
      };
    }
    const count = result.checks.filter((check) => check.status === "FAIL").length;
    return {
      outcome: "fail",
      verdict: `✗ Not ready: ${count} ${count === 1 ? "thing" : "things"} to fix.`,
      after: `Fix these, then run ${again} again.`,
      exitCode: ExitCode.environment,
    };
  }
  if (platform.cannotRunYet !== null) {
    return {
      outcome: "pass",
      verdict: "✓ Ready: this Mac passed every check.",
      after: platform.cannotRunYet,
      exitCode: ExitCode.ok,
    };
  }
  const screenReader = platform.screenReader ?? "the screen reader";
  return {
    outcome: "pass",
    verdict: "✓ Ready: this computer can run voicecap.",
    after: `Next: ${DOCTOR} adds a 20-second live test with ${screenReader} (hands off the keyboard and mouse), or ${INIT} sets up a run.`,
    exitCode: ExitCode.ok,
  };
}

/**
 * Says the platform's checking notice, runs the preflight, and logs the report: the header, "This
 * computer", "Checks", the numbered fixes for what failed, then the verdict. It doesn't use
 * renderPreflight, whose own verdict this one would repeat. Returns 0 when every check passed (a
 * warning isn't a failure) and 2 when one failed, as init does.
 */
export async function runPreflightCommand(options: {
  platform: PlatformReadiness;
  logger: Logger;
  /** The command that runs this again, e.g. "npx @icjia/voicecap preflight". */
  again: string;
  now?: () => Date;
}): Promise<number> {
  const { platform, logger } = options;
  const now = options.now ?? (() => new Date());

  const notice = renderCheckingNotice(platform.checkingNotice);
  if (notice) logger.info(notice);
  const result = await runPreflight(platform);

  const report = [
    renderHeader("preflight", now()),
    renderMachineInfo(result.info),
    renderChecks(result.checks),
    renderFixes(result.checks, { offerSetup: true }),
  ].filter((part) => part !== "");
  logger.info(`${report.join("\n\n")}\n`);

  const end = ending(result, platform, options.again);
  logger.info(end.verdict, end.outcome);
  if (end.after !== null) logger.info(end.after);
  return end.exitCode;
}
