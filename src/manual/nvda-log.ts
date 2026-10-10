import { UsageError } from "../util/errors.js";
import { LOG_HEADER, splitLines } from "./detect.js";
import { ReprParseError, parseReprList, scavengeStrings } from "./python-repr.js";

const DAY_MS = 86_400_000;
/**
 * A backwards jump in time of day larger than this is a midnight crossing, not thread jitter or a
 * daylight-saving change (one hour). NVDA often runs for days, so an overnight gap (17:00, then
 * 09:00 the next morning) is a crossing too. A gap of more than a whole day can't be seen in
 * times of day at all: check the session date, or give --date.
 */
const CROSSING_THRESHOLD_MS = 2 * 3_600_000;

export interface LogEntry {
  level: string;
  codepath: string;
  /** Local time of day as logged, "HH:MM:SS.mmm". */
  time: string;
  /** Milliseconds since local midnight. */
  timeMs: number;
  thread: string;
  message: string;
  /** 1-based line number of the entry's header. */
  line: number;
}

export type LogEventType = "key" | "speech" | "typed-word";

export interface LogEvent {
  type: LogEventType;
  /** Local time of day, "HH:MM:SS.mmm". */
  time: string;
  /** Days after the log's first entry (midnight crossings so far). */
  day: number;
  /** Milliseconds since midnight of the log's first day. */
  at: number;
  /** key: the gesture identifier; speech: the items joined with ", "; typed-word: the word. */
  text: string;
  /** speech only: the text items, normalized like Guidepup's. */
  items?: string[];
  line: number;
}

export interface ParsedNvdaLog {
  events: LogEvent[];
  nvdaVersion: string | null;
  /** Log entries seen, including discarded ones. */
  entries: number;
  discarded: number;
  /** Midnight crossings between the first and the last entry. */
  crossings: number;
  /** Time of day of the log's first entry, in ms since midnight (day 0). */
  startMs: number | null;
  warnings: string[];
}

export const NO_IO_ENTRIES_MESSAGE =
  "The log has no input or speech entries, so NVDA's logging level probably wasn't set to " +
  "Input/output. Set it in NVDA menu > Preferences > Settings > General > Logging level, " +
  "repeat the session, then import the new log (and set the level back afterwards).";

/**
 * Split a log into entries: each starts with a header line (see LOG_HEADER) and its message is
 * every following line up to the next header. Lines before the first header (an excerpt that
 * starts mid-entry, or the "# " line a cleaned copy of a log starts with) are ignored.
 */
export function splitLogEntries(text: string): LogEntry[] {
  const entries: LogEntry[] = [];
  let current: (LogEntry & { lines: string[] }) | null = null;
  const lines = splitLines(text);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const match = LOG_HEADER.exec(line);
    if (match) {
      if (current) entries.push(finish(current));
      const [, level, codepath, hh, mm, ss, ms, thread] = match;
      current = {
        level: level!,
        codepath: codepath!,
        time: `${hh}:${mm}:${ss}.${ms}`,
        timeMs: ((Number(hh) * 60 + Number(mm)) * 60 + Number(ss)) * 1000 + Number(ms),
        thread: thread!,
        message: "",
        line: index + 1,
        lines: [],
      };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) entries.push(finish(current));
  return entries;
}

function finish(entry: LogEntry & { lines: string[] }): LogEntry {
  const { lines, ...rest } = entry;
  return { ...rest, message: lines.join("\n") };
}

/**
 * When each entry was logged, in milliseconds since midnight of the log's first day. The log has
 * times of day only, so a backwards jump larger than CROSSING_THRESHOLD_MS is a midnight crossing.
 */
export function entryTimes(entries: readonly LogEntry[]): number[] {
  let day = 0;
  let previousMs: number | null = null;
  return entries.map((entry) => {
    if (previousMs !== null && entry.timeMs < previousMs - CROSSING_THRESHOLD_MS) day += 1;
    previousMs = entry.timeMs;
    return day * DAY_MS + entry.timeMs;
  });
}

/**
 * A time of day on a log's timeline (as entryTimes counts it), for a log whose first entry was at
 * `startMs` past midnight: the first moment with that time of day that isn't more than
 * CROSSING_THRESHOLD_MS before the log's start, the same day the log would put it on.
 */
export function timeOnLog(timeOfDayMs: number, startMs: number): number {
  let at = timeOfDayMs;
  while (at < startMs - CROSSING_THRESHOLD_MS) at += DAY_MS;
  return at;
}

/**
 * Extract, in order, the input gestures, the speech NVDA produced, and typed words from an
 * NVDA log at Input/output level; everything else is discarded. The formats come from NVDA's
 * source:
 * - inputCore.InputManager.executeGesture: `log.io("Input: %s" % gesture.identifiers[0])`
 * - speech.speech.speak: `log.io("Speaking %r" % speechSequence)`
 * - speech.speech.speakTypedCharacters: `log.io("typed word: %s" % typedWord)`
 * - nvda.pyw: `log.info(f"Starting NVDA version {buildVersion.version} {arch}")`
 */
