/**
 * voicecap demo: a guided first run, in seven steps, each explained and each waiting for Enter.
 * The welcome; this computer's checks (the preflight init starts with); the live test; an audit
 * of the demo site (runAudit, run as the command step 4 shows); the transcripts; the report; and
 * what to do next. Where voicecap can't run the screen reader yet (a Mac, until its VoiceOver
 * driver clears cannotRunYet), step 4 explains instead, and steps 5 and 6 are skipped.
 *
 * Everything the tour touches is injected (TourDeps), so tests fake the screen reader, the demo
 * site, the run, and the file opener. The demo site runs only during step 4's run, and stops
 * however the run ends.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { defaultConfig } from "../config/load.js";
import type { Prompter } from "../init/prompt.js";
import { displayPath } from "../pages/url.js";
import { InterruptedError } from "../passes/steps.js";
import { runLiveTest } from "../readiness/guided.js";
import type { Check, PlatformReadiness, PreflightResult } from "../readiness/model.js";
import { runPreflight } from "../readiness/preflight.js";
import { renderCheckingNotice, renderPreflight } from "../readiness/render.js";
import type { RunAuditOptions, RunAuditResult } from "../run/audit.js";
import { linkPath, liveReportPath, pageDir } from "../run/paths.js";
import { stopOnClosedWindow, stopOnCtrlC, type SignalSource } from "../run/signals.js";
import { extractBody } from "../transcripts/format.js";
import { EnvironmentError, errorMessage, ExitCode } from "../util/errors.js";
import type { Logger } from "../util/log.js";
import { DEMO_SITEMAP, type DemoServer } from "./server.js";
import {
  auditIntro,
  cannotAuditYet,
  CHECKING_INTRO,
  couldNotOpen,
  DEMO_OUT,
  demoFlagCheck,
  EXCERPT_LINES,
  failedInReport,
  failedInTranscripts,
  flagsSummary,
  homeExcerpt,
  NOT_READY_AGAIN,
  OPEN_REPORT,
  OPENING_REPORT,
  ownSite,
  pauseBefore,
  reportIntro,
  stepHeading,
  STOPPED,
  STOPPED_RUN_NEXT,
  stoppingAudit,
  TOUR_COMMAND,
  TOUR_TITLE,
  transcriptsIntro,
  welcome,
  WHERE_THE_TOUR_RUNS,
  type Step,
} from "./words.js";

export interface TourDeps {
  /** This computer's readiness (loadPlatformReadiness), or a test's fake. */
  platform: PlatformReadiness;
  /** The operating system, for the words where voicecap can't audit yet ("this Mac"). */
  os: NodeJS.Platform;
  /**
   * Asks at each pause. Its `interrupted` signal is Ctrl+C, which also stops the live test and
   * the audit: a terminal prompter keeps Ctrl+C to itself.
   */
  prompter: Prompter;
  logger: Logger;
  /** The current folder, where voicecap-demo/ goes. */
  cwd: string;
  /** For the run. Its VOICECAP_TRANSCRIPTS is never used: the run's --out is voicecap-demo. */
  env: NodeJS.ProcessEnv;
  /** The clock for the preflight's header. */
  now(): Date;
  /** startDemoServer, or a test's fake. */
  startServer(): Promise<DemoServer>;
  /** runAudit, or a test's fake. */
  runAudit(options: RunAuditOptions): Promise<RunAuditResult>;
  /** openFile (src/drivers/open-file.ts), or a test's fake: false when it couldn't open it. */
  openFile(file: string): Promise<boolean>;
  /**
   * Where a closed window's SIGHUP (and SIGTERM) come from, and during the audit a Ctrl+C that
   * arrives as a SIGINT: the process's own unless a test's.
   */
  signals?: SignalSource;
}

