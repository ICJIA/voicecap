/**
 * The files voicecap writes: run.json, transcript JSON, reviews.json, and manual sessions.
 * Each carries a schemaVersion so later versions can read older output.
 */
import type { CaptureMode, EnvironmentInfo, FocusedElement } from "./drivers/types.js";

export type { CaptureMode };

export const PASS_NAMES = ["read", "headings", "tab"] as const;
export type PassName = (typeof PASS_NAMES)[number];

export type DriverCommand = "toTop" | "toBottom" | "nextLine" | "nextHeading" | "nextFocusable";

export type StopReason =
  /** read: the last line was spoken, then repeated (NVDA has no end-of-document message) */
  | "end-reached"
  | "no-next-heading"
  /** tab: focus moved out of the page, into browser UI */
  | "left-document"
  /** safety net: the same speech too many times in a row */
  | "repeat-limit"
  | "step-cap"
  | "timeout"
  | "error";

export interface StepRecord {
  /** 1-based step number. */
  n: number;
  command: DriverCommand;
  spoken: string;
  durationMs: number;
  /** Time since the pass started, at the end of this step. */
  offsetMs: number;
  /** Tab pass only: whether focus was still in the page document. */
  inDocument?: boolean;
  /** Tab pass only: the focused element after this step. */
  focused?: FocusedElement | null;
}

/** Where a run's pages came from. For settings hashes, a sitemap is identified by URL only. */
export type PageSource =
  | { kind: "sitemap"; url: string }
  | { kind: "pages"; file: string; sha256: string }
  /** --page, one or more times: resolved absolute URLs, fragment dropped, in the order given. */
  | { kind: "urls"; urls: string[] }
  /**
   * --walkthrough: the walkthrough file, recorded as a page list's is (relative to the working
   * folder when inside it), its SHA-256 as read, the id of the run it was made from, and what that
   * run's pages came from. For a walkthrough of a repeat that is the repeat's own `from`, so it
   * always names a sitemap, a page list, or --page, never another walkthrough: a repeat of a
   * --page spot check is a spot check too, and doesn't say which pages are on the site's list.
   */
  | {
      kind: "walkthrough";
      file: string;
      sha256: string;
      run: string;
      from: "sitemap" | "pages" | "urls";
    };

/**
 * The computer a session ran on, as the report's "Test environment" shows it. Never its maker,
 * model, name, or account.
 */
export interface MachineRecord {
  /** "Windows 11 Pro 25H2", build "10.0.26200.9550" (with the update revision), arch "x64". */
  os: { name: string; build: string | null; arch: string };
  cpu: {
    /** The first processor's model name, or "unknown". */
    name: string;
    /** Its base speed, in megahertz; null when the system doesn't say (Apple silicon doesn't). */
    baseMhz: number | null;
    physicalCores: number | null;
    logicalProcessors: number;
  };
  memoryBytes: number;
  /**
   * The main display: its size in pixels, its refresh rate in hertz, and the scaling the system
   * applies (a percent of 96 dots per inch; Windows only). Null when it can't be read.
   */
  display: {
    width: number;
    height: number;
    refreshHz: number | null;
    scalePercent: number | null;
  } | null;
  /** The browser's fixed window size; null for a replay, which opens no browser. */
  browserWindow: { width: number; height: number } | null;
  /** IANA, e.g. "America/Chicago", and the offset when the session started, e.g. "-05:00". */
  timeZone: string;
  utcOffset: string;
  /** The display language, e.g. "en-US". */
  language: string | null;
  /** The installed versions; Guidepup and Playwright are null when they can't be found. */
  software: { node: string; voicecap: string; guidepup: string | null; playwright: string | null };
}

/** The environment record: stored per session in run.json and repeated in every transcript. */
export interface EnvironmentRecord extends EnvironmentInfo {
  pageSource: PageSource;
  voicecap: { version: string; configSha256: string };
  runId: string;
  runStartedAt: string;
  /**
   * The computer this session ran on (for a replayed session, the one that replayed it). Absent in
   * runs from before voicecap recorded it.
   */
  machine?: MachineRecord;
}

