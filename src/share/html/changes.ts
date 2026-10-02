/**
 * "What changed since the last run", in the approved mockup's markup and class names: what differs
 * between the tools or the passes of the two runs, the line that says how many pages sound
 * different, the pages read in only one of the two runs, and each page that sounds different folded
 * behind one line, which opens to what changed, line by line.
 *
 * What the model or a record supplies goes through `esc`; so does the fixed text (../text.ts), which
 * is plain words, and so does each line worked out from the model (../words.ts), through
 * `lineHtml`. No `style` attribute is set, and nothing here links anywhere. Of the two runs'
 * records the model carries, only their ids are shown.
 *
 * The mockup showed this with one sample page; where it had nothing to say (the tools, the passes,
 * a pass that can't be read, the flags of a page that sounds different), the words are new, and use
 * the mockup's own classes.
 */
import { esc } from "../../report/html.js";
import type { Changes, DiffLine, OnlyInOnePage, PageChange, PassChange } from "../changes.js";
import { pagePath, pageTitle } from "../format.js";
import type { ShareModel } from "../model.js";
import { CHANGES_TEXT, PASS_WORDS } from "../text.js";
import {
  changedRules,
  changesGist,
  countsOf,
  flagsLine,
  onlyInOneLead,
  passHeading,
  sameLines,
  sizesOf,
} from "../words.js";
import { chip, fold, lineHtml, scroll, verdictLine } from "./parts.js";

/**
 * What the line on the two runs says of its folds. The page's alone: a copy that folds nothing, as
 * the Word copy doesn't, has nothing to open (`changesGist`).
 */
const OPEN_A_CHANGE = "A page that sounds different opens to show what changed.";

// Before the line: what could make the runs sound different besides the site.

/** The tools that differ between the two runs, which can make a page sound different alone. */
function toolsNote(tools: string[]): string {
  if (tools.length === 0) return "";
  const items = tools.map((line) => `<li>${esc(line)}</li>`);
  return `<p class="gist">${lineHtml(CHANGES_TEXT.tools())}</p><ul>${items.join("")}</ul>`;
}

/** What each run read, when it wasn't the same, and which passes are compared. */
function passesNote(note: string | null): string {
  return note === null ? "" : `<p class="gist">${esc(note)}</p>`;
}

// After the line.

/**
 * The two runs compared, how many pages sound the same (counted, not shown), and what opens. When
 * no page could be compared (the line says so), nothing was compared, so there is none.
 */
function gistOf(changes: Changes): string {
  const gist = changesGist(changes, OPEN_A_CHANGE);
  return gist === null ? "" : `<p class="gist">${lineHtml(gist)}</p>`;
}

/** The pages that can't be compared, since only one of the two runs read them in full. */
function onlyInOneNote(pages: OnlyInOnePage[]): string {
  if (pages.length === 0) return "";
  const items = pages.map(
    (page) => `<li><b>${esc(pageTitle(page))}</b>: ${esc(CHANGES_TEXT.reasons[page.reason])}.</li>`,
  );
  return `<p class="gist">${lineHtml(onlyInOneLead(pages))}</p><ul>${items.join("")}</ul>`;
}

// A page that sounds different.

/**
 * A chip for each rule whose flag went or came, in words. A rule that another pass still raises
 * (one both runs read, or one only the later run read) isn't resolved for the page, and one it
 * already raised in another pass isn't new: the paragraph inside says each flag, pass by pass.
 */
function flagChips(flags: PageChange["flags"]): string[] {
  const { resolved, fresh } = changedRules(flags);
  return [
    ...resolved.map((rule) => chip("ok", `${rule} ${CHANGES_TEXT.rules.resolved}`)),
    ...fresh.map((rule) => chip("warn", `${rule} ${CHANGES_TEXT.rules.fresh}`)),
  ];
}

/** Each flag in the passes both runs read, in a paragraph; none when no flag is in them. */
function flagsParagraph(flags: PageChange["flags"]): string {
  const line = flagsLine(flags);
  return line === null ? "" : `<p>${lineHtml(line)}</p>`;
}

/** A line's words, those that differ from the line it's paired with in `<mark>`. */
function wordsOf(words: { text: string; changed: boolean }[]): string {
  return words
    .map(({ text, changed }) => (changed ? `<mark>${esc(text)}</mark>` : esc(text)))
    .join("");
}

