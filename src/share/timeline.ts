/**
 * A run's event log (events.jsonl) as the page and its Word copy show it: one timeline for each
 * session, since a resumed run's sessions can be days apart, each with the spans its chart draws
 * (the lock, voicecap's screen reader, the computer's own, and each attempt at a page), the
 * sentences that sum it up, and a row in the page's words for every event; the sessions of the run
 * the log has no line of, each with why; the restarts the run's facts count; and what the log says
 * of one attempt at a page, for its problem's record. Pure: it works from the events the loader read
 * (./load.ts).
 *
 * voicecap wrote the log as the run went, but a line is checked only for its time and its type as
 * it's read (readEventLog), and a later voicecap may write fields this one doesn't know. So every
 * other field is read for what it is, and an event whose fields can't be read shows as its type, as
 * one of a type this version doesn't know does. An event whose time isn't a time is a line that
 * couldn't be read. Nothing is said that the log doesn't show: what the log doesn't close (the lock
 * not let go, a process not stopped, the computer's own screen reader not started again) runs until
 * the session's last event, and a start again with no shutdown before it draws nothing.
 *
 * A window's title, which the log keeps for a lost foreground, is never read here: only the
 * program's name, with the home folder replaced, as is everything else taken from the log.
 */
import type { NewRunEvent, RunEvent, RunJson } from "../model.js";
import { clock, names } from "./format.js";
import { keepsEventLog, kindOfCause, PHRASES } from "./problems.js";
import { EVENT_TEXT, TIMELINE_TEXT } from "./text.js";

/** What an event's words need of its run. */
export interface EventWords {
  /** The run's screen reader, as its environment records it: "NVDA". */
  screenReader: string;
  /** A page, by the address voicecap read (PageRecord.url), as the page names it. */
  pageName: (url: string) => string;
  /** A page's number in the run, from 1; 0 for an address the run doesn't have. */
  pageNumber: (url: string) => number;
  /** The home folder replaced, in what's taken from the log. */
  redact: (text: string) => string;
}

/** Something that lasted, from when it began to when it ended: local ISO times, as the log has them. */
export interface Span {
  from: string;
  to: string;
}

/**
 * What an event is about: the run, the lock, voicecap's screen reader, the computer's own, the
 * browser, a page, or a failure: a page's, or what makes one fail (the computer locked, or another
 * window came to the front).
 */
export type EventKind = "run" | "lock" | "screen-reader" | "own" | "browser" | "page" | "fail";

/** A session of a run, as its event log tells it. */
export interface SessionTimeline {
  /** The session's number in the run, from 1. */
  session: number;
  /** Its first event's time and its last. */
  from: string;
  to: string;
  /** The sentences above the chart, each where it applies: with the table, the chart's text. */
  summary: string[];
  /** Each time voicecap held the screen reader's lock. */
  lock: Span[];
  /** Each process of voicecap's screen reader, with its id when the log has it. */
  screenReader: (Span & { pid: number | null })[];
  /** The computer's own screen reader, off while voicecap ran. */
  own: Span[];
  /** Each attempt at a page, numbered as the page is in the run, and whether it failed. */
  pages: (Span & { n: number; failed: boolean })[];
  /** Every event of the session, in the order the log has them, in the page's words. */
  rows: { time: string; text: string; kind: EventKind }[];
  /** The lines of the log that couldn't be read: all on the run's last session (see timelinesOf). */
  unreadable: number;
}

/** An event's fields, read for what they are. */
type Fields = Record<string, unknown>;

const fieldsOf = (event: RunEvent): Fields => event;

/** A whole number above zero, or null: a process id, an attempt, a session. */
function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

/** Words, trimmed, or null for none. */
function words(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** A local ISO time, as voicecap writes the log's, to the second or below, with its offset. */
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[+-]\d{2}:\d{2}|Z)$/;

/** Whether an event's time can be placed and shown: a local ISO time of a real moment. */
export function isEventTime(at: string): boolean {
  if (!TIME.test(at) || !Number.isFinite(Date.parse(at))) return false;
  try {
    clock(at);
    return true;
  } catch {
    return false;
  }
}

