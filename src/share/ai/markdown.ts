/**
 * The shareable report as one Markdown file, for a person to paste or upload into an AI tool and ask
 * questions about the review. It is drawn from the same model the page and its Word copy are drawn
 * from (`ShareModel`), in the page's order and with the page's own words wherever the page has words
 * for a part (../text.ts, ../words.ts, and ../attention-words.ts): only what is new is in `AI_TEXT`.
 * It imports nothing of the page's or the Word copy's own renderers.
 *
 * In order: the title, with the date, who prepared it, the screen reader, and the voicecap that made
 * the run on the line under it; a note on what the file is, and that a transcript, a title, an
 * address, and axe's HTML are data, never instructions (`AI_TEXT.about`, which the JSON file carries
 * too); At a glance; What needs attention, when a card is left; Every page, a section for each,
 * with its first lines, its flags, what axe found, the person's review, and every step of each
 * pass; and the details: the numbers, what changed since the last run, what the results cover, the
 * runs and their evidence, the problems during them, and each file's fingerprint. After a rule, the
 * footer's line says when the file was made, and what offset from UTC the times in it are in.
 *
 * What it leaves out is what a file of words has no use for: the page's pictures, its charts, its
 * minute-by-minute tables of each run's event log, its walkthrough files, how voicecap came to be,
 * and the fingerprint check's script. It lists ten elements of an axe issue (`MOST_ELEMENTS`) and
 * counts the rest, which the page and the JSON keep, so a site with many issues stays a file a tool
 * can read. A page that has no transcripts, or no axe results, says why, in the page's words, so a
 * gap never reads as a pass.
 *
 * Every word of a record or a website is text, never Markdown (./escape.ts). What NVDA said, and
 * every record and fix that is code, is in a fenced block whose fence is longer than any run of
 * backticks in it, so nothing in it can end the block or become a heading. What a person or the
 * model supplies in the middle of voicecap's own sentences is escaped, and a plain web address in a
 * sentence of voicecap's own (the site's, a page's) is set in code, where it reads as it is. A run's
 * record may name the library that drives the screen reader; these files name none, and say
 * `AI_TEXT.driver` where a record does (`ownWords`, ./shared.ts, which the steps of a transcript
 * come from too).
 *
 * Deterministic: it reads the model and nothing else, so the same model gives the same bytes. The
 * file ends with one newline. Pure.
 */
import { PASS_NAMES, type PassName } from "../../model.js";
import type { AttentionCard } from "../attention.js";
import { attentionWords, type AttentionWords } from "../attention-words.js";
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
import type { DiffLine, OnlyInOnePage, PageChange } from "../changes.js";
import { count, pagePath, pageTitle } from "../format.js";
import { firstSentenceBold, type Inline, type Line } from "../line.js";
import type {
  AppendixFile,
  EvidenceRow,
  NoLongerListed,
  PageCard,
  RunEvidence,
  ShareModel,
} from "../model.js";
import type { Problem } from "../problems.js";
import { notRecordedBy, versionOf } from "../run-evidence.js";
import type { Summary } from "../summary.js";
import {
  AI_TEXT,
  APPENDIX_TEXT,
  ATTENTION_TEXT,
  AXE_TEXT,
  CHANGES_TEXT,
  COVERAGE_TEXT,
  DETAILS_TEXT,
  EVIDENCE_TEXT,
  GLANCE_TEXT,
  PAGES_TEXT,
  PASS_TITLE,
  PASS_WORDS,
  PROBLEMS_TEXT,
  SUMMARY_TEXT,
  TOP_TEXT,
  WORD_TEXT,
} from "../text.js";
import { verdictOf } from "../verdict.js";
import {
  attentionGist,
  axeFingerprint,
  byteCount,
  capturedOf,
  changedRules,
  changesGist,
  countsOf,
  decidedFrom,
  evidenceGist,
  fileFingerprint,
  flagsLine,
  fromRun,
  generatedLine,
  glanceNumbersOf,
  happenedLine,
  heardFirstLine,
  kindTitle,
  lineCount,
  manualLine,
  notRecordedLine,
  onlyInOneLead,
  onPage,
  originOf,
  pagesGist,
  passHeading,
  problemTime,
  problemTitle,
  readCopyNote,
  recordTime,
  runTitle,
  sameLines,
  sentence,
  sizesOf,
  spokenDuration,
  testedLine,
  titleOf,
  whenOf,
  whereOf,
  type NumberTile,
} from "../words.js";
import {
  escapeInline,
  escapeLeading,
  escapeSentence,
  fenced,
  inlineCode,
  markdownInline,
  markdownSentence,
  markdownText,
} from "./escape.js";
import { ownWords, stepsOf } from "./shared.js";

/**
 * A block of the file: one or more lines, with no blank line in it but a fence's own. The blocks are
 * set apart by a blank line each, so a paragraph, a list, and a fence never run into one another.
 */
type Block = string;

// Words, a line at a time.

/** A heading, its words on one line and escaped: the words of a record can't make another block. */
const heading = (level: number, words: string): Block =>
  `${"#".repeat(level)} ${markdownInline(words)}`;

/** A paragraph of words. */
const paragraph = (words: string): Block => markdownText(words);

/** A bold label, alone in its paragraph, before what it labels. */
const label = (words: string): Block => `**${markdownInline(words)}**`;

/** A label in bold, then what it labels, in one paragraph: "Likely cause: …". */
const labelled = (words: string, said: string): Block =>
  `**${markdownInline(`${words}:`)}** ${markdownInline(said)}`;

