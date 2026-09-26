import type { VoicecapConfig } from "../config/schema.js";
import type { ManualSessionFile } from "../manual/list.js";
import type {
  EnvironmentRecord,
  PageRecord,
  PassName,
  ReviewEntry,
  ReviewStatus,
  ReviewsFile,
  RunJson,
  SessionRecord,
} from "../model.js";
import { pageSlug } from "../pages/slug.js";
import { changedSinceReview } from "../reviews/changed.js";
import type { ComparedPass, CompareResult } from "./compare.js";
import { describeChanges, distinctEnvironments } from "./compare.js";

/** Everything a report is rendered from, loaded by generateReport. */
export interface ReportInput {
  run: RunJson;
  target: "live" | "snapshot";
  reviews: ReviewsFile;
  manual: ManualSessionFile[];
  compare: CompareResult | null;
  branding: VoicecapConfig["report"];
  generatedAt: string;
  voicecapVersion: string;
}

export interface ReportSummary {
  totalPages: number;
  /** Pages not pending: done, failed, or skipped. */
  processed: number;
  pending: number;
  transcribed: number;
  /** Current status reviewed, issue, or fixed. */
  reviewed: number;
  changedSinceReview: number;
  manuallyTested: number;
  openIssues: number;
  withErrors: number;
  flagged: number;
  skippedUrls: number;
}

export type CompareState = "changed" | "unchanged" | "new" | "not-compared";

export interface ReportRow {
  page: PageRecord;
  /** The page's current review (latest entry). */
  review: ReviewEntry | undefined;
  reviewCount: number;
  /** "unreviewed" also covers pages that have no entries. */
  reviewStatus: ReviewStatus;
  changed: boolean | null;
  manual: ManualSessionFile[];
  compare: { state: CompareState; passes: ComparedPass[]; reason?: string } | null;
}

export interface Banner {
  tone: "danger" | "warning" | "info";
  title: string;
  lines: string[];
}

/** One page's review history or manual sessions, including pages not in this run. */
export interface PageGroup<T> {
  key: string;
  slug: string;
  name: string;
  inRun: boolean;
  items: T[];
}

export interface ReportModel {
  input: ReportInput;
  passes: PassName[];
  summary: ReportSummary;
  banners: Banner[];
  rows: ReportRow[];
  templates: string[];
  histories: PageGroup<ReviewEntry>[];
  manualGroups: PageGroup<ManualSessionFile>[];
  /** Distinct environments across the run's sessions (usually one). */
  environments: EnvironmentRecord[];
  sessions: SessionRecord[];
}

/** Assemble the report's content: counts, rows, banners, and grouped history. Pure. */
export function buildReportModel(input: ReportInput): ReportModel {
  const { run, reviews, manual, compare } = input;
  const manualByKey = groupBy(manual, (session) => session.json.page.key);
  const compareOf = compareStates(compare);

  const rows: ReportRow[] = run.pages.map((page) => {
    const entries = reviews.pages[page.key] ?? [];
    const review = entries.at(-1);
    return {
      page,
      review,
      reviewCount: entries.length,
      reviewStatus: review?.status ?? "unreviewed",
      changed: changedSinceReview(review, page),
      manual: manualByKey.get(page.key) ?? [],
      compare: compareOf(page.key),
    };
  });

  const summary: ReportSummary = {
    totalPages: run.pages.length,
    processed: run.pages.filter((page) => page.status !== "pending").length,
    pending: run.pages.filter((page) => page.status === "pending").length,
    transcribed: run.pages.filter((page) => page.status === "done").length,
    reviewed: rows.filter((row) => row.review && row.reviewStatus !== "unreviewed").length,
    changedSinceReview: rows.filter((row) => row.changed === true).length,
    manuallyTested: rows.filter((row) => row.manual.length > 0).length,
    openIssues: rows.filter((row) => row.reviewStatus === "issue").length,
    withErrors: run.pages.filter((page) => page.status === "failed" || page.errors.length > 0)
      .length,
    flagged: run.pages.filter((page) => page.flags.length > 0).length,
    skippedUrls: run.skipped.length,
  };

  const environments = distinctEnvironments(run);
  const names = new Map(run.pages.map((page) => [page.key, pageName(page)]));
  const slugs = new Map(run.pages.map((page) => [page.key, page.slug]));
  const group = <T>(byKey: Map<string, T[]>, urlOf: (item: T) => string): PageGroup<T>[] => {
    const inRun = run.pages.filter((page) => byKey.has(page.key)).map((page) => page.key);
    const others = [...byKey.keys()].filter((key) => !names.has(key)).sort();
    return [...inRun, ...others].map((key) => {
      const items = byKey.get(key) ?? [];
      return {
        key,
        slug: slugs.get(key) ?? safeSlug(key),
        name: names.get(key) ?? (items[0] ? urlOf(items[0]) : key),
        inRun: names.has(key),
        items,
      };
    });
  };

  return {
    input,
    passes: run.settings.passes,
    summary,
    banners: banners(input, summary, environments),
    rows,
    templates: [...new Set(run.pages.map((page) => page.template ?? ""))]
      .filter((template) => template !== "")
      .sort((a, b) => a.localeCompare(b)),
    histories: group(
      new Map(Object.entries(reviews.pages).filter(([, entries]) => entries.length > 0)),
      (entry) => entry.url,
    ),
    manualGroups: group(manualByKey, (session) => session.json.page.url),
    environments,
    sessions: run.sessions,
  };
}

