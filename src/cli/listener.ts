import { setImmediate as nextTurn, setTimeout as delay } from "node:timers/promises";

import { createPrompter, InputEndedError } from "../init/prompt.js";
import type { ListenerAnswer } from "../model.js";
import { InterruptedError } from "../passes/steps.js";
import type { RunAuditOptions } from "../run/audit.js";
import { stopOnClosedWindow, type SignalSource } from "../run/signals.js";
import type { OutputStream } from "../util/log.js";
import { isTerminalStream } from "../util/terminal.js";

/** What the question lists, in order, and the answer each one records. */
const CHOICES: readonly { text: string; answer: ListenerAnswer }[] = [
  { text: "Yes, all of them", answer: "all" },
  { text: "Part of them", answer: "part" },
  { text: "No", answer: "no" },
];

/** Enter alone picks "No", so a statement never claims listening by accident. */
const DEFAULT_CHOICE = CHOICES.findIndex(({ answer }) => answer === "no");

/** How long the keys waiting before the question are read and dropped, in milliseconds. */
const DROP_MS = 250;

export interface AskListenerOptions {
  /**
   * How long input is read and dropped before the question is shown, in milliseconds. Default 250:
   * time enough for the keys that waited during the run to arrive.
   */
  drainMs?: number;
  /** Where a closed window's signals come from: the process, unless a test's stand-in. */
  signals?: SignalSource;
}

/**
 * The question a session ends with, for a person at a terminal: "Did you listen as NVDA read these
 * pages?", answered "Yes, all of them", "Part of them", or "No", typed as 1, 2, or 3.
 *
 * Only an answer typed after the question appears counts. Keys pressed during the run wait in the
 * terminal's input and would answer it the instant it appeared (Enter, a "No" the person never
 * gave), so what's waiting, and what arrives in the next `drainMs`, is read and dropped before the
 * question is shown.
 *
 * It resolves the answer, or null when there is none: Ctrl+C at the question, the input ended, or
 * the window closed (a SIGHUP, SIGTERM, or on Windows SIGBREAK, while it asks). It's undefined, so
 * the question is never asked, when `input` isn't a terminal (a script, CI, piped input).
 */
export function makeAskListener(
  input: NodeJS.ReadableStream,
  output: OutputStream,
  options: AskListenerOptions = {},
): RunAuditOptions["askListener"] {
  if (!isTerminalStream(input)) return undefined;
  const { drainMs = DROP_MS, signals = process } = options;
  return async ({ screenReader }) => {
    // At a terminal, readline takes each key itself (raw mode), so Ctrl+C at the question ends the
    // question, not the run. As readline does by default, that needs the output to be a terminal
    // too.
    const terminal = isTerminalStream(output);
    const closed = new AbortController();
    const unlisten = stopOnClosedWindow(closed, signals);
    try {
      const dropped = { ms: drainMs, raw: terminal, signal: closed.signal };
      if (!(await dropWaitingInput(input, dropped))) return null;
      // The prompter is closed after the question, which leaves raw mode. A window that closes
      // meanwhile closes it at once, which ends the question with no answer.
      const prompter = createPrompter({ input, output, terminal });
      const giveUp = () => prompter.close();
      closed.signal.addEventListener("abort", giveUp, { once: true });
      try {
        const picked = await prompter.choose(
          `Did you listen as ${screenReader} read these pages?`,
          CHOICES.map(({ text }) => text),
          DEFAULT_CHOICE,
        );
        return CHOICES[picked]?.answer ?? null;
      } catch (error) {
        if (error instanceof InterruptedError || error instanceof InputEndedError) return null;
        throw error;
      } finally {
        closed.signal.removeEventListener("abort", giveUp);
        prompter.close();
      }
    } finally {
      unlisten();
    }
  };
}

/**
 * Read and drop what `input` holds, and whatever arrives for `ms` more. At a terminal (`raw`) it
 * reads in raw mode, as the question does, so the keys come as they were pressed, not a line at a
 * time, and it leaves raw mode after, once the input has stopped reading. Resolves false when
 * there's nothing to ask with: the input ended, or `signal` gave up.
 */
async function dropWaitingInput(
  input: NodeJS.ReadableStream,
  options: { ms: number; raw: boolean; signal: AbortSignal },
): Promise<boolean> {
  const keys = input as { setRawMode?: (mode: boolean) => unknown; readableEnded?: boolean };
  let ended = keys.readableEnded === true;
  const onEnd = () => {
    ended = true;
  };
  const drop = () => {};
  if (options.raw) keys.setRawMode?.(true);
  input.on("end", onEnd);
  input.on("data", drop);
  try {
    // Ends early, with nothing more to wait for, when the window closes.
    await delay(options.ms, undefined, { signal: options.signal }).catch(() => {});
  } finally {
    input.removeListener("data", drop);
    input.pause();
    if (options.raw) {
      // Node stops reading process.stdin on the tick after pause(). Leaving raw mode while it still
      // reads has a Windows console start a line-at-a-time read, and with readline taking the
      // terminal next, voicecap then never exited after the answer in Windows Terminal (measured
      // 2026-10-02, Node 24.19.0, Windows 11). So raw mode is left once the read has stopped.
      await nextTurn();
      keys.setRawMode?.(false);
    }
    input.removeListener("end", onEnd);
  }
  return !ended && !options.signal.aborted;
}
