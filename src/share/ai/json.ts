/**
 * The shareable report as one JSON file, for programs and for structured questions put to an AI
 * tool: the same report as the Markdown beside it (./markdown.ts), as data, with the WCAG criteria
 * each finding may relate to. It is drawn from the same model the page and its Word copy are drawn
 * from (`ShareModel`), with the page's own words wherever the page has words for a part, and the
 * steps of a transcript and the words of a record as the Markdown says them (`stepsOf` and
 * `ownWords`, ./shared.ts), so the two files can't say different things. It imports nothing of the
 * page's or the Word copy's own renderers.
 *
 * `AiReport` is the file's shape, and the keys of each object are in the order it declares them:
 * the file is `JSON.stringify` of plain data built in that order, with a 2-space indent and one
 * newline at the end, so the same model gives the same bytes. Its parts follow the Markdown's: the
 * note (`AI_TEXT.about`, which both files carry), the header (the site's name and the dates, with
 * its address last), At a glance as `verdict`, `summary`, and `counts`, What needs attention, Every
 * page, and the details (what is still to do and how complete the test was, what changed since the
 * last run, what the results cover, the runs and their evidence, the problems during them, and the
 * fingerprints), then when it was made. A page's parts are in the spec's order: its address,
 * title, and status, its first lines, its passes' steps, its flags, axe's results, and the review.
 *
 * What it leaves out is what a file of data has no use for: the page's pictures and charts, each
 * run's minute-by-minute event log, its walkthrough files, how voicecap came to be, and the
 * fingerprint check's script. It keeps every element of an axe issue that axe's file keeps (up to
 * 50, with `moreElements` for those axe only counted), which the Markdown cuts to ten.
 *
 * Where a run didn't record a part, the value says so in the page's words as `{ notRecorded }`
 * (a title, how long a page took, axe's results, the voicecap a run used), and a part that isn't
 * there at all is `null`. No key is ever left out, which a reader could take for a part with
 * nothing to say. A page that wasn't read says so (`flagsNote`, `captured: null`, `passes: []`),
 * so no gap reads as a page with nothing to flag.
 *
 * Every word is plain text and is never changed: `JSON.stringify` writes it as a string, so what
 * a transcript, a title, or a record holds can't be anything but a string. What a person or a model
 * wrote about the library that drives the screen reader is said without its name (`ownWords`);
 * what a website said never is. A criterion is a number in a string ("2.4.4"); a flag's come from
 * voicecap's table (`RULE_WCAG`, src/flags/wcag.ts) and an axe issue's from axe's own tags
 * (`axeCriteriaList`), and the note says they are the criteria a finding may relate to, for a
 * person to decide.
 *
 * Pure: it reads the model and nothing else.
 */
import type { AxeImpact } from "../../axe/results.js";
import { wcagOf } from "../../flags/wcag.js";
import { AXE_FILE, PASS_NAMES, type PassName } from "../../model.js";
import type { AttentionCard, AttentionKind } from "../attention.js";
import { attentionWords } from "../attention-words.js";
import {
  axeCriteriaList,
  axeImpacts,
  axeRulePage,
  axeRulesRun,
  BEST_PRACTICE,
  type AxeViewRule,
} from "../axe-view.js";
import type { DiffLine, PageChange } from "../changes.js";
import { pagePath } from "../format.js";
import { lineText } from "../line.js";
import type { NoLongerListed, PageCard, RunEvidence, ShareModel } from "../model.js";
import type { Problem, ProblemKind } from "../problems.js";
import { notRecordedBy, runEnd, runStart, versionOf } from "../run-evidence.js";
import type { Summary } from "../summary.js";
import {
  AI_TEXT,
  APPENDIX_TEXT,
  CHANGES_TEXT,
  EVIDENCE_TEXT,
  PAGES_TEXT,
  PROBLEMS_TEXT,
  WORD_TEXT,
} from "../text.js";
import { verdictOf, type VerdictKind } from "../verdict.js";
import {
  changedRules,
  countsOf as changeCounts,
  decidedFrom,
  flagsLine,
  fromRun,
  generatedLine,
  happenedLine,
  kindTitle,
  manualLine,
  notRecordedLine,
  readCopyNote,
  sentence,
} from "../words.js";
import { ownWords, stepsOf, type Step } from "./shared.js";

