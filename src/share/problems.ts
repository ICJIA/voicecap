/**
 * The problems during the runs: every failed attempt in the runs a standing draws on, each with
 * its kind, what voicecap did, whether it happened again, what it did to the results, and the
 * record of it. Pure: it works from run records already read, and reads no files. The lines a run's
 * event log has of an attempt come from whoever read the log (see `EventRows`).
 */
import {
  PASS_NAMES,
  type AttemptRecord,
  type FailureCause,
  type PageRecord,
  type PassName,
  type RunJson,
} from "../model.js";
import { redactHome } from "../run/failure.js";
import type { Standing } from "./standing.js";
import { PROBLEMS_TEXT, TIMELINE_TEXT } from "./text.js";

/** A problem's kind: a cause code, with the three timeouts under one kind. */
export type ProblemKind =
  | "foreground"
  | "locked"
  | "screen-reader-stopped"
  | "browser"
  | "http"
  | "unreachable"
  | "timeout"
  | "unexpected";

export interface ProblemRecordRow {
  time: string | null;
  /** The page's record in run.json, the run's event log, or the stack an unexpected error left. */
  source: "run.json" | "events.jsonl" | "stack";
  entry: string;
}

/**
 * What a run's event log says of an attempt at a page, for its record:
 * - `rows`: each of its events from the attempt's start until the next attempt's, or until 10
 *   seconds after it ended when none followed, as its time and its words (none for an attempt of a
 *   session the log has no line of);
 * - `gap`: where the page doesn't have the log of a run whose voicecap keeps one, why, as the
 *   record's line says it, which is the reason the run's evidence gives (TIMELINE_TEXT.gaps);
 * - null: the page has no log of a run from before voicecap kept one.
 */
export type EventRows = (
  run: RunJson,
  page: PageRecord,
  attempt: AttemptRecord,
) => { rows: { time: string; entry: string }[] } | { gap: string } | null;

/**
 * Whether a voicecap keeps a run's event log, and the program that takes the screen when the
 * browser loses it: 0.11.0, the first, and every version since. An unknown version counts as an
 * earlier one.
 */
export function keepsEventLog(version: string | null): boolean {
  const match = version === null ? null : /^(\d+)\.(\d+)\./.exec(version);
  return match !== null && (Number(match[1]) > 0 || Number(match[2]) >= 11);
}

export interface Problem {
  run: string;
  page: { key: string; slug: string; url: string; label?: string };
  /** The attempt's number; null for a 0.4.1 record, which didn't number them. */
  n: number | null;
  startedAt: string | null;
  endedAt: string | null;
  kind: ProblemKind;
  /** True when the kind came from the error's wording (a run recorded before cause codes). */
  fromWording: boolean;
  pass: PassName | null;
  step: number | null;
  command: string | null;
  /** The message with the home folder replaced. */
  message: string;
  /**
   * For a foreground loss, the program that came to the front, by its name, with the home folder
   * replaced; null when voicecap couldn't tell. Absent when the run didn't record it: before
   * voicecap 0.11.0, or a driver that didn't look. Never the window's title.
   */
  program?: string | null;
  stack: string | null;
  /** "What happened", in plain words. */
  happened: string;
  /** "What voicecap did". */
  did: string;
  /** "Did it happen again?" */
  verdict: string;
  /**
   * What the verdict comes to for this problem, by what followed it in the run:
   * - "same": a later attempt failed the same way, or the page never got through and failed every
   *   attempt that way;
   * - "different": later attempts failed in other ways, or the page never got through and failed in
   *   different ways over its attempts;
   * - "no": it didn't come back: the page was read in full, or loaded and skipped, on a later
   *   attempt; or it was the page's only attempt, and a later run the standing draws on read the
   *   page in full;
   * - "unknown": it was the page's only attempt in the run, and no later run read the page in full,
   *   so nothing says whether it would have happened again (an earlier run that read it is named,
   *   but shows only that the page could be read before).
   */
  again: "no" | "same" | "different" | "unknown";
  /** "Effect on the results". */
  effect: string;
  record: ProblemRecordRow[];
  /**
   * What this run didn't record, each where it matters: the step and the key (for an error from a
   * pass's step, written as text), the program in front (for a foreground loss), and the event log
   * and NVDA's own log.
   */
  notRecorded: string[];
}

export interface ProblemsSection {
  problems: Problem[];
  /** The verdict line that opens the section. */
  line: string;
  /** How many problems were unexpected errors, the kind that could mean a problem in voicecap. */
  unexpected: number;
}

