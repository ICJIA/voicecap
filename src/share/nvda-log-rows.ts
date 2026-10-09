/**
 * NVDA's own warnings and errors, for a problem's record: the `WARNING`, `ERROR`, and `CRITICAL`
 * entries NVDA logged during an attempt's window, in the copy voicecap kept of the NVDA session the
 * attempt ran in. The window is the one the record's event log rows come from (`attemptWindow`, in
 * ./timeline.ts), so the two sources cover the same time. NVDA's speech and the keys voicecap
 * pressed are not here: the run's evidence compares them with the transcripts (./run-log-check.ts).
 * Pure: it works from what the loader read.
 *
 * - **The session.** The attempt's NVDA session is the one that had started when the attempt did,
 *   among the sessions the run's event log shows (`sessionsOf`, the way the check of NVDA's log
 *   finds them), and its copy is the one that session's `screen-reader-log` event names, never one
 *   paired by its number. A window can run on into the next NVDA session (a retry starts NVDA
 *   again). That session's start-up is not about this attempt, so its copy is not read for it.
 * - **The times.** NVDA's log has a time of day for each entry and no date. An entry is put on the
 *   day it falls on in the window, by the midnight rule `parseNvdaLog` goes by (`entryTimes` and
 *   `timeOnLog`, in ../manual/nvda-log.ts), and given the window's UTC offset, so the record can
 *   order it among its other rows. The time of day it shows is the entry's own.
 * - **The rows.** Each entry is its message and the lines after it (a traceback's), joined with a
 *   newline, with the home folder replaced again, since the copy was cleaned of it but is data
 *   (an entry with no message is shown by its level and its code path).
 *
 * Where the page doesn't have the session's copy, it says why (`PROBLEMS_TEXT.nvdaLog`), in the
 * order the reader can act on it: the screen reader isn't NVDA; the event log doesn't show which
 * session the attempt ran in; voicecap kept no copy for it; the copy isn't as the run recorded it.
 */
import { entryTimes, splitLogEntries, timeOnLog } from "../manual/nvda-log.js";
import type { RunEvent, RunJson } from "../model.js";
import type { NvdaRows } from "./problems.js";
import { otherScreenReader } from "./run-evidence.js";
import { sessionsOf, type NvdaSession } from "./run-log-check.js";
import { PROBLEMS_TEXT } from "./text.js";
import { attemptWindow, isEventTime, type AttemptWindow } from "./timeline.js";

/** The levels of the entries a record shows. They are the levels a cleaned copy keeps whole. */
const PROBLEM_LEVELS: ReadonlySet<string> = new Set(["WARNING", "ERROR", "CRITICAL"]);

const DAY = 86_400_000;

/** A warning, error, or critical entry of a copy. */
interface Entry {
  /** When it was logged, in milliseconds on the copy's timeline (`entryTimes`). */
  at: number;
  /** Its time of day as the log has it, "HH:MM:SS.mmm". */
  time: string;
  level: string;
  codepath: string;
  /** Every line after its header, joined with a newline. */
  message: string;
}

/** A copy of NVDA's log, read for its warnings and errors. */
interface ReadCopy {
  /** Its first entry's time of day: where its timeline's first day begins counting. */
  start: number;
  entries: Entry[];
}

function readCopy(text: string): ReadCopy {
  const entries = splitLogEntries(text);
  const times = entryTimes(entries);
  return {
    start: entries[0]?.timeMs ?? 0,
    entries: entries.flatMap(({ level, codepath, time, message }, index) =>
      PROBLEM_LEVELS.has(level) ? [{ at: times[index] ?? 0, time, level, codepath, message }] : [],
    ),
  };
}

/** A local ISO time, as the event log writes one: its date, its offset, and its time of day. */
const LOCAL_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;

interface LocalTime {
  /** "2026-09-26". */
  date: string;
  /** "-05:00", or "Z". */
  offset: string;
  /** Milliseconds since midnight. */
  timeOfDay: number;
}

function localTime(iso: string): LocalTime | null {
  const match = LOCAL_TIME.exec(iso);
  if (match === null) return null;
  const part = (index: number) => Number(match[index]);
  const [month, day, hours, minutes, seconds] = [part(2), part(3), part(4), part(5), part(6)];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  const ms = Number((match[7] ?? "").padEnd(3, "0").slice(0, 3));
  return {
    date: `${match[1]}-${match[2]}-${match[3]}`,
    offset: match[8] ?? "Z",
    timeOfDay: ((hours * 60 + minutes) * 60 + seconds) * 1000 + ms,
  };
}

