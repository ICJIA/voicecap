import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadConfig, type LoadedConfig } from "../config/load.js";
import type { VoicecapConfig } from "../config/schema.js";
import { createDriver, selectDriver } from "../drivers/index.js";
import type { ScreenReaderDriver } from "../drivers/types.js";
import { evaluateFlags, flagRulesSha256 } from "../flags/evaluate.js";
import {
  PASS_NAMES,
  type EnvironmentRecord,
  type PageRecord,
  type PassName,
  type RunJson,
  type RunSettings,
  type SessionRecord,
} from "../model.js";
import { compilePattern } from "../pages/filter.js";
import { pageSourceFor, resolvePages } from "../pages/resolve.js";
import { displayPath, parseSiteUrl } from "../pages/url.js";
import type { PassSettings } from "../passes/index.js";
import { InterruptedError, throwIfAborted } from "../passes/steps.js";
import { generateReport, resolveCompareBase } from "../report/index.js";
import { EnvironmentError, ExitCode, UsageError } from "../util/errors.js";
import { createConsoleLogger, type Logger } from "../util/log.js";
import { isoLocal } from "../util/time.js";
import { voicecapVersion } from "../util/version.js";
import { DriverSession } from "./driver-session.js";
import { withCurrentFlags } from "./flags.js";
import { acquireRunLock } from "./lock.js";
import { processPage, type PageOutcome } from "./page-runner.js";
import { DEFAULT_OUT_DIR, liveCompareDir, runCompareDir, runDir } from "./paths.js";
import { estimateRemaining, progressLine, type PassProgress } from "./progress.js";
import { chooseRun, settingsHash } from "./resume.js";
import { allocateRunId, sanitizeRunName } from "./run-id.js";
import { listRuns, writeLatestRunId, writeRunJson } from "./store.js";

export interface RunAuditOptions {
  /** The site's URL; pages must be on its origin. */
  site: string;
  /** Exactly one page source: a sitemap URL or a page list file (.csv or .json). */
  sitemap?: string | null;
  pages?: string | null;
  limit?: number | null;
  include?: string[];
  exclude?: string[];
  /** Defaults to the config's passes. */
  passes?: PassName[] | null;
  /** Overrides every pass's step cap. */
  maxSteps?: number | null;
  /** A run id, or "previous". */
  compare?: string | null;
  /** Always start a new run instead of resuming. */
  fresh?: boolean;
  /** Output folder. Default "transcripts". */
  out?: string;
  runName?: string | null;
  /** Replay a run folder instead of running NVDA. */
  replayFrom?: string | null;
  cwd?: string;
  /** Default: voicecap.config.* in cwd. */
  config?: LoadedConfig;
  logger?: Logger;
  /** Abort to interrupt the run (Ctrl+C): state is saved and the run can be resumed. */
  signal?: AbortSignal;
  fetch?: typeof fetch;
  now?: () => Date;
  /** Milliseconds clock for step timings. */
  clock?: () => number;
  /** Use this driver instead of the one the config selects (tests, custom drivers). */
  driver?: ScreenReaderDriver;
}

export interface RunAuditResult {
  runId: string;
  outcome: "completed" | "interrupted" | "stopped";
  /** 0 completed, 3 completed with failed pages, 2 stopped (environment), 130 interrupted. */
  exitCode: number;
  run: RunJson;
  failedPages: number;
}