/**
 * Runs the tour and returns its exit code: 0 when it finished (a Mac's shorter tour included), 2
 * when the computer isn't ready or the live test failed, 3 when a page failed in the audit (as
 * for any run), and 130 when it was stopped: Ctrl+C at a pause, or Ctrl+C or a closed window
 * during the live test or the audit. A run that can't start throws its error, after the demo site
 * has stopped, and so does a demo site that can't start (an EnvironmentError, exit 2).
 */
export async function runTour(deps: TourDeps): Promise<number> {
  try {
    return await tour(deps);
  } catch (error) {
    if (!(error instanceof InterruptedError)) throw error;
    deps.logger.info(STOPPED);
    return ExitCode.interrupted;
  }
}

async function tour(deps: TourDeps): Promise<number> {
  const { platform, logger, os } = deps;
  const canAudit = platform.cannotRunYet === null;
  const screenReader = platform.screenReader ?? "the screen reader";
  const say = (text: string) => logger.info(text);
  const begin = (step: Step) => {
    say("");
    say(stepHeading(step));
  };
  // Ctrl+C here rejects with InterruptedError, which ends the tour (runTour).
  const pause = async (next: Exclude<Step, 1>) => {
    say("");
    await deps.prompter.ask(pauseBefore(next, canAudit));
  };

  say(TOUR_TITLE);
  begin(1);
  say(welcome({ screenReader: platform.screenReader, canAudit, os }));
  await pause(2);

  begin(2);
  say(CHECKING_INTRO);
  say("");
  const notice = renderCheckingNotice(platform.checkingNotice);
  if (notice) say(notice);
  const preflight = await runPreflight(platform);
  say(
    renderPreflight(forStepTwo(preflight, platform, os), {
      kind: "preflight",
      when: deps.now(),
      screenReader: platform.screenReader,
      canRunYet: canAudit,
      tip: platform.readyTip,
      offerSetup: true,
    }),
  );
  if (!preflight.ready) {
    say("");
    // With no screen reader to drive (Linux), this computer can't become ready.
    say(platform.screenReader === null ? WHERE_THE_TOUR_RUNS : NOT_READY_AGAIN);
    return ExitCode.environment;
  }
  await pause(3);

  begin(3);
  if (platform.liveTest) {
    for (const line of platform.liveTestNotice) say(line);
    const live = await runLiveTest(platform.liveTest, {
      prompter: deps.prompter,
      logger,
      ...(deps.signals ? { signals: deps.signals } : {}),
    });
    if (live === ExitCode.interrupted) throw new InterruptedError();
    if (live !== ExitCode.ok) return live;
  }
  await pause(4);

  begin(4);
  if (!canAudit) {
    say(cannotAuditYet(platform.screenReader));
    await pause(7);
    begin(7);
    say(ownSite({ screenReader: platform.screenReader, canAudit, os }));
    return ExitCode.ok;
  }
  const result = await audit(deps, preflight, screenReader);
  if (result.outcome === "interrupted") throw new InterruptedError();
  if (result.outcome === "stopped") {
    // Stopped after too many failed pages in a row: the run has said why, and the tour says what
    // to do next, since its run can't be resumed.
    say("");
    say(STOPPED_RUN_NEXT);
    return result.exitCode;
  }
  await pause(5);

  begin(5);
  const pages = result.run.pages;
  say(transcriptsIntro(linkPath(deps.cwd, result.runDir), screenReader));
  say(homeExcerpt(screenReader, await homeReadLines(result)));
  const failedHere = failedInTranscripts(pages);
  if (failedHere) say(failedHere);
  await pause(6);

  begin(6);
  const reportFile = liveReportPath(result.siteDir);
  const shownReport = linkPath(deps.cwd, reportFile);
  say(reportIntro(shownReport));
  say(flagsSummary(pages));
  const failedThere = failedInReport(pages);
  if (failedThere) say(failedThere);
  say("");
  if (await deps.prompter.confirm(OPEN_REPORT, true)) {
    say(OPENING_REPORT);
    // The absolute path, in this computer's own form, to open and, failing that, to show: Explorer
    // can't open C:/… as it can C:\…, and a browser takes the whole path pasted in.
    if (!(await deps.openFile(reportFile))) say(couldNotOpen(reportFile));
  }

  begin(7);
  say(ownSite({ screenReader: platform.screenReader, canAudit, os }));
  return result.exitCode;
}

