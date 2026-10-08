/**
 * Stand-ins for the review replay's tests: a person's keys, the terminal they type them on, and
 * the program a voice starts. Each stands in for one thing the replay reads or writes, so a test
 * says what the person does and sees without a real keyboard, voice, or screen. The tests of the
 * player and the session add theirs here.
 */
import { EventEmitter } from "node:events";
import { PassThrough, Readable, Writable } from "node:stream";

import type { Key, KeySource } from "../../src/review-replay/keys.js";
import type { VoiceChild } from "../../src/review-replay/voice.js";

/**
 * Keys a test presses by hand, given as `terminalKeys` gives a terminal's: in order, with a key
 * pushed before it's asked for waiting its turn, `waiting()` resolving without taking the key, and
 * null once the keys have ended and the pushed ones are taken. A string pushed is a `char` key.
 * As at a terminal, a key pushed after the keys ended is never given. `closed` says whether
 * `close()` was called.
 */
export function keyQueue(): KeySource & {
  push(...keys: (Key | string)[]): void;
  end(): void;
  closed: boolean;
} {
  const queue: Key[] = [];
  let ended = false;
  let arrival: Promise<void> | null = null;
  let arrive = () => {};

  /** Wakes whoever waits: a key came, or the keys ended. */
  const wake = (): void => {
    const resolve = arrive;
    arrival = null;
    arrive = () => {};
    resolve();
  };

  const source = {
    closed: false,
    push(...keys: (Key | string)[]): void {
      if (ended) return;
      for (const key of keys) {
        queue.push(typeof key === "string" ? { name: "char", char: key } : key);
      }
      wake();
    },
    end(): void {
      ended = true;
      wake();
    },
    waiting(): Promise<void> {
      if (queue.length > 0 || ended) return Promise.resolve();
      arrival ??= new Promise<void>((resolve) => {
        arrive = resolve;
      });
      return arrival;
    },
    async next(): Promise<Key | null> {
      for (;;) {
        const key = queue.shift();
        if (key !== undefined) return key;
        if (ended) return null;
        await source.waiting();
      }
    },
    close(): Promise<void> {
      source.closed = true;
      queue.length = 0;
      source.end();
      return Promise.resolve();
    },
  };
  return source;
}

/**
 * The input of a person at a terminal: a stream they type on (write the keys as a terminal sends
 * them: "n", "\r", "\x1b[C" for Right Arrow), marked as a terminal, with the raw mode it was put
 * in recorded each time it changes.
 */
export function ttyInput(): PassThrough & {
  isTTY: true;
  setRawMode: (mode: boolean) => void;
  rawModes: boolean[];
} {
  const rawModes: boolean[] = [];
  return Object.assign(new PassThrough(), {
    isTTY: true as const,
    rawModes,
    setRawMode: (mode: boolean): void => {
      rawModes.push(mode);
    },
  });
}

/**
 * The program a voice starts (PowerShell, or `say`), run by hand. `written()` is everything written
 * to its input, and `ended` says whether that input was ended. `answer` prints a line of JSON, as
 * the Windows voice's script answers. `exit` ends it with a code, as Node reports an exit: the exit
 * first, and the end of its output on the turn after, so a test can still `answer` in between.
 * `fail` reports an error, as Node does for a program that can't start. `killed` says whether it
 * was killed; that doesn't end it, so a test calls `exit` for that too.
 */
export function fakeChild(): VoiceChild & {
  written(): string;
  answer(json: object): void;
  exit(code: number | null): void;
  fail(error: Error): void;
  killed: boolean;
  ended: boolean;
} {
  const events = new EventEmitter();
  let input = "";
  let exited = false;
  const stdin = new Writable({
    write(chunk: Buffer, _encoding, done) {
      input += chunk.toString("utf8");
      done();
    },
  });
  const stdout = new Readable({ read() {} });
  const child = {
    stdin,
    stdout,
    killed: false,
    get ended(): boolean {
      return stdin.writableEnded;
    },
    kill(): boolean {
      child.killed = true;
      return true;
    },
    once(
      event: "exit" | "error",
      listener: ((code: number | null) => void) | ((error: Error) => void),
    ): void {
      events.once(event, listener);
    },
    written: (): string => input,
    answer(json: object): void {
      stdout.push(`${JSON.stringify(json)}\n`);
    },
    exit(code: number | null): void {
      if (exited) return;
      exited = true;
      events.emit("exit", code);
      setImmediate(() => stdout.push(null));
    },
    fail(error: Error): void {
      events.emit("error", error);
    },
  };
  return child;
}
