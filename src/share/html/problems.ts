/**
 * "Problems during the runs", in the approved mockup's markup and class names: the verdict line,
 * then each failed attempt folded behind its run, its page, when it happened, what kind of problem
 * it was, and whether it happened again, and last the folded table of how voicecap tells the kinds
 * apart. A problem opens to what happened, what voicecap did, whether it happened again, and the
 * effect on the results, then the record of it word for word (and the stack, for an error voicecap
 * didn't expect), and what the run didn't record.
 *
 * What the model or a record supplies goes through `esc`; so does the fixed text (../text.ts), which
 * is plain words, and so does each sentence worked out from the model (../words.ts). No `style`
 * attribute is set. The model has already replaced the home folder in every message, entry, and
 * stack. The only link is to where an error voicecap didn't expect can be reported.
 *
 * The mockup showed this with two sample problems, and sample lines of an event log. A run records
 * its own event log from voicecap 0.11.0, and a problem's record has the log's lines of its attempt
 * among its own, by time, from events.jsonl. Where the mockup had nothing to say (the record of a
 * problem with no time, the stack, how the kind was decided), the words are new, and use the
 * mockup's own classes.
 */
import { esc, idFragment } from "../../report/html.js";
import type { ShareModel } from "../model.js";
import { KIND_ROWS, type Problem } from "../problems.js";
import { PROBLEMS_TEXT } from "../text.js";
import {
  decidedFrom,
  happenedLine,
  kindMeaning,
  kindTitle,
  problemTime,
  problemTitle,
  recordTime,
  sentence,
  whereOf,
} from "../words.js";
import { chip, fold, lineHtml, notRecorded, scroll, verdictLine } from "./parts.js";

/** The color of the chip that says whether a problem happened again, whose words are in text.ts. */
const AGAIN_KIND: Record<Problem["again"], string> = {
  no: "ok",
  same: "bad",
  different: "bad",
  unknown: "warn",
};

/** A question of a problem, and its answer, which is HTML, already escaped. */
const row = (label: string, said: string): string => `<dt>${esc(label)}</dt><dd>${said}</dd>`;

/**
 * What happened (with which program came to the front, for a foreground loss whose run recorded
 * it), what voicecap did, whether it happened again, and the effect on the results.
 */
function questions(problem: Problem): string {
  const labels = PROBLEMS_TEXT.questions;
  const rows = [
    row(labels.happened, esc(happenedLine(problem))),
    ...(problem.fromWording ? [row(labels.decided, esc(decidedFrom(problem.kind)))] : []),
    row(labels.did, esc(sentence(problem.did))),
    row(labels.again, esc(sentence(problem.verdict))),
    row(labels.effect, esc(sentence(problem.effect))),
    ...(problem.kind === "unexpected"
      ? [row(labels.report, lineHtml(PROBLEMS_TEXT.report()))]
      : []),
  ];
  return `<dl class="qa">${rows.join("")}</dl>`;
}

/**
 * The record of a problem, word for word, as a table of its time, its source, and its entry. A
 * stack is shown apart (see `stackBox`), where its lines can be read. A time the run didn't record
 * says so, never a blank.
 */
function recordBox(problem: Problem, where: string): string {
  const { record } = PROBLEMS_TEXT;
  const rows = problem.record
    .filter((entry) => entry.source !== "stack")
    .map(
      (entry) =>
        `<tr><td class="lt">${esc(recordTime(entry.time))}</td><td class="src">${esc(entry.source)}</td><td><code>${esc(entry.entry)}</code></td></tr>`,
    );
  const columns = record.head.map((words) => `<th scope="col">${esc(words)}</th>`);
  const table = `<table class="logtable"><caption class="sr">The record of this problem</caption><thead><tr>${columns.join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
  return `<div><h3 class="logh">${esc(record.title)} <span class="sr">${esc(where)}</span></h3>${scroll(`The record of the problem ${where}, table`, table)}</div>`;
}

/** Where in voicecap's code an error voicecap didn't expect happened, in a box that scrolls. */
function stackBox(stack: string, where: string): string {
  const title = `${PROBLEMS_TEXT.stack} ${where}`;
  return `<div><h3 class="logh">${esc(PROBLEMS_TEXT.stack)} <span class="sr">${esc(where)}</span></h3>${scroll(title, `<pre class="logblock">${esc(stack)}</pre>`)}</div>`;
}

/**
 * A problem's fold: its line says which, when, what kind, and whether it came again. `nth` is
 * its place among the page's problems in the run, from 1.
 */
function problemFold(problem: Problem, id: string, nth: number): string {
  const where = whereOf(problem, nth);
  const chips = [
    chip(problem.kind === "unexpected" ? "bad" : "warn", kindTitle(problem.kind)),
    chip(AGAIN_KIND[problem.again], PROBLEMS_TEXT.again[problem.again]),
  ];
  const summary = [
    `<span class="what">${esc(problemTitle(problem))}</span>`,
    `<span class="sub">${esc(problemTime(problem))}</span>`,
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

/**
 * "How voicecap tells causes apart": each kind, whose it is, and what voicecap does about it, with
 * the address where an error voicecap didn't expect is reported a link.
 */
function kindsFold(): string {
  const { kinds } = PROBLEMS_TEXT;
  const rows = KIND_ROWS.map(
    (kind) =>
      `<tr><th scope="row">${esc(kind.title)}</th><td>${esc(kind.whose)}</td><td>${lineHtml(kindMeaning(kind.meaning))}</td></tr>`,
  );
  const columns = kinds.head.map((words) => `<th scope="col">${esc(words)}</th>`);
  const table = `<table class="plain"><caption class="sr">Kinds of problem</caption><thead><tr>${columns.join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
  const summary = `<span class="what">${esc(kinds.title)}</span> <span class="sub">${esc(kinds.inside(KIND_ROWS.length))}</span>`;
  return fold(summary, scroll("Kinds of problem, table", table), { className: "kinds" });
}

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
    `<h2 id="prob-h">${esc(PROBLEMS_TEXT.title)}</h2>`,
    verdictLine(line),
    ...(problems.length === 0 ? [] : [`<p class="gist">${esc(PROBLEMS_TEXT.gist)}</p>`]),
    `<div class="folds">${[...folds, kindsFold()].join("")}</div>`,
  ];
  return `<section aria-labelledby="prob-h">\n  ${parts.join("\n  ")}\n</section>`;
}
