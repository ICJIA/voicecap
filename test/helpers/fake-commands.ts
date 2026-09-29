/**
 * A fake RunCommand for the macOS helpers' tests: given (file, args) -> result pairs, the first
 * whose matcher returns true wins. An unmatched call fails loudly (a non-zero exit naming the
 * command) instead of silently returning empty output, so a helper that changes its command shows
 * up as a test failure, not a hang or a wrong-looking pass.
 */
import type { CommandResult, RunCommand } from "../../src/drivers/voiceover/macos.js";

type Answer = readonly [
  match: (file: string, args: string[]) => boolean,
  result: Partial<CommandResult>,
];

export interface FakeCall {
  file: string;
  args: string[];
  timeoutMs?: number;
  /** The abort signal the command was given, if any: Ctrl+C kills it. */
  signal?: AbortSignal;
}

export interface FakeCommands {
  run: RunCommand;
  calls: FakeCall[];
}

const DEFAULT_RESULT: CommandResult = { code: 0, signal: null, stdout: "", stderr: "" };

/** Every call is recorded in `calls`, in order, whether or not it matched an answer. */
export function fakeCommands(answers: Answer[]): FakeCommands {
  const calls: FakeCall[] = [];
  const run: RunCommand = (file, args, options) => {
    calls.push({ file, args, timeoutMs: options?.timeoutMs, signal: options?.signal });
    const answer = answers.find(([match]) => match(file, args));
    if (!answer) {
      return Promise.resolve({
        ...DEFAULT_RESULT,
        code: 1,
        stderr: `unexpected command: ${file} ${args.join(" ")}`,
      });
    }
    return Promise.resolve({ ...DEFAULT_RESULT, ...answer[1] });
  };
  return { run, calls };
}
