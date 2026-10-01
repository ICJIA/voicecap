/**
 * Runs for the shareable page's tests, built in memory: a `RunJson` on SITE from a short spec, with
 * nothing written to disk. Whatever a spec leaves out takes a fixed placeholder, and the fields no
 * test reads are the same in every run. A task that needs more of a run (reviewers, a listener's
 * answer, the computer) adds it to these specs rather than building its own runs.
 */
import {
  PASS_NAMES,
  type AttemptRecord,
  type EnvironmentRecord,
  type FileHash,
  type FlagResult,
  type ListenerAnswer,
  type PageRecord,
  type PageSource,
  type PageStatus,
  type PassName,
  type RunJson,
  type SessionRecord,
  type SkipReason,
} from "../../src/model.js";
import { pageSlug } from "../../src/pages/slug.js";
import { canonicalKey } from "../../src/pages/url.js";
import { contentSha256 } from "../../src/transcripts/format.js";
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
  /**
   * How many attempts at the page have ended, as the record's `attempts`. Default: its failed
   * attempts, plus the one that got a done or skipped page through. A page that failed has at
   * least one (a record from before attempts were kept has none listed, and still failed once),
   * and a pending page has only those it failed before it was stopped.
   */
  attempts?: number;
  /**
   * The transcript files the record lists in `files`, by name ("read.txt", "read.json"), each with
   * a placeholder fingerprint: no file is written, and no test here reads one. Default: none.
   */
  files?: string[];
  /**
   * The passes the page was read in, each as the body lines of its TXT transcript (as `extractBody`
   * gives them): the record gets a summary of each pass, whose `contentSha256` is the lines'. No
   * file is written, so a test that needs the lines keeps them itself. Default: none.
   */
  passes?: Partial<Record<PassName, string[]>>;
  /**
   * The session (1-based) that produced the page's transcripts, as the record's `session`. Default:
   * 1 for a page that has been tried, and none for a pending one.
   */
  session?: number;
  /**
   * For a skipped page, why voicecap skipped it after loading it, as the record's `skip.reason`;
   * null leaves the record without a `skip`. Default: "non-html-response". Ignored for a page
   * that isn't skipped.
   */
  skip?: SkipReason | null;
}

/** One session of a run (see ShareRunSpec.sessions). */
export interface ShareSessionSpec {
  /**
   * Who ran the session, as its `reviewer`: the name `--reviewer` gave (source "option"). null: the
   * session had no name. Default: absent, as in a run from before voicecap 0.5.0.
   */
  reviewer?: string | null;
  /**
   * What the person answered when asked whether they listened, as the session's `listener`. It was
   * asked and answered as the session ended: both times are the session's end, and no test here
   * reads them. Default: absent, as in a run from before voicecap 0.6.0, and when nothing was asked.
   */
  listener?: ListenerAnswer;
  /** Default: the run's `createdAt`. */
  startedAt?: string;
  /** Default: `startedAt`; null when the session never ended cleanly (`endReason` null). */
  endedAt?: string;
  /** Default: the run's `endReason`. */
  endReason?: SessionRecord["endReason"];
  /** Fields of the session's environment to change, over the run's. Default: none. */
  environment?: Partial<EnvironmentRecord>;
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
   * How the run's session ended (a session of `sessions` that doesn't say ends this way too).
   * Default: "completed" for a completed run, "interrupted" for an incomplete one. null: the
   * session never ended cleanly.
   */
  endReason?: SessionRecord["endReason"];
  /**
   * The run's sessions, in order; a page's `session` says which one produced its transcripts.
   * Default: one session that starts with the run, with no reviewer and no listener's answer.
   */
  sessions?: ShareSessionSpec[];
  /** Default: a page list file, as report-data.ts's runs have. */
  source?: PageSource;
  /**
   * The voicecap version the session's environment records, as `environment.voicecap.version`:
   * "0.5.0" gives a run from before attempt records were kept. Default: report-data.ts's.
   */
  voicecapVersion?: string;
  /**
   * The passes the run was set to read, as `settings.passes`. It doesn't limit the passes a page
   * spec gives lines for. Default: all three.
   */
  passes?: PassName[];
  pages: SharePageSpec[];
}

/**
 * A failed attempt at a page, for `failedAttempts`. By default it's attempt `n`, lost to another
 * window at step 12 (Down Arrow) of the read pass, with no restart after it; a test says what
 * differs. Its times default to 14:05:00.000 and 14:05:10.000 on 26 September 2026.
 */
export function failedAttempt(
  overrides: Partial<AttemptRecord> & Pick<AttemptRecord, "n">,
): AttemptRecord {
  return {
    startedAt: "2026-09-26T14:05:00.000-05:00",
    endedAt: "2026-09-26T14:05:10.000-05:00",
    pass: "read",
    step: 12,
    command: "nextLine",
    cause: "foreground",
    message:
      "The browser lost the foreground to another window, so this step's keystroke and speech were discarded. Keep the computer free while voicecap runs.",
    restarted: false,
    ...overrides,
  };
}

