import path from "node:path";

import { Command, CommanderError, InvalidArgumentError, Option } from "commander";

import { loadConfig } from "../config/load.js";
import { listUrls } from "../list-urls.js";
import { addManualSession } from "../manual-add.js";
import { PASS_NAMES, REVIEW_STATUSES, type PassName, type ReviewStatus } from "../model.js";
import { addReview } from "../reviews/review.js";
import { runAudit } from "../run/audit.js";
import { regenerateLiveReport } from "../run/live-report.js";
import { DEFAULT_OUT_DIR } from "../run/paths.js";
import { handleInterrupts } from "../run/signals.js";
import { ExitCode, UsageError, VoicecapError } from "../util/errors.js";
import { assertNotRewritten } from "../util/git-bash.js";
import { createConsoleLogger, type Logger, type OutputStream } from "../util/log.js";
import { voicecapVersion } from "../util/version.js";

export interface CliContext {
  stdout: OutputStream;
  stderr: OutputStream;
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Tests: interrupt runs with this signal instead of installing Ctrl+C handlers. */
  signal?: AbortSignal;
  /** Tests: replaces fetch for sitemaps. */
  fetch?: typeof fetch;
}

interface RunOptions {
  site?: string;
  sitemap?: string;
  pages?: string;
  limit?: number;
  include: string[];
  exclude: string[];
  passes?: string;
  maxSteps?: number;
  compare?: string;
  fresh?: boolean;
  out: string;
  runName?: string;
  replayFrom?: string;
}

/** Run the voicecap CLI and return its exit code. */
export async function main(argv: string[], context: Partial<CliContext> = {}): Promise<number> {
  const ctx: CliContext = {
    stdout: process.stdout,
    stderr: process.stderr,
    cwd: process.cwd(),
    env: process.env,
    ...context,
  };
  const logger = createConsoleLogger(ctx.stdout, ctx.stderr);
  let exitCode: number = ExitCode.ok;
  const program = buildProgram(ctx, logger, (code) => {
    exitCode = code;
  });
  try {
    await program.parseAsync(argv, { from: "user" });
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
    .option("--out <dir>", "output folder", DEFAULT_OUT_DIR)
    .option("--run-name <name>", "add a name to the run's folder")
    .option("--replay-from <dir>", "replay a run folder instead of running NVDA (replay driver)")
    .addHelpText(
      "after",
      `
Examples:
  npx @icjia/voicecap --site https://example.illinois.gov --pages ./pages.csv
  npx @icjia/voicecap --site https://example.illinois.gov --sitemap https://example.illinois.gov/sitemap.xml
  voicecap review --page /about --status reviewed --note "Reads well"
  voicecap report --compare previous

Exit codes: 0 completed, 1 invalid usage or config, 2 environment unusable,
3 completed but some pages failed, 130 interrupted (state saved).`,
    )
    .action(async (options: RunOptions) => {
      setExit(await runCommand(options, ctx, logger));
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
          output: path.resolve(ctx.cwd, output),
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
    .option("--out <dir>", "output folder", DEFAULT_OUT_DIR)
    .action(
      async (options: {
        page: string;
        status: ReviewStatus;
        note?: string;
        reviewer?: string;
        run?: string;
        out: string;
      }) => {
        await addReview({
          page: options.page,
          status: options.status,
          note: options.note ?? null,
          reviewer: options.reviewer ?? null,
          run: options.run ?? null,
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
    .option("--out <dir>", "output folder", DEFAULT_OUT_DIR)
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
          out: string;
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
    .description("regenerate the live report (<out>/report.html)")
    .option(
      "--run <run-id>",
      "show this run instead of the latest completed one (it may be incomplete)",
    )
    .option("--compare <run>", 'compare with a run id, or "previous"')
    .option("--out <dir>", "output folder", DEFAULT_OUT_DIR)
    .action(async (options: { run?: string; compare?: string; out: string }) => {
      const { config } = await loadConfig({ cwd: ctx.cwd });
      const file = await regenerateLiveReport({
        outDir: path.resolve(ctx.cwd, options.out),
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
    throw new UsageError("Missing --site <url>. Run voicecap --help for usage.");
  }
  checkUrlOptions(options);
  const controller = new AbortController();
  const unhook = ctx.signal ? () => {} : handleInterrupts(controller, logger);
  try {
    const result = await runAudit({
      site: options.site,
      sitemap: options.sitemap ?? null,
      pages: options.pages ?? null,
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
  include: string[];
  exclude: string[];
}): void {
  if (options.site) assertNotRewritten("--site", options.site);
  if (options.sitemap) assertNotRewritten("--sitemap", options.sitemap);
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