/**
 * The preflight as step 2 shows it. Where the preflight can pass (there's a screen reader to
 * check) but voicecap can't run it yet, the tour's own WARN line goes after the platform's checks;
 * Linux's own FAIL says why instead. A fix step that says to add --replay-from is left out: it's
 * for runs (Linux's), and the demo takes no --replay-from.
 */
function forStepTwo(
  result: PreflightResult,
  platform: PlatformReadiness,
  os: NodeJS.Platform,
): PreflightResult {
  const checks = result.checks.map(withoutReplayStep);
  if (platform.cannotRunYet === null || platform.screenReader === null) {
    return { ...result, checks };
  }
  return { ...result, checks: [...checks, demoFlagCheck(os)] };
}

/** `check`, without any fix step that says to add --replay-from. */
function withoutReplayStep(check: Check): Check {
  if (!check.problem) return check;
  const fix = check.problem.fix.filter((step) => !step.includes("--replay-from"));
  return { ...check, problem: { ...check.problem, fix } };
}

/**
 * Step 4: starts the demo site, says what's running, and runs the audit, as the command it shows
 * would, without repeating step 2's checks, and with voicecap's own settings. Ctrl+C (through the
 * prompter, or as a SIGINT when the terminal has left raw mode) or a closed window stops the run
 * as they stop any run, and the tour says at once that it's stopping. The demo site stops however
 * the run ends.
 */
async function audit(
  deps: TourDeps,
  preflight: PreflightResult,
  screenReader: string,
): Promise<RunAuditResult> {
  const server = await deps.startServer().catch((error: unknown) => {
    throw new EnvironmentError(`The demo site couldn't start: ${errorMessage(error)}`, {
      cause: error,
    });
  });
  try {
    deps.logger.info(auditIntro(server.origin, screenReader));
    deps.logger.info("");
    const stop = new AbortController();
    const unlistenClosed = stopOnClosedWindow(stop, deps.signals);
    const unlistenCtrlC = stopOnCtrlC(stop, deps.signals);
    const signal = AbortSignal.any([deps.prompter.interrupted, stop.signal]);
    // Said once, the moment the run is stopped (already, if Ctrl+C came as the demo site started):
    // the shutdown can take a minute. Removed after the run, so a later pause's Ctrl+C says nothing.
    const stopping = () => deps.logger.info(stoppingAudit(screenReader));
    if (signal.aborted) stopping();
    else signal.addEventListener("abort", stopping, { once: true });
    try {
      return await deps.runAudit({
        site: server.origin,
        sitemap: DEMO_SITEMAP,
        out: DEMO_OUT,
        fresh: true,
        cwd: deps.cwd,
        env: deps.env,
        // Never a voicecap.config.* in this folder, which could change the passes, the flags, or
        // the driver: the demo is the same everywhere.
        config: defaultConfig(),
        logger: deps.logger,
        signal,
        preflight,
        // The run is --fresh, and the demo site stops with it: stopped early, it can't resume.
        again: TOUR_COMMAND,
      });
    } finally {
      signal.removeEventListener("abort", stopping);
      unlistenCtrlC();
      unlistenClosed();
    }
  } finally {
    await server.close();
  }
}

/**
 * The first lines of the home page's read.txt, after its header, or null when it has none (the
 * home page failed, say).
 */
async function homeReadLines(result: RunAuditResult): Promise<string[] | null> {
  const home = result.run.pages.find((page) => displayPath(page.url) === "/");
  if (!home?.files["read.txt"]) return null;
  const file = path.join(pageDir(result.siteDir, result.runId, home.slug), "read.txt");
  try {
    return extractBody(await readFile(file, "utf8")).slice(0, EXCERPT_LINES);
  } catch {
    return null;
  }
}
