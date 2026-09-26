import path from "node:path";

import { loadConfig, type LoadedConfig } from "./config/load.js";
import { importManualSession } from "./manual/import.js";
import type { ManualSessionJson } from "./model.js";
import { resolvePageArgument } from "./pages/page-argument.js";
import { resolveReviewer } from "./reviews/reviewer.js";
import { regenerateLiveReport } from "./run/live-report.js";
import { DEFAULT_OUT_DIR } from "./run/paths.js";
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
  out?: string;
  cwd?: string;
  config?: LoadedConfig;
  logger?: Logger;
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

/** Import a hands-on NVDA session into transcripts/manual/<page-slug>/. */
export async function addManualSession(
  options: AddManualSessionOptions,
): Promise<AddManualSessionResult> {
  const cwd = options.cwd ?? process.cwd();
  const logger = options.logger ?? createConsoleLogger();
  const outDir = path.resolve(cwd, options.out ?? DEFAULT_OUT_DIR);
  const { config } = options.config ?? (await loadConfig({ cwd }));
  const page = await resolvePageArgument(options.page, outDir);
  const reviewer = resolveReviewer({
    option: options.reviewer,
    ...(options.env ? { env: options.env } : {}),
    configReviewer: config.reviewer,
    cwd,
  });
  const result = await importManualSession({
    outDir,
    file: path.resolve(cwd, options.file),
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