/** The spec's table of kinds of problem, in its order. The last, "stopped", is no failure. */
export const KIND_ROWS: {
  kind: ProblemKind | "stopped";
  title: string;
  whose: string;
  meaning: string;
}[] = [
  {
    kind: "foreground",
    title: "Another window came to the front",
    whose: "Outside voicecap: another program, or someone at the computer",
    meaning:
      "The step is thrown out, so the other window's speech never reaches a transcript, and the page is tried again.",
  },
  {
    kind: "locked",
    title: "The computer locked",
    whose: "Outside voicecap: Win+L, a screen saver, or a lock policy",
    meaning: "As above. voicecap keeps the screen awake, but can't stop a lock.",
  },
  {
    kind: "screen-reader-stopped",
    title: "NVDA stopped running",
    whose: "The screen reader",
    meaning:
      "voicecap can't tell why. NVDA's own log from that moment is shown when the run recorded it.",
  },
  {
    kind: "browser",
    title: "The browser stopped, or didn't start",
    whose: "The browser",
    meaning: "Tried again with a fresh browser.",
  },
  {
    kind: "http",
    title: "The website answered with an error",
    whose: "The website",
    meaning: "A 5xx is tried again. A 4xx isn't, since trying again can't help.",
  },
  {
    kind: "unreachable",
    title: "The website couldn't be reached",
    whose:
      "The website or the network: the address didn't answer, the connection failed, or its certificate wasn't valid",
    meaning:
      "Tried again. If it keeps failing, the site was down or couldn't be reached from this computer.",
  },
  {
    kind: "timeout",
    title: "A step took too long",
    whose: "Not certain: the website, NVDA, the computer, or voicecap",
    meaning: "Tried again. If it keeps happening on one page, that page and the record say more.",
  },
  {
    kind: "unexpected",
    title: "An unexpected error",
    whose: "Possibly voicecap itself",
    meaning:
      "The full error, and where in voicecap's code it happened, are shown, with a link to report it (github.com/ICJIA/voicecap/issues).",
  },
  {
    kind: "stopped",
    title: "Stopped by the person running it",
    whose: "The person: Ctrl+C, or closing the window",
    meaning: "Not a failure. The page is read when the run resumes.",
  },
];

const KIND_ORDER: ProblemKind[] = KIND_ROWS.flatMap((row) =>
  row.kind === "stopped" ? [] : [row.kind],
);

const KIND_OF_CAUSE: Record<FailureCause, ProblemKind> = {
  foreground: "foreground",
  locked: "locked",
  "screen-reader-stopped": "screen-reader-stopped",
  browser: "browser",
  http: "http",
  unreachable: "unreachable",
  "open-timeout": "timeout",
  "step-timeout": "timeout",
  "page-timeout": "timeout",
  unexpected: "unexpected",
};

/**
 * The kind of a cause code. A code this version doesn't know (a newer voicecap's) is an unexpected
 * error, as the spec says of any other: it's shown as possibly voicecap's own.
 */
export function kindOfCause(cause: string): ProblemKind {
  return Object.hasOwn(KIND_OF_CAUSE, cause) ? KIND_OF_CAUSE[cause as FailureCause] : "unexpected";
}

/**
 * Each kind in plain words, as the verdict line and the verdicts name it, and as the summary names
 * the kind of failure that kept a page from being read.
 */
export const PHRASES: Record<ProblemKind, string> = {
  foreground: "another window took the screen",
  locked: "the computer locked",
  "screen-reader-stopped": "NVDA stopped running",
  browser: "the browser stopped or didn't start",
  http: "the website answered with an error",
  unreachable: "the website couldn't be reached",
  timeout: "a step took too long",
  unexpected: "an unexpected error",
};

/**
 * How a read pass stopped before the page's end, in words that follow "its read": at its step limit,
 * or by the repeat safety net (NVDA said the same thing too many times in a row). Such a page was
 * transcribed, but not read in full: only a read that reached the page's end was.
 */
export const READ_STOPPED = {
  "step-cap": "stopped at the step limit",
  "repeat-limit": "stopped before the end of the page",
} as const;

/** How the read pass of a page's record stopped short of the page's end; null when it didn't. */
export function readStoppedOf(page: PageRecord): keyof typeof READ_STOPPED | null {
  const stop = page.passes.read?.stopReason;
  return stop === "step-cap" || stop === "repeat-limit" ? stop : null;
}

/** The kinds that are another program's doing, or someone's at the computer: not voicecap's. */
const OUTSIDE: ReadonlySet<ProblemKind> = new Set(["foreground", "locked"]);

/** The kinds that, failing every time, point to the website rather than to the page or voicecap. */
const THE_WEBSITE: ReadonlySet<ProblemKind> = new Set(["http", "unreachable"]);

/** The key a driver command presses, as a person knows it. */
const KEYS: Record<string, string> = {
  nextLine: "Down Arrow",
  nextHeading: "H",
  nextFocusable: "Tab",
  toTop: "Ctrl+Home",
  toBottom: "Ctrl+End",
};

