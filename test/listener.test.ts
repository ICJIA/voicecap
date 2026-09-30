import { PassThrough, Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { makeAskListener } from "../src/cli/listener.js";

/** A plain collecting writer: all a prompter needs to show its questions. */
function capture() {
  let text = "";
  return {
    stream: { write: (chunk: string) => ((text += chunk), true) },
    text: () => text,
  };
}

/** The input of a person at a terminal. */
function terminal() {
  return Object.assign(new PassThrough(), { isTTY: true });
}

describe("the listener's question", () => {
  it("asks, and takes the answer", async () => {
    const input = terminal();
    const screen = capture();
    const ask = makeAskListener(input, screen.stream)!;
    input.write("1\n");
    await expect(ask({ screenReader: "NVDA", pagesRead: 7 })).resolves.toBe("all");
    expect(screen.text()).toContain("Did you listen as NVDA read these pages?");
    expect(screen.text()).toContain(
      "  1. Yes, all of them\n  2. Part of them\n  3. No\nChoose [3]: ",
    );
  });

  it("defaults to No on Enter, so it never claims listening by accident", async () => {
    const input = terminal();
    const ask = makeAskListener(input, capture().stream)!;
    input.write("\n");
    await expect(ask({ screenReader: "NVDA", pagesRead: 7 })).resolves.toBe("no");
  });

  it("isn't offered when the input isn't a terminal", () => {
    expect(makeAskListener(new PassThrough(), capture().stream)).toBeUndefined();
  });

  it("gives up without an answer when the input ends", async () => {
    const input = terminal();
    const ask = makeAskListener(input, capture().stream)!;
    input.end();
    await expect(ask({ screenReader: "NVDA", pagesRead: 7 })).resolves.toBeNull();
  });

  it("takes each number for its own answer", async () => {
    for (const [typed, answer] of [
      ["1", "all"],
      ["2", "part"],
      ["3", "no"],
    ] as const) {
      const input = terminal();
      const ask = makeAskListener(input, capture().stream)!;
      input.write(`${typed}\n`);
      await expect(ask({ screenReader: "NVDA", pagesRead: 7 }), typed).resolves.toBe(answer);
    }
  });

  it("asks about whichever screen reader it's told", async () => {
    const input = terminal();
    const screen = capture();
    const ask = makeAskListener(input, screen.stream)!;
    input.write("2\n");
    await expect(ask({ screenReader: "VoiceOver", pagesRead: 2 })).resolves.toBe("part");
    expect(screen.text()).toContain("Did you listen as VoiceOver read these pages?");
  });

  it("asks again after something that isn't one of the choices", async () => {
    const input = terminal();
    const screen = capture();
    const ask = makeAskListener(input, screen.stream)!;
    input.write("yes\n1\n");
    await expect(ask({ screenReader: "NVDA", pagesRead: 7 })).resolves.toBe("all");
    expect(screen.text()).toContain("Enter a number from 1 to 3.");
  });
});

describe("the listener's question at a real terminal", () => {
  /** A screen: a real stream that says it's a terminal, as readline's raw-key mode needs. */
  function screen() {
    let text = "";
    const stream = Object.assign(
      new Writable({
        write(chunk: Buffer, _encoding, callback) {
          text += chunk.toString();
          callback();
        },
      }),
      { isTTY: true },
    );
    return { stream, text: () => text };
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

  it("takes the answer typed, then leaves raw mode", async () => {
    const { input, rawModes } = keyboard();
    const ask = makeAskListener(input, screen().stream)!;
    const answer = ask({ screenReader: "NVDA", pagesRead: 7 });
    input.write("2\n");
    await expect(answer).resolves.toBe("part");
    expect(rawModes).toEqual([true, false]);
  });

  it("gives up without an answer on Ctrl+C, then leaves raw mode", async () => {
    const { input, rawModes } = keyboard();
    const ask = makeAskListener(input, screen().stream)!;
    const answer = ask({ screenReader: "NVDA", pagesRead: 7 });
    input.write("\u0003");
    await expect(answer).resolves.toBeNull();
    expect(rawModes).toEqual([true, false]);
  });

  it("gives up without an answer when the input ends, then leaves raw mode", async () => {
    const { input, rawModes } = keyboard();
    const ask = makeAskListener(input, screen().stream)!;
    const answer = ask({ screenReader: "NVDA", pagesRead: 7 });
    input.end();
    await expect(answer).resolves.toBeNull();
    expect(rawModes).toEqual([true, false]);
  });
});
