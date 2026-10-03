import type { VoicecapConfig } from "../config/schema.js";
import type { RunJson } from "../model.js";
import { generateReport, resolveCompareBase } from "../report/index.js";
import { writeShareFiles } from "../share/write.js";
import { errorMessage, UsageError } from "../util/errors.js";
import type { Logger } from "../util/log.js";
import { withCurrentFlags } from "./flags.js";
import { liveCompareDir } from "./paths.js";
import { readLatestRunId, readRunJson } from "./store.js";

export interface LiveReportOptions {
  /** The site's folder in the transcripts home, not the home itself (see siteDirFor). */
  outDir: string;
  config: VoicecapConfig;
  logger: Logger;
  /** Show this run instead of the latest completed one (it may be incomplete). */
  runId?: string | null;
  /** Compare with this run id, or "previous". Default: the comparison the run was made with. */
  compare?: string | null;
  /** Throw instead of skipping when there's no completed run yet. */
  requireRun?: boolean;
}

/** The live files a site folder keeps: its report, its shareable page, and the page's Word copy. */
export interface LiveFiles {
  /** The site's report.html. */
  report: string;
  /** The site's share/current.html; null when it couldn't be written, which was said as a warning. */
  share: string | null;
  /** The site's share/current.docx, the page's Word copy; null likewise. */
  word: string | null;
}

/**
 * Regenerate a site folder's live report.html: the latest completed run (or --run) plus the
 * current review history and manual sessions. `review`, `manual add`, and `voicecap report` call
 * this. Returns the report's path, or null when there's no run to show yet. The site's shareable
 * page and its Word copy are rewritten too (see regenerateLiveFiles).
 */
export async function regenerateLiveReport(options: LiveReportOptions): Promise<string | null> {
  return (await regenerateLiveFiles(options))?.report ?? null;
}

/**
 * Regenerate a site folder's live report.html, then its shareable page, share/current.html, and the
 * page's Word copy, share/current.docx: they show the site's whole standing, whichever run the
 * report shows. Returns the three paths, or null when there's no run to show yet. A file that can't
 * be written is a warning (the report is done, and so is whatever asked for it), and its path is
 * null; the other is written all the same.
 */
export async function regenerateLiveFiles(options: LiveReportOptions): Promise<LiveFiles | null> {
  const { outDir, config, logger } = options;
  const runId = options.runId ?? (await readLatestRunId(outDir));
  if (!runId) {
    if (options.requireRun) {
      throw new UsageError(
        `There's no completed run in ${outDir} yet, so there's nothing to report.`,
      );
    }
    logger.info("No completed run yet, so the report wasn't updated.");
    return null;
  }
  const run = await readRunJson(outDir, runId);
  const base = await compareBase(outDir, run, options.compare ?? null, logger);
  const { file } = await generateReport({
    outDir,
    run: await withCurrentFlags(outDir, run, config.flags),
    target: "live",
    config,
    compare: base ? { base, diffDir: liveCompareDir(outDir, base.id, run.id) } : null,
  });
  const shared = await writeShareFiles({ siteDir: outDir, config, logger });
  return { report: file, share: shared?.page ?? null, word: shared?.word ?? null };
}

async function compareBase(
  outDir: string,
  run: RunJson,
  spec: string | null,
  logger: Logger,
): Promise<RunJson | null> {
  if (spec) return resolveCompareBase(outDir, run, spec);
  if (!run.compareTo) return null;
  try {
    return await readRunJson(outDir, run.compareTo);
  } catch (error) {
    logger.warn(`Couldn't load run ${run.compareTo} to compare with: ${errorMessage(error)}`);
    return null;
  }
}
