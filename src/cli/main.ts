import { Command, CommanderError, InvalidArgumentError, Option } from "commander";

import { defaultConfig, loadConfig } from "../config/load.js";
import type { VoicecapConfig } from "../config/schema.js";
import { startDemoServer } from "../demo/server.js";
import { runTour } from "../demo/tour.js";
import { DEMO_OUT, INPUT_ENDED, NOT_A_TERMINAL } from "../demo/words.js";
import { createPrompter, deferPrompter, InputEndedError, type Prompter } from "../init/prompt.js";
import { runWizard } from "../init/wizard.js";
import { listUrls } from "../list-urls.js";
import { addManualSession } from "../manual-add.js";
import { PASS_NAMES, REVIEW_STATUSES, type PassName, type ReviewStatus } from "../model.js";
import { InterruptedError } from "../passes/steps.js";
import { offerLiveTest } from "../readiness/guided.js";
import type { PlatformReadiness } from "../readiness/model.js";
import { runPreflight } from "../readiness/preflight.js";
import { runPreflightCommand } from "../readiness/preflight-command.js";
import { renderCheckingNotice, renderPreflight } from "../readiness/render.js";
import { addReview } from "../reviews/review.js";
import { runAudit } from "../run/audit.js";
import { regenerateLiveFiles } from "../run/live-report.js";
import { resolveHome } from "../run/paths.js";
import { handleInterrupts } from "../run/signals.js";
import { chooseSiteDir } from "../run/site-dir.js";
import { shareReport } from "../share/share.js";
import { ExitCode, UsageError, VoicecapError } from "../util/errors.js";
import { assertNotRewritten } from "../util/git-bash.js";
import { createConsoleLogger, type Logger, type OutputStream } from "../util/log.js";
import { isTerminalStream } from "../util/terminal.js";
import { voicecapVersion } from "../util/version.js";
import { verifyHome } from "../verify.js";
import { makeAskListener } from "./listener.js";

export interface CliContext {
  stdout: OutputStream;
  stderr: OutputStream;
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Tests: interrupt runs with this signal instead of installing Ctrl+C handlers. */
  signal?: AbortSignal;
  /** Tests: replaces fetch for sitemaps. */
  fetch?: typeof fetch;
  /** init's input, and what decides whether it's a terminal. Default: process.stdin. */
  stdin: NodeJS.ReadableStream;
  /** Whether no arguments at all should start init. Default: stdin and stdout are both a terminal. */
  interactive: boolean;
  /**
   * Tests: replaces the platform readiness check of preflight, doctor, init, and setup's preflight
   * and live test.
   */
  platformReadiness?: () => Promise<PlatformReadiness>;
  /**
   * Which operating system's init, setup, doctor, and preflight to run; tests set it. Default:
   * process.platform.
   */
  platform: NodeJS.Platform;
}

interface RunOptions {
  site?: string;
  sitemap?: string;
  pages?: string;
  page: string[];
  limit?: number;
  include: string[];
  exclude: string[];
  passes?: string;
  maxSteps?: number;
  compare?: string;
  fresh?: boolean;
  out?: string;
  runName?: string;
  reviewer?: string;
  replayFrom?: string;
}

const OUT_HELP = "transcripts home (default: VOICECAP_TRANSCRIPTS, else ./transcripts)";