export interface PageRef {
  /** Absolute URL as listed: the first form listed, with relative paths resolved against the site. */
  url: string;
  /** Canonical URL (see canonicalKey): the page's identity across runs, reviews, and manual sessions. */
  key: string;
  slug: string;
  label?: string;
  template?: string;
  notes?: string;
}

/** One pass of one page: pages/<slug>/<pass>.json. The .txt is rendered from this. */
export interface TranscriptJson {
  schemaVersion: 1;
  /** voicecap version that wrote the file. */
  voicecap: string;
  replayed: boolean;
  run: string;
  pass: PassName;
  page: PageRef & { finalUrl: string };
  capturedAt: string;
  durationMs: number;
  stepCount: number;
  stopReason: StopReason;
  warnings: string[];
  errors: string[];
  /** Tab pass only: what was focused before the first Tab (should be nothing). */
  initialFocus?: FocusedElement | null;
  environment: EnvironmentRecord;
  steps: StepRecord[];
}

/** Everything that decides whether an incomplete run can be resumed. */
export interface RunSettings {
  site: string;
  source: PageSource;
  passes: PassName[];
  include: string[];
  exclude: string[];
  limit: number | null;
  driver: string;
  replayFrom: string | null;
  capture: CaptureMode;
  stepCaps: Record<PassName, number>;
  nvdaSettings: Record<string, unknown>;
  browser: { channel: string; fallbackToChromium: boolean };
  /**
   * How long the run waited for each page to be ready, as the config gave it; for a repeat of a
   * walkthrough file, as the file gave it, or the config where the file had none. Absent in runs
   * from before voicecap recorded it.
   */
  readiness?: { readySelector: string | null; settleMs: number; networkIdleTimeoutMs: number };
}

export interface InvalidEntry {
  /** Line in the page list file, when known. */
  line: number | null;
  value: string;
  reason: string;
}

export interface SourceDetails {
  kind: "sitemap" | "pages" | "urls" | "walkthrough";
  /** Sitemap runs: every sitemap document fetched (index and children). */
  sitemaps?: { url: string; urls: number; sha256?: string; error?: string }[];
  /**
   * Page list and walkthrough runs: the file as given and its SHA-256. A page list run also has its
   * format and the encoding it was decoded with.
   */
  file?: string;
  sha256?: string;
  format?: "csv" | "json";
  encoding?: "utf-8" | "windows-1252";
  /** Entries in the source before normalization and filtering. */
  listed: number;
  duplicates: number;
  invalid: InvalidEntry[];
  excludedByFilter: number;
  excludedByLimit: number;
  warnings: string[];
}

export type SkipReason =
  "off-origin" | "non-html-extension" | "non-html-response" | "redirect-off-origin";

export interface SkippedRecord {
  url: string;
  reason: SkipReason;
  finalUrl?: string;
  contentType?: string | null;
  status?: number | null;
  line?: number;
}

export interface FileHash {
  sha256: string;
  bytes: number;
}

export interface PassSummary {
  steps: number;
  stopReason: StopReason;
  durationMs: number;
  /** SHA-256 of the TXT body (step lines only, not the header): what "changed" compares. */
  contentSha256: string;
  errors: string[];
  warnings: string[];
}

export type PageStatus = "pending" | "done" | "failed" | "skipped";

export interface FlagResult {
  /** Rule id, e.g. "generic-link-text". */
  rule: string;
  message: string;
  pass?: PassName;
  count?: number;
  /**
   * What the rule found, for the rules that find items (generic-link-text and unlabeled): each item,
   * lowercased, with how many times it was found in the pass, most often first and alphabetical
   * among those found as often: the order the message lists them in, and the counts add up to
   * `count`. Absent for the other rules, and in records from before voicecap kept it.
   */
  found?: { text: string; count: number }[];
}

