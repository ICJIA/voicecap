import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { loadConfig, type LoadedConfig } from "../config/load.js";
import type { VoicecapConfig } from "../config/schema.js";
import { createDriver, selectDriver, type DriverSelection } from "../drivers/index.js";
import { loadPlatformReadiness } from "../drivers/readiness.js";
import { BROWSER_WINDOW, type ScreenReaderDriver } from "../drivers/types.js";
import { evaluateFlags, flagRulesSha256 } from "../flags/evaluate.js";
import {
  PASS_NAMES,
  type EnvironmentRecord,
  type ListenerAnswer,
  type PageRecord,
  type PassName,
  type ReviewerRecord,
  type RunJson,
  type RunSettings,
  type SessionRecord,
} from "../model.js";
import { compilePattern } from "../pages/filter.js";
import { pageSourceFor, resolvePages } from "../pages/resolve.js";
import { displayPath, parseSiteUrl } from "../pages/url.js";
import type { PassSettings } from "../passes/index.js";
import { InterruptedError, throwIfAborted } from "../passes/steps.js";
import type { PlatformReadiness, PreflightResult } from "../readiness/model.js";
import { runPreflight } from "../readiness/preflight.js";
import { renderProblems, renderRunSummary } from "../readiness/render.js";
import { generateReport, resolveCompareBase } from "../report/index.js";
import { findReviewer } from "../reviews/reviewer.js";
import { EnvironmentError, errorMessage, ExitCode, UsageError } from "../util/errors.js";
import { sealOf } from "../util/hash.js";
import { createConsoleLogger, type Logger } from "../util/log.js";
import { isoLocal, isoLocalMs } from "../util/time.js";
import { voicecapVersion } from "../util/version.js";
import { DriverSession } from "./driver-session.js";
import { withCurrentFlags } from "./flags.js";
import { ensureGitFiles } from "./git-files.js";
import { acquireRunLock } from "./lock.js";
import {
  collectMachineRecord,
  machineProbeFor,
  nodeMachineFacts,
  type MachineProbe,
} from "./machine-record.js";
import { processPage, type PageOutcome } from "./page-runner.js";
import { liveCompareDir, resolveHome, runCompareDir, runDir, siteDirFor } from "./paths.js";
import { estimateRemaining, progressLine, type PassProgress } from "./progress.js";
import { chooseRun, settingsHash } from "./resume.js";
import { allocateRunId, sanitizeRunName } from "./run-id.js";
import { listRuns, writeLatestRunId, writeRunJson } from "./store.js";

