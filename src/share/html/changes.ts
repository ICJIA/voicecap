/**
 * "What changed since the last run", in the approved mockup's markup and class names: what differs
 * between the tools or the passes of the two runs, the line that says how many pages sound
 * different, the pages read in only one of the two runs, and each page that sounds different folded
 * behind one line, which opens to what changed, line by line.
 *
 * What the model or a record supplies goes through `esc`; the page's own static words are written
 * as they are. No `style` attribute is set, and nothing here links anywhere. Of the two runs'
 * records the model carries, only their ids are shown.
 *
 * The mockup showed this with one sample page; where it had nothing to say (the tools, the passes,
 * a pass that can't be read, the flags of a page that sounds different), the words are new, and use
 * the mockup's own classes.
 */
import { PASS_NAMES, type FlagResult, type PassName } from "../../model.js";
import { esc, plural } from "../../report/html.js";
import { attentionClauses } from "../attention.js";
import type { Changes, DiffLine, OnlyInOnePage, PageChange, PassChange } from "../changes.js";
import { pagePath, pageTitle } from "../format.js";
import type { ShareModel } from "../model.js";
import { chip, count, fold, scroll, verdictLine } from "./parts.js";

/** What a pass is called in a sentence. */
const PASS_WORDS: Record<PassName, string> = { read: "read", headings: "headings", tab: "Tab" };

/**
 * What a pass lost and gained, as a reader says it: "3 lines removed and 2 added", and, for a pass
 * that only lost or only gained lines, "1 line removed" or "2 lines added", not "and 0 added".
 */
function sizesOf(removed: number, added: number): string {
  if (removed === 0 && added === 0) return "no lines removed or added";
  if (added === 0) return `${plural(removed, "line")} removed`;
  if (removed === 0) return `${plural(added, "line")} added`;
  return `${plural(removed, "line")} removed and ${count(added)} added`;
}

// Before the line: what could make the runs sound different besides the site.

