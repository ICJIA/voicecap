/**
 * NVDA's own log, checked against the transcripts, step by step. A run keeps a cleaned copy of
 * NVDA's log for each NVDA session (the keys voicecap pressed, and what NVDA said), and this pairs
 * each step of the run's kept transcripts with what the log has NVDA saying for it, so a reviewer
 * can see every line where the two differ.
 *
 * It's general: it takes the steps' keys from the screen reader's driver (`gestureOf`), and knows
 * nothing else about NVDA but the format of its log, and that a pass's first Tab goes to the
 * browser, not through NVDA, so its log has no key for it. It works in five parts.
 *
 * 1. **Reading a copy.** It reads each key (`Input: kb(desktop):downArrow`) and each Speaking entry,
 *    with its time on the copy's own timeline, parseNvdaLog's way (entryTimes). Whatever falls inside
 *    a thrown-out attempt's window is set aside: it's never paired, and its speech is counted as
 *    outside the steps.
 * 2. **Each pass's window.** A pass was read in one kept attempt at its page, and the run's event log
 *    says when that attempt began and ended (its page-started and page-finished: `within`). A pass
 *    takes only keys and speech inside that window, so it never takes another page's keys, or those
 *    of an attempt the run didn't keep (one that Ctrl+C stopped is never kept), whatever order the
 *    passes come in. The times are used as they are: the event log and NVDA's log read the same
 *    clock, to the millisecond, and an attempt's events bracket all it does by a second or more (on
 *    the real run of 6 October 2026, a page's first key came 2.4 s or more after its attempt began,
 *    its last step's speech 2.5 s before it ended, and its last key 1.0 s before).
 * 3. **Stretches.** The driver presses keys of its own as it opens a page for a pass (NVDA's: NVDA+T
 *    to check the window, Escape to leave focus mode, and Escape to close Windows Search or the
 *    Start menu when one comes in front of the browser), and no step presses them. They split each
 *    copy into stretches of the steps' keys. Inside a page's window, its passes are lined up with its
 *    stretches in order, each taking the first after its page's last that it fits (see stretchFor).
 *    A stretch no pass takes, such as a page voicecap opened and then skipped (an off-site
 *    redirect), holds only speech outside the steps.
 * 4. **The pass's clock.** Each step records how long it took, and steps follow one another, so a
 *    pass's steps begin at known moments after its start. Laid on the log's clock, each key goes to
 *    the step in whose time it was pressed: voicecap presses a step's key once NVDA is quiet, so it
 *    can come seconds into its step when NVDA was still talking as the step began. A key NVDA took
 *    late, after its step's time, goes to its step where order says whose it is (see inOrder). That
 *    finds a step whose key NVDA didn't log (the first Tab of each page, which goes to the browser,
 *    not through NVDA), and keeps a key NVDA logged that isn't a step's (the driver's Ctrl+Home as
 *    it opens the page) off every step. When another clock accounts for as many keys some other
 *    way, as when a key no step pressed comes just before a pass's first step or after its last, or
 *    a key is left over among the pass's keys, which order couldn't place, the pass can't be paired
 *    for certain, and its steps aren't checked (see lineUp).
 * 5. **A step's speech, and the comparison.** A step's speech is what NVDA said after its key (or
 *    after the moment its key would have been pressed), within the step's time, in one burst. Its
 *    entries' items are compared with the transcript's line, allowing for how NVDA speaks symbols
 *    (see spokenAsLogged). A pass whose first Tab, with no key, has no speech at its moment isn't
 *    checked: the clock its other keys set may be wrong for it.
 *
 * The pairing never looks at what was said: windows, keys and times alone decide which speech is a
 * step's, so no line is paired by its words to agree. Two things wrong at once can still give a step
 * a neighbor's words, which agree where neighboring lines read the same, or leave a step whose words
 * came late with none (see lineUp).
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
  /**
   * The steps in the run's kept transcripts that were checked: all of them but those of a pass the
   * log can't be paired with for certain (see lineUp), which are in no count or list here.
   */
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
   * attempts, and in attempts the run didn't keep. They're counted, never listed.
   */
  outside: number;
}

/** One pass's steps, from a kept attempt's transcript. */
export interface PassSteps {
  page: string;
  pass: PassName;
  steps: StepRecord[];
  /**
   * When the kept attempt the pass was read in began and ended: the times of its page-started and
   * page-finished in the run's event log, as they are (local ISO times, to the millisecond).
   */
  within: { from: string; to: string };
}

interface Key {
  /** Milliseconds on the copy's timeline (entryTimes). */
  at: number;
  /** As NVDA logs it after `kb(desktop):`, such as "downArrow" or "NVDA+t". */
  gesture: string;
}

interface Said {
  at: number;
  /** The entry's text items, each as voicecap's capture has it (normalizeSpeechItem). */
  items: string[];
}

/** A copy of NVDA's log, read: its keys and its speech, in time order, without the thrown-out. */
interface Copy {
  /** Its first entry's time of day (where its timeline's day begins counting). */
  start: number;
  keys: Key[];
  said: Said[];
  /** Every Speaking entry in the copy, the thrown-out ones too. */
  speaking: number;
}