/**
 * A part a run didn't record, said as the page says it: "Not recorded: this run used voicecap
 * 0.4.1." It stands where the part would be, so a gap never reads as a part with nothing in it.
 */
export interface AiNotRecorded {
  notRecorded: string;
}

/** A label and what a run recorded for it, as a row of the run's evidence. */
export interface AiRow {
  label: string;
  value: string;
}

/** A count out of its total, so a number never reads as complete when it isn't. */
export interface AiOutOf {
  count: number;
  of: number;
}

/** The verdict At a glance gives, by the one rule every place that says it uses. */
export interface AiVerdict {
  /** "ok" when nothing needs attention, "warn" when something does, "bad" when NVDA read fewer pages than are in scope. */
  kind: VerdictKind;
  /** In words, with no full stop: "2 problems need attention, on 1 page". */
  headline: string;
}

/** The numbers At a glance gives, and the ring of the pages. */
export interface AiCounts {
  /** The pages in scope. */
  pagesInScope: number;
  /** The pages NVDA read: those with transcripts. */
  pagesRead: number;
  /** The problems that need attention: a card of What needs attention for each. */
  problems: number;
  /** How many different pages those problems are on. */
  problemPages: number;
  /** The lines NVDA spoke, in the transcripts shown. */
  linesSpoken: number;
  /** How long the runs held NVDA, in milliseconds, for each session that has a recorded end. */
  nvdaMs: number;
  /** The runs the results draw on. */
  runs: number;
  /** The sessions that have no recorded end, which `nvdaMs` leaves out. */
  sessionsWithoutEnd: number;
  /** Each page is in one part, so the three add up to `pagesInScope`. */
  ring: {
    /** Read with no problems: transcripts, and on no card. */
    readNoProblems: number;
    /** Read with problems: transcripts, and a card names the page. */
    readWithProblems: number;
    /** Not read: no transcripts. */
    notRead: number;
  };
}

/** One place on a card's pages: where NVDA said it, and what it said there. */
export interface AiPlace {
  /** Where on the pages: "In the header, on 32 pages". */
  lead: string;
  /** The lines NVDA said there, by the key its pass presses, word for word. */
  said: { key: string; line: string }[];
  /** Why NVDA's words aren't here, for a card of a page whose transcripts couldn't be read. */
  unavailable: string | null;
}

/** One fix: what to change, the code to change it with, and what NVDA should say then. */
export interface AiFix {
  lead: string;
  /** The code, with its line breaks. */
  code: string;
  after: string | null;
}

/** A page of a card, by the number it has under `pages`. */
export interface AiCardPage {
  /** Null for a page of a card that has no section of its own. */
  number: number | null;
  name: string;
  path: string;
  /** An unread page's failure, or an issue's note, as the card says it. */
  detail: string | null;
}

/** One card of What needs attention: a problem, across the pages it is on. */
export interface AiCard {
  /** As the card is numbered in the Markdown: from 1. */
  number: number;
  /** "need-1", "need-2", and so on, in card order. */
  id: string;
  /** What kind of problem: "graphic-generic", "link-generic", "read-stopped", "unread", and so on. */
  kind: AttentionKind;
  title: string;
  count: { pages: number; times: number };
  places: AiPlace[];
  cause: string;
  why: string;
  fixes: AiFix[];
  /** The steps to take, in order. */
  pathForward: string[];
  pages: AiCardPage[];
}

/** A flag voicecap raised on a page: a hint for a person, never a verdict. */
export interface AiFlag {
  /** The rule's id: a built-in rule's, or a custom rule's own. */
  rule: string;
  /** The pass the flag was raised in; null for a flag with no pass. */
  pass: PassName | null;
  /** voicecap's message, which carries the count and what was found. */
  message: string;
  /**
   * The WCAG success criteria the rule may relate to, as numbers in strings ("2.4.4"), from
   * voicecap's table: none for a rule with none, and for a custom rule. A person decides.
   */
  wcag: string[];
}

/** One element an axe issue found. */
export interface AiAxeElement {
  /** Its selectors, one for each frame from the page in, as axe gives them. */
  target: string[];
  /** Its HTML, as axe's file keeps it: at most 300 characters. */
  html: string;
  /** axe's words on how to fix it, as axe wrote them: "" when it gave none. */
  fix: string;
}

