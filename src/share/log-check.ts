/**
 * NVDA's own log, checked against the transcripts, step by step. A run keeps a cleaned copy of
 * NVDA's log for each NVDA session (the keys voicecap pressed, and what NVDA said), and this pairs
 * each step of the run's kept transcripts with what the log has NVDA saying for it, so a reviewer
 * can see every line where the two differ.
 *
 * It's general: it takes the steps' keys from the screen reader's driver (`gestureOf`), and knows
 * nothing else about NVDA but the format of its log. It works in four parts.
 *
 * 1. **Reading a copy.** It reads each key (`Input: kb(desktop):downArrow`) and each Speaking entry,
 *    with its time on the copy's own timeline, parseNvdaLog's way (entryTimes). Whatever falls inside
 *    a thrown-out attempt's window is set aside: it's never paired, and its speech is counted as
 *    outside the steps.
 * 2. **Stretches.** The driver presses keys of its own between one pass and the next (NVDA's: NVDA+T
 *    to check the window, Escape to leave focus mode), and no step presses them. They split each
 *    copy into stretches of the steps' keys, and each pass is lined up with a stretch, in order: the
 *    first, from where the last pass's ended, in which at least half its steps find their keys at
 *    the pass's own times (see stretchFor). A stretch no pass takes, such as a page voicecap opened
 *    and then skipped (an off-site redirect), holds only speech outside the steps.
 * 3. **The pass's clock.** Each step records how long it took, and steps follow one another, so a
 *    pass's steps begin at known moments after its start. Laid on the log's clock, each key goes to
 *    the step at whose moment it was pressed. That finds a step whose key NVDA didn't log (the first
 *    Tab of each page, which goes to the browser, not through NVDA), and keeps a key NVDA logged
 *    that isn't a step's (the driver's Ctrl+Home as it opens the page) off every step.
 * 4. **A step's speech, and the comparison.** A step's speech is what NVDA said after its key (or
 *    after the moment its key would have been pressed), within the step's time, in one burst; it's
 *    joined the way voicecap's capture joins it, and compared with the transcript's line,
 *    allowing for how NVDA speaks symbols (see spokenAsLogged).
 *
 * The pairing never looks at what was said: keys and times alone decide which speech is a step's,
 * so a line that differs is never moved to agree.
 */
import { entryTimes, normalizeSpeechItem, splitLogEntries, timeOnLog } from "../manual/nvda-log.js";
import { ReprParseError, parseReprList, scavengeStrings } from "../manual/python-repr.js";
import type { DriverCommand, PassName, StepRecord } from "../model.js";
import { normalizeSpeech } from "../passes/steps.js";

/** One line that differs: the step's page and pass, its number, and the words on one side. */
export interface LogMismatch {
  page: string;
  pass: PassName;
  step: number;
  text: string;
}

export interface LogCheck {
  /** The steps in the run's kept transcripts. */
  transcriptLines: number;
  /**
   * The steps the log has: each one whose key NVDA logged (even when it said nothing after it),
   * and each one with no key of its own whose speech the log has at the step's time.
   */
  logLines: number;
  /** The steps whose speech is the same in both. */
  agree: number;
  /** The log's speech for a step, where the transcript says otherwise or nothing. */
  onlyInLog: LogMismatch[];
  /** The transcript's line, where the log says otherwise or nothing. */
  onlyInTranscripts: LogMismatch[];
  /**
   * Speech entries outside voicecap's steps: before the first, between pages, in thrown-out
   * attempts. They're counted, never listed.
   */
  outside: number;
}

/** One pass's steps, from a kept attempt's transcript. */
interface PassSteps {
  page: string;
  pass: PassName;
  steps: StepRecord[];
}

interface Key {
  /** Milliseconds on the copy's timeline (entryTimes). */
  at: number;
  /** As NVDA logs it after `kb(desktop):`, such as "downArrow" or "NVDA+t". */
  gesture: string;
}

interface Said {
  at: number;
  /** The entry's text items, joined the way voicecap's capture joins them. */
  text: string;
}

/** A copy of NVDA's log, read: its keys and its speech, in time order, without the thrown-out. */
interface Copy {
  keys: Key[];
  said: Said[];
  /** Every Speaking entry in the copy, the thrown-out ones too. */
  speaking: number;
}

