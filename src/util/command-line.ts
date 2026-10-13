/**
 * A command line to show a person, ready to paste into PowerShell or Git Bash (or a Mac's
 * terminal): `init` prints the command that reproduces its answers this way, and a warning names
 * the command to run next.
 *
 * Some of what goes into one is the audited site's own words: a sitemap's address, from its
 * robots.txt, or the root of its canonical address. So a value is written so that neither shell
 * reads anything in it as more than the value, whatever it holds.
 */

/**
 * Characters a value can contain and still be left unquoted. A comma is not one of them: PowerShell
 * reads an unquoted `a,b` as two arguments.
 */
const UNQUOTED = /^[A-Za-z0-9_./:@%+=-]*$/;

/** A single quote as PowerShell reads one: the straight one, and four typographic ones. */
const SINGLE_QUOTE = /['\u{2018}\u{2019}\u{201A}\u{201B}]/gu;

/**
 * Quote a value for display as part of a shell command, so that PowerShell and Git Bash both read
 * one argument and neither reads a command in it.
 *
 * A value is left bare only when it is not empty, holds nothing outside `A-Z a-z 0-9 _ . / : @ % +
 * = -`, and does not start with `@`, which PowerShell reads as a variable (`@x`), a hash, or an
 * array. Any other value goes in single quotes, where neither shell expands anything, with each
 * single quote inside doubled, as PowerShell reads it: `'O''Brien'`. PowerShell takes the
 * typographic single quotes (U+2018, U+2019, U+201A, U+201B) for quotes too, so they are doubled as
 * well (as `powershellString` does, in the Windows driver).
 *
 * Git Bash reads a doubled quote as a quote left out (`OBrien`), and a typographic quote as an
 * ordinary character, which is doubled. That is a value a little different from the one given, never
 * a command: the quotes still open and close in pairs, so nothing in the value is outside them. An
 * address has no quote to read, since `urlArg` writes it `%27`.
 *
 * An empty value is always quoted as `''`: left bare, it disappears as a shell token in both
 * shells, shifting every later argument into the wrong option.
 */
export function quoteArg(value: string): string {
  if (value !== "" && UNQUOTED.test(value) && !value.startsWith("@")) return value;
  return `'${value.replace(SINGLE_QUOTE, "$&$&")}'`;
}

/**
 * A web address for a command line, with each single quote in it written `%27`, which a URL reads
 * as the same quote. An address is the one value that can be written without a quote that a shell
 * would read, so it reads the same in PowerShell and in Git Bash, and `quoteArg` leaves it bare
 * when nothing else in it needs quotes.
 */
export function urlArg(url: string): string {
  return url.replaceAll("'", "%27");
}

/** The copy-pasteable `npx @icjia/voicecap …` command line for a command's arguments. */
export function formatCommand(args: readonly string[]): string {
  return "npx @icjia/voicecap " + args.map(quoteArg).join(" ");
}