/** A rule axe found the page broke, or that needs review. */
export interface AiAxeRule {
  id: string;
  /** axe's words for what the rule asks: "" when it gave none. */
  help: string;
  impact: AxeImpact | null;
  /** The WCAG success criteria the rule's tags name, as numbers in strings. */
  wcag: string[];
  /** Whether the rule is one of axe's best practices. */
  bestPractice: boolean;
  /** Every element axe's file keeps: up to 50, in axe's order. */
  elements: AiAxeElement[];
  /** How many more elements axe found than its file keeps. */
  moreElements: number;
  /** axe's own page on the rule, when the file names one there; else null. */
  helpUrl: string | null;
}

/** What axe found on a page, as its file keeps it. */
export interface AiAxeResults {
  /** axe-core's version. */
  version: string;
  /** The tags of the rules axe ran. */
  tags: string[];
  /** Those rules, in words: "WCAG 2.0 and 2.1 at levels A and AA, …". */
  rulesRun: string;
  counts: {
    issues: number;
    critical: number;
    serious: number;
    moderate: number;
    minor: number;
    needsReview: number;
    /** The rules that passed. */
    passes: number;
  };
  /** The rules the page broke, most severe first. */
  issues: AiAxeRule[];
  /** What axe couldn't decide, for a person to check. */
  needsReview: AiAxeRule[];
  /** The file's size and SHA-256, as its run recorded them. */
  file: { name: string; bytes: number; sha256: string };
}

/** A transcript, as its steps. */
export interface AiTranscript {
  pass: PassName;
  /** "read.txt". */
  file: string;
  /** The whole file's size, header included, as its run recorded it. */
  bytes: number;
  sha256: string;
  /** What NVDA said, a step each: the line's number, the key pressed, and the words. */
  steps: Step[];
}

/** A transcript the run recorded whose file couldn't be read here. */
export interface AiUnreadablePass {
  pass: PassName;
  file: string;
  /** Why its words aren't shown, in the page's words. */
  unreadable: string;
}

/** One page's card: what the page says of itself, and what NVDA and axe found on it. */
export interface AiPage {
  /** As the page is numbered in the Markdown: from 1. */
  number: number;
  /** What the page is called: its label, else its whole address as the page shows it. */
  name: string;
  /** Whether the page list gave the page a label: `name` is it, whatever it says. */
  labeled: boolean;
  /** The page's address without the site's: "/how-a-run-works/". */
  path: string;
  /** The title the browser reported; null when it had none, or never loaded. */
  title: string | AiNotRecorded | null;
  /**
   * "transcribed" when the latest run read it and its transcripts are shown; "failed" when the
   * latest run couldn't, and the transcripts shown are an earlier run's; "never" when it has none;
   * "skipped" when the latest run skipped it after it loaded.
   */
  status: "transcribed" | "failed" | "skipped" | "never";
  /** How the read pass stopped before the page's end, when it did: at its step limit, or by the repeat safety net. */
  readStopped: "step-cap" | "repeat-limit" | null;
  /** The status in the page's words, with the failure and the run the transcripts are from. */
  result: string;
  /** What each pass captured, and how long the page took; null when there are no transcripts. */
  captured: {
    /** The lines the read pass read; null for a pass the run didn't read, never 0. */
    read: number | null;
    headings: number | null;
    tab: number | null;
    timeMs: number | AiNotRecorded;
  } | null;
  /** The first lines NVDA said as it read the page, word for word. */
  firstLines: string[];
  /** The run its transcripts are from, and its date for a run before the latest. */
  transcriptsFrom: { run: string; date: string | null } | null;
  /** The page's transcripts, in pass order. None for a page with none. */
  passes: (AiTranscript | AiUnreadablePass)[];
  flags: AiFlag[];
  /** Where the flags are not the plain list: that nothing was read, none were raised, or they are as the run recorded them. */
  flagsNote: string | null;
  /** What axe found; null for a card that says nothing of axe. */
  axe: AiNotRecorded | AiAxeResults | null;
  /** The person's review as far as the records show it. Nothing for a page with none. */
  review: string[];
}

/** A page earlier runs tested that the latest list no longer has. */
export interface AiGone {
  name: string;
  address: string;
  /** The last run that had it, and what that run recorded of it. */
  lastRun: string;
  lastStatus: string;
}

/** A line of a pass's changes: one the same, removed, added, or a run of lines the same, counted. */
export type AiDiffLine =
  { kind: "same" | "removed" | "added"; text: string } | { kind: "collapsed"; count: number };