/** A run of the steps' keys in one copy, between keys no step presses. */
interface Stretch {
  copy: Copy;
  keys: Key[];
}

/** A pass laid on a copy's clock, with the key each step pressed there, if the copy has it. */
interface Placement {
  /** Where the pass's start falls on the copy's timeline (where it puts a key 0 ms in). */
  clock: number;
  keys: (Key | null)[];
  matched: number;
}

const INPUT = "Input: ";
const SPEAKING = "Speaking ";
/** A key's whole message: `Input: kb(desktop):downArrow`, with the keyboard's layout in brackets. */
const KEYBOARD_KEY = /^Input: kb\([^)]*\):(.+)$/;
/** The local date and time an attempt's record gives: 2026-10-06T08:08:15.482-05:00. */
const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/;

/**
 * Pair the steps of a run's kept transcripts with NVDA's own log, and compare what each says. The
 * copies are those of one or more NVDA sessions, in order; the steps are the kept attempts' passes,
 * in the order the run read them; the windows are the failed attempts', from their records
 * (startedAt to endedAt); and gestureOf gives the key a step's command presses, as NVDA logs it.
 */
export function checkAgainstLog(input: {
  logs: string[];
  steps: PassSteps[];
  thrownOut: { from: string; to: string }[];
  gestureOf: (command: DriverCommand) => string | null;
}): LogCheck {
  const { gestureOf } = input;
  const copies = input.logs.map((log) => readCopy(log, input.thrownOut));
  const stepKeys = new Set<string>();
  for (const pass of input.steps) {
    for (const step of pass.steps) {
      const gesture = gestureOf(step.command);
      if (gesture !== null) stepKeys.add(gesture);
    }
  }
  const stretches = copies.flatMap((copy) => stretchesOf(copy, stepKeys));

  const claimed = new Set<Said>();
  const check: LogCheck = {
    transcriptLines: 0,
    logLines: 0,
    agree: 0,
    onlyInLog: [],
    onlyInTranscripts: [],
    outside: 0,
  };
  let cursor = 0;
  input.steps.forEach((pass, index) => {
    const found = stretchFor(pass, input.steps[index + 1], stretches, cursor, gestureOf);
    if (found !== null) cursor = found.index + 1;
    pass.steps.forEach((step, k) => {
      check.transcriptLines += 1;
      const said =
        found === null ? null : speechOf(pass.steps, k, found.placement, found.copy, claimed);
      const spoken = normalizeSpeech(step.spoken);
      const where = { page: pass.page, pass: pass.pass, step: step.n };
      if (said === null) {
        if (spoken !== "") check.onlyInTranscripts.push({ ...where, text: spoken });
        return;
      }
      for (const entry of said) claimed.add(entry);
      check.logLines += 1;
      const logged = normalizeSpeech(said.map((entry) => entry.text).join(". "));
      if (spokenAsLogged(logged, spoken)) {
        check.agree += 1;
        return;
      }
      if (logged !== "") check.onlyInLog.push({ ...where, text: logged });
      if (spoken !== "") check.onlyInTranscripts.push({ ...where, text: spoken });
    });
  });

  // Speech no step claimed is outside the steps, and so is every entry set aside.
  check.outside = copies.reduce((sum, copy) => sum + copy.speaking, 0) - claimed.size;
  return check;
}

/**
 * The speech of a pass's k-th step, laid on a copy's clock, leaving out what earlier steps have
 * claimed; null when the log doesn't have the step (no key of its own, and no speech at its time).
 */
function speechOf(
  steps: readonly StepRecord[],
  k: number,
  placement: Placement,
  copy: Copy,
  claimed: ReadonlySet<Said>,
): Said[] | null {
  const step = steps[k]!;
  const key = placement.keys[k] ?? null;
  // Where the step's key was pressed, or would have been: the pass's clock puts it there.
  const anchor = key?.at ?? placement.clock + startOf(step);
  // A step with no key of its own reaches back halfway to the step before it.
  const from = key?.at ?? placement.clock + edgeOf(steps, k);
  const said = burst(copy, from, anchor, step.durationMs, claimed);
  return key === null && said.length === 0 ? null : said;
}

/**
 * The stretch a pass takes, from `cursor` on: the first it fits (see fits), unless the next pass
 * fits it too and pairs more of its keys. A stretch the next pass fits before this one fits any
 * means this pass has none: its keys aren't in the log (a pass whose only step is the first Tab).
 * Stretches passed over are those no pass explains, such as a page opened and then skipped.
 */
