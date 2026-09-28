import { existsSync } from "node:fs";
import os from "node:os";

import { Command, CommanderError, InvalidArgumentError, Option } from "commander";

import { loadConfig } from "../config/load.js";
import { createPrompter, InputEndedError } from "../init/prompt.js";
import { checkReadiness, type Readiness } from "../init/readiness.js";
import { runWizard } from "../init/wizard.js";
import { listUrls } from "../list-urls.js";
import { addManualSession } from "../manual-add.js";
import { PASS_NAMES, REVIEW_STATUSES, type PassName, type ReviewStatus } from "../model.js";
import { InterruptedError } from "../passes/steps.js";
import { addReview } from "../reviews/review.js";
import { runAudit } from "../run/audit.js";
import { regenerateLiveReport } from "../run/live-report.js";
import { resolveHome } from "../run/paths.js";
import { handleInterrupts } from "../run/signals.js";
import { chooseSiteDir } from "../run/site-dir.js";
import { ExitCode, UsageError, VoicecapError } from "../util/errors.js";
import { assertNotRewritten } from "../util/git-bash.js";
import { createConsoleLogger, type Logger, type OutputStream } from "../util/log.js";
import { voicecapVersion } from "../util/version.js";
import { verifyHome } from "../verify.js";

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
  /** Tests: replaces init's "can this computer run the composed command" check. */
  readiness?: () => Readiness;
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
      "Drive NVDA through a site's pages, save what it says as reviewable transcripts, and report automated coverage and human review.",
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
    .option("--sitemap <url>", "take pages from this sitemap (<urlset> or <sitemapindex>)")
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
    .option("--replay-from <dir>", "replay a run folder instead of running NVDA (replay driver)")
    .addHelpText(
      "after",
      `
Examples:
  npx @icjia/voicecap init
  npx @icjia/voicecap --site https://dvfr.illinois.gov --pages ./pages.csv
  npx @icjia/voicecap --site https://dvfr.illinois.gov --sitemap https://dvfr.illinois.gov/sitemap.xml
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
      const prompter = createPrompter({
        input: ctx.stdin,
        output: ctx.stdout,
        terminal: isTerminalStream(ctx.stdin),
      });
      try {
        const result = await runWizard({
          prompter,
          fetch: ctx.fetch ?? fetch,
          cwd: ctx.cwd,
          env: ctx.env,
          now: () => new Date(),
          readiness:
            ctx.readiness ??
            (() =>
              checkReadiness({
                platform: process.platform,
                env: ctx.env,
                homedir: os.homedir(),
                exists: existsSync,
              })),
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
    .command("list-urls")
    .description("export a sitemap as a page list, or draft a sample to curate")
    .argument("<output>", "the file to write: .csv or .json")
    .requiredOption("--site <url>", "the site's URL")
    .requiredOption("--sitemap <url>", "the sitemap to read")
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
    .description("regenerate a site's live report (<out>/<site>/report.html)")
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
      const file = await regenerateLiveReport({
        outDir,
        config,
        logger,
        runId: options.run ?? null,
        compare: options.compare ?? null,
        requireRun: true,
      });
      logger.info(`Report: ${file ?? "(none)"}`);
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
    .description("Windows: install the NVDA build that voicecap's pinned Guidepup expects")
    .action(async () => {
      const { config } = await loadConfig({ cwd: ctx.cwd });
      const { runSetup } = await import("../drivers/guidepup/setup.js");
      await runSetup({ config, logger });
      setExit(ExitCode.ok);
    });

  program
    .command("doctor")
    .description("check the environment and print a summary to paste into a bug report")
    .action(async () => {
      const { config } = await loadConfig({ cwd: ctx.cwd });
      const { runDoctor } = await import("../drivers/guidepup/doctor.js");
      // Ctrl+C stops the live check and shuts NVDA and the browser down, as in a run.
      const controller = new AbortController();
      const unhook = ctx.signal ? () => {} : handleInterrupts(controller, logger);
      try {
        setExit(await runDoctor({ config, logger, signal: ctx.signal ?? controller.signal }));
      } finally {
        unhook();
      }
    });

  return program;
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
      replayFrom: options.replayFrom ?? null,
      cwd: ctx.cwd,
      env: ctx.env,
      logger,
      signal: ctx.signal ?? controller.signal,
      ...(ctx.fetch ? { fetch: ctx.fetch } : {}),
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

/** Whether `stream` is a real terminal (a TTY), as `NodeJS.ReadStream` marks one. */
function isTerminalStream(stream: NodeJS.ReadableStream): boolean {
  return (stream as { isTTY?: boolean }).isTTY === true;
}
