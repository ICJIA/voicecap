/**
 * The verdict: what a share's result says in words and in kind. It is one rule for every place that
 * says it: the page's At a glance, its Word copy, and the website's card. It works from the four
 * counts of a result (`ShareModel.result`, which `voicecap share` records as the share's `result`),
 * so the copies and the website can't say different things of the same share. Pure.
 *
 * The kind is `bad` when NVDA read fewer pages than are in scope, whether a page couldn't be read or
 * was skipped; else `warn` when something needs attention; else `ok`. The headline says the same in
 * words, so a reader never has the kind alone to go by. The words are the page's, in
 * `ATTENTION_TEXT` (./text.ts), where every other word of the page is.
 */
import type { ShareResult } from "../model.js";
import { ATTENTION_TEXT } from "./text.js";

/** `ok` when nothing needs attention, `warn` when something does, `bad` when pages weren't all read. */
export type VerdictKind = "ok" | "warn" | "bad";

export interface Verdict {
  kind: VerdictKind;
  /** The verdict in words, with no full stop: "2 problems need attention, on 1 page". */
  headline: string;
}

/**
 * The verdict of a result. With a problem, its headline counts the problems (every card of What
 * needs attention) and the pages they're on; with none, it says that nothing needs attention, and,
 * when some page wasn't read, that this is of the pages read. A result of no page says "Nothing
 * needs attention" too, so a caller shows no verdict for a site with no page.
 */
export function verdictOf({ pages, read, problems, problemPages }: ShareResult): Verdict {
  const kind: VerdictKind = read < pages ? "bad" : problems > 0 ? "warn" : "ok";
  if (problems > 0) return { kind, headline: ATTENTION_TEXT.headline(problems, problemPages) };
  return { kind, headline: read === pages ? ATTENTION_TEXT.nothing : ATTENTION_TEXT.nothingOnRead };
}