// The forms voicecap 0.4.1 and 0.5.0 wrote a page's errors in (see processPage and runAttempt in
// src/run/page-runner.ts): a retry names its attempt, and a pass or a page that couldn't be opened
// for one names the pass. Each puts the error's own message inside.
const RETRY_ENTRY = /^Attempt (\d+) failed \((.*)\); retrying\.$/s;
const PASS_ENTRY = /^(read|headings|tab) pass: (.*)$/s;
const OPEN_ENTRY = /^Could not open the page for the (read|headings|tab) pass: (.*)$/s;

interface ParsedEntry {
  kind: ProblemKind;
  pass: PassName | null;
  n: number | null;
  /** The page couldn't be opened for the pass. */
  opening: boolean;
  /** An error from a pass's step: "<pass> pass: …". */
  inStep: boolean;
  /** The error's own message, without the forms around it. */
  message: string;
}

function parseEntry(entry: string): ParsedEntry {
  let message = entry;
  let n: number | null = null;
  const retry = RETRY_ENTRY.exec(message);
  if (retry) {
    n = Number(retry[1]);
    message = retry[2] ?? "";
  }
  const opened = OPEN_ENTRY.exec(message);
  const passed = opened ?? PASS_ENTRY.exec(message);
  const pass = passed ? (PASS_NAMES.find((name) => name === passed[1]) ?? null) : null;
  if (passed) message = passed[2] ?? "";
  return {
    kind: kindOfMessage(message),
    pass,
    n,
    opening: opened !== null,
    inStep: passed !== null && opened === null,
    message,
  };
}

/**
 * The kind of an error from the words voicecap wrote it in: what the drivers (src/drivers/), the
 * step timeouts (src/passes/steps.ts), and the page runner said at 0.4.1 and 0.5.0, which gave the
 * errors no cause code. The words of any other error, such as a browser library's own, are no
 * kind voicecap knows: those are unexpected.
 */
function kindOfMessage(message: string): ProblemKind {
  if (/lost the foreground to another window|couldn't be brought to the front/.test(message)) {
    return "foreground";
  }
  if (message.includes("Windows is locked")) return "locked";
  if (/NVDA stopped running|lost its connection to NVDA/.test(message)) {
    return "screen-reader-stopped";
  }
  if (/ did not finish within \d/.test(message)) return "timeout";
  if (/^HTTP \d{3}$/.test(message)) return "http";
  // Chrome's own network errors, as Playwright words them ("page.goto: net::ERR_NAME_NOT_RESOLVED
  // at …"): the website couldn't be reached, as voicecap's own browser code now says (asUnreachable
  // in src/drivers/guidepup/chrome.ts).
  if (/net::ERR_[A-Z0-9_]+/.test(message)) return "unreachable";
  if (
    /^The browser changed during the run: |^(?:Chromium|Chrome|Microsoft Edge)(?: Beta| Dev| Canary)? didn't start: /.test(
      message,
    )
  ) {
    return "browser";
  }
  return "unexpected";
}

/**
 * What one line of a page's errors, as voicecap 0.4.1 and 0.5.0 wrote it, comes to: its kind, the
 * pass (and the attempt, for a retry) it names, and the error's own message.
 */
export function kindFromWording(entry: string): {
  kind: ProblemKind;
  pass: PassName | null;
  n: number | null;
  message: string;
} {
  const { kind, pass, n, message } = parseEntry(entry);
  return { kind, pass, n, message };
}

/** One failed attempt at a page, from its record or from a line of its errors. */
interface Failure {
  /** The page's attempt it was: its record's number, or its place among the page's errors. */
  attempt: number;
  /** The attempt the next one was, when it's known there was one. */
  next: number | null;
  /** Whether NVDA and the browser were started again for the next attempt: only a record says. */
  restarted: boolean;
  /** An HTTP 4xx: trying again can't help. */
  refused: boolean;
  /** From the page's failedAttempts, not from its errors. */
  recorded: boolean;
  /**
   * An error from a pass's step that the text doesn't place: it names neither the step nor the key.
   * A page that couldn't be opened, and an HTTP error, have no step to name.
   */
  unnamedStep: boolean;
  /**
   * When it began, in milliseconds, for the order. 0 when it isn't recorded, which puts what's
   * written as text, from a run's earlier sessions, before every record.
   */
  at: number;
  fields: Pick<
    Problem,
    | "n"
    | "startedAt"
    | "endedAt"
    | "kind"
    | "fromWording"
    | "pass"
    | "step"
    | "command"
    | "message"
    | "program"
    | "stack"
    | "record"
  >;
  /** Whether the record has the event log's lines of the attempt. */
  logged: boolean;
  /**
   * Why the page doesn't have the log of a run whose voicecap keeps one, as the record says it (see
   * EventRows); null otherwise.
   */
  gap: string | null;
}

