import { setImmediate as nextTurn } from "node:timers/promises";

import { describe, expect, it, vi } from "vitest";

import type { Key } from "../src/review-replay/keys.js";
import {
  onKey,
  onLineSpoken,
  playPage,
  playerKeyOf,
  startState,
  type PlayLine,
  type PlayerKey,
  type PlayerState,
  type Transcripts,
} from "../src/review-replay/player.js";
import type { Voice } from "../src/review-replay/voice.js";
import { EnvironmentError, errorMessage } from "../src/util/errors.js";
import { fakeVoice, keyQueue, sayingEach, untilSaying } from "./helpers/replay.js";

// The top of a page's read transcript, as D6 plays it: from Ctrl+Home's line, line 2 of read.txt.
const SKIP: PlayLine = {
  n: 2,
  text: "[to top] Skip to main content, link",
  spoken: "Skip to main content, link",
  marks: [],
};
const ABOUT: PlayLine = {
  n: 3,
  text: "banner landmark, About i2i, link",
  spoken: "banner landmark, About i2i, link",
  marks: [],
};
const LOGO: PlayLine = {
  n: 4,
  text: "link, Unlabeled graphic, i 2i Logo",
  spoken: "link, Unlabeled graphic, i 2i Logo",
  marks: ["unlabeled graphic"],
};
const WELCOME: PlayLine = {
  n: 1,
  text: "heading level 1, Welcome",
  spoken: "heading level 1, Welcome",
  marks: [],
};
const NEWS: PlayLine = {
  n: 2,
  text: "heading level 2, Latest news",
  spoken: "heading level 2, Latest news",
  marks: [],
};

/** A step where NVDA said nothing: shown as "[no speech]", and not said. */
const SILENT: PlayLine = { n: 3, text: "[no speech]", spoken: "", marks: [] };

/** What most tests play: three read lines (the third raised a flag), two headings, no Tab lines. */
const TRANSCRIPTS: Transcripts = { read: [SKIP, ABOUT, LOGO], headings: [WELCOME, NEWS], tab: [] };

/** A read transcript with a silent line between two lines with words. */
const WITH_SILENT: Transcripts = { read: [SKIP, SILENT, LOGO] };

const char = (typed: string): Key => ({ name: "char", char: typed });
const SPACE: Key = { name: "space" };
const LEFT: Key = { name: "left" };
const RIGHT: Key = { name: "right" };
const ENTER: Key = { name: "enter" };
const CTRL_C: Key = { name: "ctrl-c" };

type KeyQueue = ReturnType<typeof keyQueue>;

/** Where the player writes, kept as a terminal would show it. */
function screen() {
  let shown = "";
  return {
    out: {
      write(chunk: string) {
        shown += chunk;
        return true;
      },
    },
    shown: () => shown,
  };
}

/** A screen's text, line by line. */
const screenOf = (...lines: string[]): string => lines.map((line) => `${line}\n`).join("");

/**
 * What `promise` gives once everything already under way has run (the fakes never wait on a
 * timer), or "still waiting" when it hasn't settled by then.
 */
function soon<T>(promise: Promise<T>): Promise<T | "still waiting"> {
  return Promise.race([promise, nextTurn().then(() => "still waiting" as const)]);
}

/** Plays `transcripts` (TRANSCRIPTS by default) at 180 words a minute, onto a screen. */
function play(voice: Voice, keys: KeyQueue = keyQueue(), transcripts: Transcripts = TRANSCRIPTS) {
  const { out, shown } = screen();
  const playing = playPage({ transcripts, rate: 180, voice, keys, out });
  return { playing, keys, shown };
}

/**
 * A voice whose line never ends, even once it's stopped, as a Windows speech line can hang. `fail`
 * fails that line later on, as when the voice's program ends.
 */
function wedgedVoice(): Voice & { stops: number; fail(error: Error): void } {
  let failLine = (_error: Error): void => {};
  const voice = {
    stops: 0,
    say: () =>
      new Promise<void>((_resolve, reject) => {
        failLine = reject;
      }),
    stop: () => {
      voice.stops += 1;
    },
    close: () => Promise.resolve(),
    fail: (error: Error) => failLine(error),
  };
  return voice;
}

