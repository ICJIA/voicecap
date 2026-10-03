/**
 * A site's standing: which of its runs count, and what each page's latest result is. Pure: it
 * works from run records already read, and reads no files.
 */
import type { PageRecord, RunJson } from "../model.js";
import { samePageSource } from "../report/compare.js";

export type LeftOutReason = "replayed" | "interrupted" | "unfinished" | "unsealed";

export interface LeftOutRun {
  run: RunJson;
  reason: LeftOutReason;
  /** Pages it processed (done, failed, or skipped), out of its pages. */
  processed: number;
}

export interface PageStanding {
  key: string;
  slug: string;
  url: string;
  label?: string;
  /** The latest counted run whose record of the page is done: its transcripts are shown. Null: never transcribed. */
  shown: { run: RunJson; page: PageRecord } | null;
  /**
   * The page's newest record, in the latest run or a spot check after it (see Standing.latest), when
   * that record says the page failed or was skipped.
   */
  latestFailure: { run: RunJson; page: PageRecord } | null;
}

export interface Standing {
  /** Completed, sealed, live runs, oldest first. */
  counted: RunJson[];
  /** Every other run, oldest first, with why it doesn't count. */
  leftOut: LeftOutRun[];
  /**
   * The run that decides the pages in scope: the most recent counted run whose pages came from a
   * sitemap, a page list, or a walkthrough. A later run given its pages with --page is a spot
   * check: its records are each page's newest (its transcripts are shown, its failures said), but
   * its pages aren't the list. When every counted run was given its pages with --page, the most
   * recent of them. Null when no run counts.
   */
  latest: RunJson | null;
  /** In the latest run's page order. */
  pages: PageStanding[];
  /**
   * Pages the latest run and the counted runs before it had that the latest run's list doesn't, with
   * their last record. Oldest first: in the order the pages first appeared in those runs. A spot
   * check after the latest run never makes a page no longer listed.
   */
  noLongerListed: { run: RunJson; page: PageRecord }[];
  /**
   * The runs the shown results and failures come from, and the run before the latest, which the
   * page compares the latest with: oldest first, each once. The latest run is always among them.
   */
  drawnOn: RunJson[];
}

/**
 * What a site's runs add up to. A run counts only when it completed, was sealed (so `verify` can
 * check it), and wasn't a replay. The most recent counted run from a sitemap, a page list, or a
 * walkthrough decides which pages are in scope (a later --page run spot-checks some of them), and a
 * page's result is its newest transcription in any counted run.
 */
export function standingOf(runs: RunJson[]): Standing {
  const counted: RunJson[] = [];
  const leftOut: LeftOutRun[] = [];
  for (const run of [...runs].sort(byCreation)) {
    const reason = leftOutReason(run);
    if (reason === null) {
      counted.push(run);
    } else {
      const processed = run.pages.filter((page) => page.status !== "pending").length;
      leftOut.push({ run, reason, processed });
    }
  }

  const latest = scopeRun(counted);
  if (latest === undefined) {
    return { counted, leftOut, latest: null, pages: [], noLongerListed: [], drawnOn: [] };
  }
  // The latest run, then the spot checks after it.
  const at = counted.indexOf(latest);
  const sinceLatest = counted.slice(at);

  // Each counted run's records by page key, so a lookup is one step however big the site is.
  const recordsOf = new Map(counted.map((run) => [run, recordsByKey(run)] as const));
  /** The newest record of a page in `among`, which are oldest first: with a test, the newest that passes it. */
  const newest = (
    among: RunJson[],
    key: string,
    test: (page: PageRecord) => boolean = () => true,
  ): { run: RunJson; page: PageRecord } | null => {
    for (const run of among.toReversed()) {
      const page = recordsOf.get(run)?.get(key);
      if (page !== undefined && test(page)) return { run, page };
    }
    return null;
  };

  const pages = latest.pages.map((page): PageStanding => {
    const record = newest(sinceLatest, page.key) ?? { run: latest, page };
    const { status } = record.page;
    return {
      key: page.key,
      slug: page.slug,
      url: page.url,
      ...(page.label === undefined ? {} : { label: page.label }),
      shown: newest(counted, page.key, (each) => each.status === "done"),
      latestFailure: status === "failed" || status === "skipped" ? record : null,
    };
  });

  const listed = new Set(latest.pages.map((page) => page.key));
  // Going oldest to newest, a later record replaces an earlier one but the page keeps its place. A
  // spot check after the latest run lists only the pages it checked, so it says nothing of the
  // list.
  const gone = new Map<string, { run: RunJson; page: PageRecord }>();
  for (const run of counted.slice(0, at + 1)) {
    for (const page of run.pages) {
      if (!listed.has(page.key)) gone.set(page.key, { run, page });
    }
  }

  const drawn = new Set<RunJson>([latest]);
  const before = runBefore(counted, latest);
  if (before) drawn.add(before);
  for (const { shown, latestFailure } of pages) {
    if (shown) drawn.add(shown.run);
    if (latestFailure) drawn.add(latestFailure.run);
  }

  return {
    counted,
    leftOut,
    latest,
    pages,
    noLongerListed: [...gone.values()],
    drawnOn: counted.filter((run) => drawn.has(run)),
  };
}

/**
 * The most recent counted run created before `latest` with the same page source, as
 * `--compare previous` picks it (see resolveCompareBase). Null when there is none.
 */
export function runBefore(counted: RunJson[], latest: RunJson): RunJson | null {
  const created = Date.parse(latest.createdAt);
  const earlier = counted.filter(
    (other) =>
      other.id !== latest.id &&
      // Same-second ties still count: a counted run that isn't `latest` started first.
      Date.parse(other.createdAt) <= created &&
      samePageSource(other, latest),
  );
  return earlier.sort(byCreation).at(-1) ?? null;
}

/**
 * The run that decides the pages in scope: the most recent of the counted runs (oldest first) whose
 * pages came from a sitemap, a page list, or a walkthrough, else the most recent. A run given its
 * pages with --page checks only those, so it doesn't say which pages are on the list.
 */
function scopeRun(counted: RunJson[]): RunJson | undefined {
  return counted.findLast((run) => run.settings.source.kind !== "urls") ?? counted.at(-1);
}

function leftOutReason(run: RunJson): LeftOutReason | null {
  if (run.replayed) return "replayed";
  if (run.status === "incomplete") {
    return run.sessions.at(-1)?.endReason === "interrupted" ? "interrupted" : "unfinished";
  }
  return run.seal === undefined ? "unsealed" : null;
}

/** Oldest first, as listRuns orders runs: by when each was created, then by id. */
function byCreation(a: RunJson, b: RunJson): number {
  return Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id);
}

function recordsByKey(run: RunJson): Map<string, PageRecord> {
  return new Map(run.pages.map((page): [string, PageRecord] => [page.key, page]));
}