/**
 * Why a page failed. "page": the site answered with an HTTP error, so the screen reader and
 * browser are fine. "environment": a timeout or a driver error, which may mean they aren't.
 */
export type FailureKind = "page" | "environment";

/**
 * Why one attempt at a page failed. Most of these are the code voicecap's own errors carry (see
 * causeOf in src/run/failure.ts). "foreground": another window took the foreground from the
 * browser. "locked": the computer was locked. "screen-reader-stopped": the screen reader didn't
 * start or stopped running. "browser": the browser didn't start or isn't installed, changed during
 * the run, or closed or crashed while voicecap was using it.
 * "http": the site answered with an HTTP error (no error is raised for that). "unreachable": the
 * website couldn't be reached, which is the website's fault or the network's. "open-timeout",
 * "step-timeout", "page-timeout": the page didn't open in time, a step didn't finish in time, or
 * the whole page took too long. "unexpected": any other error, which may be a fault in voicecap.
 */
export type FailureCause =
  | "foreground"
  | "locked"
  | "screen-reader-stopped"
  | "browser"
  | "http"
  | "unreachable"
  | "open-timeout"
  | "step-timeout"
  | "page-timeout"
  | "unexpected";

/**
 * One failed attempt at a page, kept in the page's record. It names no session: its times place it
 * in one.
 */
export interface AttemptRecord {
  /**
   * The page's attempt number, 1-based and counted across every session of the run, as the page's
   * `attempts` counts them: the attempt that ended as the page's k-th has n k. In a run begun with
   * voicecap 0.5.0, the attempts it counted come first.
   */
  n: number;
  /** Local ISO times, to the millisecond. */
  startedAt: string;
  endedAt: string;
  /** The pass under way, or null when the attempt failed before its first pass began. */
  pass: PassName | null;
  /** The 1-based step that failed (its keystroke was discarded), or null outside a step. */
  step: number | null;
  /** The driver command that step sent ("nextLine", "openPage", …), or null. */
  command: DriverCommand | "openPage" | null;
  cause: FailureCause;
  message: string;
  /** For "unexpected" only: the stack, with the home folder replaced. */
  stack?: string;
  /**
   * Whether the screen reader and browser were started again for the page's next attempt: true
   * only once that restart had finished. False when it failed, when the next attempt went ahead
   * without one (an HTTP 5xx), and for the last attempt voicecap made at the page in a session.
   */
  restarted: boolean;
}

export interface PageRecord extends PageRef {
  /** Line in the page list file, when the source is a file. */
  line?: number;
  status: PageStatus;
  /** Set when status is "failed". */
  failure?: FailureKind;
  /**
   * How many attempts at the page have ended, across every session: done, failed, or skipped. An
   * attempt that Ctrl+C stopped midway isn't counted.
   */
  attempts: number;
  finalUrl?: string;
  httpStatus?: number | null;
  /**
   * The title the browser reported on the page's first load in its last attempt: null when the
   * page has none, or never loaded. Absent while the page is pending, and in runs from before
   * voicecap recorded it.
   */
  title?: string | null;
  /**
   * The address the page's `<link rel="canonical">` tag gave, as the browser resolved it, on the
   * page's first load in its last attempt: null when the page was read without one, and when it
   * wasn't read (it failed or was skipped, so its tag says nothing about the site). Absent while
   * the page is pending, and in runs from before voicecap 0.10.0 recorded it.
   */
  canonical?: string | null;
  /**
   * Every failed attempt at the page, across every session, oldest first: those a later attempt
   * made good, and the last of a page that failed. Each is added, and written to run.json, as it
   * ends, before anything is restarted, and is never replaced or removed: a page that failed in one
   * session and was read in the next keeps the first session's. A pending page keeps those it had
   * before Ctrl+C. Absent when none failed, and in runs from before voicecap recorded them.
   */
  failedAttempts?: AttemptRecord[];
  /** Set when the page was skipped after loading (non-HTML response, redirect off-origin). */
  skip?: SkippedRecord;
  /** The session (1-based) that produced the current transcripts. */
  session?: number;
  startedAt?: string;
  durationMs?: number;
  passes: Partial<Record<PassName, PassSummary>>;
  /** Transcript files in pages/<slug>/, by file name ("read.txt", "read.json", ...). */
  files: Record<string, FileHash>;
  flags: FlagResult[];
  errors: string[];
}

