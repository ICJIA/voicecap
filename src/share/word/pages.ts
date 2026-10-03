/**
 * The Word copy's "Every page", "What the flags found", and the appendix of transcripts, as blocks
 * (./blocks.ts). Each takes the model, and says the words of the page's renderer (../html/pages.ts)
 * in the same order: the fixed ones come from ../text.ts, the ones worked out from the model from
 * ../words.ts, and the heads of the table of pages and the words of its flags column from
 * `WORD_TEXT`. So the two copies can't say different things.
 *
 * Where the page has a card for each page, the Word copy has a row, in one table. It folds nothing:
 * every page, every flagged page's quotes, and every transcript is there in full. What it leaves
 * out has no use on paper: the link on a card to its transcripts, the strip of bars that draws a
 * page's spoken lines (the spec's charts that become tables don't include it), and the picture of
 * a screenshot (it has no image yet). Nor does it say anything of the page's fingerprint check,
 * which it has none of. Pure.
 */
import { PASS_NAMES, type PassName } from "../../model.js";
import type { Line } from "../line.js";
import type { AppendixFile, FlaggedPage, NoLongerListed, PageCard, ShareModel } from "../model.js";
import { APPENDIX_TEXT, FLAGS_TEXT, PAGES_TEXT, PASS_TITLE, WORD_TEXT } from "../text.js";
import {
  appendixGist,
  capturedOf,
  fileFingerprint,
  flagCount,
  flagsGist,
  fromRun,
  lineCount,
  manualLine,
  notRecordedLine,
  originOf,
  pagesGist,
  sentence,
  titleOf,
  transcriptsInside,
} from "../words.js";
import {
  PAGE_BREAK,
  cell,
  heading,
  mono,
  monoCell,
  para,
  table,
  type Block,
  type Cell,
} from "./blocks.js";

// Every page.

/**
 * A page's name in bold, as its card's heading has it: its label with its path under it, or, for a
 * page with no label, its path alone (the site's address is at the top of the copy, and a whole
 * address crowds a table of six columns). Then its title.
 */
function pageCell(card: PageCard): Cell {
  const title = titleOf(card);
  return cell(
    [{ text: card.labeled ? card.name : card.path, bold: true }],
    ...(card.labeled ? [card.path] : []),
    ...(title === null ? [] : [title]),
  );
}

/**
 * A page's screenshot as a line: its label in bold, then the line that says it wasn't recorded, as
 * the page does. A screenshot that was recorded has no place in this copy yet, which holds no
 * image, so it is said by its words for the picture.
 */
function screenshotLine({ screenshot }: PageCard): Line {
  if ("notRecorded" in screenshot) {
    return [
      { text: `${PAGES_TEXT.screenshot}:`, bold: true },
      ` ${notRecordedLine(screenshot.notRecorded)}`,
    ];
  }
  return [screenshot.alt];
}

/**
 * A page's result in words, the failure when it has one, and the run its transcripts are from. A
 * page with no entry in the appendix (it has no transcripts) says its screenshot last, since no
 * entry does; every other page says it in its entry, so each page says it once.
 */
function resultCell(card: PageCard, inAppendix: boolean): Cell {
  const from = fromRun(card);
  return cell(
    card.statusText,
    ...(card.failure === null ? [] : [card.failure]),
    ...(from === null ? [] : [from]),
    ...(inAppendix ? [] : [screenshotLine(card)]),
  );
}

/**
 * A page's flags: that nothing was read to flag, that it has none, or each rule that raised one,
 * once and in the fixed-width font, as the page's chips set them; then, when they are, that they
 * are as the run recorded them. The page has no chip for a page with no transcripts, but the empty
 * cell of a table would read as no flags, so this says it.
 */
