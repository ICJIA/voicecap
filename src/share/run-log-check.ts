/**
 * A run's NVDA log, checked against the transcripts of the pages the run read: it pairs each of the
 * run's NVDA sessions with its copy of NVDA's log, checks the steps read in that session against
 * that copy (checkAgainstLog, ./log-check.ts), and adds the sessions up. Pure: it works from what
 * the loader read.
 *
 * A session runs from a `screen-reader-started` in the run's event log to the next
 * `screen-reader-stopped`, and the `screen-reader-log` event after that stop names its copy, or the
 * reason there is none. A copy is never paired with a session by its number: one session without a
 * copy would shift every later one onto the wrong log. A log without those events (a driver that
 * records no start or stop of its screen reader) has a session for each stretch of pages that ends
 * with a `screen-reader-log` event, and a voicecap session's start ends the one before it.
 *
 * Each page was read in one kept attempt, whose window the event log gives as its `page-started` to
 * its `page-finished`, and each kept attempt belongs to the session it started in. A failed
 * attempt's record gives its window, and it belongs to the session its start falls in; its speech is
 * set aside. A session is checked only with the copy its event names, and only when the copy has
 * speech in it; what isn't checked is counted, with why, and never listed as a difference.
 */
import { splitLogEntries } from "../manual/nvda-log.js";
import {
  PASS_NAMES,
  type DriverCommand,
  type PageRecord,
  type PassName,
  type RunEvent,
  type RunJson,
  type StepRecord,
} from "../model.js";
import { checkAgainstLog, type LogCheck, type PassSteps } from "./log-check.js";
import { isEventTime } from "./timeline.js";

/** The key a step's command presses, as the screen reader's own log names it (NVDA's). */
export type GestureOf = (command: DriverCommand) => string | null;

/**
 * Why some steps weren't checked against NVDA's log:
 * - `none`: the session's copy wasn't kept, and the log says nothing of why: it ended without
 *   voicecap stopping NVDA, or its stop has no `screen-reader-log` event;
 * - `reason`: the log says why none was kept (`detail`);
 * - `altered`: the copy the log names isn't among those read: the run's record doesn't list it, or
 *   its file is missing or isn't as the record has it;
 * - `silent`: the copy has no speech in it (NVDA's logging level was below input and output);
 * - `initial`: the run kept only the first thing NVDA said for each step, so a step's line can't be
 *   compared with all that NVDA said;
 * - `times`: the times of the pages couldn't be read;
 * - `unread`: the steps' transcripts couldn't be read;
 * - `placed`: the event log doesn't show when the page was read.
 */
export type WhyNotChecked =
  "none" | "reason" | "altered" | "silent" | "initial" | "times" | "unread" | "placed";

/** Some steps that weren't checked against NVDA's log, and why. */
export interface NotChecked {
  steps: number;
  /**
   * When the NVDA session they were read in started (the time of its `screen-reader-started`); null
   * for steps that belong to no session the log shows (`unread` and `placed`).
   */
  from: string | null;
  why: WhyNotChecked;
  /** For `reason`: what the log says, with the home folder replaced. Null otherwise. */
  detail: string | null;
}

/** What a run's NVDA log came to: the sessions checked, added up, and the steps that weren't. */
export interface RunLogCheck {
  /** Null when no session was checked. */
  check: LogCheck | null;
  /** In the order of the sessions, then the steps that belong to none. */
  notChecked: NotChecked[];
}

export interface RunLogInput {
  run: RunJson;
  /** The run's event log. */
  events: readonly RunEvent[];
  /** The copies of NVDA's log the loader read, by their path from the run's folder. */
  copies: ReadonlyMap<string, string>;
  /** A pass's steps in the run, or null when they can't be read. */
  steps: (slug: string, pass: PassName) => StepRecord[] | null;
  gestureOf: GestureOf;
  /** A page as the lists of differences name it. */
  pageName: (page: PageRecord) => string;
  /** Replaces the home folder in what the page shows. */
  redact: (text: string) => string;
}

/** The start of what checkAgainstLog says when it can't place a window (its times can't be read). */
const CANT_CHECK = "NVDA's log can't be checked:";

/** What the event log shows of one of voicecap's NVDA sessions. */
export interface NvdaSession {
  /** The time of its start. */
  from: string;
  /** Whether the log shows voicecap stopping it. */
  stopped: boolean;
  /** What the `screen-reader-log` after its stop says: undefined when the log has none. */
  log: { file: string | null; reason: string | null } | undefined;
}

/** The kept attempt at a page, and the session it was read in (by its place among the sessions). */
interface KeptAttempt {
  from: string;
  to: string;
  session: number;
}

