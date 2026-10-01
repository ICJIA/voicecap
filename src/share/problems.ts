/**
 * The problems during the runs: every failed attempt in the runs a standing draws on, each with
 * its kind, what voicecap did, whether it happened again, what it did to the results, and the
 * record of it. Pure: it works from run records already read, and reads no files.
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
  source: "run.json" | "stack";
  entry: string;
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
   *   attempt; or it was the page's only attempt, and another run the standing draws on read the
   *   page in full;
   * - "unknown": it was the page's only attempt in the run, and no other run read the page in full,
   *   so nothing says whether it would have happened again.
   */
  again: "no" | "same" | "different" | "unknown";
  /** "Effect on the results". */
  effect: string;
  record: ProblemRecordRow[];
  /** What this run didn't record: the program in front, the event log, and NVDA's own log. */
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
    meaning: "voicecap can't tell why. NVDA's own log from that moment is shown.",
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
    | "stack"
    | "record"
  >;
}

function failureOfRecord(attempt: AttemptRecord, redact: (text: string) => string): Failure {
  const message = redact(attempt.message);
  // A cause code this version doesn't know (a newer voicecap's) is an unexpected error, as the
  // spec says of any other: it's shown as possibly voicecap's own, with its stack.
  const kind = KIND_OF_CAUSE[attempt.cause] ?? "unexpected";
  const stack = kind === "unexpected" && attempt.stack !== undefined ? redact(attempt.stack) : null;
  return {
    attempt: attempt.n,
    next: attempt.n + 1,
    restarted: attempt.restarted,
    refused: attempt.cause === "http" && /^HTTP 4\d\d\b/.test(attempt.message),
    recorded: true,
    unnamedStep: false,
    at: Date.parse(attempt.startedAt) || 0,
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
      stack,
      record: [
        { time: attempt.startedAt, source: "run.json", entry: `Attempt ${attempt.n} started` },
        {
          time: attempt.endedAt,
          source: "run.json",
          entry: `Failed: ${attempt.cause}: ${message}`,
        },
        ...(stack === null
          ? []
          : [{ time: attempt.endedAt, source: "stack" as const, entry: stack }]),
      ],
    },
  };
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
}

/**
 * The problems of the runs a standing draws on: each failed attempt in their pages, from the
 * page's attempt records when it has them, and otherwise from its errors, whose kind comes from
 * the wording voicecap wrote them in. Oldest first, by when each attempt began; the problems
 * written as text, which don't say, go by run, then page order.
 */
export function problemsOf(
  standing: Standing,
  options: { home: string; platform: NodeJS.Platform },
): ProblemsSection {
  const redact = (text: string) => redactHome(text, options.home, options.platform);
  const problems: Problem[] = [];
  for (const run of standing.drawnOn) {
    const found = run.pages.flatMap((page) => problemsOfPage({ standing, run, page, redact }));
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
      ? records.map((attempt) => failureOfRecord(attempt, redact))
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
      notRecorded: notRecordedOf(failure, version),
    };
    return { problem, at: failure.at };
  });
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
 *   - tried once: no, if another run the standing draws on read the page in full, and otherwise
 *     not known (`unknown`). Not "no": nothing shows it didn't come back, only that the page wasn't
 *     tried again.
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
  const elsewhere = standing.drawnOn.findLast(
    (other) =>
      other !== run &&
      other.pages.some((there) => there.key === page.key && there.status === "done"),
  );
  if (elsewhere) return { again: "no", verdict: `No: read in full in run ${elsewhere.id}.` };
  return {
    again: "unknown",
    verdict: "Not known: this run didn't try the page again, and no other run read it in full.",
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
 * What a run didn't record, said where it matters. An error from a pass's step, written as text,
 * doesn't give the step that failed or the key it pressed. The program in front is for a foreground
 * loss only, and the event log and NVDA's own log are for every problem.
 */
function notRecordedOf(failure: Failure, version: string | null): string[] {
  const notRecorded = (what: string) => `${what}: not recorded: this run used ${used(version)}.`;
  return [
    ...(failure.unnamedStep ? [notRecorded("The step and the key")] : []),
    ...(failure.fields.kind === "foreground"
      ? [notRecorded("Which program came to the front")]
      : []),
    notRecorded("The event log and NVDA's own log"),
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
  return `${count}${whose}: ${named}. ${again}. ${closing}`;
}

/**
 * The line when nothing failed. "Every page was read in full" is only said when it's so: a page the
 * latest run skipped (its response wasn't a page, say) wasn't read there, and no run counting at
 * all leaves no pages to speak of. A skipped page is "not read" only when no earlier run's
 * transcripts are shown for it; with them, the page was read, and the line says only that the
 * latest run skipped it.
 */
function noProblemsLine(standing: Standing): string {
  if (standing.latest === null) return "No problems to report: no live run counts yet.";
  const skipped = standing.pages.filter((page) => page.latestFailure?.page.status === "skipped");
  if (skipped.length === 0) return "No problems during the runs: every page was read in full.";
  const notRead = skipped.filter((page) => page.shown === null).length;
  const readBefore = skipped.length - notRead;
  const pages = (count: number) => (count === 1 ? "1 page was" : `${count} pages were`);
  const said = [
    ...(notRead > 0 ? [`${pages(notRead)} skipped, not read.`] : []),
    ...(readBefore > 0 ? [`${pages(readBefore)} skipped in the latest run.`] : []),
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