describe("the player's state", () => {
  it("starts at the read transcript's first line, playing", () => {
    expect(startState(TRANSCRIPTS, 200)).toEqual({
      transcripts: TRANSCRIPTS,
      pass: "read",
      index: 0,
      paused: false,
      rate: 200,
      outcome: "playing",
      notice: null,
    });
  });

  it("asks at once, and says why, when the read transcript has no lines", () => {
    for (const transcripts of [{ read: [], headings: [WELCOME] }, { headings: [WELCOME] }]) {
      expect(startState(transcripts, 180)).toMatchObject({
        outcome: "decide",
        notice: "No lines in the read transcript.",
      });
    }
  });

  /** The start state with `changes`: a page partway through. */
  const at = (changes: Partial<PlayerState>): PlayerState => ({
    ...startState(TRANSCRIPTS, 180),
    ...changes,
  });

  const moves: [string, Partial<PlayerState>, (PlayerKey | "spoken")[], Partial<PlayerState>][] = [
    ["ahead goes on a line", {}, ["ahead"], { index: 1 }],
    ["ahead at the last line asks", { index: 2 }, ["ahead"], { outcome: "decide" }],
    ["back goes back a line", { index: 2 }, ["back"], { index: 1 }],
    ["back at the first line stays there", {}, ["back"], {}],
    [
      "back while playing passes over a silent line, to the line with words before it",
      { transcripts: WITH_SILENT, index: 2 },
      ["back"],
      { index: 0 },
    ],
    [
      "back while playing, with only silent lines before, stays, so the line is said again",
      { transcripts: { read: [{ ...SILENT, n: 2 }, ABOUT] }, index: 1 },
      ["back"],
      {},
    ],
    [
      "ahead while playing passes over a silent line, to the line with words after it",
      { transcripts: WITH_SILENT },
      ["ahead"],
      { index: 2 },
    ],
    [
      "ahead while playing, with only silent lines after, asks",
      { transcripts: { read: [SKIP, SILENT] } },
      ["ahead"],
      { outcome: "decide" },
    ],
    [
      "back while paused goes back a line, a silent one too (D7)",
      { transcripts: WITH_SILENT, index: 2, paused: true },
      ["back"],
      { index: 1 },
    ],
    [
      "ahead while paused goes on a line, a silent one too (D7)",
      { transcripts: WITH_SILENT, paused: true },
      ["ahead"],
      { index: 1 },
    ],
    ["next-flag goes to the next line with a mark", {}, ["next-flag"], { index: 2 }],
    [
      "next-flag with no marked line after this one says so, and stays",
      { index: 2 },
      ["next-flag"],
      { notice: "No flagged line after this one." },
    ],
    [
      "headings plays that transcript from its start",
      { index: 1 },
      ["headings"],
      { pass: "headings", index: 0 },
    ],
    [
      "headings while it plays starts it again",
      { pass: "headings", index: 1 },
      ["headings"],
      { index: 0 },
    ],
    [
      "tab, with no lines, says so, and the transcript playing stays",
      { index: 1 },
      ["tab"],
      { notice: "No lines in the Tab transcript." },
    ],
    ["read at index 2 of read starts it again", { index: 2 }, ["read"], { index: 0 }],
    [
      "read from the headings goes back to the read transcript",
      { pass: "headings", index: 1 },
      ["read"],
      { pass: "read", index: 0 },
    ],
    [
      "faster from 180 gives 200",
      {},
      ["faster"],
      { rate: 200, notice: "Speed: 200 words a minute." },
    ],
    [
      "faster at 540 stays at 540",
      { rate: 540 },
      ["faster"],
      { notice: "Speed: 540 words a minute." },
    ],
    [
      "slower from 180 gives 160",
      {},
      ["slower"],
      { rate: 160, notice: "Speed: 160 words a minute." },
    ],
    ["slower at 60 stays at 60", { rate: 60 }, ["slower"], { notice: "Speed: 60 words a minute." }],
    ["pause pauses", {}, ["pause"], { paused: true }],
    ["pause twice goes on", {}, ["pause", "pause"], {}],
    ["ahead while paused stays paused (D7)", { paused: true }, ["ahead"], { index: 1 }],
    ["next-flag while paused stays paused (D7)", { paused: true }, ["next-flag"], { index: 2 }],
    [
      "headings while paused stays paused (D7)",
      { paused: true, index: 2 },
      ["headings"],
      { pass: "headings", index: 0 },
    ],
    ["decide asks", { index: 1 }, ["decide"], { outcome: "decide" }],
    ["quit ends", { index: 1 }, ["quit"], { outcome: "quit" }],
    [
      "a key clears the last notice",
      { index: 1, notice: "Speed: 200 words a minute." },
      ["back"],
      { index: 0, notice: null },
    ],
    ["a line spoken goes on to the next", {}, ["spoken"], { index: 1 }],
    ["a line spoken at the last line asks", { index: 2 }, ["spoken"], { outcome: "decide" }],
  ];

  it.each(moves)("moves as each key says: %s", (_what, from, steps, changes) => {
    const start = at(from);
    const end = steps.reduce(
      (state, step) => (step === "spoken" ? onLineSpoken(state) : onKey(state, step)),
      start,
    );
    expect(end).toEqual({ ...start, ...changes });
  });
});

