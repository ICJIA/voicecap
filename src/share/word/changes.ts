/**
 * The Word copy's "What changed since the last run", as blocks (./blocks.ts). It says the words of
 * the page's renderer (../html/changes.ts) in the same order: the fixed ones come from ../text.ts
 * and the ones worked out from the model from ../words.ts, so the two copies can't say different
 * things. It has no words of its own: the heads of its tables are the page's.
 *
 * The Word copy folds nothing. Each page that sounds different is a heading 2 with what its fold
 * holds under it, and the line on the two runs gives no sentence about opening a page. Where the
 * page's fold line has a chip for each rule whose flag went or came, the Word copy has one line of
 * them under the heading; where the page marks a line removed or added with a sign and a color, this
 * says it in the first column, and sets the changed words in bold. It leaves out the words the page
 * says for a screen reader alone, which the headings and the first column say in view. Pure.
 */
import type {
  Changes,
  DiffLine,
  DiffWord,
  OnlyInOnePage,
  PageChange,
  PassChange,
} from "../changes.js";
import { pagePath, pageTitle } from "../format.js";
import { firstSentenceBold, type Inline, type Line } from "../line.js";
import type { ShareModel } from "../model.js";
import { CHANGES_TEXT } from "../text.js";
import {
  changedRules,
  changesGist,
  countsOf,
  flagsLine,
  onlyInOneLead,
  onPage,
  passHeading,
  sameLines,
  sizesOf,
} from "../words.js";
import { heading, list, para, table, type Block } from "./blocks.js";

// Before the line: what could make the runs sound different besides the site.

/** The tools that differ between the two runs: their lead, and a list of each. None when none. */
function toolsBlocks(tools: string[]): Block[] {
  return tools.length === 0 ? [] : [para(...CHANGES_TEXT.tools()), list(tools)];
}

/** What each run read, when it wasn't the same, and which passes are compared. */
function passesBlocks(note: string | null): Block[] {
  return note === null ? [] : [para(note)];
}

// After the line.

/**
 * The two runs compared, and how many pages sound the same (counted, not shown). It has no sentence
 * about opening a page, which the page adds. None when nothing was compared.
 */
function gistBlocks(changes: Changes): Block[] {
  const gist = changesGist(changes);
  return gist === null ? [] : [para(...gist)];
}

/**
 * The pages that can't be compared, since only one of the two runs read them in full: the lead, and a
 * list of each page's name in bold with its reason.
 */
function onlyInOneBlocks(pages: OnlyInOnePage[]): Block[] {
  if (pages.length === 0) return [];
  const items = pages.map((page): Line => [
    { text: pageTitle(page), bold: true },
    `: ${CHANGES_TEXT.reasons[page.reason]}.`,
  ]);
  return [para(...onlyInOneLead(pages)), list(items)];
}

// A page that sounds different.

/**
 * The rules whose flag went or came on a page, on one line, as the page's chips say them: each rule's
 * name in the fixed-width font and what became of it, the resolved first ("generic-link-text
 * resolved; headings new"). A rule that another pass still raises isn't resolved for the page, and
 * one it already raised in another pass isn't new (`changedRules`); the line of flags says each, pass
 * by pass. None when no rule went or came.
 */
function ruleChanges(flags: PageChange["flags"]): Line | null {
  const { resolved, fresh } = changedRules(flags);
  const rules = [
    ...resolved.map((rule): Line => [
      { text: rule, mono: true },
      ` ${CHANGES_TEXT.rules.resolved}`,
    ]),
    ...fresh.map((rule): Line => [{ text: rule, mono: true }, ` ${CHANGES_TEXT.rules.fresh}`]),
  ];
  if (rules.length === 0) return null;
  return rules.flatMap((rule, at) => (at === 0 ? rule : ["; ", ...rule]));
}

/** A line's words, those that differ from the line it's paired with in bold. */
function markedWords(words: DiffWord[]): Line {
  return words.map(({ text, changed }): Inline => (changed ? { text, bold: true } : text));
}

/**
 * One row of a pass's table: what became of the line, in words, and the line. A line removed or
 * added says so in its first cell, as well as in the bold of its changed words, since a printed copy
 * may have no color to show it. A run of lines the same is counted.
 */
function rowOf(line: DiffLine): (string | Line)[] {
  const { rows } = CHANGES_TEXT;
  switch (line.kind) {
    case "collapsed":
      return [rows.collapsed, sameLines(line.count)];
    case "same":
      return [rows.same, line.text];
    case "removed":
      return [rows.removed, markedWords(line.words)];
    case "added":
      return [rows.added, markedWords(line.words)];
  }
}

/**
 * A pass's changes: a heading that says the pass, the page's address, and how many lines, then a
 * table of each line. The address is there so no heading is the same as the same pass's on another
 * page.
 */
function passBlocks({ pass, removed, added, lines }: PassChange, address: string): Block[] {
  return [
    heading(3, `${passHeading(pass)} ${onPage(address)}: ${sizesOf(removed, added)}`),
    table(CHANGES_TEXT.head, lines.map(rowOf), [14, 86]),
  ];
}

/**
 * A page that sounds different: its name and how many lines changed in each pass, as a heading; the
 * rules whose flag went or came; each pass's changes; each pass that sounds different but whose
 * transcript can't be read; and each flag.
 */
function pageBlocks(page: PageChange): Block[] {
  const rules = ruleChanges(page.flags);
  const flags = flagsLine(page.flags);
  return [
    heading(2, `${pageTitle(page)}: ${countsOf(page)}`),
    ...(rules === null ? [] : [para(...rules)]),
    ...page.passes.flatMap((change) => passBlocks(change, pagePath(page.url))),
    ...page.unreadable.map((pass) => para(CHANGES_TEXT.unreadable(pass))),
    ...(flags === null ? [] : [para(...flags)]),
  ];
}

/**
 * "What changed since the last run": the tools and passes that differ, the section's line (its first
 * sentence in bold), the two runs compared, the pages read in only one of them, and each page that
 * sounds different. With no run before, there is nothing to compare, and it says so.
 */
export function wordChanges(model: ShareModel): Block[] {
  const { changes } = model;
  const title = heading(1, CHANGES_TEXT.title);
  if (changes === null) return [title, para({ text: CHANGES_TEXT.none, bold: true })];
  return [
    title,
    ...toolsBlocks(changes.tools),
    ...passesBlocks(changes.passesNote),
    para(...firstSentenceBold(changes.line)),
    ...gistBlocks(changes),
    ...onlyInOneBlocks(changes.onlyInOne),
    ...changes.changed.flatMap(pageBlocks),
  ];
}
