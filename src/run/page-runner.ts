import path from "node:path";

import type { AxeCapture, EventRecorder, PageInfo, PageScreenshot } from "../drivers/types.js";
import {
  AXE_FILE,
  SCREENSHOT_FILE,
  type AttemptRecord,
  type AxeRecord,
  type EnvironmentRecord,
  type FailureKind,
  type FileHash,
  type PageRecord,
  type PassName,
  type PassSummary,
  type RunJson,
  type ScreenshotRecord,
  type SkippedRecord,
  type TranscriptJson,
} from "../model.js";
import {
  failureOf,
  runPass,
  type PassFailure,
  type PassResult,
  type PassSettings,
} from "../passes/index.js";
import { InterruptedError, StepTimeoutError, withTimeout } from "../passes/steps.js";
import { isHtmlContentType, sameOrigin } from "../pages/url.js";
import { fileHash, writeTranscript } from "../transcripts/write.js";
import { writeFileAtomic } from "../util/atomic-write.js";
import { errorMessage } from "../util/errors.js";
import { jpegSize } from "../util/jpeg.js";
import { isoLocal, isoLocalMs } from "../util/time.js";
import { voicecapVersion } from "../util/version.js";
import { keepEarlierAttempt } from "./attempts.js";
import type { DriverSession } from "./driver-session.js";
import { homeFolder, redactHome } from "./failure.js";
import { pageDir } from "./paths.js";

export interface PageContext {
  session: DriverSession;
  run: RunJson;
  page: PageRecord;
  outDir: string;
  site: URL;
  passes: readonly PassName[];
  passSettings: (pass: PassName) => PassSettings;
  /** Timeout for loading a page and moving into its content. */
  openTimeoutMs: number;
  pageTimeoutMs: number;
  /** How many times the page is tried before it's recorded as failed (pageAttempts). */
  maxAttempts: number;
  environment: EnvironmentRecord;
  /** The run's abort signal (Ctrl+C). */
  signal: AbortSignal;
  /** Writes the run's record (run.json) as it stands: a failed attempt is kept as it happens. */
  save: () => Promise<void>;
  /**
   * The run's event log: each attempt's start is recorded as it begins, and its end as it ends,
   * numbered as the page's record numbers its attempts.
   */
  events: EventRecorder;
  now: () => Date;
  clock?: () => number;
}

/**
 * How a page's processing ended. What became of each attempt is in the page's record already:
 * processPage counts them there (attempts) and keeps the failed ones (failedAttempts).
 */
export interface PageOutcome {
  status: "done" | "failed" | "skipped";
  /** For failed pages: an HTTP error ("page") or a timeout or driver error ("environment"). */
  failure?: FailureKind;
  durationMs: number;
  passes: Partial<Record<PassName, PassSummary>>;
  results: Partial<Record<PassName, PassResult>>;
  files: Record<string, FileHash>;
  errors: string[];
  finalUrl?: string;
  httpStatus?: number | null;
  /**
   * The title the browser reported on the page's first load in its last attempt, null when it had
   * none. Left out when that attempt never got the page to load.
   */
  title?: string | null;
  /**
   * The address the page's canonical tag gave on the first load of its last attempt, null when it
   * gave none. Left out unless the page was read (status "done"): a page that failed or was skipped
   * may be an error page or another site's, so its tag says nothing about this site.
   */
  canonical?: string | null;
  /**
   * The screenshot the last attempt kept in the page's folder, or why it has none: taken as the page
   * first loaded, like its title. Left out when the driver took none, and for a page the attempt
   * didn't read (it was skipped, or the site answered with an HTTP error).
   */
  screenshot?: ScreenshotRecord;
  /**
   * The axe-core results the last attempt kept in the page's folder, or why it has none: checked as
   * the page first loaded, like its screenshot. Left out when the driver can't check a page, and for
   * a page the attempt didn't read (it was skipped, or the site answered with an HTTP error).
   */
  axe?: AxeRecord;
  skip?: SkippedRecord;
}

/** A failed attempt's record before it has a number, and says whether the session restarted. */
type FailedAttempt = Omit<AttemptRecord, "n" | "restarted">;

/** What went wrong in a failed attempt, and where: its record without its times. */
type Problem = Omit<FailedAttempt, "startedAt" | "endedAt">;