/** What each event is about, by its type. */
const KINDS: Record<NewRunEvent["type"], EventKind> = {
  "run-started": "run",
  "run-ended": "run",
  "screen-reader-lock-taken": "lock",
  "screen-reader-lock-released": "lock",
  "screen-reader-started": "screen-reader",
  "screen-reader-stopped": "screen-reader",
  "screen-reader-restarting": "screen-reader",
  "own-screen-reader-closed": "own",
  "own-screen-reader-restarted": "own",
  "browser-launched": "browser",
  "browser-closed": "browser",
  "browser-handed-over": "browser",
  "page-started": "page",
  "page-finished": "page",
  "page-failed": "fail",
  "computer-locked": "fail",
  "foreground-lost": "fail",
};

/** An event's kind; one of a type this version doesn't know is the run's. */
function kindOf(type: string): EventKind {
  return Object.hasOwn(KINDS, type) ? KINDS[type as NewRunEvent["type"]] : "run";
}

/**
 * The words an event needs of its run: its screen reader, as its latest session's environment
 * records it (or "screen reader", where none does), and each of its pages by `name` (how the page
 * names one) and its place in the run. An address the run doesn't have is its own name, with the
 * home folder replaced, and has no number.
 */
export function eventWordsOf(
  run: RunJson,
  name: (page: { label?: string; url: string }) => string,
  redact: (text: string) => string,
): EventWords {
  const pages = new Map<string, { page: RunJson["pages"][number]; n: number }>();
  run.pages.forEach((page, index) => {
    if (!pages.has(page.url)) pages.set(page.url, { page, n: index + 1 });
  });
  const latest = run.sessions.findLast((session) => session.environment?.screenReader);
  const reader = latest?.environment?.screenReader?.name.trim();
  return {
    screenReader: reader || TIMELINE_TEXT.someScreenReader,
    pageName: (url) => {
      const found = pages.get(url);
      return found === undefined ? redact(url) : name(found.page);
    },
    pageNumber: (url) => pages.get(url)?.n ?? 0,
    redact,
  };
}

/** An event's page, by its number in the run and its name: null when it names none the run has. */
function pageOf(event: Fields, said: EventWords): { url: string; n: number; name: string } | null {
  if (typeof event.page !== "string") return null;
  const n = said.pageNumber(event.page);
  return n > 0 ? { url: event.page, n, name: said.pageName(event.page) } : null;
}

/** Why a session ended, in the page's words; null for a reason this version doesn't know. */
function endReasonOf(reason: unknown): string | null {
  const { endReasons } = EVENT_TEXT;
  return typeof reason === "string" && Object.hasOwn(endReasons, reason)
    ? endReasons[reason as keyof typeof endReasons]
    : null;
}

/** Why voicecap restarted the screen reader, in the page's words; null for one it can't read. */
function restartReasonOf(reason: unknown, said: EventWords): string | null {
  if (typeof reason !== "object" || reason === null) return null;
  const fields = reason as Fields;
  const { restartReasons } = EVENT_TEXT;
  switch (fields.kind) {
    case "every": {
      const pages = positive(fields.pages);
      return pages === null ? null : restartReasons.every(pages);
    }
    case "failed-page":
      return restartReasons.failedPage;
    case "retry": {
      const attempt = positive(fields.attempt);
      const of = positive(fields.of);
      if (typeof fields.page !== "string" || attempt === null || of === null) return null;
      return restartReasons.retry(said.pageName(fields.page), attempt, of);
    }
    default:
      return null;
  }
}

/**
 * An event in the page's words, as its row of the table says it and a problem's record quotes it.
 * One of a type this version doesn't know, or whose fields it can't read, is its type. A lost
 * foreground names the program that took it, never its window's title.
 */
export function eventText(event: RunEvent, said: EventWords): string {
  return wordsOf(fieldsOf(event), said) ?? said.redact(String(event.type));
}

