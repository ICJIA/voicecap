/**
 * A terminal stand-in, for tests of anything that asks with a Prompter and prints lines of its own
 * (the guided loop, setup). The prompter is a real createPrompter over piped input: each time it
 * shows a question, the screen types the next scripted answer ("" is Enter) and echoes it, as a
 * terminal would. Lines printed with `say`, and a logger's info lines, land on the same screen, so
 * a test reads everything in the order a person would see it. The logger's warnings and errors go
 * to `errors()`.
 *
 * A question with no answer left ends the input, so the prompter rejects with InputEndedError: a
 * test that expects no more questions fails loudly if one comes. `unused()` lists answers that were
 * never asked for.
 */
import { PassThrough } from "node:stream";

import { createPrompter, type Prompter } from "../../src/init/prompt.js";
import { createConsoleLogger, type Logger } from "../../src/util/log.js";

export interface Screen {
  prompter: Prompter;
  /** Prints a line: a property, so it can be handed on as the guided loop's `say`. */
  say: (text: string) => void;
  logger: Logger;
  text(): string;
  errors(): string;
  unused(): string[];
  close(): void;
}

export function scriptedScreen(answers: readonly string[]): Screen {
  const input = new PassThrough();
  const left = [...answers];
  let screen = "";
  let errors = "";
  const output = {
    write(chunk: string) {
      screen += chunk;
      // A question is one write that leaves its line open; every other write ends its line.
      if (!chunk.endsWith("\n")) {
        const answer = left.shift();
        if (answer === undefined) {
          input.end();
        } else {
          screen += `${answer}\n`;
          input.write(`${answer}\n`);
        }
      }
      return true;
    },
  };
  const prompter = createPrompter({ input, output });
  return {
    prompter,
    say: (text) => void output.write(`${text}\n`),
    logger: createConsoleLogger(output, { write: (chunk: string) => (errors += chunk) }),
    text: () => screen,
    errors: () => errors,
    unused: () => [...left],
    close: () => {
      prompter.close();
      if (!input.writableEnded) input.end();
    },
  };
}