/**
 * A failed attempt from its record, with what the run's event log says of it (`events`, see
 * EventRows) among the record's own lines, by time. Its program, for a foreground loss, is as the
 * record keeps it: a name, or null when voicecap couldn't tell.
 */
function failureOfRecord(
  attempt: AttemptRecord,
  redact: (text: string) => string,
  events: ReturnType<EventRows>,
): Failure {
  const message = redact(attempt.message);
  // A cause code this version doesn't know (a newer voicecap's) is an unexpected error, as the
  // spec says of any other: it's shown as possibly voicecap's own, with its stack.
  const kind = kindOfCause(attempt.cause);
  const stack = kind === "unexpected" && attempt.stack !== undefined ? redact(attempt.stack) : null;
  const program = kind === "foreground" ? programOf(attempt.program, redact) : undefined;
  const own: ProblemRecordRow[] = [
    { time: attempt.startedAt, source: "run.json", entry: `Attempt ${attempt.n} started` },
    { time: attempt.endedAt, source: "run.json", entry: `Failed: ${attempt.cause}: ${message}` },
    ...(stack === null ? [] : [{ time: attempt.endedAt, source: "stack" as const, entry: stack }]),
  ];
  const lines = events !== null && "rows" in events ? events.rows : [];
  const logged = lines.map(({ time, entry }): ProblemRecordRow => ({
    time,
    source: "events.jsonl",
    entry,
  }));
  return {
    attempt: attempt.n,
    next: attempt.n + 1,
    restarted: attempt.restarted,
    refused: attempt.cause === "http" && /^HTTP 4\d\d\b/.test(attempt.message),
    recorded: true,
    unnamedStep: false,
    at: Date.parse(attempt.startedAt) || 0,
    logged: logged.length > 0,
    gap: events !== null && "gap" in events ? events.gap : null,
    fields: {
      n: attempt.n,
      startedAt: attempt.startedAt,
      endedAt: attempt.endedAt,
      kind,
      fromWording: false,
      pass: attempt.pass,
      step: attempt.step,
      command: attempt.command,
      message,
      ...(program === undefined ? {} : { program }),
      stack,
      record: byTime([...own, ...logged]),
    },
  };
}

/**
 * The program a foreground loss's record names: its name, with the home folder replaced, or null
 * when voicecap couldn't tell. Absent when the record has none to give (a run from before 0.11.0,
 * or a driver that didn't look), or a value no voicecap writes.
 */
function programOf(
  program: AttemptRecord["program"],
  redact: (text: string) => string,
): string | null | undefined {
  if (program === null) return null;
  return typeof program === "string" ? redact(program) : undefined;
}

/**
 * A record's lines in the order they were recorded: by time, and, where a line of the event log has
 * the same time as one of the record's own (the attempt began, then its page; it failed, then its
 * page), the record's first, as they're given first and the sort keeps their order. A line whose
 * time can't be read leaves every line where it was.
 */
function byTime(rows: ProblemRecordRow[]): ProblemRecordRow[] {
  const times = rows.map((row) => (row.time === null ? NaN : Date.parse(row.time)));
  if (!times.every(Number.isFinite)) return rows;
  return rows
    .map((row, index) => ({ row, at: times[index] ?? 0 }))
    .sort((a, b) => a.at - b.at)
    .map(({ row }) => row);
}

function failureOfEntry(entry: string, index: number, redact: (text: string) => string): Failure {
  const parsed = parseEntry(entry);
  return {
    attempt: index + 1,
    next: parsed.n === null ? null : parsed.n + 1,
    restarted: false,
    refused: false,
    recorded: false,
    unnamedStep: parsed.inStep,
    at: 0,
    // Runs that wrote their errors as text recorded no event log.
    logged: false,
    gap: null,
    fields: {
      n: parsed.n,
      startedAt: null,
      endedAt: null,
      kind: parsed.kind,
      fromWording: true,
      pass: parsed.pass,
      step: null,
      command: parsed.opening ? "openPage" : null,
      message: redact(parsed.message),
      stack: null,
      record: [{ time: null, source: "run.json", entry: redact(entry) }],
    },
  };
}

/** What a page's problems are worked out from. */
interface PageContext {
  standing: Standing;
  run: RunJson;
  page: PageRecord;
  redact: (text: string) => string;
  eventRows: EventRows;
}

/**
 * The problems of the runs a standing draws on: each failed attempt in their pages, from the
 * page's attempt records when it has them, and otherwise from its errors, whose kind comes from
 * the wording voicecap wrote them in. Oldest first, by when each attempt began; the problems
 * written as text, which don't say, go by run, then page order. `eventRows` gives what a run's
 * event log says of an attempt, for its record; without it, no run has a log.
 */