function wordsOf(event: Fields, said: EventWords): string | null {
  const sr = said.screenReader;
  switch (event.type) {
    case "run-started": {
      if (event.resumed !== true) return EVENT_TEXT.runStarted;
      const session = positive(event.session);
      return session === null ? null : EVENT_TEXT.runResumed(session);
    }
    case "run-ended": {
      const reason = endReasonOf(event.reason);
      return reason === null ? null : EVENT_TEXT.runEnded(reason);
    }
    case "screen-reader-lock-taken":
      return EVENT_TEXT.lockTaken(sr);
    case "screen-reader-lock-released":
      return EVENT_TEXT.lockReleased(sr);
    case "screen-reader-started":
      return EVENT_TEXT.started(sr, positive(event.pid));
    case "screen-reader-stopped":
      return EVENT_TEXT.stopped(sr, positive(event.pid), event.restarting === true);
    case "screen-reader-restarting": {
      const reason = restartReasonOf(event.reason, said);
      return reason === null ? null : EVENT_TEXT.restarted(sr, reason);
    }
    case "own-screen-reader-closed": {
      if (!Array.isArray(event.pids)) return null;
      // Process ids, listed as Windows numbers them, as the run's own alert lists them.
      const pids = (event.pids as unknown[]).flatMap((pid) => positive(pid) ?? []);
      return EVENT_TEXT.ownClosed(sr, pids.join(", "));
    }
    case "own-screen-reader-restarted":
      if (event.ok === true) return EVENT_TEXT.ownRestarted(sr);
      return event.ok === false ? EVENT_TEXT.ownNotRestarted(sr) : null;
    case "browser-launched":
      return EVENT_TEXT.browserLaunched(positive(event.pid));
    case "browser-closed":
      return EVENT_TEXT.browserClosed(positive(event.pid));
    case "browser-handed-over":
      return EVENT_TEXT.browserHandedOver;
    case "page-started": {
      const page = pageOf(event, said);
      const attempt = positive(event.attempt);
      return page === null || attempt === null
        ? null
        : EVENT_TEXT.pageStarted(page.n, page.name, attempt);
    }
    case "page-finished": {
      const page = pageOf(event, said);
      if (page === null) return null;
      if (event.status === "done") return EVENT_TEXT.pageDone(page.n, page.name);
      return event.status === "skipped" ? EVENT_TEXT.pageSkipped(page.n, page.name) : null;
    }
    case "page-failed": {
      const page = pageOf(event, said);
      return page === null || typeof event.cause !== "string"
        ? null
        : EVENT_TEXT.pageFailed(page.n, PHRASES[kindOfCause(event.cause)]);
    }
    case "computer-locked":
      return EVENT_TEXT.locked;
    case "foreground-lost": {
      const program = words(event.program);
      return EVENT_TEXT.foreground(program === null ? null : said.redact(program));
    }
    default:
      return null;
  }
}

/**
 * Each session of a run's log, in order, as its chart and table show it. A session begins at its
 * `run-started` and runs until the next. Events before the first (a log that lost its first line)
 * belong to the run's first session.
 *
 * The log's lines that couldn't be read, and its events whose time isn't a time, are counted on the
 * last session: a line that can't be read doesn't say which session it was of, and the page says so
 * once, under the run's last table.
 */
export function timelinesOf(
  run: RunJson,
  log: { events: RunEvent[]; unreadable: number },
  said: EventWords,
): SessionTimeline[] {
  const readable = log.events.filter((event) => isEventTime(event.at));
  const unreadable = log.unreadable + log.events.length - readable.length;
  const sessions = sessionsOf(readable, run.sessions[0]?.n ?? 1);
  return sessions.map((session, index) =>
    timelineOf(session, said, index === sessions.length - 1 ? unreadable : 0),
  );
}

/**
 * The log's events by session: each `run-started` begins one, numbered as its event says. A number
 * that isn't after the session before it's (a log written or edited by hand) is that session's next,
 * so no two sessions, whose parts the page names by their numbers, are numbered alike.
 */