/** An event's fields, read for what they are. */
type Fields = Record<string, unknown>;

const fieldsOf = (event: RunEvent): Fields => event;

/**
 * The NVDA sessions of a run's event log, and the kept attempt at each page: a page's
 * `page-finished` that says it was read in full, with the latest `page-started` for that page before
 * it. An attempt Ctrl+C stopped has a start and no finish, and the next attempt at the page starts
 * again, so the latest start is the kept attempt's. The events are those whose time can be read
 * (`isEventTime`). A problem's record finds the session an attempt ran in by these sessions too
 * (./nvda-log-rows.ts).
 */
export function sessionsOf(events: readonly RunEvent[]): {
  sessions: NvdaSession[];
  kept: Map<string, KeptAttempt>;
} {
  const sessions: NvdaSession[] = [];
  const kept = new Map<string, KeptAttempt>();
  const started = new Map<string, { at: string; session: number }>();
  const begin = (at: string): NvdaSession => {
    const session: NvdaSession = { from: at, stopped: false, log: undefined };
    sessions.push(session);
    return session;
  };
  const closed = (session: NvdaSession) => session.stopped || session.log !== undefined;
  let current: NvdaSession | null = null;
  for (const event of events) {
    const fields = fieldsOf(event);
    switch (event.type) {
      case "run-started":
        // A voicecap session's start: whatever NVDA ran before it ran in a session before this one.
        current = null;
        break;
      case "screen-reader-started":
        current = begin(event.at);
        break;
      case "screen-reader-stopped":
        if (current !== null && !current.stopped) current.stopped = true;
        break;
      case "screen-reader-log": {
        // The copy of the session that has just stopped; a log with no stops has a copy after
        // each stretch of pages.
        const target: NvdaSession =
          current !== null && current.log === undefined ? current : begin(event.at);
        current = target;
        target.log = {
          file: typeof fields.file === "string" ? fields.file : null,
          reason:
            typeof fields.reason === "string" && fields.reason.trim() !== ""
              ? fields.reason.trim()
              : null,
        };
        break;
      }
      case "page-started": {
        if (typeof fields.page !== "string") break;
        const target: NvdaSession =
          current !== null && !closed(current) ? current : begin(event.at);
        current = target;
        started.set(fields.page, { at: event.at, session: sessions.indexOf(target) });
        break;
      }
      case "page-finished": {
        if (typeof fields.page !== "string") break;
        const start = started.get(fields.page);
        if (start !== undefined && fields.status === "done") {
          kept.set(fields.page, { from: start.at, to: event.at, session: start.session });
        }
        started.delete(fields.page);
        break;
      }
    }
  }
  return { sessions, kept };
}

/** The passes of a run in the order it read them: its settings', then any a page has beyond them. */
function passesOf(run: RunJson): PassName[] {
  const settings: { passes?: unknown } | undefined = run.settings;
  const given = Array.isArray(settings?.passes)
    ? (settings.passes as unknown[]).filter((pass): pass is PassName =>
        PASS_NAMES.includes(pass as PassName),
      )
    : [];
  return [...new Set([...given, ...PASS_NAMES])];
}

/** Whether a value is a step as voicecap writes one: what the comparison reads of it is there. */
function isStep(value: unknown): value is StepRecord {
  if (typeof value !== "object" || value === null) return false;
  const step = value as Record<string, unknown>;
  return (
    typeof step.n === "number" &&
    typeof step.command === "string" &&
    typeof step.spoken === "string" &&
    typeof step.durationMs === "number" &&
    Number.isFinite(step.durationMs) &&
    typeof step.offsetMs === "number" &&
    Number.isFinite(step.offsetMs)
  );
}

/** A pass's steps when every one is a step, else null, as for steps that can't be read. */
function usable(steps: StepRecord[] | null): StepRecord[] | null {
  return Array.isArray(steps) && steps.every(isStep) ? steps : null;
}

/**
 * The windows of a run's failed attempts, by the place of the session each began in: the latest
 * session that had started when it did. An attempt whose start isn't a time, or that began before
 * any session the log shows, belongs to none: no copy's speech is set aside for it, and the passes'
 * own windows keep it out of every step.
 */
function thrownOutBy(
  run: RunJson,
  sessions: readonly NvdaSession[],
): Map<number, PassSteps["within"][]> {
  const starts = sessions.map((session) => Date.parse(session.from));
  const windows = new Map<number, PassSteps["within"][]>();
  for (const page of run.pages) {
    for (const attempt of Array.isArray(page.failedAttempts) ? page.failedAttempts : []) {
      const began = Date.parse(attempt.startedAt);
      if (!Number.isFinite(began)) continue;
      const place = starts.findLastIndex((start) => start <= began);
      if (place === -1) continue;
      const list = windows.get(place) ?? [];
      list.push({ from: attempt.startedAt, to: attempt.endedAt });
      windows.set(place, list);
    }
  }
  return windows;
}

