import {
  appendFileSync,
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  rmSync,
  writeFileSync,
  type Dirent,
} from "node:fs";
import path from "node:path";

import type { EventRecorder } from "../drivers/types.js";
import type { RunEvent } from "../model.js";
import { errorMessage } from "../util/errors.js";
import type { Logger } from "../util/log.js";
import { isoLocalMs } from "../util/time.js";
import { homeFolder, redactHome } from "./failure.js";

/**
 * A run's event log, in the run's folder: one JSON object a line, each an event and when it was
 * recorded (see RunEvent). It is only added to, and each line is written to disk as it's recorded,
 * so a window closed in the middle of a run still leaves everything up to that moment. A resumed
 * run adds to it, so it holds every session's events.
 */
export const EVENT_LOG = "events.jsonl";

/**
 * The folder in a run's folder that holds the cleaned copies of the screen reader's own log, one
 * for each time voicecap's screen reader quit (from voicecap 0.18.0): "nvda-log/<session>-<n>.txt",
 * the session's number in the run, then the copy's number in the session, each counting from 1.
 * The run lists each in its record (RunJson.files), as it lists the event log.
 */
export const NVDA_LOG_FOLDER = "nvda-log";

/**
 * A copy's file name as `screenReaderLog` makes it: the session's number, then the copy's, in plain
 * numbers (voicecap counts from 1, and writes no leading zero).
 */
const COPY_NAME = /^([1-9]\d*)-([1-9]\d*)\.txt$/;

/**
 * The copies of the screen reader's log that the run's sessions up to the `lastSession`th have in
 * its folder, each by its path from the run's folder (written with "/"), in the order of their
 * numbers: session by session, and each session's by its own. Whether the run lists them isn't
 * asked here. A session that never reached its end (it crashed, or its window was closed) listed
 * none of its copies, so the session that completes the run lists them with its own (see runAudit's
 * `end`), as it does the event log, which every session's end hashes whole. A name that isn't a
 * copy's, a copy numbered for a later session, and a folder are none of them: `voicecap verify`
 * names a file the run doesn't list. None where the run has no folder of copies, or it can't be read.
 */
export function copiesInFolder(runFolder: string, lastSession: number): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(path.join(runFolder, NVDA_LOG_FOLDER), { withFileTypes: true });
  } catch {
    return [];
  }
  const found: { name: string; session: number; n: number }[] = [];
  for (const entry of entries) {
    const numbers = entry.isFile() ? COPY_NAME.exec(entry.name) : null;
    if (numbers === null) continue;
    const session = Number(numbers[1]);
    if (session <= lastSession) found.push({ name: entry.name, session, n: Number(numbers[2]) });
  }
  return found
    .sort((a, b) => a.session - b.session || a.n - b.n)
    .map(({ name }) => `${NVDA_LOG_FOLDER}/${name}`);
}

/**
 * Whether a path from a run's folder is a copy's as `screenReaderLog` names it: exactly
 * "nvda-log/<session>-<n>.txt", with "/" and plain numbers. A run's record is data, so whatever reads
 * a file the record names asks this first, and a name with a ".." in it, a folder inside the
 * copies' folder, or another case or extension is not a copy.
 */
export function isCopyPath(file: string): boolean {
  return (
    file.startsWith(`${NVDA_LOG_FOLDER}/`) && COPY_NAME.test(file.slice(NVDA_LOG_FOLDER.length + 1))
  );
}

export interface EventLog extends EventRecorder {
  /**
   * Keep the cleaned copy of the screen reader's log that a driver hands over as the screen reader
   * quits: write it at once as <NVDA_LOG_FOLDER>/<session>-<n>.txt in the run's folder (the log's
   * own), record `screen-reader-log` with that file, and remember it (see `copies`). A copy that
   * can't be written is recorded as none, with why. It never throws, and does nothing once the log
   * is closed.
   */
  screenReaderLog(cleaned: string): void;
  /**
   * The copies this log has kept, each by its path from the run's folder (written with "/"), in the
   * order they were kept: the files the run lists as its session ends.
   */
  copies(): string[];
  /**
   * Nothing is recorded after this: a run closes its log as a session ends, so that what the run's
   * record says of the log is the log as it stays.
   */
  close(): void;
}