/** What an attempt loaded and wrote, however it ended. */
interface Loaded {
  passes: Partial<Record<PassName, PassSummary>>;
  results: Partial<Record<PassName, PassResult>>;
  files: Record<string, FileHash>;
  finalUrl?: string;
  httpStatus?: number | null;
  /** From the attempt's first load, like finalUrl and httpStatus. */
  title?: string | null;
  /** From the attempt's first load too: the address of the page's canonical tag. */
  canonical?: string | null;
  /** From the attempt's first load too, once the page is to be read: its screenshot, if any. */
  screenshot?: ScreenshotRecord;
  /** And the check of the page with axe, if the driver makes one. */
  axe?: AxeRecord;
}

/** Why an attempt failed, and what the page's record keeps of it. */
interface Failed {
  /** Whether the site or the environment failed. */
  failure: FailureKind;
  error: string;
  record: FailedAttempt;
}

/**
 * How an attempt ended. One that failed always says why, in the record the page keeps of it:
 * "failed" when trying again can't help (an HTTP 4xx), "retry" when it may.
 */
type Attempt = Loaded &
  (
    | { kind: "done" }
    | { kind: "skipped"; skip: SkippedRecord }
    | (Failed & { kind: "failed" })
    | (Failed & {
        kind: "retry";
        /** Whether the screen reader and browser restart before the page is tried again. */
        restart: boolean;
      })
  );

/**
 * Transcribe one page: every pass, each on a fresh load. A page that fails is tried again, up to
 * ctx.maxAttempts times in all: after a timeout, a driver error (such as the browser losing the
 * foreground), or a page that couldn't be opened, the screen reader and browser restart first; an
 * HTTP 5xx is tried again as it is. A page the site answered with an HTTP 4xx isn't: trying again
 * can't help. Each earlier attempt's files are kept (keepEarlierAttempt), and the outcome's errors
 * name every attempt that failed.
 *
 * The page's record counts each attempt as it ends (attempts), whether it was done, failed, or
 * skipped, across every session. Each attempt that fails is added to the record's failedAttempts,
 * numbered as the page's attempt it was, with why it failed, and written to run.json at once,
 * before any restart: so Ctrl+C, a closed window, a crash, or a restart that fails can't lose it.
 * Whether the screen reader and browser were restarted for the next attempt is added once that
 * restart has finished. Ctrl+C propagates as InterruptedError and leaves the page pending; the
 * attempt it stopped isn't counted.
 *
 * Each attempt is in the run's event log too, numbered as the page's record numbers it: its start,
 * and its end, which is the page read or skipped, or the attempt failed. A failed attempt is
 * recorded before it's kept, and before any restart for the next.
 */
export async function processPage(ctx: PageContext): Promise<PageOutcome> {
  const clock = ctx.clock ?? (() => performance.now());
  const started = clock();
  const errors: string[] = [];
  // The attempts the page had before this call: an earlier session's, in a run that was resumed.
  const earlier = ctx.page.attempts;
  const outcome = (
    result: Attempt,
    status: PageOutcome["status"],
    failure?: FailureKind,
  ): PageOutcome => ({
    status,
    ...(failure ? { failure } : {}),
    durationMs: Math.round(clock() - started),
    passes: result.passes,
    results: result.results,
    files: result.files,
    errors,
    ...(result.finalUrl !== undefined ? { finalUrl: result.finalUrl } : {}),
    ...(result.httpStatus !== undefined ? { httpStatus: result.httpStatus } : {}),
    ...(result.title !== undefined ? { title: result.title } : {}),
    ...(status === "done" && result.canonical !== undefined ? { canonical: result.canonical } : {}),
    ...(result.screenshot !== undefined ? { screenshot: result.screenshot } : {}),
    ...(result.axe !== undefined ? { axe: result.axe } : {}),
    ...(result.kind === "skipped" ? { skip: result.skip } : {}),
  });
  for (let attempt = 1; ; attempt++) {
    const result = await runAttempt(ctx);
    // The attempt has ended, so it counts: one that Ctrl+C stopped threw instead.
    ctx.page.attempts++;
    // This attempt's number in the page's record, which is its number in the event log.
    const n = ctx.page.attempts;
    const page = ctx.page.url;
    if (result.kind === "done" || result.kind === "skipped") {
      ctx.events.record({ type: "page-finished", page, attempt: n, status: result.kind });
      return outcome(result, result.kind);
    }
    const { cause, message } = result.record;
    ctx.events.record({ type: "page-failed", page, attempt: n, cause, message });

    const kept = await keepFailedAttempt(ctx, result.record);
    if (result.kind === "failed" || attempt >= ctx.maxAttempts) {
      errors.push(result.error);
      return outcome(result, "failed", result.failure);
    }
    errors.push(`Attempt ${attempt} failed (${result.error}); retrying.`);
    if (result.restart) {
      // The next attempt, and the last this call can make, numbered as the page's record numbers.
      await ctx.session.restart(
        { kind: "retry", page, attempt: n + 1, of: earlier + ctx.maxAttempts },
        ctx.signal,
      );
      // Only now that it has finished: a restart that throws leaves the attempt saying it had none.
      kept.restarted = true;
      await ctx.save();
    }
  }
}