/** An item of a list, its words escaped. */
const item = (words: string, depth = 0): string => `${"  ".repeat(depth)}- ${markdownText(words)}`;

/**
 * An item of a list whose words are already Markdown: the words escaped, a name or address in code.
 * What would begin a block at its start is escaped as well (`escapeLeading`, as `item` does for
 * words), since an item that begins with a label is no place for the label's "#", ">", or "1." to
 * make a heading, a quote, or a list of its own: `markdownInline` leaves a line's start alone.
 */
const markupItem = (markup: string, depth = 0): string =>
  `${"  ".repeat(depth)}- ${escapeLeading(markup)}`;

/** A list, an item for each of the words. */
const bullets = (list: readonly string[]): Block => list.map((words) => item(words)).join("\n");

/**
 * A list of sentences of voicecap's own, an item for each: they may hold the addresses of the site's
 * pages, which are set in code (`markdownSentence`).
 */
const sentenceList = (list: readonly string[]): Block =>
  list.map((words) => markupItem(markdownSentence(words))).join("\n");

/** A list, in order, with the numbers its words don't have. */
const numbered = (list: readonly string[]): Block =>
  list.map((words, at) => `${at + 1}. ${markdownText(words)}`).join("\n");

/** Words with a full stop, when they have none. */
const asSentence = (words: string): string =>
  sentence(`${words.charAt(0).toUpperCase()}${words.slice(1)}`);

/** A label and its value, as one line of a block of lines: the value on its own when it has no label. */
const rowOf = ({ label: name, value }: EvidenceRow): string =>
  value === "" ? ownWords(name) : `${ownWords(name)}: ${ownWords(value)}`;

// A line, as the page and its Word copy say it: pieces of words, in bold, in code, or linked out.

/** A character that would end a link's address, or make it a second one, as a percent code. */
const addressOf = (href: string): string =>
  href.replace(
    /[\s()<>]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );

/** Words in bold, with the spaces around them outside the marks, where a mark can't have them. */
function strong(words: string): string {
  const inner = words.trim();
  if (inner === "") return words;
  return `${/^\s/.test(words) ? " " : ""}**${inner}**${/\s$/.test(words) ? " " : ""}`;
}

/**
 * One piece of a line as Markdown: words escaped (a line is voicecap's own, so the addresses of the
 * site's pages in it are set in code), a name in code, a link, a part in bold.
 */
function pieceOf(piece: Inline): string {
  if (typeof piece === "string") return escapeSentence(piece.replace(/\s+/g, " "));
  if (piece.mono === true) return inlineCode(piece.text);
  const text = piece.text.replace(/\s+/g, " ");
  const said =
    piece.href === undefined
      ? escapeSentence(text)
      : `[${escapeInline(text).trim()}](${addressOf(piece.href)})`;
  return piece.bold === true ? strong(said) : said;
}

/** A line as one line of Markdown, escaped at its start when it starts with words. */
function lineOf(line: Line): string {
  const joined = line.map(pieceOf).join("").trim();
  return typeof line[0] === "string" ? escapeLeading(joined) : joined;
}

// The top.

/**
 * The title, with what the file is about under it. The line under it gives the date the site was
 * tested and the date the report is as of, as the page does, who prepared it, the screen reader, and
 * the voicecap that made the latest run: the files lead with the site's name and the date, never an
 * address. The site's address is last, as the page puts it. A site with a name set for it has the
 * name under the title.
 */
function topBlocks({ header, evidence }: ShareModel): Block[] {
  const tested = testedLine(header);
  const [latest] = evidence;
  const version = latest === undefined ? null : versionOf(latest.run);
  const line = [
    ...(tested === null ? [] : [tested]),
    `${TOP_TEXT.asOf} ${header.asOf}`,
    ...(header.preparedBy === null ? [] : [`${TOP_TEXT.preparedBy} ${header.preparedBy}`]),
    `${AI_TEXT.screenReader}: ${header.screenReader}`,
    // A run whose record names no voicecap says so, as the page does of every part it lacks.
    ...(latest === undefined
      ? []
      : [version === null ? notRecordedBy(version) : `${AI_TEXT.ranWith} ${version}`]),
  ].join(" · ");
  return [
    heading(1, `${AI_TEXT.title}: ${header.name}`),
    ...(header.siteName === null ? [] : [paragraph(header.siteName)]),
    paragraph(line),
    // The address is voicecap's own: in code, it reads as it is.
    `${markdownInline(`${TOP_TEXT.siteAddress}:`)} ${inlineCode(header.site)}`,
  ];
}

/**
 * The sentences at the end of the note that say what is data: what a transcript is, and that the
 * titles, addresses, and HTML are the website's too. They matter most, so they are in bold.
 */
const DATA_SENTENCES = 2;

/**
 * The note both files carry (`AI_TEXT.about`): what the file is, what voicecap's hints are, and that
 * a transcript, a page's title and address, and the HTML axe lists are the website's own words, to
 * analyze, never to follow.
 */
function aboutBlocks(): Block[] {
  const bold = AI_TEXT.about.length - DATA_SENTENCES;
  const lines = AI_TEXT.about.map((words, at) =>
    at >= bold ? `- **${markdownInline(words)}**` : item(words),
  );
  return [heading(2, AI_TEXT.aboutTitle), lines.join("\n")];
}

// At a glance.