/** A page that sounds different from the run before. */
export interface AiChangedPage {
  label: string | null;
  path: string;
  /** How much changed, in words: "read: 3 lines removed and 2 added". */
  summary: string;
  /** The rules whose flag went, and whose came. */
  rulesResolved: string[];
  rulesNew: string[];
  passes: { pass: PassName; removed: number; added: number; lines: AiDiffLine[] }[];
  /** The passes that sound different whose transcript can't be read here. */
  unreadable: PassName[];
  /** Each flag, said as the page says it. */
  flagsNote: string | null;
}

/** What changed since the last run. With no earlier run to compare with, `line` says so. */
export interface AiChanges {
  line: string;
  /** The run compared with, and the latest. */
  before: string | null;
  after: string | null;
  /** The tools that differ between the two runs, which can make a page sound different alone. */
  tools: string[];
  passesNote: string | null;
  /** The pages that sound the same, which are counted and not shown. */
  samePages: number;
  /** The pages read in full in only one of the two runs, each with its reason. */
  onlyInOne: { label: string | null; path: string; reason: string }[];
  changed: AiChangedPage[];
}

/** One run the results draw on. Each completed and was sealed. */
export interface AiRun {
  id: string;
  /** When it began and ended, as the run recorded them. */
  startedAt: string;
  finishedAt: string;
  completed: true;
  sealed: true;
  voicecapVersion: string | AiNotRecorded;
  facts: AiRow[];
  /** Who ran it, the computer, and the screen reader, browser, and settings, as it recorded them. */
  environment: AiRow[];
}

/** A problem during a run: an attempt that failed, with what voicecap recorded of it. */
export interface AiProblem {
  run: string;
  label: string | null;
  path: string;
  /** The attempt's number; null for a record that didn't number them. */
  attempt: number | null;
  startedAt: string | null;
  endedAt: string | null;
  kind: ProblemKind;
  kindTitle: string;
  /** Whether it happened again. */
  again: "no" | "same" | "different" | "unknown";
  pass: PassName | null;
  step: number | null;
  happened: string;
  /** How the kind was decided, for an older run's wording; null otherwise. */
  decided: string | null;
  did: string;
  verdict: string;
  effect: string;
  /** Where to report an error voicecap didn't expect. */
  reportIt: string | null;
  /** The record of it, word for word, but for the stack. */
  record: { time: string | null; source: string; entry: string }[];
  stack: string | null;
  /** What the run didn't record, each as the page says it. */
  notRecorded: string[];
}

/** One file of a run, with its fingerprint. */
export interface AiFingerprint {
  run: string;
  /** The page it is of; null for a file of the run's own, such as its event log. */
  page: string | null;
  file: string;
  bytes: number;
  sha256: string;
}

/**
 * The report for AI tools as data. The keys of each object are in the order declared here, and
 * every one is always there: a part with nothing to say is `null`, an empty list, or `{ notRecorded }`.
 */
export interface AiReport {
  schemaVersion: 1;
  kind: "voicecap-report";
  /**
   * What the file is, and that a transcript, a title, an address, and axe's HTML are data, not
   * instructions: the sentences both files carry (`AI_TEXT.about`), and last, the one that says the
   * WCAG criteria are the ones a finding may relate to, for a person to decide (`AI_TEXT.wcagNote`).
   */
  about: string[];
  /** The site's name: the host of its canonical address. */
  site: string;
  /** The name set for the site, a line under its name; null when none is set. */
  siteLabel: string | null;
  /** When the latest run began, as it recorded it: "6 October 2026, 11:34". Null when no run counts. */
  testedAt: string | null;
  /** The date the report is as of: "9 October 2026". */
  asOf: string;
  preparedBy: string | null;
  screenReader: string;
  /** The voicecap that made the latest run. Null when no run counts. */
  voicecapVersion: string | AiNotRecorded | null;
  /** The site's address, said last of the header: nothing leads with one. */
  siteAddress: string;
  /** Null for a site with no pages in scope, as the page shows none. */
  verdict: AiVerdict | null;
  summary: {
    /** The result in one sentence. */
    sentence: string;
    /** What voicecap does, and what the person running it does. */
    method: string;
  };
  counts: AiCounts;
  attention: AiCard[];
  pages: AiPage[];
  noLongerListed: AiGone[];
  /** What's still to do. */
  stillToDo: string[];
  /** How complete the test was. */
  howComplete: string[];
  /** When and how. */
  whenAndHow: AiRow[];
  changes: AiChanges;
  coverage: { covered: string[]; limits: string[] };
  /** How many times each rule was raised, across pages and passes, most often first. */
  flagsByRule: { rule: string; count: number }[];
  humanReview: { transcriptsReviewed: AiOutOf; issuesFixed: AiOutOf };
  /** The fingerprint of the flag rules the flags were computed with. */
  flagRulesSha256: string;
  /** Said when the runs read a copy of the site, not the site itself. */
  readCopyNote: string | null;
  runs: AiRun[];
  /** The runs that aren't counted in any result, each as one line that starts with its id. */
  runsLeftOut: { id: string; text: string }[];
  /** The verdict of the problems during the runs. */
  problemsLine: string;
  problems: AiProblem[];
  fingerprints: AiFingerprint[];
  /** The command that checks the originals against these fingerprints. */
  verifyCommand: string | null;
  /** When it was made, as an instant, and in the page's words, with the offsets from UTC its times are in. */
  generated: { at: string; offsets: string[]; text: string };
}

