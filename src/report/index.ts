import { existsSync } from "node:fs";
import path from "node:path";

import type { VoicecapConfig } from "../config/schema.js";
import { listManualSessions } from "../manual/list.js";
import type { RunJson } from "../model.js";
import { readReviews } from "../reviews/store.js";
import { liveReportPath, runReportPath } from "../run/paths.js";
import { assertRunWritable } from "../run/store.js";
import { writeFileAtomic } from "../util/atomic-write.js";
import { isoLocal } from "../util/time.js";
import { voicecapVersion } from "../util/version.js";
import { compareRuns, type CompareResult } from "./compare.js";
import { buildReportModel } from "./model.js";
import { renderReport } from "./render.js";

export {
  compareRuns,
  describeChanges,
  distinctEnvironments,
  environmentDifferences,
  resolveCompareBase,
} from "./compare.js";
export type { ChangedPage, ComparedPass, CompareResult, NotComparedPage } from "./compare.js";
export { buildReportModel, pageName } from "./model.js";
export type { ReportInput, ReportModel, ReportRow, ReportSummary } from "./model.js";
export { renderReport } from "./render.js";

export interface GenerateReportOptions {
  /** The site's folder in the transcripts home. */
  outDir: string;
  /** The run to show, in memory; it may be incomplete. */
  run: RunJson;
  /**
   * "live" writes <outDir>/report.html (latest run plus current reviews and manual sessions).
   * "snapshot" writes <outDir>/<date>/<rest>/report.html; the caller does this just before
   * writing the completed run.json, which closes the run's folder.
   */
  target: "live" | "snapshot";
  config: VoicecapConfig;
  /** Compare with an earlier run, writing text diffs of changed pages into diffDir. */
  compare?: { base: RunJson; diffDir: string } | null;
  now?: Date;
}

/**
 * Write the HTML report: one self-contained, accessible file. Reviews and manual sessions are read
 * from the site's folder; flags are taken from the run's page records as given.
 */
export async function generateReport(
  options: GenerateReportOptions,
): Promise<{ file: string; compare: CompareResult | null }> {
  const { outDir, run, target, config } = options;
  const file = target === "snapshot" ? runReportPath(outDir, run.id) : liveReportPath(outDir);
  if (target === "snapshot") await assertRunWritable(outDir, run.id);

  const [reviews, manual] = await Promise.all([readReviews(outDir), listManualSessions(outDir)]);
  const compare = options.compare
    ? await compareRuns({
        outDir,
        base: options.compare.base,
        run,
        diffDir: options.compare.diffDir,
      })
    : null;
  const model = buildReportModel({
    run,
    target,
    reviews,
    manual,
    compare,
    branding: config.report,
    generatedAt: isoLocal(options.now ?? new Date()),
    voicecapVersion: voicecapVersion(),
  });
  const html = renderReport(model, {
    outDir,
    baseDir: path.dirname(file),
    snapshotExists: target === "live" && existsSync(runReportPath(outDir, run.id)),
  });
  await writeFileAtomic(file, html);
  return { file, compare };
}
