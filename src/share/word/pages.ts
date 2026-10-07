/**
 * The Word copy's "Every page", as blocks (./blocks.ts). It takes the model, and says the words of
 * the page's renderer (../html/pages.ts) in the same order: the fixed ones come from ../text.ts,
 * the ones worked out from the model from ../words.ts, and the label the page says for a screen
 * reader alone before a page's flags, and the line for a page with nothing to flag, from
 * `PAGES_TEXT` and `WORD_TEXT`. So the two copies can't say different things.
 *
 * Where the page has a card for each page, the Word copy has blocks for each, in this order: a
 * heading 2 with the page's number and name; its screenshot (its label, then its picture, or the
 * reason it has none); one paragraph of its title, its status, its flags, its review, and what each
 * pass captured; the lines NVDA said first; the run its transcripts are from; and its transcripts,
 * each a heading 3 under the page's, where the page folds them in its card. A page that wasn't read
 * has no lines and no transcripts. There is no appendix of transcripts: every page's are with it.
 *
 * It folds nothing: every page and every transcript is there in full. What it leaves out has no use
 * on paper: the strip of bars that draws a page's spoken lines (the spec's charts that become
 * tables don't include it). Nor does it say anything of the page's fingerprint check, which it has
 * none of. Pure.
 */
import { PASS_NAMES, type PassName } from "../../model.js";
import { jpegOfAddress } from "../cards.js";
import type { Inline, Line } from "../line.js";
import type { AppendixFile, NoLongerListed, PageCard, ShareModel } from "../model.js";
import { APPENDIX_TEXT, PAGES_TEXT, PASS_TITLE, WORD_TEXT } from "../text.js";
import {
  capturedOf,
  fileFingerprint,
  fromRun,
  lineCount,
  manualLine,
  notRecordedLine,
  originOf,
  pagesGist,
  sentence,
  titleOf,
} from "../words.js";
import {
  cell,
  heading,
  image,
  list,
  mono,
  para,
  table,
  type Block,
  type Picture,
} from "./blocks.js";

// Every page.

/** A page's entry among the model's transcripts: the files it has, and the passes it couldn't read. */
type Transcripts = ShareModel["appendix"][number];

/**
 * A page's heading: its number, then its name as its card's heading has it: its label with its path
 * after it, or, for a page with no label, its path alone (the site's address is at the top of the
 * copy, and a whole address crowds a heading).
 */
function pageHeading(card: PageCard, number: number): Block {
  return heading(2, `${number} ${card.labeled ? `${card.name} ${card.path}` : card.path}`);
}

/**
 * A page's screenshot as a line: its label in bold, then, when it wasn't recorded or isn't shown,
 * the line that says so, as the page does. A picture follows its label as an image of its own.
 */
function screenshotLine({ screenshot }: PageCard): Line {
  const label = { text: `${PAGES_TEXT.screenshot}:`, bold: true } as const;
  return "notRecorded" in screenshot
    ? [label, ` ${notRecordedLine(screenshot.notRecorded)}`]
    : [label];
}

/**
 * A page's picture, as the image the page's address holds: its bytes, its recorded size, and its
 * alt text. Null for a page with none.
 */
function pictureOf({ screenshot }: PageCard): Picture | null {
  return "dataUri" in screenshot
    ? {
        jpeg: jpegOfAddress(screenshot.dataUri),
        width: screenshot.width,
        height: screenshot.height,
        alt: screenshot.alt,
      }
    : null;
}

/**
 * A page's flags, as the page's chips say them: that nothing was read to flag, that it has none, or
 * each rule that raised one, once and in the fixed-width font, after the label the page gives them
 * for a screen reader; then, when they are, that they are as the run recorded them. The page has no
 * chip for a page with no transcripts, but a paragraph that said nothing of flags would read as no
 * flags, so this says it.
 */
function flagsSentences(card: PageCard): Line[] {
  const rules = [...new Set(card.flags.map(({ rule }) => rule))];
  const said: Line[] =
    card.counts === null
      ? [[sentence(WORD_TEXT.pages.nothingToFlag)]]
      : rules.length === 0
        ? [[sentence(PAGES_TEXT.noFlags)]]
        : [
            [
              `${PAGES_TEXT.flagsRaised}: `,
              ...rules.flatMap((rule, at): Inline[] => [
                ...(at === 0 ? [] : [", "]),
                { text: rule, mono: true },
              ]),
              ".",
            ],
          ];
  return [...said, ...(card.flagsAsRecorded ? [[sentence(PAGES_TEXT.flagsAsRecorded)]] : [])];
}

/**
 * What each pass captured and how long the page took, as one sentence: "Read: 18 lines; Headings:
 * 2; Tab stops: 8; Time: 55.1 s." None for a page with no transcripts.
 */
