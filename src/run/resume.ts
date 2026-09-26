import { isDeepStrictEqual } from "node:util";

import type { RunJson, RunSettings } from "../model.js";
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
 * Choose whether to resume. Candidates are incomplete runs whose settings hash matches and that
 * no later completed run with the same settings has superseded; the most recent one wins.
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
        other.settingsHash === run.settingsHash &&
        created(other) > created(run),
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
    differences.push(`${key}: ${show(before[key])} → ${show(after[key])}`);
  }
  return differences;
}

function show(value: unknown): string {
  if (value === null || value === undefined) return "none";
  if (Array.isArray(value)) return value.length === 0 ? "none" : value.join(",");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.kind === "sitemap") return `sitemap ${String(record.url)}`;
    if (record.kind === "pages") {
      return `page list ${String(record.file)} (sha256 ${String(record.sha256).slice(0, 12)}…)`;
    }
    return JSON.stringify(value);
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}