function sessionsOf(events: RunEvent[], first: number): { n: number; events: RunEvent[] }[] {
  const sessions: { n: number; events: RunEvent[] }[] = [];
  for (const event of events) {
    const current = sessions.at(-1);
    const fields = fieldsOf(event);
    if (current !== undefined && fields.type !== "run-started") {
      current.events.push(event);
      continue;
    }
    const next = current === undefined ? first : current.n + 1;
    const said = fields.type === "run-started" ? positive(fields.session) : null;
    sessions.push({ n: said !== null && said >= next ? said : next, events: [event] });
  }
  return sessions;
}

/** The earliest of some times, or the latest: each as it was written. */
function earliest(times: string[]): string {
  return times.reduce((first, time) => (Date.parse(time) < Date.parse(first) ? time : first));
}
function latest(times: string[]): string {
  return times.reduce((last, time) => (Date.parse(time) > Date.parse(last) ? time : last));
}

function timelineOf(
  session: { n: number; events: RunEvent[] },
  said: EventWords,
  unreadable: number,
): SessionTimeline {
  const { events } = session;
  const times = events.map((event) => event.at);
  const to = latest(times);
  const spans = spansOf(events, to, said);
  return {
    session: session.n,
    from: earliest(times),
    to,
    summary: summaryOf(spans, said.screenReader),
    lock: spans.lock,
    screenReader: spans.screenReader,
    own: spans.own.map(({ from, to: end }) => ({ from, to: end })),
    pages: spans.pages,
    rows: events.map((event) => ({
      time: event.at,
      text: eventText(event, said),
      kind: kindOf(String(event.type)),
    })),
    unreadable,
  };
}

/** A session's spans, as its chart draws them and its summary says them. */
interface Spans {
  lock: Span[];
  screenReader: (Span & { pid: number | null })[];
  /** With whether the log says it was started again, rather than running until the log ends. */
  own: (Span & { again: boolean })[];
  pages: (Span & { n: number; failed: boolean })[];
}

/**
 * The spans of a session's events. Each is paired in order: the lock from its taking to its letting
 * go; voicecap's screen reader from its start to its stop (a start with no stop before it ends the
 * one before it); the computer's own from its shutdown to its start again, only when the log says
 * it started (one that couldn't be started again stays off); and each attempt at a page from its
 * start to its end. An end is paired with the last start of the same page and attempt before it: a
 * session can hold a start with no end, as Ctrl+C leaves one. What the log doesn't close runs until
 * `end`, the session's last event.
 */
function spansOf(events: RunEvent[], end: string, said: EventWords): Spans {
  const spans: Spans = { lock: [], screenReader: [], own: [], pages: [] };
  let lock: string | null = null;
  let reader: { from: string; pid: number | null } | null = null;
  let own: string | null = null;
  const pages: { url: string; attempt: number; n: number; from: string }[] = [];
  for (const event of events) {
    const fields = fieldsOf(event);
    switch (fields.type) {
      case "screen-reader-lock-taken":
        lock ??= event.at;
        break;
      case "screen-reader-lock-released":
        if (lock !== null) spans.lock.push({ from: lock, to: event.at });
        lock = null;
        break;
      case "screen-reader-started":
        if (reader !== null) spans.screenReader.push({ ...reader, to: event.at });
        reader = { from: event.at, pid: positive(fields.pid) };
        break;
      case "screen-reader-stopped":
        if (reader !== null) {
          const pid = reader.pid ?? positive(fields.pid);
          spans.screenReader.push({ from: reader.from, to: event.at, pid });
        }
        reader = null;
        break;
      case "own-screen-reader-closed":
        own ??= event.at;
        break;
      case "own-screen-reader-restarted":
        if (own !== null && fields.ok === true) {
          spans.own.push({ from: own, to: event.at, again: true });
          own = null;
        }
        break;
      case "page-started": {
        const page = pageOf(fields, said);
        const attempt = positive(fields.attempt);
        if (page !== null && attempt !== null) {
          pages.push({ url: page.url, attempt, n: page.n, from: event.at });
        }
        break;
      }
      case "page-finished":
      case "page-failed": {
        const attempt = positive(fields.attempt);
        const at = pages.findLastIndex(
          (open) => open.url === fields.page && open.attempt === attempt,
        );
        const [open] = at === -1 ? [] : pages.splice(at, 1);
        if (open !== undefined) {
          const failed = fields.type === "page-failed";
          spans.pages.push({ from: open.from, to: event.at, n: open.n, failed });
        }
        break;
      }
    }
  }
  if (lock !== null) spans.lock.push({ from: lock, to: end });
  if (reader !== null) spans.screenReader.push({ ...reader, to: end });
  if (own !== null) spans.own.push({ from: own, to: end, again: false });
  for (const open of pages) {
    spans.pages.push({ from: open.from, to: end, n: open.n, failed: false });
  }
  const byStart = (a: Span, b: Span) => Date.parse(a.from) - Date.parse(b.from);
  spans.screenReader.sort(byStart);
  spans.pages.sort(byStart);
  return spans;
}

