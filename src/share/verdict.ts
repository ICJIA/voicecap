/**
 * The verdict: what a share's result says in words and in kind. It is one rule for every place that
 * says it: the page's At a glance, its Word copy, and the website's card. It works from the four
 * counts of a result (`ShareModel.result`, which `voicecap share` records as the share's `result`),
 * so the copies and the website can't say different things of the same share. Pure.
 *
 * The kind is `bad` when NVDA read fewer pages than are in scope, whether a page couldn't be read or
 * was skipped; else `warn` when something needs attention; else `ok`. The headline says the same in
 * words, so a reader never has the kind alone to go by.
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

/** The headline when no problem is left and NVDA read every page. */
const NOTHING = "Nothing needs attention";

/**
 * The headline when no problem is left but NVDA didn't read every page. A page that wasn't read is
 * on no card when voicecap skipped it, so nothing needs attention on the pages that were read.
 */
const NOTHING_ON_PAGES_READ = "Nothing needs attention on the pages read";

/**
 * The verdict of a result. With a problem, its headline counts the problems (every card of What
 * needs attention) and the pages they're on; with none, it says that nothing needs attention, and,
 * when some page wasn't read, that this is of the pages read. A result of no page says "Nothing
 * needs attention" too, so a caller shows no verdict for a site with no page.
 */
export function verdictOf({ pages, read, problems, problemPages }: ShareResult): Verdict {
  const kind: VerdictKind = read < pages ? "bad" : problems > 0 ? "warn" : "ok";
  if (problems > 0) return { kind, headline: ATTENTION_TEXT.headline(problems, problemPages) };
  return { kind, headline: read === pages ? NOTHING : NOTHING_ON_PAGES_READ };
}