/** Who recorded something, and where voicecap found the name. */
export interface ReviewerRecord {
  name: string;
  /** --reviewer, VOICECAP_REVIEWER, `git config user.name`, or the config's reviewer. */
  source: "option" | "environment" | "git" | "config";
}

/**
 * What a person says about hearing the screen reader speak during a session: the whole time, part
 * of the time, or not at all.
 */
export type ListenerAnswer = "all" | "part" | "no";

/**
 * Whether the person running voicecap heard the screen reader speaking: asked when the session
 * ended, at a terminal.
 */
export interface ListenerStatement {
  answer: ListenerAnswer;
  /** Local ISO times, to the millisecond. */
  askedAt: string;
  answeredAt: string;
}

export interface SessionRecord {
  /** 1-based. */
  n: number;
  startedAt: string;
  /**
   * Who ran this session: --reviewer, else VOICECAP_REVIEWER, `git config user.name`, or the
   * config's reviewer. null when there was no name; absent in runs from before voicecap recorded it.
   */
  reviewer?: ReviewerRecord | null;
  /**
   * What the person running this session said when it ended, asked whether they heard the screen
   * reader speaking as it read the pages: once it had stopped, however the session ended
   * (completed, stopped, interrupted, or with an error). Absent when there's no answer to keep:
   * - no terminal, or the output redirected from it (a script, CI, `> log.txt`);
   * - a replayed run;
   * - no pages read;
   * - Ctrl+C at the question (for an interrupted session, a second Ctrl+C), or the input ending;
   * - a closed window;
   * - a question that failed;
   * - runs from before voicecap 0.6.0.
   */
  listener?: ListenerStatement;
  endedAt: string | null;
  /** null when the session never ended cleanly (crash, power loss). */
  endReason: "completed" | "interrupted" | "environment-failure" | "error" | null;
  pagesDone: number;
  /** null if the driver never started. */
  environment: EnvironmentRecord | null;
}

/** Why voicecap started the screen reader and the browser again. */
export type RestartReason =
  /** The config's restartEvery pages were read since they last started. */
  | { kind: "every"; pages: number }
  /** A page failed, and the screen reader or the browser may be the reason. */
  | { kind: "failed-page" }
  /**
   * To try a page again. `attempt` is the number of the attempt about to start, counted as the
   * page's record counts its attempts, and `of` is the number of the last attempt voicecap will
   * make at the page in this session, counted the same way: for a page with no earlier attempt,
   * how many attempts a page gets (the config's pageAttempts).
   */
  | { kind: "retry"; page: string; attempt: number; of: number };

/**
 * One thing that happened in a run, as the run's event log (events.jsonl) keeps it, less when: see
 * RunEvent. The types are general, so each driver says what it did in the same words ("screen
 * reader started", "browser closed"), and what belongs to one screen reader stays in its driver. A
 * page is named by its address as voicecap read it (PageRecord.url), and an attempt by its number
 * in the page's record (AttemptRecord.n). A process id is null when it couldn't be found.
 */
