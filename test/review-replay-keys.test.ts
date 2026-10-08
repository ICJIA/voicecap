import { once } from "node:events";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { setImmediate as nextTurn, setTimeout as delay } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import { keyOf, readNote, terminalKeys, type Key } from "../src/review-replay/keys.js";
import { REPLAY_TEXT } from "../src/review-replay/text.js";
import { keyQueue, ttyInput } from "./helpers/replay.js";

/** Whether `promise` has settled after a few turns of the event loop: for one that must wait. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  void promise.then(
    () => (done = true),
    () => (done = true),
  );
  await delay(30);
  return done;
}

type KeypressArgs = Parameters<typeof keyOf>;

describe("keyOf", () => {
  const cases: [string, KeypressArgs[0], KeypressArgs[1], Key | null][] = [
    ["Space", " ", { name: "space" }, { name: "space" }],
    ["Left Arrow", undefined, { name: "left" }, { name: "left" }],
    ["Right Arrow", undefined, { name: "right" }, { name: "right" }],
    ["Enter, as a terminal sends it", "\r", { name: "return" }, { name: "enter" }],
    ["Enter, as a line feed", "\n", { name: "enter" }, { name: "enter" }],
    ["Ctrl+C", "\u0003", { name: "c", ctrl: true }, { name: "ctrl-c" }],
    ["Backspace", "\x7f", { name: "backspace" }, { name: "backspace" }],
    ["Escape", undefined, { name: "escape" }, { name: "escape" }],
    ["a letter", "n", { name: "n" }, { name: "char", char: "n" }],
    ["a capital letter, as typed", "B", { name: "b" }, { name: "char", char: "B" }],
    ["the letter c without Ctrl", "c", { name: "c" }, { name: "char", char: "c" }],
    ["a sign that has no name", "+", {}, { name: "char", char: "+" }],
    ["a letter outside ASCII", "é", {}, { name: "char", char: "é" }],
    ["an emoji", "👋", {}, { name: "char", char: "👋" }],
    ["a key the replay has no use for", undefined, { name: "f5" }, null],
    ["Tab", "\t", { name: "tab" }, null],
    ["another Ctrl key", "\u0001", { name: "a", ctrl: true }, null],
    ["a letter with Alt, which has no text", undefined, { name: "n" }, null],
    ["no key at all", undefined, undefined, null],
  ];

  it.each(cases)("names each key the replay uses: %s", (_what, str, key, expected) => {
    expect(keyOf(str, key)).toEqual(expected);
  });
});

describe("terminalKeys", () => {
  it("reads keys from a terminal in raw mode, and leaves it after", async () => {
    const input = ttyInput();
    const keys = terminalKeys(input);
    expect(input.rawModes).toEqual([true]);
    input.write("n");
    input.write("\x1b[C");
    await expect(keys.next()).resolves.toEqual({ name: "char", char: "n" });
    await expect(keys.next()).resolves.toEqual({ name: "right" });
    // Raw mode lasts the whole session, so Ctrl+C is a key and not a signal for the whole console.
    expect(input.rawModes).toEqual([true]);
    await keys.close();
    expect(input.rawModes).toEqual([true, false]);
  });

  // Leaving raw mode while a Windows console still reads starts a line-at-a-time read there
  // (src/cli/listener.ts, measured 2026-10-02). Node stops reading process.stdin on the tick after
  // pause(), so raw mode is left on the turn after that.
  it("leaves raw mode only once the input has stopped reading", async () => {
    const input = ttyInput();
    // The input reads from resume(), and stops on the tick after pause(), as process.stdin does.
    let reading = false;
    input.on("resume", () => {
      reading = true;
    });
    input.on("pause", () => {
      process.nextTick(() => {
        if (!input.readableFlowing) reading = false;
      });
    });
    const leftRawWhile: ("reading" | "stopped")[] = [];
    input.setRawMode = (mode) => {
      input.rawModes.push(mode);
      if (!mode) leftRawWhile.push(reading ? "reading" : "stopped");
    };
    const keys = terminalKeys(input);
    // The stream says it is reading a tick after it's resumed, so give it a turn.
    await nextTurn();
    expect(reading).toBe(true);
    await keys.close();
    expect(leftRawWhile).toEqual(["stopped"]);
    expect(input.rawModes).toEqual([true, false]);
  });

  it("stops listening and pauses the input when closed", async () => {
    const input = ttyInput();
    const keys = terminalKeys(input);
    expect(input.listenerCount("keypress")).toBe(1);
    expect(input.isPaused()).toBe(false);
    await keys.close();
    expect(input.listenerCount("keypress")).toBe(0);
    expect(input.isPaused()).toBe(true);
    // A key pressed after that is not given.
    input.write("n");
    await expect(keys.next()).resolves.toBeNull();
  });

  it("can be closed twice, and leaves raw mode once", async () => {
    const input = ttyInput();
    const keys = terminalKeys(input);
    await Promise.all([keys.close(), keys.close()]);
    await keys.close();
    expect(input.rawModes).toEqual([true, false]);
  });

  it("works on an input that has no raw mode", async () => {
    // A pipe has no setRawMode.
    const input = new PassThrough();
    const keys = terminalKeys(input);
    input.write("n");
    await expect(keys.next()).resolves.toEqual({ name: "char", char: "n" });
    await keys.close();
  });

  it("ends the pending next() and waiting() when closed", async () => {
    const keys = terminalKeys(ttyInput());
    const next = keys.next();
    const waiting = keys.waiting();
    await keys.close();
    await expect(next).resolves.toBeNull();
    await expect(waiting).resolves.toBeUndefined();
  });

  it("keeps keys pressed before they're asked for, in order", async () => {
    const input = ttyInput();
    const keys = terminalKeys(input);
    input.write("abc");
    await expect(keys.next()).resolves.toEqual({ name: "char", char: "a" });
    await expect(keys.next()).resolves.toEqual({ name: "char", char: "b" });
    await expect(keys.next()).resolves.toEqual({ name: "char", char: "c" });
    await keys.close();
  });

  it("keeps different kinds of key in the order they were pressed", async () => {
    const input = ttyInput();
    const keys = terminalKeys(input);
    input.write("1 \r\x1b[D+");
    const pressed: (Key | null)[] = [];
    for (let i = 0; i < 5; i++) pressed.push(await keys.next());
    expect(pressed).toEqual([
      { name: "char", char: "1" },
      { name: "space" },
      { name: "enter" },
      { name: "left" },
      { name: "char", char: "+" },
    ]);
    await keys.close();
  });

  it("says a key is waiting without taking it", async () => {
    const input = ttyInput();
    const keys = terminalKeys(input);
    input.write("n");
    await keys.waiting();
    await keys.waiting();
    await expect(keys.next()).resolves.toEqual({ name: "char", char: "n" });
    await keys.close();
  });

  it("keeps waiting() pending on an empty queue, until a key arrives", async () => {
    const input = ttyInput();
    const keys = terminalKeys(input);
    const waiting = keys.waiting();
    await expect(settled(waiting)).resolves.toBe(false);
    input.write("n");
    await waiting;
    await expect(keys.next()).resolves.toEqual({ name: "char", char: "n" });
    await keys.close();
  });

  it("keeps waiting() pending until the input ends, too", async () => {
    const input = ttyInput();
    const keys = terminalKeys(input);
    const waiting = keys.waiting();
    await expect(settled(waiting)).resolves.toBe(false);
    input.end();
    await waiting;
    await expect(keys.next()).resolves.toBeNull();
    await keys.close();
  });

  it("gives null when the input ends, or the session stops", async () => {
    // The input ends.
    const input = ttyInput();
    const ending = terminalKeys(input);
    input.end();
    await expect(ending.next()).resolves.toBeNull();
    await ending.close();

    // The session stops: a next() that is waiting for a key gives null once its signal aborts.
    const stop = new AbortController();
    const stopping = terminalKeys(ttyInput(), stop.signal);
    const pending = stopping.next();
    await expect(settled(pending)).resolves.toBe(false);
    stop.abort();
    await expect(pending).resolves.toBeNull();
    await stopping.close();
  });

  it("gives the keys pressed before the input ended, and then null", async () => {
    const input = ttyInput();
    const keys = terminalKeys(input);
    input.write("ab");
    input.end();
    await expect(keys.next()).resolves.toEqual({ name: "char", char: "a" });
    await expect(keys.next()).resolves.toEqual({ name: "char", char: "b" });
    await expect(keys.next()).resolves.toBeNull();
    await keys.close();
  });

  it("gives null when the input had ended before the keys were asked for", async () => {
    const input = ttyInput();
    // A stream says it has ended only once something reads it to the end.
    const over = once(input, "end");
    input.end();
    input.resume();
    await over;
    const keys = terminalKeys(input);
    await expect(keys.next()).resolves.toBeNull();
    await expect(keys.waiting()).resolves.toBeUndefined();
    await keys.close();
  });

  it("takes an error on the input as the keys ending", async () => {
    const input = ttyInput();
    const keys = terminalKeys(input);
    input.destroy(new Error("read EIO"));
    await expect(keys.next()).resolves.toBeNull();
    await keys.close();
  });

  it("resolves a pending waiting() once the session's signal aborts", async () => {
    const stop = new AbortController();
    const keys = terminalKeys(ttyInput(), stop.signal);
    const waiting = keys.waiting();
    stop.abort();
    await waiting;
    await keys.close();
  });

  it("gives null when the session's signal had aborted already", async () => {
    const stop = new AbortController();
    stop.abort();
    const keys = terminalKeys(ttyInput(), stop.signal);
    await expect(keys.next()).resolves.toBeNull();
    await keys.close();
  });

  it("gives no key once the session's signal aborts, even one that was waiting", async () => {
    const input = ttyInput();
    const stop = new AbortController();
    const keys = terminalKeys(input, stop.signal);
    input.write("n");
    await keys.waiting();
    stop.abort();
    await expect(keys.next()).resolves.toBeNull();
    await keys.close();
  });

  it("stops listening for the signal when closed", async () => {
    const stop = new AbortController();
    const keys = terminalKeys(ttyInput(), stop.signal);
    await keys.close();
    // Aborting afterward must not reach a source that is closed already.
    expect(() => stop.abort()).not.toThrow();
  });
});

describe("readNote", () => {
  /** Where a note is written, as a terminal would show what's written to it. */
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

  it("writes each character as it's typed, and takes one off for Backspace", async () => {
    const keys = keyQueue();
    const { out, shown } = screen();
    keys.push("B", "a", "d", { name: "backspace" }, "g", { name: "enter" });
    await expect(readNote(keys, out)).resolves.toBe("Bag");
    expect(shown()).toBe("Bad\b \bg\n");
  });

  it("gives an empty note for Enter alone", async () => {
    const keys = keyQueue();
    const { out, shown } = screen();
    keys.push({ name: "enter" });
    await expect(readNote(keys, out)).resolves.toBe("");
    expect(shown()).toBe("\n");
  });

  it("gives null on Ctrl+C", async () => {
    const keys = keyQueue();
    const { out } = screen();
    keys.push("x", { name: "ctrl-c" });
    await expect(readNote(keys, out)).resolves.toBeNull();
  });

  it("gives null when the keys end", async () => {
    const keys = keyQueue();
    const { out } = screen();
    keys.end();
    await expect(readNote(keys, out)).resolves.toBeNull();
  });

  it("gives null when the keys end partway through a note", async () => {
    const keys = keyQueue();
    const { out } = screen();
    keys.push("x");
    keys.end();
    await expect(readNote(keys, out)).resolves.toBeNull();
  });

  it("takes the Space key as a space, so a note can have more than one word", async () => {
    const keys = keyQueue();
    const { out, shown } = screen();
    keys.push("N", "o", { name: "space" }, "a", "l", "t", { name: "enter" });
    await expect(readNote(keys, out)).resolves.toBe("No alt");
    expect(shown()).toBe("No alt\n");
  });

  it("trims the note it gives", async () => {
    const keys = keyQueue();
    const { out } = screen();
    keys.push(
      { name: "space" },
      { name: "space" },
      "a",
      { name: "space" },
      "b",
      { name: "space" },
      { name: "enter" },
    );
    await expect(readNote(keys, out)).resolves.toBe("a b");
  });

  it("writes nothing for Backspace when there is nothing to take off", async () => {
    const keys = keyQueue();
    const { out, shown } = screen();
    keys.push({ name: "backspace" }, "x", { name: "backspace" }, { name: "backspace" }, "y");
    keys.push({ name: "enter" });
    await expect(readNote(keys, out)).resolves.toBe("y");
    // The prompt before the note is not erased by a Backspace at its start.
    expect(shown()).toBe("x\b \by\n");
  });

  it("takes one character off at a time, an emoji as one", async () => {
    const keys = keyQueue();
    const { out } = screen();
    keys.push("a", "👋", { name: "backspace" }, "b", { name: "enter" });
    await expect(readNote(keys, out)).resolves.toBe("ab");
  });

  it("leaves out the keys that aren't text", async () => {
    const keys = keyQueue();
    const { out, shown } = screen();
    keys.push({ name: "left" }, "a", { name: "right" }, { name: "escape" }, "b", { name: "enter" });
    await expect(readNote(keys, out)).resolves.toBe("ab");
    expect(shown()).toBe("ab\n");
  });

  // The key that stopped the voice saying the prompt is the note's first (R10).
  it("takes a key it's given as the first, before the keys that come", async () => {
    const keys = keyQueue();
    const { out, shown } = screen();
    keys.push("a", "d", { name: "enter" });
    await expect(readNote(keys, out, { name: "char", char: "B" })).resolves.toBe("Bad");
    expect(shown()).toBe("Bad\n");

    // Enter, or Ctrl+C, as that key, ends the note as either would after it.
    await expect(readNote(keyQueue(), out, { name: "enter" })).resolves.toBe("");
    await expect(readNote(keyQueue(), out, { name: "ctrl-c" })).resolves.toBeNull();
  });

  it("reads a note typed at a terminal", async () => {
    const input = ttyInput();
    const keys = terminalKeys(input);
    const { out, shown } = screen();
    const note = readNote(keys, out);
    input.write("Bad");
    input.write("\x7f");
    input.write("g ");
    input.write("\r");
    await expect(note).resolves.toBe("Bag");
    expect(shown()).toBe("Bad\b \bg \n");
    await keys.close();
  });
});

