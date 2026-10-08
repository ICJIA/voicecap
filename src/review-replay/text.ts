/**
 * The words a person sees during `voicecap review --replay`: the line that names a page, each line
 * as it's read, the keys, the question after a page, and what's said when there is nothing to
 * hear. Two kinds sit elsewhere, beside what they're about: the usage errors, where they're thrown
 * (pages.ts, session.ts, and the command's own checks in src/cli/main.ts), and the voices' error
 * messages, in voice.ts.
 *
 * The voice says most of the session's own lines too, as they're shown (Ruling R10). It says each
 * as it's written, but for the keys and the question, whose signs and spacing a voice reads badly:
 * those have a `Spoken` form, in words.
 *
 * The wording is the spec's where the spec pins it (the page's line, the question, the two lines
 * about the person's own NVDA), and the plan's for the rest. The replay reads a page's saved words
 * aloud; it isn't NVDA reading the page again. voicecap is a person's review, sped up: the person
 * hears the words, reads them, and decides.
 */
import type { PassName } from "../model.js";
import { plural } from "../report/html.js";

/** How each transcript is named at its head: "Read transcript, 33 lines:". */
const PASS_TITLES: Record<PassName, string> = { read: "Read", headings: "Headings", tab: "Tab" };

/** How each transcript is named in a sentence: "No lines in the Tab transcript." */
const PASS_NOUNS: Record<PassName, string> = { read: "read", headings: "headings", tab: "Tab" };

export const REPLAY_TEXT = {
  /** The line that names a page before it plays: "Page 3 of 7: /biographies/ (2 flags)". */
  page: (n: number, of: number, path: string, flags: number): string =>
    `Page ${n} of ${of}: ${path} (${flags === 0 ? "no flags" : plural(flags, "flag")})`,

  /**
   * A line as it's shown while it is read: its number in the TXT transcript, right-aligned in four
   * columns, two spaces, the line, and a mark after it, in words, for each rule that flagged it.
   */
  line: (n: number, text: string, marks: readonly string[]): string =>
    `${String(n).padStart(4)}  ${text}${marks.map((mark) => `  ⚑ ${mark}`).join("")}`,

  /** Said when a transcript starts playing, or the person switches to it. */
  pass: (pass: PassName, lines: number): string =>
    `${PASS_TITLES[pass]} transcript, ${plural(lines, "line")}:`,

  /** Said when the person asks for a transcript that has no lines. */
  noLines: (pass: PassName): string => `No lines in the ${PASS_NOUNS[pass]} transcript.`,

  /** Said when N finds no flagged line after the one playing. */
  noFlagAfter: "No flagged line after this one.",

  paused: "Paused. Press Space to go on.",

  /** Said when + or − changes the voice's speed. */
  speed: (wpm: number): string => `Speed: ${wpm} words a minute.`,

  /** The keys, shown once before the first page. */
  keys: "Keys: Space pauses and goes on · ← → a line back or ahead · N the next flagged line · H T R the headings, Tab, and read transcripts · + − faster, slower · Enter decide · Ctrl+C end",

  /** The keys as the voice says them, in words: a voice reads the arrows and dots badly. */
  keysSpoken:
    "Keys: Space pauses, and goes on. Left Arrow and Right Arrow, a line back or ahead. N, the next flagged line. H, T, and R, the headings, Tab, and read transcripts. Plus and minus, faster and slower. Enter, decide. Control C, end.",

  /** Asked after a page. Only 1 to 4 answer it, so Enter alone never records a decision. */
  question: "What did you decide?  1 Reviewed, no issues   2 Issue found   3 Fixed   4 Skip",

  /** The question as the voice says it, with a pause after each answer, so they don't run on. */
  questionSpoken: "What did you decide? 1, Reviewed, no issues. 2, Issue found. 3, Fixed. 4, Skip.",

  /** The prompt for a note, after "Issue found" or "Fixed". It ends with a space, to type after. */
  note: "Note (Enter for none): ",

  /**
   * Said once an answer is taken, so a person who only hears the session knows it was. Never
   * addReview's own line, which names the address the run read.
   */
  answered: {
    reviewed: "Recorded: reviewed, no issues.",
    issue: "Recorded: issue found.",
    fixed: "Recorded: fixed.",
    skip: "Skipped.",
  },

  /**
   * Said before the first page when the person's own NVDA is running: it would read these lines
   * too, over the replay's voice. The session then waits for Enter.
   */
  nvda: [
    "NVDA is running, and it will read these lines too, over the replay's voice.",
    "Mute it (NVDA+S changes its speech mode) or quit it, then press Enter.",
  ],

  /**
   * Said after the count, at the end, when the person's own NVDA was running and they went on from
   * its two lines: it's muted, or quit, until they turn it back on.
   */
  nvdaBack:
    "Turn NVDA's speech back on (NVDA+S changes its speech mode), or start it again if you quit it.",

  /** Said before the first page when pages were picked but have no transcripts to play. */
  leftOut: (paths: readonly string[]): string =>
    `Left out, with no transcripts to hear: ${paths.join(", ")}.`,

  /** Said, with nothing played, when no page that NVDA read needs attention. */
  nothingDefault:
    "Nothing to hear: no page that NVDA read needs attention. Add --all to hear every page, or --page <url> to hear one.",

  /** Said, with nothing played, when `--all` finds no page with transcripts. */
  nothingAll: "Nothing to hear: no page has transcripts yet.",

  /**
   * Shown as the voice starts, which can take a few seconds, so the screen isn't silent meanwhile.
   * It isn't said: the voice isn't there yet.
   */
  starting: "Starting the computer's voice.",

  /** The last line of a session, however it ended: "Recorded 2 decisions." */
  recorded: (n: number): string =>
    n === 0 ? "Recorded no decisions." : `Recorded ${plural(n, "decision")}.`,

  /** Said, with nothing played, when `--replay` has no terminal to take keys from. */
  noTerminal:
    "--replay needs a terminal: it takes each key as you press it, and shows each line as it's read. Run it in a terminal window, with nothing redirected.",
} as const;