export interface RunAuditOptions {
  /** The site's URL; pages must be on its origin. */
  site: string;
  /**
   * Exactly one page source: a sitemap, a page list file (.csv or .json), or --page URLs. The
   * sitemap is its full URL, or a name or path on the site (from its root), as --page paths are:
   * "sitemap.xml" and "/sitemap.xml" are both https://dvfr.illinois.gov/sitemap.xml for a site on
   * https://dvfr.illinois.gov, and a subsite's sitemap is given as its path ("/blog/sitemap.xml").
   * A name that starts with a host ("dvfr.illinois.gov/sitemap.xml") is refused: give it with
   * https://. A run knows its sitemap by the full URL, so either form resumes a run the other
   * started.
   */
  sitemap?: string | null;
  pages?: string | null;
  pageUrls?: string[] | null;
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
  /**
   * The transcripts home; the run goes in the site's folder inside it. Default:
   * VOICECAP_TRANSCRIPTS, else "transcripts".
   */
  out?: string;
  runName?: string | null;
  /**
   * Who is running this session, recorded with it. Default: VOICECAP_REVIEWER, then
   * `git config user.name`, then the config's reviewer; with none of them, the session records none.
   */
  reviewer?: string | null;
  /** Replaces `git config user.name` for the reviewer (tests). */
  gitUserName?: (cwd: string) => string | null;
  /** Replay a run folder instead of running NVDA. */
  replayFrom?: string | null;
  cwd?: string;
  /** Where VOICECAP_TRANSCRIPTS is read from. Default: process.env. */
  env?: NodeJS.ProcessEnv;
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
  /**
   * Replaces the readiness check before a real run (tests). The check never runs for a replay
   * run, whether or not this is given.
   */
  readiness?: () => Promise<PlatformReadiness>;
  /**
   * Which platform's readiness check a real run uses, and which platform's probe reads the
   * computer's details for each session's record. Default: process.platform. Tests only.
   */
  platform?: NodeJS.Platform;
  /**
   * Replaces the probe that reads the computer's details for each session's record (tests). The
   * default is the probe for `platform`, which asks the system: on Windows, a start of PowerShell
   * that takes seconds.
   */
  machineProbe?: MachineProbe;
  /**
   * The quick checks' result, when the caller has just run them (voicecap demo's step 2): a real
   * run uses it instead of checking again. Not ready still stops the run, and ready still logs the
   * one-line summary. A replay run ignores it, as it ignores `readiness`.
   */
  preflight?: PreflightResult;
  /**
   * The command that starts over, for a caller whose run can't be resumed: voicecap demo's run is
   * --fresh, on a demo site that stops with the tour. An interrupted or stopped run then says
   * "run <again> to start again" instead of "run the same command again to resume". Plain runs
   * leave it out.
   */
  again?: string;
  /**
   * Asks the person running the session whether they listened, when the session ends: once the
   * screen reader has stopped and the session's end is written, and before a completed run is
   * sealed, so its seal covers the answer. Asked only of a session that read pages, and never of a
   * replayed run. A session that ends with an error is asked too, after a line that says why it
   * stopped; the error is thrown once the answer is kept. Resolves null for no answer (Ctrl+C at
   * the question, the input ended, or the window closed). The CLI gives it only to a person at a
   * terminal whose output is the terminal too: a script, CI, or output redirected to a file is
   * never asked. The session's record keeps the answer, with when it was asked and answered, and
   * nothing when there's no answer.
   */
  askListener?: (question: {
    /** The screen reader's name, as the session's environment gives it. */
    screenReader: string;
    /** How many pages the session went through. */
    pagesRead: number;
  }) => Promise<ListenerAnswer | null>;
}

export interface RunAuditResult {
  runId: string;
  /** The site's folder in the home, absolute. */
  siteDir: string;
  /** The run's folder, absolute. */
  runDir: string;
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
    pageUrls: options.pageUrls ?? undefined,
    site,
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
  // Quick checks before anything real happens: not ready throws before any folder or lock is
  // touched; ready logs a one-line summary and any warnings, then the run proceeds as usual.
  await checkReadiness({ selection, config, options, logger, cwd });
  // Creating the driver first means a wrong platform fails before any folder is touched.
  const driver = options.driver ?? (await createDriver(selection, { config, logger }));

  const home = resolveHome({ out: options.out, env: options.env ?? process.env, cwd });
  const outDir = siteDirFor(home, site);
  await mkdir(outDir, { recursive: true });
  await ensureGitFiles(home);
  noteOldLayout(home, logger);
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
        pageUrls: options.pageUrls ?? undefined,
        include,
        exclude,
        limit,
        cwd,
        ...(options.fetch ? { fetch: options.fetch } : {}),
        logger,
      });
      if (resolved.pages.length === 0) throw noPagesError(resolved.source, resolved.skipped.length);
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

