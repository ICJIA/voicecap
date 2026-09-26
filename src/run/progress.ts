import type { PassName, StopReason } from "../model.js";
import { stopReasonText } from "../transcripts/format.js";
import { formatDuration } from "../util/time.js";

export interface PassProgress {
  steps: number;
  stopReason: StopReason;
  /** Headings found (headings pass) or focus stops (tab pass). */
  items: number;
}

export interface ProgressInfo {
  index: number;
  total: number;
  path: string;
  outcome:
    | { kind: "done"; passes: Partial<Record<PassName, PassProgress>> }
    | { kind: "failed"; error: string; passes: Partial<Record<PassName, PassProgress>> }
    | { kind: "skipped"; reason: string };
  durationMs: number;
  /** Estimated time left, or null before there's anything to estimate from. */
  remainingMs: number | null;
}

/** The pass's natural end, which the progress line doesn't bother to mention. */
const NATURAL_END: Record<PassName, StopReason> = {
  read: "end-reached",
  headings: "no-next-heading",
  tab: "left-document",
};

/**
 * One console line per page, e.g.
 * [27/100] /grants/fy27-jag — read: 212 steps (end reached), headings: 9, tab: 34 — 5m 48s — about 7h 10m left
 */
export function progressLine(info: ProgressInfo): string {
  const parts = [`[${info.index}/${info.total}] ${info.path}`];
  const { outcome } = info;
  if (outcome.kind === "skipped") {
    parts.push(`skipped: ${outcome.reason}`);
  } else {
    const passes = describePasses(outcome.passes);
    if (outcome.kind === "failed")
      parts.push(`FAILED: ${outcome.error}${passes ? ` (${passes})` : ""}`);
    else parts.push(passes);
    parts.push(formatDuration(info.durationMs));
  }
  if (info.remainingMs !== null && info.index < info.total) {
    parts.push(`about ${formatDuration(info.remainingMs)} left`);
  }
  return parts.join(" — ");
}

function describePasses(passes: Partial<Record<PassName, PassProgress>>): string {
  const described: string[] = [];
  for (const pass of ["read", "headings", "tab"] as const) {
    const progress = passes[pass];
    if (!progress) continue;
    const natural = progress.stopReason === NATURAL_END[pass];
    if (pass === "read") {
      described.push(`read: ${progress.steps} steps (${stopReasonText(progress.stopReason)})`);
    } else {
      described.push(
        `${pass}: ${progress.items}${natural ? "" : ` (${stopReasonText(progress.stopReason)})`}`,
      );
    }
  }
  return described.join(", ");
}

/** Estimate the time left from the average time per page so far. */
export function estimateRemaining(
  durationsMs: readonly number[],
  remainingPages: number,
): number | null {
  if (durationsMs.length === 0 || remainingPages <= 0) return null;
  const average = durationsMs.reduce((sum, ms) => sum + ms, 0) / durationsMs.length;
  return average * remainingPages;
}
