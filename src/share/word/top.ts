/**
 * The first parts of the Word copy, as blocks (./blocks.ts): the top, At a glance, and "How voicecap
 * works"; and five parts of the details, which were the Summary's panels and bars (they are
 * exported for ./details.ts, which sets them among the details' other parts). Each takes the model,
 * and says the words of the page's renderer (../html/top.ts) in the same order, but for the top,
 * which puts its title, the site's name, and when it was tested first (see wordTop): the fixed ones
 * come from ../text.ts, the ones worked out from the model from ../words.ts, and the heads and row
 * labels of the tables that stand in for the page's ring, tiles, and bars from `WORD_TEXT`. So the
 * two copies can't say different things.
 *
 * The Word copy folds nothing and draws no pictures: the page's ring is a table of its three parts,
 * its four tiles are a table, each of the two bars is a table of counts and shares, and the steps
 * and the stages are tables too. It has no buttons, and no links to its own sections, which follow
 * one another. Pure.
 */
import { count } from "../format.js";
import type { Line } from "../line.js";
import type { ShareModel } from "../model.js";
import type { Summary } from "../summary.js";
import {
  GLANCE_TEXT,
  HOW_STEPS,
  HOW_TEXT,
  SUMMARY_TEXT,
  TOP_TEXT,
  WHEN_TO_RUN,
  WORD_TEXT,
} from "../text.js";
import { verdictOf } from "../verdict.js";
import {
  glanceNumbersOf,
  heardTitle,
  howLead,
  sentence,
  shareOf,
  spokenDuration,
  testedLine,
  topLead,
  type NumberTile,
} from "../words.js";
import {
  PAGE_BREAK,
  cell,
  heading,
  list,
  monoCell,
  para,
  table,
  title,
  type Block,
} from "./blocks.js";

// The top.

/**
 * When it was tested and when the copy was made, in one paragraph: "Tested 29 September 2026,
 * 14:02. This copy was made 30 September 2026." With no run that counts, nothing was tested, and it
 * says only when the copy was made.
 */
function datesLine(header: ShareModel["header"]): Line {
  const tested = testedLine(header);
  return [...(tested === null ? [] : [`${tested}. `]), WORD_TEXT.top.made(header.asOf)];
}

/**
 * The site's address, in the Word copy's last line of the top, as the page's last small line has
 * it: "Site address https://dvfr.illinois.gov/."
 */
function addressLine({ site }: ShareModel["header"]): Line {
  return [`${TOP_TEXT.siteAddress} ${site}.`];
}

/**
 * Who prepared it, when the records name someone, in bold, and what made it, with "voicecap"
 * linked to its page: "Prepared by Pat Lee. Made with voicecap."
 */
function madeByLine({ preparedBy }: ShareModel["header"]): Line {
  const prepared: Line =
    preparedBy === null ? [] : [`${TOP_TEXT.preparedBy} `, { text: preparedBy, bold: true }, ". "];
  return [
    ...prepared,
    `${TOP_TEXT.madeWith} `,
    { text: TOP_TEXT.madeWithLink, href: TOP_TEXT.github },
    ".",
  ];
}

/**
 * The top: what the copy is, as its title; the site's name, in bold, which is its canonical one
 * when it has one; the name set for the site, when one is; when it was tested and when the copy was
 * made, so a reader meets those first rather than an address; then how its pages were read (the
 * lead), who made it, and last the site's address. The page's header says the same words, in its
 * own order: the site's name as its heading, the date and time under it, and two buttons that a
 * document has no use for. The moment the copy was made, with its offset from UTC, is in the
 * footer's line.
 */
export function wordTop(model: ShareModel): Block[] {
  const { header } = model;
  return [
    title(TOP_TEXT.eyebrow),
    para({ text: header.name, bold: true }),
    ...(header.siteName === null ? [] : [para(header.siteName)]),
    para(...datesLine(header)),
    para(...topLead(header)),
    para(...madeByLine(header)),
    para(...addressLine(header)),
  ];
}

// At a glance.

