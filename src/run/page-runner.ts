import type { PageInfo } from "../drivers/types.js";
import type {
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
import { runPass, type PassResult, type PassSettings } from "../passes/index.js";
import { InterruptedError, StepTimeoutError, withTimeout } from "../passes/steps.js";
import { isHtmlContentType, sameOrigin } from "../pages/url.js";
import { writeTranscript } from "../transcripts/write.js";
import { errorMessage } from "../util/errors.js";
import { isoLocal } from "../util/time.js";
import { voicecapVersion } from "../util/version.js";
import { keepEarlierAttempt } from "./attempts.js";
import type { DriverSession } from "./driver-session.js";
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
  skip?: SkippedRecord;
}

interface Attempt {
  kind: "done" | "failed" | "skipped" | "retry";
  /** For failures and retries: whether the site or the environment failed. */
  failure?: FailureKind;
  /** For retries: whether the screen reader and browser need restarting first. */
  restart?: boolean;
  error?: string;
  passes: Partial<Record<PassName, PassSummary>>;
  results: Partial<Record<PassName, PassResult>>;
  files: Record<string, FileHash>;
  finalUrl?: string;
  httpStatus?: number | null;
  skip?: SkippedRecord;
}

const MAX_ATTEMPTS = 2;

/**
 * Transcribe one page: every pass, each on a fresh load. On a timeout (a step, or the whole
 * page), restart the screen reader and browser and retry the page once; an HTTP 5xx is retried
 * once too. Any other failure is recorded and the run moves on. Ctrl+C propagates as
 * InterruptedError and leaves the page pending.
 */
export async function processPage(ctx: PageContext): Promise<PageOutcome> {
  const clock = ctx.clock ?? (() => performance.now());
  const started = clock();
  const errors: string[] = [];
  for (let attempt = 1; ; attempt++) {
    const result = await runAttempt(ctx);
    if (result.kind === "retry" && attempt < MAX_ATTEMPTS) {
      errors.push(`Attempt ${attempt} failed (${result.error ?? "unknown error"}); retrying.`);
      if (result.restart) await ctx.session.restart(`retrying ${ctx.page.url}`, ctx.signal);
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
      ...(result.finalUrl !== undefined ? { finalUrl: result.finalUrl } : {}),
      ...(result.httpStatus !== undefined ? { httpStatus: result.httpStatus } : {}),
      ...(result.skip ? { skip: result.skip } : {}),
    };
  }
}

async function runAttempt(ctx: PageContext): Promise<Attempt> {
  const { page, session } = ctx;
  const dir = pageDir(ctx.outDir, ctx.run.id, page.slug);
  // A retry (or a resumed page) starts from an empty folder; any earlier attempt is moved into
  // attempts/<slug>/ rather than deleted.
  await keepEarlierAttempt(ctx.outDir, ctx.run.id, page.slug);

  const pageTimeout = new AbortController();
  const signal = AbortSignal.any([ctx.signal, pageTimeout.signal]);
  const timer = setTimeout(
    () => pageTimeout.abort(new StepTimeoutError("The whole page", ctx.pageTimeoutMs)),
    ctx.pageTimeoutMs,
  );
  const attempt: Attempt = { kind: "done", passes: {}, results: {}, files: {} };
  try {
    for (const [index, pass] of ctx.passes.entries()) {
      let info: PageInfo;
      try {
        info = await withTimeout(
          `Opening the page`,
          () => session.driver.openPage(page.url),
          ctx.openTimeoutMs,
          signal,
        );
      } catch (error) {
        if (error instanceof InterruptedError) throw error;
        const retry = error instanceof StepTimeoutError;
        return {
          ...attempt,
          kind: retry ? "retry" : "failed",
          restart: retry,
          error: `Could not open the page for the ${pass} pass: ${errorMessage(error)}`,
        };
      }

      const warnings: string[] = [];
      if (index === 0) {
        attempt.finalUrl = info.finalUrl;
        attempt.httpStatus = info.status;
        const skip = skipFor(ctx, info);
        if (skip) return { ...attempt, kind: "skipped", skip };
        if (info.status !== null && info.status >= 500) {
          return {
            ...attempt,
            kind: "retry",
            restart: false,
            failure: "page",
            error: `HTTP ${info.status}`,
          };
        }
        if (info.status !== null && info.status >= 400) {
          return { ...attempt, kind: "failed", failure: "page", error: `HTTP ${info.status}` };
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
      if (result.stopReason === "timeout") {
        return {
          ...attempt,
          kind: "retry",
          restart: true,
          error: `${pass} pass: ${result.errors[0] ?? "timeout"}`,
        };
      }
      if (result.stopReason === "error") {
        return {
          ...attempt,
          kind: "failed",
          error: `${pass} pass: ${result.errors[0] ?? "error"}`,
        };
      }
    }
    return attempt;
  } finally {
    clearTimeout(timer);
  }
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