function stretchFor(
  pass: PassSteps,
  next: PassSteps | undefined,
  stretches: readonly Stretch[],
  cursor: number,
  gestureOf: (command: DriverCommand) => string | null,
): { index: number; copy: Copy; placement: Placement } | null {
  for (let index = cursor; index < stretches.length; index += 1) {
    const stretch = stretches[index]!;
    const mine = lineUp(pass.steps, stretch.keys, gestureOf);
    const theirs = next === undefined ? null : lineUp(next.steps, stretch.keys, gestureOf);
    const nextFits = next !== undefined && fits(next, theirs, gestureOf);
    if (mine !== null && fits(pass, mine, gestureOf)) {
      if (!(nextFits && theirs!.matched > mine.matched)) {
        return { index, copy: stretch.copy, placement: mine };
      }
    }
    if (nextFits) return null;
  }
  return null;
}

/**
 * Whether a pass fits a stretch: laid on its clock, at least half of the pass's steps that press a
 * key (and at least one) find theirs there.
 */
function fits(
  pass: PassSteps,
  placement: Placement | null,
  gestureOf: (command: DriverCommand) => string | null,
): boolean {
  if (placement === null) return false;
  const keyed = pass.steps.filter((step) => gestureOf(step.command) !== null).length;
  return placement.matched >= Math.max(1, Math.ceil(keyed / 2));
}

/** When a step began, in milliseconds after its pass began. */
function startOf(step: StepRecord): number {
  return step.offsetMs - step.durationMs;
}

/**
 * Where the k-th step's window begins on its pass's clock: halfway back to the step before's start
 * (half the first step's own duration, for the first).
 */
function edgeOf(steps: readonly StepRecord[], k: number): number {
  const start = startOf(steps[k]!);
  return start - (k === 0 ? steps[0]!.durationMs : start - startOf(steps[k - 1]!)) / 2;
}

/**
 * Lay a pass on a stretch's clock: the moment that pairs the most of its steps with keys, each key
 * going to the step whose moment it's nearest (a step's own window runs halfway to its neighbors'),
 * and only to a step that presses that key. The moments tried pair one of the pass's last three
 * steps with one of the last four keys it presses in the stretch, then one of its first three with
 * one of the first four, in that order, and the first that pairs the most wins. So where two pair
 * as many, the pass's end decides: a pass ends with its last step's key, while a key at its start
 * can be missing (the first Tab, pressed in the browser) or not a step's at all.
 */
function lineUp(
  steps: readonly StepRecord[],
  keys: readonly Key[],
  gestureOf: (command: DriverCommand) => string | null,
): Placement | null {
  if (steps.length === 0 || keys.length === 0) return null;
  const starts = steps.map(startOf);
  const gestures = steps.map((step) => gestureOf(step.command));
  // Each step's window on the pass's clock: from halfway to the step before, to halfway to the next.
  const edges = steps.map((_, k) => edgeOf(steps, k));
  edges.push(starts.at(-1)! + steps.at(-1)!.durationMs / 2);

  const clocks = new Set<number>();
  const anchor = (k: number, fromEnd: boolean) => {
    const gesture = gestures[k];
    if (gesture === null || gesture === undefined) return;
    const pressed = keys.filter((key) => key.gesture === gesture);
    for (const key of fromEnd ? pressed.slice(-4) : pressed.slice(0, 4)) {
      clocks.add(key.at - starts[k]!);
    }
  };
  for (let k = steps.length - 1; k >= Math.max(0, steps.length - 3); k -= 1) anchor(k, true);
  for (let k = 0; k < Math.min(3, steps.length); k += 1) anchor(k, false);

  let best: Placement | null = null;
  for (const clock of clocks) {
    const placed: (Key | null)[] = steps.map(() => null);
    const distance: number[] = steps.map(() => Infinity);
    for (const key of keys) {
      const k = windowAt(edges, key.at - clock);
      if (k === null || gestures[k] !== key.gesture) continue;
      const away = Math.abs(key.at - clock - starts[k]!);
      if (away < distance[k]!) {
        distance[k] = away;
        placed[k] = key;
      }
    }
    const matched = placed.filter((key) => key !== null).length;
    if (matched > (best?.matched ?? 0)) best = { clock, keys: placed, matched };
  }
  return best;
}