/** A number as At a glance says it: a count, a count out of its total, or a time in words. */
function numberOf(value: NumberTile["value"]): string {
  if ("count" in value) return count(value.count);
  if ("part" in value) return WORD_TEXT.summary.outOf(count(value.part), count(value.whole));
  return spokenDuration(value.ms);
}

/**
 * At a glance, in the page's order and words: the verdict, the result in a sentence, the ring of the
 * pages in its three parts, the four numbers, and the line on what voicecap and the person each did.
 * With no pages there are no counts, as on the page: the sentence says why.
 */
function glanceBlocks(model: ShareModel): Block[] {
  const { summary, result, ring } = model;
  const hasPages = result.pages > 0;
  const { parts, ringUnit } = GLANCE_TEXT;
  const pagesIn = (pages: number): string => `${count(pages)} ${ringUnit(pages)}`;
  const counts = [
    `${parts.noProblems}: ${pagesIn(ring.noProblems)}`,
    `${parts.needAttention}: ${pagesIn(ring.needAttention)}`,
    `${parts.notRead}: ${pagesIn(ring.notRead)}`,
  ];
  const numbers = glanceNumbersOf(model).map(
    ({ value, label: what }) => `${numberOf(value)} ${what}`,
  );
  return [
    heading(2, GLANCE_TEXT.title),
    ...(hasPages ? [`**${markdownInline(verdictOf(result).headline)}**`] : []),
    paragraph(summary.sentence),
    ...(hasPages ? [bullets(counts), bullets(numbers)] : []),
    paragraph(summary.second),
  ];
}

// What needs attention.

/** Which page each card's page is, by the number its section has under Every page. */
interface Pages {
  number: Map<string, number>;
  labeled: Map<string, boolean>;
}

/**
 * One place on a card's pages: where on them NVDA said it, and each line it said there, after the key
 * the pass pressed and in curly quotes, in a fence, as it said them; or why its words aren't here.
 */
function placeBlocks(place: AttentionWords["places"][number]): Block[] {
  return [
    paragraph(place.lead),
    ...(place.quotes.length === 0
      ? []
      : [fenced(place.quotes.map(({ pass, line }) => `${pass}: “${line}”`))]),
    ...(place.unavailable === null ? [] : [paragraph(place.unavailable)]),
  ];
}

/** One fix: what to change, the code to change it with in a fence, and what NVDA should say then. */
function fixBlocks(fix: AttentionWords["fixes"][number]): Block[] {
  return [
    paragraph(fix.lead),
    fenced(fix.code.split("\n"), "html"),
    ...(fix.after === null ? [] : [labelled(ATTENTION_TEXT.labels.after, fix.after)]),
  ];
}

/**
 * A page of a card, as an item of a list: by its number under Every page, and its name as the page
 * names it, with its path after the name of a page that has a label, and its reason or its note
 * after a colon when it has one. A page with no label is named by its address, which is voicecap's
 * own, so it is set in code; a label, a path, and a note are words, and are escaped.
 */
function cardPage(page: AttentionCard["pages"][number], pages: Pages): string {
  const number = pages.number.get(page.slug);
  const labeled = pages.labeled.get(page.slug);
  const name =
    labeled === false
      ? inlineCode(page.name)
      : labeled === true
        ? `${markdownInline(page.name)} (${markdownInline(page.path)})`
        : markdownInline(page.name);
  const detail =
    page.detail === null || page.detail.trim() === "" ? "" : `: ${markdownInline(page.detail)}`;
  const lead = number === undefined ? "" : `${markdownInline(`${AI_TEXT.page(number)}:`)} `;
  return markupItem(`${lead}${name}${detail}`);
}

/** A card: its title and count, where NVDA said it, its cause, why it matters, its fixes, its path, and its pages. */
function cardBlocks(card: AttentionCard, number: number, pages: Pages): Block[] {
  const words = attentionWords(card);
  const { labels } = ATTENTION_TEXT;
  return [
    heading(3, `${number}. ${words.title}`),
    paragraph(words.count),
    ...words.places.flatMap(placeBlocks),
    labelled(labels.cause, words.cause),
    labelled(labels.why, words.why),
    ...(words.fixes.length === 0
      ? []
      : [label(`${labels.fix}:`), ...words.fixes.flatMap(fixBlocks)]),
    label(`${labels.path}:`),
    numbered(words.path),
    label(`${card.pages.length === 1 ? labels.page : labels.pages}:`),
    card.pages.map((page) => cardPage(page, pages)).join("\n"),
  ];
}

/**
 * What needs attention, as the page has it: its heading, the line under it, and a card for each
 * problem in the cards' order. With no card it is nothing, as it is on the page: At a glance's
 * verdict says that nothing needs attention.
 */
function attentionBlocks(model: ShareModel, pages: Pages): Block[] {
  if (model.attention.length === 0) return [];
  return [
    heading(2, ATTENTION_TEXT.title),
    lineOf(attentionGist(model)),
    ...model.attention.flatMap((card, at) => cardBlocks(card, at + 1, pages)),
  ];
}

// Every page.

/**
 * A transcript: its heading, its file's size and fingerprint (the whole file's, as its run recorded
 * them), and what NVDA said, a step a line, in a fence: the step's number, the key, and the words
 * (`stepsOf`). A transcript with no lines says so.
 */
