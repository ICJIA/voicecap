import { createPrompter, InputEndedError } from "../init/prompt.js";
import type { ListenerAnswer } from "../model.js";
import { InterruptedError } from "../passes/steps.js";
import type { RunAuditOptions } from "../run/audit.js";
import type { OutputStream } from "../util/log.js";

/** What the question lists, in order, and the answer each one records. */
const CHOICES: readonly { text: string; answer: ListenerAnswer }[] = [
  { text: "Yes, all of them", answer: "all" },
  { text: "Part of them", answer: "part" },
  { text: "No", answer: "no" },
];

/** Enter alone picks "No", so a statement never claims listening by accident. */
const DEFAULT_CHOICE = CHOICES.findIndex(({ answer }) => answer === "no");

/**
 * The question a session ends with, for a person at a terminal: "Did you listen as NVDA read these
 * pages?", answered "Yes, all of them", "Part of them", or "No". It resolves the answer, or null
 * when there is none: Ctrl+C at the question, or the input ended. It's undefined, so the question
 * is never asked, when `input` isn't a terminal (a script, CI, piped input).
 */
export function makeAskListener(
  input: NodeJS.ReadableStream,
  output: OutputStream,
): RunAuditOptions["askListener"] {
  if ((input as { isTTY?: boolean }).isTTY !== true) return undefined;
  return async ({ screenReader }) => {
    // At a terminal, readline takes each key itself (raw mode), so Ctrl+C at the question ends the
    // question, not the run. As readline does by default, that needs the output to be a terminal
    // too. The prompter is closed after the question, which leaves raw mode.
    const prompter = createPrompter({ input, output, terminal: output.isTTY === true });
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
      prompter.close();
    }
  };
}