export function problemsOf(
  standing: Standing,
  options: { home: string; platform: NodeJS.Platform; eventRows?: EventRows },
): ProblemsSection {
  const redact = (text: string) => redactHome(text, options.home, options.platform);
  const eventRows = options.eventRows ?? (() => null);
  const problems: Problem[] = [];
  for (const run of standing.drawnOn) {
    const found = run.pages.flatMap((page) =>
      problemsOfPage({ standing, run, page, redact, eventRows }),
    );
    // The sort is stable. What's written as text says nothing of when (0 here), so it stays in page
    // order, and a page's own attempts stay as its record lists them, oldest first.
    found.sort((a, b) => a.at - b.at);
    problems.push(...found.map((item) => item.problem));
  }
  return {
    problems,
    line: lineOf(problems, standing),
    unexpected: problems.filter((problem) => problem.kind === "unexpected").length,
  };
}

function problemsOfPage(ctx: PageContext): { problem: Problem; at: number }[] {
  const { run, page, redact } = ctx;
  const records = page.failedAttempts ?? [];
  const failures =
    records.length > 0
      ? records.map((attempt) =>
          failureOfRecord(attempt, redact, ctx.eventRows(run, page, attempt)),
        )
      : page.errors.map((entry, index) => failureOfEntry(entry, index, redact));
  if (failures.length === 0) return [];

  const version = run.sessions[0]?.environment?.voicecap.version ?? null;
  return failures.map((failure, index) => {
    const endsPage = page.status === "failed" && index === failures.length - 1;
    const { verdict, again } = verdictOf(ctx, failures, failure, failures.slice(index + 1));
    const problem: Problem = {
      run: run.id,
      page: {
        key: page.key,
        slug: page.slug,
        url: page.url,
        ...(page.label === undefined ? {} : { label: page.label }),
      },
      ...failure.fields,
      happened: happenedOf(failure.fields),
      did: didOf(failure, endsPage, version),
      verdict,
      again,
      effect: effectOf(ctx, failure, endsPage, version),
      notRecorded: notRecordedOf(failure, versionAt(run, failure.fields.startedAt) ?? version),
    };
    return { problem, at: failure.at };
  });
}

/**
 * The voicecap version of the session a time is in: the last to start at or before it. An attempt
 * names no session, but its time places it in one, and a run begun with one voicecap can be resumed
 * with a later one. Null for no time, or a session that recorded no environment.
 */
function versionAt(run: RunJson, time: string | null): string | null {
  const at = time === null ? NaN : Date.parse(time);
  if (!Number.isFinite(at)) return null;
  const session = run.sessions.findLast((each) => Date.parse(each.startedAt) <= at);
  return session?.environment?.voicecap.version ?? null;
}

/** "What happened": the pass, the step, and the key, in plain words, and what went wrong. */
function happenedOf(fields: Failure["fields"]): string {
  const { kind, pass, step, command } = fields;
  const what = kind === "unexpected" ? "an unexpected error came up" : PHRASES[kind];
  const forPass = pass === null ? "" : ` for the ${pass} pass`;
  if (command === "openPage") return `${capitalize(what)} while opening the page${forPass}.`;
  if (step !== null) {
    const key = command === null ? "" : ` (${KEYS[command] ?? command})`;
    return pass === null
      ? `At step ${step}${key}, ${what}.`
      : `During the ${pass} pass, at step ${step}${key}, ${what}.`;
  }
  // The site answered with an error before any pass began.
  if (kind === "http") return `${capitalize(what)} while loading the page${forPass}.`;
  if (pass !== null) return `During the ${pass} pass, ${what}.`;
  return `${capitalize(what)} while the page was being transcribed.`;
}

/**
 * "What voicecap did". A page recorded as failed by this attempt is said so; one tried again is
 * said to be, with a restart only when the record says it finished. A line of errors says only
 * what its wording does, so what else it might have done isn't said.
 */
function didOf(failure: Failure, endsPage: boolean, version: string | null): string {
  if (failure.refused) {
    return "Recorded the page as failed: trying again can't help with an HTTP 4xx";
  }
  if (endsPage) return "Recorded the page as failed";
  if (failure.next === null) return `Not recorded: this run used ${used(version)}.`;
  return failure.restarted
    ? `Threw the step out, restarted NVDA and the browser, and tried again (attempt ${failure.next})`
    : `Tried again (attempt ${failure.next})`;
}

/**
 * What a failure that happened on every attempt points to. Another program, or someone at the
 * computer, is outside voicecap, so it's said to be on the computer, not the page or voicecap.
 */
function pointsTo(kind: ProblemKind): string {
  if (THE_WEBSITE.has(kind)) return "That points to the website.";
  if (OUTSIDE.has(kind)) {
    return "That points to something on this computer, such as another program, rather than a one-off.";
  }
  return "That points to this page, or to voicecap, rather than a one-off.";
}