/** Run (or resume) an audit: every page through the selected passes, then the reports. */
export async function runAudit(options: RunAuditOptions): Promise<RunAuditResult> {
  const cwd = options.cwd ?? process.cwd();
  const logger = options.logger ?? createConsoleLogger();
  const now = options.now ?? (() => new Date());
  const signal = options.signal ?? new AbortController().signal;

  if (Boolean(options.sitemap) === Boolean(options.pages)) {
    throw new UsageError(
      "Give exactly one page source: --sitemap <url> or --pages <file> (not both, not neither).",
    );
  }
  const site = parseSiteUrl(options.site);
  const loaded = options.config ?? (await loadConfig({ cwd }));
  const { config } = loaded;
  const passes = checkPasses(options.passes ?? config.passes);
  const limit = checkCount("--limit", options.limit);
  const maxSteps = checkCount("--max-steps", options.maxSteps);
  const include = options.include ?? [];
  const exclude = options.exclude ?? [];
  for (const pattern of [...include, ...exclude]) compilePattern(pattern);
  const runName = options.runName ? sanitizeRunName(options.runName) : null;

  const selection = selectDriver(config, options.replayFrom, cwd);
  if (selection.replayFrom && !existsSync(selection.replayFrom)) {
    throw new UsageError(`The replay folder ${selection.replayLabel ?? ""} doesn't exist.`);
  }
  const pageSource = await pageSourceFor({
    sitemap: options.sitemap ?? undefined,
    pagesFile: options.pages ?? undefined,
    cwd,
  });
  const settings: RunSettings = {
    site: site.origin,
    source: pageSource,
    passes,
    include,
    exclude,
    limit,
    driver: selection.name,
    replayFrom: selection.replayLabel,
    capture: config.capture,
    stepCaps: maxSteps
      ? { read: maxSteps, headings: maxSteps, tab: maxSteps }
      : { ...config.stepCaps },
    nvdaSettings: config.nvdaSettings,
    browser: config.browser,
  };
  // Creating the driver first means a wrong platform fails before any folder is touched.
  const driver = options.driver ?? (await createDriver(selection));

  const outDir = path.resolve(cwd, options.out ?? DEFAULT_OUT_DIR);
  await mkdir(outDir, { recursive: true });
  await ensureGitattributes(outDir);
  const release = await acquireRunLock(outDir);
  try {
    const decision = chooseRun(await listRuns(outDir), settings, options.fresh ?? false);
    if (decision.message) logger.info(decision.message);

    let run: RunJson;
    if (decision.resume) {
      run = decision.resume;
    } else {
      const resolved = await resolvePages({
        site,
        sitemap: options.sitemap ?? undefined,
        pagesFile: options.pages ?? undefined,
        include,
        exclude,
        limit,
        cwd,
        ...(options.fetch ? { fetch: options.fetch } : {}),
        logger,
      });
      const createdAt = now();
      run = {
        schemaVersion: 1,
        id: "",
        name: runName,
        status: "incomplete",
        createdAt: isoLocal(createdAt),
        completedAt: null,
        site: site.origin,
        settings,
        settingsHash: settingsHash(settings),
        configSha256: loaded.sha256,
        flagRulesSha256: flagRulesSha256(config.flags),
        replayed: selection.name === "replay",
        source: resolved.source,
        compareTo: null,
        sessions: [],
        skipped: resolved.skipped,
        pages: resolved.pages.map((page): PageRecord => ({
          ...page,
          status: "pending",
          attempts: 0,
          passes: {},
          files: {},
          flags: [],
          errors: [],
        })),
      };
      // Check --compare before any work, so a bad base doesn't surface hours later.
      if (options.compare) await resolveCompareBase(outDir, run, options.compare);
      run.id = await allocateRunId(outDir, createdAt, runName);
      await writeRunJson(outDir, run);
      logger.info(`Run ${run.id} started. Output: ${runDir(outDir, run.id)}`);
    }
    if (decision.resume && options.compare) await resolveCompareBase(outDir, run, options.compare);

    return await execute({
      run,
      driver,
      config,
      loaded,
      outDir,
      site,
      logger,
      signal,
      now,
      options,
    });
  } finally {
    await release();
  }
}

interface ExecuteContext {
  run: RunJson;
  driver: ScreenReaderDriver;
  config: VoicecapConfig;
  loaded: LoadedConfig;
  outDir: string;
  site: URL;
  logger: Logger;
  signal: AbortSignal;
  now: () => Date;
  options: RunAuditOptions;
}