/** Run the voicecap CLI and return its exit code. */
export async function main(argv: string[], context: Partial<CliContext> = {}): Promise<number> {
  const ctx: CliContext = {
    stdout: process.stdout,
    stderr: process.stderr,
    cwd: process.cwd(),
    env: process.env,
    stdin: process.stdin,
    interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
    platform: process.platform,
    ...context,
  };
  const logger = createConsoleLogger(ctx.stdout, ctx.stderr);
  let exitCode: number = ExitCode.ok;
  const program = buildProgram(ctx, logger, (code) => {
    exitCode = code;
  });
  // A bare `voicecap` in a terminal is friendlier as init's questions than as a usage error.
  const startArgv = argv.length === 0 && ctx.interactive ? ["init"] : argv;
  try {
    await program.parseAsync(startArgv, { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode === 0 ? ExitCode.ok : ExitCode.usage;
    if (error instanceof VoicecapError) {
      logger.error(error.message);
      return error.exitCode;
    }
    logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    return ExitCode.usage;
  }
  return exitCode;
}

function buildProgram(ctx: CliContext, logger: Logger, setExit: (code: number) => void): Command {
  const program = new Command("voicecap");
  program
    .description(
      "Listen through a website with a real screen reader: voicecap takes NVDA page by page, saves every word it says as transcripts, and records what people reviewed.",
    )
    .version(voicecapVersion(), "-v, --version", "print voicecap's version")
    .enablePositionalOptions()
    .exitOverride()
    .configureOutput({
      writeOut: (text) => void ctx.stdout.write(text),
      writeErr: (text) => void ctx.stderr.write(text),
    })
    .showHelpAfterError("(run voicecap --help for usage)");

  program
    .option("--site <url>", "the site's URL; pages must be on its origin")
    .option(
      "--sitemap <url>",
      "take pages from this sitemap (<urlset> or <sitemapindex>): a full URL, or a name or path on the site (from its root), such as sitemap.xml",
    )
    .option("--pages <file>", "take pages from a page list (.csv or .json)")
    .option(
      "--page <url>",
      "take this page: a full URL, or a path like /faq/ (repeatable)",
      collect,
      [],
    )
    .option("--limit <n>", "transcribe at most n pages", positiveInt("--limit"))
    .option(
      "--include <pattern>",
      "only URL paths matching (glob, or re:regex); repeatable",
      collect,
      [],
    )
    .option(
      "--exclude <pattern>",
      "skip URL paths matching (glob, or re:regex); repeatable",
      collect,
      [],
    )
    .option("--passes <list>", "passes to run, e.g. read,headings,tab (default: all)")
    .option("--max-steps <n>", "override every pass's step cap", positiveInt("--max-steps"))
    .option("--compare <run>", 'compare with a run id, or "previous"')
    .option("--fresh", "start a new run instead of resuming an interrupted one")
    .option("--out <dir>", OUT_HELP)
    .option("--run-name <name>", "add a name to the run's folder")
    .option(
      "--reviewer <name>",
      "who is running it, recorded with each session (default: VOICECAP_REVIEWER, git config user.name, or the config's reviewer)",
    )
    .option("--replay-from <dir>", "replay a run folder instead of running NVDA (replay driver)")
    .addHelpText(
      "after",
      `
Examples:
  npx @icjia/voicecap init
  npx @icjia/voicecap --site https://dvfr.illinois.gov --pages ./pages.csv
  npx @icjia/voicecap --site https://dvfr.illinois.gov --sitemap sitemap.xml
  npx @icjia/voicecap --site https://dvfr.illinois.gov --page https://dvfr.illinois.gov/faq/
  voicecap review --page https://dvfr.illinois.gov/about/ --status reviewed --note "Reads well"
  voicecap report --compare previous

Exit codes: 0 completed, 1 invalid usage or config, 2 environment unusable,
3 completed but some pages failed (for verify, something recorded doesn't match),
130 interrupted (state saved).`,
    )
    .action(async (options: RunOptions) => {
      setExit(await runCommand(options, ctx, logger));
    });

  program
    .command("init")
    .description("answer a few questions and compose a run command, with the option to run it")
    .action(async () => {
      // Made only at the first question: a terminal prompter keeps Ctrl+C to itself, and the
      // checks don't listen to it. Until then, Ctrl+C stops init and its checks at once.
      const prompter = deferPrompter(() =>
        createPrompter({
          input: ctx.stdin,
          output: ctx.stdout,
          terminal: isTerminalStream(ctx.stdin),
        }),
      );
      try {
        const platform = ctx.platformReadiness
          ? await ctx.platformReadiness()
          : await loadPlatform(ctx, logger, "npx @icjia/voicecap init");
        const notice = renderCheckingNotice(platform.checkingNotice);
        if (notice) logger.info(notice);
        const preflight = await runPreflight(platform);
        logger.info(
          renderPreflight(preflight, {
            kind: "preflight",
            when: new Date(),
            screenReader: platform.screenReader,
            canRunYet: platform.cannotRunYet === null,
            tip: platform.readyTip,
            offerSetup: true,
          }),
        );
        if (!preflight.ready) {
          prompter.close();
          setExit(ExitCode.environment);
          return;
        }
        // Offered only to someone at a terminal, as setup does: piped answers are the wizard's.
        const liveTestExit = isTerminalStream(ctx.stdin)
          ? await offerLiveTest(platform, { prompter, logger })
          : ExitCode.ok;
        if (liveTestExit !== ExitCode.ok) {
          prompter.close();
          setExit(liveTestExit);
          return;
        }
        const result = await runWizard({
          prompter,
          fetch: ctx.fetch ?? fetch,
          cwd: ctx.cwd,
          env: ctx.env,
          now: () => new Date(),
          readiness: () =>
            platform.cannotRunYet === null
              ? { canRun: true, screenReader: platform.screenReader! }
              : { canRun: false, reason: platform.cannotRunYet },
          signal: prompter.interrupted,
        });
        // Closing releases the terminal's raw mode before a run installs its own Ctrl+C handling.
        prompter.close();
        // Not interactive, so the composed arguments always make a run, never init again.
        setExit(result.run ? await main(result.args, { ...ctx, interactive: false }) : ExitCode.ok);
      } catch (error) {
        prompter.close();
        if (error instanceof InputEndedError) setExit(ExitCode.usage);
        else if (error instanceof InterruptedError) setExit(ExitCode.interrupted);
        else throw error;
      }
    });

  program
    .command("demo")
    .description(
      "a guided first run: check this computer, then audit a demo site that comes with voicecap",
    )
    .action(async () => {
      // The tour waits for Enter at every step, so it needs someone at a terminal.
      if (!isTerminalStream(ctx.stdin)) throw new UsageError(NOT_A_TERMINAL);
      const platform = ctx.platformReadiness
        ? await ctx.platformReadiness()
        : await loadPlatform(ctx, logger, "npx @icjia/voicecap demo", {
            // voicecap's own settings, as the tour's run uses: the demo never reads a
            // voicecap.config.* in this folder, which could change it or stop it.
            config: defaultConfig().config,
            // Step 2's "Transcripts" line names the demo's own folder, where its run goes.
            env: { ...ctx.env, VOICECAP_TRANSCRIPTS: DEMO_OUT },
          });
      // One prompter for the whole tour: in a terminal it keeps Ctrl+C to itself, and its
      // `interrupted` signal stops the live test and the audit as well as a pause.
      const prompter = createPrompter({ input: ctx.stdin, output: ctx.stdout, terminal: true });
      try {
        setExit(
          await runTour({
            platform,
            os: ctx.platform,
            prompter,
            logger,
            cwd: ctx.cwd,
            env: ctx.env,
            now: () => new Date(),
            startServer: () => startDemoServer(),
            runAudit,
            openFile: async (file) =>
              (await import("../drivers/open-file.js")).openFile(file, { platform: ctx.platform }),
          }),
        );
      } catch (error) {
        if (!(error instanceof InputEndedError)) throw error;
        // Ctrl+D at a pause: nothing is running then, since the demo site runs only in step 4.
        logger.info(INPUT_ENDED);
        setExit(ExitCode.usage);
      } finally {
        prompter.close();
      }
    });

  program
    .command("list-urls")
    .description("export a sitemap as a page list, or draft a sample to curate")
    .argument("<output>", "the file to write: .csv or .json")
    .requiredOption("--site <url>", "the site's URL")
    .requiredOption(
      "--sitemap <url>",
      "the sitemap to read: a full URL, or a name or path on the site (from its root), such as sitemap.xml",
    )
    .option("--sample <n>", "draft n pages per URL path pattern", positiveInt("--sample"))
    .option("--include <pattern>", "only URL paths matching; repeatable", collect, [])
    .option("--exclude <pattern>", "skip URL paths matching; repeatable", collect, [])
    .option("--limit <n>", "at most n URLs", positiveInt("--limit"))
    .action(
      async (
        output: string,
        options: {
          site: string;
          sitemap: string;
          sample?: number;
          include: string[];
          exclude: string[];
          limit?: number;
        },
      ) => {
        checkUrlOptions(options);
        const result = await listUrls({
          site: options.site,
          sitemap: options.sitemap,
          output,
          include: options.include,
          exclude: options.exclude,
          limit: options.limit ?? null,
          cwd: ctx.cwd,
          logger,
          ...(options.sample ? { sample: options.sample } : {}),
          ...(ctx.fetch ? { fetch: ctx.fetch } : {}),
        });
        logger.info(`Wrote ${result.count} URLs to ${result.file}`);
        setExit(ExitCode.ok);
      },
    );

  program
    .command("review")
    .description("add an entry to a page's review history")
    .requiredOption("--page <url>", "the page: full URL or root-relative path")
    .addOption(
      new Option("--status <status>", "the review outcome")
        .choices(REVIEW_STATUSES)
        .makeOptionMandatory(),
    )
    .option("--note <text>", "what you found")
    .option(
      "--reviewer <name>",
      "who reviewed (default: VOICECAP_REVIEWER, then git config user.name)",
    )
    .option("--run <run-id>", "the run reviewed (default: the latest run with the page)")
    .option(
      "--site <url>",
      "the site's URL (default: the site of a full --page URL, else the home's only site)",
    )
    .option("--out <dir>", OUT_HELP)
    .action(
      async (options: {
        page: string;
        status: ReviewStatus;
        note?: string;
        reviewer?: string;
        run?: string;
        site?: string;
        out?: string;
      }) => {
        await addReview({
          page: options.page,
          status: options.status,
          note: options.note ?? null,
          reviewer: options.reviewer ?? null,
          run: options.run ?? null,
          site: options.site ?? null,
          out: options.out,
          cwd: ctx.cwd,
          env: ctx.env,
          logger,
        });
        setExit(ExitCode.ok);
      },
    );

  const manual = program.command("manual").description("manual NVDA sessions");
  manual
    .command("add")
    .description("import a Speech Viewer copy or an NVDA log for a page")
    .argument("<file>", "Speech Viewer text or an NVDA log (nvda.log / nvda-old.log)")
    .requiredOption("--page <url>", "the page tested: full URL or root-relative path")
    .option("--from <time>", "logs only: start at this time of day (HH:MM or HH:MM:SS)")
    .option("--to <time>", "logs only: stop at this time of day")
    .option(
      "--date <date>",
      "the session's date, YYYY-MM-DD (default: the file's modification date)",
    )
    .option("--redact-typing", "replace text typed into form fields, and NVDA's echo of it")
    .option("--keep-raw", "keep the raw original even with --redact-typing")
    .option("--no-raw", "don't keep a copy of the raw original (its hash is still recorded)")
    .option(
      "--reviewer <name>",
      "who did the session (default: VOICECAP_REVIEWER, then git config user.name)",
    )
    .option(
      "--site <url>",
      "the site's URL (default: the site of a full --page URL, else the home's only site)",
    )
    .option("--out <dir>", OUT_HELP)
    .action(
      async (
        file: string,
        options: {
          page: string;
          from?: string;
          to?: string;
          date?: string;
          redactTyping?: boolean;
          keepRaw?: boolean;
          raw: boolean;
          reviewer?: string;
          site?: string;
          out?: string;
        },
      ) => {
        await addManualSession({
          file,
          page: options.page,
          from: options.from ?? null,
          to: options.to ?? null,
          date: options.date ?? null,
          redactTyping: options.redactTyping ?? false,
          keepRaw: options.keepRaw ?? false,
          noRaw: !options.raw,
          reviewer: options.reviewer ?? null,
          site: options.site ?? null,
          out: options.out,
          cwd: ctx.cwd,
          env: ctx.env,
          logger,
        });
        setExit(ExitCode.ok);
      },
    );

  program
    .command("report")
    .description(
      "regenerate a site's live report (<out>/<site>/report.html), shareable page (share/current.html), and its Word copy (share/current.docx)",
    )
    .option(
      "--run <run-id>",
      "show this run instead of the latest completed one (it may be incomplete)",
    )
    .option("--compare <run>", 'compare with a run id, or "previous"')
    .option("--site <url>", "the site's URL (default: the home's only site)")
    .option("--out <dir>", OUT_HELP)
    .action(async (options: { run?: string; compare?: string; site?: string; out?: string }) => {
      const home = resolveHome({ out: options.out, env: ctx.env, cwd: ctx.cwd });
      const outDir = await chooseSiteDir({ home, site: options.site ?? null });
      const { config } = await loadConfig({ cwd: ctx.cwd });
      const files = await regenerateLiveFiles({
        outDir,
        config,
        logger,
        runId: options.run ?? null,
        compare: options.compare ?? null,
        requireRun: true,
      });
      logger.info(`Report: ${files?.report ?? "(none)"}`);
      // Each said only when its file was written: a warning has already said why when it wasn't.
      if (files?.share) logger.info(`Shareable page: ${files.share}`);
      if (files?.word) logger.info(`Word copy: ${files.word}`);
      setExit(ExitCode.ok);
    });

  program
    .command("share")
    .description("make a dated copy of the shareable page and its Word copy to send, and record it")
    .option("--site <url>", "the site's URL (default: the home's only site)")
    .option("--out <dir>", OUT_HELP)
    .option(
      "--reviewer <name>",
      "who is sharing (default: VOICECAP_REVIEWER, git config user.name, or the config's reviewer)",
    )
    .action(async (options: { site?: string; out?: string; reviewer?: string }) => {
      await shareReport({
        site: options.site ?? null,
        reviewer: options.reviewer ?? null,
        out: options.out,
        cwd: ctx.cwd,
        env: ctx.env,
        logger,
      });
      setExit(ExitCode.ok);
    });

  program
    .command("verify")
    .description("check that the records voicecap wrote still match their hashes and seals")
    .option("--site <url>", "the site's URL (default: every site in the home)")
    .option("--out <dir>", OUT_HELP)
    .addHelpText(
      "after",
      `
Exit codes: 0 everything matches, 3 something recorded has changed, is missing, or can't be checked.`,
    )
    .action(async (options: { site?: string; out?: string }) => {
      const home = resolveHome({ out: options.out, env: ctx.env, cwd: ctx.cwd });
      const result = await verifyHome({ home, site: options.site ?? null, logger });
      setExit(result.problems === 0 ? ExitCode.ok : ExitCode.verifyProblems);
    });

  program
    .command("setup")
    .description("install and check what voicecap needs on this computer")
    .action(async () => {
      if (ctx.platform !== "darwin" && ctx.platform !== "win32") {
        setExit(await setupWithoutScreenReader(ctx, logger));
        return;
      }
      const { config } = await loadConfig({ cwd: ctx.cwd });
      // Made only at the first question: until then, Ctrl+C stops setup and its downloads at once,
      // as it always has. A terminal prompter keeps Ctrl+C to itself until its next question.
      const prompter = isTerminalStream(ctx.stdin)
        ? deferPrompter(() =>
            createPrompter({ input: ctx.stdin, output: ctx.stdout, terminal: true }),
          )
        : null;
      try {
        setExit(await setupScreenReader(ctx, { config, logger, prompter }));
      } catch (error) {
        if (error instanceof InputEndedError) setExit(ExitCode.usage);
        else if (error instanceof InterruptedError) setExit(ExitCode.interrupted);
        else throw error;
      } finally {
        prompter?.close();
      }
    });

  program
    .command("preflight")
    .description("check this computer is ready for a run, without starting the screen reader")
    .action(async () => {
      const again = "npx @icjia/voicecap preflight";
      const platform = ctx.platformReadiness
        ? await ctx.platformReadiness()
        : await loadPlatform(ctx, logger, again);
      setExit(await runPreflightCommand({ platform, logger, again }));
    });

  program
    .command("doctor")
    .description("check this computer and print a summary to paste into a bug report")
    .action(async () => {
      const { interruptMessage, runDoctor } = await import("../readiness/doctor.js");
      const platform = ctx.platformReadiness
        ? await ctx.platformReadiness()
        : await loadPlatform(ctx, logger, "npx @icjia/voicecap doctor");
      // Ctrl+C stops the live test and shuts the screen reader and the browser down, as in a run.
      const controller = new AbortController();
      const unhook = ctx.signal
        ? () => {}
        : handleInterrupts(controller, logger, {
            message: interruptMessage(platform.screenReader),
          });
      try {
        setExit(await runDoctor({ platform, logger, signal: ctx.signal ?? controller.signal }));
      } finally {
        unhook();
      }
    });

  return program;
}

/**
 * setup on a Mac (the guided setup) or on Windows (the NVDA install). A test's platform readiness,
 * when given, replaces the one behind the preflight and the live test.
 */
async function setupScreenReader(
  ctx: CliContext,
  options: { config: VoicecapConfig; logger: Logger; prompter: Prompter | null },
): Promise<number> {
  const platformReadiness = ctx.platformReadiness;
  if (ctx.platform === "darwin") {
    const { realMacSetupDeps, runMacSetup } = await import("../drivers/voiceover/setup-mac.js");
    const deps = realMacSetupDeps(options);
    return runMacSetup(
      options,
      platformReadiness ? { ...deps, platform: platformReadiness } : deps,
    );
  }
  const { realSetupDeps, runSetup } = await import("../drivers/guidepup/setup.js");
  const deps = realSetupDeps(options);
  return runSetup(options, platformReadiness ? { ...deps, platformReadiness } : deps);
}

/** setup where voicecap has no screen reader to drive (Linux): the preflight says why. */
async function setupWithoutScreenReader(ctx: CliContext, logger: Logger): Promise<number> {
  const { runPreflight } = await import("../readiness/preflight.js");
  const { finishSetup } = await import("../readiness/guided.js");
  const platform = ctx.platformReadiness
    ? await ctx.platformReadiness()
    : await loadPlatform(ctx, logger, "npx @icjia/voicecap setup");
  const notice = renderCheckingNotice(platform.checkingNotice);
  if (notice) logger.info(notice);
  return finishSetup(platform, await runPreflight(platform), { logger, prompter: null });
}

/**
 * The readiness module for ctx.platform, with the project's config and ctx.env, unless `options`
 * gives others (voicecap demo's).
 */
async function loadPlatform(
  ctx: CliContext,
  logger: Logger,
  again: string,
  options: { config?: VoicecapConfig; env?: NodeJS.ProcessEnv } = {},
): Promise<PlatformReadiness> {
  const config = options.config ?? (await loadConfig({ cwd: ctx.cwd })).config;
  const { loadPlatformReadiness } = await import("../drivers/readiness.js");
  return loadPlatformReadiness({
    platform: ctx.platform,
    config,
    logger,
    env: options.env ?? ctx.env,
    cwd: ctx.cwd,
    again,
  });
}

async function runCommand(options: RunOptions, ctx: CliContext, logger: Logger): Promise<number> {
  if (!options.site) {
    throw new UsageError(
      "Missing --site <url>. Run voicecap init to answer a few questions instead, or voicecap --help for usage.",
    );
  }
  checkUrlOptions(options);
  const controller = new AbortController();
  const unhook = ctx.signal ? () => {} : handleInterrupts(controller, logger);
  try {
    const result = await runAudit({
      site: options.site,
      sitemap: options.sitemap ?? null,
      pages: options.pages ?? null,
      ...(options.page.length > 0 ? { pageUrls: options.page } : {}),
      limit: options.limit ?? null,
      include: options.include,
      exclude: options.exclude,
      passes: options.passes ? parsePasses(options.passes) : null,
      maxSteps: options.maxSteps ?? null,
      compare: options.compare ?? null,
      fresh: options.fresh ?? false,
      out: options.out,
      runName: options.runName ?? null,
      reviewer: options.reviewer ?? null,
      replayFrom: options.replayFrom ?? null,
      cwd: ctx.cwd,
      env: ctx.env,
      logger,
      signal: ctx.signal ?? controller.signal,
      ...(ctx.fetch ? { fetch: ctx.fetch } : {}),
      // Only a person at a terminal, reading its output there, is asked: a script or CI never is,
      // and output redirected to a file (voicecap … > log.txt) would take a question no one sees.
      // The output itself decides, not ctx.interactive: init's own run isn't interactive.
      askListener: isTerminalStream(ctx.stdout)
        ? makeAskListener(ctx.stdin, ctx.stdout)
        : undefined,
    });
    return result.exitCode;
  } finally {
    unhook();
  }
}

/** URL-valued arguments can't be Windows paths; if one is, Git Bash rewrote it. */
function checkUrlOptions(options: {
  site?: string;
  sitemap?: string;
  page?: string[];
  include: string[];
  exclude: string[];
}): void {
  if (options.site) assertNotRewritten("--site", options.site);
  if (options.sitemap) assertNotRewritten("--sitemap", options.sitemap);
  for (const page of options.page ?? []) assertNotRewritten("--page", page);
  for (const pattern of options.include) assertNotRewritten("--include", pattern);
  for (const pattern of options.exclude) assertNotRewritten("--exclude", pattern);
}

function parsePasses(list: string): PassName[] {
  const passes = list
    .split(",")
    .map((pass) => pass.trim().toLowerCase())
    .filter((pass) => pass !== "");
  const unknown = passes.filter((pass) => !(PASS_NAMES as readonly string[]).includes(pass));
  if (passes.length === 0 || unknown.length > 0) {
    throw new UsageError(
      `--passes "${list}" isn't valid: use a comma-separated list of ${PASS_NAMES.join(", ")}.`,
    );
  }
  return [...new Set(passes)] as PassName[];
}

function positiveInt(option: string) {
  return (value: string): number => {
    if (!/^\d+$/.test(value.trim()) || Number(value) < 1) {
      throw new InvalidArgumentError(`${option} must be a whole number of at least 1.`);
    }
    return Number(value);
  };
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}