/** Where the reviewer's name came from, as the run says it. */
const REVIEWER_SOURCES: Record<ReviewerRecord["source"], string> = {
  option: "from --reviewer",
  environment: "from VOICECAP_REVIEWER",
  git: "from git config user.name",
  config: "from the config's reviewer",
};

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
  const reviewer = findReviewer({
    option: ctx.options.reviewer,
    env: ctx.options.env ?? process.env,
    configReviewer: config.reviewer,
    cwd: ctx.options.cwd ?? process.cwd(),
    ...(ctx.options.gitUserName ? { gitUserName: ctx.options.gitUserName } : {}),
  });
  if (reviewer) logger.info(`Reviewer: ${reviewer.name} (${REVIEWER_SOURCES[reviewer.source]})`);
  else {
    logger.warn(
      "No reviewer name, so this session's record won't say who ran it. Pass --reviewer, or set VOICECAP_REVIEWER.",
    );
  }
  const session: SessionRecord = {
    n: run.sessions.length + 1,
    startedAt: isoLocal(now()),
    reviewer,
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

  let ending: Ending;
  try {
    for (const note of await ctx.driver.cleanupStale()) logger.info(`Cleaned up: ${note}`);
    throwIfAborted(ctx.signal);
    // The computer's details are read while the screen reader and browser start: the probe takes
    // seconds on Windows (a start of PowerShell), which would otherwise be time they spend running.
    // It never rejects, so a start that fails leaves nothing unhandled.
    const machine = collectMachineRecord(
      ctx.options.machineProbe ?? machineProbeFor(ctx.options.platform ?? process.platform),
      nodeMachineFacts(),
    );
    await driverSession.start(ctx.signal);
    const info = await ctx.driver.getEnvironmentInfo();
    const environment: EnvironmentRecord = {
      ...info,
      pageSource: run.settings.source,
      voicecap: { version: voicecapVersion(), configSha256: ctx.loaded.sha256 },
      runId: run.id,
      runStartedAt: run.createdAt,
      machine: {
        ...(await machine),
        // A replay opens no browser, so it has no window to record.
        browserWindow: info.replay === undefined ? { ...BROWSER_WINDOW } : null,
      },
    };
    session.environment = environment;
    run.replayed ||= info.replay !== undefined;
    await writeRunJson(outDir, run);

    ending = { outcome: await transcribePages(ctx, session, driverSession, environment) };
  } catch (error) {
    ending = error instanceof InterruptedError ? { outcome: "interrupted" } : { error };
  } finally {
    await driverSession.stop();
  }

  // Every session's end is on disk before the question: a window closed at the question can end
  // voicecap at once (a second signal does), and the record still says how the session ended. A
  // completed session ended when the screen reader stopped, whenever the answer comes.
  await end(endReasonOf(ending));
  // Asked once the screen reader is stopped, and before complete() below seals the run, so the
  // answer is part of what the seal covers.
  await recordListener(ctx, session, ending);
  if ("error" in ending) throw ending.error;
  const { outcome } = ending;

  const failedPages = run.pages.filter((page) => page.status === "failed").length;
  const folders = { siteDir: outDir, runDir: runDir(outDir, run.id) };
  // A caller whose run can't be resumed names the command that starts over (voicecap demo's).
  const again = ctx.options.again;
  const startAgain = again ? `run ${again} to start again` : null;
  if (outcome === "interrupted") {
    logger.warn(
      `Interrupted. Progress is saved in ${run.id}; ${startAgain ?? "run the same command again to resume"}.`,
    );
    return { runId: run.id, ...folders, outcome, exitCode: ExitCode.interrupted, run, failedPages };
  }
  if (outcome === "stopped") {
    logger.error(
      `Stopped after ${config.maxConsecutiveFailures} failed pages in a row: the screen reader or browser seems to be unusable. Fix the problem, then ${startAgain ?? `run the same command again to resume ${run.id}`}.`,
    );
    return { runId: run.id, ...folders, outcome, exitCode: ExitCode.environment, run, failedPages };
  }

  await complete(ctx);
  if (failedPages > 0) {
    logger.warn(`${failedPages} page(s) failed; see the report for details.`);
  }
  return {
    runId: run.id,
    ...folders,
    outcome,
    exitCode: failedPages > 0 ? ExitCode.pagesFailed : ExitCode.ok,
    run,
    failedPages,
  };
}

/** How a session ended: with an outcome of the run's, or with an error that's thrown on. */
type Ending = { outcome: RunAuditResult["outcome"] } | { error: unknown };

/** What the session's record says of how it ended. */
function endReasonOf(ending: Ending): NonNullable<SessionRecord["endReason"]> {
  if ("error" in ending) {
    return ending.error instanceof EnvironmentError ? "environment-failure" : "error";
  }
  return ending.outcome === "stopped" ? "environment-failure" : ending.outcome;
}

/**
 * Ask whether the person running the session listened, and put the answer in the session's record,
 * written at once. Asked only when the caller can ask, the session read pages, and the run isn't a
 * replay. A session that ended with an error is told why first, in one line, so the question
 * doesn't come out of nowhere; the error's full explanation follows the question. With no answer
 * the record has no statement. A question that fails is said, and the run goes on without a
 * statement: a run's record is never lost over a question.
 */