const PAGE_LIST: PageSource = { kind: "pages", file: "pages.csv", sha256: "a".repeat(64) };

/** The fingerprint a listed transcript file has when a spec only names the file. */
const PLACEHOLDER_FILE: FileHash = { sha256: "0".repeat(64), bytes: 1 };

const DEFAULT_END: Record<RunJson["status"], SessionRecord["endReason"]> = {
  completed: "completed",
  incomplete: "interrupted",
};

/**
 * A run with the sessions a spec says (one, by default). Its pages have no transcripts (`passes`
 * summarizes only the lines a spec gives, and `files` lists only what a spec names), and the
 * attempts a spec says (see SharePageSpec.attempts).
 */
export function shareRun(spec: ShareRunSpec): RunJson {
  const status = spec.status ?? "completed";
  const createdAt = spec.createdAt ?? "2026-09-26T14:05:00-05:00";
  const replayed = spec.replayed ?? false;
  const source = spec.source ?? PAGE_LIST;
  // null is an answer of its own here, so `??` would lose it.
  const runEnd = spec.endReason === undefined ? DEFAULT_END[status] : spec.endReason;
  const pages = spec.pages.map(sharePage);
  const base = environment({ pageSource: source, runId: spec.id, runStartedAt: createdAt });
  const sessionEnvironment =
    spec.voicecapVersion === undefined
      ? base
      : { ...base, voicecap: { ...base.voicecap, version: spec.voicecapVersion } };

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
      passes: spec.passes ?? ["read", "headings", "tab"],
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
    sessions: (spec.sessions ?? [{}]).map((session, index): SessionRecord => {
      const n = index + 1;
      const startedAt = session.startedAt ?? createdAt;
      const endReason = session.endReason === undefined ? runEnd : session.endReason;
      const endedAt = endReason === null ? null : (session.endedAt ?? startedAt);
      return {
        n,
        startedAt,
        ...(session.reviewer === undefined
          ? {}
          : {
              reviewer:
                session.reviewer === null
                  ? null
                  : { name: session.reviewer, source: "option" as const },
            }),
        ...(session.listener === undefined
          ? {}
          : {
              listener: {
                answer: session.listener,
                askedAt: endedAt ?? startedAt,
                answeredAt: endedAt ?? startedAt,
              },
            }),
        endedAt,
        endReason,
        pagesDone: pages.filter((page) => page.status === "done" && page.session === n).length,
        environment: { ...sessionEnvironment, ...session.environment },
      };
    }),
    skipped: [],
    pages,
  };
  return (spec.sealed ?? status === "completed") ? { ...run, seal: sealOf(run) } : run;
}

function sharePage(page: SharePageSpec): PageRecord {
  const url = new URL(page.path, SITE).href;
  const key = canonicalKey(url);
  const status = page.status ?? "done";
  const failed = page.failedAttempts?.length ?? 0;
  return {
    url,
    key,
    slug: pageSlug(key),
    ...(page.label === undefined ? {} : { label: page.label }),
    status,
    attempts: page.attempts ?? defaultAttempts(status, failed),
    ...(status === "pending" ? {} : { session: page.session ?? 1 }),
    ...(status === "skipped" && page.skip !== null
      ? { skip: { url, reason: page.skip ?? "non-html-response" } }
      : {}),
    ...(page.title === undefined ? {} : { title: page.title }),
    ...(page.failedAttempts === undefined ? {} : { failedAttempts: page.failedAttempts }),
    passes: passSummaries(page.passes),
    files: Object.fromEntries((page.files ?? []).map((name) => [name, PLACEHOLDER_FILE])),
    flags: page.flags ?? [],
    errors: page.errors ?? [],
  };
}

/**
 * A summary of each pass a spec gives lines for, in pass order. Its step count and fingerprint are
 * the lines'; the rest is the same placeholder in every run.
 */
function passSummaries(lines: SharePageSpec["passes"] = {}): PageRecord["passes"] {
  const summaries: PageRecord["passes"] = {};
  for (const pass of PASS_NAMES) {
    const body = lines[pass];
    if (body === undefined) continue;
    summaries[pass] = {
      steps: body.length,
      stopReason: "end-reached",
      durationMs: 0,
      contentSha256: contentSha256(body),
      errors: [],
      warnings: [],
    };
  }
  return summaries;
}

/** The attempts a page has ended, given how many failed (see SharePageSpec.attempts). */
function defaultAttempts(status: PageStatus, failed: number): number {
  if (status === "pending") return failed;
  if (status === "failed") return Math.max(failed, 1);
  return failed + 1;
}
