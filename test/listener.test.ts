import { PassThrough, Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { makeAskListener, type AskListenerOptions } from "../src/cli/listener.js";
import { fakeSignals } from "./helpers/fake-signals.js";

/** What the question's prompt says, each time it's shown. */
const PROMPT = "Choose [3]: ";

/**
 * A plain collecting writer (all a prompter needs to show its questions), and a way to wait until
 * the question's prompt has been shown `times` times.
 */
function capture() {
  let text = "";
  let waiting: { times: number; resolve: () => void }[] = [];
  const shown = () => text.split(PROMPT).length - 1;
  const settle = () => {
    for (const waiter of waiting) if (shown() >= waiter.times) waiter.resolve();
    waiting = waiting.filter(({ times }) => shown() < times);
  };
  return {
    stream: {
      write: (chunk: string) => {
        text += chunk;
        settle();
        return true;
      },
    },
    text: () => text,
    prompted: (times = 1) =>
      new Promise<void>((resolve) => {
        waiting.push({ times, resolve });
        settle();
      }),
  };
}

/** The input of a person at a terminal. */
function terminal() {
  return Object.assign(new PassThrough(), { isTTY: true });
}

/** The question over `input` and `output`, with no wait for keys typed ahead and no real signals. */
function listener(
  input: NodeJS.ReadableStream,
  output: { write(chunk: string): unknown; isTTY?: boolean },
  options: AskListenerOptions = {},
) {
  return makeAskListener(input, output, { drainMs: 0, signals: fakeSignals().source, ...options })!;
}

const question = { screenReader: "NVDA", pagesRead: 7 };

describe("the listener's question", () => {
  it("asks, and takes the answer typed once it appears", async () => {
    const input = terminal();
    const screen = capture();
    const answer = listener(input, screen.stream)(question);
    await screen.prompted();
    input.write("1\n");
    await expect(answer).resolves.toBe("all");
    expect(screen.text()).toContain("Did you listen as NVDA read these pages?");
    expect(screen.text()).toContain(
      "  1. Yes, all of them\n  2. Part of them\n  3. No\nChoose [3]: ",
    );
  });

  it("defaults to No on Enter, so it never claims listening by accident", async () => {
    const input = terminal();
    const screen = capture();
    const answer = listener(input, screen.stream)(question);
    await screen.prompted();
    input.write("\n");
    await expect(answer).resolves.toBe("no");
  });

  it("isn't offered when the input isn't a terminal", () => {
    expect(makeAskListener(new PassThrough(), capture().stream)).toBeUndefined();
  });

  it("gives up without an answer when the input ends", async () => {
    const input = terminal();
    const screen = capture();
    const answer = listener(input, screen.stream)(question);
    await screen.prompted();
    input.end();
    await expect(answer).resolves.toBeNull();
  });

  it("gives up without an answer when the input ended before it was asked", async () => {
    const input = terminal();
    input.end();
    await expect(listener(input, capture().stream)(question)).resolves.toBeNull();
  });

  it("takes each number for its own answer", async () => {
    for (const [typed, expected] of [
      ["1", "all"],
      ["2", "part"],
      ["3", "no"],
    ] as const) {
      const input = terminal();
      const screen = capture();
      const answer = listener(input, screen.stream)(question);
      await screen.prompted();
      input.write(`${typed}\n`);
      await expect(answer, typed).resolves.toBe(expected);
    }
  });

  it("asks about whichever screen reader it's told", async () => {
    const input = terminal();
    const screen = capture();
    const answer = listener(input, screen.stream)({ screenReader: "VoiceOver", pagesRead: 2 });
    await screen.prompted();
    input.write("2\n");
    await expect(answer).resolves.toBe("part");
    expect(screen.text()).toContain("Did you listen as VoiceOver read these pages?");
  });

  it("asks again after something that isn't one of the choices", async () => {
    const input = terminal();
    const screen = capture();
    const answer = listener(input, screen.stream)(question);
    await screen.prompted();
    input.write("yes\n");
    await screen.prompted(2);
    input.write("1\n");
    await expect(answer).resolves.toBe("all");
    expect(screen.text()).toContain("Enter a number from 1 to 3.");
  });
});

// Keys pressed during the run wait in the terminal's input, and would answer the question the
// instant it appeared: a "No" (Enter) or "Yes" the person never gave, sealed as theirs.
describe("keys typed before the question appears", () => {
  it("doesn't take them for an answer", async () => {
    const input = terminal();
    input.write("1\n\n");
    const screen = capture();
    const answer = listener(input, screen.stream)(question);
    await screen.prompted();
    input.write("2\n");
    await expect(answer).resolves.toBe("part");
    // The keys typed ahead weren't read as a wrong answer either.
    expect(screen.text()).not.toContain("Enter a number");
  });

  it("drops keys pressed while the question is on its way, for the time it's given", async () => {
    const input = terminal();
    const screen = capture();
    const answer = listener(input, screen.stream, { drainMs: 200 })(question);
    // Pressed a moment after the session ended, before the question shows.
    setTimeout(() => input.write("1\n"), 50);
    await screen.prompted();
    expect(screen.text()).toContain("Did you listen");
    input.write("3\n");
    await expect(answer).resolves.toBe("no");
  });

  it("waits a quarter of a second for them, unless it's told otherwise", async () => {
    const input = terminal();
    const screen = capture();
    const asked = Date.now();
    const answer = makeAskListener(input, screen.stream, { signals: fakeSignals().source })!(
      question,
    );
    await screen.prompted();
    expect(Date.now() - asked).toBeGreaterThanOrEqual(240);
    input.write("2\n");
    await expect(answer).resolves.toBe("part");
  });
});

// Closing the terminal window sends SIGHUP (and Windows, SIGBREAK for Ctrl+Break); a system
// shutting voicecap down sends SIGTERM. None of them is an answer.
describe("a window closed at the question", () => {
  it.each(["SIGHUP", "SIGTERM"] as const)("gives up without an answer on %s", async (signal) => {
    const signals = fakeSignals("darwin");
    const input = terminal();
    const screen = capture();
    const answer = listener(input, screen.stream, { signals: signals.source })(question);
    await screen.prompted();
    signals.send(signal);
    await expect(answer).resolves.toBeNull();
    // It listened only while it asked.
    expect(signals.listening()).toEqual([]);
    expect(signals.exits).toEqual([]);
  });

  it("gives up on Windows's SIGBREAK too", async () => {
    const signals = fakeSignals("win32");
    const input = terminal();
    const screen = capture();
    const answer = listener(input, screen.stream, { signals: signals.source })(question);
    await screen.prompted();
    expect(signals.listening()).toEqual(["SIGBREAK", "SIGHUP", "SIGTERM"]);
    signals.send("SIGBREAK");
    await expect(answer).resolves.toBeNull();
  });

  it("gives up before the question shows when the window closes during the wait for it", async () => {
    const signals = fakeSignals();
    const screen = capture();
    const answer = listener(terminal(), screen.stream, {
      drainMs: 10_000,
      signals: signals.source,
    })(question);
    signals.send("SIGHUP");
    await expect(answer).resolves.toBeNull();
    expect(screen.text()).not.toContain("Did you listen");
    expect(signals.listening()).toEqual([]);
  });

  it("stops listening for them once it's answered", async () => {
    const signals = fakeSignals();
    const input = terminal();
    const screen = capture();
    const answer = listener(input, screen.stream, { signals: signals.source })(question);
    await screen.prompted();
    input.write("1\n");
    await expect(answer).resolves.toBe("all");
    expect(signals.listening()).toEqual([]);
  });
});

describe("the listener's question at a real terminal", () => {
  /** A screen: a real stream that says it's a terminal, as readline's raw-key mode needs. */
  function screen() {
    const shown = capture();
    const stream = Object.assign(
      new Writable({
        write(chunk: Buffer, _encoding, callback) {
          shown.stream.write(chunk.toString());
          callback();
        },
      }),
      { isTTY: true },
    );
    return { stream, text: shown.text, prompted: shown.prompted };
  }

  /** A keyboard that records each time the terminal is put in raw mode, or out of it. */
  function keyboard() {
    const rawModes: boolean[] = [];
    const input = Object.assign(new PassThrough(), {
      isTTY: true,
      setRawMode(mode: boolean) {
        rawModes.push(mode);
      },
    });
    return { input, rawModes };
  }

  // Raw mode while keys typed ahead are dropped, so they come as they were pressed, not a line
  // at a time; then again while the question is asked.
  it("takes the answer typed, then leaves raw mode", async () => {
    const { input, rawModes } = keyboard();
    const shown = screen();
    const answer = listener(input, shown.stream)(question);
    await shown.prompted();
    input.write("2\n");
    await expect(answer).resolves.toBe("part");
    expect(rawModes).toEqual([true, false, true, false]);
  });

  it("drops keys typed ahead, one at a time as a terminal sends them", async () => {
    const { input } = keyboard();
    input.write("1");
    input.write("\r");
    const shown = screen();
    const answer = listener(input, shown.stream)(question);
    await shown.prompted();
    input.write("3\r");
    await expect(answer).resolves.toBe("no");
  });

  it("gives up without an answer on Ctrl+C, then leaves raw mode", async () => {
    const { input, rawModes } = keyboard();
    const shown = screen();
    const answer = listener(input, shown.stream)(question);
    await shown.prompted();
    input.write("\u0003");
    await expect(answer).resolves.toBeNull();
    expect(rawModes).toEqual([true, false, true, false]);
  });

  it("gives up without an answer when the input ends, then leaves raw mode", async () => {
    const { input, rawModes } = keyboard();
    const shown = screen();
    const answer = listener(input, shown.stream)(question);
    await shown.prompted();
    input.end();
    await expect(answer).resolves.toBeNull();
    expect(rawModes).toEqual([true, false, true, false]);
  });

  it("gives up without an answer when the window closes, then leaves raw mode", async () => {
    const signals = fakeSignals();
    const { input, rawModes } = keyboard();
    const shown = screen();
    const answer = listener(input, shown.stream, { signals: signals.source })(question);
    await shown.prompted();
    signals.send("SIGHUP");
    await expect(answer).resolves.toBeNull();
    expect(rawModes).toEqual([true, false, true, false]);
  });
});
