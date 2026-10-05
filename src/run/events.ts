import { appendFileSync, closeSync, fstatSync, openSync, readSync } from "node:fs";

import type { EventRecorder } from "../drivers/types.js";
import type { RunEvent } from "../model.js";
import { errorMessage } from "../util/errors.js";
import type { Logger } from "../util/log.js";
import { isoLocalMs } from "../util/time.js";

/**
 * A run's event log, in the run's folder: one JSON object a line, each an event and when it was
 * recorded (see RunEvent). It is only added to, and each line is written to disk as it's recorded,
 * so a window closed in the middle of a run still leaves everything up to that moment. A resumed
 * run adds to it, so it holds every session's events.
 */
export const EVENT_LOG = "events.jsonl";

export interface EventLog extends EventRecorder {
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
 *
 * Each event is stamped with `now()` as it's recorded, or with the moment it happened, when the
 * recorder is given one (a moment that isn't one is left for now's). Either way it's written at the
 * end: the lines are in the order they were recorded, never sorted by their times.
 *
 * A write that fails is warned of once and never stops the run: the log is evidence about the run,
 * not part of its work. A write that fails later is tried again with the next event.
 */
export function openEventLog(file: string, options: { now: () => Date; logger: Logger }): EventLog {
  let closed = false;
  let warned = false;
  // Whether the end of the file is looked at before the next line: before the first, and after a
  // write that failed, which may have left a line cut short.
  let checkEnd = true;
  return {
    record(event, at) {
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
    },
    close() {
      closed = true;
    },
  };
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
