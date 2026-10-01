import type { PageInfo } from "../drivers/types.js";
import type {
  AttemptRecord,
  EnvironmentRecord,
  FailureKind,
  FileHash,
  PageRecord,
  PassName,
  PassSummary,
  RunJson,
  SkippedRecord,
  TranscriptJson,
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
import { writeTranscript } from "../transcripts/write.js";
import { errorMessage } from "../util/errors.js";
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
 */
export async function processPage(ctx: PageContext): Promise<PageOutcome> {
  const clock = ctx.clock ?? (() => performance.now());
  const started = clock();
  const errors: string[] = [];
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
    ...(result.kind === "skipped" ? { skip: result.skip } : {}),
  });
  for (let attempt = 1; ; attempt++) {
    const result = await runAttempt(ctx);
    // The attempt has ended, so it counts: one that Ctrl+C stopped threw instead.
    ctx.page.attempts++;
    if (result.kind === "done" || result.kind === "skipped") return outcome(result, result.kind);

    const kept = await keepFailedAttempt(ctx, result.record);
    if (result.kind === "failed" || attempt >= ctx.maxAttempts) {
      errors.push(result.error);
      return outcome(result, "failed", result.failure);
    }
    errors.push(`Attempt ${attempt} failed (${result.error}); retrying.`);
    if (result.restart) {
      await ctx.session.restart(
        `retrying ${ctx.page.url}: attempt ${attempt + 1} of ${ctx.maxAttempts}`,
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
  try {
    for (const [index, pass] of ctx.passes.entries()) {
      let info: PageInfo;
      try {
        info = await withTimeout(
          `Opening the page`,
          () => session.driver.openPage(page.url),
          ctx.openTimeoutMs,
          signal,
          "open-timeout",
        );
      } catch (error) {
        if (error instanceof InterruptedError) throw error;
        return {
          ...loaded,
          kind: "retry",
          failure: "environment",
          restart: true,
          error: `Could not open the page for the ${pass} pass: ${errorMessage(error)}`,
          ...failedWith(problemOf(pass, failureOf(error), "openPage")),
        };
      }

      const warnings: string[] = [];
      if (index === 0) {
        loaded.finalUrl = info.finalUrl;
        loaded.httpStatus = info.status;
        loaded.title = info.title;
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
      } else if (info.finalUrl !== loaded.finalUrl) {
        warnings.push(
          `This load ended at ${info.finalUrl}; the page's first load ended at ${loaded.finalUrl ?? "?"}.`,
        );
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
 * What the record of a failed pass, or of a page that couldn't be opened for it (command
 * "openPage"), says went wrong. An unexpected error's stack is kept with the home folder replaced,
 * so the record doesn't name the account that ran voicecap. Its message is kept word for word: the
 * report replaces the home folder where it shows one.
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