function flagsCell(card: PageCard): Cell {
  const rules = [...new Set(card.flags.map(({ rule }) => rule))];
  const said: (Line | string)[] =
    card.counts === null
      ? [WORD_TEXT.pages.nothingToFlag]
      : rules.length === 0
        ? [PAGES_TEXT.noFlags]
        : rules.map((rule): Line => [{ text: rule, mono: true }]);
  return cell(...said, ...(card.flagsAsRecorded ? [PAGES_TEXT.flagsAsRecorded] : []));
}

/**
 * The person's review as far as the records show it: each chip's words, then each manual NVDA
 * session. Empty when they show none, since a copy never says what a person hasn't done.
 */
function reviewCell({ reviewChips, manual }: PageCard): Cell {
  return cell(...reviewChips, ...manual.map(manualLine));
}

/** What each pass captured and how long the page took, a line each. Empty with no transcripts. */
function passesCell(card: PageCard): Cell {
  return cell(...(capturedOf(card) ?? []).map(({ label, value }) => `${label}: ${value}`));
}

/**
 * Every page as one table: a row for each, in the latest run's order, and a column for each part
 * of a card. `inAppendix` holds the pages that have an entry there.
 */
function pagesTable(pages: PageCard[], inAppendix: Set<string>): Block {
  const rows = pages.map((card, index) => [
    `${index + 1}`,
    pageCell(card),
    resultCell(card, inAppendix.has(card.slug)),
    flagsCell(card),
    reviewCell(card),
    passesCell(card),
  ]);
  return table(WORD_TEXT.pages.head, rows, [6, 22, 21, 18, 14, 19]);
}

/**
 * The pages earlier runs tested that the latest list no longer has: a heading, its line, and a
 * table of each page's name in bold (with its address beneath, when the name isn't it), the last
 * run that had it, and what that run recorded. None when there are no such pages.
 */
function noLongerListedBlocks(gone: NoLongerListed[]): Block[] {
  if (gone.length === 0) return [];
  const rows = gone.map(({ name, url, lastRun, lastStatus }) => [
    cell([{ text: name, bold: true }], ...(name === url ? [] : [url])),
    lastRun,
    lastStatus,
  ]);
  return [
    heading(2, PAGES_TEXT.noLongerListed),
    para(PAGES_TEXT.noLongerListedLead),
    table(PAGES_TEXT.noLongerListedHead, rows, [50, 30, 20]),
  ];
}

/**
 * "Every page": the line on how many pages were read in full, one table with a row for each page,
 * and the pages no longer listed. With no pages (no run counts, or the latest run listed none) it
 * is the line alone, with no table.
 */
export function wordPages(model: ShareModel): Block[] {
  const inAppendix = new Set(model.appendix.map(({ slug }) => slug));
  return [
    heading(1, PAGES_TEXT.title),
    para(...pagesGist(model)),
    ...(model.pages.length === 0 ? [] : [pagesTable(model.pages, inAppendix)]),
    ...noLongerListedBlocks(model.noLongerListed),
  ];
}

// What the flags found.

/**
 * A flagged page: its name and how many flags it has, the run its transcripts are from when it
 * isn't the latest, and a row for each rule that raised a flag. A row is the rule in the
 * fixed-width font, what it found, and the lines NVDA spoke that raised it, each in curly quotes
 * and in the fixed-width font on a line of its own, as the page sets them; or that there is no
 * line to quote.
 */
function flaggedBlocks({ card, quotes }: FlaggedPage): Block[] {
  const from = fromRun(card);
  const rows = quotes.map(({ rule, text, said }) => [
    monoCell(rule),
    text,
    said.length === 0
      ? cell(FLAGS_TEXT.noLine)
      : cell(...said.map((line): Line => [{ text: `“${line}”`, mono: true }])),
  ]);
  return [
    heading(2, `${card.name}: ${flagCount(card.flags.length)}`),
    ...(from === null ? [] : [para(from)]),
    table(FLAGS_TEXT.head, rows, [22, 33, 45]),
  ];
}

/**
 * "What the flags found": the line on how many pages have flags, and from how many rules, then each
 * flagged page in full. With no flagged page it is the line alone.
 */