/** A number as the table says it: a count, a count out of its total, or a time in words. */
function numberOf(value: NumberTile["value"]): string {
  if ("count" in value) return count(value.count);
  if ("part" in value) return WORD_TEXT.summary.outOf(count(value.part), count(value.whole));
  return spokenDuration(value.ms);
}

/** The four numbers (../words.ts) as a table: how each is counted, and what it counts. */
function numbersTable(model: ShareModel): Block {
  const rows = glanceNumbersOf(model).map(({ value, label }) => [numberOf(value), label]);
  return table(WORD_TEXT.summary.numbersHead, rows, [30, 70]);
}

/**
 * The ring of the pages as a table: a row for each of its three parts and the pages in it, as the
 * page's legend says them. A part with no pages keeps its row, with 0.
 */
function ringTable({ ring }: ShareModel): Block {
  const { parts } = GLANCE_TEXT;
  const rows = [
    [parts.noProblems, count(ring.noProblems)],
    [parts.needAttention, count(ring.needAttention)],
    [parts.notRead, count(ring.notRead)],
  ];
  return table(WORD_TEXT.glance.ringHead, rows, [70, 30]);
}

/**
 * The verdict, in bold: its sign, then its words. The one rule for the words is `verdictOf`, which
 * the page and the website's card go by too. The page draws the sign with its style, with no
 * alternative text; a document has no style to draw it with, so here it is the first character of
 * the line.
 */
function verdictBlock(result: ShareModel["result"]): Block {
  const { kind, headline } = verdictOf(result);
  return para({ text: `${WORD_TEXT.glance.signs[kind]} ${headline}`, bold: true });
}

/**
 * At a glance, written for a manager who reads nothing else, in the page's order: the verdict, in
 * bold; the result in a sentence; the ring of the pages and four numbers, as tables; and the line on
 * what voicecap and the person each did. A page break follows, so At a glance has the first page
 * with the top. The page's links to its sections are left out, since a document's follow one
 * another, as are its panels and bars, which are parts of the details now.
 *
 * When no run counts, there are no pages to count: it has only its sentence, which says why, and the
 * line on what each did, and the page break. It has no more when a run counts and lists no page, as
 * on the page: the verdict would say "Nothing needs attention" of a result of no page, which no one
 * read.
 */
export function wordGlance(model: ShareModel): Block[] {
  const { summary, result } = model;
  const counted = result.pages > 0;
  return [
    heading(1, GLANCE_TEXT.title),
    ...(counted ? [verdictBlock(result)] : []),
    para(summary.sentence),
    ...(counted ? [ringTable(model), numbersTable(model)] : []),
    para(summary.second),
    PAGE_BREAK,
  ];
}

// The details' parts that were the summary's panels and bars.

/**
 * "How complete the test was": the model's lines, then the line on the run before, when there is
 * one.
 */
export function completeBlocks({ complete, changesLine }: Summary): Block[] {
  const lines = changesLine === null ? complete : [...complete, changesLine];
  return [heading(2, SUMMARY_TEXT.complete), list(lines)];
}

/** "What's still to do": a list, a line for each task. */
export function todoBlocks({ todo }: Summary): Block[] {
  return [heading(2, SUMMARY_TEXT.todo), list(todo)];
}

/** "When and how": a list, a line for each of the date, who ran it, and what it ran on. */
export function whenHowBlocks({ whenHow }: Summary): Block[] {
  const items = whenHow.map(({ label, value }): Line => [
    { text: label, bold: true },
    `: ${value}`,
  ]);
  return [heading(2, SUMMARY_TEXT.whenHow), list(items)];
}

/**
 * What the page says beside the title of a bar (`SUMMARY_TEXT.rulesNote`, `.reviewNote`), as a
 * paragraph of its own under the title: the same words, with a capital and a full stop.
 */
function noteBlock(phrase: string): Block {
  return para(sentence(`${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}`));
}

/**
 * "Flags by rule": what a rule's count is (once for each page and pass it was raised in), then a
 * row for each rule, its name in the fixed-width font as the page sets it, with how many times it
 * was raised and its share of every flag raised; or that no flag was.
 */