/** A run of the steps' keys in one copy (by its index), between keys no step presses. */
interface Stretch {
  copy: number;
  keys: Key[];
}

/**
 * A window of time the run recorded (a kept attempt's events, or a failed attempt's record): its
 * start's time of day, and how long it lasted.
 */
interface Window {
  timeOfDay: number;
  length: number;
}

/** A pass, with its attempt's window on each copy's timeline (by the copy's index). */
interface Placed {
  pass: PassSteps;
  spans: [number, number][];
}

/** A pass laid on a copy's clock, with the key each step pressed there, if the copy has it. */
interface Placement {
  /** Where the pass's start falls on the copy's timeline (where it puts a key 0 ms in). */
  clock: number;
  keys: (Key | null)[];
  matched: number;
  /** The keys it accounts for: those it pairs, and those left over near its steps without keys. */
  counted: number;
  /**
   * Whether no other moment tried accounts for as many keys some other way, and no key is left over
   * among its own (see lineUp).
   */
  certain: boolean;
}

/** A pass laid on a copy's clock, with that copy and the pass's window on its timeline. */
interface Laid {
  placement: Placement;
  copy: Copy;
  span: [number, number];
}

const INPUT = "Input: ";
const SPEAKING = "Speaking ";
/** A key's whole message: `Input: kb(desktop):downArrow`, with the keyboard's layout in brackets. */
const KEYBOARD_KEY = /^Input: kb\([^)]*\):(.+)$/;
/** A local ISO time, as a run records one: 2026-10-06T08:08:15.482-05:00. */
const LOCAL_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * One more wait for NVDA to be quiet: how much later than the moment it gives a step the pass's
 * clock can be. voicecap's capture presses a step's key once NVDA is quiet, a quarter of a second
 * or so into the step, and waits once more for each time NVDA wasn't. The clock is set by a step's
 * key, so when that key waited once more than another step's, the clock is that much late for the
 * other: its key comes up to this much before the moment the clock gives it, so each step's time on
 * the clock begins this much early (lineUp). On the real run of 6 October 2026, every key came
 * within 8 ms of its moment.
 */
const ONE_MORE_WAIT_MS = 300;

/**
 * How far back a pass's first Tab, which has no key in NVDA's log, looks for what NVDA said, before
 * the moment the pass's clock gives it: two more waits. That moment is set by the key that came
 * soonest in its step (speechOf), which is as late as that key waited more than the first Tab did:
 * once more, when every step's key waited once. A pass whose first Tab finds nothing there isn't
 * checked (checkAgainstLog). Two more waits stay well clear of what NVDA said as the page opened:
 * on the real runs of 6 and 10 October 2026, the driver's Ctrl+Home came 1.27 s or more before the
 * first Tab's moment, and the first Tabs' speech 35 to 67 ms after it. They don't stay clear of
 * what NVDA began to say just before the first Tab: voicecap's capture silences NVDA a quarter of a
 * second or more before each key, so words NVDA began 0.3 to 0.6 s before the first Tab, and was
 * cut off from (a map in a frame, talking as the step began), are within reach. They're taken as
 * the first Tab's, and its line is listed, though it doesn't differ: a rare false listing, on the
 * safe side.
 */
const FIRST_TAB_REACH_MS = 2 * ONE_MORE_WAIT_MS;

/**
 * Pair the steps of a run's kept transcripts with NVDA's own log, and compare what each says. The
 * copies are those of one or more NVDA sessions; the steps are the kept attempts' passes, each with
 * its attempt's window (its page-started to its page-finished, from the event log), and a page's
 * passes in the order the run read them (the pages' own order doesn't matter: each pass is placed
 * by its window); the thrown-out windows are the failed attempts', from their records (startedAt
 * to endedAt); and gestureOf gives the key a step's command presses, as NVDA logs it. A pass the
 * log can't be paired with for certain is left out of the check (see lineUp), and so is one whose
 * first step, with no key of its own, has no speech where the pass's keys place it. Throws when a
 * window's times can't be read, or end before they begin: a check that can't place an attempt
 * can't say what's outside it.
 */
