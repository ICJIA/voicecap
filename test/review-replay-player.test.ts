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
import { fakeVoice, keyQueue } from "./helpers/replay.js";

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

/** What most tests play: three read lines (the third raised a flag), two headings, no Tab lines. */
const TRANSCRIPTS: Transcripts = { read: [SKIP, ABOUT, LOGO], headings: [WELCOME, NEWS], tab: [] };

const char = (typed: string): Key => ({ name: "char", char: typed });
const SPACE: Key = { name: "space" };
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
    expect(voice.said).toEqual([
      { text: "Skip to main content, link", wpm: 180 },
      { text: "banner landmark, About i2i, link", wpm: 180 },
      { text: "link, Unlabeled graphic, i 2i Logo", wpm: 180 },
    ]);
  });

  it("stops the voice for a key, then acts", async () => {
    const voice = fakeVoice();
    const { playing, keys, shown } = play(voice);
    await voice.starting;
    keys.push(RIGHT, RIGHT, RIGHT);
    // So a key lost on the way ends the page with quit, rather than leaving it waiting.
    keys.end();
    await expect(playing).resolves.toEqual({ outcome: "decide", rate: 180 });
    expect(voice.said.map(({ text }) => text)).toEqual([SKIP.spoken, ABOUT.spoken, LOGO.spoken]);
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
    await voice.starting;
    keys.push(RIGHT);
    await nextTurn();
    expect(voice.said).toHaveLength(1);
    expect(shown()).not.toContain("About i2i");
    voice.finish();
    await voice.starting;
    expect(voice.said.map(({ text }) => text)).toEqual([SKIP.spoken, ABOUT.spoken]);
    expect(shown()).toContain("   3  banner landmark, About i2i, link\n");
    keys.push(ENTER);
    await nextTurn();
    voice.finish();
    await expect(playing).resolves.toEqual({ outcome: "decide", rate: 180 });
  });

  it("pauses, and says the line again on Space", async () => {
    const voice = fakeVoice();
    const { playing, keys, shown } = play(voice);
    await voice.starting;
    keys.push(SPACE);
    await nextTurn();
    expect(voice.stops).toBe(1);
    expect(voice.speaking).toBe(false);
    expect(shown()).toContain("Paused. Press Space to go on.\n");
    keys.push(SPACE);
    await voice.starting;
    expect(voice.said.map(({ text }) => text)).toEqual([SKIP.spoken, SKIP.spoken]);
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
    await voice.starting;
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
    expect(voice.said.map(({ text }) => text)).toEqual([SKIP.spoken]);
    // Space speaks from the line it moved to.
    keys.push(SPACE);
    await voice.starting;
    expect(voice.said.map(({ text }) => text)).toEqual([SKIP.spoken, ABOUT.spoken]);
    keys.end();
    await expect(playing).resolves.toEqual({ outcome: "quit", rate: 180 });
  });

  it("passes a silent line without speaking it", async () => {
    const voice = fakeVoice({ auto: true });
    const silent: PlayLine = { n: 3, text: "[no speech]", spoken: "", marks: [] };
    const { playing, shown } = play(voice, keyQueue(), { read: [SKIP, silent, LOGO] });
    await expect(playing).resolves.toEqual({ outcome: "decide", rate: 180 });
    expect(shown()).toContain("   3  [no speech]\n");
    expect(voice.said.map(({ text }) => text)).toEqual([SKIP.spoken, LOGO.spoken]);
  });

  it("shows the transcript it switches to, each notice, and the line it moves to", async () => {
    const voice = fakeVoice();
    const { playing, keys, shown } = play(voice);
    await voice.starting;
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
    // A key that leaves the line where it was says that line again, from its start.
    expect(voice.said).toEqual([
      { text: SKIP.spoken, wpm: 180 },
      { text: LOGO.spoken, wpm: 180 },
      { text: LOGO.spoken, wpm: 180 },
      { text: SKIP.spoken, wpm: 180 },
      { text: WELCOME.spoken, wpm: 180 },
      { text: WELCOME.spoken, wpm: 180 },
      { text: WELCOME.spoken, wpm: 160 },
    ]);
    keys.push(ENTER);
    await expect(playing).resolves.toEqual({ outcome: "decide", rate: 160 });
  });

  it("leaves out a key it has no use for, and the line goes on", async () => {
    const voice = fakeVoice();
    const { playing, keys } = play(voice);
    await voice.starting;
    keys.push("x", { name: "escape" });
    await nextTurn();
    expect(voice.stops).toBe(0);
    expect(voice.speaking).toBe(true);
    expect(voice.said).toHaveLength(1);
    // Taken, so a stray key never waits to answer the question after the page.
    await expect(soon(keys.waiting())).resolves.toBe("still waiting");
    // While paused, too: it neither goes on nor ends the page.
    keys.push(SPACE, "x");
    await nextTurn();
    expect(voice.said).toHaveLength(1);
    await expect(soon(playing)).resolves.toBe("still waiting");
    keys.push(ENTER);
    await expect(playing).resolves.toEqual({ outcome: "decide", rate: 180 });
  });

  it("loses no key between lines", async () => {
    const voice = fakeVoice();
    const { playing, keys, shown } = play(voice);
    await voice.starting;
    // The first line is said to the end, so the voice won, and the key comes during the second.
    voice.finish();
    await voice.starting;
    keys.push(RIGHT);
    await nextTurn();
    expect(voice.stops).toBe(1);
    expect(voice.said.map(({ text }) => text)).toEqual([SKIP.spoken, ABOUT.spoken, LOGO.spoken]);
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
    const keys = keyQueue();
    keys.push(RIGHT);
    const { playing, shown } = play(voice, keys, { read: [], headings: [WELCOME] });
    await expect(playing).resolves.toEqual({ outcome: "decide", rate: 180 });
    expect(shown()).toBe(screenOf("No lines in the read transcript."));
    expect(voice.said).toEqual([]);
    // It took no key.
    await expect(soon(keys.next())).resolves.toEqual(RIGHT);
  });

  it("ends with quit when the keys end, and rejects when the voice fails", async () => {
    const voice = fakeVoice();
    const { playing, keys } = play(voice);
    await voice.starting;
    keys.end();
    await expect(playing).resolves.toEqual({ outcome: "quit", rate: 180 });

    // The keys end while it's paused, too.
    const pausing = fakeVoice();
    const paused = play(pausing);
    await pausing.starting;
    paused.keys.push(SPACE);
    await nextTurn();
    paused.keys.end();
    await expect(paused.playing).resolves.toEqual({ outcome: "quit", rate: 180 });

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

  it("gives a stopped line five seconds to end, and leaves no timer behind", async () => {
    vi.useFakeTimers();
    try {
      // A line that ends once it's stopped: the wait's timer goes with it.
      const voice = fakeVoice();
      const ended = play(voice);
      await voice.starting;
      ended.keys.push(RIGHT);
      await vi.advanceTimersByTimeAsync(0);
      expect(voice.said.map(({ text }) => text)).toEqual([SKIP.spoken, ABOUT.spoken]);
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
    const voice = fakeVoice({ auto: true });
    const keys = keyQueue();
    keys.push("+");
    const { playing, shown } = play(voice, keys);
    await expect(playing).resolves.toEqual({ outcome: "decide", rate: 200 });
    expect(shown()).toContain("Speed: 200 words a minute.\n");
    // The line playing as the key came is said again at the new speed, and the rest at it too.
    expect(voice.said).toEqual([
      { text: SKIP.spoken, wpm: 180 },
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
