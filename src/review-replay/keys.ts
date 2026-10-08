import { emitKeypressEvents } from "node:readline";
import { setImmediate as nextTurn } from "node:timers/promises";

import type { OutputStream } from "../util/log.js";

/**
 * A key the replay acts on, named for what the person meant by it. A key that types something (a
 * letter, a digit, "+") is a `char`, with what it typed. Space is a key of its own, since it pauses
 * the voice. In a note it types a space.
 */
export type Key =
  | { name: "enter" | "space" | "left" | "right" | "backspace" | "escape" | "ctrl-c" }
  | { name: "char"; char: string };

/** Where the replay gets its keys: the terminal's, or a queue a test fills. */
export interface KeySource {
  /**
   * Waits for the next key and takes it. It gives null once the keys have ended (the input ended,
   * after the keys that were already pressed) or the session has stopped (its signal aborted, or
   * the source was closed).
   */
  next(): Promise<Key | null>;
  /**
   * Resolves once a key is waiting, or the keys have ended, without taking the key. The player
   * races it against the voice, so a key is taken only when it acts, and none is lost between
   * lines or pages, but for the keys the session drops on purpose as a page starts, and just after
   * an answer or the Enter at NVDA's two lines (session.ts).
   */
  waiting(): Promise<void>;
  /** Stops reading keys and gives the terminal back. It's safe to call twice. */
  close(): Promise<void>;
}

/** The two things a `keypress` event tells about a key, as far as the replay needs. */
type Pressed = { name?: string; ctrl?: boolean } | undefined;

/** Any text that has no control character in it can be typed into a note. */
const TYPEABLE = /^[^\p{Cc}]+$/u;

/**
 * The key a `keypress` event (from `node:readline`'s `emitKeypressEvents`) stands for, or null when
 * the replay has no use for it. A control character, like Tab or Ctrl+A, and a key pressed with
 * Alt, which has no text, are among those.
 */
export function keyOf(str: string | undefined, key: Pressed): Key | null {
  if (key?.ctrl === true && key.name === "c") return { name: "ctrl-c" };
  const name = key?.name;
  if (name === "return" || name === "enter") return { name: "enter" };
  if (
    name === "space" ||
    name === "left" ||
    name === "right" ||
    name === "backspace" ||
    name === "escape"
  ) {
    return { name };
  }
  return str !== undefined && TYPEABLE.test(str) ? { name: "char", char: str } : null;
}

/**
 * The keys of a person at a terminal, one at a time as they're pressed, from `input`, which is
 * process.stdin in a session.
 *
 * The terminal is in raw mode from here until `close()`, so each key comes as it's pressed, and
 * Ctrl+C reaches voicecap as a key: not as a console signal, which on Windows reaches every program
 * on the console and would end the voice's PowerShell too. Each key goes into a queue, so a key
 * pressed before it's asked for waits its turn, in order.
 *
 * The keys end when `input` ends, closes, or fails, after the keys already pressed, or at once when
 * `signal` aborts (the window closed).
 */
export function terminalKeys(input: NodeJS.ReadableStream, signal?: AbortSignal): KeySource {
  const terminal = input as {
    setRawMode?: (mode: boolean) => unknown;
    readableEnded?: boolean;
    destroyed?: boolean;
  };
  /** The keys pressed and not yet taken, oldest first. */
  const queue: Key[] = [];
  /** The input has ended already, or ends: the queued keys are the last. */
  let ended = terminal.readableEnded === true || terminal.destroyed === true;
  /** The session is over, by `close()` or `signal`: no key is given from here on. */
  let stopped = signal?.aborted === true;
  /** What a call waits on until a key arrives or the keys end, and what resolves it. */
  let arrival: Promise<void> | null = null;
  let arrive = () => {};

  /** Wakes whoever waits: a key came, or the keys ended. */
  const wake = (): void => {
    const resolve = arrive;
    arrival = null;
    arrive = () => {};
    resolve();
  };

  const waiting = (): Promise<void> => {
    if (queue.length > 0 || ended || stopped) return Promise.resolve();
    // One promise for every call, so the player asking after each line leaves nothing piling up.
    arrival ??= new Promise<void>((resolve) => {
      arrive = resolve;
    });
    return arrival;
  };

  const next = async (): Promise<Key | null> => {
    for (;;) {
      if (stopped) return null;
      const key = queue.shift();
      if (key !== undefined) return key;
      if (ended) return null;
      await waiting();
    }
  };

  const onKeypress = (str: string | undefined, key: Pressed): void => {
    const pressed = keyOf(str, key);
    if (pressed === null || stopped) return;
    queue.push(pressed);
    wake();
  };
  const onEnd = (): void => {
    ended = true;
    wake();
  };
  const onStop = (): void => {
    stopped = true;
    wake();
  };

  emitKeypressEvents(input);
  input.on("keypress", onKeypress);
  input.on("end", onEnd);
  input.on("close", onEnd);
  // An input that fails (the terminal gone) ends the keys, so the session winds down in order and
  // the error isn't thrown past it.
  input.on("error", onEnd);
  signal?.addEventListener("abort", onStop, { once: true });
  terminal.setRawMode?.(true);
  input.resume();

  let closing: Promise<void> | null = null;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      onStop();
      signal?.removeEventListener("abort", onStop);
      input.removeListener("keypress", onKeypress);
      input.removeListener("end", onEnd);
      input.removeListener("close", onEnd);
      input.removeListener("error", onEnd);
      input.pause();
      // Node stops reading process.stdin on the tick after pause(). Leaving raw mode while it still
      // reads has a Windows console start a line-at-a-time read (src/cli/listener.ts, measured
      // 2026-10-02 in Windows Terminal), so raw mode is left on the turn after.
      await nextTurn();
      terminal.setRawMode?.(false);
    })();
    return closing;
  };

  return { next, waiting, close };
}

/**
 * The note a person types after "Issue found" or "Fixed", on the line already shown. Each
 * character is written as it's typed, and Backspace takes the last one off the line and out of the
 * note. Enter ends the line and gives the note, trimmed: an empty string when nothing was typed.
 * Ctrl+C, or the keys ending, gives null.
 */
export async function readNote(keys: KeySource, out: OutputStream): Promise<string | null> {
  // One entry for each character, so Backspace takes off a whole character, an emoji included.
  const typed: string[] = [];
  for (;;) {
    const key = await keys.next();
    if (key === null || key.name === "ctrl-c") return null;
    if (key.name === "enter") {
      out.write("\n");
      return typed.join("").trim();
    }
    if (key.name === "backspace") {
      // With nothing typed, there's nothing to take off, and the erase would reach into the prompt.
      if (typed.length > 0) {
        typed.pop();
        out.write("\b \b");
      }
      continue;
    }
    // Space is a key of its own for the player, and a space in a note.
    const char = key.name === "char" ? key.char : key.name === "space" ? " " : null;
    if (char !== null) {
      typed.push(char);
      out.write(char);
    }
  }
}