/** A minute: the summary's times are to the minute, so it can't say a shorter gap in the lock. */
const MINUTE = 60_000;

/**
 * The sentences that sum a session up, each where the chart has its lane: the lock, voicecap's
 * screen reader, the computer's own, and the pages. Their times are to the minute, as the page says
 * a time of day, so the lock let go and taken again within a minute (as each restart does) is said
 * as held throughout.
 */
function summaryOf(spans: Spans, sr: string): string[] {
  const said: string[] = [];
  if (spans.lock.length > 0) {
    const held: Span[] = [];
    for (const span of spans.lock) {
      const last = held.at(-1);
      if (last !== undefined && Date.parse(span.from) - Date.parse(last.to) < MINUTE) {
        held[held.length - 1] = { from: last.from, to: span.to };
      } else {
        held.push(span);
      }
    }
    const times = held.map(({ from, to }) => TIMELINE_TEXT.held(clock(from), clock(to)));
    said.push(TIMELINE_TEXT.lock(sr, oneAfterAnother(times)));
  }
  if (spans.screenReader.length > 0) {
    const pids = spans.screenReader.flatMap(({ pid }) => pid ?? []);
    const processes = pids.filter((pid, index) => pid !== pids[index - 1]).map(String);
    said.push(TIMELINE_TEXT.ran(sr, oneAfterAnother(processes)));
  }
  for (const { from, to, again } of spans.own) {
    said.push(TIMELINE_TEXT.own(sr, clock(from), again ? clock(to) : null));
  }
  if (spans.pages.length > 0) {
    const count = new Set(spans.pages.map(({ n }) => n)).size;
    const failed = spans.pages.flatMap(({ n, to, failed: lost }) =>
      lost ? [TIMELINE_TEXT.failedAt(n, clock(to))] : [],
    );
    said.push(TIMELINE_TEXT.pages(count, failed.join("")));
  }
  return said;
}

/** Times or processes one after another: "a, then b, then c", or "" for none. */
function oneAfterAnother(list: string[]): string {
  return list.length === 0 ? "" : list.reduce((first, next) => TIMELINE_TEXT.then(first, next));
}

/** A session of a run that its event log has no line of, with what the page says in its place. */
export interface UnloggedSession {
  /** The session's number in the run, from 1. */
  session: number;
  /** "Session 1: not recorded: it used voicecap 0.10.0." (TIMELINE_TEXT.unlogged). */
  notRecorded: string;
}

/**
 * The sessions of a run that its log's timelines don't cover, in order, each with why, so the page
 * leaves no session out without a word: a run begun with a voicecap that kept no log (before 0.11.0)
 * and finished with one that does, or finished with an older one. The reason is its own session's
 * voicecap, as its environment records it: one that kept no log is named; one that keeps the log has
 * no line in it (it couldn't be written then).
 */
