/**
 * The player: one page's saved transcripts, read aloud line by line in the computer's voice, with
 * keys to pause, move, jump to a flagged line, switch transcripts, and change the speed. It plays
 * the words NVDA said; it isn't NVDA reading the page again.
 *
 * It's in two parts. The state machine (startState, onKey, onLineSpoken) is pure: it says which
 * line is playing, and what to tell the person, and nothing else. playPage drives it with a voice
 * and the person's keys, shows each line as it becomes the one playing, and says the page's own
 * lines too (Ruling R10). sayLine says one line, a transcript's or the session's own, and stops it
 * for a key, as the rules for keys say.
 */
import type { PassName } from "../model.js";
import { EnvironmentError } from "../util/errors.js";
import type { OutputStream } from "../util/log.js";
import type { Key, KeySource } from "./keys.js";
import { REPLAY_TEXT } from "./text.js";
import { VOICE_STOPPED_ANSWERING, settlesWithin, type Voice } from "./voice.js";

/** A line of a transcript, as the player shows it and the voice says it. */
export interface PlayLine {
  /** Its line number in the TXT transcript, so line 4 on screen is line 4 of read.txt. */
  n: number;
  /** The line as the transcript writes it, with "[to top]" or "[no speech]". */
  text: string;
  /** What the voice says: the line without its label, and "" for "[no speech]". */
  spoken: string;
  /** For each rule that flagged the line, what it found, in words. */
  marks: string[];
}

/** A page's transcripts to play, by pass. A pass that wasn't taken has none. */
export type Transcripts = Partial<Record<PassName, PlayLine[]>>;

/** The voice's speed, in words a minute (D4): 180 to start, from 60 to 540, 20 for each + or −. */
export const RATE = { start: 180, min: 60, max: 540, step: 20 } as const;

/**
 * How long a line the voice was asked to stop may take to end, before the voice counts as stuck.
 * Windows' script answers a stop within about 40 ms.
 */
const STOP_LIMIT_MS = 5_000;

/** What a key asks the player to do. */
export type PlayerKey =
  | "pause"
  | "back"
  | "ahead"
  | "next-flag"
  | "headings"
  | "tab"
  | "read"
  | "faster"
  | "slower"
  | "decide"
  | "quit";

/** Where a page's playing has got to. */
export interface PlayerState {
  transcripts: Transcripts;
  /** The transcript playing. */
  pass: PassName;
  /** The line playing: while the page plays, always one of the pass's lines. */
  index: number;
  paused: boolean;
  /** The voice's speed, in words a minute. */
  rate: number;
  /** "decide" once the page is over and the person is asked; "quit" once the session ends. */
  outcome: "playing" | "decide" | "quit";
  /** What the last key has to tell the person (a new speed, no flagged line after this one). */
  notice: string | null;
}

/** The lines of one of `transcripts`' passes: none for a pass that wasn't taken. */
function linesOf(transcripts: Transcripts, pass: PassName): PlayLine[] {
  return transcripts[pass] ?? [];
}

/**
 * The read transcript's first line, playing at `rate`. With no read lines, the page is over before
 * it starts: the person is asked at once, and told why.
 */
export function startState(transcripts: Transcripts, rate: number): PlayerState {
  const empty = linesOf(transcripts, "read").length === 0;
  return {
    transcripts,
    pass: "read",
    index: 0,
    paused: false,
    rate,
    outcome: empty ? "decide" : "playing",
    notice: empty ? REPLAY_TEXT.noLines("read") : null,
  };
}

/** The next line of the pass once the line playing is spoken, or the question after the last. */
export function onLineSpoken(state: PlayerState): PlayerState {
  return state.index + 1 < linesOf(state.transcripts, state.pass).length
    ? { ...state, index: state.index + 1 }
    : { ...state, outcome: "decide" };
}

/**
 * The line ← goes to. While paused, the line before, so a person can step through every line in
 * silence (D7). While playing, the nearest line before that has words: a line where NVDA said
 * nothing ("[no speech]") is passed at once as it plays, so stopping on one would only say the
 * same line again. With no such line, the line playing, which is said again.
 */
function lineBack(state: PlayerState): number {
  if (state.paused) return Math.max(0, state.index - 1);
  const lines = linesOf(state.transcripts, state.pass);
  const worded = lines.findLastIndex((line, i) => i < state.index && line.spoken !== "");
  return worded === -1 ? state.index : worded;
}

/**
 * The line → goes to, as lineBack finds it: the line after while paused, and the nearest line after
 * that has words while playing. Null when there's none, and the page is over.
 */
function lineAhead(state: PlayerState): number | null {
  const lines = linesOf(state.transcripts, state.pass);
  const ahead = state.paused
    ? state.index + 1
    : lines.findIndex((line, i) => i > state.index && line.spoken !== "");
  return ahead === -1 || ahead >= lines.length ? null : ahead;
}

