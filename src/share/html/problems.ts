/**
 * "Problems during the runs", in the approved mockup's markup and class names: the verdict line,
 * then each failed attempt folded behind its run, its page, when it happened, what kind of problem
 * it was, and whether it happened again, and last the folded table of how voicecap tells the kinds
 * apart. A problem opens to what happened, what voicecap did, whether it happened again, and the
 * effect on the results, then the record of it word for word (and the stack, for an error voicecap
 * didn't expect), and what the run didn't record.
 *
 * What the model or a record supplies goes through `esc`; the page's own static words are written
 * as they are. No `style` attribute is set. The model has already replaced the home folder in every
 * message, entry, and stack. The only link is to where an error voicecap didn't expect can be
 * reported.
 *
 * The mockup showed this with two sample problems (and sample event lines from a log that voicecap
 * doesn't record yet, which are never here). Where it had nothing to say (the record of a problem
 * with no time, the stack, how the kind was decided), the words are new, and use the mockup's own
 * classes.
 */
import { esc, idFragment } from "../../report/html.js";
import { clock, pagePath, pageTitle } from "../format.js";
import type { ShareModel } from "../model.js";
import { KIND_ROWS, type Problem, type ProblemKind } from "../problems.js";
import { chip, fold, notRecorded, scroll, verdictLine } from "./parts.js";

/** Where a problem in voicecap itself is reported. */
const ISSUES = "https://github.com/ICJIA/voicecap/issues";
const ISSUES_TEXT = "github.com/ICJIA/voicecap/issues";

/** What each kind of problem is called: the table of kinds' own words. */
const KIND_TITLES = new Map(KIND_ROWS.map((row) => [row.kind, row.title]));

/** Whether a problem happened again, in a chip: its words, and its color's kind. */
const AGAIN: Record<Problem["again"], { kind: string; words: string }> = {
  no: { kind: "ok", words: "Didn't happen again" },
  same: { kind: "bad", words: "Happened again" },
  different: { kind: "bad", words: "Happened again, in different ways" },
  unknown: { kind: "warn", words: "Not tried again" },
};

