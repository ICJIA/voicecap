import type { VoicecapConfig } from "../config/schema.js";
import type { RunJson } from "../model.js";
import { generateReport, resolveCompareBase } from "../report/index.js";
import { errorMessage, UsageError } from "../util/errors.js";
import type { Logger } from "../util/log.js";
import { withCurrentFlags } from "./flags.js";
import { liveCompareDir } from "./paths.js";
import { readLatestRunId, readRunJson } from "./store.js";

export interface LiveReportOptions {
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

/**
 * Regenerate transcripts/report.html: the latest completed run (or --run) plus the current
 * review history and manual sessions. `review`, `manual add`, and `voicecap report` call this.
 * Returns the report's path, or null when there's no run to show yet.
 */
export async function regenerateLiveReport(options: LiveReportOptions): Promise<string | null> {
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
  return file;
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