async function recordListener(
  ctx: ExecuteContext,
  session: SessionRecord,
  ending: Ending,
): Promise<void> {
  const { run, outDir, logger, now } = ctx;
  const ask = ctx.options.askListener;
  if (!ask || session.pagesDone === 0 || run.replayed) return;
  if ("error" in ending) {
    const reason = errorMessage(ending.error).split("\n")[0] ?? "";
    logger.info(`The session ended with an error: ${reason}`);
  }
  const askedAt = isoLocalMs(now());
  let answer: ListenerAnswer | null;
  try {
    answer = await ask({
      screenReader: session.environment?.screenReader?.name ?? "the screen reader",
      pagesRead: session.pagesDone,
    });
  } catch (error) {
    logger.warn(
      `Couldn't ask whether you listened (${errorMessage(error)}), so this session's record won't say.`,
    );
    return;
  }
  if (answer === null) return;
  session.listener = { answer, askedAt, answeredAt: isoLocalMs(now()) };
  await writeRunJson(outDir, run);
}

async function transcribePages(
  ctx: ExecuteContext,
  session: SessionRecord,
  driverSession: DriverSession,
  environment: EnvironmentRecord,
): Promise<"completed" | "stopped"> {
  const { run, config, outDir, logger, signal, now } = ctx;
  // Pages never tried come first; pages that failed in an earlier session are retried last, so a
  // resumed run always makes progress even if those pages fail again.
  const retried = new Set(run.pages.filter((page) => page.status === "failed"));
  const todo = [
    ...run.pages.filter((page) => page.status === "pending"),
    ...run.pages.filter((page) => retried.has(page)),
  ];
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
      await driverSession.restart(`every ${config.restartEvery} pages`, signal);
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
      maxAttempts: config.pageAttempts,
      environment,
      signal,
      save: () => writeRunJson(outDir, run),
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

    // An HTTP error means the site answered: the screen reader and browser are fine, so it neither
    // counts toward stopping the run nor needs a restart. A page that already failed in an earlier
    // session doesn't count either, or a resumed run could never get past it.
    if (outcome.status === "failed" && outcome.failure === "environment") {
      if (!retried.has(page)) consecutiveFailures++;
      if (consecutiveFailures >= config.maxConsecutiveFailures) return "stopped";
      if (index < todo.length - 1) {
        await driverSession.restart("after a failed page", signal);
        sinceRestart = 0;
      }
    } else if (outcome.status === "done") {
      consecutiveFailures = 0;
    }
  }
  return "completed";
}

/**
 * Complete the run: seal it, and write its reports. The session's end, and the listener's
 * statement, are in its record already.
 */
