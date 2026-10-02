/**
 * The Word copy's "Problems during the runs", as blocks (./blocks.ts). It says the words of the
 * page's renderer (../html/problems.ts) in the same order: the fixed ones come from ../text.ts and
 * the ones worked out from the model from ../words.ts, so the two copies can't say different things.
 * The heads of its tables are the page's, except those of the table of questions and answers, which
 * the page sets as a list: they are in `WORD_TEXT`.
 *
 * The Word copy folds nothing. Each problem is a heading 2 with what its fold holds under it: a line
 * that says when it happened, what kind it was, and whether it happened again (the page's fold line
 * and its chips); a table of its questions and answers (the page's list); the record of it, word for
 * word, in the fixed-width font; for an error voicecap didn't expect, where in voicecap's code it
 * happened; and what the run didn't record. The table of kinds is last. It leaves out the words the
 * page says for a screen reader alone, which its own headings say in view. Pure.
 */
import { firstSentenceBold, type Line } from "../line.js";
import type { ShareModel } from "../model.js";
import { KIND_ROWS, type Problem } from "../problems.js";
import { PROBLEMS_TEXT, WORD_TEXT } from "../text.js";
import {
  decidedFrom,
  kindMeaning,
  kindTitle,
  notRecordedLine,
  problemTime,
  problemTitle,
  recordTime,
  sentence,
  whereOf,
} from "../words.js";
import { heading, mono, monoCell, para, table, type Block } from "./blocks.js";

/**
 * Words as a sentence: with a capital and a full stop. The page's "time not recorded", which begins a
 * problem's line, takes the capital here.
 */
function asSentence(words: string): string {
  return sentence(`${words.charAt(0).toUpperCase()}${words.slice(1)}`);
}

/**
 * A problem's line: when it happened ("time not recorded" when the run kept none), its kind, and
 * whether it happened again, each a sentence. "14:05. Another window came to the front. Didn't
 * happen again."
 */
function problemLine(problem: Problem): string {
  return [problemTime(problem), kindTitle(problem.kind), PROBLEMS_TEXT.again[problem.again]]
    .map(asSentence)
    .join(" ");
}

/**
 * A problem's questions and answers as a table: what happened; how its kind was decided, for an older
 * run's wording; what voicecap did; whether it happened again; the effect on the results; and, for
 * an error voicecap didn't expect, where to report it, the address a link.
 */
function questionsTable(problem: Problem): Block {
  const labels = PROBLEMS_TEXT.questions;
  const rows: (string | Line)[][] = [
    [labels.happened, sentence(problem.happened)],
    ...(problem.fromWording ? [[labels.decided, decidedFrom(problem.kind)]] : []),
    [labels.did, sentence(problem.did)],
    [labels.again, sentence(problem.verdict)],
    [labels.effect, sentence(problem.effect)],
    ...(problem.kind === "unexpected" ? [[labels.report, PROBLEMS_TEXT.report()]] : []),
  ];
  return table(WORD_TEXT.problems.questionsHead, rows, [26, 74]);
}

/**
 * The record of a problem, word for word: a heading that says which problem, and a table of the time
 * of each line, where it is from, and what was recorded, in the fixed-width font. A time the run
 * didn't record says so, never a blank. A stack is shown apart (`stackBlocks`), where its lines can
 * be read, and not as a row.
 */
function recordBlocks(problem: Problem, where: string): Block[] {
  const { record } = PROBLEMS_TEXT;
  const rows = problem.record
    .filter((entry) => entry.source !== "stack")
    .map((entry) => [recordTime(entry.time), entry.source, monoCell(entry.entry)]);
  return [heading(3, `${record.title}, ${where}`), table(record.head, rows, [14, 12, 74])];
}

/**
 * Where in voicecap's code an error voicecap didn't expect happened: a heading, and its stack as
 * one fixed-width block, a line for each line of it, none dropped.
 */
function stackBlocks(stack: string, where: string): Block[] {
  return [heading(3, `${PROBLEMS_TEXT.stack}, ${where}`), mono(stack.split(/\r?\n/))];
}

/**
 * A problem: its heading, its line, its questions and answers, the record of it, its stack when it
 * has one, and each line of what the run didn't record, so a gap never reads as a pass. `nth` is its
 * place among the page's problems in the run, from 1.
 */
function problemBlocks(problem: Problem, nth: number): Block[] {
  const where = whereOf(problem, nth);
  return [
    heading(2, problemTitle(problem)),
    para(problemLine(problem)),
    questionsTable(problem),
    ...recordBlocks(problem, where),
    ...(problem.stack === null ? [] : stackBlocks(problem.stack, where)),
    ...problem.notRecorded.map((line) => para(notRecordedLine(line))),
  ];
}

/**
 * "How voicecap tells causes apart": its heading, the line that says what's in it, and a row for each
 * kind: its name in bold, whose it is, and what voicecap does about it, with the address where an
 * error voicecap didn't expect is reported a link.
 */
function kindsBlocks(): Block[] {
  const { kinds } = PROBLEMS_TEXT;
  const rows = KIND_ROWS.map((kind): (string | Line)[] => [
    [{ text: kind.title, bold: true }],
    kind.whose,
    kindMeaning(kind.meaning),
  ]);
  return [
    heading(2, kinds.title),
    para(kinds.inside(KIND_ROWS.length)),
    table(kinds.head, rows, [26, 28, 46]),
  ];
}

/**
 * "Problems during the runs": the verdict line (its first sentence in bold), what's in the section
 * when something is, each problem, oldest first, and last the table of kinds, which is there when no
 * problem is.
 */
export function wordProblems(model: ShareModel): Block[] {
  const { problems, line } = model.problems;
  const seen = new Map<string, number>();
  const each = problems.flatMap((problem) => {
    const page = JSON.stringify([problem.run, problem.page.slug]);
    const nth = (seen.get(page) ?? 0) + 1;
    seen.set(page, nth);
    return problemBlocks(problem, nth);
  });
  return [
    heading(1, PROBLEMS_TEXT.title),
    para(...firstSentenceBold(line)),
    ...(problems.length === 0 ? [] : [para(PROBLEMS_TEXT.gist)]),
    ...each,
    ...kindsBlocks(),
  ];
}