/**
 * Keep a failed attempt in the page's record, numbered as the page's attempt it was: the page's
 * attempts so far, counted across every session (0.5.0's included). The record is written at once.
 * Until a restart for the next attempt has finished, the attempt says it had none.
 */
async function keepFailedAttempt(ctx: PageContext, failed: FailedAttempt): Promise<AttemptRecord> {
  const record: AttemptRecord = { n: ctx.page.attempts, ...failed, restarted: false };
  (ctx.page.failedAttempts ??= []).push(record);
  await ctx.save();
  return record;
}

async function runAttempt(ctx: PageContext): Promise<Attempt> {
  const startedAt = isoLocalMs(ctx.now());
  const { page, session } = ctx;
  // The page's record counts an attempt once it has ended, so the one starting is the next number.
  ctx.events.record({ type: "page-started", page: page.url, attempt: page.attempts + 1 });
  const dir = pageDir(ctx.outDir, ctx.run.id, page.slug);
  // A retry (or a resumed page) starts from an empty folder; any earlier attempt is moved into
  // attempts/<slug>/ rather than deleted.
  await keepEarlierAttempt(ctx.outDir, ctx.run.id, page.slug);

  const pageTimeout = new AbortController();
  const signal = AbortSignal.any([ctx.signal, pageTimeout.signal]);
  const timer = setTimeout(
    () =>
      pageTimeout.abort(new StepTimeoutError("The whole page", ctx.pageTimeoutMs, "page-timeout")),
    ctx.pageTimeoutMs,
  );
  const loaded: Loaded = { passes: {}, results: {}, files: {} };
  // What an attempt that fails ends with: its record, which ends now.
  const failedWith = (problem: Problem): { record: FailedAttempt } => ({
    record: { startedAt, endedAt: isoLocalMs(ctx.now()), ...problem },
  });
  // Have the driver open the page for a pass, within the time a page has to open.
  const open = (): Promise<PageInfo> =>
    withTimeout(
      `Opening the page`,
      () => session.driver.openPage(page.url),
      ctx.openTimeoutMs,
      signal,
      "open-timeout",
    );
  // How an attempt ends when the page wouldn't open for `pass`: it's tried again after a restart.
  // Ctrl+C isn't that: it leaves the page pending.
  const notOpened = (pass: PassName, error: unknown): Attempt => {
    if (error instanceof InterruptedError) throw error;
    return {
      ...loaded,
      kind: "retry",
      failure: "environment",
      restart: true,
      error: `Could not open the page for the ${pass} pass: ${errorMessage(error)}`,
      ...failedWith(problemOf(pass, failureOf(error), "openPage")),
    };
  };
  // A load after the page's first that ended somewhere else is read all the same, with a warning.
  const elsewhere = (info: PageInfo): string[] =>
    info.finalUrl === loaded.finalUrl
      ? []
      : [
          `This load ended at ${info.finalUrl}; the page's first load ended at ${loaded.finalUrl ?? "?"}.`,
        ];
  try {
    for (const [index, pass] of ctx.passes.entries()) {
      let info: PageInfo;
      try {
        info = await open();
      } catch (error) {
        return notOpened(pass, error);
      }

      const warnings: string[] = [];
      if (index === 0) {
        loaded.finalUrl = info.finalUrl;
        loaded.httpStatus = info.status;
        loaded.title = info.title;
        loaded.canonical = info.canonical;
        const skip = skipFor(ctx, info);
        if (skip) return { ...loaded, kind: "skipped", skip };
        if (info.status !== null && info.status >= 500) {
          return {
            ...loaded,
            kind: "retry",
            failure: "page",
            restart: false,
            error: `HTTP ${info.status}`,
            ...failedWith(httpProblem(pass, info.status)),
          };
        }
        if (info.status !== null && info.status >= 400) {
          return {
            ...loaded,
            kind: "failed",
            failure: "page",
            error: `HTTP ${info.status}`,
            ...failedWith(httpProblem(pass, info.status)),
          };
        }
        // The page will be read: keep the picture the driver took of it as it loaded. The loads for
        // the passes after this one are of the same page, and their pictures aren't kept.
        const screenshot = await keepScreenshot(ctx, dir, info.screenshot);
        if (screenshot) loaded.screenshot = screenshot;
        // And have the driver check it with axe, if it can: once a page, on this load, before the
        // first key of the first pass, whichever pass that is. The driver has put the screen reader
        // at the top already, and the check moves nothing in the page.
        let checked: AxeCapture | undefined;
        try {
          checked = await checkWithAxe(ctx, signal);
        } catch (error) {
          // Only a browser that's gone: a check that fails or runs out of time is the answer.
          if (error instanceof InterruptedError) throw error;
          return {
            ...loaded,
            kind: "retry",
            failure: "environment",
            restart: true,
            error: `Could not check the page with axe for the ${pass} pass: ${errorMessage(error)}`,
            // The page was still being opened for the pass: no step of it had begun.
            ...failedWith(problemOf(pass, failureOf(error), "openPage")),
          };
        }
        const axe = await keepAxe(ctx, dir, checked);
        if (axe) loaded.axe = axe;
        // A check that ran out of time is still under way in the page, where it would hold up the
        // pass's keys: open the page again, as for the passes after this one. The driver's next load
        // ends the check (the Guidepup driver's fresh browser closes the one it's in). This load is
        // the one the pass reads, and the page's record keeps the check's reason.
        if (checked !== undefined && "error" in checked && checked.leftRunning === true) {
          try {
            info = await open();
          } catch (error) {
            return notOpened(pass, error);
          }
          warnings.push(...elsewhere(info));
        }
      } else {
        warnings.push(...elsewhere(info));
      }

      const result = await runPass(pass, session.driver, ctx.passSettings(pass), signal, ctx.clock);
      result.warnings.unshift(...warnings);
      const written = await writeTranscript(dir, transcriptFor(ctx, pass, info, result));
      Object.assign(loaded.files, written.files);
      loaded.results[pass] = result;
      loaded.passes[pass] = {
        steps: result.steps.length,
        stopReason: result.stopReason,
        durationMs: result.durationMs,
        contentSha256: written.contentSha256,
        errors: result.errors,
        warnings: result.warnings,
      };
      // A pass that stopped with "timeout" or "error" has said why, in its failure.
      if (result.failure) {
        return {
          ...loaded,
          kind: "retry",
          failure: "environment",
          restart: true,
          error: `${pass} pass: ${result.errors[0] ?? result.stopReason}`,
          ...failedWith(problemOf(pass, result.failure)),
        };
      }
    }
    return { ...loaded, kind: "done" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Keep the screenshot a driver took of a page: the JPEG in the page's folder, and its record, with
 * the picture's size and when. A picture the driver couldn't take, and bytes that aren't a JPEG
 * voicecap can read, are recorded as the reason, with no file. Null when the driver took none.
 */
async function keepScreenshot(
  ctx: PageContext,
  dir: string,
  screenshot: PageScreenshot | undefined,
): Promise<ScreenshotRecord | null> {
  if (screenshot === undefined) return null;
  const takenAt = isoLocalMs(ctx.now());
  if ("error" in screenshot) return { error: screenshot.error, takenAt };
  const size = jpegSize(screenshot.jpeg);
  if (size === null) return { error: "the picture wasn't a JPEG voicecap could read", takenAt };
  await writeFileAtomic(path.join(dir, SCREENSHOT_FILE), screenshot.jpeg);
  return { ...fileHash(screenshot.jpeg), takenAt, ...size };
}

/**
 * Have the driver check the page it has open with axe, when it can; undefined when it can't. Raced
 * against Ctrl+C and the whole page's time, as every call to a driver is. The driver bounds the
 * check itself, and a check that fails or runs out of time is its answer, not an error, so a call
 * that throws is a browser that's gone.
 */
function checkWithAxe(ctx: PageContext, signal: AbortSignal): Promise<AxeCapture | undefined> {
  const { driver } = ctx.session;
  const check = driver.checkWithAxe?.bind(driver);
  if (check === undefined) return Promise.resolve(undefined);
  return withTimeout(
    "Checking the page with axe",
    check,
    ctx.pageTimeoutMs,
    signal,
    "page-timeout",
  );
}

/**
 * Keep the results a driver gave of checking a page with axe: the file in the page's folder
 * (axe.json), and its record, with when. A check the driver couldn't make is recorded as the
 * reason, with no file. Null when the driver can't check a page.
 */
async function keepAxe(
  ctx: PageContext,
  dir: string,
  axe: AxeCapture | undefined,
): Promise<AxeRecord | null> {
  if (axe === undefined) return null;
  const ranAt = isoLocalMs(ctx.now());
  if ("error" in axe) return { error: axe.error, ranAt };
  await writeFileAtomic(path.join(dir, AXE_FILE), axe.json);
  // Field by field: the record has the shape AxeRecord gives it, and no object of the driver's.
  const { axeVersion, counts, impacts } = axe.summary;
  return {
    ...fileHash(axe.json),
    ranAt,
    axeVersion,
    counts: { ...counts },
    impacts: { ...impacts },
  };
}

/**
 * What the record of a failed pass, or of a page that couldn't be opened for it (command
 * "openPage"), says went wrong. A browser that's gone during the page's check with axe is recorded
 * the same way, as a failure with no step (see AttemptRecord.command): the shareable page words it
 * "…while opening the page for the read pass", and only the page's errors name axe. The program
 * that took the foreground is kept when the driver named one (or said it couldn't). An unexpected
 * error's stack is kept with the home folder replaced, so the record doesn't name the account that
 * ran voicecap. Its message is kept word for word: the report replaces the home folder where it
 * shows one.
 */
function problemOf(
  pass: PassName,
  failure: PassFailure,
  command: Problem["command"] = failure.command,
): Problem {
  const home = homeFolder();
  return {
    pass,
    step: failure.step,
    command,
    cause: failure.cause,
    message: failure.message,
    ...(failure.program !== undefined ? { program: failure.program } : {}),
    ...(failure.stack !== undefined
      ? {
          stack: home === null ? failure.stack : redactHome(failure.stack, home, process.platform),
        }
      : {}),
  };
}

/** The site answered with an HTTP error, so no step of the pass was under way. */
function httpProblem(pass: PassName, status: number): Problem {
  return { pass, step: null, command: null, cause: "http", message: `HTTP ${status}` };
}

/** A page is skipped when its response isn't HTML or it redirected to another origin. */
function skipFor(ctx: PageContext, info: PageInfo): SkippedRecord | null {
  const base = { url: ctx.page.url, finalUrl: info.finalUrl, status: info.status };
  if (!isHtmlContentType(info.contentType)) {
    return { ...base, reason: "non-html-response", contentType: info.contentType };
  }
  let final: URL;
  try {
    final = new URL(info.finalUrl);
  } catch {
    return null;
  }
  return sameOrigin(final, ctx.site) ? null : { ...base, reason: "redirect-off-origin" };
}

function transcriptFor(
  ctx: PageContext,
  pass: PassName,
  info: PageInfo,
  result: PassResult,
): TranscriptJson {
  const { page } = ctx;
  return {
    schemaVersion: 1,
    voicecap: voicecapVersion(),
    replayed: ctx.environment.replay !== undefined,
    run: ctx.run.id,
    pass,
    page: {
      url: page.url,
      key: page.key,
      slug: page.slug,
      ...(page.label !== undefined ? { label: page.label } : {}),
      ...(page.template !== undefined ? { template: page.template } : {}),
      ...(page.notes !== undefined ? { notes: page.notes } : {}),
      finalUrl: info.finalUrl,
    },
    capturedAt: isoLocal(ctx.now()),
    durationMs: result.durationMs,
    stepCount: result.steps.length,
    stopReason: result.stopReason,
    warnings: result.warnings,
    errors: result.errors,
    ...(pass === "tab" ? { initialFocus: result.initialFocus ?? null } : {}),
    environment: ctx.environment,
    steps: result.steps,
  };
}