export function checkAgainstLog(input: {
  logs: string[];
  steps: PassSteps[];
  thrownOut: { from: string; to: string }[];
  gestureOf: (command: DriverCommand) => string | null;
}): LogCheck {
  const { gestureOf } = input;
  const thrownOut = input.thrownOut.map((window) => readWindow(window, "a thrown-out attempt"));
  const windows = input.steps.map((pass) =>
    readWindow(pass.within, `the ${pass.pass} pass at ${pass.page}`),
  );
  const copies = input.logs.map((log) => readCopy(log, thrownOut));
  const placed = input.steps.map((pass, index): Placed => ({
    pass,
    spans: copies.map((copy) => spanOn(windows[index]!, copy.start)),
  }));
  const stepKeys = new Set<string>();
  for (const pass of input.steps) {
    for (const step of pass.steps) {
      const gesture = gestureOf(step.command);
      if (gesture !== null) stepKeys.add(gesture);
    }
  }
  const stretches = copies.flatMap((copy, index) => stretchesOf(copy, index, stepKeys));

  const claimed = new Set<Said>();
  const taken = new Set<Stretch>();
  // Where each page's next pass looks from: after the stretch its last pass took.
  const pageAfter = new Map<string, number>();
  const check: LogCheck = {
    transcriptLines: 0,
    logLines: 0,
    agree: 0,
    onlyInLog: [],
    onlyInTranscripts: [],
    outside: 0,
  };
  placed.forEach((current, index) => {
    const { pass } = current;
    const page = `${pass.within.from} ${pass.within.to}`;
    const from = pageAfter.get(page) ?? 0;
    const found = stretchFor(current, placed[index + 1], stretches, from, taken, gestureOf);
    let laid: Laid | null = null;
    if (found !== null) {
      const stretch = stretches[found.index]!;
      taken.add(stretch);
      pageAfter.set(page, found.index + 1);
      // A pass the log can't be paired with for certain isn't checked: its steps are in no count or
      // list (the caller counts them as not checked), and its speech is outside the steps.
      if (!found.placement.certain) return;
      const span = current.spans[stretch.copy]!;
      laid = { placement: found.placement, copy: copies[stretch.copy]!, span };
      // A first step with no key of its own (a page's first Tab) is placed by the other steps' keys.
      // Where NVDA said nothing at its moment, they may place it wrong, as a clock a step early does
      // (at the driver's Ctrl+Home) or one set by keys that all waited longer than it did, so the
      // pass isn't checked either.
      const keyless = keysOf(pass.steps, gestureOf)[0] === null;
      if (keyless && speechOf(pass.steps, 0, laid, claimed) === null) return;
    }
    pass.steps.forEach((step, k) => {
      check.transcriptLines += 1;
      const said = laid === null ? null : speechOf(pass.steps, k, laid, claimed);
      const spoken = normalizeSpeech(step.spoken);
      const where = { page: pass.page, pass: pass.pass, step: step.n };
      if (said === null) {
        if (spoken !== "") check.onlyInTranscripts.push({ ...where, text: spoken });
        return;
      }
      for (const entry of said) claimed.add(entry);
      check.logLines += 1;
      const utterances = said.map((entry) => entry.items);
      if (spokenAsLogged(utterances, spoken)) {
        check.agree += 1;
        return;
      }
      const logged = normalizeSpeech(joinedText(utterances));
      if (logged !== "") check.onlyInLog.push({ ...where, text: logged });
      if (spoken !== "") check.onlyInTranscripts.push({ ...where, text: spoken });
    });
  });

  // Speech no step claimed is outside the steps, and so is every entry set aside.
  check.outside = copies.reduce((sum, copy) => sum + copy.speaking, 0) - claimed.size;
  return check;
}

/**
 * The speech of a pass's k-th step, laid on a copy's clock, inside the pass's window, leaving out
 * what earlier steps have claimed; null when the log doesn't have the step (no key of its own, and
 * no speech at its time).
 */
function speechOf(
  steps: readonly StepRecord[],
  k: number,
  { placement, copy, span }: Laid,
  claimed: ReadonlySet<Said>,
): Said[] | null {
  const step = steps[k]!;
  const key = placement.keys[k] ?? null;
  // Where the step's key was pressed, or would have been. For a step with no key of its own, the
  // moment the key that came soonest in its step gives: a key comes later in its step for each time
  // voicecap's capture waited for NVDA to be quiet, never sooner, so that key waited least. The
  // pass's own clock is set by one step's key, which may have waited longer, or have come in a
  // later step's time, when order gave the keys their steps.
  const clock = keylessClock(steps, placement.keys) ?? placement.clock;
  const anchor = key?.at ?? clock + startOf(step);
  const from = key?.at ?? clock + reachOf(steps, k);
  const said = burst(copy, from, anchor, step.durationMs, claimed, span);
  return key === null && said.length === 0 ? null : said;
}

/**
 * The stretch a pass takes, from `from` on, among those with keys inside its window: the first it
 * fits (see fits), unless the next pass fits it too and pairs more of its keys. A stretch the next
 * pass fits before this one fits any means this pass has none: its keys aren't in the log (a pass
 * whose only step is the first Tab). The next pass is only ever the same page's, in practice: a
 * stretch of the page's has no keys inside another page's window.
 */
function stretchFor(
  current: Placed,
  next: Placed | undefined,
  stretches: readonly Stretch[],
  from: number,
  taken: ReadonlySet<Stretch>,
  gestureOf: (command: DriverCommand) => string | null,
): { index: number; placement: Placement } | null {
  for (let index = from; index < stretches.length; index += 1) {
    const stretch = stretches[index]!;
    if (taken.has(stretch)) continue;
    const keys = keysInside(current, stretch);
    if (keys.length === 0) continue;
    const mine = lineUp(current.pass.steps, keys, gestureOf);
    const theirs =
      next === undefined ? null : lineUp(next.pass.steps, keysInside(next, stretch), gestureOf);
    const nextFits = next !== undefined && fits(next.pass, theirs, gestureOf);
    if (mine !== null && fits(current.pass, mine, gestureOf)) {
      if (!(nextFits && theirs!.matched > mine.matched)) return { index, placement: mine };
    }
    if (nextFits) return null;
  }
  return null;
}