async function complete(ctx: ExecuteContext): Promise<void> {
  const { outDir, config, logger, now } = ctx;
  let run = ctx.run;
  if (run.flagRulesSha256 === "") run = await withCurrentFlags(outDir, run, config.flags);
  const base = ctx.options.compare
    ? await resolveCompareBase(outDir, run, ctx.options.compare)
    : null;

  run.status = "completed";
  run.completedAt = isoLocal(now());
  run.compareTo = base?.id ?? null;
  // Sealed last, once every other field is final: the seal covers every field, so none may change
  // after this. The sealed run.json itself is written below, after the snapshot.
  run.seal = sealOf(run);
  Object.assign(ctx.run, run);

  // The snapshot (and any compare diffs) go into the run folder while run.json on disk still says
  // incomplete. Writing the completed run.json closes the folder: assertRunWritable refuses any
  // later write into it, run.json included.
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

/**
 * Put a page's processing in its record. Its attempts are there already: processPage counts each
 * one, and keeps each failed one, as it ends.
 */
function applyOutcome(
  page: PageRecord,
  outcome: PageOutcome,
  session: number,
  startedAt: string,
  config: VoicecapConfig,
): void {
  page.status = outcome.status;
  if (outcome.failure) page.failure = outcome.failure;
  else delete page.failure;
  page.session = session;
  page.startedAt = startedAt;
  page.durationMs = outcome.durationMs;
  page.passes = outcome.passes;
  page.files = outcome.files;
  page.errors = outcome.errors;
  page.flags = outcome.status === "done" ? evaluateFlags(outcome.results, config.flags) : [];
  if (outcome.finalUrl !== undefined) page.finalUrl = outcome.finalUrl;
  if (outcome.httpStatus !== undefined) page.httpStatus = outcome.httpStatus;
  // A page that has been tried always gets a title, null when there is none to record. Absent means
  // the page is pending, or the run is from before titles were recorded.
  page.title = outcome.title ?? null;
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

/** Nothing left to transcribe: say why, instead of "completing" an empty run. */
function noPagesError(source: RunJson["source"], skipped: number): UsageError {
  const parts = [`${source.listed} listed`];
  if (source.invalid.length > 0) parts.push(`${source.invalid.length} invalid`);
  if (source.duplicates > 0) parts.push(`${source.duplicates} duplicates`);
  if (skipped > 0) parts.push(`${skipped} skipped (another origin, or not HTML)`);
  if (source.excludedByFilter > 0)
    parts.push(`${source.excludedByFilter} left out by --include/--exclude`);
  if (source.excludedByLimit > 0) parts.push(`${source.excludedByLimit} left out by --limit`);
  return new UsageError(
    `No pages to transcribe (${parts.join(", ")}). Check --site, the page source, and any --include or --exclude patterns.`,
  );
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

/**
 * Quick checks (about 3 seconds) before a real run touches anything. Not ready: throws
 * EnvironmentError with the "Not ready" block, before the site folder, the run lock, or NVDA are
 * touched. Ready: logs the one-line pass summary and any WARN lines, then the run proceeds as
 * usual. Never runs for a replay run. A caller that has just run the checks passes their result
 * as `options.preflight`, which is used instead. Otherwise runs when a test supplies
 * `options.readiness`, or the run selected guidepup and is really on Windows, with no test driver
 * standing in for it.
 */
async function checkReadiness(args: {
  selection: DriverSelection;
  config: VoicecapConfig;
  options: RunAuditOptions;
  logger: Logger;
  cwd: string;
}): Promise<void> {
  const { selection, config, options, logger, cwd } = args;
  if (selection.name === "replay") return;
  if (options.preflight) {
    reportReadiness(options.preflight, logger);
    return;
  }
  const platform = options.platform ?? process.platform;
  const runsChecks =
    options.readiness !== undefined ||
    (!options.driver && selection.name === "guidepup" && platform === "win32");
  if (!runsChecks) return;

  const readiness = options.readiness
    ? await options.readiness()
    : await loadPlatformReadiness({
        platform,
        config,
        logger,
        env: options.env ?? process.env,
        cwd,
        again: "the same command",
      });
  reportReadiness(await runPreflight(readiness), logger);
}

/** Not ready: throws the "Not ready" block. Ready: logs the one-line summary and any warnings. */
function reportReadiness(result: PreflightResult, logger: Logger): void {
  if (!result.ready) {
    throw new EnvironmentError(renderProblems(result.checks, { offerSetup: true }));
  }
  logger.info(renderRunSummary(result));
}

/** voicecap 0.2.0's layout, at the home's top: neither read nor moved by later versions. */
const OLD_LAYOUT_FOLDERS = ["runs", "manual"] as const;

/**
 * Say once when the home still has voicecap 0.2.0's runs/ or manual/ folders (and the files
 * beside them), naming the ones that are there, so the owner knows they're left alone on
 * purpose rather than lost.
 */
function noteOldLayout(home: string, logger: Logger): void {
  const present = OLD_LAYOUT_FOLDERS.filter((name) => existsSync(path.join(home, name)));
  if (present.length === 0) return;
  const one = present.length === 1;
  const folders = new Intl.ListFormat("en").format(present.map((name) => `${name}/`));
  logger.info(
    `${home} has voicecap 0.2.0's ${folders} ${one ? "folder" : "folders"}. ` +
      `${one ? "It isn't" : "They aren't"} read any more, and ` +
      `${one ? "it's left as it is" : "they're left as they are"}.`,
  );
}