export type NewRunEvent =
  /** A session began. `resumed` is true for every session after the run's first. */
  | { type: "run-started"; session: number; resumed: boolean }
  /** A session ended, as its record says. */
  | { type: "run-ended"; session: number; reason: NonNullable<SessionRecord["endReason"]> }
  /** voicecap took the lock that keeps runs from sharing the screen reader, or gave it up. */
  | { type: "screen-reader-lock-taken" }
  | { type: "screen-reader-lock-released" }
  /** The screen reader voicecap runs started or stopped. `restarting`: it starts again at once. */
  | { type: "screen-reader-started"; pid: number | null }
  | { type: "screen-reader-stopped"; pid: number | null; restarting: boolean }
  /** voicecap is about to stop the screen reader and the browser, and start them again. */
  | { type: "screen-reader-restarting"; reason: RestartReason }
  /** The computer's own screen reader, shut down so voicecap's could run, and started again. */
  | { type: "own-screen-reader-closed"; pids: number[] }
  | { type: "own-screen-reader-restarted"; ok: boolean }
  /** The browser voicecap uses started or closed, or handed over to a new copy of itself. */
  | { type: "browser-launched"; pid: number | null }
  | { type: "browser-closed"; pid: number | null }
  | { type: "browser-handed-over" }
  /** An attempt at a page began; ended with the page read, or skipped; or failed. */
  | { type: "page-started"; page: string; attempt: number }
  | { type: "page-finished"; page: string; attempt: number; status: "done" | "skipped" }
  | { type: "page-failed"; page: string; attempt: number; cause: FailureCause; message: string }
  /** Windows was found locked. */
  | { type: "computer-locked" }
  /**
   * Another window took the foreground from the browser: the program's name and the window's
   * title, each null when Windows didn't say. A title can hold private text, such as an email's
   * subject, so no report shows it.
   */
  | { type: "foreground-lost"; program: string | null; title: string | null };

/**
 * A line of the event log: an event, and when it was recorded, as a local ISO time to the
 * millisecond. A log written by a later voicecap may hold types this one doesn't know.
 */
export type RunEvent = NewRunEvent & { at: string };

export interface RunJson {
  schemaVersion: 1;
  id: string;
  name: string | null;
  status: "incomplete" | "completed";
  createdAt: string;
  completedAt: string | null;
  /** The address voicecap read, which stays as it was whatever `canonical` says. */
  site: string;
  /**
   * The root of the site's canonical address, the one people visit, such as
   * "https://dvfr.illinois.gov/": what --canonical gave the session that completed the run, else
   * the root most of the inner pages' own tags name, and the home page's only when no inner page's
   * names one (see chooseCanonicalRoot). Set at completion, so the seal covers it. Absent when
   * neither gave one, and in runs from before voicecap 0.10.0.
   */
  canonical?: string;
  settings: RunSettings;
  settingsHash: string;
  configSha256: string;
  /** SHA-256 of the flag rules the stored flags were computed with. */
  flagRulesSha256: string;
  replayed: boolean;
  source: SourceDetails;
  /** Base run of the --compare this run was made with, recorded at completion. */
  compareTo: string | null;
  sessions: SessionRecord[];
  /** Every skipped URL: before the run (off-origin, extension) and on load (response, redirect). */
  skipped: SkippedRecord[];
  pages: PageRecord[];
  /**
   * The run's own evidence files, beside its pages': each one's SHA-256 and size, by its path from
   * the run's folder, written with "/". Today that's "events.jsonl", the run's event log. Each
   * session's end sets them, so the seal covers every file, and `voicecap verify` checks each one.
   * Absent in runs from before voicecap 0.11.0, and while a run has no file to record.
   */
  files?: Record<string, FileHash>;
  /**
   * SHA-256 seal of this record (see sealOf), set once every other field is final at completion.
   * Absent while the run is incomplete, and on runs written before this field existed.
   */
  seal?: string;
}