/** The keys of a stretch that fall inside a pass's window. */
function keysInside(placed: Placed, stretch: Stretch): Key[] {
  const [from, to] = placed.spans[stretch.copy]!;
  return stretch.keys.filter((key) => key.at >= from && key.at <= to);
}

/**
 * Whether a pass fits a stretch: laid on its clock, at least half of the pass's steps that press a
 * key NVDA logs (and at least one) find theirs there.
 */
function fits(
  pass: PassSteps,
  placement: Placement | null,
  gestureOf: (command: DriverCommand) => string | null,
): boolean {
  if (placement === null) return false;
  const keyed = keysOf(pass.steps, gestureOf).filter((gesture) => gesture !== null).length;
  return placement.counted >= Math.max(1, Math.ceil(keyed / 2));
}

/**
 * The key each step presses, as NVDA logs it (gestureOf), or null where NVDA logs none. A pass's
 * first Tab has none: voicecap presses it in the browser, not through NVDA, so NVDA's log has no
 * key for it (the first `nextFocusable` after the page opens: see
 * src/drivers/guidepup/nvda-log.ts).
 */
function keysOf(
  steps: readonly StepRecord[],
  gestureOf: (command: DriverCommand) => string | null,
): (string | null)[] {
  const firstTab = steps.findIndex((step) => step.command === "nextFocusable");
  return steps.map((step, k) => (k === firstTab ? null : gestureOf(step.command)));
}

/**
 * The pass's clock for a step with no key of its own: set by the key that came soonest in its step,
 * of those paired; null when none is.
 */
function keylessClock(steps: readonly StepRecord[], keys: readonly (Key | null)[]): number | null {
  const soonest = keys.reduce(
    (least, each, j) => (each === null ? least : Math.min(least, each.at - startOf(steps[j]!))),
    Infinity,
  );
  return Number.isFinite(soonest) ? soonest : null;
}

/**
 * Where a step with no key of its own reaches back to for its speech, on its pass's clock: halfway
 * back to the step before it. The first, with no step before it, reaches back FIRST_TAB_REACH_MS
 * before its moment, but never further, and never before its own window (half its duration back);
 * its pass's window bounds it too (burst).
 */
function reachOf(steps: readonly StepRecord[], k: number): number {
  return Math.max(edgeOf(steps, k), startOf(steps[0]!) - FIRST_TAB_REACH_MS);
}

/** When a step began, in milliseconds after its pass began. */
function startOf(step: StepRecord): number {
  return step.offsetMs - step.durationMs;
}

/**
 * Where the k-th step's speech can begin on its pass's clock, when it has no key of its own:
 * halfway back to the step before's start (half the first step's own duration, for the first).
 */
function edgeOf(steps: readonly StepRecord[], k: number): number {
  const start = startOf(steps[k]!);
  return start - (k === 0 ? steps[0]!.durationMs : start - startOf(steps[k - 1]!)) / 2;
}

/**
 * Lay a pass on a stretch's clock: the moment whose pairing accounts for the most of its keys. Each
 * key goes to the step in whose time it was pressed, and only to a step that presses that key (the
 * nearest to the step's start, of two). On the clock, a step's key comes at the step's start, give
 * or take. voicecap's capture presses a step's key once NVDA is quiet, so it comes seconds into its
 * step when NVDA was still talking as the step began (a map in a frame, say), and the clock is set
 * by one step's key, so another's comes up to one more wait before the moment the clock gives it.
 * So a step's time on the clock runs from its start to the next step's, each less one more wait
 * (ONE_MORE_WAIT_MS). A key NVDA took late, after its step's time, falls in a later step's time,
 * alone or with others it took together; order gives such keys their steps where it can say whose
 * they are (inOrder). The moments tried pair one of the pass's last three steps with one of the
 * last four keys it presses in the stretch, then one of its first three with one of the first four.
 *
 * A pairing accounts for the keys it pairs, and for those left over near its steps without keys,
 * which order couldn't place there but which may be theirs. Counting these too, a pairing that
 * leaves a run of keys taken late unplaced isn't outranked by one that pairs a key more by moving
 * every step one off. The placement is certain when no other moment tried accounts for as many keys
 * some other way, and no key is left over between its first step's key and its last's: a key left
 * there means a step near it may have another step's key. Otherwise which key was whose can't be
 * told without the words, which the pairing doesn't look at, so the pass isn't checked: as when a
 * key the pass didn't press comes just before its first step, after its last, or among its steps,
 * NVDA logged a key twice, NVDA didn't log the key of the pass's first or last step, or two keys in
 * a row came after their steps' time, where order can't say whose they are.
 *
 * Two things wrong at once can still mislead it, as no real run has shown. The cases found include
 * a step whose key NVDA didn't log, or two keys in a row taken late, and a key no step pressed, or
 * one NVDA logged twice, elsewhere in the pass; two keys in a row taken late, twice in a pass; and
 * keys taken late with a step whose key NVDA didn't log. Each step between them can then take a
 * neighbor's key, one step off, a pairing that leaves no key over among its own: a key no step
 * pressed in the next step's time looks like the step's key taken late, with the next step's after
 * it, and one just before the pass's first step like a clock a step early. In that step's own time,
 * such a key is taken for its own. Those steps are compared with words not theirs, and listed where
 * those differ from their lines. But a real gap among them can go unshown: a step agrees with a
 * neighbor's words where neighboring lines read the same (headings that all say "News"), and a step
 * left without a key, whose words came in a later step's time, is counted as having none on either
 * side.
 */
