/** Where `init` found the pages, as its second question answers it. */
export type PageChoice =
  | { kind: "sitemap"; url: string }
  | { kind: "pages"; file: string }
  | { kind: "page"; url: string };

/**
 * `init`'s answers, ready to become a run's command-line arguments. `canonical` is the root of the
 * address people visit, when `init` had to ask for it, to write with `--canonical`; null leaves
 * `--canonical` out, and the run takes the address from the site's own pages. `home` is the
 * transcripts home to write with `--out`; null means it matches the home already in effect, so
 * `--out` is left out. `reviewer` is the name each session of the run records.
 */
export interface InitAnswers {
  site: string;
  canonical: string | null;
  pages: PageChoice;
  limit: number | null;
  home: string | null;
  reviewer: string;
}

/**
 * Turn `init`'s answers into the run options that reproduce them: `--site`, `--canonical` when
 * `canonical` isn't null, the page source (`--sitemap`, `--pages`, or `--page`), `--limit` when a
 * number was given, `--out` when `home` isn't null, and `--reviewer` last, where it's easy to find
 * and change for someone else.
 */
export function composeArgs(answers: InitAnswers): string[] {
  const args = ["--site", answers.site];
  if (answers.canonical !== null) args.push("--canonical", answers.canonical);
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

// Used beyond `init` now (a warning names the command to run next), so they live in util/. `init`
// and its tests have them here, beside `composeArgs`, as before.
export { formatCommand, quoteArg } from "../util/command-line.js";