export function rulesBlocks({ bars }: Summary): Block[] {
  const { flagsByRule } = bars;
  const total = flagsByRule.reduce((sum, { count: times }) => sum + times, 0);
  const rows = flagsByRule.map(({ rule, count: times }) => [
    monoCell(rule),
    count(times),
    shareOf(times, total),
  ]);
  const body =
    rows.length === 0
      ? para(SUMMARY_TEXT.noFlagsRaised)
      : table(WORD_TEXT.summary.rulesHead, rows, [40, 25, 35]);
  return [heading(2, SUMMARY_TEXT.rules), noteBlock(SUMMARY_TEXT.rulesNote), body];
}

/**
 * "The human review": a line that says each count is out of its total, then each count with its
 * total and its share, so nothing looks complete that isn't. It has no row for the pages a person
 * heard NVDA read, which is on each page's chip.
 */
export function reviewBlocks({ bars }: Summary): Block[] {
  const { reviewRows } = SUMMARY_TEXT;
  const { reviewed, fixed } = bars.review;
  const kinds = [
    [reviewRows.reviewed, reviewed],
    [reviewRows.fixed, fixed],
  ] as const;
  const rows = kinds.map(([label, [part, whole]]) => [
    label,
    count(part),
    count(whole),
    shareOf(part, whole),
  ]);
  return [
    heading(2, SUMMARY_TEXT.review),
    noteBlock(SUMMARY_TEXT.reviewNote),
    table(WORD_TEXT.summary.reviewHead, rows, [40, 20, 20, 20]),
  ];
}

// How voicecap works.

/** The six steps as a table: each one's number, its title in bold, and what it means. */
function stepsTable(): Block {
  const rows = HOW_STEPS.map((step, index): (string | Line)[] => [
    `${index + 1}`,
    [{ text: step.title, bold: true }],
    step.text,
  ]);
  return table(WORD_TEXT.how.stepsHead, rows, [8, 30, 62]);
}

/**
 * What NVDA said on this site: its heading, a table with a column for each pass and a row for each
 * line, each cell “what it said” and (how long it took), and what those words and times are. A
 * pass with fewer lines than another has empty cells below its last. Without a sample (no home page
 * with transcripts, or none whose lines can be read), the line that says none is available.
 */
function heardBlocks(sample: ShareModel["heard"]): Block[] {
  if (sample === null) return [heading(2, HOW_TEXT.heard), para(HOW_TEXT.noSample)];
  const head = sample.passes.map(({ pass }) => {
    const { key, words } = HOW_TEXT.ways[pass];
    return `${key}, ${words}`;
  });
  const longest = Math.max(...sample.passes.map(({ lines }) => lines.length));
  const rows = Array.from({ length: longest }, (_, at) =>
    sample.passes.map(({ lines }) => {
      const line = lines[at];
      return line === undefined ? cell() : `“${line.text}” (${line.took})`;
    }),
  );
  return [heading(2, heardTitle(sample)), table(head, rows), para(HOW_TEXT.heardNote)];
}

/**
 * The band on when to run voicecap: its headline as a heading, its line, and the four stages as the
 * columns of a table, with the words of the stage it stresses in bold.
 */
function whenBlocks(): Block[] {
  const { headline, text, stages } = WHEN_TO_RUN;
  const row = stages.map((stage): Line | string =>
    stage.marked ? [{ text: stage.text, bold: true }] : stage.text,
  );
  return [
    heading(2, headline),
    para(text),
    table(
      stages.map((stage) => stage.title),
      [row],
    ),
  ];
}

/**
 * "How voicecap works": the lead, the six steps as a table, a sample of what NVDA said on this
 * site, and when to run voicecap.
 */
export function wordHow(model: ShareModel): Block[] {
  return [
    heading(1, HOW_TEXT.title),
    para(...howLead()),
    stepsTable(),
    ...heardBlocks(model.heard),
    ...whenBlocks(),
  ];
}