async function execute(ctx: ExecuteContext): Promise<RunAuditResult> {
  const { run, config, outDir, logger, now } = ctx;
  const session: SessionRecord = {
    n: run.sessions.length + 1,
    startedAt: isoLocal(now()),
    endedAt: null,
    endReason: null,
    pagesDone: 0,
    environment: null,
  };
  run.sessions.push(session);
  if (run.flagRulesSha256 !== flagRulesSha256(config.flags)) {
    // Resumed with different flag rules: all flags are recomputed at completion.
    run.flagRulesSha256 = "";
  }
  await writeRunJson(outDir, run);

  const driverSession = new DriverSession(ctx.driver, config.timeouts.driverStartMs, logger);
  const end = async (reason: SessionRecord["endReason"]) => {
    session.endedAt = isoLocal(now());
    session.endReason = reason;
    await writeRunJson(outDir, run);
  };

  let outcome: RunAuditResult["outcome"];
  try {
    for (const note of await ctx.driver.cleanupStale()) logger.info(`Cleaned up: ${note}`);
    await driverSession.start();
    const info = await ctx.driver.getEnvironmentInfo();
    const environment: EnvironmentRecord = {
      ...info,
      pageSource: run.settings.source,
      voicecap: { version: voicecapVersion(), configSha256: ctx.loaded.sha256 },
      runId: run.id,
      runStartedAt: run.createdAt,
    };
    session.environment = environment;
    run.replayed ||= info.replay !== undefined;
    await writeRunJson(outDir, run);

    outcome = await transcribePages(ctx, session, driverSession, environment);
  } catch (error) {
    if (error instanceof InterruptedError) {
      outcome = "interrupted";
    } else {
      await driverSession.stop();
      await end(error instanceof EnvironmentError ? "environment-failure" : "error");
      throw error;
    }
  } finally {
    await driverSession.stop();
  }

  const failedPages = run.pages.filter((page) => page.status === "failed").length;
  if (outcome === "interrupted") {
    await end("interrupted");
    logger.warn(
      `Interrupted. Progress is saved in ${run.id}; run the same command again to resume.`,
    );
    return { runId: run.id, outcome, exitCode: ExitCode.interrupted, run, failedPages };
  }
  if (outcome === "stopped") {
    await end("environment-failure");
    logger.error(
      `Stopped after ${config.maxConsecutiveFailures} failed pages in a row: the screen reader or browser seems to be unusable. Fix the problem, then run the same command again to resume ${run.id}.`,
    );
    return { runId: run.id, outcome, exitCode: ExitCode.environment, run, failedPages };
  }

  await complete(ctx, session);
  if (failedPages > 0) {
    logger.warn(`${failedPages} page(s) failed; see the report for details.`);
  }
  return {
    runId: run.id,
    outcome,
    exitCode: failedPages > 0 ? ExitCode.pagesFailed : ExitCode.ok,
    run,
    failedPages,
  };
}

async function transcribePages(
  ctx: ExecuteContext,
  session: SessionRecord,
  driverSession: DriverSession,
  environment: EnvironmentRecord,
): Promise<"completed" | "stopped"> {
  const { run, config, outDir, logger, signal, now } = ctx;
  const todo = run.pages.filter((page) => page.status === "pending" || page.status === "failed");
  const durations: number[] = [];
  let consecutiveFailures = 0;
  let sinceRestart = 0;
  const passSettings = (pass: PassName): PassSettings => ({
    cap: run.settings.stepCaps[pass],
    repeatLimit: config.repeatLimit,
    endConfirmations: config.read.endConfirmations,
    noNextHeading: new RegExp(config.phrasing.noNextHeading, "i"),
    stepTimeoutMs: config.timeouts.stepMs,
  });

  for (const [index, page] of todo.entries()) {
    throwIfAborted(signal);
    if (sinceRestart >= config.restartEvery) {
      await driverSession.restart(`every ${config.restartEvery} pages`);
      sinceRestart = 0;
    }
    const startedAt = isoLocal(now());
    const outcome = await processPage({
      session: driverSession,
      run,
      page,
      outDir,
      site: ctx.site,
      passes: run.settings.passes,
      passSettings,
      openTimeoutMs: config.readiness.networkIdleTimeoutMs + config.timeouts.stepMs,
      pageTimeoutMs: config.timeouts.pageMs,
      environment,
      signal,
      now,
      ...(ctx.options.clock ? { clock: ctx.options.clock } : {}),
    });
    sinceRestart++;
    applyOutcome(page, outcome, session.n, startedAt, config);
    if (outcome.skip) run.skipped.push(outcome.skip);
    session.pagesDone++;
    await writeRunJson(outDir, run);

    if (outcome.status !== "skipped") durations.push(outcome.durationMs);
    logger.info(
      progressLine({
        index: run.pages.indexOf(page) + 1,
        total: run.pages.length,
        path: displayPath(page.url),
        outcome:
          outcome.status === "skipped"
            ? { kind: "skipped", reason: skipText(outcome) }
            : outcome.status === "failed"
              ? {
                  kind: "failed",
                  error: outcome.errors.at(-1) ?? "failed",
                  passes: progressOf(outcome),
                }
              : { kind: "done", passes: progressOf(outcome) },
        durationMs: outcome.durationMs,
        remainingMs: estimateRemaining(durations, todo.length - index - 1),
      }),
    );

    if (outcome.status === "failed") {
      consecutiveFailures++;
      if (consecutiveFailures >= config.maxConsecutiveFailures) return "stopped";
      if (index < todo.length - 1) {
        await driverSession.restart("after a failed page");
        sinceRestart = 0;
      }
    } else if (outcome.status === "done") {
      consecutiveFailures = 0;
    }
  }
  return "completed";
}