/**
 * A date ("2026-09-26") some days later, by the calendar. Null for a date the calendar can't give a
 * four-digit year of, which only a copy that is no log can lead to.
 */
function addDays(date: string, days: number): string | null {
  if (days === 0) return date;
  const [year = 1970, month = 1, day = 1] = date.split("-").map(Number);
  const moved = new Date(0);
  moved.setUTCFullYear(year, month - 1, day + days);
  const later = Number.isFinite(moved.getTime()) ? moved.toISOString().slice(0, 10) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(later) ? later : null;
}

/** What the record says of an entry: its message, or, where it has none, its level and code path. */
function textOf({ level, codepath, message }: Entry): string {
  return message.trim() === "" ? `${level} - ${codepath}` : message;
}

/**
 * The rows of a window: each warning, error, or critical entry of the copy that falls in it, in
 * the order the copy has them, with the time it has in the record.
 */
function rowsIn(
  copy: ReadCopy,
  span: AttemptWindow,
  redact: (text: string) => string,
): { time: string; entry: string }[] {
  const from = localTime(span.from);
  if (from === null) return [];
  const begins = timeOnLog(from.timeOfDay, copy.start);
  const ends = begins + span.lasts;
  const firstDay = Math.floor(begins / DAY);
  return copy.entries
    .filter(({ at }) => at >= begins && (span.inclusive ? at <= ends : at < ends))
    .flatMap((found) => {
      const date = addDays(from.date, Math.floor(found.at / DAY) - firstDay);
      return date === null
        ? []
        : [{ time: `${date}T${found.time}${from.offset}`, entry: redact(textOf(found)) }];
    });
}

/**
 * The NVDA session that had started when a window began: the latest to start at or before it. Null
 * when the log shows none, as for an attempt that began before the log's first session.
 */
function sessionAt(sessions: readonly NvdaSession[], time: string): NvdaSession | null {
  const began = Date.parse(time);
  return sessions[sessions.findLastIndex((session) => Date.parse(session.from) <= began)] ?? null;
}

/** The run's own words for why its log kept no copy, with the home folder replaced; null for none. */
function reasonOf(session: NvdaSession, redact: (text: string) => string): string | null {
  const own = redact(session.log?.reason ?? "")
    .trim()
    .replace(/[\s.]+$/, "");
  return own === "" ? null : own;
}

/**
 * What a problem's record has of NVDA's own log for an attempt, for `problemsOf`. `eventLog` gives a
 * run's event log, when the page has it; `copies`, the copies of NVDA's log the loader read, by their
 * path from the run's folder (only those the run's record lists, as it has them); and `redact`
 * replaces the home folder. A copy is read once, however many attempts take rows from it.
 */
export function nvdaLogRows(input: {
  eventLog: (run: RunJson) => { events: RunEvent[] } | null;
  copies: (run: RunJson) => ReadonlyMap<string, string>;
  redact: (text: string) => string;
}): NvdaRows {
  const { nvdaLog } = PROBLEMS_TEXT;
  const sessions = new Map<RunJson, NvdaSession[]>();
  const reads = new Map<string, ReadCopy>();
  const sessionsOfRun = (run: RunJson, events: readonly RunEvent[]): NvdaSession[] => {
    const known = sessions.get(run);
    if (known !== undefined) return known;
    const found = sessionsOf(events.filter((event) => isEventTime(event.at))).sessions;
    sessions.set(run, found);
    return found;
  };
  const readOnce = (run: RunJson, file: string, text: string): ReadCopy => {
    const key = `${run.id}\0${file}`;
    const known = reads.get(key);
    if (known !== undefined) return known;
    const read = readCopy(text);
    reads.set(key, read);
    return read;
  };

  return (run, page, attempt) => {
    if (otherScreenReader(run)) return { gap: nvdaLog.notNvda };
    const log = input.eventLog(run);
    const span = log === null ? null : attemptWindow(log, page.url, attempt);
    if (log === null || span === null) return { gap: nvdaLog.unplaced };
    const session = sessionAt(sessionsOfRun(run, log.events), span.from);
    if (session === null) return { gap: nvdaLog.unplaced };

    const kept = session.log;
    if (kept === undefined) return { gap: nvdaLog.noCopy };
    if (kept.file === null) {
      const why = reasonOf(session, input.redact);
      return { gap: why === null ? nvdaLog.noCopy : nvdaLog.reason(why) };
    }
    const text = input.copies(run).get(kept.file);
    if (text === undefined) return { gap: nvdaLog.changed };
    return { rows: rowsIn(readOnce(run, kept.file, text), span, input.redact) };
  };
}