/** A page's failures by kind, each with its attempt numbers: "a step took too long (attempt 2), …". */
function waysOf(failures: Failure[]): string {
  const attemptsByKind = new Map<ProblemKind, number[]>();
  for (const each of failures) {
    const kind = each.fields.kind;
    attemptsByKind.set(kind, [...(attemptsByKind.get(kind) ?? []), each.attempt]);
  }
  return joinList(
    [...attemptsByKind].map(([kind, attempts]) => `${PHRASES[kind]} (${attemptsText(attempts)})`),
  );
}

/** The verdict for a page that failed the same way on each of its attempts. */
function everyAttempt(kind: ProblemKind, tries: number): { verdict: string; again: "same" } {
  return {
    again: "same",
    verdict: `Yes, on every attempt (${tries} of ${tries}). ${pointsTo(kind)}`,
  };
}

/**
 * "Did it happen again?", decided for each problem by what followed it in the same run.
 *
 * - A later attempt failed the same way: yes (`same`), on the next attempt that did. Then the page
 *   either got through ("then read in full on attempt k"), or every attempt of it failed that way
 *   ("on every attempt", and what that points to), or neither.
 * - No later attempt failed the same way, and the page got through: no, read in full on attempt k.
 * - Later attempts failed in other ways, and the page never got through: yes, in different ways
 *   (`different`), naming them.
 * - The next attempt loaded the page, and voicecap skipped it: no, but it wasn't read.
 * - Nothing followed it, and the page never got through here:
 *   - tried more than once: how it failed over all its attempts, which is the answer for the last
 *     of them as for the rest: on every attempt (`same`), or in different ways (`different`);
 *   - tried once: no, if a later run the standing draws on read the page in full (the next that
 *     did is named), and otherwise not known (`unknown`), naming the last earlier run that read
 *     it, if one did. Not "no": nothing that came after shows it didn't come back, only that the
 *     page wasn't tried again.
 */
function verdictOf(
  ctx: PageContext,
  failures: Failure[],
  failure: Failure,
  later: Failure[],
): { verdict: string; again: Problem["again"] } {
  const { standing, run, page } = ctx;
  const kind = failure.fields.kind;
  const sameEveryTime = failures.every((each) => each.fields.kind === kind);

  const repeat = later.find((next) => next.fields.kind === kind);
  if (repeat) {
    if (page.status === "done") {
      return {
        again: "same",
        verdict: `Yes, on attempt ${repeat.attempt}, then read in full on attempt ${page.attempts}.`,
      };
    }
    if (page.status === "failed" && sameEveryTime) return everyAttempt(kind, failures.length);
    return { again: "same", verdict: `Yes, on attempt ${repeat.attempt}.` };
  }

  if (page.status === "done") {
    // The page's attempts end with the one that read it, and the one before it is the last to fail.
    const fresh = failures.at(-1)?.restarted ? ", with NVDA and the browser started fresh" : "";
    return { again: "no", verdict: `No: read in full on attempt ${page.attempts}${fresh}.` };
  }
  if (later.length > 0) {
    return { again: "different", verdict: `Yes, in different ways: ${waysOf(later)}.` };
  }
  if (page.status === "skipped") {
    return {
      again: "no",
      verdict: `No: attempt ${page.attempts} loaded the page, and voicecap skipped it.`,
    };
  }

  if (failures.length > 1) {
    return sameEveryTime
      ? everyAttempt(kind, failures.length)
      : { again: "different", verdict: `Yes, in different ways: ${waysOf(failures)}.` };
  }
  // Only what came after the failure can say it didn't come back: the next run that read the page
  // in full. A run before it shows the page could be read, not that the failure didn't recur.
  const at = standing.drawnOn.indexOf(run);
  const readIt = (other: RunJson) =>
    other.pages.some((there) => there.key === page.key && there.status === "done");
  const after = standing.drawnOn.slice(at + 1).find(readIt);
  if (after) return { again: "no", verdict: `No: read in full in run ${after.id}.` };
  const before = standing.drawnOn.slice(0, Math.max(at, 0)).findLast(readIt);
  return {
    again: "unknown",
    verdict:
      before === undefined
        ? "Not known: this run didn't try the page again, and no other run read it in full."
        : `Not known: this run didn't try the page again; run ${before.id}, before it, read it in full.`,
  };
}

/**
 * "Effect on the results": which transcripts the page shows, and where this run kept partial
 * ones. The last attempt of a failed page left what it wrote in pages/<slug>/. An attempt that a
 * later one followed had it moved into attempts/<slug>/ (the folder's numbers don't match the
 * attempts', so it's not numbered here), if it left any: an attempt record lists no files, so that
 * is always hedged. A run's errors say so only from 0.3.0 on, the first version to keep them.
 */