function transcriptBlocks(file: AppendixFile, path: string): Block[] {
  const title = `${PASS_TITLE[file.pass]} ${APPENDIX_TEXT.transcriptOf} ${path}, ${lineCount(file.lines)}`;
  return [
    heading(5, title),
    lineOf(fileFingerprint(file)),
    file.lines === 0
      ? paragraph(APPENDIX_TEXT.noLines)
      : fenced(stepsOf(file).map(({ n, key, said }) => `${n}. ${key}: ${said}`)),
  ];
}

/** A transcript the run recorded but that couldn't be read here, said in its place. */
function unreadableBlocks(pass: PassName, path: string): Block[] {
  return [
    heading(5, `${PASS_TITLE[pass]} ${APPENDIX_TEXT.transcriptOf} ${path}`),
    paragraph(sentence(APPENDIX_TEXT.unreadable)),
  ];
}

/** A page's transcripts: the run they are from, and one for each pass the run recorded. */
function saidBlocks(
  card: PageCard,
  entry: ShareModel["appendix"][number],
  latest: string | null,
): Block[] {
  const passes = PASS_NAMES.filter(
    (pass) => entry.files.some((file) => file.pass === pass) || entry.unreadable.includes(pass),
  );
  const origin = originOf(card, latest);
  return [
    heading(4, AI_TEXT.said),
    ...(origin === null ? [] : [lineOf(origin)]),
    ...passes.flatMap((pass) => {
      const file = entry.files.find((each) => each.pass === pass);
      return file === undefined
        ? unreadableBlocks(pass, card.path)
        : transcriptBlocks(file, card.path);
    }),
    ...(passes.length === 0 ? [paragraph(APPENDIX_TEXT.noFiles)] : []),
  ];
}

/** What a page's record says of how it ended and where its transcripts come from, as sentences. */
function resultOf(card: PageCard): string {
  const from = fromRun(card);
  return [
    sentence(ownWords(card.statusText)),
    ...(card.failure === null ? [] : [sentence(ownWords(card.failure))]),
    ...(from === null ? [] : [sentence(from)]),
  ].join(" ");
}

/**
 * A page's flags, as the page's chips say them: that nothing was read to flag, that it has none, or
 * a line for each flag with its rule in code, its pass, and voicecap's message; then, when they are,
 * that they are as the run recorded them.
 */
function flagLines(card: PageCard): string[] {
  if (card.counts === null) return [item(`${WORD_TEXT.pages.nothingToFlag}.`)];
  const recorded = card.flagsAsRecorded ? [item(sentence(PAGES_TEXT.flagsAsRecorded))] : [];
  if (card.flags.length === 0) return [item(sentence(PAGES_TEXT.noFlags)), ...recorded];
  return [
    item(`${PAGES_TEXT.flagsRaised}:`),
    ...card.flags.map((flag) => {
      const pass = flag.pass === undefined ? "" : ` (${PASS_WORDS[flag.pass]} pass)`;
      return `  - ${inlineCode(flag.rule)}${pass}: ${markdownInline(flag.message)}`;
    }),
    ...recorded,
  ];
}

/**
 * The person's review as far as the records show it: each chip's words, then each manual NVDA
 * session. Nothing when they show none, since a copy never says what a person hasn't done.
 */
function reviewLines(card: PageCard): string[] {
  const review = [...card.reviewChips, ...card.manual.map(manualLine)];
  return review.length === 0
    ? []
    : [item(`${AI_TEXT.review}:`), ...review.map((words) => item(words, 1))];
}

/** What each pass captured and how long the page took, as one sentence, for a page with transcripts. */
function capturedLines(card: PageCard): string[] {
  const captured = capturedOf(card);
  if (captured === null) return [];
  const said = captured.map(({ label: what, value }) => `${what}: ${value}`).join("; ");
  return [item(`${AI_TEXT.captured}: ${sentence(said)}`)];
}

/** What a page says of itself, a line each: its title, its result, its flags, its review, and its numbers. */
function factsBlock(card: PageCard): Block {
  const title = titleOf(card);
  return [
    ...(title === null ? [] : [item(title)]),
    item(`${AI_TEXT.result}: ${resultOf(card)}`),
    ...flagLines(card),
    ...reviewLines(card),
    ...capturedLines(card),
  ].join("\n");
}

/**
 * What NVDA said first on the page: a label and the first lines of its read pass, word for word,
 * each in curly quotes (but for a step where it said nothing, which is the marker the transcript
 * writes, as it is: see `heardFirstLine`), in a fence. A page with none has none.
 */
function heardFirstBlocks({ heardFirst }: PageCard): Block[] {
  if (heardFirst.length === 0) return [];
  return [label(PAGES_TEXT.heardFirst), fenced(heardFirst.map(heardFirstLine))];
}

// What axe found.

/**
 * axe's words on how to fix an element, or every element of a rule, as lines of text under their
 * label: each lead on a line, and each thing under it on a line of its own after a dash.
 */
function fixLines(words: string, summary: string): string[] {
  const parts = axeFix(summary);
  if (parts.length === 0) return [];
  return [
    `${words}:`,
    ...parts.flatMap(({ lead, items }) => [lead, ...items.map((each) => `– ${each}`)]),
  ];
}

/** An element a rule found: its selector and its HTML, each on a line under its label, and axe's words on how to fix it. */
function elementLines(node: AxeViewRule["nodes"][number], saidOnce: boolean): string[] {
  return [
    `${AXE_TEXT.element}: ${axeSelector(node.target)}`,
    // One line: a run of spaces that holds a line break is one space.
    `${AXE_TEXT.html}: ${node.html.replace(/\s+/g, (run) => (/[\r\n]/.test(run) ? " " : run))}`,
    ...(saidOnce ? [] : fixLines(AXE_TEXT.fix, node.failureSummary)),
  ];
}