function lineUp(
  steps: readonly StepRecord[],
  keys: readonly Key[],
  gestureOf: (command: DriverCommand) => string | null,
): Placement | null {
  if (steps.length === 0 || keys.length === 0) return null;
  const starts = steps.map(startOf);
  const gestures = keysOf(steps, gestureOf);
  // Each step's window on the pass's clock: its own time, from its start to the next step's, each
  // less one more wait. A wider early side would take as much from the late side, where the keys
  // NVDA took late land: with half a step (0.64 s), many more of them fell in the next step's time,
  // where that step took one as its own when it was nearer its start, hiding a real gap and listing
  // the next step one step off. With one more wait, such a key falls in the next step's time only
  // when it came in its own step's last 0.3 s or after, and order then places it where it can say
  // whose it is (inOrder). A pass whose keys at either end waited longer than those in its middle,
  // by more than one more wait (0.4 s, say), can't be paired, and isn't checked: the safe side.
  const edges = starts.map((start) => start - ONE_MORE_WAIT_MS);
  edges.push(starts.at(-1)! + steps.at(-1)!.durationMs - ONE_MORE_WAIT_MS);

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

  let best: Omit<Placement, "certain"> | null = null;
  // Whether a key was left over among the best's: between its first step's key and its last's.
  let leftOver = false;
  // The other pairings tried that account for as many keys as the best so far.
  let rivals: (Key | null)[][] = [];
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
    const { near, over } = inOrder(placed, keys, gestures, clock, edges);
    const matched = placed.filter((key) => key !== null).length;
    const counted = matched + near;
    if (counted > (best?.counted ?? 0)) {
      best = { clock, keys: placed, matched, counted };
      leftOver = over;
      rivals = [];
    } else if (best !== null && counted === best.counted) {
      const chosen = best.keys;
      if (!placed.every((key, k) => key === chosen[k])) rivals.push(placed);
    }
  }
  if (best === null) return null;
  return { ...best, certain: !leftOver && rivals.length === 0 };
}

/**
 * Give keys to a placement's steps that have none, where order says whose they are, and say what's
 * left over. Keys come in their steps' order, and a step's key comes no earlier than its step's
 * time (less one more wait), but NVDA can take it late, after its step's time, once voicecap's
 * capture has stopped listening, and then it's in a later step's time, alone or with the keys of
 * the steps after it, when NVDA took several together:
 * - between two steps' keys, the keys left out go to the steps between them that have none, when
 *   they pair one to one, in order, by their keys, each no earlier than its step's time;
 * - steps with none, then a step whose time holds a key for each of them and its own (one taken
 *   late, or several taken together), get those keys in order, that step the last.
 * Keys before the first step's key, or after the last one's, are left as they are: there, a key no
 * step pressed can't be told from a step's. Returns `near`, how many keys left over could be those
 * of the steps still without keys (left over between the key before such steps and the end of the
 * next step's time, of keys they press, as many as the steps, each key counted once), and `over`,
 * whether any key is left over between the first step's key and the last's.
 */