function effectOf(
  ctx: PageContext,
  failure: Failure,
  endsPage: boolean,
  version: string | null,
): string {
  const { standing, run, page } = ctx;
  const parts: string[] = [];
  if (page.status === "skipped") {
    parts.push("No transcripts from this run: the page was skipped.");
  } else if (page.status !== "done") {
    parts.push("No transcripts from this run: the page failed.");
  } else {
    const shown = standing.pages.find((listed) => listed.key === page.key)?.shown ?? null;
    if (shown === null) {
      parts.push("The page is no longer on the list, so its transcripts aren't shown.");
    } else if (shown.run === run) {
      parts.push(`The transcripts shown are from attempt ${page.attempts}.`);
    } else {
      parts.push(
        `The transcripts shown are from run ${shown.run.id}, a later run that read the page in full.`,
      );
    }
  }
  if (endsPage && Object.keys(page.files).length > 0) {
    parts.push(`The partial transcripts it left are in pages/${page.slug}/.`);
  }
  if (!endsPage && (failure.recorded || keepsEarlierAttempts(version))) {
    parts.push(
      `Earlier attempts' partial transcripts, if any, are kept in attempts/${page.slug}/ in the run's folder.`,
    );
  }
  return parts.join(" ");
}

/**
 * Whether the voicecap that made a run kept an earlier attempt's folder, in attempts/<slug>/: 0.3.0
 * (src/run/attempts.ts) and every version since. An unknown version counts as an earlier one.
 */
function keepsEarlierAttempts(version: string | null): boolean {
  const match = version === null ? null : /^(\d+)\.(\d+)/.exec(version);
  if (!match) return false;
  return Number(match[1]) > 0 || Number(match[2]) >= 3;
}

/**
 * What a run didn't record, said where it matters, and never put down to a voicecap that records
 * it. `version` is the voicecap of the attempt's session.
 * - The step and the key: for an error from a pass's step, written as text, which gives neither.
 * - Which program came to the front: for a foreground loss whose record has none. A voicecap that
 *   looks (0.11.0 on) left it out because the run's screen reader driver didn't look; an older one
 *   never looked. A record that names the program, or says Windows didn't, says so after what
 *   happened.
 * - The event log: for a problem whose record has none of its lines. From a voicecap that keeps the
 *   log, why: the page doesn't have the log, for the reason the run's evidence gives (`gap`), or the
 *   log has no line of the attempt. From an older voicecap, that it kept none.
 * - NVDA's own log: for every problem, since no voicecap keeps it yet, said by the run's voicecap as
 *   the run's evidence says it.
 */
function notRecordedOf(failure: Failure, version: string | null): string[] {
  const notRecorded = (what: string) => `${what}: not recorded: this run used ${used(version)}.`;
  const { unrecorded } = PROBLEMS_TEXT;
  const keeps = keepsEventLog(version);
  const program =
    failure.fields.kind === "foreground" && failure.fields.program === undefined
      ? [keeps ? PROBLEMS_TEXT.program.notLooked : notRecorded(unrecorded.program)]
      : [];
  const eventLog = failure.logged
    ? []
    : !keeps
      ? null
      : [failure.gap ?? TIMELINE_TEXT.noLinesOfAttempt];
  return [
    ...(failure.unnamedStep ? [notRecorded(unrecorded.stepAndKey)] : []),
    ...program,
    ...(eventLog === null
      ? [notRecorded(unrecorded.logs)]
      : [...eventLog, notRecorded(unrecorded.nvdaLog)]),
  ];
}

/** The voicecap a run used, for a sentence about what it didn't record. */
function used(version: string | null): string {
  return version === null ? "an earlier version of voicecap" : `voicecap ${version}`;
}

/** The verdict line that opens the section. */
function lineOf(problems: Problem[], standing: Standing): string {
  const total = problems.length;
  if (total === 0) return noProblemsLine(standing);

  const counts = new Map<ProblemKind, number>();
  for (const { kind } of problems) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  // Most numerous first; the table of kinds' order among those that tie.
  const kinds = [...counts].sort(
    ([a, more], [b, fewer]) => fewer - more || KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b),
  );
  const named =
    kinds.length === 1
      ? kinds.map(([kind]) => PHRASES[kind]).join("")
      : joinList(kinds.map(([kind, count]) => `${PHRASES[kind]} (${count})`));
  const count = total === 1 ? "1 problem" : `${total} problems`;
  // One of three phrasings, by whether there is one problem, two, or more.
  const byCount = (one: string, two: string, more: string) =>
    total === 1 ? one : total === 2 ? two : more;
  const outside = kinds.every(([kind]) => OUTSIDE.has(kind));
  const whose = outside
    ? byCount(", outside voicecap", ", both outside voicecap", ", all outside voicecap")
    : "";

  // What became of them. Each answer is counted on its own, so each count is true: a problem that
  // wasn't tried again is in neither the count that happened again nor the count that didn't.
  const answers: Record<Problem["again"], number> = { no: 0, same: 0, different: 0, unknown: 0 };
  for (const { again } of problems) answers[again]++;
  const happened = answers.same + answers.different;
  const counted: string[] = [];
  if (happened > 0) counted.push(`${happened} happened again`);
  if (answers.no > 0) counted.push(`${answers.no} didn't happen again`);
  if (answers.unknown > 0) {
    counted.push(`${answers.unknown} ${answers.unknown === 1 ? "wasn't" : "weren't"} tried again`);
  }
  const again =
    answers.no === total
      ? byCount("It didn't happen again", "Neither happened again", "None happened again")
      : answers.unknown === total
        ? byCount("It wasn't tried again", "Neither was tried again", "None was tried again")
        : happened === total
          ? byCount("It happened again", "Both happened again", "All happened again")
          : joinList(counted);

  const unexpected = counts.get("unexpected") ?? 0;
  const itself = "the kind that could mean a problem in voicecap itself";
  const closing =
    unexpected === 0
      ? `${byCount("It wasn't", "Neither was", "None was")} an unexpected error, ${itself}.`
      : unexpected === 1
        ? `1 was an unexpected error, ${itself}: see its record.`
        : `${unexpected} were unexpected errors, ${itself}: see their records.`;
  const programs = programsLine(problems);
  return `${count}${whose}: ${named}.${programs === null ? "" : ` ${programs}`} ${again}. ${closing}`;
}