/**
 * The most elements of one axe issue the file lists. axe's file keeps up to 50 for a rule, each with
 * up to 300 characters of HTML, so a site with many issues would make them most of the file; the
 * page and the JSON keep them all. The rest are counted ("and 40 more elements").
 */
export const MOST_ELEMENTS = 10;

/**
 * A rule axe found the page broke, or that needs review, as the card's fold has it: axe's words for
 * it as its heading, with its id in code; its impact and the WCAG success criteria it tests (or that
 * it's a best practice), as the fold's line says them; and, in a fence, axe's words on how to fix
 * its elements, once, when every element its file keeps shares them, then the first `MOST_ELEMENTS`
 * of the elements, each with its selector and HTML (and its own words when they differ), and how
 * many more there were, those its file keeps and those it only counts. Last, axe's own page on the
 * rule, when it is one.
 */
function ruleBlocks(rule: AxeViewRule): Block[] {
  const criteria = axeCriteria(rule.tags);
  const about = [AXE_TEXT.impact(rule.impact), ...(criteria === "" ? [] : [criteria])].join(" · ");
  const shared = axeSharedFix(rule);
  const once = shared === null ? [] : fixLines(AXE_TEXT.fixShared(rule.nodes.length), shared);
  const listed = rule.nodes.slice(0, MOST_ELEMENTS);
  const elements = listed.flatMap((node, at) => [
    ...(at === 0 ? [] : [""]),
    ...elementLines(node, shared !== null),
  ]);
  const unlisted = rule.nodes.length - listed.length + rule.moreNodes;
  const more = unlisted > 0 ? [AXE_TEXT.more(unlisted)] : [];
  const evidence = [
    ...once,
    ...(once.length > 0 && elements.length > 0 ? [""] : []),
    ...elements,
    ...more,
  ];
  const address = axeRulePage(rule.helpUrl);
  // axe's words for the rule, when it gave any, with its id after; else the id alone.
  const help = markdownInline(rule.help);
  return [
    `###### ${help === "" ? inlineCode(rule.id) : `${help} (${inlineCode(rule.id)})`}`,
    paragraph(about),
    ...(evidence.length === 0 ? [] : [fenced(evidence)]),
    ...(address === null
      ? []
      : [`${markdownInline(AXE_TEXT.rulePage(rule.id))}: ${inlineCode(address)}`]),
  ];
}

/**
 * The counts of what axe found as one sentence: the issues, how many of them are of each impact,
 * what needs review, and the rules passed.
 */
function axeCounts(view: AxeView): string {
  const { counts: names } = AXE_TEXT;
  const impacts = axeImpacts(view);
  const counts: [string, number][] = [
    [names.issues, view.violations.length],
    [names.critical, impacts.critical],
    [names.serious, impacts.serious],
    [names.moderate, impacts.moderate],
    [names.minor, impacts.minor],
    [names.incomplete, view.incomplete.length],
    [names.passes, view.counts.passes],
  ];
  return sentence(counts.map(([term, value]) => `${term}: ${count(value)}`).join("; "));
}

/**
 * What axe found on a page, as its card's fold has it: what axe is, its version and the rules it
 * ran, the counts, the issues most severe first (or that axe found none), what needs review, and the
 * file's size and fingerprint as its run recorded them. Without results, the card's reason: a line
 * that says nothing was recorded or shown never reads as a pass. None for a card that says nothing
 * of axe.
 */
function axeBlocks({ axe }: PageCard): Block[] {
  if (axe === undefined) return [];
  const title = heading(4, AXE_TEXT.title);
  if ("notRecorded" in axe) return [title, paragraph(notRecordedLine(ownWords(axe.notRecorded)))];
  const { view } = axe;
  const issues =
    view.violations.length === 0
      ? [paragraph(AXE_TEXT.none)]
      : [
          heading(5, `${AXE_TEXT.issues.title}${AXE_TEXT.issues.after}`),
          ...view.violations.flatMap(ruleBlocks),
        ];
  const review =
    view.incomplete.length === 0
      ? []
      : [
          heading(5, AXE_TEXT.review),
          paragraph(AXE_TEXT.reviewLead),
          ...view.incomplete.flatMap(ruleBlocks),
        ];
  return [
    title,
    paragraph(AXE_TEXT.what),
    paragraph(AXE_TEXT.version(view.axeVersion, axeRulesRun(view.tags))),
    paragraph(axeCounts(view)),
    ...issues,
    ...review,
    lineOf(axeFingerprint(axe)),
  ];
}

/**
 * A page: its heading, with its number, its label and its path, or its path alone (the site's
 * address is at the top of the file, and a whole address crowds a heading); what the page says of
 * itself; what NVDA said first; what axe found; and, last, its transcripts. A page with no
 * transcripts has none of them, and says so in its flags and its result.
 */
function pageBlocks(
  card: PageCard,
  number: number,
  transcripts: ShareModel["appendix"][number] | undefined,
  latest: string | null,
): Block[] {
  return [
    heading(3, `${number}. ${card.labeled ? `${card.name} (${card.path})` : card.path}`),
    factsBlock(card),
    ...heardFirstBlocks(card),
    ...axeBlocks(card),
    ...(transcripts === undefined ? [] : saidBlocks(card, transcripts, latest)),
  ];
}