async function complete(ctx: ExecuteContext, session: SessionRecord): Promise<void> {
  const { outDir, config, logger, now } = ctx;
  let run = ctx.run;
  if (run.flagRulesSha256 === "") run = await withCurrentFlags(outDir, run, config.flags);
  const base = ctx.options.compare
    ? await resolveCompareBase(outDir, run, ctx.options.compare)
    : null;

  run.status = "completed";
  run.completedAt = isoLocal(now());
  run.compareTo = base?.id ?? null;
  const sessionRecord = run.sessions.find((s) => s.n === session.n);
  if (sessionRecord) {
    sessionRecord.endedAt = run.completedAt;
    sessionRecord.endReason = "completed";
  }
  Object.assign(ctx.run, run);

  // The snapshot (and any compare diffs) go into the run folder before run.json seals it.
  await generateReport({
    outDir,
    run,
    target: "snapshot",
    config,
    compare: base ? { base, diffDir: runCompareDir(outDir, run.id, base.id) } : null,
  });
  await writeRunJson(outDir, run);
  await writeLatestRunId(outDir, run.id);
  const live = await generateReport({
    outDir,
    run,
    target: "live",
    config,
    compare: base ? { base, diffDir: liveCompareDir(outDir, base.id, run.id) } : null,
  });
  logger.info(`Run ${run.id} complete. Report: ${live.file}`);
}

function applyOutcome(
  page: PageRecord,
  outcome: PageOutcome,
  session: number,
  startedAt: string,
  config: VoicecapConfig,
): void {
  page.status = outcome.status;
  page.attempts += outcome.attempts;
  page.session = session;
  page.startedAt = startedAt;
  page.durationMs = outcome.durationMs;
  page.passes = outcome.passes;
  page.files = outcome.files;
  page.errors = outcome.errors;
  page.flags = outcome.status === "done" ? evaluateFlags(outcome.results, config.flags) : [];
  if (outcome.finalUrl !== undefined) page.finalUrl = outcome.finalUrl;
  if (outcome.httpStatus !== undefined) page.httpStatus = outcome.httpStatus;
  if (outcome.skip) page.skip = outcome.skip;
  else delete page.skip;
}

function progressOf(outcome: PageOutcome): Partial<Record<PassName, PassProgress>> {
  const progress: Partial<Record<PassName, PassProgress>> = {};
  for (const [pass, result] of Object.entries(outcome.results) as [
    PassName,
    PageOutcome["results"][PassName],
  ][]) {
    if (!result) continue;
    const items =
      pass === "headings"
        ? result.steps.length - (result.stopReason === "no-next-heading" ? 1 : 0)
        : result.steps.filter((step) => step.inDocument !== false).length;
    progress[pass] = { steps: result.steps.length, stopReason: result.stopReason, items };
  }
  return progress;
}

function skipText(outcome: PageOutcome): string {
  const skip = outcome.skip;
  if (!skip) return "skipped";
  if (skip.reason === "non-html-response")
    return `not HTML (${skip.contentType ?? "unknown type"})`;
  if (skip.reason === "redirect-off-origin")
    return `redirected to another origin (${skip.finalUrl ?? "?"})`;
  return skip.reason;
}

function checkPasses(passes: readonly string[]): PassName[] {
  const unique = [...new Set(passes)];
  const unknown = unique.filter((pass) => !(PASS_NAMES as readonly string[]).includes(pass));
  if (unknown.length > 0 || unique.length === 0) {
    throw new UsageError(
      `Unknown pass${unknown.length === 1 ? "" : "es"} ${unknown.join(", ") || "(none given)"}: use read, headings, and/or tab.`,
    );
  }
  return unique as PassName[];
}

function checkCount(flag: string, value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < 1) {
    throw new UsageError(`${flag} must be a whole number of at least 1 (got ${value}).`);
  }
  return value;
}

const GITATTRIBUTES = `# Written by voicecap. Git must not change line endings in these files: the SHA-256
# hashes in run.json and reviews.json only match the files byte for byte.
* -text
`;

/** Keep Git from rewriting transcripts, which would break their recorded hashes. */
async function ensureGitattributes(outDir: string): Promise<void> {
  const file = path.join(outDir, ".gitattributes");
  if (!existsSync(file)) await writeFile(file, GITATTRIBUTES);
}