/** A page's transcripts, as the model keeps them apart from its card. */
type Transcripts = ShareModel["appendix"][number];

/** The label a record gives a page, when it has one that isn't blank. */
const labelOf = ({ label }: { label?: string }): string | null => label?.trim() || null;

// The header.

/** The voicecap that made the latest run: what its record names, or that it names none. */
function voicecapOf({ evidence }: ShareModel): AiReport["voicecapVersion"] {
  const [latest] = evidence;
  if (latest === undefined) return null;
  const version = versionOf(latest.run);
  return version === null ? { notRecorded: notRecordedBy(version) } : version;
}

// At a glance.

/** The verdict, as the page says it; none for a site with no pages, as the page shows none. */
function verdictOfModel({ result }: ShareModel): AiVerdict | null {
  if (result.pages === 0) return null;
  const { kind, headline } = verdictOf(result);
  return { kind, headline };
}

/** The numbers At a glance gives, and the ring of the pages. */
function countsOf({ result, summary, ring, evidence }: ShareModel): AiCounts {
  return {
    pagesInScope: result.pages,
    pagesRead: result.read,
    problems: result.problems,
    problemPages: result.problemPages,
    linesSpoken: summary.numbers.linesSpoken,
    nvdaMs: summary.numbers.nvdaMs,
    runs: evidence.length,
    sessionsWithoutEnd: summary.numbers.sessionsWithoutEnd,
    ring: {
      readNoProblems: ring.noProblems,
      readWithProblems: ring.needAttention,
      notRead: ring.notRead,
    },
  };
}

// What needs attention.

/** A card, as the page says it: its words, and its pages by the number each has under Every page. */
function cardOf(card: AttentionCard, number: number, numbers: ReadonlyMap<string, number>): AiCard {
  const words = attentionWords(card);
  return {
    number,
    id: card.id,
    kind: card.kind,
    title: words.title,
    count: { pages: card.pages.length, times: card.times },
    places: words.places.map(({ lead, quotes, unavailable }) => ({
      lead,
      said: quotes.map(({ pass, line }) => ({ key: pass, line })),
      unavailable,
    })),
    cause: words.cause,
    why: words.why,
    fixes: words.fixes.map(({ lead, code, after }) => ({ lead, code, after })),
    pathForward: [...words.path],
    pages: card.pages.map((page) => ({
      number: numbers.get(page.slug) ?? null,
      name: page.name,
      path: page.path,
      detail: page.detail === null || page.detail.trim() === "" ? null : page.detail,
    })),
  };
}

// Every page.

/** What a page's record says of how it ended and where its transcripts come from, as sentences. */
function resultOf(card: PageCard): string {
  const from = fromRun(card);
  return [
    sentence(ownWords(card.statusText)),
    ...(card.failure === null ? [] : [sentence(ownWords(card.failure))]),
    ...(from === null ? [] : [sentence(from)]),
  ].join(" ");
}

/** The title the browser reported, or that the run didn't record it: a copy, so the model's own isn't shared. */
function titleOf({ title }: PageCard): AiPage["title"] {
  return typeof title === "object" && title !== null ? { notRecorded: title.notRecorded } : title;
}

