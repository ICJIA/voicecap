import path from "node:path";

/**
 * The transcripts home: `.gitattributes` and `.gitignore` at its top (written once, by
 * ./git-files.js), then one folder per site (siteFolder, below):
 *
 *   report.html  latest.txt  reviews.json  .voicecap.lock (only while a run writes here)
 *   <date>/<time>/run.json  <date>/<time>/report.html  <date>/<time>/pages/<slug>/<pass>.{txt,json}
 *   <date>/<time>/attempts/<slug>/<n>/<pass>.{txt,json}     (an earlier attempt, kept, n = 1, 2, ...)
 *   <date>/<time>/compare/<base-id>/<slug>/<pass>.diff.txt   (diffs made when the run completed)
 *   <date>/<time>_manual_<slug>/session.{txt,json}  <date>/<time>_manual_<slug>/raw/<format>.txt
 *   compare/<base-id>__<run-id>/<slug>/<pass>.diff.txt        (diffs made by `voicecap report`)
 *
 * voicecap 0.2.0's layout (<home>/runs/..., <home>/manual/...) is left where it is and never read.
 */
export const DEFAULT_OUT_DIR = "transcripts";

/**
 * A run's folder: its date, then the rest of its id (the time, and any run name or "-n"
 * disambiguator), e.g. run id 2026-09-27_1102 -> <siteDir>/2026-09-27/1102.
 */
export function runDir(siteDir: string, runId: string): string {
  return path.join(siteDir, runId.slice(0, 10), runId.slice(11));
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

/** A path relative to `fromDir`, with forward slashes, for use in links. */
export function linkPath(fromDir: string, target: string): string {
  return path.relative(fromDir, target).split(path.sep).join("/");
}

/**
 * The folder for a site: its host (already lowercased by URL parsing), with anything outside
 * a-z 0-9 . - replaced by "_".
 */
export function siteFolder(site: string | URL): string {
  const url = typeof site === "string" ? new URL(site) : site;
  return url.host.replace(/[^a-z0-9.-]/g, "_");
}

/**
 * The audit home: `--out` if given, else `VOICECAP_TRANSCRIPTS` (ignored if blank), else
 * `DEFAULT_OUT_DIR`, resolved against `cwd`. `VOICECAP_TRANSCRIPTS` is read from `env` only, so
 * pass `process.env` to honor it.
 */
export function resolveHome(options: {
  out?: string | null;
  env?: NodeJS.ProcessEnv;
  cwd: string;
}): string {
  const fromEnv = options.env?.VOICECAP_TRANSCRIPTS?.trim();
  return path.resolve(options.cwd, options.out ?? (fromEnv ? fromEnv : DEFAULT_OUT_DIR));
}

/** A site's folder under the home. */
export function siteDirFor(home: string, site: string | URL): string {
  return path.join(home, siteFolder(site));
}

/** A dated folder's name, e.g. 2026-09-27. */
export const DATE_FOLDER = /^\d{4}-\d{2}-\d{2}$/;

/** A page's earlier attempts, kept aside from the current one in `pageDir`. */
export function attemptsDir(siteDir: string, runId: string, slug: string): string {
  return path.join(runDir(siteDir, runId), "attempts", slug);
}

/**
 * A hands-on session's folder: its date, then time, "_manual_", and the page's slug, with any
 * "-n" disambiguator (a second session started in the same minute) moved after the slug.
 */
export function manualSessionDir(siteDir: string, sessionId: string, slug: string): string {
  const date = sessionId.slice(0, 10);
  const time = sessionId.slice(11, 15);
  const suffix = sessionId.slice(15);
  return path.join(siteDir, date, `${time}_manual_${slug}${suffix}`);
}
