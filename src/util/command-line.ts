/**
 * A command line to show a person, ready to paste into PowerShell or Git Bash: `init` prints the
 * command that reproduces its answers this way, and a warning names the command to run next.
 */

/** Characters a value can contain and still be left unquoted. */
const UNQUOTED = /^[A-Za-z0-9_./:@%+,=-]*$/;

/**
 * Quote a value for display as part of a shell command: wrapped in single quotes only when it
 * contains a character outside `A-Z a-z 0-9 _ . / : @ % + , = -`, with any `'` inside becoming
 * `'\''`. An empty value is always quoted as `''`: left bare, it disappears as a shell token in
 * both Git Bash and PowerShell, shifting every later argument into the wrong option. Correct in
 * Git Bash, and in PowerShell unless the value contains a single quote.
 */
export function quoteArg(value: string): string {
  if (value !== "" && UNQUOTED.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** The copy-pasteable `npx @icjia/voicecap …` command line for a command's arguments. */
export function formatCommand(args: readonly string[]): string {
  return "npx @icjia/voicecap " + args.map(quoteArg).join(" ");
}