/** The page's status as one of four kinds: a page with flags and one without are both transcribed. */
function statusOf({ status }: PageCard): AiPage["status"] {
  return status === "no-flags" || status === "flags" ? "transcribed" : status;
}

/** What each pass captured and how long the page took; a pass the run didn't read is null, never 0. */
function capturedOf({ counts, timeMs }: PageCard): AiPage["captured"] {
  if (counts === null) return null;
  return {
    read: counts.read,
    headings: counts.headings,
    tab: counts.tab,
    timeMs:
      typeof timeMs === "number"
        ? timeMs
        : { notRecorded: timeMs?.notRecorded ?? PAGES_TEXT.notRecorded },
  };
}

/** The run a page's transcripts are from, and its date for a run before the latest. */
function originOf(
  card: PageCard,
  transcripts: Transcripts | undefined,
  latest: string | null,
): AiPage["transcriptsFrom"] {
  if (transcripts === undefined) return null;
  if (card.from !== null) return { run: card.from.run, date: card.from.date };
  return latest === null ? null : { run: latest, date: null };
}

/**
 * A page's transcripts, in pass order: each with its steps, or, for one the run recorded but whose
 * file couldn't be read here, the page's words in its place.
 */
function passesOf(transcripts: Transcripts | undefined): (AiTranscript | AiUnreadablePass)[] {
  if (transcripts === undefined) return [];
  return PASS_NAMES.flatMap((pass): (AiTranscript | AiUnreadablePass)[] => {
    const file = transcripts.files.find((each) => each.pass === pass);
    if (file !== undefined) {
      return [
        { pass, file: file.name, bytes: file.bytes, sha256: file.sha256, steps: stepsOf(file) },
      ];
    }
    return transcripts.unreadable.includes(pass)
      ? [{ pass, file: `${pass}.txt`, unreadable: sentence(APPENDIX_TEXT.unreadable) }]
      : [];
  });
}

/** What a page's flags need said beyond the list: that nothing was read, none were raised, or they are as recorded. */
function flagsNoteOf(card: PageCard): string | null {
  if (card.counts === null) return `${WORD_TEXT.pages.nothingToFlag}.`;
  const notes = [
    ...(card.flags.length === 0 ? [sentence(PAGES_TEXT.noFlags)] : []),
    ...(card.flagsAsRecorded ? [sentence(PAGES_TEXT.flagsAsRecorded)] : []),
  ];
  return notes.length === 0 ? null : notes.join(" ");
}

/** An element axe found, as its file keeps it. */
function elementOf({ target, html, failureSummary }: AxeViewRule["nodes"][number]): AiAxeElement {
  return { target: [...target], html, fix: failureSummary };
}

/** A rule axe found the page broke, or that needs review, with the criteria its tags name. */
function ruleOf(rule: AxeViewRule): AiAxeRule {
  return {
    id: rule.id,
    help: rule.help,
    impact: rule.impact,
    wcag: axeCriteriaList(rule.tags),
    bestPractice: rule.tags.includes(BEST_PRACTICE),
    elements: rule.nodes.map(elementOf),
    moreElements: rule.moreNodes,
    helpUrl: axeRulePage(rule.helpUrl),
  };
}

/**
 * What axe found on a page: its results as its file keeps them, with the counts the page's fold
 * gives; or the card's reason there are none, so a gap never reads as a pass. None for a card that
 * says nothing of axe.
 */
function axeOf({ axe }: PageCard): AiPage["axe"] {
  if (axe === undefined) return null;
  if ("notRecorded" in axe) return { notRecorded: notRecordedLine(ownWords(axe.notRecorded)) };
  const { view } = axe;
  const impacts = axeImpacts(view);
  return {
    version: view.axeVersion,
    tags: [...view.tags],
    rulesRun: axeRulesRun(view.tags),
    counts: {
      issues: view.violations.length,
      critical: impacts.critical,
      serious: impacts.serious,
      moderate: impacts.moderate,
      minor: impacts.minor,
      needsReview: view.incomplete.length,
      passes: view.counts.passes,
    },
    issues: view.violations.map(ruleOf),
    needsReview: view.incomplete.map(ruleOf),
    file: { name: AXE_FILE, bytes: axe.bytes, sha256: axe.sha256 },
  };
}

/**
 * A page, in the spec's order: its number, name, and address, its title and status, its first lines,
 * its transcripts' steps, its flags, what axe found, and the person's review.
 */