/**
 * One row of a pass's changes. A removed or added line says so in words, as well as by its class,
 * which the style gives its color: beside the line, for the eye (a screen reader skips that, so
 * nothing is read twice), and in the line itself, for the ear, since a column of lines is read
 * without the column beside it. A run of lines the same is counted.
 */
function rowOf(line: DiffLine): string {
  const { rows } = CHANGES_TEXT;
  switch (line.kind) {
    case "collapsed":
      return `<tr class="same"><td><span aria-hidden="true">${esc(rows.collapsed)}</span></td><td>${esc(sameLines(line.count))}</td></tr>`;
    case "same":
      return `<tr class="same"><td>${esc(rows.same)}</td><td>${esc(line.text)}</td></tr>`;
    case "removed":
      return `<tr class="del"><td><span aria-hidden="true">− ${esc(rows.removed)}</span></td><td><span class="sr">${esc(rows.removed)}: </span>${wordsOf(line.words)}</td></tr>`;
    case "added":
      return `<tr class="add"><td><span aria-hidden="true">+ ${esc(rows.added)}</span></td><td><span class="sr">${esc(rows.added)}: </span>${wordsOf(line.words)}</td></tr>`;
  }
}

/**
 * A pass's changes: its heading, with how many lines, and a table of each line. The page's
 * address is in the heading (for the ear: the fold's line has it for the eye) and in the names of
 * the table and its box, so none is the same as the same pass's on another page.
 */
function passBlock({ pass, removed, added, lines }: PassChange, address: string): string {
  const word = PASS_WORDS[pass];
  const caption = `Changes in the ${word} pass on ${address}`;
  const head = `<h3 class="logh">${esc(passHeading(pass))} <span class="sr">on ${esc(address)}</span> <span class="sub">${esc(sizesOf(removed, added))}</span></h3>`;
  const columns = CHANGES_TEXT.head.map((words) => `<th scope="col">${esc(words)}</th>`);
  const table = `<table class="difftable"><caption class="sr">${esc(caption)}</caption><thead><tr>${columns.join("")}</tr></thead><tbody>${lines.map(rowOf).join("")}</tbody></table>`;
  return `<div>${head}${scroll(`${caption}, table`, table)}</div>`;
}

/**
 * A page that sounds different, folded behind its name, how many lines changed, and the flags that
 * went or came. Inside: each pass's changes, any pass that sounds different but whose transcript
 * can't be read, and each flag. Heard, the counts end before the chips start, and each chip is said
 * apart from the next, with stops a screen reader hears and the eye doesn't see.
 */
function changeFold(page: PageChange): string {
  const title = pageTitle(page);
  const chips = flagChips(page.flags);
  const counts = `<span class="sub">${esc(countsOf(page))}</span>`;
  const summary = [
    `<span class="what">${esc(title)}:</span>`,
    chips.length === 0
      ? counts
      : `${counts}<span class="sr">.</span> <span class="chips">${chips.join('<span class="sr">,</span> ')}</span>`,
  ];
  const body = [
    ...page.passes.map((change) => passBlock(change, pagePath(page.url))),
    ...page.unreadable.map((pass) => `<p>${esc(CHANGES_TEXT.unreadable(pass))}</p>`),
    flagsParagraph(page.flags),
  ];
  return fold(summary.join(" "), body.join(""));
}

/**
 * "What changed since the last run". With no run before, there is nothing to compare, and it says
 * so; the heading is there all the same, for the page's contents to link to.
 */
export function renderChanges(model: ShareModel): string {
  const { changes } = model;
  const parts =
    changes === null
      ? [`<p class="gist">${lineHtml([{ text: CHANGES_TEXT.none, bold: true }])}</p>`]
      : [
          toolsNote(changes.tools),
          passesNote(changes.passesNote),
          verdictLine(changes.line),
          gistOf(changes),
          onlyInOneNote(changes.onlyInOne),
          changes.changed.length === 0
            ? ""
            : `<div class="folds">${changes.changed.map(changeFold).join("")}</div>`,
        ];
  const all = [`<h2 id="chg-h">${esc(CHANGES_TEXT.title)}</h2>`, ...parts];
  return `<section aria-labelledby="chg-h">\n  ${all.filter((part) => part !== "").join("\n  ")}\n</section>`;
}