/**
 * What `key` does to `state`. Every key clears the last notice. A key that moves leaves `paused`
 * as it was, so a person can step through the lines in silence (D7). While playing, ← and → pass
 * over the lines where NVDA said nothing, as the page does (lineBack, lineAhead).
 */
export function onKey(state: PlayerState, key: PlayerKey): PlayerState {
  const next: PlayerState = { ...state, notice: null };
  switch (key) {
    case "pause":
      return { ...next, paused: !state.paused };
    case "back":
      return { ...next, index: lineBack(state) };
    case "ahead": {
      const ahead = lineAhead(state);
      return ahead === null ? { ...next, outcome: "decide" } : { ...next, index: ahead };
    }
    case "next-flag": {
      const lines = linesOf(state.transcripts, state.pass);
      const flagged = lines.findIndex((line, i) => i > state.index && line.marks.length > 0);
      return flagged === -1
        ? { ...next, notice: REPLAY_TEXT.noFlagAfter }
        : { ...next, index: flagged };
    }
    // The transcript the key names, from its start, even when it's the one playing.
    case "headings":
    case "tab":
    case "read":
      return linesOf(state.transcripts, key).length === 0
        ? { ...next, notice: REPLAY_TEXT.noLines(key) }
        : { ...next, pass: key, index: 0 };
    case "faster":
    case "slower": {
      const step = key === "faster" ? RATE.step : -RATE.step;
      const rate = Math.min(RATE.max, Math.max(RATE.min, state.rate + step));
      return { ...next, rate, notice: REPLAY_TEXT.speed(rate) };
    }
    case "decide":
    case "quit":
      return { ...next, outcome: key };
  }
}

/** The keys a person types for the player's letters and signs, + and − without Shift too (D4). */
const TYPED: ReadonlyMap<string, PlayerKey> = new Map([
  ["n", "next-flag"],
  ["N", "next-flag"],
  ["h", "headings"],
  ["H", "headings"],
  ["t", "tab"],
  ["T", "tab"],
  ["r", "read"],
  ["R", "read"],
  ["+", "faster"],
  ["=", "faster"],
  ["-", "slower"],
  ["_", "slower"],
]);

/** What a key asks the player to do, or null when the player has no use for it. */
export function playerKeyOf(key: Key): PlayerKey | null {
  switch (key.name) {
    case "space":
      return "pause";
    case "left":
      return "back";
    case "right":
      return "ahead";
    case "enter":
      return "decide";
    case "ctrl-c":
      return "quit";
    case "char":
      return TYPED.get(key.char) ?? null;
    default:
      return null;
  }
}

/**
 * Plays a page's transcripts, from the read transcript's first line, until the person decides
 * (Enter, or the end of the transcript playing) or ends the session (Ctrl+C, or the keys ending).
 * It gives which, and the voice's speed, which the next page keeps.
 *
 * It shows each line once, as it becomes the one playing, and says it unless it's paused or has
 * no words: a silent line ("[no speech]") is shown, and passed at once. It shows the page's line
 * (`title`) first, a transcript's name as it starts playing, "Paused." as the person pauses, and
 * each notice, and says each of them too, before the line playing (Ruling R10): with NVDA muted,
 * a person who follows by ear alone hears only the voice. A key that leaves the line where it was
 * (Space to go on, + or −) has it said again, from its start, without showing it again.
 *
 * Keys pressed while a line is said wait their turn, as sayLine says. A key that stops one of the
 * page's own lines acts as it would on the line playing, and the rest of them aren't said; on a
 * page that's over before it starts (no read lines), it only stops them, or ends the session. A
 * voice that stops working, or stops answering, rejects it.
 */