function pageOf(
  card: PageCard,
  number: number,
  transcripts: Transcripts | undefined,
  latest: string | null,
): AiPage {
  return {
    number,
    name: card.name,
    labeled: card.labeled,
    path: card.path,
    title: titleOf(card),
    status: statusOf(card),
    readStopped: card.readStopped,
    result: resultOf(card),
    captured: capturedOf(card),
    firstLines: [...card.heardFirst],
    transcriptsFrom: originOf(card, transcripts, latest),
    passes: passesOf(transcripts),
    flags: card.flags.map((flag) => ({
      rule: flag.rule,
      pass: flag.pass ?? null,
      message: flag.message,
      wcag: [...wcagOf(flag.rule)],
    })),
    flagsNote: flagsNoteOf(card),
    axe: axeOf(card),
    review: [...card.reviewChips, ...card.manual.map(manualLine)],
  };
}

/** A page earlier runs tested that the latest list no longer has. */
const goneOf = ({ name, url, lastRun, lastStatus }: NoLongerListed): AiGone => ({
  name,
  address: url,
  lastRun,
  lastStatus,
});

// The details.

/** A pass's changes: each line's fate, and a run of lines the same counted. */
function diffLineOf(line: DiffLine): AiDiffLine {
  return line.kind === "collapsed"
    ? { kind: "collapsed", count: line.count }
    : { kind: line.kind, text: line.text };
}

/** A page that sounds different: how much, the flags that went or came, and what changed in each pass. */
function changedPageOf(page: PageChange): AiChangedPage {
  const { resolved, fresh } = changedRules(page.flags);
  const flags = flagsLine(page.flags);
  return {
    label: labelOf(page),
    path: pagePath(page.url),
    summary: changeCounts(page),
    rulesResolved: resolved,
    rulesNew: fresh,
    passes: page.passes.map(({ pass, removed, added, lines }) => ({
      pass,
      removed,
      added,
      lines: lines.map(diffLineOf),
    })),
    unreadable: [...page.unreadable],
    flagsNote: flags === null ? null : lineText(flags),
  };
}

/** What changed since the last run, as the page has it; with no run to compare with, that it has none. */
function changesOf({ changes }: ShareModel): AiChanges {
  if (changes === null) {
    return {
      line: CHANGES_TEXT.none,
      before: null,
      after: null,
      tools: [],
      passesNote: null,
      samePages: 0,
      onlyInOne: [],
      changed: [],
    };
  }
  return {
    line: changes.line,
    before: changes.before.id,
    after: changes.after.id,
    tools: changes.tools.map(ownWords),
    passesNote: changes.passesNote,
    samePages: changes.same,
    onlyInOne: changes.onlyInOne.map((page) => ({
      label: labelOf(page),
      path: pagePath(page.url),
      reason: CHANGES_TEXT.reasons[page.reason],
    })),
    changed: changes.changed.map(changedPageOf),
  };
}

/** A count out of its total. */
const outOf = ([count, of]: [number, number]): AiOutOf => ({ count, of });

/** The human review: each count out of its total. */
function humanReviewOf({ bars }: Summary): AiReport["humanReview"] {
  return {
    transcriptsReviewed: outOf(bars.review.reviewed),
    issuesFixed: outOf(bars.review.fixed),
  };
}

/** A row of a run's evidence, with no library named. */
const rowOf = ({ label, value }: { label: string; value: string }): AiRow => ({
  label: ownWords(label),
  value: ownWords(value),
});

/** A run: when it ran, the voicecap it used, its facts, and the test environment it recorded. */
function runOf({ run, facts, environment }: RunEvidence): AiRun {
  const version = versionOf(run);
  return {
    id: run.id,
    startedAt: runStart(run),
    finishedAt: runEnd(run),
    completed: true,
    sealed: true,
    voicecapVersion: version === null ? { notRecorded: notRecordedBy(version) } : version,
    facts: facts.map(rowOf),
    environment: environment.map(rowOf),
  };
}