export function unloggedSessions(run: RunJson, timelines: SessionTimeline[]): UnloggedSession[] {
  const logged = new Set(timelines.map(({ session }) => session));
  return run.sessions
    .filter(({ n }) => !logged.has(n))
    .map(({ n, environment }) => {
      const version = environment?.voicecap.version ?? null;
      return {
        session: n,
        notRecorded: keepsEventLog(version)
          ? TIMELINE_TEXT.unlogged.noLines(n)
          : TIMELINE_TEXT.unlogged.version(n, version),
      };
    });
}

/**
 * The run's restarts of its screen reader, as its facts say them: how many the log has, then why,
 * each reason once, with how often when more than once. Where the log doesn't cover all the run's
 * sessions (`sessions`: the timelines and the sessions they leave out), it says which sessions it
 * counts, then why each other session isn't counted, as its timeline does.
 */
export function restartsOf(
  log: { events: RunEvent[] },
  said: EventWords,
  sessions?: { timelines: SessionTimeline[]; unlogged: UnloggedSession[] },
): string {
  const restarts = log.events.filter(
    (event) => event.type === "screen-reader-restarting" && isEventTime(event.at),
  );
  const reasons = new Map<string, number>();
  for (const event of restarts) {
    const reason = restartReasonOf(fieldsOf(event).reason, said);
    if (reason !== null) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  const why = names([...reasons].map(([reason, times]) => TIMELINE_TEXT.times(reason, times)));
  if (sessions === undefined || sessions.unlogged.length === 0) {
    return TIMELINE_TEXT.restarts(restarts.length, why);
  }
  const counted = sessions.timelines.map(({ session }) => String(session));
  const where = TIMELINE_TEXT.inSessions(names(counted), counted.length > 1);
  return [
    TIMELINE_TEXT.restartsIn(restarts.length, where, why),
    ...sessions.unlogged.map(({ notRecorded }) => notRecorded),
  ].join(" ");
}

/** How long after a failure the record of it goes on, when no attempt followed it. */
const AFTER_FAILURE_MS = 10_000;

/**
 * What the log has of an attempt at a page, for its problem's record: its events from its own start
 * until the next attempt at the page starts, or, when none followed it in its session, until 10
 * seconds after it ended.
 *
 * Its own start is the last start of its number between its start and its end, as the attempt's
 * record times them: a resumed session takes a number again when Ctrl+C stopped the attempt that had
 * it, as an attempt it stopped isn't counted. A log with no such start begins it at its first event
 * within the attempt's time; one with none there (an attempt of a session the log doesn't have, in a
 * run begun before voicecap kept one) has nothing of it.
 */
export function attemptEvents(
  log: { events: RunEvent[] },
  page: string,
  attempt: { n: number; startedAt: string; endedAt: string },
): RunEvent[] {
  const events = log.events.filter((event) => isEventTime(event.at));
  const began = Date.parse(attempt.startedAt);
  const ended = Date.parse(attempt.endedAt);
  if (!Number.isFinite(began) || !Number.isFinite(ended)) return [];
  const until = ended + AFTER_FAILURE_MS;
  const within = (event: RunEvent, last: number) => {
    const at = Date.parse(event.at);
    return at >= began && at <= last;
  };
  const startsPage = (event: RunEvent | undefined): boolean =>
    event !== undefined && event.type === "page-started" && fieldsOf(event).page === page;
  let start = events.findLastIndex(
    (event) =>
      startsPage(event) && positive(fieldsOf(event).attempt) === attempt.n && within(event, ended),
  );
  if (start === -1) start = events.findIndex((event) => within(event, until));
  const [first, ...rest] = start === -1 ? [] : events.slice(start);
  if (first === undefined) return [];

  // The next attempt at the page, in the same session: the record ends where it starts.
  const turn = rest.findIndex((event) => startsPage(event) || event.type === "run-started");
  if (turn !== -1 && startsPage(rest[turn])) return [first, ...rest.slice(0, turn)];

  // None followed it: until 10 seconds after it ended, short of a later session's attempt.
  const window = [first];
  for (const event of rest) {
    if (startsPage(event) || Date.parse(event.at) > until) break;
    window.push(event);
  }
  return window;
}