export const REVIEW_STATUSES = ["unreviewed", "reviewed", "issue", "fixed"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** One review decision. Entries are never edited or deleted; the latest is the current status. */
export interface ReviewEntry {
  status: ReviewStatus;
  reviewer: string;
  at: string;
  note: string | null;
  /** Run whose transcripts were reviewed. */
  run: string | null;
  /** The page URL as listed in that run. */
  url: string;
  /** SHA-256 of each transcript file for the page in that run, by file name. */
  files: Record<string, string>;
  /** SHA-256 of each pass's TXT body in that run: compared to detect "changed since review". */
  content: Partial<Record<PassName, string>>;
  /**
   * This entry's 1-based position in reviews.json's chain, counted across every page in the order
   * entries were appended. Absent on entries recorded before this field existed.
   */
  seq?: number;
  /**
   * The `seal` of the entry before this one in that chain, or null for the first. Absent on
   * entries recorded before this field existed.
   */
  prev?: string | null;
  /** SHA-256 seal of this entry (see sealOf). Absent on entries recorded before this field existed. */
  seal?: string;
}

/** <site>/reviews.json, a site folder's review history (see reviewsPath) */
export interface ReviewsFile {
  schemaVersion: 1;
  /** By canonical page URL. */
  pages: Record<string, ReviewEntry[]>;
}

/** A file `voicecap share` wrote: its name in the site's share/ folder, its size, and its SHA-256. */
export interface SharedFile extends FileHash {
  name: string;
  /** The run a walkthrough file is of. Only a walkthrough file has it. */
  run?: string;
}

/** One share, in <site>/share/shares.json: never rewritten once it's recorded. */
export interface ShareEntry {
  /** Its 1-based place in the file's chain. */
  seq: number;
  /** The seal of the entry before it; null for the first. */
  prev: string | null;
  /** When the copies were made: a local ISO date and time. */
  at: string;
  /** Who made them. */
  by: string;
  /**
   * The root of the site the copies name it by, which their file names are made from: its canonical
   * address ("https://dvfr.illinois.gov/"), and with none known, the address voicecap read, with a
   * "/" on the end ("http://127.0.0.1:4848/"). Sealed with the rest. Absent on entries recorded
   * before 0.10.0, whose copies are named for the site's folder.
   */
  site?: string;
  /** The ids of the runs the copies drew on, oldest first. */
  runs: string[];
  /** The page, then its Word copy, then each run's walkthrough file, oldest run first. */
  files: SharedFile[];
  /** sealOf this entry. */
  seal: string;
}

export interface SharesFile {
  schemaVersion: 1;
  shares: ShareEntry[];
}

export type ManualInputFormat = "nvda-log" | "speech-viewer";

export interface ManualEntry {
  /** Local ISO date and time; null for Speech Viewer input, which has no timestamps. */
  at: string | null;
  type: "key" | "speech";
  text: string;
  /** True when the text was replaced by "[typed text redacted]". */
  redacted?: boolean;
}

/** <date>/<time>_manual_<slug>/session.json (see manualSessionDir) */
export interface ManualSessionJson {
  schemaVersion: 1;
  voicecap: string;
  /**
   * Session id: the session's local start date and time, e.g. 2026-09-26_1405. Names its folder
   * (manualSessionDir); a second session with the same start time gets "-2", "-3", ...
   */
  id: string;
  page: { url: string; key: string; slug: string };
  input: {
    format: ManualInputFormat;
    /** Base name of the imported file. */
    fileName: string;
    sha256: string;
    bytes: number;
    /** The unmodified original, or why it wasn't kept. Paths are relative to this JSON file. */
    raw: { kept: true; path: string } | { kept: false; reason: "no-raw" | "withheld-for-privacy" };
  };
  session: {
    /** Local date the session started, YYYY-MM-DD. */
    date: string;
    dateSource: "option" | "file-modified";
    /** Local ISO start and end, when known (logs). */
    start: string | null;
    end: string | null;
    /** The --from / --to window applied, if any. */
    from: string | null;
    to: string | null;
    crossesMidnight: boolean;
  };
  nvdaVersion: string | null;
  importedAt: string;
  reviewer: string;
  redaction: {
    applied: boolean;
    keystrokes: number;
    speech: number;
    note: string | null;
  };
  warnings: string[];
  entries: ManualEntry[];
  /** session.txt's SHA-256 and size. Absent on sessions imported before this field existed. */
  transcript?: FileHash;
  /** SHA-256 seal of this record (see sealOf). Absent on sessions imported before this field existed. */
  seal?: string;
}