export function parseNvdaLog(text: string): ParsedNvdaLog {
  const entries = splitLogEntries(text);
  const times = entryTimes(entries);
  const events: LogEvent[] = [];
  const warnings: string[] = [];
  let nvdaVersion: string | null = null;
  let day = 0;

  for (const [index, entry] of entries.entries()) {
    const at = times[index]!;
    day = Math.floor(at / DAY_MS);
    const base = { time: entry.time, day, at, line: entry.line };
    const firstLine = entry.message.split("\n", 1)[0] ?? "";

    if (entry.level === "IO" && firstLine.startsWith("Input: ")) {
      events.push({ ...base, type: "key", text: firstLine.slice("Input: ".length).trim() });
    } else if (entry.level === "IO" && firstLine.startsWith("Speaking ")) {
      const items = speechItems(firstLine.slice("Speaking ".length), entry.line, warnings);
      // A sequence of commands only (no text) makes no sound; there is nothing to transcribe.
      if (items.length > 0) events.push({ ...base, type: "speech", text: items.join(", "), items });
    } else if (entry.level === "IO" && firstLine.startsWith("typed word: ")) {
      events.push({ ...base, type: "typed-word", text: firstLine.slice("typed word: ".length) });
    } else {
      const version = /^Starting NVDA version (\S+)/.exec(firstLine);
      if (version && nvdaVersion === null) nvdaVersion = version[1]!;
    }
  }

  return {
    events,
    nvdaVersion,
    entries: entries.length,
    discarded: entries.length - events.length,
    crossings: day,
    startMs: entries[0]?.timeMs ?? null,
    warnings,
  };
}

/** Normalize each text item exactly like Guidepup's NVDA client: trim, collapse whitespace runs. */
export function normalizeSpeechItem(item: string): string {
  return item.trim().replaceAll(/\s\s+/g, " ");
}

function speechItems(repr: string, line: number, warnings: string[]): string[] {
  let strings: string[];
  try {
    strings = parseReprList(repr).flatMap((item) => (item.kind === "string" ? [item.value] : []));
  } catch (error) {
    if (!(error instanceof ReprParseError)) throw error;
    strings = scavengeStrings(repr);
    warnings.push(
      `Line ${line}: couldn't fully parse a speech entry (${error.message}); kept its quoted text.`,
    );
  }
  return strings.map(normalizeSpeechItem).filter((item) => item !== "");
}

export interface TimeOfDay {
  /** Milliseconds since midnight. */
  ms: number;
  /** How much of the minute or second the value covers: 60 000 for HH:MM, 1 000 for HH:MM:SS. */
  precisionMs: number;
  /** As given, normalized to HH:MM or HH:MM:SS. */
  text: string;
}

/** Parse --from/--to: HH:MM or HH:MM:SS, 24-hour. */
export function parseTimeOfDay(value: string, option: string): TimeOfDay {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  const hours = Number(match?.[1]);
  const minutes = Number(match?.[2]);
  const seconds = match?.[3] === undefined ? 0 : Number(match[3]);
  if (!match || hours > 23 || minutes > 59 || seconds > 59) {
    throw new UsageError(`${option} must be a time of day as HH:MM or HH:MM:SS (got "${value}").`);
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  const hasSeconds = match[3] !== undefined;
  return {
    ms: ((hours * 60 + minutes) * 60 + seconds) * 1000,
    precisionMs: hasSeconds ? 1000 : 60_000,
    text: hasSeconds
      ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
      : `${pad(hours)}:${pad(minutes)}`,
  };
}

/**
 * Keep the events between --from and --to. Both resolve forward in time: --from is the first
 * moment at or after the log's start with that time of day, and --to the first at or after
 * --from (or the start). So `--from 23:50 --to 00:10` spans midnight. Times without seconds
 * cover their whole minute.
 */
export function selectWindow(
  events: readonly LogEvent[],
  startMs: number,
  from: TimeOfDay | null,
  to: TimeOfDay | null,
): LogEvent[] {
  const forward = (time: TimeOfDay, notBefore: number) => {
    let at = time.ms;
    while (at + time.precisionMs - 1 < notBefore) at += DAY_MS;
    return at;
  };
  const fromAt = from ? forward(from, startMs) : Number.NEGATIVE_INFINITY;
  const toEnd = to
    ? forward(to, Number.isFinite(fromAt) ? fromAt : startMs) + to.precisionMs - 1
    : Number.POSITIVE_INFINITY;
  return events.filter((event) => event.at >= fromAt && event.at <= toEnd);
}