describe("keyQueue, the key source the replay's tests use", () => {
  it("gives keys in order, a string as a character, and null once it has ended", async () => {
    const keys = keyQueue();
    keys.push("a", { name: "space" });
    keys.push("b");
    keys.end();
    await expect(keys.next()).resolves.toEqual({ name: "char", char: "a" });
    await expect(keys.next()).resolves.toEqual({ name: "space" });
    await expect(keys.next()).resolves.toEqual({ name: "char", char: "b" });
    await expect(keys.next()).resolves.toBeNull();
  });

  it("says a key is waiting without taking it, and waits for one that hasn't come", async () => {
    const keys = keyQueue();
    const waiting = keys.waiting();
    await expect(settled(waiting)).resolves.toBe(false);
    keys.push("n");
    await waiting;
    await keys.waiting();
    await expect(keys.next()).resolves.toEqual({ name: "char", char: "n" });
  });

  it("gives a pending next() the key pushed for it", async () => {
    const keys = keyQueue();
    const next = keys.next();
    keys.push({ name: "enter" });
    await expect(next).resolves.toEqual({ name: "enter" });
  });

  it("ends the pending next() and waiting() when ended, and when closed", async () => {
    const ended = keyQueue();
    const next = ended.next();
    const waiting = ended.waiting();
    ended.end();
    await expect(next).resolves.toBeNull();
    await expect(waiting).resolves.toBeUndefined();

    const closed = keyQueue();
    expect(closed.closed).toBe(false);
    const pending = closed.next();
    await closed.close();
    expect(closed.closed).toBe(true);
    await expect(pending).resolves.toBeNull();
    await expect(closed.next()).resolves.toBeNull();
  });
});

