/**
 * Runs for the shareable page's tests, built in memory: a `RunJson` on SITE from a short spec, with
 * nothing written to disk. Whatever a spec leaves out takes a fixed placeholder, and the fields no
 * test reads are the same in every run. A task that needs more of a run (reviewers, a listener's
 * answer, the computer) adds it to these specs rather than building its own runs.
 */
import type {
  AttemptRecord,
  FlagResult,
  PageRecord,
  PageSource,
  PageStatus,
  RunJson,
  SessionRecord,
} from "../../src/model.js";
import { pageSlug } from "../../src/pages/slug.js";
import { canonicalKey } from "../../src/pages/url.js";
import { sealOf } from "../../src/util/hash.js";
import { environment, SITE } from "./report-data.js";

export interface SharePageSpec {
  /** Path on the site, e.g. "/grants/fy27-jag". */
  path: string;
  label?: string;
  /** Default "done". */
  status?: PageStatus;
  title?: string | null;
  flags?: FlagResult[];
  failedAttempts?: AttemptRecord[];
  errors?: string[];
}

export interface ShareRunSpec {
  id: string;
  /** Default "2026-09-26T14:05:00-05:00". */
  createdAt?: string;
  /** Default "completed". */
  status?: "completed" | "incomplete";
  /**
   * Whether run.json carries its seal, which is sealOf(run). Default: it does when the run is
   * completed, as a run does once it's done.
   */
  sealed?: boolean;
  /** Default false. */
  replayed?: boolean;
  /**
   * How the run's one session ended. Default: "completed" for a completed run, "interrupted" for an
   * incomplete one. null: the session never ended cleanly.
   */
  endReason?: SessionRecord["endReason"];
  /** Default: a page list file, as report-data.ts's runs have. */
  source?: PageSource;
  pages: SharePageSpec[];
}

const PAGE_LIST: PageSource = { kind: "pages", file: "pages.csv", sha256: "a".repeat(64) };

const DEFAULT_END: Record<RunJson["status"], SessionRecord["endReason"]> = {
  completed: "completed",
  incomplete: "interrupted",
};

/**
 * A run with one session. Its pages have no transcripts (`passes` and `files` are empty) and one
 * attempt each, none for a pending page.
 */
export function shareRun(spec: ShareRunSpec): RunJson {
  const status = spec.status ?? "completed";
  const createdAt = spec.createdAt ?? "2026-09-26T14:05:00-05:00";
  const replayed = spec.replayed ?? false;
  const source = spec.source ?? PAGE_LIST;
  // null is an answer of its own here, so `??` would lose it.
  const endReason = spec.endReason === undefined ? DEFAULT_END[status] : spec.endReason;
  const pages = spec.pages.map(sharePage);

  const run: RunJson = {
    schemaVersion: 1,
    id: spec.id,
    name: null,
    status,
    createdAt,
    completedAt: status === "completed" ? createdAt : null,
    site: SITE,
    settings: {
      site: SITE,
      source,
      passes: ["read", "headings", "tab"],
      include: [],
      exclude: [],
      limit: null,
      driver: replayed ? "replay" : "guidepup",
      replayFrom: replayed ? "fixture/replay-run" : null,
      capture: "complete",
      stepCaps: { read: 400, headings: 200, tab: 300 },
      nvdaSettings: {},
      browser: { channel: "chrome", fallbackToChromium: true },
    },
    settingsHash: "s".repeat(64),
    configSha256: "c".repeat(64),
    flagRulesSha256: "f".repeat(64),
    replayed,
    source: {
      kind: source.kind,
      listed: pages.length,
      duplicates: 0,
      invalid: [],
      excludedByFilter: 0,
      excludedByLimit: 0,
      warnings: [],
    },
    compareTo: null,
    sessions: [
      {
        n: 1,
        startedAt: createdAt,
        endedAt: endReason === null ? null : createdAt,
        endReason,
        pagesDone: pages.filter((page) => page.status === "done").length,
        environment: environment({ pageSource: source, runId: spec.id, runStartedAt: createdAt }),
      },
    ],
    skipped: [],
    pages,
  };
  return (spec.sealed ?? status === "completed") ? { ...run, seal: sealOf(run) } : run;
}

function sharePage(page: SharePageSpec): PageRecord {
  const url = new URL(page.path, SITE).href;
  const key = canonicalKey(url);
  const status = page.status ?? "done";
  return {
    url,
    key,
    slug: pageSlug(key),
    ...(page.label === undefined ? {} : { label: page.label }),
    status,
    attempts: status === "pending" ? 0 : 1,
    ...(page.title === undefined ? {} : { title: page.title }),
    ...(page.failedAttempts === undefined ? {} : { failedAttempts: page.failedAttempts }),
    passes: {},
    files: {},
    flags: page.flags ?? [],
    errors: page.errors ?? [],
  };
}
