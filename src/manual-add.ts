import { loadConfig, type LoadedConfig } from "./config/load.js";
import { importManualSession } from "./manual/import.js";
import type { ManualSessionJson } from "./model.js";
import { resolvePageArgument } from "./pages/page-argument.js";
import { resolveReviewer } from "./reviews/reviewer.js";
import { ensureGitFiles } from "./run/git-files.js";
import { regenerateLiveReport } from "./run/live-report.js";
import { resolveHome } from "./run/paths.js";
import { chooseSiteDir } from "./run/site-dir.js";
import { resolveUserPath } from "./util/git-bash.js";
import { createConsoleLogger, type Logger } from "./util/log.js";

export interface AddManualSessionOptions {
  /** A Speech Viewer copy or an NVDA log (detected automatically). */
  file: string;
  /** Full URL or root-relative path of the page the session tested. */
  page: string;
  /** Logs only: import from / to this time of day (HH:MM or HH:MM:SS). */
  from?: string | null;
  to?: string | null;
  /** The session's date, YYYY-MM-DD. Default: the file's modification date. */
  date?: string | null;
  redactTyping?: boolean;
  keepRaw?: boolean;
  /** Keep the original's hash but not a copy of it. */
  noRaw?: boolean;
  reviewer?: string | null;
  /**
   * The site's URL: a path page resolves against it, and a full URL must be on it. Or the site's
   * canonical address (see chooseSiteDir), whose pages are on the address its runs read. Default:
   * the page's site when it's a full URL, else the home's only site.
   */
  site?: string | null;
  /** The transcripts home. Default: VOICECAP_TRANSCRIPTS, else "transcripts". */
  out?: string;
  cwd?: string;
  config?: LoadedConfig;
  logger?: Logger;
  /** Where VOICECAP_TRANSCRIPTS and VOICECAP_REVIEWER are read from. Default: process.env. */
  env?: NodeJS.ProcessEnv;
  now?: Date;
  /** Regenerate the live report afterwards. Default true. */
  regenerateReport?: boolean;
}

export interface AddManualSessionResult {
  session: ManualSessionJson;
  files: { json: string; txt: string; raw: string | null };
  reportFile: string | null;
}

/** Import a hands-on NVDA session into its site's folder, under <date>/<time>_manual_<slug>/. */
export async function addManualSession(
  options: AddManualSessionOptions,
): Promise<AddManualSessionResult> {
  const cwd = options.cwd ?? process.cwd();
  const logger = options.logger ?? createConsoleLogger();
  const env = options.env ?? process.env;
  const home = resolveHome({ out: options.out, env, cwd });
  const outDir = await chooseSiteDir({ home, site: options.site, page: options.page });
  const { config } = options.config ?? (await loadConfig({ cwd }));
  const page = await resolvePageArgument(options.page, outDir, options.site);
  const reviewer = resolveReviewer({
    option: options.reviewer,
    env,
    configReviewer: config.reviewer,
    cwd,
  });
  // Before the import can write anything, so a raw NVDA log never lands here before .gitignore
  // exists to keep it out of Git. A failed import may leave just these two files; that's harmless.
  await ensureGitFiles(home);
  const result = await importManualSession({
    outDir,
    file: resolveUserPath(cwd, options.file),
    page,
    reviewer: reviewer.name,
    config,
    logger,
    ...(options.from ? { from: options.from } : {}),
    ...(options.to ? { to: options.to } : {}),
    ...(options.date ? { date: options.date } : {}),
    ...(options.redactTyping ? { redactTyping: true } : {}),
    ...(options.keepRaw ? { keepRaw: true } : {}),
    ...(options.noRaw ? { noRaw: true } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  const reportFile =
    options.regenerateReport === false
      ? null
      : await regenerateLiveReport({ outDir, config, logger });
  return { ...result, reportFile };
}