describe("REPLAY_TEXT", () => {
  /** The spec's text, which pins the replay's first words. */
  const spec = () =>
    readFileSync(
      new URL("../docs/superpowers/specs/2026-10-06-review-replay-design.md", import.meta.url),
      "utf8",
    );

  it("names a page as the spec does", () => {
    expect(REPLAY_TEXT.page(3, 7, "/biographies/", 2)).toBe("Page 3 of 7: /biographies/ (2 flags)");
    expect(spec()).toContain("`Page 3 of 7: /biographies/ (2 flags)`");
  });

  it("says no flags, and one flag, in words", () => {
    expect(REPLAY_TEXT.page(1, 1, "/", 0)).toMatch(/\(no flags\)$/);
    expect(REPLAY_TEXT.page(1, 1, "/", 1)).toMatch(/\(1 flag\)$/);
  });

  it("numbers a line in four columns, and marks it after, in words", () => {
    expect(REPLAY_TEXT.line(12, "banner landmark, link", [])).toBe("  12  banner landmark, link");
    expect(REPLAY_TEXT.line(4, "x", ["unlabeled graphic"])).toBe("   4  x  ⚑ unlabeled graphic");
    expect(REPLAY_TEXT.line(123, "y", ["a", "b"])).toBe(" 123  y  ⚑ a  ⚑ b");
    expect(REPLAY_TEXT.line(12345, "z", [])).toBe("12345  z");
  });

  it("asks its question, and says the two lines about NVDA, word for word as the spec does", () => {
    expect(REPLAY_TEXT.question).toBe(
      "What did you decide?  1 Reviewed, no issues   2 Issue found   3 Fixed   4 Skip",
    );
    expect(REPLAY_TEXT.nvda).toEqual([
      "NVDA is running, and it will read these lines too, over the replay's voice.",
      "Mute it (NVDA+S changes its speech mode) or quit it, then press Enter.",
    ]);
    // In the spec, the question and the two lines about NVDA are each a line of a fenced block.
    const specLines = spec()
      .split("\n")
      .map((line) => line.trim());
    expect(specLines).toContain(REPLAY_TEXT.question);
    for (const line of REPLAY_TEXT.nvda) expect(specLines).toContain(line);
  });

  it("counts the decisions it recorded", () => {
    expect(REPLAY_TEXT.recorded(0)).toBe("Recorded no decisions.");
    expect(REPLAY_TEXT.recorded(1)).toBe("Recorded 1 decision.");
    expect(REPLAY_TEXT.recorded(2)).toBe("Recorded 2 decisions.");
  });

  it("names each transcript, and says when one has no lines", () => {
    expect(REPLAY_TEXT.pass("read", 33)).toBe("Read transcript, 33 lines:");
    expect(REPLAY_TEXT.pass("headings", 2)).toBe("Headings transcript, 2 lines:");
    expect(REPLAY_TEXT.pass("tab", 1)).toBe("Tab transcript, 1 line:");
    expect(REPLAY_TEXT.noLines("read")).toBe("No lines in the read transcript.");
    expect(REPLAY_TEXT.noLines("headings")).toBe("No lines in the headings transcript.");
    expect(REPLAY_TEXT.noLines("tab")).toBe("No lines in the Tab transcript.");
  });

  it("says the rest of what a person sees as the plan sets it out", () => {
    expect(REPLAY_TEXT.noFlagAfter).toBe("No flagged line after this one.");
    expect(REPLAY_TEXT.paused).toBe("Paused. Press Space to go on.");
    expect(REPLAY_TEXT.speed(200)).toBe("Speed: 200 words a minute.");
    expect(REPLAY_TEXT.keys).toBe(
      "Keys: Space pauses and goes on · ← → a line back or ahead · N the next flagged line · H T R the headings, Tab, and read transcripts · + − faster, slower · Enter decide · Ctrl+C end",
    );
    expect(REPLAY_TEXT.note).toBe("Note (Enter for none): ");
    expect(REPLAY_TEXT.leftOut(["/a", "/b/c"])).toBe(
      "Left out, with no transcripts to hear: /a, /b/c.",
    );
    expect(REPLAY_TEXT.nothingDefault).toBe(
      "Nothing to hear: no page that NVDA read needs attention. Add --all to hear every page, or --page <url> to hear one.",
    );
    expect(REPLAY_TEXT.nothingAll).toBe("Nothing to hear: no page has transcripts yet.");
    expect(REPLAY_TEXT.noTerminal).toBe(
      "--replay needs a terminal: it takes each key as you press it, and shows each line as it's read. Run it in a terminal window, with nothing redirected.",
    );
  });

  // Ruling R10: with NVDA muted, the voice says the session's own lines too.
  it("says the keys and the question in words a voice reads well", () => {
    expect(REPLAY_TEXT.keysSpoken).toBe(
      "Keys: Space pauses, and goes on. Left Arrow and Right Arrow, a line back or ahead. N, the next flagged line. H, T, and R, the headings, Tab, and read transcripts. Plus and minus, faster and slower. Enter, decide. Control C, end.",
    );
    expect(REPLAY_TEXT.questionSpoken).toBe(
      "What did you decide? 1, Reviewed, no issues. 2, Issue found. 3, Fixed. 4, Skip.",
    );
    // Neither has a sign a voice reads badly, or reads as something else: only words, and the
    // stops between them.
    for (const spoken of [REPLAY_TEXT.keysSpoken, REPLAY_TEXT.questionSpoken]) {
      expect(spoken).toMatch(/^[\w ,.:?]+$/);
    }
  });

  it("says each answer as it's taken, in its own words, and turns NVDA back over to the person", () => {
    expect(REPLAY_TEXT.answered).toEqual({
      reviewed: "Recorded: reviewed, no issues.",
      issue: "Recorded: issue found.",
      fixed: "Recorded: fixed.",
      skip: "Skipped.",
    });
    expect(REPLAY_TEXT.nvdaBack).toBe(
      "Turn NVDA's speech back on (NVDA+S changes its speech mode), or start it again if you quit it.",
    );
  });
});