/**
 * Open the log at `file`, which may not be there yet: it's made with the first event. A resumed
 * run's log is added to, and when its last line was cut short (a window closed as it was written)
 * the next event starts on a new line, so the cut line is left alone and the lines after it read.
 * `session` is the number of the run's session that opens it, which names its copies of the screen
 * reader's log (see `EventLog.screenReaderLog`): they go in the log's own folder, so in the run's.
 *
 * Each event is stamped with `now()` as it's recorded, or with the moment it happened, when the
 * recorder is given one (a moment that isn't one is left for now's). Either way it's written at the
 * end: the lines are in the order they were recorded, never sorted by their times.
 *
 * A write that fails is warned of once and never stops the run: the log is evidence about the run,
 * not part of its work. A write that fails later is tried again with the next event. A copy that
 * can't be written is no copy, and the event for it says why.
 */
export function openEventLog(
  file: string,
  options: { now: () => Date; logger: Logger; session: number },
): EventLog {
  let closed = false;
  let warned = false;
  // Whether the end of the file is looked at before the next line: before the first, and after a
  // write that failed, which may have left a line cut short.
  let checkEnd = true;
  // The copies handed over so far, kept or not: each is the session's next, so no name is used twice.
  let handed = 0;
  const kept: string[] = [];
  const record: EventLog["record"] = (event, at) => {
    if (closed) return;
    try {
      const when = at instanceof Date && Number.isFinite(at.getTime()) ? at : options.now();
      const line = `${JSON.stringify({ at: isoLocalMs(when), ...event })}\n`;
      const newLine = checkEnd && endsMidLine(file) ? "\n" : "";
      appendFileSync(file, newLine + line, { flush: true });
      checkEnd = false;
    } catch (error) {
      checkEnd = true;
      if (!warned) {
        warned = true;
        options.logger.warn(`The event log couldn't be written: ${errorMessage(error)}.`);
      }
    }
  };
  return {
    record,
    screenReaderLog(cleaned) {
      if (closed) return;
      handed += 1;
      const name = `${NVDA_LOG_FOLDER}/${options.session}-${handed}.txt`;
      const copy = path.join(path.dirname(file), ...name.split("/"));
      let reason: string | null = null;
      try {
        mkdirSync(path.dirname(copy), { recursive: true });
        writeFileSync(copy, cleaned, { flush: true });
        kept.push(name);
      } catch (error) {
        reason = reasonOf(error);
        // A write that failed partway (a disk that filled) may have left part of the copy. It isn't
        // one: no copy is kept, so none should be there for `voicecap verify` to call unrecorded. Not
        // being able to take it away changes nothing, and the reason stays the write's.
        try {
          rmSync(copy, { force: true });
        } catch {
          // Left where it is.
        }
      }
      // After the copy, so the log never names a file that isn't there.
      record({ type: "screen-reader-log", file: reason === null ? name : null, reason });
    },
    copies: () => [...kept],
    close() {
      closed = true;
    },
  };
}

/**
 * Why something failed, as the log keeps it: the error's message, with the home folder written as
 * redactHome writes it. The log is kept with the run, in the transcripts' Git history, and mustn't
 * name the account that ran voicecap, as a path in an error's message does.
 */
function reasonOf(error: unknown): string {
  const message = errorMessage(error);
  const home = homeFolder();
  return home === null ? message : redactHome(message, home, process.platform);
}

/** Whether the file is there, has something in it, and doesn't end with a newline. */
function endsMidLine(file: string): boolean {
  let fd: number;
  try {
    fd = openSync(file, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  try {
    const { size } = fstatSync(fd);
    if (size === 0) return false;
    const last = Buffer.alloc(1);
    readSync(fd, last, 0, 1, size - 1);
    return last[0] !== 0x0a;
  } finally {
    closeSync(fd);
  }
}

/**
 * The events in a log's text, in order, and how many lines couldn't be read: a line that isn't a
 * JSON object with a string `at` and a string `type`, such as one cut short. A blank line is
 * skipped, not counted. An event of a type this version doesn't know is kept, as a later voicecap
 * may have written it.
 */
export function readEventLog(text: string): { events: RunEvent[]; unreadable: number } {
  const events: RunEvent[] = [];
  let unreadable = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const event = parseEvent(line);
    if (event === null) unreadable++;
    else events.push(event);
  }
  return { events, unreadable };
}

function parseEvent(line: string): RunEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { at, type } = value as Record<string, unknown>;
  return typeof at === "string" && typeof type === "string" ? (value as RunEvent) : null;
}