/**
 * Whether a copy has any speech in it: an input/output entry that starts "Speaking " (see
 * ./log-check.ts). A copy of NVDA's log at a level below input and output has none.
 */
function hasSpeech(copy: string): boolean {
  return splitLogEntries(copy).some(
    (entry) => entry.level === "IO" && entry.message.startsWith("Speaking "),
  );
}

/** The sessions' checks added up: every count, and every list in the order of the sessions. */
function added(checks: LogCheck[], redact: (text: string) => string): LogCheck | null {
  if (checks.length === 0) return null;
  const total = (count: (check: LogCheck) => number) =>
    checks.reduce((sum, check) => sum + count(check), 0);
  const said = (list: LogCheck["onlyInLog"]) =>
    list.map((line) => ({ ...line, text: redact(line.text) }));
  return {
    transcriptLines: total((check) => check.transcriptLines),
    logLines: total((check) => check.logLines),
    agree: total((check) => check.agree),
    onlyInLog: checks.flatMap((check) => said(check.onlyInLog)),
    onlyInTranscripts: checks.flatMap((check) => said(check.onlyInTranscripts)),
    outside: total((check) => check.outside),
  };
}

/**
 * Check a run's NVDA log against its transcripts, session by session. The steps are those of every
 * page the run read in full: a pass whose steps can't be read, or a page the event log doesn't show
 * the reading of, is not checked and counted as such (`unread` and `placed`). Each NVDA session with
 * steps is checked once, with its own copy and its own failed attempts, when it has a copy with
 * speech in it and the run kept all that NVDA said for each step; otherwise its steps are counted,
 * with why (WhyNotChecked), and never listed.
 */
export function checkRunAgainstLog(input: RunLogInput): RunLogCheck {
  const { run } = input;
  const { sessions, kept } = sessionsOf(input.events.filter((event) => isEventTime(event.at)));
  const read = new Map<number, PassSteps[]>();
  let unread = 0;
  let placed = 0;
  const order = passesOf(run);
  for (const page of run.pages) {
    if (page.status !== "done") continue;
    const attempt = kept.get(page.url);
    for (const pass of order) {
      const summary = page.passes?.[pass];
      if (summary === undefined) continue;
      const steps = usable(input.steps(page.slug, pass));
      if (steps === null) {
        unread += typeof summary.steps === "number" ? summary.steps : 0;
      } else if (attempt === undefined) {
        placed += steps.length;
      } else {
        const list = read.get(attempt.session) ?? [];
        list.push({
          page: input.pageName(page),
          pass,
          steps,
          within: { from: attempt.from, to: attempt.to },
        });
        read.set(attempt.session, list);
      }
    }
  }

  const settings: { capture?: unknown } | undefined = run.settings;
  const initial = settings?.capture === "initial";
  const thrownOut = thrownOutBy(run, sessions);
  const checks: LogCheck[] = [];
  const notChecked: NotChecked[] = [];
  for (const [place, session] of sessions.entries()) {
    const steps = read.get(place) ?? [];
    const count = steps.reduce((sum, pass) => sum + pass.steps.length, 0);
    if (count === 0) continue;
    const skip = (why: WhyNotChecked, detail: string | null = null) => {
      notChecked.push({ steps: count, from: session.from, why, detail });
    };
    const { log } = session;
    if (log === undefined) {
      skip("none");
      continue;
    }
    if (log.file === null) {
      if (log.reason === null) skip("none");
      else skip("reason", input.redact(log.reason));
      continue;
    }
    const copy = input.copies.get(log.file);
    if (copy === undefined) {
      skip("altered");
      continue;
    }
    if (initial) {
      skip("initial");
      continue;
    }
    if (!hasSpeech(copy)) {
      skip("silent");
      continue;
    }
    try {
      checks.push(
        checkAgainstLog({
          logs: [copy],
          steps,
          thrownOut: thrownOut.get(place) ?? [],
          gestureOf: input.gestureOf,
        }),
      );
    } catch (error) {
      // A window whose times can't be read: the only thing the comparison refuses.
      if (!(error instanceof Error) || !error.message.startsWith(CANT_CHECK)) throw error;
      skip("times");
    }
  }
  if (placed > 0) notChecked.push({ steps: placed, from: null, why: "placed", detail: null });
  if (unread > 0) notChecked.push({ steps: unread, from: null, why: "unread", detail: null });
  return { check: added(checks, input.redact), notChecked };
}
