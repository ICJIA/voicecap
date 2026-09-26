import path from "node:path";

/**
 * The transcripts/ layout:
 *
 *   report.html  latest.txt  reviews.json  .gitattributes
 *   runs/<run-id>/run.json  runs/<run-id>/report.html  runs/<run-id>/pages/<slug>/<pass>.{txt,json}
 *   runs/<run-id>/compare/<base-id>/<slug>/<pass>.diff.txt   (diffs made when the run completed)
 *   manual/<slug>/<session>.{txt,json}  manual/<slug>/raw/<session>.<format>.txt
 *   compare/<base-id>__<run-id>/<slug>/<pass>.diff.txt        (diffs made by `voicecap report`)
 */
export const DEFAULT_OUT_DIR = "transcripts";

export function runsDir(outDir: string): string {
  return path.join(outDir, "runs");
}

export function runDir(outDir: string, runId: string): string {
  return path.join(outDir, "runs", runId);
}

export function runJsonPath(outDir: string, runId: string): string {
  return path.join(runDir(outDir, runId), "run.json");
}

export function runReportPath(outDir: string, runId: string): string {
  return path.join(runDir(outDir, runId), "report.html");
}

export function pageDir(outDir: string, runId: string, slug: string): string {
  return path.join(runDir(outDir, runId), "pages", slug);
}

/** Diffs written into a run folder when the run completes with --compare. */
export function runCompareDir(outDir: string, runId: string, baseRunId: string): string {
  return path.join(runDir(outDir, runId), "compare", baseRunId);
}

/** Diffs written by `voicecap report --compare` (derived data, regenerated each time). */
export function liveCompareDir(outDir: string, baseRunId: string, runId: string): string {
  return path.join(outDir, "compare", `${baseRunId}__${runId}`);
}

export function liveReportPath(outDir: string): string {
  return path.join(outDir, "report.html");
}

export function latestPath(outDir: string): string {
  return path.join(outDir, "latest.txt");
}

export function reviewsPath(outDir: string): string {
  return path.join(outDir, "reviews.json");
}

export function manualRoot(outDir: string): string {
  return path.join(outDir, "manual");
}

export function manualPageDir(outDir: string, slug: string): string {
  return path.join(outDir, "manual", slug);
}

/** A path relative to `fromDir`, with forward slashes, for use in links. */
export function linkPath(fromDir: string, target: string): string {
  return path.relative(fromDir, target).split(path.sep).join("/");
}
