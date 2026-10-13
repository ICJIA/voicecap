/**
 * A command line, as `formatCommand` writes it, split into its arguments the way a shell splits it,
 * without starting one: so a test can take a command voicecap printed for a person to paste and give
 * its arguments to voicecap, to see that the command it printed is one voicecap takes.
 */

/** A single quote as PowerShell reads one: the straight one and the four typographic ones. */
const QUOTE = /['\u{2018}\u{2019}\u{201A}\u{201B}]/u;

/**
 * A command line split into its arguments, as PowerShell splits what `formatCommand` writes (and
 * Git Bash too, unless a value has a single quote in it): words apart at spaces, a value in single
 * quotes whole, a backslash in it just a backslash, and a quote inside one written twice. Git Bash
 * reads a doubled quote as a quote dropped (see `splitCommandInGitBash`).
 */
export function splitCommand(line: string): string[] {
  const args: string[] = [];
  let word = "";
  // An empty value, '', is still an argument.
  let started = false;
  let quoted = false;
  for (let at = 0; at < line.length; at++) {
    const char = line.charAt(at);
    if (quoted) {
      if (!QUOTE.test(char)) {
        word += char;
      } else if (QUOTE.test(line.charAt(at + 1))) {
        // Two quotes in a row are one, the second.
        word += line.charAt(at + 1);
        at++;
      } else {
        quoted = false;
      }
    } else if (QUOTE.test(char)) {
      quoted = true;
      started = true;
    } else if (char === " ") {
      if (started) args.push(word);
      word = "";
      started = false;
    } else {
      word += char;
      started = true;
    }
  }
  if (started) args.push(word);
  return args;
}

/**
 * A command line split into its arguments as Git Bash splits it: words apart at spaces, and a
 * straight single quote opening or closing a stretch in which everything is as it is, so a doubled
 * quote (`'O''Brien'`) closes the stretch and opens the next, and no quote is left in the word
 * (`OBrien`). The typographic single quotes are no quotes to Git Bash.
 */
export function splitCommandInGitBash(line: string): string[] {
  const args: string[] = [];
  let word = "";
  let started = false;
  let quoted = false;
  for (const char of line) {
    if (char === "'") {
      quoted = !quoted;
      started = true;
    } else if (char === " " && !quoted) {
      if (started) args.push(word);
      word = "";
      started = false;
    } else {
      word += char;
      started = true;
    }
  }
  if (started) args.push(word);
  return args;
}

/**
 * The arguments of a `npx @icjia/voicecap …` command that voicecap printed: what follows
 * `npx @icjia/voicecap`, which the program is given as its own arguments.
 */
export function argumentsOf(command: string): string[] {
  const [npx, voicecap, ...args] = splitCommand(command);
  if (npx !== "npx" || voicecap !== "@icjia/voicecap") {
    throw new Error(`Not a voicecap command: ${command}`);
  }
  return args;
}
