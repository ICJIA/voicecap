import os from "node:os";

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
import { redactHome } from "./failure.js";
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
  now: () => Date;
  clock?: () => number;
}

export interface PageOutcome {
  status: "done" | "failed" | "skipped";
  /** For failed pages: an HTTP error ("page") or a timeout or driver error ("environment"). */
  failure?: FailureKind;
  attempts: number;
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
  /** Every attempt that failed, oldest first, including the last one of a page that failed. */
  failedAttempts: AttemptRecord[];
  skip?: SkippedRecord;
}

/** A failed attempt's record before it has a number, and says whether the session restarted. */
type FailedAttempt = Omit<AttemptRecord, "n" | "restarted">;

/** What went wrong in a failed attempt, and where: its record without its times. */
type Problem = Omit<FailedAttempt, "startedAt" | "endedAt">;

interface Attempt {
  kind: "done" | "failed" | "skipped" | "retry";
  /** For failures and retries: whether the site or the environment failed. */
  failure?: FailureKind;
  /** For retries: whether the screen reader and browser need restarting first. */
  restart?: boolean;
  error?: string;
  /** For failures and retries: what to keep of the attempt in the page's record. */
  record?: FailedAttempt;
  passes: Partial<Record<PassName, PassSummary>>;
  results: Partial<Record<PassName, PassResult>>;
  files: Record<string, FileHash>;
  finalUrl?: string;
  httpStatus?: number | null;
  /** From the attempt's first load, like finalUrl and httpStatus. */
  title?: string | null;
  skip?: SkippedRecord;
}

/**
 * Transcribe one page: every pass, each on a fresh load. A page that fails is tried again, up to
 * ctx.maxAttempts times in all: after a timeout, a driver error (such as the browser losing the
 * foreground), or a page that couldn't be opened, the screen reader and browser restart first; an
 * HTTP 5xx is tried again as it is. A page the site answered with an HTTP 4xx isn't: trying again
 * can't help. Each earlier attempt is kept (keepEarlierAttempt), and the outcome's errors name
 * every attempt that failed. So do its failedAttempts, which say why each one failed, and whether
 * the screen reader and browser were restarted before the next. Ctrl+C propagates as
 * InterruptedError and leaves the page pending.
 */
export async function processPage(ctx: PageContext): Promise<PageOutcome> {
  const clock = ctx.clock ?? (() => performance.now());
  const started = clock();
  const errors: string[] = [];
  const failedAttempts: AttemptRecord[] = [];
  for (let attempt = 1; ; attempt++) {
    const result = await runAttempt(ctx);
    const retrying = result.kind === "retry" && attempt < ctx.maxAttempts;
    // A restart gets the next attempt ready, so the last attempt, whatever its failure, has none.
    const restarting = retrying && result.restart === true;
    if (result.record) failedAttempts.push({ n: attempt, ...result.record, restarted: restarting });
    if (retrying) {
      errors.push(`Attempt ${attempt} failed (${result.error ?? "unknown error"}); retrying.`);
      if (restarting) {
        await ctx.session.restart(
          `retrying ${ctx.page.url}: attempt ${attempt + 1} of ${ctx.maxAttempts}`,
          ctx.signal,
        );
      }
      continue;
    }
    if (result.error) errors.push(result.error);
    return {
      status: result.kind === "retry" ? "failed" : result.kind,
      ...(result.kind === "retry" || result.kind === "failed"
        ? { failure: result.failure ?? "environment" }
        : {}),
      attempts: attempt,
      durationMs: Math.round(clock() - started),
      passes: result.passes,
      results: result.results,
      files: result.files,
      errors,
      failedAttempts,
      ...(result.finalUrl !== undefined ? { finalUrl: result.finalUrl } : {}),
      ...(result.httpStatus !== undefined ? { httpStatus: result.httpStatus } : {}),
      ...(result.title !== undefined ? { title: result.title } : {}),
      ...(result.skip ? { skip: result.skip } : {}),
    };
  }
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
  const attempt: Attempt = { kind: "done", passes: {}, results: {}, files: {} };
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
          ...attempt,
          kind: "retry",
          restart: true,
          error: `Could not open the page for the ${pass} pass: ${errorMessage(error)}`,
          ...failedWith(problemOf(pass, failureOf(error), "openPage")),
        };
      }

      const warnings: string[] = [];
      if (index === 0) {
        attempt.finalUrl = info.finalUrl;
        attempt.httpStatus = info.status;
        attempt.title = info.title;
        const skip = skipFor(ctx, info);
        if (skip) return { ...attempt, kind: "skipped", skip };
        if (info.status !== null && info.status >= 500) {
          return {
            ...attempt,
            kind: "retry",
            restart: false,
            failure: "page",
            error: `HTTP ${info.status}`,
            ...failedWith(httpProblem(pass, info.status)),
          };
        }
        if (info.status !== null && info.status >= 400) {
          return {
            ...attempt,
            kind: "failed",
            failure: "page",
            error: `HTTP ${info.status}`,
            ...failedWith(httpProblem(pass, info.status)),
          };
        }
      } else if (info.finalUrl !== attempt.finalUrl) {
        warnings.push(
          `This load ended at ${info.finalUrl}; the page's first load ended at ${attempt.finalUrl ?? "?"}.`,
        );
      }

      const result = await runPass(pass, session.driver, ctx.passSettings(pass), signal, ctx.clock);
      result.warnings.unshift(...warnings);
      const written = await writeTranscript(dir, transcriptFor(ctx, pass, info, result));
      Object.assign(attempt.files, written.files);
      attempt.results[pass] = result;
      attempt.passes[pass] = {
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
          ...attempt,
          kind: "retry",
          restart: true,
          error: `${pass} pass: ${result.errors[0] ?? result.stopReason}`,
          ...failedWith(problemOf(pass, result.failure)),
        };
      }
    }
    return attempt;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What the record of a failed pass, or of a page that couldn't be opened for it (command
 * "openPage"), says went wrong. An unexpected error's stack is kept with the home folder replaced,
 * so the record doesn't name the account that ran voicecap.
 */
function problemOf(
  pass: PassName,
  failure: PassFailure,
  command: Problem["command"] = failure.command,
): Problem {
  return {
    pass,
    step: failure.step,
    command,
    cause: failure.cause,
    message: failure.message,
    ...(failure.stack !== undefined
      ? { stack: redactHome(failure.stack, os.homedir(), process.platform) }
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
