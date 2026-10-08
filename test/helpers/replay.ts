/**
 * Stand-ins for the review replay's tests: a person's keys, the terminal they type them on, the
 * program a voice starts, the voice itself, and the screen a session writes to, with the person
 * answering what it asks. Each stands in for one thing the replay reads or writes, so a test says
 * what the person does and sees without a real keyboard, voice, or screen.
 */
import { EventEmitter } from "node:events";
import { PassThrough, Readable, Writable } from "node:stream";

import type { Key, KeySource } from "../../src/review-replay/keys.js";
import { REPLAY_TEXT } from "../../src/review-replay/text.js";
import type { Voice, VoiceChild } from "../../src/review-replay/voice.js";
import type { OutputStream } from "../../src/util/log.js";

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

/**
 * The computer's voice, worked by hand. Each line it's given is kept in `said`, with its speed,
 * and is being said until the test calls `finish()` or the player calls `stop()` (counted in
 * `stops`). With `auto`, each line is said at once. As a real voice does, it says one line at a
 * time (a second say() while a line is being said throws), `close()` ends the line being said, and
 * every say() after `close()` rejects. `fail` rejects the line being said, and every line after,
 * with its error, as a voice that has stopped working does.
 *
 * `speaking` says whether a line is being said. `starting` resolves once one is: at once while a
 * line is being said, or else when the next say() is called.
 */
export function fakeVoice(options: { auto?: boolean } = {}): Voice & {
  said: { text: string; wpm: number }[];
  stops: number;
  closed: boolean;
  speaking: boolean;
  finish(): void;
  fail(error: Error): void;
  starting: Promise<void>;
} {
  /** What settles the line being said, until it ends. */
  let line: { resolve: () => void; reject: (error: Error) => void } | null = null;
  /** Set once the voice has stopped working: every line from then on rejects with it. */
  let failure: Error | null = null;
  /** What the next say() resolves, for a test that waits for a line to start. */
  let started = (): void => {};
  let nextStart = new Promise<void>((resolve) => {
    started = resolve;
  });

  /** Ends the line being said, if any, and gives what settles it. */
  const end = (): typeof line => {
    const ending = line;
    line = null;
    return ending;
  };

  const voice = {
    said: [] as { text: string; wpm: number }[],
    stops: 0,
    closed: false,
    get speaking(): boolean {
      return line !== null;
    },
    get starting(): Promise<void> {
      return line !== null ? Promise.resolve() : nextStart;
    },
    say(text: string, wpm: number): Promise<void> {
      if (line !== null) throw new Error("The voice is already saying a line.");
      if (voice.closed) return Promise.reject(new Error("The voice was closed."));
      if (failure !== null) return Promise.reject(failure);
      voice.said.push({ text, wpm });
      const saying =
        options.auto === true
          ? Promise.resolve()
          : new Promise<void>((resolve, reject) => {
              line = { resolve, reject };
            });
      const announce = started;
      nextStart = new Promise<void>((resolve) => {
        started = resolve;
      });
      announce();
      return saying;
    },
    stop(): void {
      voice.stops += 1;
      end()?.resolve();
    },
    finish(): void {
      const ending = end();
      if (ending === null) throw new Error("finish() was called with no line being said.");
      ending.resolve();
    },
    fail(error: Error): void {
      failure = error;
      end()?.reject(error);
    },
    close(): Promise<void> {
      voice.closed = true;
      end()?.resolve();
      return Promise.resolve();
    },
  };
  return voice;
}

/**
 * Waits until `voice` (a fakeVoice that isn't `auto`) is saying `text`, saying each line before it
 * to its end, as a person who waits for that line hears the lines before it.
 */
export async function untilSaying(
  voice: ReturnType<typeof fakeVoice>,
  text: string,
): Promise<void> {
  for (;;) {
    await voice.starting;
    if (voice.said.at(-1)?.text === text) return;
    voice.finish();
  }
}

/**
 * Has `voice` (a fakeVoice that isn't `auto`) say each line it's given to its end, until `done`
 * settles: as a person who presses nothing more hears them all.
 */
export async function sayingEach(
  voice: ReturnType<typeof fakeVoice>,
  done: Promise<unknown>,
): Promise<void> {
  const over = done.then(
    () => "over" as const,
    () => "over" as const,
  );
  for (;;) {
    const next = await Promise.race([voice.starting.then(() => "line" as const), over]);
    if (next === "over") return;
    // A key may have stopped it meanwhile.
    if (voice.speaking) voice.finish();
  }
}

/**
 * What a person does when a replay session asks them something: the keys they press there, in
 * order, or a function that does it, for a test that does something else at that moment too. A
 * note's keys go with its choice: "2", "B", "a", "d", Enter is one answer.
 */
export type Answer = readonly (Key | string)[] | (() => void);

/**
 * The screen a replay session writes to, kept as the terminal would show it (`text()`), with a
 * person at `keys` who answers each time the session asks: each time it shows REPLAY_TEXT.question,
 * or the two lines about the person's own NVDA, the next of `answers` is given. Keys are pressed on
 * the turn after the session asks, once a voice that says each line at once has said the question
 * (Ruling R10), so they answer it rather than stop it; a function is called at once, for a test
 * that presses keys at another moment. So no answer is pressed while a page plays, where the player
 * would take it as a key. Once the answers have run out, the next time it asks ends the keys, as a
 * person walking away would, so a session that asks more than a test answers ends rather than waits.
 */
export function answering(
  keys: { push(...keys: (Key | string)[]): void; end(): void },
  answers: readonly Answer[],
): OutputStream & { text(): string } {
  const asks = [REPLAY_TEXT.question, REPLAY_TEXT.nvda.join("\n")];
  let text = "";
  let answered = 0;
  return {
    write(chunk: string) {
      text += chunk;
      // Counted on the whole screen, so a question written in pieces is still seen once.
      const asked = asks.reduce((count, ask) => count + text.split(ask).length - 1, 0);
      while (answered < asked) {
        const answer = answers[answered];
        answered += 1;
        if (answer === undefined) keys.end();
        else if (typeof answer === "function") answer();
        else setImmediate(() => keys.push(...answer));
      }
      return true;
    },
    text: () => text,
  };
}
