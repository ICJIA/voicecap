import path from "node:path";

import { loadConfig, type LoadedConfig } from "../config/load.js";
import { REVIEW_STATUSES, type ReviewEntry, type ReviewStatus, type RunJson } from "../model.js";
import { resolvePageArgument } from "../pages/page-argument.js";
import { regenerateLiveReport } from "../run/live-report.js";
import { DEFAULT_OUT_DIR } from "../run/paths.js";
import { listRuns, readRunJson } from "../run/store.js";
import { UsageError } from "../util/errors.js";
import { createConsoleLogger, type Logger } from "../util/log.js";
import { isoLocal } from "../util/time.js";
import { resolveReviewer } from "./reviewer.js";
import { appendReview } from "./store.js";

export interface AddReviewOptions {
  /** Full URL or root-relative path. */
  page: string;
  status: ReviewStatus;
  note?: string | null;
  /** Default: VOICECAP_REVIEWER, then git config user.name, then the config's reviewer. */
  reviewer?: string | null;
  /** The run reviewed. Default: the latest run with transcripts for the page. */
  run?: string | null;
  out?: string;
  cwd?: string;
  config?: LoadedConfig;
  logger?: Logger;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  /** Regenerate the live report afterwards. Default true. */
  regenerateReport?: boolean;
}

export interface AddReviewResult {
  key: string;
  entry: ReviewEntry;
  /** The page's full history, oldest first, including the new entry. */
  history: ReviewEntry[];
  reportFile: string | null;
}

/** Append a review decision to a page's history (never editing earlier entries). */
export async function addReview(options: AddReviewOptions): Promise<AddReviewResult> {
  const cwd = options.cwd ?? process.cwd();
  const logger = options.logger ?? createConsoleLogger();
  if (!(REVIEW_STATUSES as readonly string[]).includes(options.status)) {
    throw new UsageError(
      `--status must be one of ${REVIEW_STATUSES.join(", ")} (got "${String(options.status)}").`,
    );
  }
  const outDir = path.resolve(cwd, options.out ?? DEFAULT_OUT_DIR);
  const { config } = options.config ?? (await loadConfig({ cwd }));
  const page = await resolvePageArgument(options.page, outDir);
  const reviewer = resolveReviewer({
    option: options.reviewer,
    ...(options.env ? { env: options.env } : {}),
    configReviewer: config.reviewer,
    cwd,
  });

  const run = options.run
    ? await readRunJson(outDir, options.run)
    : await latestRunWith(outDir, page.key);
  const record = run?.pages.find((p) => p.key === page.key && p.status === "done");
  if (!run || !record) {
    throw new UsageError(
      options.run
        ? `Run ${options.run} has no transcripts for ${page.url}.`
        : `No run has transcripts for ${page.url} yet. Check the URL, or pass --run <run-id>.`,
    );
  }

  const entry: ReviewEntry = {
    status: options.status,
    reviewer: reviewer.name,
    at: isoLocal(options.now ?? new Date()),
    note: options.note?.trim() || null,
    run: run.id,
    url: record.url,
    files: Object.fromEntries(
      Object.entries(record.files).map(([file, hash]) => [file, hash.sha256]),
    ),
    content: Object.fromEntries(
      Object.entries(record.passes).map(([pass, summary]) => [pass, summary.contentSha256]),
    ),
  };
  const reviews = await appendReview(outDir, page.key, entry);
  const history = reviews.pages[page.key] ?? [entry];
  logger.info(
    `Recorded "${entry.status}" for ${record.url} by ${reviewer.name} against run ${run.id} (${history.length} review ${history.length === 1 ? "entry" : "entries"} for this page).`,
  );

  const reportFile =
    options.regenerateReport === false
      ? null
      : await regenerateLiveReport({ outDir, config, logger });
  return { key: page.key, entry, history, reportFile };
}

/** The most recent run (complete or not) with transcripts for the page. */
async function latestRunWith(outDir: string, key: string): Promise<RunJson | null> {
  const runs = await listRuns(outDir);
  for (const run of runs.reverse()) {
    if (run.pages.some((page) => page.key === key && page.status === "done")) return run;
  }
  return null;
}