/**
 * The verdict line's sentence on which programs came to the front: each program the problems of
 * another window taking the screen name, with how often, the most often first (among those as often
 * as each other, the first to come to the front first), then how many of those problems name none
 * (voicecap couldn't tell, or the run didn't record it). None when no problem names a program, as
 * in every run from before voicecap 0.11.0, whose line stays as it was.
 */
function programsLine(problems: Problem[]): string | null {
  const counts = new Map<string, number>();
  let unnamed = 0;
  for (const { kind, program } of problems) {
    if (kind !== "foreground") continue;
    if (typeof program === "string") counts.set(program, (counts.get(program) ?? 0) + 1);
    else unnamed++;
  }
  if (counts.size === 0) return null;
  // The sort is stable, so programs as often as each other stay in the order they came.
  const often = [...counts]
    .sort(([, more], [, fewer]) => fewer - more)
    .map(([program, times]) => PROBLEMS_TEXT.programs.often(program, times));
  return PROBLEMS_TEXT.programs.line(joinList(often), counts.size, unnamed);
}

/**
 * The line when nothing failed. "Every page was read in full" is only said when it's so: a page the
 * latest run skipped (its response wasn't a page, say) wasn't read there; a page whose read stopped
 * before its end (at the step limit, say) was transcribed, but not read in full; and no run counting
 * at all leaves no pages to speak of. A skipped page is "not read" only when no earlier run's
 * transcripts are shown for it; with them, the page was read, and the line says only that the
 * latest run skipped it.
 */
function noProblemsLine(standing: Standing): string {
  if (standing.latest === null) return "No problems to report: no live run counts yet.";
  const skipped = standing.pages.filter((page) => page.latestFailure?.page.status === "skipped");
  const stopped = (stop: keyof typeof READ_STOPPED) =>
    standing.pages.filter(({ shown }) => shown !== null && readStoppedOf(shown.page) === stop)
      .length;
  const stops = (["step-cap", "repeat-limit"] as const).map(
    (stop) => [stop, stopped(stop)] as const,
  );
  if (skipped.length === 0 && stops.every(([, count]) => count === 0)) {
    return "No problems during the runs: every page was read in full.";
  }
  const notRead = skipped.filter((page) => page.shown === null).length;
  const readBefore = skipped.length - notRead;
  const pages = (count: number) => (count === 1 ? "1 page was" : `${count} pages were`);
  const said = [
    ...(notRead > 0 ? [`${pages(notRead)} skipped, not read.`] : []),
    ...(readBefore > 0 ? [`${pages(readBefore)} skipped in the latest run.`] : []),
    ...stops.flatMap(([stop, count]) =>
      count === 0
        ? []
        : [
            `${pages(count)} transcribed; ${count === 1 ? "its read" : "their reads"} ${READ_STOPPED[stop]}.`,
          ],
    ),
  ];
  return `No problems during the runs: no attempt failed. ${said.join(" ")}`;
}

/** "a", "a and b", "a, b, and c": a list of names. */
function joinList(items: string[]): string {
  const last = items.at(-1);
  return last === undefined || items.length === 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")}, and ${last}`;
}

/** "attempt 2", "attempts 1 and 3", "attempts 1, 2, and 4". */
function attemptsText(attempts: number[]): string {
  if (attempts.length === 1) return `attempt ${attempts.join("")}`;
  const last = attempts.at(-1);
  return attempts.length === 2
    ? `attempts ${attempts.join(" and ")}`
    : `attempts ${attempts.slice(0, -1).join(", ")}, and ${last}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
