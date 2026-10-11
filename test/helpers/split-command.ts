/**
 * A command line, as `formatCommand` writes it, split into its arguments the way a shell splits it,
 * without starting one: so a test can take a command voicecap printed for a person to paste and give
 * its arguments to voicecap, to see that the command it printed is one voicecap takes.
 */

/**
 * A command line split into its arguments, as Git Bash splits what `formatCommand` writes (and
 * PowerShell too, unless a value has a single quote in it): words apart at spaces, a value in
 * single quotes whole, a backslash in it just a backslash, and `'\''` for a single quote inside one.
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
      if (char === "'") quoted = false;
      else word += char;
    } else if (char === "'") {
      quoted = true;
      started = true;
    } else if (char === "\\" && line.charAt(at + 1) === "'") {
      word += "'";
      started = true;
      at++;
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
