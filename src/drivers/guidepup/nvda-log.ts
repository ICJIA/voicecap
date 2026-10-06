/**
 * NVDA's own log, cleaned down to what voicecap keeps of it. At the input/output level, NVDA logs
 * everything it hears and does: its speech, every key pressed on the computer (typing, too), every
 * word typed, and what it says about itself. The copy a run keeps is NVDA's speech, the keys
 * voicecap pressed, and NVDA's warnings and errors. The raw log is never kept: it holds what the
 * person typed, and the account name in its paths. NVDA is started with the log at that level by
 * the settings `withNvdaLog` makes.
 *
 * NVDA speaks each character a person types, and logs it as speech like any other. So speech is
 * kept only while the last key NVDA logged was one voicecap pressed (or none has been logged yet),
 * and what NVDA says after any other key is dropped, up to the next key voicecap pressed. A key of
 * the person's that NVDA logs as one of voicecap's (an h, a Tab, an Escape, Down Arrow, Ctrl+Home,
 * Ctrl+End, or NVDA+T) can't be told from voicecap's own, so it stays, and what NVDA says after it.
 *
 * voicecap's first Tab on each page goes to the browser, not through NVDA (the `firstTab` branch of
 * `nextFocusable` in the NVDA driver, and `pressTab` in its Chrome session). So NVDA logs no key
 * for it, and what NVDA says for it follows the key before it. A page's tab pass has one more Tab
 * step than the log has `tab` keys: the demo run in fixture/nvda-io-run has 41 Tab steps and 34
 * `tab` keys, over seven pages.
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

/**
 * The gesture a step's command presses in NVDA, or null for a command with no key of its own. The
 * first `nextFocusable` step on a page is pressed in the browser, not NVDA, so the log has no key
 * for it (see the top of this file).
 */
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
  "key, every typed word, and what NVDA said after a key voicecap didn't press, and wrote " +
  "%USERPROFILE% for the home folder.";

/** The levels whose entries are kept, with every line after their header (a traceback). */
const PROBLEM_LEVELS: ReadonlySet<string> = new Set(["WARNING", "ERROR", "CRITICAL"]);

/** The whole message of a key's entry (`log.io("Input: %s" % gesture.identifiers[0])`). */
const KEY_MESSAGE = /^Input: kb\((?:desktop|laptop)\):(.+)$/;

/** What an entry is, for what the copy keeps. */
type Kind = "voicecap-key" | "other-key" | "speech" | "problem" | "other";

/**
 * What an entry is: a key voicecap presses (an `Input:` entry whose whole message is one of its
 * gestures), any other key (every other `Input:` entry, a person's typing), speech
 * (`log.io("Speaking %r" % speechSequence)`), a warning, error, or critical entry, or anything
 * else NVDA logs (a typed word, and its INFO and debugging entries, which name the account's
 * folders).
 */
function kindOf(entry: LogEntry): Kind {
  if (PROBLEM_LEVELS.has(entry.level)) return "problem";
  if (entry.level !== "IO") return "other";
  if (entry.message.startsWith("Speaking ")) return "speech";
  if (!entry.message.startsWith("Input: ")) return "other";
  const gesture = KEY_MESSAGE.exec(entry.message)?.[1];
  return gesture !== undefined && VOICECAP_GESTURES.includes(gesture)
    ? "voicecap-key"
    : "other-key";
}

/**
 * The cleaned copy of an NVDA log (any line ends): its first line says what it is, then come the
 * entries it keeps, whole and in order, as NVDA wrote them: the keys voicecap pressed, NVDA's
 * speech while the last key was one of those (see the top of this file), and its warnings and
 * errors. The home folder is written as redactHome writes it. Every line of the copy ends with
 * "\n". Cleaning a cleaned copy gives it back unchanged, since its first line is a comment before
 * the first entry.
 */
export function cleanNvdaLog(
  raw: string,
  options: { home: string; platform: NodeJS.Platform },
): string {
  const lines = splitLines(raw);
  const entries = splitLogEntries(raw);
  const kept: string[] = [];
  // Whether the last key NVDA logged was one voicecap pressed (before the first key, it counts).
  let afterVoicecapKey = true;
  entries.forEach((entry, index) => {
    const kind = kindOf(entry);
    if (kind === "voicecap-key") afterVoicecapKey = true;
    else if (kind === "other-key") afterVoicecapKey = false;
    const keep =
      kind === "problem" || kind === "voicecap-key" || (kind === "speech" && afterVoicecapKey);
    if (!keep) return;
    // The entry is its header line and every line up to the next entry's header, or the file's end.
    const end = (entries[index + 1]?.line ?? lines.length + 1) - 1;
    for (let at = entry.line - 1; at < end; at += 1) kept.push(lines[at]!);
  });
  const text = redactHome(kept.join("\n"), options.home, options.platform);
  return kept.length === 0 ? `${CLEANED_LOG_FIRST_LINE}\n` : `${CLEANED_LOG_FIRST_LINE}\n${text}\n`;
}

/**
 * The settings NVDA starts with: the config's own, with NVDA's log turned on at the input/output
 * level, which holds what NVDA says and every key pressed, for the run to keep a cleaned copy of
 * (see cleanNvdaLog). It's Guidepup's own setting, `general.loggingLevel`, and nothing else is
 * done to NVDA to get it. The config's own settings win, a general.loggingLevel among them (one left
 * undefined counts as none), and the rest of its general settings stay. A `general` that isn't a
 * table of settings counts as none. New objects are made, and the config's own, which the run
 * records, is left as it is.
 */
export function withNvdaLog(settings: Record<string, unknown>): Record<string, unknown> {
  const own = settings.general;
  const general =
    own !== null && typeof own === "object" && !Array.isArray(own)
      ? (own as Record<string, unknown>)
      : {};
  return { ...settings, general: { ...general, loggingLevel: general.loggingLevel ?? "IO" } };
}
