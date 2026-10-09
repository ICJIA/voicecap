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
 * pass captured; the lines NVDA said first; what axe found (a label, then its results, or the
 * reason it has none); the run its transcripts are from; and its transcripts, each a heading 3
 * under the page's, where the page folds them in its card. A page that wasn't read has no lines and
 * no transcripts. There is no appendix of transcripts: every page's are with it.
 *
 * What axe found is the card's fold, unfolded, in the fold's order and words (../axe-view.ts and
 * `AXE_TEXT` have them): what axe is, its version and rules, the counts, the issues most severe
 * first, what needs review, and the file's fingerprint. Each issue is a paragraph, its name in bold
 * and its impact and criteria under it, and its elements are a list. Everything axe supplies (a
 * rule's words, an element's selector and HTML, its words on how to fix it) is a run of text, never
 * markup, and never escaped: the library sets each in a run of its own. The only link is to axe's
 * own page on a rule, as the page's is.
 *
 * It folds nothing: every page and every transcript is there in full. What it leaves out has no use
 * on paper: the strip of bars that draws a page's spoken lines (the spec's charts that become
 * tables don't include it) and the chip that counts a page's issues (the counts are in the words).
 * Nor does it say anything of the page's fingerprint check, which it has none of. Pure.
 */
import { PASS_NAMES, type PassName } from "../../model.js";
import {
  axeCriteria,
  axeFix,
  axeImpacts,
  axeRulePage,
  axeRulesRun,
  axeSelector,
  axeSharedFix,
  type AxeView,
  type AxeViewRule,
} from "../axe-view.js";
import { jpegOfAddress } from "../cards.js";
import { count } from "../format.js";
import type { Inline, Line } from "../line.js";
import type { AppendixFile, NoLongerListed, PageCard, ShareModel } from "../model.js";
import { APPENDIX_TEXT, AXE_TEXT, PAGES_TEXT, PASS_TITLE, WORD_TEXT } from "../text.js";
import {
  axeFingerprint,
  capturedOf,
  fileFingerprint,
  fromRun,
  heardFirstLine,
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
 * each in curly quotes (but for a step where it said nothing, which is the marker the transcript
 * writes, as it is: see `heardFirstLine`), as the page's card has them. A page with none (it was
 * never read, or its read transcript can't be read here) has none: a label with nothing under it
 * says less than nothing.
 */
function heardFirstBlocks({ heardFirst }: PageCard): Block[] {
  if (heardFirst.length === 0) return [];
  return [para({ text: PAGES_TEXT.heardFirst, bold: true }), list(heardFirst.map(heardFirstLine))];
}

// What axe found.

/**
 * The counts of what axe found as one sentence, as a page's numbers are ("Read: 18 lines; …"), where
 * the card's fold has a box for each: the issues, how many of them are of each impact, what needs
 * review, and the rules passed. "Issues: 3; Critical: 1; Serious: 1; Moderate: 1; Minor: 0; Needs
 * review: 1; Rules passed: 41."
 */
function axeCounts(view: AxeView): Line {
  const { counts: label } = AXE_TEXT;
  const impacts = axeImpacts(view);
  const counts: [label: string, value: number][] = [
    [label.issues, view.violations.length],
    [label.critical, impacts.critical],
    [label.serious, impacts.serious],
    [label.moderate, impacts.moderate],
    [label.minor, impacts.minor],
    [label.incomplete, view.incomplete.length],
    [label.passes, view.counts.passes],
  ];
  return [sentence(counts.map(([term, value]) => `${term}: ${count(value)}`).join("; "))];
}

/**
 * axe's words on how to fix an element, or every element of a rule, as lines of text under their
 * label ("How to fix it, in axe's words:"): each lead on a line, and each thing under it on a line
 * of its own after a dash, as the fold sets them out. A list item holds one paragraph, and a list
 * can't follow a list without running into it, so these are lines of the paragraph that holds them
 * (a line break each), not a list of their own. None for words that are none.
 */
function axeFixLines(label: string, summary: string): string[] {
  const parts = axeFix(summary);
  if (parts.length === 0) return [];
  return [
    `${label}:`,
    ...parts.flatMap(({ lead, items }) => [lead, ...items.map((item) => `– ${item}`)]),
  ];
}

/**
 * An element a rule found, as an item of its list: its selector and its HTML in the fixed-width
 * font, each on a line under its label, and, when its rule doesn't say them once for every element
 * (`saidOnce`), axe's words on how to fix it, when axe gives any. All of it is text.
 */
function axeElement(
  { target, html, failureSummary }: AxeViewRule["nodes"][number],
  saidOnce: boolean,
): Line {
  const fix = saidOnce ? [] : axeFixLines(AXE_TEXT.fix, failureSummary);
  return [
    `${AXE_TEXT.element}: `,
    { text: axeSelector(target), mono: true },
    `\n${AXE_TEXT.html}: `,
    { text: html, mono: true },
    ...(fix.length === 0 ? [] : [`\n${fix.join("\n")}`]),
  ];
}

/**
 * A rule axe found the page broke, or that needs review, as the fold has it, in its order: a
 * paragraph of axe's words for it (its `help`, or its id when axe gave none) in bold, and under it
 * its impact and the WCAG success criteria it tests, or that it's a best practice; axe's words on
 * how to fix its elements, once, when every element listed shares them (`axeSharedFix`), under a
 * label that claims no element not listed; the list of the elements its file keeps, each with its
 * own words when they differ; how many more there were; and a link to axe's own page on the rule,
 * named for the rule, which leaves the document. An address that isn't axe's page on a rule is no
 * link.
 */
function axeRule(rule: AxeViewRule): Block[] {
  const criteria = axeCriteria(rule.tags);
  const about = [AXE_TEXT.impact(rule.impact), ...(criteria === "" ? [] : [criteria])].join(" · ");
  const shared = axeSharedFix(rule);
  const once = shared === null ? [] : axeFixLines(AXE_TEXT.fixShared(rule.nodes.length), shared);
  const address = axeRulePage(rule.helpUrl);
  return [
    para({ text: rule.help || rule.id, bold: true }, `\n${about}`),
    ...(once.length === 0 ? [] : [para(once.join("\n"))]),
    ...(rule.nodes.length === 0
      ? []
      : [list(rule.nodes.map((node) => axeElement(node, shared !== null)))]),
    ...(rule.moreNodes > 0 ? [para(AXE_TEXT.more(rule.moreNodes))] : []),
    ...(address === null ? [] : [para({ text: AXE_TEXT.rulePage(rule.id), href: address })]),
  ];
}

/**
 * What axe found on a page, where the page folds it in its card after what NVDA said first: a bold
 * label, as "Heard first" has; then, in the fold's order, what axe is, its version and the rules it
 * ran, the counts, the issues under their label, most severe first (or that axe found none), what
 * needs review under its own label and the line that says a person checks it, when there is any,
 * and last the file's size and fingerprint, as its run recorded them. Without results, the card's
 * reason under the label: a line that says nothing was recorded or shown never reads as a pass.
 * None for a card that says nothing of axe, as the page has no fold for it.
 */
function axeBlocks({ axe }: PageCard): Block[] {
  if (axe === undefined) return [];
  const label = para({ text: AXE_TEXT.title, bold: true });
  if ("notRecorded" in axe) return [label, para(notRecordedLine(axe.notRecorded))];
  const { view } = axe;
  const issues =
    view.violations.length === 0
      ? [para(AXE_TEXT.none)]
      : [
          para({ text: `${AXE_TEXT.issues.title}${AXE_TEXT.issues.after}`, bold: true }),
          ...view.violations.flatMap(axeRule),
        ];
  const review =
    view.incomplete.length === 0
      ? []
      : [
          para({ text: AXE_TEXT.review, bold: true }),
          para(AXE_TEXT.reviewLead),
          ...view.incomplete.flatMap(axeRule),
        ];
  return [
    label,
    para(AXE_TEXT.what),
    para(AXE_TEXT.version(view.axeVersion, axeRulesRun(view.tags))),
    para(...axeCounts(view)),
    ...issues,
    ...review,
    para(...axeFingerprint(axe)),
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
 * that says its title, status, flags, and review, what NVDA said first, what axe found, and its
 * transcripts. A page with no transcripts (`transcripts` is undefined) has no lines NVDA said and
 * no transcripts: it has its heading, its screenshot, its paragraph, and what axe found.
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
    ...axeBlocks(card),
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