/** Text that ends as a sentence does: voicecap's "did" lines have no full stop of their own. */
function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/** The time of day in an ISO time, to the millisecond when it has them: "14:05:10.000". */
function timeOfDay(iso: string): string {
  return /T(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/.exec(iso)?.[1] ?? iso;
}

const row = (term: string, said: string): string => `<dt>${term}</dt><dd>${said}</dd>`;

/** Why a run's problems have no cause code to read their kind from. */
const BEFORE_CAUSES = "this run was recorded before voicecap noted a cause for each failure";

/**
 * How the kind of a problem from an older run's wording was decided, which is not the same for
 * every kind (src/share/problems.ts reads the wording): most are voicecap's own words; "unreachable"
 * is Chrome's network error code; and "unexpected" is by exclusion, the wording being one voicecap
 * doesn't recognize, which is nothing it can say of the error itself.
 */
function decidedFrom(kind: ProblemKind): string {
  switch (kind) {
    case "unexpected":
      return `voicecap didn't recognize this error's wording, so it counts as unexpected: ${BEFORE_CAUSES}.`;
    case "unreachable":
      return "From the browser's own network error code in the error's wording.";
    default:
      return `From the error's own wording, which voicecap wrote: ${BEFORE_CAUSES}.`;
  }
}

const REPORT = `This could be a problem in voicecap itself. Please report it, with this record, at <a href="${ISSUES}">${ISSUES_TEXT}</a>.`;

/** What happened, what voicecap did, whether it happened again, and the effect on the results. */
function questions(problem: Problem): string {
  const rows = [
    row("What happened", esc(sentence(problem.happened))),
    ...(problem.fromWording
      ? [row("How the kind was decided", esc(decidedFrom(problem.kind)))]
      : []),
    row("What voicecap did", esc(sentence(problem.did))),
    row("Did it happen again?", esc(sentence(problem.verdict))),
    row("Effect on the results", esc(sentence(problem.effect))),
    ...(problem.kind === "unexpected" ? [row("Report it", REPORT)] : []),
  ];
  return `<dl class="qa">${rows.join("")}</dl>`;
}

/**
 * The record of a problem, word for word, as a table of its time, its source, and its entry. A
 * stack is shown apart (see `stackBox`), where its lines can be read. A time the run didn't record
 * says so, never a blank.
 */
function recordBox(problem: Problem, where: string): string {
  const rows = problem.record
    .filter((entry) => entry.source !== "stack")
    .map(
      (entry) =>
        `<tr><td class="lt">${entry.time === null ? "Not recorded" : esc(timeOfDay(entry.time))}</td><td class="src">${esc(entry.source)}</td><td><code>${esc(entry.entry)}</code></td></tr>`,
    );
  const columns = ["Time", "From", "What was recorded"].map(
    (words) => `<th scope="col">${words}</th>`,
  );
  const table = `<table class="logtable"><caption class="sr">The record of this problem</caption><thead><tr>${columns.join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
  return `<div><h3 class="logh">The record of this problem, word for word <span class="sr">${esc(where)}</span></h3>${scroll(`The record of the problem ${where}, table`, table)}</div>`;
}

/** Where in voicecap's code an error voicecap didn't expect happened, in a box that scrolls. */
function stackBox(stack: string, where: string): string {
  const title = `Where in voicecap's code it happened ${where}`;
  return `<div><h3 class="logh">Where in voicecap's code it happened <span class="sr">${esc(where)}</span></h3>${scroll(title, `<pre class="logblock">${esc(stack)}</pre>`)}</div>`;
}

/**
 * Which problem, for the headings and the box names inside its fold, which a screen reader gets
 * apart from the fold's line: the page's address and the run, and the attempt, or the problem's
 * place among the page's in the run (a run recorded as text may not number them). No two have the
 * same words.
 */
function whereOf(problem: Problem, nth: number): string {
  const which = problem.n !== null ? `, attempt ${problem.n}` : nth > 1 ? `, problem ${nth}` : "";
  return `on ${pagePath(problem.page.url)} in run ${problem.run}${which}`;
}

/**
 * A problem's fold: its line says which, when, what kind, and whether it came again. `nth` is
 * its place among the page's problems in the run, from 1.
 */
function problemFold(problem: Problem, id: string, nth: number): string {
  const title = pageTitle(problem.page);
  const where = whereOf(problem, nth);
  const when = problem.endedAt ?? problem.startedAt;
  const kind = KIND_TITLES.get(problem.kind) ?? problem.kind;
  const again = AGAIN[problem.again];
  const chips = [
    chip(problem.kind === "unexpected" ? "bad" : "warn", kind),
    chip(again.kind, again.words),
  ];
  const summary = [
    `<span class="what">Run ${esc(problem.run)} · ${esc(title)}</span>`,
    `<span class="sub">${when === null ? "time not recorded" : esc(clock(when))}</span>`,
    `<span class="chips">${chips.join(" ")}</span>`,
  ];
  const body = [
    questions(problem),
    recordBox(problem, where),
    ...(problem.stack === null ? [] : [stackBox(problem.stack, where)]),
    ...(problem.notRecorded.length === 0
      ? []
      : [`<div>${problem.notRecorded.map(notRecorded).join("")}</div>`]),
  ];
  return fold(summary.join(" "), body.join(""), { id, className: "problem" });
}

/** A kind's meaning, with the address where an error voicecap didn't expect is reported a link. */
function meaningOf(text: string): string {
  return esc(text).replace(ISSUES_TEXT, `<a href="${ISSUES}">${ISSUES_TEXT}</a>`);
}

/** "How voicecap tells causes apart": each kind, whose it is, and what voicecap does about it. */
function kindsFold(): string {
  const rows = KIND_ROWS.map(
    (kind) =>
      `<tr><th scope="row">${esc(kind.title)}</th><td>${esc(kind.whose)}</td><td>${meaningOf(kind.meaning)}</td></tr>`,
  );
  const columns = ["What happened", "Whose it is", "What voicecap does, and what it means"].map(
    (words) => `<th scope="col">${words}</th>`,
  );
  const table = `<table class="plain"><caption class="sr">Kinds of problem</caption><thead><tr>${columns.join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
  const summary = `<span class="what">How voicecap tells causes apart</span> <span class="sub">${KIND_ROWS.length} kinds of problem, and whose each is</span>`;
  return fold(summary, scroll("Kinds of problem, table", table), { className: "kinds" });
}

/** What the section says of what's in it, when something is. */
const GIST =
  "Every attempt that failed in the runs these results come from is here, with what voicecap recorded about it, word for word: what happened, what voicecap did, whether it happened again, and what it means for the results.";

/**
 * "Problems during the runs": the verdict line, a fold for each problem, oldest first, and the
 * table of kinds. Each problem's fold has an id of its run and its page (and a number after the
 * first, when a page has more in a run), so a link can point to it.
 */
export function renderProblems(model: ShareModel): string {
  const { problems, line } = model.problems;
  const seen = new Map<string, number>();
  const folds = problems.map((problem) => {
    const base = `prob-${idFragment(problem.run)}-${idFragment(problem.page.slug)}`;
    const nth = (seen.get(base) ?? 0) + 1;
    seen.set(base, nth);
    return problemFold(problem, nth === 1 ? base : `${base}-${nth}`, nth);
  });
  const parts = [
    `<h2 id="prob-h">Problems during the runs</h2>`,
    verdictLine(line),
    ...(problems.length === 0 ? [] : [`<p class="gist">${GIST}</p>`]),
    `<div class="folds">${[...folds, kindsFold()].join("")}</div>`,
  ];
  return `<section aria-labelledby="prob-h">\n  ${parts.join("\n  ")}\n</section>`;
}