function capturedSentence(card: PageCard): Line[] {
  const captured = capturedOf(card);
  if (captured === null) return [];
  return [[sentence(captured.map(({ label, value }) => `${label}: ${value}`).join("; "))]];
}

/**
 * A page's title, status, flags, and review in one paragraph, a sentence for each part, in this
 * order: its title, when it has one; its status in words, the failure when it has one, and the run
 * its transcripts are from when it isn't the latest; its flags; the person's review as far as the
 * records show it (each chip's words, then each manual NVDA session), which is nothing when they
 * show none, since a copy never says what a person hasn't done; and what each pass captured, which
 * the section's opening line promises of every page.
 */
function statusLine(card: PageCard): Line {
  const title = titleOf(card);
  const from = fromRun(card);
  const sentences: Line[] = [
    ...(title === null ? [] : [[sentence(title)]]),
    [sentence(card.statusText)],
    ...(card.failure === null ? [] : [[sentence(card.failure)]]),
    ...(from === null ? [] : [[sentence(from)]]),
    ...flagsSentences(card),
    ...card.reviewChips.map((chip): Line => [sentence(chip)]),
    ...card.manual.map((session): Line => [sentence(manualLine(session))]),
    ...capturedSentence(card),
  ];
  return sentences.flatMap((each, at) => (at === 0 ? each : [" ", ...each]));
}

/**
 * What NVDA said first on the page: a label and the first lines of its read pass, word for word,
 * each in curly quotes, as the page's card has them. A page with none (it was never read, or its
 * read transcript can't be read here) has none: a label with nothing under it says less than
 * nothing.
 */
function heardFirstBlocks({ heardFirst }: PageCard): Block[] {
  if (heardFirst.length === 0) return [];
  return [
    para({ text: PAGES_TEXT.heardFirst, bold: true }),
    list(heardFirst.map((line) => `“${line}”`)),
  ];
}

// A page's transcripts.

/**
 * A transcript's heading, a heading 3 under its page's: its pass and its page, and how many lines it
 * has: "Read transcript of /about/, 18 lines". A transcript that couldn't be read has no count to
 * give. The page's address is in it, though its own heading is above: every page has a "Read", a
 * "Headings", and a "Tab", which read alike to someone moving by headings. The page says the same
 * words in each heading too, hidden from sight; Word can't hide words, so here they are in view.
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
 * A page's transcripts, as its fold has them: the run they are from; and a transcript for each pass
 * the run recorded, the read pass first. A page whose record lists no transcript files says so.
 */
function transcriptsBlocks(
  card: PageCard,
  transcripts: Transcripts,
  latest: string | null,
): Block[] {
  const passes = PASS_NAMES.filter(
    (pass) =>
      transcripts.files.some((file) => file.pass === pass) || transcripts.unreadable.includes(pass),
  );
  const origin = originOf(card, latest);
  return [
    ...(origin === null ? [] : [para(...origin)]),
    ...passes.flatMap((pass) => {
      const file = transcripts.files.find((each) => each.pass === pass);
      return file === undefined
        ? unreadableBlocks(pass, card.path)
        : transcriptBlocks(file, card.path);
    }),
    ...(passes.length === 0 ? [para(APPENDIX_TEXT.noFiles)] : []),
  ];
}

// The pages.

/**
 * A page: its heading, its screenshot (its label, then its picture when it has one), the paragraph
 * that says its title, status, flags, and review, what NVDA said first, and its transcripts. A page
 * with no transcripts (`transcripts` is undefined) has the first three alone.
 */
function pageBlocks(
  card: PageCard,
  number: number,
  transcripts: Transcripts | undefined,
  latest: string | null,
): Block[] {
  const picture = pictureOf(card);
  return [
    pageHeading(card, number),
    para(...screenshotLine(card)),
    ...(picture === null ? [] : [image(picture)]),
    para(...statusLine(card)),
    ...heardFirstBlocks(card),
    ...(transcripts === undefined ? [] : transcriptsBlocks(card, transcripts, latest)),
  ];
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
 * "Every page": the line on how many pages were read in full, then each page in the latest run's
 * order, with its number, and last the pages no longer listed. With no pages (no run counts, or the
 * latest run listed none) it is the line alone.
 */
export function wordPages(model: ShareModel): Block[] {
  // The model keeps a page's transcripts apart from its card, by the page's slug.
  const transcripts = new Map(model.appendix.map((entry) => [entry.slug, entry]));
  const latest = model.evidence[0]?.run.id ?? null;
  return [
    heading(1, PAGES_TEXT.title),
    para(...pagesGist(model)),
    ...model.pages.flatMap((card, index) =>
      pageBlocks(card, index + 1, transcripts.get(card.slug), latest),
    ),
    ...noLongerListedBlocks(model.noLongerListed),
  ];
}