/** The page's name in the report: its label, or its URL. */
export function pageName(page: { label?: string; url: string }): string {
  return page.label?.trim() ? page.label.trim() : page.url;
}

function banners(
  input: ReportInput,
  summary: ReportSummary,
  environments: EnvironmentRecord[],
): Banner[] {
  const { run, compare } = input;
  const list: Banner[] = [];
  if (run.replayed) {
    const replay = run.sessions.find((session) => session.environment?.replay)?.environment?.replay;
    list.push({
      tone: "danger",
      title: "Replayed output: not a live NVDA session",
      lines: [
        replay
          ? `These transcripts were replayed from ${replay.from} (a ${replay.sourceDriver} run, ${replay.sourceRun}). No screen reader or browser ran.`
          : "These transcripts were replayed from a recording. No screen reader or browser ran.",
      ],
    });
  }
  if (run.status !== "completed") {
    list.push({
      tone: "warning",
      title: `Incomplete run: ${summary.processed} of ${summary.totalPages} pages done`,
      lines: [
        "This run hasn't finished, so this report is not final. Re-running the same command resumes it.",
      ],
    });
  }
  if (environments.length > 1) {
    list.push({
      tone: "warning",
      title: "The environment changed during this run",
      lines: [
        "The run was resumed with different tooling, so some differences between pages may come from the tooling rather than the site.",
        ...describeChanges(environments[0]!, environments.at(-1)!),
      ],
    });
  }
  for (const warning of run.source.warnings) {
    list.push({ tone: "warning", title: "Page source warning", lines: [warning] });
  }
  if (compare && compare.environmentDifferences.length > 0) {
    list.push({
      tone: "warning",
      title: `The environment differs from run ${compare.base}`,
      lines: [
        "Some changes between the runs may come from the tooling rather than the site.",
        ...compare.environmentDifferences,
      ],
    });
  }
  return list;
}

/** Where each of this run's pages stands against the compared run. */
function compareStates(compare: CompareResult | null): (key: string) => ReportRow["compare"] {
  if (!compare) return () => null;
  const changed = new Map(compare.changed.map((page) => [page.key, page.passes]));
  const added = new Set(compare.onlyInRun.map((page) => page.key));
  const notCompared = new Map(compare.notCompared.map((page) => [page.key, page.reason]));
  return (key) => {
    const passes = changed.get(key);
    if (passes) return { state: "changed", passes };
    if (added.has(key)) return { state: "new", passes: [] };
    const reason = notCompared.get(key);
    if (reason !== undefined) return { state: "not-compared", passes: [], reason };
    return { state: "unchanged", passes: [] };
  };
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return map;
}

function safeSlug(key: string): string {
  try {
    return pageSlug(key);
  } catch {
    return key.replace(/[^A-Za-z0-9_-]/g, "-");
  }
}
