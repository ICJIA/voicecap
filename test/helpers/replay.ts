/**
 * Stand-ins for the review replay's tests: a person's keys, and the terminal they type them on.
 * Each stands in for one thing the replay reads or writes, so a test says what the person does and
 * sees without a real keyboard, voice, or screen. The tests of the voice, the player, and the
 * session add theirs here.
 */
import { PassThrough } from "node:stream";

import type { Key, KeySource } from "../../src/review-replay/keys.js";

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
