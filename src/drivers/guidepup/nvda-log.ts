/**
 * NVDA's own log, cleaned down to what voicecap keeps of it. At the input/output level, NVDA logs
 * everything it hears and does: its speech, every key pressed on the computer (typing, too), every
 * word typed, and what it says about itself. The copy a run keeps is NVDA's speech, the keys
 * voicecap pressed, and NVDA's warnings and errors. The raw log is never kept: it holds what the
 * person typed, and the account name in its paths.
 */
import { splitLines } from "../../manual/detect.js";
import { splitLogEntries, type LogEntry } from "../../manual/nvda-log.js";
import type { DriverCommand } from "../../model.js";
import { redactHome } from "../../run/failure.js";

/**
 * NVDA's log file, in the temp folder. NVDA moves the last one to nvda-old.log whenever it starts,
 * which includes the person's own NVDA starting again after a run, so a session's log has to be
 * read before then.
 */
export const NVDA_LOG_FILE = "nvda.log";

/**
 * The gestures the NVDA driver presses, as NVDA logs them after `kb(desktop):` or `kb(laptop):`: a
 * key for each command of a pass's steps, and NVDA+T and Escape, which the driver presses itself to
 * check the window and to leave focus mode. A test ties the list to the driver's key map.
 */
export const VOICECAP_GESTURES: readonly string[] = [
  "downArrow",
  "h",
  "tab",
  "control+home",
  "control+end",
  "NVDA+t",
  "escape",
];

/** The gesture a step's command presses in NVDA, or null for a command with no key of its own. */
export function gestureOf(command: DriverCommand): string | null {
  switch (command) {
    case "nextLine":
      return "downArrow";
    case "nextHeading":
      return "h";
    case "nextFocusable":
      return "tab";
    case "toTop":
      return "control+home";
    case "toBottom":
      return "control+end";
    default:
      return null;
  }
}

/** What every cleaned copy says first, so a reader of the file knows what it is and isn't. */
const CLEANED_LOG_FIRST_LINE =
  "# NVDA's own log of one NVDA session in this run, as voicecap keeps it: NVDA's speech, " +
  "the keys voicecap pressed, and NVDA's warnings and errors. voicecap left out every other " +
  "key and every typed word, and wrote %USERPROFILE% for the home folder.";

/** The levels whose entries are kept, with every line after their header (a traceback). */
const PROBLEM_LEVELS: ReadonlySet<string> = new Set(["WARNING", "ERROR", "CRITICAL"]);

/** The whole message of a key's entry (`log.io("Input: %s" % gesture.identifiers[0])`). */
const KEY_MESSAGE = /^Input: kb\((?:desktop|laptop)\):(.+)$/;

/**
 * Whether the copy keeps an entry: speech (`log.io("Speaking %r" % speechSequence)`), a key
 * voicecap presses, or a warning, error, or critical entry. Any other key is a person's typing,
 * and a typed word is private text, so neither is kept. Nor is anything else NVDA logs, such as
 * its INFO and debugging entries, which name the account's folders.
 */
function isKept(entry: LogEntry): boolean {
  if (PROBLEM_LEVELS.has(entry.level)) return true;
  if (entry.level !== "IO") return false;
  if (entry.message.startsWith("Speaking ")) return true;
  const gesture = KEY_MESSAGE.exec(entry.message)?.[1];
  return gesture !== undefined && VOICECAP_GESTURES.includes(gesture);
}

/**
 * The cleaned copy of an NVDA log (any line ends): its first line says what it is, then come the
 * entries it keeps (see isKept), whole and in order, as NVDA wrote them. The home folder is written
 * as redactHome writes it. Every line of the copy ends with "\n". Cleaning a cleaned copy gives it
 * back unchanged, since its first line is a comment before the first entry.
 */
export function cleanNvdaLog(
  raw: string,
  options: { home: string; platform: NodeJS.Platform },
): string {
  const lines = splitLines(raw);
  const entries = splitLogEntries(raw);
  const kept: string[] = [];
  entries.forEach((entry, index) => {
    if (!isKept(entry)) return;
    // The entry is its header line and every line up to the next entry's header, or the file's end.
    const end = (entries[index + 1]?.line ?? lines.length + 1) - 1;
    for (let at = entry.line - 1; at < end; at += 1) kept.push(lines[at]!);
  });
  const text = redactHome(kept.join("\n"), options.home, options.platform);
  return kept.length === 0 ? `${CLEANED_LOG_FIRST_LINE}\n` : `${CLEANED_LOG_FIRST_LINE}\n${text}\n`;
}