function inOrder(
  placed: (Key | null)[],
  keys: readonly Key[],
  gestures: readonly (string | null)[],
  clock: number,
  edges: readonly number[],
): { near: number; over: boolean } {
  const used = new Set(placed);
  const could = (key: Key, k: number) => gestures[k] === key.gesture && key.at - clock >= edges[k]!;
  const paired = () => placed.flatMap((key, k) => (key === null ? [] : [k]));
  const between = paired();
  for (let p = 1; p < between.length; p += 1) {
    const i = between[p - 1]!;
    const j = between[p]!;
    const empty = gestures
      .slice(i + 1, j)
      .flatMap((gesture, n) => (gesture === null ? [] : [i + 1 + n]));
    if (empty.length === 0) continue;
    const [from, to] = [placed[i]!.at, placed[j]!.at];
    const left = keys.filter((key) => key.at > from && key.at < to && !used.has(key));
    if (left.length !== empty.length || !empty.every((k, n) => could(left[n]!, k))) continue;
    empty.forEach((k, n) => {
      placed[k] = left[n]!;
      used.add(left[n]!);
    });
  }
  const inTimeOf = (key: Key) => windowAt(edges, key.at - clock);
  for (let k = 0; k < placed.length; k += 1) {
    if (placed[k] !== null || gestures[k] === null) continue;
    // The steps without keys from here, and the first after them with one.
    let j = k;
    while (j < placed.length && placed[j] === null) j += 1;
    const taken = placed[j];
    if (taken === undefined || taken === null) break;
    const run = [...gestures.keys()].filter((s) => s >= k && s <= j && gestures[s] !== null);
    const there = keys.filter((key) => inTimeOf(key) === j && (key === taken || !used.has(key)));
    if (there.length === run.length && run.every((s, n) => could(there[n]!, s))) {
      run.forEach((s, n) => {
        placed[s] = there[n]!;
        used.add(there[n]!);
      });
    }
    k = j;
  }
  const steps = paired();
  if (steps.length === 0) return { near: 0, over: false };
  const [from, to] = [placed[steps[0]!]!.at, placed[steps.at(-1)!]!.at];
  const over = keys.some((key) => key.at > from && key.at < to && !used.has(key));
  // Each run of steps still without keys between two with keys, and the keys left over near it:
  // from the key before the run to the end of the next step's time, where keys taken late land. As
  // many as both, of each key the run's steps press, and each key once: the soonest not yet counted
  // for a run before.
  const counted = new Set<Key>();
  for (let p = 1; p < steps.length; p += 1) {
    const [i, j] = [steps[p - 1]!, steps[p]!];
    const run = gestures.slice(i + 1, j).filter((gesture) => gesture !== null);
    if (run.length === 0) continue;
    const until = clock + edges[j + 1]!;
    for (const gesture of new Set(run)) {
      const without = run.filter((each) => each === gesture).length;
      const nearby = keys.filter(
        (key) =>
          key.gesture === gesture &&
          key.at > placed[i]!.at &&
          key.at < until &&
          !used.has(key) &&
          !counted.has(key),
      );
      for (const key of nearby.slice(0, without)) counted.add(key);
    }
  }
  return { near: counted.size, over };
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
 * next key or the step's time is up (`anchor` plus its duration), as one burst, and only inside its
 * pass's window (`span`). voicecap's capture keeps listening until NVDA has been quiet for a while,
 * so every pause inside a step's speech is shorter than that quiet, and the step lasts at least the
 * pause and the quiet together: no pause in a step's own speech is as long as half the step. A
 * pause that long means its speech had ended, and what comes after is something else (the next
 * page's window, as voicecap opens it).
 */
function burst(
  copy: Copy,
  from: number,
  anchor: number,
  durationMs: number,
  claimed: ReadonlySet<Said>,
  [opened, closed]: [number, number],
): Said[] {
  const nextKey = copy.keys[firstFrom(copy.keys, from, true)]?.at ?? Infinity;
  const until = Math.min(nextKey, anchor + durationMs);
  const said: Said[] = [];
  let last = anchor;
  const first = firstFrom(copy.said, Math.max(from, opened), false);
  for (let index = first; index < copy.said.length; index += 1) {
    const entry = copy.said[index]!;
    if (claimed.has(entry)) continue;
    if (entry.at >= until || entry.at > closed || Math.abs(entry.at - last) > durationMs / 2) break;
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
function stretchesOf(copy: Copy, index: number, stepKeys: ReadonlySet<string>): Stretch[] {
  const stretches: Stretch[] = [];
  let keys: Key[] = [];
  for (const key of copy.keys) {
    if (stepKeys.has(key.gesture)) {
      keys.push(key);
    } else if (keys.length > 0) {
      stretches.push({ copy: index, keys });
      keys = [];
    }
  }
  if (keys.length > 0) stretches.push({ copy: index, keys });
  return stretches;
}

/** Read a cleaned copy: its keys and speech, in time order, with the thrown-out windows' set aside. */
function readCopy(log: string, thrownOut: readonly Window[]): Copy {
  const entries = splitLogEntries(log);
  const times = entryTimes(entries);
  const start = entries[0]?.timeMs ?? 0;
  const aside = thrownOut.map((window) => spanOn(window, start));
  const thrown = (at: number) => aside.some(([from, to]) => at >= from && at <= to);
  const copy: Copy = { start, keys: [], said: [], speaking: 0 };
  entries.forEach((entry, index) => {
    if (entry.level !== "IO") return;
    const line = entry.message.split("\n", 1)[0] ?? "";
    const at = times[index]!;
    if (line.startsWith(INPUT)) {
      const gesture = KEYBOARD_KEY.exec(line)?.[1] ?? line.slice(INPUT.length);
      if (!thrown(at)) copy.keys.push({ at, gesture });
    } else if (line.startsWith(SPEAKING)) {
      copy.speaking += 1;
      if (!thrown(at)) copy.said.push({ at, items: itemsOf(line.slice(SPEAKING.length)) });
    }
  });
  copy.keys.sort((a, b) => a.at - b.at);
  copy.said.sort((a, b) => a.at - b.at);
  return copy;
}

/**
 * What checkAgainstLog throws when it can't place a window the run recorded: its times can't be
 * read, or it ends before it begins. A caller tells it from any other error by its class, never by
 * its words, so rewording it can't turn a session that can't be checked into a failed page.
 */
export class CantCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CantCheckError";
  }
}

/**
 * A window the run recorded, read: its start's time of day, and its length from its own two
 * times. One that can't be read, or that ends before it begins, is a CantCheckError that names it.
 */
function readWindow(window: { from: string; to: string }, of: string): Window {
  const from = localTime(window.from);
  const to = localTime(window.to);
  const length = from === null || to === null ? NaN : to.wallClock - from.wallClock;
  if (from === null || !(length >= 0)) {
    const times = `${JSON.stringify(window.from)} to ${JSON.stringify(window.to)}`;
    const problem = length < 0 ? "ends before it begins" : "can't be read";
    throw new CantCheckError(
      `NVDA's log can't be checked: the window of ${of} (${times}) ${problem}.`,
    );
  }
  return { timeOfDay: from.timeOfDay, length };
}

/**
 * A window on a copy's timeline, as its times are: its start's time of day on the day the log
 * would put it (timeOnLog), and its length.
 */
function spanOn(window: Window, start: number): [number, number] {
  const at = timeOnLog(window.timeOfDay, start);
  return [at, at + window.length];
}

/** A local ISO time's wall clock (its date and time, as milliseconds) and its time of day. */
function localTime(iso: string): { wallClock: number; timeOfDay: number } | null {
  const match = LOCAL_TIME.exec(iso);
  if (match === null) return null;
  const part = (index: number) => Number(match[index]);
  const month = part(2);
  const day = part(3);
  const hours = part(4);
  const minutes = part(5);
  const seconds = part(6);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  const ms = Number((match[7] ?? "0").padEnd(3, "0"));
  const timeOfDay = ((hours * 60 + minutes) * 60 + seconds) * 1000 + ms;
  return { wallClock: Date.UTC(part(1), month - 1, day) + timeOfDay, timeOfDay };
}

/**
 * A Speaking entry's text items, each as voicecap's capture has it: trimmed, with its runs of
 * spaces made one. An empty item stays, as it does in a transcript (", , "), and NVDA's commands
 * (LangChangeCommand, BreakCommand, CancellableSpeech) are left out.
 */
function itemsOf(repr: string): string[] {
  let items: string[];
  try {
    items = parseReprList(repr).flatMap((item) => (item.kind === "string" ? [item.value] : []));
  } catch (error) {
    if (!(error instanceof ReprParseError)) throw error;
    items = scavengeStrings(repr);
  }
  return items.map(normalizeSpeechItem);
}

/** A step's entries joined the way voicecap's capture joins them: items with ", ", entries ". ". */
function joinedText(utterances: readonly (readonly string[])[]): string {
  return utterances.map((items) => items.join(", ")).join(". ");
}

/** A line without its spaces, which don't count (see spokenAsLogged). */
function withoutSpaces(text: string): string {
  return text.replace(/\s+/gu, "");
}

const WORD = /[\p{L}\p{M}\p{N}]/u;
const LETTER = /[\p{L}\p{M}]/u;
const SPACE = /\s/u;
/** The most words a symbol's name is taken to have ("plus or minus"). */
const NAME_WORDS = 4;
/**
 * The most places spokenAsLogged searches: one for each pair of a place in the log's characters and
 * a place in the transcript's, each a byte, so about 4 MB. A step's speech is a line or two, far
 * under it (2,000 characters a side is about 4 million places); a longer one is compared as it is,
 * spaces aside.
 */
const MOST_PLACES = 4_000_000;
/**
 * The marks that end a sentence or a phrase, which NVDA doesn't say at its usual symbol level: an
 * item that ends with one, or with an ellipsis written as three dots (ELLIPSIS), right after a
 * letter or digit, ends with its `tail`.
 */
const CLOSING: ReadonlySet<string> = new Set([".", ",", ";", ":", "!", "?", "…"]);
const ELLIPSIS = "...";

/**
 * One character of what NVDA logged, for spokenAsLogged: a character of an item, or a joiner
 * between items (", ") or between entries (". "), which must appear from `min` to `max` times. A
 * character is a `tail` when it's the sentence's or phrase's mark that ends its item (CLOSING).
 */
type Token =
  | { joiner: false; ch: string; tail: boolean }
  | { joiner: true; ch: string; min: number; max: number };

/**
 * Whether a transcript's line says what NVDA's log has it saying: the step's Speaking entries, each
 * a list of text items. NVDA logs the text it was given before it processes it for speech: it then
 * reads each symbol at its symbol level, saying some by name ("read.txt" as "read dot txt", a "." on
 * its own as "dot") and leaving others out ("|", quotation marks), and its dictionary splits some
 * words ("macOS" as "mac OS"). The transcript has what NVDA said after that. So here:
 * - every letter and digit must be the same, in order;
 * - where an item has a symbol, the transcript can have the symbol, nothing, or up to NAME_WORDS
 *   whole words (a name, perhaps with the symbol after it). The words aren't compared with NVDA's
 *   own names for symbols, which the comparison doesn't know: any one to four words can stand for
 *   a symbol, so "Price: 10" agrees with "Price is not 10", and "Up 5%" with "Up 5 percent" (as
 *   NVDA says it) and with "Up 5 is not good" alike;
 * - except a closing mark (CLOSING: `.` `,` `;` `:` `!` `?`, or an ellipsis) right after a letter or
 *   digit at the end of an item: NVDA's usual symbol level doesn't say these, so it can only be
 *   there or not, never words, and words after a line's last mark always differ. A closing mark
 *   that follows another mark isn't right after a letter or digit, so "Really?!" agrees with
 *   "Really now please";
 * - the ", " between items and the ". " between entries come from voicecap's capture, not from
 *   NVDA, so each must be there, as it is. Only an entry with no text (NVDA's commands alone) may
 *   or may not have come through: the ". " beside it can be there or not;
 * - spaces don't count.
 * Two gaps remain: the words for every symbol but a closing mark right after a letter or digit at
 * the end of an item, which can be any one to four; and a line that's only symbols, which agrees
 * with an empty line ("." and ""), though NVDA says a "." on its own as "dot": which symbols NVDA
 * leaves out depends on its symbol level, and the comparison lets any be left out. A step whose two
 * sides would take more than MOST_PLACES places to search is compared as it is, spaces aside (so
 * "R3", which NVDA says "R 3", agrees), which can only find a difference.
 */
export function spokenAsLogged(logged: readonly (readonly string[])[], spoken: string): boolean {
  // The same, spaces aside: the search would find it so, character for character.
  if (withoutSpaces(joinedText(logged)) === withoutSpaces(spoken)) return true;
  const said = tokensOf(logged);
  const heard = Array.from(spoken);
  const width = heard.length + 1;
  // The search keeps a byte for each place: a step too long for that differs, as it isn't the same.
  if ((said.length + 1) * width > MOST_PLACES) return false;
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
    const token = said[i]!;
    if (token.joiner) {
      if (token.min === 0) go(i + 1, j);
      let at = j;
      for (let count = 1; count <= token.max; count += 1) {
        at = pastSpaces(heard, at);
        if (heard[at] !== token.ch) break;
        at += 1;
        if (count >= token.min) go(i + 1, at);
      }
      continue;
    }
    const { ch } = token;
    if (WORD.test(ch)) {
      if (heard[j] === ch) go(i + 1, j + 1);
      continue;
    }
    go(i + 1, j); // left out
    if (heard[j] === ch) go(i + 1, j + 1); // kept
    if (token.tail) continue; // the mark that ends its item is never said by name
    for (const end of nameEnds(heard, j)) {
      go(i + 1, end); // said by name
      const after = pastSpaces(heard, end);
      if (heard[after] === ch) go(i + 1, after + 1); // said by name, and kept
    }
  }
  return false;
}

/**
 * The characters of a step's entries, with the joiners voicecap's capture puts between them. An
 * entry with no text makes no characters, and the ". " it would bring may be there or not. The
 * sentence's or phrase's mark that ends an item is its `tail` (see closingFrom).
 */
function tokensOf(utterances: readonly (readonly string[])[]): Token[] {
  const tokens: Token[] = [];
  let begun = false;
  let empty = 0;
  for (const items of utterances) {
    if (items.length === 0) {
      empty += 1;
      continue;
    }
    if (begun || empty > 0) {
      const min = begun ? 1 : 0;
      tokens.push({ joiner: true, ch: ".", min, max: min + empty });
    }
    begun = true;
    empty = 0;
    items.forEach((item, k) => {
      if (k > 0) tokens.push({ joiner: true, ch: ",", min: 1, max: 1 });
      const chars = Array.from(item);
      const end = chars.findLastIndex((ch) => !SPACE.test(ch));
      const closing = closingFrom(chars, end);
      chars.forEach((ch, at) => {
        if (!SPACE.test(ch)) tokens.push({ joiner: false, ch, tail: at >= closing });
      });
    });
  }
  const trailing = begun ? empty : empty - 1;
  if (trailing > 0) tokens.push({ joiner: true, ch: ".", min: 0, max: trailing });
  return tokens;
}

/**
 * Where the mark that ends an item begins, among its characters, `end` being its last that isn't a
 * space: an ellipsis written as three dots, or one mark of CLOSING, right after a letter or digit
 * with no space between ("guide." and "more...", not "guide ."). Past `end` when it has none.
 */
function closingFrom(chars: readonly string[], end: number): number {
  const afterWord = (at: number) => WORD.test(chars[at - 1] ?? "");
  const dots = end - ELLIPSIS.length + 1;
  if (dots >= 0 && chars.slice(dots, end + 1).join("") === ELLIPSIS && afterWord(dots)) return dots;
  return CLOSING.has(chars[end] ?? "") && afterWord(end) ? end : end + 1;
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