/** The step whose window holds a moment of the pass (edges from lineUp), or null if none does. */
function windowAt(edges: readonly number[], x: number): number | null {
  if (x < edges[0]! || x >= edges.at(-1)!) return null;
  let low = 0;
  let high = edges.length - 2;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (edges[middle]! <= x) low = middle;
    else high = middle - 1;
  }
  return low;
}

/**
 * What NVDA said for a step: from `from` (its key, or where the step's window begins), until the
 * next key or the step's time is up (`anchor` plus its duration), as one burst. voicecap's capture
 * keeps listening until NVDA has been quiet for a while, so every pause inside a step's speech is
 * shorter than that quiet, and the step lasts at least the pause and the quiet together: no pause
 * in a step's own speech is as long as half the step. A pause that long means its speech had ended,
 * and what comes after is something else (the next page's window, as voicecap opens it).
 */
function burst(
  copy: Copy,
  from: number,
  anchor: number,
  durationMs: number,
  claimed: ReadonlySet<Said>,
): Said[] {
  const nextKey = copy.keys[firstFrom(copy.keys, from, true)]?.at ?? Infinity;
  const until = Math.min(nextKey, anchor + durationMs);
  const said: Said[] = [];
  let last = anchor;
  for (let index = firstFrom(copy.said, from, false); index < copy.said.length; index += 1) {
    const entry = copy.said[index]!;
    if (claimed.has(entry)) continue;
    if (entry.at >= until || Math.abs(entry.at - last) > durationMs / 2) break;
    said.push(entry);
    last = entry.at;
  }
  return said;
}

/**
 * The index of the first of these, in time order, at `at` or after it (or strictly after it), or
 * their number when none is.
 */
function firstFrom(list: readonly { at: number }[], at: number, strictly: boolean): number {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const item = list[middle]!.at;
    if (strictly ? item > at : item >= at) high = middle;
    else low = middle + 1;
  }
  return low;
}

/** The copy's stretches: its runs of the steps' keys, between keys no step presses. */
function stretchesOf(copy: Copy, stepKeys: ReadonlySet<string>): Stretch[] {
  const stretches: Stretch[] = [];
  let keys: Key[] = [];
  for (const key of copy.keys) {
    if (stepKeys.has(key.gesture)) {
      keys.push(key);
    } else if (keys.length > 0) {
      stretches.push({ copy, keys });
      keys = [];
    }
  }
  if (keys.length > 0) stretches.push({ copy, keys });
  return stretches;
}

/** Read a cleaned copy: its keys and speech, in time order, with the thrown-out windows' set aside. */
function readCopy(log: string, thrownOut: readonly { from: string; to: string }[]): Copy {
  const entries = splitLogEntries(log);
  const times = entryTimes(entries);
  const start = entries[0]?.timeMs ?? 0;
  const windows = thrownOut.flatMap((window) => onTimeline(window, start));
  const thrown = (at: number) => windows.some(([from, to]) => at >= from && at <= to);
  const copy: Copy = { keys: [], said: [], speaking: 0 };
  entries.forEach((entry, index) => {
    if (entry.level !== "IO") return;
    const line = entry.message.split("\n", 1)[0] ?? "";
    const at = times[index]!;
    if (line.startsWith(INPUT)) {
      const gesture = KEYBOARD_KEY.exec(line)?.[1] ?? line.slice(INPUT.length);
      if (!thrown(at)) copy.keys.push({ at, gesture });
    } else if (line.startsWith(SPEAKING)) {
      copy.speaking += 1;
      if (!thrown(at)) copy.said.push({ at, text: joined(line.slice(SPEAKING.length)) });
    }
  });
  copy.keys.sort((a, b) => a.at - b.at);
  copy.said.sort((a, b) => a.at - b.at);
  return copy;
}

/**
 * A thrown-out attempt's window on a copy's timeline: its start's time of day, on the day the log
 * would put it (timeOnLog), and its length from its own two times. None when a time can't be read.
 */
function onTimeline(window: { from: string; to: string }, start: number): [number, number][] {
  const from = localTime(window.from);
  const to = localTime(window.to);
  if (from === null || to === null) return [];
  const at = timeOnLog(from.timeOfDay, start);
  return [[at, at + (to.wallClock - from.wallClock)]];
}

