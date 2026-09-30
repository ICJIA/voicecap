/** Where `init` found the pages, as its second question answers it. */
export type PageChoice =
  | { kind: "sitemap"; url: string }
  | { kind: "pages"; file: string }
  | { kind: "page"; url: string };

/**
 * `init`'s answers, ready to become a run's command-line arguments. `home` is the transcripts
 * home to write with `--out`; null means it matches the home already in effect, so `--out` is
 * left out. `reviewer` is the name each session of the run records.
 */
export interface InitAnswers {
  site: string;
  pages: PageChoice;
  limit: number | null;
  home: string | null;
  reviewer: string;
}

/**
 * Turn `init`'s answers into the run options that reproduce them: `--site`, the page source
 * (`--sitemap`, `--pages`, or `--page`), `--limit` when a number was given, `--out` when `home`
 * isn't null, and `--reviewer` last, where it's easy to find and change for someone else.
 */
export function composeArgs(answers: InitAnswers): string[] {
  const args = ["--site", answers.site];
  switch (answers.pages.kind) {
    case "sitemap":
      args.push("--sitemap", answers.pages.url);
      break;
    case "pages":
      args.push("--pages", answers.pages.file);
      break;
    case "page":
      args.push("--page", answers.pages.url);
      break;
  }
  if (answers.limit !== null) args.push("--limit", String(answers.limit));
  if (answers.home !== null) args.push("--out", answers.home);
  args.push("--reviewer", answers.reviewer);
  return args;
}

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

/** The copy-pasteable `npx @icjia/voicecap …` command line for a run's arguments. */
export function formatCommand(args: readonly string[]): string {
  return "npx @icjia/voicecap " + args.map(quoteArg).join(" ");
}
