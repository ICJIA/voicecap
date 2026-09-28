import { createInterface } from "node:readline";

import { InterruptedError } from "../passes/steps.js";
import type { OutputStream } from "../util/log.js";

/**
 * The input stream ended (e.g. a closed pipe) before a question was answered. `voicecap init`
 * exits with code 1 when this reaches it.
 */
export class InputEndedError extends Error {
  constructor() {
    super("Input ended");
    this.name = "InputEndedError";
  }
}

/**
 * Plain line-by-line questions over a stream: readable with a screen reader in a terminal, and
 * just as usable over a pipe. Any method's returned promise can instead reject with
 * `InterruptedError` (Ctrl+C in a terminal) or `InputEndedError` (the input ended first).
 */
export interface Prompter {
  /**
   * Ask a question and return the trimmed answer, or `options.default` for an empty one (the
   * default is returned as given, without running `check` on it). `options.check` runs on any
   * other answer and returns the one-line reason it's wrong, or null when it's fine; a wrong
   * answer is explained and the question is asked again.
   */
  ask(
    question: string,
    options?: { default?: string; check?: (answer: string) => string | null },
  ): Promise<string>;

  /** Show `choices` numbered from 1 and ask which one; returns the picked choice's 0-based index. */
  choose(question: string, choices: readonly string[], defaultIndex: number): Promise<number>;

  /** Ask a yes/no question; an empty answer picks `defaultYes`. */
  confirm(question: string, defaultYes: boolean): Promise<boolean>;

  /** Print a line that isn't a question. */
  say(text: string): void;

  /** Release the underlying readline interface. */
  close(): void;

  /**
   * Aborted the moment Ctrl+C arrives in a terminal, whether or not a question is pending at the
   * time (e.g. during the up-to-15-second site check between questions). Pass this to site and
   * sitemap checks so they stop at once instead of running out their own timeout.
   */
  readonly interrupted: AbortSignal;
}

/**
 * Build a `Prompter` over `io.input` and `io.output`. Answers are read from a
 * `node:readline` interface's async iterator, created once here, up front: not from its
 * `question()` method, which drops lines written before it's called, losing answers piped in
 * ahead of time. `io.output` is only handed to readline when `io.terminal` is true, since readline
 * calls `output.on(...)` in that mode and so needs a real stream; otherwise prompts are written
 * directly with `io.output.write`.
 */
export function createPrompter(io: {
  input: NodeJS.ReadableStream;
  output: OutputStream;
  terminal?: boolean;
}): Prompter {
  const terminal = io.terminal ?? false;
  const rl = createInterface({
    input: io.input,
    output: terminal ? (io.output as unknown as NodeJS.WritableStream) : undefined,
    terminal,
  });
  const lines = rl[Symbol.asyncIterator]();

  /** Show a question's text: a redrawable readline prompt in a terminal, or a plain write. */
  function show(text: string): void {
    if (terminal) {
      rl.setPrompt(text);
      rl.prompt();
    } else {
      io.output.write(text);
    }
  }

  function say(text: string): void {
    io.output.write(`${text}\n`);
  }

  // Ctrl+C can arrive between questions (e.g. during the up-to-15-second site check), when no
  // nextLine() is pending. Node's readline closes the interface itself if SIGINT arrives with no
  // listener at all, so this listener lives for the whole interface, not just one nextLine() call.
  let pendingReject: ((error: Error) => void) | null = null;
  let interruptedWhileIdle = false;
  const interruptedController = new AbortController();

  function handleSigint(): void {
    // Readline reports Ctrl+C only in terminal mode, where it leaves the cursor on the question's
    // line: end that line, so the shell's prompt starts on its own.
    io.output.write("\n");
    interruptedController.abort(new InterruptedError());
    if (pendingReject) {
      const reject = pendingReject;
      pendingReject = null;
      reject(new InterruptedError());
    } else {
      interruptedWhileIdle = true;
    }
  }
  rl.on("SIGINT", handleSigint);

  /**
   * The shared iterator's next line, or a rejection: `InterruptedError` if Ctrl+C arrived (either
   * just now, while this call is the pending one, or already, before it started), `InputEndedError`
   * once the input has none left.
   */
  function nextLine(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (interruptedWhileIdle) {
        interruptedWhileIdle = false;
        reject(new InterruptedError());
        return;
      }
      pendingReject = reject;
      lines.next().then(
        (result) => {
          if (pendingReject === reject) pendingReject = null;
          if (result.done) reject(new InputEndedError());
          else resolve(result.value);
        },
        (error: unknown) => {
          if (pendingReject === reject) pendingReject = null;
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }

  async function readAnswer(promptText: string): Promise<string> {
    show(promptText);
    return (await nextLine()).trim();
  }

  async function ask(
    question: string,
    options?: { default?: string; check?: (answer: string) => string | null },
  ): Promise<string> {
    const promptText =
      options?.default !== undefined ? `${question} [${options.default}]: ` : `${question}: `;
    for (;;) {
      const answer = await readAnswer(promptText);
      if (answer === "" && options?.default !== undefined) return options.default;
      const reason = options?.check ? options.check(answer) : null;
      if (reason === null) return answer;
      say(reason);
    }
  }

  async function choose(
    question: string,
    choices: readonly string[],
    defaultIndex: number,
  ): Promise<number> {
    const promptText = `Choose [${defaultIndex + 1}]: `;
    for (;;) {
      say(question);
      choices.forEach((choice, index) => say(`  ${index + 1}. ${choice}`));
      const answer = await readAnswer(promptText);
      const picked = answer === "" ? defaultIndex + 1 : Number(answer);
      if (Number.isInteger(picked) && picked >= 1 && picked <= choices.length) return picked - 1;
      say(`Enter a number from 1 to ${choices.length}.`);
    }
  }

  async function confirm(question: string, defaultYes: boolean): Promise<boolean> {
    const promptText = `${question} [${defaultYes ? "Y/n" : "y/N"}]: `;
    for (;;) {
      const answer = (await readAnswer(promptText)).toLowerCase();
      if (answer === "") return defaultYes;
      if (answer === "y") return true;
      if (answer === "n") return false;
      say("Answer y or n.");
    }
  }

  function close(): void {
    rl.off("SIGINT", handleSigint);
    rl.close();
  }

  return { ask, choose, confirm, say, close, interrupted: interruptedController.signal };
}