describe("playerKeyOf", () => {
  const keys: [string, Key, PlayerKey | null][] = [
    ["Space", SPACE, "pause"],
    ["Left Arrow", { name: "left" }, "back"],
    ["Right Arrow", RIGHT, "ahead"],
    ["Enter", ENTER, "decide"],
    ["Ctrl+C", CTRL_C, "quit"],
    ["n", char("n"), "next-flag"],
    ["N", char("N"), "next-flag"],
    ["h", char("h"), "headings"],
    ["H", char("H"), "headings"],
    ["t", char("t"), "tab"],
    ["T", char("T"), "tab"],
    ["r", char("r"), "read"],
    ["R", char("R"), "read"],
    ["+", char("+"), "faster"],
    ["=, the + key without Shift", char("="), "faster"],
    ["-", char("-"), "slower"],
    ["_, the - key with Shift", char("_"), "slower"],
    ["a letter it has no use for", char("x"), null],
    ["a digit, which answers the question after the page", char("1"), null],
    ["Escape", { name: "escape" }, null],
    ["Backspace", { name: "backspace" }, null],
  ];

  it.each(keys)("names each key the player acts on: %s", (_what, key, expected) => {
    expect(playerKeyOf(key)).toBe(expected);
  });
});

describe("playPage", () => {
  it("speaks each line in turn, and asks once the transcript ends", async () => {
    const voice = fakeVoice({ auto: true });
    const { playing, shown } = play(voice);
    await expect(playing).resolves.toEqual({ outcome: "decide", rate: 180 });
    expect(shown()).toBe(
      screenOf(
        "Read transcript, 3 lines:",
        "   2  [to top] Skip to main content, link",
        "   3  banner landmark, About i2i, link",
        "   4  link, Unlabeled graphic, i 2i Logo  ⚑ unlabeled graphic",
      ),
    );
    // The transcript's name too, as it starts (R10).
    expect(voice.said).toEqual([
      { text: "Read transcript, 3 lines:", wpm: 180 },
      { text: "Skip to main content, link", wpm: 180 },
      { text: "banner landmark, About i2i, link", wpm: 180 },
      { text: "link, Unlabeled graphic, i 2i Logo", wpm: 180 },
    ]);
  });

  // With NVDA muted, a person who follows by ear alone hears only the voice (R10).
  it("says the page's line and the transcript's name before its lines, as it shows them", async () => {
    const voice = fakeVoice({ auto: true });
    const { out, shown } = screen();
    const playing = playPage({
      transcripts: TRANSCRIPTS,
      rate: 180,
      voice,
      keys: keyQueue(),
      out,
      title: "Page 1 of 2: / (1 flag)",
    });
    await expect(playing).resolves.toEqual({ outcome: "decide", rate: 180 });
    expect(voice.said.map(({ text }) => text)).toEqual([
      "Page 1 of 2: / (1 flag)",
      "Read transcript, 3 lines:",
      SKIP.spoken,
      ABOUT.spoken,
      LOGO.spoken,
    ]);
    expect(shown()).toBe(
      screenOf(
        "Page 1 of 2: / (1 flag)",
        "Read transcript, 3 lines:",
        "   2  [to top] Skip to main content, link",
        "   3  banner landmark, About i2i, link",
        "   4  link, Unlabeled graphic, i 2i Logo  ⚑ unlabeled graphic",
      ),
    );
  });

  it("stops one of the page's own lines for a key, which acts as it would on the line playing", async () => {
    const voice = fakeVoice();
    const keys = keyQueue();
    const { out, shown } = screen();
    const playing = playPage({
      transcripts: TRANSCRIPTS,
      rate: 180,
      voice,
      keys,
      out,
      title: "Page 1 of 2: / (1 flag)",
    });
    // N, during the page's line: the next flagged line after line 2, the one playing, is said
    // next, and the transcript's name isn't.
    await untilSaying(voice, "Page 1 of 2: / (1 flag)");
    keys.push("n");
    await nextTurn();
    expect(voice.said.at(-1)?.text).toBe(LOGO.spoken);
    // + during that line: the new speed is said, at that speed.
    keys.push("+");
    await nextTurn();
    expect(voice.said.at(-1)?.text).toBe("Speed: 200 words a minute.");
    // Enter, during the notice, stops it, and decides.
    keys.push(ENTER);
    await expect(playing).resolves.toEqual({ outcome: "decide", rate: 200 });
    expect(voice.said).toEqual([
      { text: "Page 1 of 2: / (1 flag)", wpm: 180 },
      { text: LOGO.spoken, wpm: 180 },
      { text: "Speed: 200 words a minute.", wpm: 200 },
    ]);
    expect(voice.stops).toBe(3);
    expect(shown()).toBe(
      screenOf(
        "Page 1 of 2: / (1 flag)",
        "Read transcript, 3 lines:",
        "   2  [to top] Skip to main content, link",
        "   4  link, Unlabeled graphic, i 2i Logo  ⚑ unlabeled graphic",
        "Speed: 200 words a minute.",
      ),
    );
  });

  it("stops the voice for a key, then acts", async () => {
    const voice = fakeVoice();
    const { playing, keys, shown } = play(voice);
    await untilSaying(voice, SKIP.spoken);
    keys.push(RIGHT, RIGHT, RIGHT);
    // So a key lost on the way ends the page with quit, rather than leaving it waiting.
    keys.end();
    await expect(playing).resolves.toEqual({ outcome: "decide", rate: 180 });
    expect(voice.said.map(({ text }) => text)).toEqual([
      "Read transcript, 3 lines:",
      SKIP.spoken,
      ABOUT.spoken,
      LOGO.spoken,
    ]);
    expect(voice.stops).toBe(3);
    expect(voice.speaking).toBe(false);
    // Each line is shown once, as it becomes the one playing.
    expect(shown()).toBe(
      screenOf(
        "Read transcript, 3 lines:",
        "   2  [to top] Skip to main content, link",
        "   3  banner landmark, About i2i, link",
        "   4  link, Unlabeled graphic, i 2i Logo  ⚑ unlabeled graphic",
      ),
    );
  });

  it("waits for a stopped line to end before it acts", async () => {
    // As the Windows voice's stop() does, this one only asks: the line ends when the voice says so.
    const voice = fakeVoice();
    const asking: Voice = {
      say: (text, wpm) => voice.say(text, wpm),
      stop: () => {},
      close: () => voice.close(),
    };
    const { playing, keys, shown } = play(asking);
    await untilSaying(voice, SKIP.spoken);
    keys.push(RIGHT);
    await nextTurn();
    expect(voice.said.at(-1)?.text).toBe(SKIP.spoken);
    expect(shown()).not.toContain("About i2i");
    voice.finish();
    await voice.starting;
    expect(voice.said.map(({ text }) => text)).toEqual([
      "Read transcript, 3 lines:",
      SKIP.spoken,
      ABOUT.spoken,
    ]);
    expect(shown()).toContain("   3  banner landmark, About i2i, link\n");
    keys.push(ENTER);
    await nextTurn();
    voice.finish();
    await expect(playing).resolves.toEqual({ outcome: "decide", rate: 180 });
  });

  it("pauses, and says the line again on Space", async () => {
    const voice = fakeVoice();
    const { playing, keys, shown } = play(voice);
    await untilSaying(voice, SKIP.spoken);
    keys.push(SPACE);
    await nextTurn();
    expect(voice.stops).toBe(1);
    expect(shown()).toContain("Paused. Press Space to go on.\n");
    // It says so too (R10), and then nothing, until Space.
    expect(voice.said.at(-1)?.text).toBe("Paused. Press Space to go on.");
    voice.finish();
    await nextTurn();
    expect(voice.speaking).toBe(false);
    keys.push(SPACE);
    await voice.starting;
    expect(voice.said.map(({ text }) => text)).toEqual([
      "Read transcript, 3 lines:",
      SKIP.spoken,
      "Paused. Press Space to go on.",
      SKIP.spoken,
    ]);
    keys.push(ENTER);
    await expect(playing).resolves.toEqual({ outcome: "decide", rate: 180 });
    // The line is shown once, when it became the one playing, and not when it was said again.
    expect(shown()).toBe(
      screenOf(
        "Read transcript, 3 lines:",
        "   2  [to top] Skip to main content, link",
        "Paused. Press Space to go on.",
      ),
    );
  });

  it("moves while paused without speaking", async () => {
    const voice = fakeVoice();
    const { playing, keys, shown } = play(voice);
    await untilSaying(voice, SKIP.spoken);
    keys.push(SPACE, RIGHT);
    await nextTurn();
    expect(shown()).toBe(
      screenOf(
        "Read transcript, 3 lines:",
        "   2  [to top] Skip to main content, link",
        "Paused. Press Space to go on.",
        "   3  banner landmark, About i2i, link",
      ),
    );
    // Right Arrow stopped "Paused." as it was said, and moved without speaking the line.
    expect(voice.said.map(({ text }) => text)).toEqual([
      "Read transcript, 3 lines:",
      SKIP.spoken,
      "Paused. Press Space to go on.",
    ]);
    expect(voice.speaking).toBe(false);
    // Space speaks from the line it moved to.
    keys.push(SPACE);
    await voice.starting;
    expect(voice.said.at(-1)?.text).toBe(ABOUT.spoken);
    keys.end();
    await expect(playing).resolves.toEqual({ outcome: "quit", rate: 180 });
  });

  it("passes a silent line without speaking it", async () => {
    const voice = fakeVoice({ auto: true });
    const { playing, shown } = play(voice, keyQueue(), WITH_SILENT);
    await expect(playing).resolves.toEqual({ outcome: "decide", rate: 180 });
    expect(shown()).toContain("   3  [no speech]\n");
    expect(voice.said.map(({ text }) => text)).toEqual([
      "Read transcript, 3 lines:",
      SKIP.spoken,
      LOGO.spoken,
    ]);
  });

  // A silent line is passed at once while the page plays, so ← must pass over it, or it could
  // never reach the lines before it, and → would move two lines.
  it("passes over a silent line as ← and → move while it plays", async () => {
    const voice = fakeVoice();
    const { playing, keys, shown } = play(voice, keyQueue(), WITH_SILENT);
    // Line 2 is said, and the silent line 3 passed: line 4 is being said.
    await untilSaying(voice, LOGO.spoken);
    // ← goes back to line 2, the line with words before the silent one.
    keys.push(LEFT);
    await nextTurn();
    // → goes ahead to line 4, past the silent line.
    keys.push(RIGHT);
    await nextTurn();
    keys.push(ENTER);
    await expect(playing).resolves.toEqual({ outcome: "decide", rate: 180 });
    expect(voice.said.map(({ text }) => text)).toEqual([
      "Read transcript, 3 lines:",
      SKIP.spoken,
      LOGO.spoken,
      SKIP.spoken,
      LOGO.spoken,
    ]);
    // The silent line is shown once, as the page passed it, and not as the keys passed over it.
    expect(shown()).toBe(
      screenOf(
        "Read transcript, 3 lines:",
        "   2  [to top] Skip to main content, link",
        "   3  [no speech]",
        "   4  link, Unlabeled graphic, i 2i Logo  ⚑ unlabeled graphic",
        "   2  [to top] Skip to main content, link",
        "   4  link, Unlabeled graphic, i 2i Logo  ⚑ unlabeled graphic",
      ),
    );
  });

  it("shows the transcript it switches to, each notice, and the line it moves to", async () => {
    const voice = fakeVoice();
    const { playing, keys, shown } = play(voice);
    await untilSaying(voice, SKIP.spoken);
    keys.push("n", "n", "r", "h", "t", "-");
    await nextTurn();
    expect(shown()).toBe(
      screenOf(
        "Read transcript, 3 lines:",
        "   2  [to top] Skip to main content, link",
        "   4  link, Unlabeled graphic, i 2i Logo  ⚑ unlabeled graphic",
        "No flagged line after this one.",
        "Read transcript, 3 lines:",
        "   2  [to top] Skip to main content, link",
        "Headings transcript, 2 lines:",
        "   1  heading level 1, Welcome",
        "No lines in the Tab transcript.",
        "Speed: 160 words a minute.",
      ),
    );
    // Each transcript's name and each notice is said too (R10), and each key, coming while one of
    // them is said, stops it, and acts.
    expect(voice.said).toEqual([
      { text: "Read transcript, 3 lines:", wpm: 180 },
      { text: SKIP.spoken, wpm: 180 },
      { text: LOGO.spoken, wpm: 180 },
      { text: "No flagged line after this one.", wpm: 180 },
      { text: "Read transcript, 3 lines:", wpm: 180 },
      { text: "Headings transcript, 2 lines:", wpm: 180 },
      { text: "No lines in the Tab transcript.", wpm: 180 },
      { text: "Speed: 160 words a minute.", wpm: 160 },
    ]);
    expect(voice.stops).toBe(6);
    keys.push(ENTER);
    await expect(playing).resolves.toEqual({ outcome: "decide", rate: 160 });
  });

  it("leaves out a key it has no use for, and the line goes on", async () => {
    const voice = fakeVoice();
    const { playing, keys } = play(voice);
    await untilSaying(voice, SKIP.spoken);
    keys.push("x", { name: "escape" });
    await nextTurn();
    expect(voice.stops).toBe(0);
    expect(voice.speaking).toBe(true);
    expect(voice.said.at(-1)?.text).toBe(SKIP.spoken);
    // Taken, so a stray key never waits to answer the question after the page.
    await expect(soon(keys.waiting())).resolves.toBe("still waiting");
    // The same while "Paused." is said: it goes on.
    keys.push(SPACE);
    await nextTurn();
    keys.push("x");
    await nextTurn();
    expect(voice.stops).toBe(1);
    expect(voice.speaking).toBe(true);
    expect(voice.said.at(-1)?.text).toBe("Paused. Press Space to go on.");
    // And while paused, with nothing said: it neither goes on nor ends the page.
    voice.finish();
    keys.push("x");
    await nextTurn();
    expect(voice.said).toHaveLength(3);
    await expect(soon(playing)).resolves.toBe("still waiting");
    keys.push(ENTER);
    await expect(playing).resolves.toEqual({ outcome: "decide", rate: 180 });
  });

  it("loses no key between lines", async () => {
    const voice = fakeVoice();
    const { playing, keys, shown } = play(voice);
    await untilSaying(voice, SKIP.spoken);
    // The first line is said to the end, so the voice won, and the key comes during the second.
    voice.finish();
    await voice.starting;
    keys.push(RIGHT);
    await nextTurn();
    expect(voice.stops).toBe(1);
    expect(voice.said.map(({ text }) => text)).toEqual([
      "Read transcript, 3 lines:",
      SKIP.spoken,
      ABOUT.spoken,
      LOGO.spoken,
    ]);
    expect(shown()).toContain("   4  link, Unlabeled graphic, i 2i Logo  ⚑ unlabeled graphic\n");
    keys.push(ENTER);
    await expect(playing).resolves.toEqual({ outcome: "decide", rate: 180 });
  });

  it("leaves a key pressed after the page for the question", async () => {
    const { playing, keys } = play(fakeVoice({ auto: true }));
    await expect(playing).resolves.toEqual({ outcome: "decide", rate: 180 });
    // As the session does: the question waits for its answer, and then the key comes.
    const answer = keys.next();
    keys.push("1");
    await expect(soon(answer)).resolves.toEqual(char("1"));
  });

  it("asks at once, and says why, when the read transcript has no lines", async () => {
    const voice = fakeVoice({ auto: true });
    const { playing, shown } = play(voice, keyQueue(), { read: [], headings: [WELCOME] });
    await expect(playing).resolves.toEqual({ outcome: "decide", rate: 180 });
    expect(shown()).toBe(screenOf("No lines in the read transcript."));
    // Said too (R10).
    expect(voice.said).toEqual([{ text: "No lines in the read transcript.", wpm: 180 }]);

    // A key the page acts on stops it, and the page is over all the same; Ctrl+C ends the session.
    const endings: [Key, "decide" | "quit"][] = [
      [RIGHT, "decide"],
      [ENTER, "decide"],
      [CTRL_C, "quit"],
    ];
    for (const [key, outcome] of endings) {
      const stopped = fakeVoice();
      const page = play(stopped, keyQueue(), { read: [], headings: [WELCOME] });
      await untilSaying(stopped, "No lines in the read transcript.");
      page.keys.push(key);
      await expect(page.playing, key.name).resolves.toEqual({ outcome, rate: 180 });
      expect(stopped.stops, key.name).toBe(1);
      expect(stopped.said, key.name).toHaveLength(1);
    }
  });

  it("ends with quit when the keys end, and rejects when the voice fails", async () => {
    const voice = fakeVoice();
    const { playing, keys } = play(voice);
    await untilSaying(voice, SKIP.spoken);
    keys.end();
    await expect(playing).resolves.toEqual({ outcome: "quit", rate: 180 });

    // The keys end while it's paused, too, and while it says one of the page's own lines.
    const pausing = fakeVoice();
    const paused = play(pausing);
    await untilSaying(pausing, SKIP.spoken);
    paused.keys.push(SPACE);
    await nextTurn();
    pausing.finish();
    paused.keys.end();
    await expect(paused.playing).resolves.toEqual({ outcome: "quit", rate: 180 });
    const telling = fakeVoice();
    const told = play(telling);
    await untilSaying(telling, "Read transcript, 3 lines:");
    told.keys.end();
    await expect(told.playing).resolves.toEqual({ outcome: "quit", rate: 180 });

    const failing = fakeVoice();
    const failed = play(failing);
    await failing.starting;
    const gone = new Error("gone");
    failing.fail(gone);
    await expect(failed.playing).rejects.toBe(gone);
  });

  // A Windows speech line has no time limit, so the player doesn't wait for one to end before it
  // quits. The session closes the voice after, which ends a line still waiting (R6).
  it("ends at once on Ctrl+C, or the keys' end, even when the line never ends", async () => {
    const endings: [string, (keys: KeyQueue) => void][] = [
      ["Ctrl+C", (keys) => keys.push(CTRL_C)],
      ["the keys' end", (keys) => keys.end()],
    ];
    for (const [what, end] of endings) {
      const voice = wedgedVoice();
      const { playing, keys } = play(voice);
      end(keys);
      await expect(soon(playing), what).resolves.toEqual({ outcome: "quit", rate: 180 });
      expect(voice.stops, what).toBe(1);
    }
  });

  it("leaves nothing unhandled when the line it ended on fails after", async () => {
    const voice = wedgedVoice();
    const { playing, keys } = play(voice);
    keys.push(CTRL_C);
    await expect(playing).resolves.toEqual({ outcome: "quit", rate: 180 });
    // An unhandled rejection would end voicecap, and Vitest fails the run on one.
    voice.fail(new Error("The computer's voice stopped."));
    await nextTurn();
  });

  // While the player waits for a stopped line, it reads no key: not even Ctrl+C, which raw mode
  // makes a key. So a line that never ends must not hold the page, and the session, for good.
  it("ends, and says why, when the voice doesn't end a stopped line in time", async () => {
    const voice = wedgedVoice();
    const keys = keyQueue();
    const { out, shown } = screen();
    const playing = playPage({
      transcripts: TRANSCRIPTS,
      rate: 180,
      voice,
      keys,
      out,
      stopLimitMs: 1,
    });
    keys.push(RIGHT);
    const error = await playing.then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(EnvironmentError);
    expect(errorMessage(error)).toBe("The computer's voice stopped answering.");
    expect(voice.stops).toBe(1);
    // The key didn't act: the next line was neither shown nor said.
    expect(shown()).not.toContain("About i2i");
    // The line it gave up on, failing after, is handled.
    voice.fail(new Error("The computer's voice stopped."));
    await nextTurn();
  });

  // A line that fails as it's stopped, as when the voice's program ends then: why it failed is what
  // the person needs, not that the voice stopped answering.
  it("gives the voice's own error when a stopped line fails in time", async () => {
    const gone = new EnvironmentError("The computer's voice stopped (The pipe is being closed).");
    let failLine = (_error: Error): void => {};
    const voice: Voice = {
      say: () =>
        new Promise<void>((_resolve, reject) => {
          failLine = reject;
        }),
      stop: () => failLine(gone),
      close: () => Promise.resolve(),
    };
    const { playing, keys } = play(voice);
    keys.push(RIGHT);
    await expect(playing).rejects.toBe(gone);
  });

  it("gives a stopped line five seconds to end, and leaves no timer behind", async () => {
    vi.useFakeTimers();
    try {
      // A line that ends once it's stopped: the wait's timer goes with it.
      const voice = fakeVoice();
      const ended = play(voice);
      await untilSaying(voice, SKIP.spoken);
      ended.keys.push(RIGHT);
      await vi.advanceTimersByTimeAsync(0);
      expect(voice.said.map(({ text }) => text)).toEqual([
        "Read transcript, 3 lines:",
        SKIP.spoken,
        ABOUT.spoken,
      ]);
      expect(vi.getTimerCount()).toBe(0);
      ended.keys.push(ENTER);
      await expect(ended.playing).resolves.toEqual({ outcome: "decide", rate: 180 });
      expect(vi.getTimerCount()).toBe(0);

      // A line that doesn't end: the page waits five seconds for it, and no longer.
      const stuck = play(wedgedVoice());
      stuck.keys.push(RIGHT);
      let outcome: unknown = "still waiting";
      stuck.playing.then(
        () => (outcome = "resolved"),
        (reason: unknown) => (outcome = reason),
      );
      await vi.advanceTimersByTimeAsync(4_999);
      expect(outcome).toBe("still waiting");
      await vi.advanceTimersByTimeAsync(1);
      expect(outcome).toBeInstanceOf(EnvironmentError);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the speed for the next page", async () => {
    const voice = fakeVoice();
    const { playing, keys, shown } = play(voice);
    await untilSaying(voice, SKIP.spoken);
    keys.push("+");
    await nextTurn();
    await sayingEach(voice, playing);
    await expect(playing).resolves.toEqual({ outcome: "decide", rate: 200 });
    expect(shown()).toContain("Speed: 200 words a minute.\n");
    // The new speed is said at that speed, then the line playing as the key came again, from its
    // start, and the rest at it too.
    expect(voice.said).toEqual([
      { text: "Read transcript, 3 lines:", wpm: 180 },
      { text: SKIP.spoken, wpm: 180 },
      { text: "Speed: 200 words a minute.", wpm: 200 },
      { text: SKIP.spoken, wpm: 200 },
      { text: ABOUT.spoken, wpm: 200 },
      { text: LOGO.spoken, wpm: 200 },
    ]);
  });
});

describe("fakeVoice, the voice the replay's tests use", () => {
  it("says one line at a time, until it's finished or stopped", async () => {
    const voice = fakeVoice();
    const first = voice.say("Home", 180);
    expect(voice.speaking).toBe(true);
    expect(() => voice.say("About", 180)).toThrow(Error);
    voice.finish();
    await expect(first).resolves.toBeUndefined();
    const second = voice.say("About", 200);
    voice.stop();
    await expect(second).resolves.toBeUndefined();
    expect(voice.said).toEqual([
      { text: "Home", wpm: 180 },
      { text: "About", wpm: 200 },
    ]);
    expect(voice.stops).toBe(1);
    expect(voice.speaking).toBe(false);
  });

  it("says when a line has started", async () => {
    const voice = fakeVoice();
    const starting = voice.starting;
    await expect(soon(starting)).resolves.toBe("still waiting");
    void voice.say("Home", 180);
    await starting;
    // While a line is being said, it has started already.
    await expect(soon(voice.starting)).resolves.toBeUndefined();
    voice.finish();
    await expect(soon(voice.starting)).resolves.toBe("still waiting");
  });

  it("fails the line being said, and every one after, as a voice that stopped does", async () => {
    const voice = fakeVoice();
    const saying = voice.say("Home", 180);
    const gone = new Error("gone");
    voice.fail(gone);
    await expect(saying).rejects.toBe(gone);
    await expect(voice.say("About", 180)).rejects.toBe(gone);
  });

  it("ends the line being said when it's closed, and says no more", async () => {
    const voice = fakeVoice();
    const saying = voice.say("Home", 180);
    await voice.close();
    expect(voice.closed).toBe(true);
    await expect(saying).resolves.toBeUndefined();
    await expect(voice.say("About", 180)).rejects.toThrow(Error);
    expect(voice.said).toEqual([{ text: "Home", wpm: 180 }]);
  });

  it("says each line at once with auto", async () => {
    const voice = fakeVoice({ auto: true });
    await voice.say("Home", 180);
    await voice.say("About", 180);
    expect(voice.speaking).toBe(false);
    expect(voice.said).toHaveLength(2);
  });
});