/** The pages earlier runs tested that the latest list no longer has, with what their last run recorded. */
function noLongerListedBlocks(gone: NoLongerListed[]): Block[] {
  if (gone.length === 0) return [];
  const [, last = "", recorded = ""] = PAGES_TEXT.noLongerListedHead;
  // A page with no label is named by its address, which is voicecap's own: in code. A label is words.
  const named = ({ name, url }: NoLongerListed): string =>
    name === url ? inlineCode(url) : `${markdownInline(name)} (${inlineCode(url)})`;
  return [
    heading(3, PAGES_TEXT.noLongerListed),
    paragraph(PAGES_TEXT.noLongerListedLead),
    gone
      .map((page) =>
        markupItem(
          `${named(page)}. ${markdownInline(`${last}: ${page.lastRun}.`)} ${markdownInline(`${recorded}: ${page.lastStatus}.`)}`,
        ),
      )
      .join("\n"),
  ];
}

/**
 * Every page: the line on how many were read in full, then a section for each page in the latest
 * run's order, with its number, and last the pages no longer listed.
 */
function pagesBlocks(model: ShareModel): Block[] {
  // The model keeps a page's transcripts apart from its card, by the page's slug.
  const transcripts = new Map(model.appendix.map((entry) => [entry.slug, entry]));
  const latest = model.evidence[0]?.run.id ?? null;
  return [
    heading(2, PAGES_TEXT.title),
    lineOf(pagesGist(model)),
    ...model.pages.flatMap((card, at) =>
      pageBlocks(card, at + 1, transcripts.get(card.slug), latest),
    ),
    ...noLongerListedBlocks(model.noLongerListed),
  ];
}

// The details.

/**
 * A part of the details, under its heading, with a list of sentences of voicecap's own, which may
 * hold the addresses of the site's pages: nothing when it has none.
 */
function listPart(title: string, lines: readonly string[]): Block[] {
  return lines.length === 0 ? [] : [heading(3, title), sentenceList(lines)];
}

// What changed since the last run.

/**
 * A pass's changes as the lines of a fence: each line's fate in the page's words ("Same", "Removed",
 * "Added"), then the line as NVDA said it; a run of lines the same is counted ("… 12 lines the
 * same"). The page marks the words that differ in a changed line; a fence can't, and shows the line.
 */
function changeLines(lines: DiffLine[]): string[] {
  const { rows } = CHANGES_TEXT;
  const width = Math.max(rows.same.length, rows.removed.length, rows.added.length) + ": ".length;
  const said = (fate: string, text: string): string => `${fate}: `.padEnd(width) + text;
  return lines.map((line) => {
    switch (line.kind) {
      case "collapsed":
        return `${rows.collapsed} ${sameLines(line.count)}`;
      case "same":
        return said(rows.same, line.text);
      case "removed":
        return said(rows.removed, line.text);
      case "added":
        return said(rows.added, line.text);
    }
  });
}

/**
 * A page that sounds different: its name and how many lines changed in each pass, as a heading; the
 * rules whose flag went or came; each pass's changes, under a heading of its own with the page's
 * address and how many lines; each pass that sounds different but whose transcript can't be read; and
 * each flag.
 */
function changedPageBlocks(page: PageChange): Block[] {
  const { resolved, fresh } = changedRules(page.flags);
  const rules = [
    ...resolved.map((rule) => `${inlineCode(rule)} ${markdownInline(CHANGES_TEXT.rules.resolved)}`),
    ...fresh.map((rule) => `${inlineCode(rule)} ${markdownInline(CHANGES_TEXT.rules.fresh)}`),
  ];
  const flags = flagsLine(page.flags);
  const address = pagePath(page.url);
  return [
    heading(4, `${pageTitle(page)}: ${countsOf(page)}`),
    ...(rules.length === 0 ? [] : [rules.join("; ")]),
    ...page.passes.flatMap((change) => [
      heading(
        5,
        `${passHeading(change.pass)} ${onPage(address)}: ${sizesOf(change.removed, change.added)}`,
      ),
      ...(change.lines.length === 0 ? [] : [fenced(changeLines(change.lines))]),
    ]),
    ...page.unreadable.map((pass) => paragraph(CHANGES_TEXT.unreadable(pass))),
    ...(flags === null ? [] : [lineOf(flags)]),
  ];
}

/** The pages read in full in only one of the two runs, which can't be compared, each with its reason. */
function onlyInOneBlocks(pages: OnlyInOnePage[]): Block[] {
  if (pages.length === 0) return [];
  return [
    lineOf(onlyInOneLead(pages)),
    pages
      .map((page) =>
        markupItem(
          `**${markdownInline(pageTitle(page))}**: ${markdownInline(`${CHANGES_TEXT.reasons[page.reason]}.`)}`,
        ),
      )
      .join("\n"),
  ];
}

/**
 * What changed since the last run, as the page has it: the tools or passes that differ between the
 * two runs, the section's line, the two runs compared, the pages read in only one of them, and each
 * page that sounds different, with what changed in each pass, line by line. With no run before to
 * compare with, it says so, as the page does, under its heading.
 */