export async function playPage(options: {
  transcripts: Transcripts;
  /** The voice's speed as the page starts, in words a minute. */
  rate: number;
  voice: Voice;
  keys: KeySource;
  out: OutputStream;
  /** The line that names the page, shown and said before its transcripts (R10). */
  title?: string;
  /** How long a stopped line may take to end: STOP_LIMIT_MS, unless a test says otherwise. */
  stopLimitMs?: number;
}): Promise<{ outcome: "decide" | "quit"; rate: number }> {
  const { voice, keys, out, stopLimitMs = STOP_LIMIT_MS } = options;
  /** The page's own lines still to be said, before the line playing: each is shown at once. */
  const asides: string[] = [];
  /** Shows one of the page's own lines, to be said before the line playing (R10). */
  const tell = (text: string): void => {
    out.write(`${text}\n`);
    asides.push(text);
  };
  const lines = (state: PlayerState): PlayLine[] => linesOf(state.transcripts, state.pass);
  // While the page plays, the index always names one of the pass's lines.
  const lineOf = (state: PlayerState): PlayLine => lines(state)[state.index]!;
  const showLine = (state: PlayerState): void => {
    const { n, text, marks } = lineOf(state);
    out.write(`${REPLAY_TEXT.line(n, text, marks)}\n`);
  };
  /** Shows a transcript's name and size as it starts playing, and says it, then its first line. */
  const showPass = (state: PlayerState): void => {
    tell(REPLAY_TEXT.pass(state.pass, lines(state).length));
    showLine(state);
  };
  /** Says `text`, and gives what ended it as the player's key. */
  const say = async (text: string, rate: number): Promise<PlayerKey | "spoken"> => {
    const heard = await sayLine({ voice, keys, text, rate, stops: worthAKey, stopLimitMs });
    if (heard === "spoken") return heard;
    return heard === null ? "quit" : (playerKeyOf(heard) ?? "quit");
  };

  let state = startState(options.transcripts, options.rate);
  if (options.title !== undefined) tell(options.title);
  if (state.notice !== null) tell(state.notice);
  if (state.outcome === "playing") showPass(state);
  for (;;) {
    let heard: PlayerKey | "spoken";
    const aside = asides.shift();
    if (aside !== undefined) {
      heard = await say(aside, state.rate);
      if (heard === "spoken") continue;
      // A key stops the page's own lines as it stops one of its transcript's.
      asides.length = 0;
      // A page with no read lines is over before it starts: there's no line for the key to act on.
      if (state.outcome !== "playing") {
        if (heard === "quit") return { outcome: "quit", rate: state.rate };
        continue;
      }
    } else {
      if (state.outcome !== "playing") break;
      const { spoken } = lineOf(state);
      if (state.paused) heard = await nextKey(keys);
      else if (spoken === "") heard = "spoken";
      else heard = await say(spoken, state.rate);
      if (heard === "spoken") {
        state = onLineSpoken(state);
        if (state.outcome === "playing") showLine(state);
        continue;
      }
    }
    const before = state;
    state = onKey(state, heard);
    if (state.outcome !== "playing") continue;
    // H, T, or R: the transcript it names plays from its start, the one playing included.
    if (heard === state.pass) showPass(state);
    else if (state.index !== before.index) showLine(state);
    if (state.paused && !before.paused) tell(REPLAY_TEXT.paused);
    if (state.notice !== null) tell(state.notice);
  }
  return { outcome: state.outcome === "quit" ? "quit" : "decide", rate: state.rate };
}

/** Whether the player has a use for a key, so it stops the line being said. */
const worthAKey = (key: Key): boolean => playerKeyOf(key) !== null;

/**
 * Says `text`, and gives what ended it: "spoken" once the voice has said it to the end, or the key
 * that stopped it, null for the keys' end. A transcript's lines and the session's own lines are
 * all said this way (Ruling R10).
 *
 * The line always starts, even with a key waiting already; that key then stops it at once (Ruling
 * R4). A key is taken only once it's waiting (keys.waiting()), never raced for, so a key that comes
 * as the line ends stays for what comes next. A key `stops` has no use for is taken and left out,
 * and the line goes on; Ctrl+C, and the keys' end, always stop it. For any other key the voice
 * stops, and the key is given once the line's say() has resolved, since the voice says one line at
 * a time. Ctrl+C, and the keys' end, don't wait for that: a Windows speech line has no time limit,
 * and the session closes the voice after, which ends a line still waiting (Ruling R6).
 *
 * No key is read while it waits for a stopped line, Ctrl+C included, so it waits at most
 * `stopLimitMs`. A line that hasn't ended by then means the voice is stuck: it rejects with
 * VOICE_STOPPED_ANSWERING, and the key is given to no one (Ruling R7).
 */
export async function sayLine(options: {
  voice: Voice;
  keys: KeySource;
  text: string;
  /** The voice's speed, in words a minute. */
  rate: number;
  /** Whether a key stops the line. Default: every key. */
  stops?: (key: Key) => boolean;
  /** How long a stopped line may take to end: STOP_LIMIT_MS, unless a test says otherwise. */
  stopLimitMs?: number;
}): Promise<"spoken" | Key | null> {
  const { voice, keys, text, rate, stops = () => true, stopLimitMs = STOP_LIMIT_MS } = options;
  const saying = voice.say(text, rate);
  for (;;) {
    // A key waiting already comes first, so it acts on the line it was pressed during.
    const first = await Promise.race([
      keys.waiting().then(() => "key" as const),
      saying.then(() => "spoken" as const),
    ]);
    if (first === "spoken") return first;
    const key = await keys.next();
    const ends = key === null || key.name === "ctrl-c";
    if (!ends && !stops(key)) continue;
    voice.stop();
    if (ends) return key;
    if (!(await settlesWithin(saying, stopLimitMs))) {
      throw new EnvironmentError(VOICE_STOPPED_ANSWERING);
    }
    return key;
  }
}

/**
 * What the next key the player has a use for asks, taken while nothing is said. The keys' end is
 * quit.
 */
async function nextKey(keys: KeySource): Promise<PlayerKey> {
  for (;;) {
    const key = await keys.next();
    if (key === null) return "quit";
    const asked = playerKeyOf(key);
    if (asked !== null) return asked;
  }
}