export function wordFlags(model: ShareModel): Block[] {
  return [
    heading(1, FLAGS_TEXT.title),
    para(...flagsGist(model)),
    ...model.flagged.flatMap(flaggedBlocks),
  ];
}

// The appendix.

/**
 * A transcript's heading: its pass and its page, and how many lines it has: "Read transcript of
 * /about/, 21 lines". A transcript that couldn't be read has no count to give.
 */
function transcriptHeading(pass: PassName, path: string, lines: number | null): Block {
  const title = `${PASS_TITLE[pass]} ${APPENDIX_TEXT.transcriptOf} ${path}`;
  return heading(3, lines === null ? title : `${title}, ${lineCount(lines)}`);
}

/**
 * A transcript: its heading, its file's size and fingerprint (the whole file's, its header
 * included, as its run recorded them), and what NVDA said, word for word, as one fixed-width block
 * however many lines it has. The model's text is its lines joined by newlines, with no final
 * newline, so splitting it at them gives the `file.lines` lines it has, a blank last one too, and
 * nothing is dropped. A transcript with no lines says so, rather than show an empty block.
 */
function transcriptBlocks(file: AppendixFile, path: string): Block[] {
  const words = file.lines === 0 ? para(APPENDIX_TEXT.noLines) : mono(file.text.split(/\r?\n/));
  return [transcriptHeading(file.pass, path, file.lines), para(...fileFingerprint(file)), words];
}

/**
 * A transcript the run recorded but that couldn't be read here, said in words, in its place. The
 * page goes on to say what its fingerprint check does with it; the Word copy has no check.
 */
function unreadableBlocks(pass: PassName, path: string): Block[] {
  return [transcriptHeading(pass, path, null), para(sentence(APPENDIX_TEXT.unreadable))];
}

/**
 * One page of the appendix: its number, its name, and the transcripts it has (a heading as the
 * page's fold has it, which says which, as many as there are); the run its transcripts are from;
 * its screenshot (the only place a page with transcripts says it); and a transcript for each pass
 * the run recorded. A page whose record lists no transcript files says so. A page with no card
 * has the latest run's transcripts, and no screenshot.
 */
function appendixPage(
  entry: ShareModel["appendix"][number],
  number: number,
  card: PageCard | undefined,
  latest: string | null,
): Block[] {
  const passes = PASS_NAMES.filter(
    (pass) => entry.files.some((file) => file.pass === pass) || entry.unreadable.includes(pass),
  );
  const path = card?.path ?? entry.name;
  const origin = originOf(card, latest);
  const transcripts = passes.flatMap((pass) => {
    const file = entry.files.find((each) => each.pass === pass);
    return file === undefined ? unreadableBlocks(pass, path) : transcriptBlocks(file, path);
  });
  return [
    heading(2, `${number} ${entry.name}: ${transcriptsInside(passes)}`),
    ...(origin === null ? [] : [para(...origin)]),
    ...(card === undefined ? [] : [para(...screenshotLine(card))]),
    ...transcripts,
    ...(passes.length === 0 ? [para(APPENDIX_TEXT.noFiles)] : []),
  ];
}

/**
 * "Appendix: every transcript", starting on a new page and running on from there: the line on how
 * many pages and transcripts there are (without the page's sentence on opening a page, since
 * nothing here is folded), then each page with transcripts, in the latest run's order, with the
 * number its row has.
 */
export function wordAppendix(model: ShareModel): Block[] {
  const cards = new Map(model.pages.map((card, index) => [card.slug, { card, number: index + 1 }]));
  const latest = model.evidence[0]?.run.id ?? null;
  const pages = model.appendix.flatMap((entry, index) => {
    const found = cards.get(entry.slug);
    return appendixPage(entry, found?.number ?? index + 1, found?.card, latest);
  });
  return [PAGE_BREAK, heading(1, APPENDIX_TEXT.title), para(...appendixGist(model)), ...pages];
}