/** The tools that differ between the two runs, which can make a page sound different alone. */
function toolsNote(tools: string[]): string {
  if (tools.length === 0) return "";
  const items = tools.map((line) => `<li>${esc(line)}</li>`);
  return `<p class="gist"><b>The tools differ between the two runs,</b> so anything that sounds different may come from the tools rather than the site:</p><ul>${items.join("")}</ul>`;
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
function gistOf({ before, after, same, changed }: Changes): string {
  if (same === 0 && changed.length === 0) return "";
  const sentences = [
    `Compared: run <code>${esc(before.id)}</code> (before) and run <code>${esc(after.id)}</code> (latest).`,
    ...(same === 0
      ? []
      : [
          `${plural(same, "page")} ${same === 1 ? "sounds" : "sound"} the same, and ${same === 1 ? "is" : "are"} counted, not shown.`,
        ]),
    ...(changed.length === 0 ? [] : ["A page that sounds different opens to show what changed."]),
  ];
  return `<p class="gist">${sentences.join(" ")}</p>`;
}

/** Why a page is in only one of the two runs, in words that follow the model's reason. */
const REASONS: Record<OnlyInOnePage["reason"], string> = {
  new: "new, not in the run before",
  "no longer listed": "no longer listed, not in the latest run",
  "failed in one run": "failed in one run, read in full in the other",
  "skipped in one run": "skipped in one run, read in full in the other",
};

/** The pages that can't be compared, since only one of the two runs read them in full. */
function onlyInOneNote(pages: OnlyInOnePage[]): string {
  if (pages.length === 0) return "";
  const one = pages.length === 1;
  const items = pages.map(
    (page) => `<li><b>${esc(pageTitle(page))}</b>: ${REASONS[page.reason]}.</li>`,
  );
  return `<p class="gist"><b>${plural(pages.length, "page")} ${one ? "was" : "were"} read in full in only one of the two runs,</b> so ${one ? "it wasn't" : "they weren't"} compared:</p><ul>${items.join("")}</ul>`;
}

// A page that sounds different.

/**
 * How much a page changed, for its fold's line: each pass that sounds different, in pass order,
 * with the lines it lost and gained, or that its transcript couldn't be read here, so no count is
 * known. "read: 3 lines removed and 2 added; headings: couldn't be read here; Tab: 1 line removed".
 * ("Here", since a pass named "read" that couldn't be read would say "read" twice over.)
 */
function countsOf({ passes, unreadable }: PageChange): string {
  const clauses = PASS_NAMES.flatMap((pass) => {
    const change = passes.find((each) => each.pass === pass);
    if (change !== undefined) {
      return [`${PASS_WORDS[pass]}: ${sizesOf(change.removed, change.added)}`];
    }
    return unreadable.includes(pass) ? [`${PASS_WORDS[pass]}: couldn't be read here`] : [];
  });
  return clauses.join("; ");
}

/**
 * A chip for each rule whose flag went or came, in words. A rule that another pass still raises
 * (one both runs read, or one only the later run read) isn't resolved for the page, and one it
 * already raised in another pass isn't new: the paragraph inside says each flag, pass by pass.
 */
function flagChips({ resolved, added, unchanged, changed, uncompared }: PageChange["flags"]) {
  const rulesOf = (flags: FlagResult[]) => new Set(flags.map(({ rule }) => rule));
  const gone = rulesOf(resolved);
  const came = rulesOf(added);
  const kept = rulesOf([...unchanged, ...changed.map(({ after }) => after)]);
  const stillRaised = rulesOf(uncompared);
  return [
    ...[...gone]
      .filter((rule) => !kept.has(rule) && !came.has(rule) && !stillRaised.has(rule))
      .map((rule) => chip("ok", `${rule} resolved`)),
    ...[...came]
      .filter((rule) => !kept.has(rule) && !gone.has(rule))
      .map((rule) => chip("warn", `${rule} new`)),
  ];
}

/**
 * Each flag in the passes both runs read: resolved, then new, then changed, then unchanged. A flag
 * whose count changed gives both counts; one with no count, what it finds now, in plain words.
 */
function flagsParagraph({ resolved, added, changed, unchanged }: PageChange["flags"]): string {
  const which = (flag: FlagResult) =>
    `<b>${esc(flag.rule)}</b>${flag.pass === undefined ? "" : ` (${PASS_WORDS[flag.pass]} pass)`}`;
  const clauses = [
    ...resolved.map(
      (flag) =>
        `${which(flag)}, ${flag.count === undefined ? "" : `${count(flag.count)} before, `}none now (resolved).`,
    ),
    ...added.map(
      (flag) =>
        `${which(flag)}, none before, ${flag.count === undefined ? "new" : `${count(flag.count)} now (new)`}.`,
    ),
    ...changed.map(({ before, after }) =>
      before.count !== undefined && after.count !== undefined
        ? `${which(after)}, ${count(before.count)} before, ${count(after.count)} now (changed).`
        : `${which(after)}, changed: now ${esc(attentionClauses([after], null, null))}.`,
    ),
    ...unchanged.map((flag) => `${which(flag)}, unchanged.`),
  ];
  return clauses.length === 0 ? "" : `<p>Flags: ${clauses.join(" ")}</p>`;
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
  switch (line.kind) {
    case "collapsed":
      return `<tr class="same"><td><span aria-hidden="true">…</span></td><td>${plural(line.count, "line")} the same</td></tr>`;
    case "same":
      return `<tr class="same"><td>Same</td><td>${esc(line.text)}</td></tr>`;
    case "removed":
      return `<tr class="del"><td><span aria-hidden="true">− Removed</span></td><td><span class="sr">Removed: </span>${wordsOf(line.words)}</td></tr>`;
    case "added":
      return `<tr class="add"><td><span aria-hidden="true">+ Added</span></td><td><span class="sr">Added: </span>${wordsOf(line.words)}</td></tr>`;
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
  const head = `<h3 class="logh">The ${word} pass <span class="sr">on ${esc(address)}</span> <span class="sub">${sizesOf(removed, added)}</span></h3>`;
  const columns = ["Change", "What NVDA said"].map((words) => `<th scope="col">${words}</th>`);
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
    ...page.unreadable.map(
      (pass) =>
        `<p>The ${PASS_WORDS[pass]} pass sounds different, but its transcript couldn't be read here.</p>`,
    ),
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
      ? [`<p class="gist"><b>No earlier run with the same pages to compare with.</b></p>`]
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
  const all = [`<h2 id="chg-h">What changed since the last run</h2>`, ...parts];
  return `<section aria-labelledby="chg-h">\n  ${all.filter((part) => part !== "").join("\n  ")}\n</section>`;
}