function changesBlocks({ changes }: ShareModel): Block[] {
  const title = heading(3, CHANGES_TEXT.title);
  if (changes === null) return [title, `**${markdownInline(CHANGES_TEXT.none)}**`];
  const gist = changesGist(changes);
  return [
    title,
    ...(changes.tools.length === 0
      ? []
      : [lineOf(CHANGES_TEXT.tools()), sentenceList(changes.tools.map(ownWords))]),
    ...(changes.passesNote === null ? [] : [markdownSentence(changes.passesNote)]),
    lineOf(firstSentenceBold(changes.line)),
    ...(gist === null ? [] : [lineOf(gist)]),
    ...onlyInOneBlocks(changes.onlyInOne),
    ...changes.changed.flatMap(changedPageBlocks),
  ];
}

/** What a bar's title says beside it, as a sentence of its own: with a capital and a full stop. */
const noteOf = (words: string): string => asSentence(words);

/** "Flags by rule": how often each rule was raised, or that no flag was. */
function rulesBlocks({ bars }: Summary): Block[] {
  const rows = bars.flagsByRule.map(
    ({ rule, count: times }) => `- ${inlineCode(rule)}: ${count(times)}`,
  );
  return [
    heading(3, SUMMARY_TEXT.rules),
    paragraph(noteOf(SUMMARY_TEXT.rulesNote)),
    rows.length === 0 ? paragraph(SUMMARY_TEXT.noFlagsRaised) : rows.join("\n"),
  ];
}

/** "The human review": each count out of its total, so nothing looks complete that isn't. */
function reviewBlocks({ bars }: Summary): Block[] {
  const { reviewRows } = SUMMARY_TEXT;
  const { reviewed, fixed } = bars.review;
  const outOf = ([part, whole]: [number, number]): string =>
    WORD_TEXT.summary.outOf(count(part), count(whole));
  return [
    heading(3, SUMMARY_TEXT.review),
    paragraph(noteOf(SUMMARY_TEXT.reviewNote)),
    bullets([`${reviewRows.reviewed}: ${outOf(reviewed)}`, `${reviewRows.fixed}: ${outOf(fixed)}`]),
  ];
}

/** What these results cover, and the technical limits, as the model words them. */
function coverageBlocks({ coverage }: ShareModel): Block[] {
  const panel = (title: string, lines: string[]): Block[] =>
    lines.length === 0 ? [] : [label(title), sentenceList(lines.map(ownWords))];
  return [
    heading(3, COVERAGE_TEXT.title),
    ...panel(COVERAGE_TEXT.covered, coverage.covered),
    ...panel(COVERAGE_TEXT.limits, coverage.limits),
  ];
}

/**
 * A run: when it ran and that it completed and was sealed, its facts, and the test environment it
 * recorded (who ran it, the computer, the screen reader and the browser, and the settings), a line
 * for each, in a fence.
 */
function runBlocks({ run, facts, environment }: RunEvidence): Block[] {
  return [
    heading(4, runTitle(run.id)),
    paragraph(`${whenOf(run)}. ${WORD_TEXT.evidence.status}`),
    bullets(facts.map(rowOf)),
    label(EVIDENCE_TEXT.parts.environment),
    fenced(environment.map(rowOf)),
  ];
}

/**
 * The evidence behind the results: how many runs, and that each completed and was sealed; that the
 * runs read a copy of the site, when they did; a run each; and the runs left out.
 */
function evidenceBlocks(model: ShareModel): Block[] {
  const note = readCopyNote(model);
  const { title, lead, why } = EVIDENCE_TEXT.leftOut;
  return [
    heading(3, EVIDENCE_TEXT.title),
    lineOf(evidenceGist(model)),
    ...(note === null ? [] : [paragraph(note)]),
    ...model.evidence.flatMap(runBlocks),
    ...(model.leftOut.length === 0
      ? []
      : [
          label(title),
          paragraph(`${lead} ${why}`),
          bullets(model.leftOut.map(({ text }) => text)),
        ]),
  ];
}

/**
 * A problem's questions and answers, a line each: what happened (with which program came to the
 * front, for a foreground loss whose run recorded it), how its kind was decided for an older run's
 * wording, what voicecap did, whether it happened again, the effect on the results, and, for an error
 * voicecap didn't expect, where to report it.
 */
function questionLines(problem: Problem): string[] {
  const questions = PROBLEMS_TEXT.questions;
  const answers: [string, string][] = [
    [questions.happened, happenedLine(problem)],
    ...(problem.fromWording
      ? [[questions.decided, decidedFrom(problem.kind)] as [string, string]]
      : []),
    [questions.did, sentence(problem.did)],
    [questions.again, sentence(problem.verdict)],
    [questions.effect, sentence(problem.effect)],
  ];
  return [
    ...answers.map(([asked, said]) => item(`${asked}: ${ownWords(said)}`)),
    ...(problem.kind === "unexpected"
      ? [`- ${markdownInline(`${questions.report}:`)} ${lineOf(PROBLEMS_TEXT.report())}`]
      : []),
  ];
}

/**
 * The record of a problem, word for word, a line for each entry: its time (or that the run kept
 * none), where it is from, and what was recorded, in a fence. An entry of more than one line keeps
 * the rest under it. A stack is shown apart, where its lines can be read.
 */
function recordLines(problem: Problem): string[] {
  return problem.record
    .filter((entry) => entry.source !== "stack")
    .flatMap((entry) => {
      const [first = "", ...rest] = ownWords(entry.entry).split(/\r?\n/);
      return [
        `${recordTime(entry.time)} · ${entry.source} · ${first}`,
        ...rest.map((line) => `    ${line}`),
      ];
    });
}