/** A problem: what happened, what voicecap did, whether it happened again, and its record word for word. */
function problemOf(problem: Problem): AiProblem {
  return {
    run: problem.run,
    label: labelOf(problem.page),
    path: pagePath(problem.page.url),
    attempt: problem.n,
    startedAt: problem.startedAt,
    endedAt: problem.endedAt,
    kind: problem.kind,
    kindTitle: kindTitle(problem.kind),
    again: problem.again,
    pass: problem.pass,
    step: problem.step,
    happened: ownWords(happenedLine(problem)),
    decided: problem.fromWording ? ownWords(decidedFrom(problem.kind)) : null,
    did: ownWords(sentence(problem.did)),
    verdict: ownWords(sentence(problem.verdict)),
    effect: ownWords(sentence(problem.effect)),
    reportIt: problem.kind === "unexpected" ? lineText(PROBLEMS_TEXT.report()) : null,
    // A stack is said apart from the record, where its lines can be read.
    record: problem.record
      .filter((entry) => entry.source !== "stack")
      .map(({ time, source, entry }) => ({ time, source, entry: ownWords(entry) })),
    stack: problem.stack === null ? null : ownWords(problem.stack),
    notRecorded: problem.notRecorded.map((line) => notRecordedLine(ownWords(line))),
  };
}

/** The fingerprint of every file each run recorded, run by run: a run's own file has no page. */
function fingerprintsOf({ evidence }: ShareModel): AiFingerprint[] {
  return evidence.flatMap(({ run, fingerprints }) =>
    fingerprints.map(({ page, file, bytes, sha256 }) => ({
      run: run.id,
      page: page === EVIDENCE_TEXT.theRun ? null : page,
      file,
      bytes,
      sha256,
    })),
  );
}

/**
 * The report as data, from the page's model, in the order `AiReport` declares: the plain object
 * `renderAiJson` writes. Each list and object is the data's own, so a caller can change one without
 * changing a table of voicecap's.
 */
export function aiReportOf(model: ShareModel): AiReport {
  const { header, summary, footer } = model;
  const numbers = new Map(model.pages.map((card, at) => [card.slug, at + 1]));
  const transcripts = new Map(model.appendix.map((entry) => [entry.slug, entry]));
  const latest = model.evidence[0]?.run.id ?? null;
  return {
    schemaVersion: 1,
    kind: "voicecap-report",
    about: [...AI_TEXT.about, AI_TEXT.wcagNote],
    site: header.name,
    siteLabel: header.siteName,
    testedAt: header.testedAt,
    asOf: header.asOf,
    preparedBy: header.preparedBy,
    screenReader: header.screenReader,
    voicecapVersion: voicecapOf(model),
    siteAddress: header.site,
    verdict: verdictOfModel(model),
    summary: { sentence: summary.sentence, method: summary.second },
    counts: countsOf(model),
    attention: model.attention.map((card, at) => cardOf(card, at + 1, numbers)),
    pages: model.pages.map((card, at) => pageOf(card, at + 1, transcripts.get(card.slug), latest)),
    noLongerListed: model.noLongerListed.map(goneOf),
    stillToDo: [...summary.todo],
    howComplete:
      summary.changesLine === null
        ? [...summary.complete]
        : [...summary.complete, summary.changesLine],
    whenAndHow: summary.whenHow.map(({ label, value }) => ({ label, value })),
    changes: changesOf(model),
    coverage: {
      covered: model.coverage.covered.map(ownWords),
      limits: model.coverage.limits.map(ownWords),
    },
    flagsByRule: summary.bars.flagsByRule.map(({ rule, count }) => ({ rule, count })),
    humanReview: humanReviewOf(summary),
    flagRulesSha256: model.flagRulesSha256,
    readCopyNote: readCopyNote(model),
    runs: model.evidence.map(runOf),
    runsLeftOut: model.leftOut.map(({ id, text }) => ({ id, text })),
    problemsLine: ownWords(model.problems.line),
    problems: model.problems.problems.map(problemOf),
    fingerprints: fingerprintsOf(model),
    verifyCommand: model.evidence[0]?.verify ?? null,
    generated: {
      at: footer.generatedAt,
      offsets: [...footer.offsets],
      text: generatedLine(footer),
    },
  };
}

/**
 * The report as JSON for AI tools, from the page's model: one file, with the parts in the
 * Markdown's order and the keys of each object in the order `AiReport` declares them. It is
 * `JSON.stringify` of plain data with a 2-space indent, and ends with one newline, so the same
 * model gives the same bytes.
 */
export function renderAiJson(model: ShareModel): string {
  return `${JSON.stringify(aiReportOf(model), null, 2)}\n`;
}
