import { isDeepStrictEqual } from "node:util";

import type { PageSource, RunJson, RunSettings } from "../model.js";
import { describePageUrls } from "../pages/describe.js";
import { hashJson } from "../util/hash.js";

export function settingsHash(settings: RunSettings): string {
  return hashJson(settings);
}

export interface ResumeDecision {
  /** The run to resume, or null to start a new one. */
  resume: RunJson | null;
  /** What to tell the user, if anything. */
  message: string | null;
}

/**
 * Whether `run` was made before voicecap recorded the readiness settings, with the settings
 * `other` has in everything else: its hash is the one voicecap gave such settings then, which
 * leaves readiness out (hashJson drops an undefined value).
 */
function sameBeforeReadiness(run: RunJson, other: RunJson): boolean {
  return (
    run.settings.readiness === undefined &&
    run.settingsHash === settingsHash({ ...other.settings, readiness: undefined })
  );
}

/**
 * Choose whether to resume. Candidates are incomplete runs whose settings hash matches and that
 * no later completed run with the same settings has superseded; the most recent one wins. A run
 * from before the readiness settings were recorded can't match, as every run since records them:
 * a later completed run that differs from it in nothing but them supersedes it instead.
 * Otherwise a new run starts, and the message says why the latest incomplete run wasn't resumed.
 */
export function chooseRun(
  runs: readonly RunJson[],
  settings: RunSettings,
  fresh: boolean,
): ResumeDecision {
  const hash = settingsHash(settings);
  const created = (run: RunJson) => Date.parse(run.createdAt);
  const superseded = (run: RunJson) =>
    runs.some(
      (other) =>
        other.status === "completed" &&
        created(other) > created(run) &&
        (other.settingsHash === run.settingsHash || sameBeforeReadiness(run, other)),
    );
  const incomplete = runs
    .filter((run) => run.status !== "completed" && !superseded(run))
    .sort((a, b) => created(b) - created(a) || b.id.localeCompare(a.id));
  const matching = incomplete.filter((run) => run.settingsHash === hash);

  if (fresh) {
    const skipped = matching[0];
    return {
      resume: null,
      message: skipped
        ? `--fresh: starting a new run. The incomplete run ${skipped.id} is left as it is.`
        : null,
    };
  }
  const candidate = matching[0];
  if (candidate) {
    const done = candidate.pages.filter((p) => p.status === "done" || p.status === "skipped");
    return {
      resume: candidate,
      message: `Resuming ${candidate.id}: ${done.length} of ${candidate.pages.length} pages already done.`,
    };
  }
  const latest = incomplete[0];
  if (latest) {
    const differences = describeDifferences(latest.settings, settings);
    return {
      resume: null,
      message: `Starting a new run. Not resuming ${latest.id} because its settings differ: ${differences.join("; ") || "settings changed"}.`,
    };
  }
  return { resume: null, message: null };
}

/** Human-readable differences between two runs' settings, e.g. "passes: read,tab → read". */
export function describeDifferences(before: RunSettings, after: RunSettings): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)] as (keyof RunSettings)[]);
  const differences: string[] = [];
  for (const key of keys) {
    if (isDeepStrictEqual(before[key], after[key])) continue;
    differences.push(`${key}: ${show(key, before[key])} → ${show(key, after[key])}`);
  }
  return differences;
}

/** One setting's value, in words; `key` is the setting it belongs to. */
function show(key: keyof RunSettings, value: unknown): string {
  if (value === undefined) return "not recorded";
  if (value === null) return "none";
  if (Array.isArray(value)) return value.length === 0 ? "none" : value.join(",");
  if (key === "source") return showSource(value as PageSource);
  if (typeof value === "object") return JSON.stringify(value);
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** A page source, in words: a page list or a walkthrough with the start of its SHA-256. */
function showSource(source: PageSource): string {
  switch (source.kind) {
    case "sitemap":
      return `sitemap ${source.url}`;
    case "pages":
      return `page list ${source.file} (sha256 ${source.sha256.slice(0, 12)}…)`;
    case "walkthrough":
      return `walkthrough of run ${source.run} (${source.file}) (sha256 ${source.sha256.slice(0, 12)}…)`;
    case "urls":
      return describePageUrls(source.urls);
    default: {
      const _exhaustive: never = source;
      return JSON.stringify(_exhaustive);
    }
  }
}