/**
 * A problem: its heading, its line (when it happened, its kind, and whether it happened again), its
 * questions and answers, the record of it, its stack when it has one, and each line of what the run
 * didn't record, so a gap never reads as a pass. `nth` is its place among the page's problems in the
 * run, from 1.
 */
function problemBlocks(problem: Problem, nth: number): Block[] {
  const where = whereOf(problem, nth);
  const record = recordLines(problem);
  return [
    heading(4, problemTitle(problem)),
    paragraph(
      [problemTime(problem), kindTitle(problem.kind), PROBLEMS_TEXT.again[problem.again]]
        .map(asSentence)
        .join(" "),
    ),
    questionLines(problem).join("\n"),
    ...(record.length === 0
      ? []
      : [heading(5, `${PROBLEMS_TEXT.record.title}, ${where}`), fenced(record)]),
    ...(problem.stack === null
      ? []
      : [
          heading(5, `${PROBLEMS_TEXT.stack}, ${where}`),
          fenced(ownWords(problem.stack).split(/\r?\n/)),
        ]),
    ...problem.notRecorded.map((line) => paragraph(notRecordedLine(ownWords(line)))),
  ];
}

/** The problems during the runs: the section's line, and each problem, oldest first. */
function problemsBlocks({ problems: section }: ShareModel): Block[] {
  const { problems, line } = section;
  const seen = new Map<string, number>();
  return [
    heading(3, PROBLEMS_TEXT.title),
    lineOf(firstSentenceBold(ownWords(line))),
    ...(problems.length === 0 ? [] : [paragraph(PROBLEMS_TEXT.gist)]),
    ...problems.flatMap((problem) => {
      const page = JSON.stringify([problem.run, problem.page.slug]);
      const nth = (seen.get(page) ?? 0) + 1;
      seen.set(page, nth);
      return problemBlocks(problem, nth);
    }),
  ];
}

/**
 * The fingerprints of every file each run recorded, run by run: the page it is of, its name, its
 * size, and its SHA-256, a line each, in a fence; with what a fingerprint is, and the command that
 * checks them against the originals.
 */
function fingerprintBlocks({ evidence }: ShareModel): Block[] {
  const [latest] = evidence;
  if (latest === undefined) return [];
  return [
    heading(3, EVIDENCE_TEXT.parts.fingerprints),
    lineOf(firstSentenceBold(EVIDENCE_TEXT.fingerprint)),
    ...evidence.flatMap(({ run, fingerprints }) => [
      heading(4, runTitle(run.id)),
      fingerprints.length === 0
        ? paragraph(EVIDENCE_TEXT.noFiles)
        : fenced(
            fingerprints.map(
              ({ page, file, bytes, sha256 }) =>
                `${page} · ${file} · ${byteCount(bytes)} · SHA-256 ${sha256}`,
            ),
          ),
    ]),
    `${markdownInline(EVIDENCE_TEXT.verify)} ${inlineCode(latest.verify)}`,
  ];
}

/**
 * The details, for reviewers and auditors: their heading and line, then each part: what is still to
 * do, how complete the test was, and when and how; what changed since the last run; what the
 * results cover; the two bars; the evidence, a run each; the problems during the runs; and the
 * fingerprints. Where no run counts there is nothing to count, so the parts that are counts are left
 * out, as the page leaves them out.
 */
function detailsBlocks(model: ShareModel): Block[] {
  const { summary } = model;
  const counted = model.header.tested !== null;
  return [
    heading(2, DETAILS_TEXT.title),
    paragraph(DETAILS_TEXT.gist),
    ...(counted
      ? [
          ...listPart(SUMMARY_TEXT.todo, summary.todo),
          ...listPart(
            SUMMARY_TEXT.complete,
            summary.changesLine === null
              ? summary.complete
              : [...summary.complete, summary.changesLine],
          ),
          ...listPart(
            SUMMARY_TEXT.whenHow,
            summary.whenHow.map(({ label: what, value }) => `${what}: ${value}`),
          ),
        ]
      : []),
    ...changesBlocks(model),
    ...coverageBlocks(model),
    ...(counted ? [...rulesBlocks(summary), ...reviewBlocks(summary)] : []),
    ...evidenceBlocks(model),
    ...problemsBlocks(model),
    ...fingerprintBlocks(model),
  ];
}

/**
 * The footer's line, after a rule: when the file was made, with its offset from UTC, and the offsets
 * the runs recorded their times in, since each time in the file is as its run recorded it.
 */
function closingBlocks({ footer }: ShareModel): Block[] {
  return ["---", paragraph(generatedLine(footer))];
}

/**
 * The report as Markdown for AI tools, from the page's model: one file, with the parts in the page's
 * order. See the top of this module for what is in it and how its words are set. It ends with one
 * newline.
 */
export function renderAiMarkdown(model: ShareModel): string {
  const pages: Pages = {
    number: new Map(model.pages.map((card, at) => [card.slug, at + 1])),
    labeled: new Map(model.pages.map((card) => [card.slug, card.labeled])),
  };
  const blocks = [
    ...topBlocks(model),
    ...aboutBlocks(),
    ...glanceBlocks(model),
    ...attentionBlocks(model, pages),
    ...pagesBlocks(model),
    ...detailsBlocks(model),
    ...closingBlocks(model),
  ];
  return `${blocks.filter((block) => block.trim() !== "").join("\n\n")}\n`;
}