/** A local ISO time's wall clock (its date and time, as milliseconds) and its time of day. */
function localTime(iso: string): { wallClock: number; timeOfDay: number } | null {
  const match = LOCAL_TIME.exec(iso);
  if (match === null) return null;
  const part = (index: number) => Number(match[index]);
  const ms = Number((match[7] ?? "0").padEnd(3, "0"));
  const timeOfDay = ((part(4) * 60 + part(5)) * 60 + part(6)) * 1000 + ms;
  return { wallClock: Date.UTC(part(1), part(2) - 1, part(3)) + timeOfDay, timeOfDay };
}

/**
 * A Speaking entry's text the way voicecap's capture has it: each text item trimmed, with its runs
 * of spaces made one, and the items joined with ", ". An empty item stays (", , "), as it does in a
 * transcript, and NVDA's commands (LangChangeCommand, BreakCommand, CancellableSpeech) are left out.
 */
function joined(repr: string): string {
  let items: string[];
  try {
    items = parseReprList(repr).flatMap((item) => (item.kind === "string" ? [item.value] : []));
  } catch (error) {
    if (!(error instanceof ReprParseError)) throw error;
    items = scavengeStrings(repr);
  }
  return items.map(normalizeSpeechItem).join(", ");
}

const WORD = /[\p{L}\p{M}\p{N}]/u;
const LETTER = /[\p{L}\p{M}]/u;
const SPACE = /\s/u;
/** The most words NVDA's name for a symbol is taken to have ("plus or minus"). */
const NAME_WORDS = 4;

/**
 * Whether a transcript's line says what NVDA's log has it saying. NVDA logs the text it was given
 * before it processes it for speech: it then reads each symbol at its symbol level, saying some by
 * name ("read.txt" as "read dot txt", a "." on its own as "dot") and leaving others out ("|",
 * quotation marks), and its dictionary splits some words ("macOS" as "mac OS"). The transcript has
 * what NVDA said after that, so here every letter and digit must be the same, in order, and where
 * the log has a symbol, the transcript can have the symbol, nothing, or a word or a few (its name,
 * perhaps with the symbol after it). Spaces don't count. Nothing else is let through.
 */
export function spokenAsLogged(logged: string, spoken: string): boolean {
  if (normalizeSpeech(logged) === normalizeSpeech(spoken)) return true;
  const said = Array.from(logged).filter((ch) => !SPACE.test(ch));
  const heard = Array.from(spoken);
  const width = heard.length + 1;
  const seen = new Uint8Array((said.length + 1) * width);
  const todo = [0];
  const go = (i: number, j: number) => todo.push(i * width + j);
  while (todo.length > 0) {
    const state = todo.pop()!;
    if (seen[state] === 1) continue;
    seen[state] = 1;
    const i = Math.floor(state / width);
    const j = state % width;
    if (i === said.length && j === heard.length) return true;
    if (j < heard.length && SPACE.test(heard[j]!)) go(i, j + 1);
    if (i === said.length) continue;
    const ch = said[i]!;
    if (WORD.test(ch)) {
      if (heard[j] === ch) go(i + 1, j + 1);
      continue;
    }
    go(i + 1, j); // left out
    if (heard[j] === ch) go(i + 1, j + 1); // kept
    for (const end of nameEnds(heard, j)) {
      go(i + 1, end); // said by name
      const after = pastSpaces(heard, end);
      if (heard[after] === ch) go(i + 1, after + 1); // said by name, and kept
    }
  }
  return false;
}

/** Where a name could end if one starts at j: after each of up to NAME_WORDS whole words. */
function nameEnds(heard: readonly string[], j: number): number[] {
  const ends: number[] = [];
  if (!LETTER.test(heard[j] ?? "") || WORD.test(heard[j - 1] ?? "")) return ends;
  let at = j;
  while (ends.length < NAME_WORDS && LETTER.test(heard[at] ?? "")) {
    while (LETTER.test(heard[at] ?? "")) at += 1;
    // A word runs into a digit: it isn't a whole word.
    if (WORD.test(heard[at] ?? "")) break;
    ends.push(at);
    const next = pastSpaces(heard, at);
    if (next === at) break;
    at = next;
  }
  return ends;
}

function pastSpaces(heard: readonly string[], at: number): number {
  while (SPACE.test(heard[at] ?? "")) at += 1;
  return at;
}
