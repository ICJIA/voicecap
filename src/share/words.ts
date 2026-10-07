/**
 * The sentences of the shareable report that are worked out from its model: the numbers, counts,
 * names, and dates in the plain words each copy says them in. First those of the page's first half
 * (the top, the summary, "What needs attention", "How voicecap works", "Every page", and the
 * appendix), then those of its second (what changed since the last run, the problems during the
 * runs, the evidence, the story, and the footer).
 *
 * Each is a string, or a line (./line.ts): no markup, and nothing escaped. The page's renderers
 * (html/) escape what they draw, and the Word copy sets the same words in its own paragraphs, so the
 * two can't say different things. What no record changes is in text.ts. Pure.
 *
 * A fold's instruction to open it is the page's alone: the Word copy folds nothing. So a line that
 * has one (`appendixGist`, `changesGist`) takes the page's sentence, and says none of its own.
 */
import { PASS_NAMES, type FlagResult, type PassName, type RunJson } from "../model.js";
import { plural } from "../report/html.js";
import { formatDuration } from "../util/time.js";
import { attentionClauses } from "./attention.js";
import type { Changes, OnlyInOnePage, PageChange } from "./changes.js";
import {
  clock,
  count,
  dayMonth,
  longDate,
  names,
  pagePath,
  pageTitle,
  seconds,
  utcOffset,
} from "./format.js";
import type { Line } from "./line.js";
import type { AppendixFile, PageCard, ShareModel } from "./model.js";
import { KIND_ROWS, type Problem, type ProblemKind } from "./problems.js";
import { runEnd, runStart } from "./run-evidence.js";
import type { Summary } from "./summary.js";
import {
  ATTENTION_TEXT,
  EVIDENCE_TEXT,
  HOW_LEAD,
  HOW_TEXT,
  ISSUES_URL,
  PAGES_TEXT,
  PASS_WORDS,
  PROBLEMS_TEXT,
  STORY,
  SUMMARY_TEXT,
  TIMELINE_TEXT,
  TOP_TEXT,
} from "./text.js";
import type { SessionTimeline, UnloggedSession } from "./timeline.js";

/** The first words of a section's opening line, when no run counts. */
const NO_RUN = "No live run counts yet.";

// The top.

/**
 * The lead under the site's name, with the screen reader's name linked when it is NVDA: what the
 * page is, when it was tested, and what voicecap did. When no run counts there is no date to give,
 * so the lead says so, and says what voicecap does rather than what it did: no run that counts took
 * the screen reader through any page.
 */
export function topLead(header: ShareModel["header"]): Line {
  const { tested, screenReader } = header;
  const dated =
    tested === null
      ? ". No live run counts yet, so there's no test date."
      : `, ${tested.includes(" to ") ? "tested from" : "tested on"} ${tested}.`;
  const reader =
    screenReader === "NVDA" ? { text: screenReader, href: TOP_TEXT.nvAccess } : screenReader;
  return [
    "How its pages read aloud with ",
    reader,
    `, a free screen reader${dated} voicecap ${tested === null ? "takes" : "took"} ${screenReader} through every page, pressing its keys the way a person would. Every word shown here is what ${screenReader} said.`,
  ];
}

/**
 * When the site was tested, as the top says it under the site's name: the date and time the latest
 * run began. "Tested 29 September 2026, 14:02". Null when no run counts, so there is no date and
 * time to give (the lead says so).
 */
export function testedLine({ testedAt }: ShareModel["header"]): string | null {
  return testedAt === null ? null : `${TOP_TEXT.tested} ${testedAt}`;
}

/**
 * What the document is called, in the page's tab and in the Word copy's properties: the site's
 * name, and what the report shows. "dvfr.illinois.gov: how its pages read aloud with NVDA".
 */
export function documentTitle({ name, screenReader }: ShareModel["header"]): string {
  return `${name}: how its pages read aloud with ${screenReader}`;
}

// The summary.

/** One of the summary's five numbers: how it's counted, and what it counts. */
export interface NumberTile {
  /** Complete is "ok", a flag or a gap "warn", a plain count "quiet": a copy says it in words too. */
  tone: "ok" | "warn" | "quiet";
  value: { count: number } | { part: number; whole: number } | { ms: number };
  /** What follows the number: "pages in scope", "transcribed by NVDA". */
  label: string;
}

/**
 * The five numbers, in order. A count out of its total is in the tone of whether it's complete; a
 * copy says each in words, never by tone alone. None counts the pages a person heard NVDA read: a
 * run started without a terminal can't ask, and a count of 0 read as though no one had heard NVDA.
 */
export function numbersOf(model: ShareModel): NumberTile[] {
  const { pagesInScope, transcribed, flagged, rules, linesSpoken, nvdaMs } = model.summary.numbers;
  const { sessionsWithoutEnd: uncounted } = model.summary.numbers;
  const left =
    uncounted === 0
      ? ""
      : `; ${plural(uncounted, "session")} without a recorded end ${uncounted === 1 ? "isn't" : "aren't"} counted`;
  const flagsLabel = `${flagged === 1 ? "page" : "pages"} with flags${flagged > 0 ? `, ${plural(rules, "rule")}` : ""}`;
  const transcribedTone =
    pagesInScope === 0 ? "quiet" : transcribed === pagesInScope ? "ok" : "warn";
  return [
    {
      tone: "quiet",
      value: { count: pagesInScope },
      label: pagesInScope === 1 ? "page in scope" : "pages in scope",
    },
    {
      tone: transcribedTone,
      value: { part: transcribed, whole: pagesInScope },
      label: "transcribed by NVDA",
    },
    { tone: flagged > 0 ? "warn" : "quiet", value: { count: flagged }, label: flagsLabel },
    {
      tone: "quiet",
      value: { count: linesSpoken },
      label: linesSpoken === 1 ? "line NVDA spoke" : "lines NVDA spoke",
    },
    {
      tone: "quiet",
      value: { ms: nvdaMs },
      label: `of NVDA time, across ${plural(model.evidence.length, "run")}${left}`,
    },
  ];
}

/** How a unit of `formatDuration` is said, in the singular and the plural. */
const UNITS: Record<string, [string, string]> = {
  ms: ["millisecond", "milliseconds"],
  s: ["second", "seconds"],
  m: ["minute", "minutes"],
  h: ["hour", "hours"],
  d: ["day", "days"],
};

/** A length of time as a screen reader says it: "12 minutes 34 seconds", where a tile has "12m 34s". */
export function spokenDuration(ms: number): string {
  return formatDuration(ms).replace(/(\d+)([a-z]+)/g, (_, amount: string, unit: string) => {
    const [one, many] = UNITS[unit] ?? [unit, unit];
    return `${amount} ${Number(amount) === 1 ? one : many}`;
  });
}

/** A part of a whole as a percentage, to a whole number: "43%". "nothing to count" for no whole. */
export function shareOf(part: number, whole: number): string {
  if (!(whole > 0)) return "nothing to count";
  return `${Math.round((part / whole) * 100)}%`;
}

/**
 * The pages each kind of latest result counts, in words: "5 pages without flags, 1 page with
 * flags". A kind with no pages isn't named, so it's empty when there are no pages at all.
 */
export function resultsCaption({ done, flagged, never }: Summary["bars"]["results"]): string {
  const { resultWords } = SUMMARY_TEXT;
  return (
    [
      [done, resultWords.done],
      [flagged, resultWords.flagged],
      [never, resultWords.never],
    ] as const
  )
    .filter(([pages]) => pages > 0)
    .map(([pages, what]) => `${plural(pages, "page")} ${what}`)
    .join(", ");
}

/** The most cards the summary's panel on what needs attention names, before it counts the rest. */
const PANEL_CARDS = 5;

/** What the summary's panel on what needs attention says, in its words: see `attentionPanelOf`. */
export interface AttentionPanel {
  /** How many problems, on how many pages, ahead of the cards: "1 problem, on 32 pages:". */
  lead: string;
  /** The cards it names, the first few, each with its id (the page links its title to its card). */
  named: { id: string; title: string }[];
  /**
   * How many cards it leaves out, "and 2 more, under What needs attention", which is where they all
   * are; null when it names every one.
   */
  more: string | null;
}

/**
 * What the summary's panel on what needs attention says: how many problems there are and on how
 * many pages, over every card; the first `PANEL_CARDS` cards by their titles; and, when there are
 * more, how many it leaves out, which both copies say beneath the cards, the page linking it to the
 * section that has them all. Null when no card is left: the panel says the line for no problem
 * (`noAttentionLine`).
 */
export function attentionPanelOf({
  problems,
  pages,
  cards,
}: Summary["attention"]): AttentionPanel | null {
  if (cards.length === 0) return null;
  const named = cards.slice(0, PANEL_CARDS);
  const rest = cards.length - named.length;
  return {
    lead: `${plural(problems, "problem")}, on ${plural(pages, "page")}:`,
    named,
    more: rest > 0 ? ATTENTION_TEXT.more(rest) : null,
  };
}

/**
 * What the section on what needs attention and the summary's panel say when no card is left: that
 * nothing needs attention, as every page was read; or, when some pages were skipped (they are on no
 * card, and weren't read), that nothing does on the pages read, with how many were skipped. Each
 * says that every flag was fixed or checked by a person when a page in scope raised one, and that
 * no flags were raised when none did: a flag never raised was never fixed or checked.
 */
export function noAttentionLine({ skipped, flagsRaised }: Summary["attention"]): string {
  if (!flagsRaised) {
    return skipped === 0 ? ATTENTION_TEXT.noFlags : ATTENTION_TEXT.noFlagsSkipped(skipped);
  }
  return skipped === 0 ? ATTENTION_TEXT.none : ATTENTION_TEXT.noneSkipped(skipped);
}

// What needs attention.

/**
 * The line under the heading of "What needs attention": how many problems there are, on how many
 * pages, and what to do about them, from the summary's own counts; with no card left, the line the
 * summary's panel says in its place (`noAttentionLine`); and, when no run counts, that there are no
 * problems to show, as the other sections say of what they would show. No panel says anything then,
 * and nothing was read, so "every page was read" would not be true.
 */
export function attentionGist({ header, summary }: ShareModel): Line {
  if (header.tested === null) {
    return [{ text: NO_RUN, bold: true }, " There are no problems to show."];
  }
  const { attention } = summary;
  return [
    attention.cards.length === 0
      ? noAttentionLine(attention)
      : ATTENTION_TEXT.gist(attention.problems, attention.pages),
  ];
}

// How voicecap works.

/** The lead that opens "How voicecap works", with the words that say the person reads in bold. */
export function howLead(): Line {
  const bold = HOW_TEXT.leadBold;
  const at = HOW_LEAD.indexOf(bold);
  if (at < 0) return [HOW_LEAD];
  return [HOW_LEAD.slice(0, at), { text: bold, bold: true }, HOW_LEAD.slice(at + bold.length)];
}

/**
 * The heading of the sample of what NVDA said on this site: the page it was said on, and how many
 * ways through it there are. "Heard on this site: /, three ways".
 */
export function heardTitle(sample: NonNullable<ShareModel["heard"]>): string {
  const ways = HOW_TEXT.howMany[sample.passes.length] ?? HOW_TEXT.howMany[3];
  return `${HOW_TEXT.heard}: ${sample.page}, ${ways}`;
}

// Every page.

/**
 * The line that opens "Every page": how many pages there are and how many were read in full in the
 * latest run, then what each card has. A page whose read stopped before its end was transcribed,
 * but never counts as read in full.
 */
export function pagesGist({ pages, header }: ShareModel): Line {
  if (pages.length === 0) {
    return header.tested === null
      ? [{ text: NO_RUN, bold: true }, " There are no pages to show."]
      : [{ text: "The latest run listed no pages.", bold: true }];
  }
  const total = pages.length;
  const of = (status: PageCard["status"]) => pages.filter((card) => card.status === status).length;
  const transcribed = pages.filter(({ status }) => status === "no-flags" || status === "flags");
  const read = transcribed.filter((card) => card.readStopped === null).length;
  const results = [
    [read, "read in full"],
    [transcribed.length - read, "transcribed but not in full"],
    [of("failed"), "failed in the latest run"],
    [of("skipped"), "skipped in the latest run"],
    [of("never"), "never transcribed"],
  ] as const;
  const said = names(
    results.filter(([some]) => some > 0).map(([some, words]) => `${count(some)} ${words}`),
  );
  const headline =
    read < total
      ? `${plural(total, "page")}: ${said}.`
      : total === 1
        ? "1 page, read in full."
        : `${count(total)} pages, all read in full.`;
  return [
    { text: headline, bold: true },
    " For each page: its result, the person's review as far as the records show it, and what each pass captured.",
  ];
}

/** How long a page took, as the mockup writes it: "55.1 s", then "1 min 2 s". */
export function took(ms: number): string {
  if (Math.round(Math.max(0, ms) / 100) < 600) return seconds(ms);
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)} min ${total % 60} s`;
}

/**
 * The title the browser reported, or the words that say it wasn't recorded: "Title: Home". A page
 * with none has no line.
 */
export function titleOf({ title }: PageCard): string | null {
  const text = typeof title === "string" ? title.trim() : title === null ? "" : title.notRecorded;
  return text === "" ? null : `Title: ${text}`;
}

/**
 * Where a page's shown transcripts come from, when it isn't the latest run: "From run
 * 2026-09-29_1315, on 29 September 2026".
 */
export function fromRun({ from }: PageCard): string | null {
  return from === null ? null : `From run ${from.run}, on ${from.date}`;
}

/** A manual NVDA session on a page, with who imported it when the records say. */
export function manualLine({ at, reviewer }: PageCard["manual"][number]): string {
  return `Manual NVDA session, ${at}${reviewer === null ? "" : `, by ${reviewer}`}`;
}

/** How many lines, as a reader says it: "18 lines", "1 line". */
export function lineCount(lines: number): string {
  return plural(lines, "line");
}

/** How many bytes a file has, as a reader says it: "2,306 bytes", "1 byte". */
export function byteCount(bytes: number): string {
  return plural(bytes, "byte");
}

/** A number a card gives, with its label: "Read" and "18 lines", "Time" and "55.1 s". */
export interface Captured {
  label: string;
  value: string;
}

/**
 * What each pass of a page's shown transcripts captured, and how long the page took: the lines the
 * read pass read, the headings found, the Tab stops, and the time. A pass the run didn't read is
 * "Not read", never "0", and a time with no record of its own says so in the record's words (or
 * "Not recorded"). None for a page with no transcripts.
 */
export function capturedOf({ counts, timeMs }: PageCard): Captured[] | null {
  if (counts === null) return null;
  const { captured, notRead, notRecorded } = PAGES_TEXT;
  const time = typeof timeMs === "number" ? took(timeMs) : (timeMs?.notRecorded ?? notRecorded);
  return [
    { label: captured.read, value: counts.read === null ? notRead : lineCount(counts.read) },
    {
      label: captured.headings,
      value: counts.headings === null ? notRead : count(counts.headings),
    },
    { label: captured.tab, value: counts.tab === null ? notRead : count(counts.tab) },
    { label: captured.time, value: time },
  ];
}

/**
 * A line that says something wasn't recorded, or isn't shown: the model's own words ("Not
 * recorded: this run used voicecap 0.4.1.", "Not shown: the event log isn't as the run recorded
 * it…"), or, for words that say neither, with "Not recorded: " put in front, so a gap never reads as
 * a pass.
 */
export function notRecordedLine(text: string): string {
  const line = text.trim();
  return /\bnot (?:recorded|shown)\b/i.test(line) ? line : `${PAGES_TEXT.notRecorded}: ${line}`;
}

// The appendix.

/**
 * The line that opens the appendix: how many pages and transcripts, what each page has, and any
 * that couldn't be read. `open` is the page's sentence about opening a page, which follows what each
 * page has; a copy that folds nothing gives none.
 */
export function appendixGist({ appendix, header }: ShareModel, open = ""): Line {
  if (header.tested === null) {
    return [{ text: NO_RUN, bold: true }, " There are no transcripts to show."];
  }
  if (appendix.length === 0) {
    return [{ text: "No transcripts to show.", bold: true }, " No page has been read in full yet."];
  }
  const shown = appendix.reduce((sum, { files }) => sum + files.length, 0);
  const lost = appendix.reduce((sum, { unreadable }) => sum + unreadable.length, 0);
  const headline = `${plural(appendix.length, "page")}, ${shown === 0 ? "no transcripts shown" : plural(shown, "transcript")}.`;
  const opening = open === "" ? "" : ` ${open}`;
  const unread =
    lost === 0
      ? ""
      : ` ${plural(lost, "transcript")} couldn't be read, and ${lost === 1 ? "says" : "each says"} so under its page.`;
  return [
    { text: headline, bold: true },
    ` What NVDA said on each page, word for word, with each file's fingerprint.${opening}${unread}`,
  ];
}

/**
 * The run a page's transcripts are from, with its id in the fixed-width font: its id, and its date
 * for a run before the latest. A page with no card, or whose transcripts are the latest run's,
 * is from `latest`; none when there is no latest run either.
 */
export function originOf(card: PageCard | undefined, latest: string | null): Line | null {
  if (card?.from) {
    return ["From run ", { text: card.from.run, mono: true }, `, on ${card.from.date}`];
  }
  return latest === null ? null : ["From run ", { text: latest, mono: true }];
}

/**
 * What a page's fold says it has, as many transcripts as there are ("read, headings, and Tab
 * transcripts"), or that it has none.
 */
export function transcriptsInside(passes: PassName[]): string {
  if (passes.length === 0) return "no transcripts";
  return `${names(passes.map((pass) => PASS_WORDS[pass]))} ${passes.length === 1 ? "transcript" : "transcripts"}`;
}

/**
 * A transcript's size and fingerprint: the whole file's, its header included, as its run recorded
 * them, with the fingerprint in the fixed-width font.
 */
export function fileFingerprint(file: AppendixFile): Line {
  return [
    `The whole file, its header included: ${byteCount(file.bytes)}, SHA-256 `,
    { text: file.sha256, mono: true },
  ];
}

// What changed since the last run.

/**
 * What a pass lost and gained, as a reader says it: "3 lines removed and 2 added", and, for a pass
 * that only lost or only gained lines, "1 line removed" or "2 lines added", not "and 0 added".
 */
export function sizesOf(removed: number, added: number): string {
  if (removed === 0 && added === 0) return "no lines removed or added";
  if (added === 0) return `${plural(removed, "line")} removed`;
  if (removed === 0) return `${plural(added, "line")} added`;
  return `${plural(removed, "line")} removed and ${count(added)} added`;
}

/** What heads a pass's changes, as a sentence says the pass: "The read pass", "The Tab pass". */
export function passHeading(pass: PassName): string {
  return `The ${PASS_WORDS[pass]} pass`;
}

/**
 * Where on a page something is, as a heading says it: "on /about/". A pass's heading says it after
 * the pass's name, and `whereOf` says it first for a problem. The page says it for a screen reader
 * alone, since the page's name is on the line above; the Word copy has it in view, since its
 * headings are what a reader goes through.
 */
export function onPage(path: string): string {
  return `on ${path}`;
}

/** A run of lines the same, which a pass's table counts and doesn't show: "12 lines the same". */
export function sameLines(lines: number): string {
  return `${plural(lines, "line")} the same`;
}

/**
 * How much a page changed, for its fold's line: each pass that sounds different, in pass order,
 * with the lines it lost and gained, or that its transcript couldn't be read here, so no count is
 * known. "read: 3 lines removed and 2 added; headings: couldn't be read here; Tab: 1 line removed".
 * ("Here", since a pass named "read" that couldn't be read would say "read" twice over.)
 */
export function countsOf({ passes, unreadable }: PageChange): string {
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
 * The line on the two runs compared, how many pages sound the same (counted, not shown), and what
 * opens. When no page could be compared (the section's line says so), nothing was compared, so there
 * is none. `open` is the page's sentence about opening a page that sounds different, which comes
 * last when one does; a copy that folds nothing gives none.
 */
export function changesGist({ before, after, same, changed }: Changes, open = ""): Line | null {
  if (same === 0 && changed.length === 0) return null;
  const alike =
    same === 0
      ? ""
      : ` ${plural(same, "page")} ${same === 1 ? "sounds" : "sound"} the same, and ${same === 1 ? "is" : "are"} counted, not shown.`;
  const opening = changed.length === 0 || open === "" ? "" : ` ${open}`;
  return [
    "Compared: run ",
    { text: before.id, mono: true },
    " (before) and run ",
    { text: after.id, mono: true },
    ` (latest).${alike}${opening}`,
  ];
}

/**
 * The lead on the pages read in full in only one of the two runs, which so can't be compared: how
 * many, in bold. The pages follow it, each with its reason (`CHANGES_TEXT.reasons`).
 */
export function onlyInOneLead(pages: OnlyInOnePage[]): Line {
  const one = pages.length === 1;
  return [
    {
      text: `${plural(pages.length, "page")} ${one ? "was" : "were"} read in full in only one of the two runs,`,
      bold: true,
    },
    ` so ${one ? "it wasn't" : "they weren't"} compared:`,
  ];
}

/**
 * The rules whose flag went or came on a page, for its fold's chips, each once. A rule that another
 * pass still raises (one both runs read, or one only the later run read) isn't resolved for the
 * page, and one it already raised in another pass isn't new: the line of flags says each, pass by
 * pass (`flagsLine`).
 */
export function changedRules({
  resolved,
  added,
  unchanged,
  changed,
  uncompared,
}: PageChange["flags"]): { resolved: string[]; fresh: string[] } {
  const rulesOf = (flags: FlagResult[]) => new Set(flags.map(({ rule }) => rule));
  const gone = rulesOf(resolved);
  const came = rulesOf(added);
  const kept = rulesOf([...unchanged, ...changed.map(({ after }) => after)]);
  const stillRaised = rulesOf(uncompared);
  return {
    resolved: [...gone].filter(
      (rule) => !kept.has(rule) && !came.has(rule) && !stillRaised.has(rule),
    ),
    fresh: [...came].filter((rule) => !kept.has(rule) && !gone.has(rule)),
  };
}

/**
 * Each flag in the passes both runs read: resolved, then new, then changed, then unchanged, each
 * rule in bold. A flag whose count changed gives both counts; one with no count, what it finds now,
 * in plain words. None when no flag is in them.
 */
export function flagsLine({
  resolved,
  added,
  changed,
  unchanged,
}: PageChange["flags"]): Line | null {
  const which = (flag: FlagResult): Line => [
    { text: flag.rule, bold: true },
    ...(flag.pass === undefined ? [] : [` (${PASS_WORDS[flag.pass]} pass)`]),
  ];
  const clauses: Line[] = [
    ...resolved.map((flag) => [
      ...which(flag),
      `, ${flag.count === undefined ? "" : `${count(flag.count)} before, `}none now (resolved).`,
    ]),
    ...added.map((flag) => [
      ...which(flag),
      `, none before, ${flag.count === undefined ? "new" : `${count(flag.count)} now (new)`}.`,
    ]),
    ...changed.map(({ before, after }) =>
      before.count !== undefined && after.count !== undefined
        ? [...which(after), `, ${count(before.count)} before, ${count(after.count)} now (changed).`]
        : [...which(after), `, changed: now ${attentionClauses([after])}.`],
    ),
    ...unchanged.map((flag) => [...which(flag), ", unchanged."]),
  ];
  if (clauses.length === 0) return null;
  return ["Flags: ", ...clauses.flatMap((clause, at) => (at === 0 ? clause : [" ", ...clause]))];
}

// Problems during the runs.

/** Text that ends as a sentence does: voicecap's "did" lines have no full stop of their own. */
export function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/**
 * Which program came to the front, for a foreground loss whose run recorded it (`Problem.program`):
 * its name, or that voicecap couldn't tell. None for a problem that has no program to say: a run
 * that didn't record one says so among what it didn't record.
 */
export function programLine({ program }: Problem): string | null {
  if (program === undefined) return null;
  return program === null ? PROBLEMS_TEXT.program.unknown : PROBLEMS_TEXT.program.named(program);
}

/**
 * "What happened", as a problem's answer says it: what went wrong, then, for a foreground loss whose
 * run recorded it, which program came to the front.
 */
export function happenedLine(problem: Problem): string {
  const program = programLine(problem);
  const happened = sentence(problem.happened);
  return program === null ? happened : `${happened} ${program}`;
}

/** The time of day in an ISO time, to the millisecond when it has them: "14:05:10.000". */
export function timeOfDay(iso: string): string {
  return /T(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/.exec(iso)?.[1] ?? iso;
}

/**
 * The time of a line of a problem's record: its time of day, to the millisecond when it has them
 * ("14:05:10.000"), or the words that say the run kept none, never a blank.
 */
export function recordTime(time: string | null): string {
  return time === null ? PROBLEMS_TEXT.record.noTime : timeOfDay(time);
}

/** Why a run's problems have no cause code to read their kind from. */
const BEFORE_CAUSES = "this run was recorded before voicecap noted a cause for each failure";

/**
 * How the kind of a problem from an older run's wording was decided, which is not the same for
 * every kind (src/share/problems.ts reads the wording): most are voicecap's own words; "unreachable"
 * is Chrome's network error code; and "unexpected" is by exclusion, the wording being one voicecap
 * doesn't recognize, which is nothing it can say of the error itself.
 */
export function decidedFrom(kind: ProblemKind): string {
  switch (kind) {
    case "unexpected":
      return `voicecap didn't recognize this error's wording, so it counts as unexpected: ${BEFORE_CAUSES}.`;
    case "unreachable":
      return "From the browser's own network error code in the error's wording.";
    default:
      return `From the error's own wording, which voicecap wrote: ${BEFORE_CAUSES}.`;
  }
}

/**
 * Which problem, for the headings and the box names inside its fold, which a screen reader gets
 * apart from the fold's line: the page's address and the run, and the attempt, or the problem's
 * place among the page's in the run (a run recorded as text may not number them). No two have the
 * same words: "on /about/ in run 2026-09-29_1402, attempt 2".
 */
export function whereOf(problem: Problem, nth: number): string {
  const which = problem.n !== null ? `, attempt ${problem.n}` : nth > 1 ? `, problem ${nth}` : "";
  return `${onPage(pagePath(problem.page.url))} ${inRun(problem.run)}${which}`;
}

/** A run's title, where it has a line or a heading of its own: "Run 2026-09-29_1402". */
export function runTitle(id: string): string {
  return `Run ${id}`;
}

/**
 * Which run a part belongs to, said after the part's title, since two runs have parts with the same
 * title: "in run 2026-09-29_1402". The page says it for a screen reader alone; the Word copy has it
 * in view, since its headings are what a reader goes through.
 */
export function inRun(id: string): string {
  return `in run ${id}`;
}

/**
 * A problem's title, on its fold's line: its run, and its page by its label, else its address.
 * "Run 2026-09-29_1402 · How a run works".
 */
export function problemTitle(problem: Problem): string {
  return `${runTitle(problem.run)} · ${pageTitle(problem.page)}`;
}

/**
 * When a problem happened, for its line: the time of day its attempt failed, else when it began, on
 * a 24-hour clock ("14:05"); or the words that say the run kept none (a run recorded as text has no
 * times).
 */
export function problemTime({ endedAt, startedAt }: Problem): string {
  const when = endedAt ?? startedAt;
  return when === null ? PROBLEMS_TEXT.noTime : clock(when);
}

/**
 * What a kind of problem is called: the table of kinds' own words, "Another window came to the
 * front".
 */
export function kindTitle(kind: ProblemKind): string {
  return KIND_ROWS.find((row) => row.kind === kind)?.title ?? kind;
}

/**
 * What voicecap does about a kind of problem, and what it means, as a line. Where the words give the
 * address at which an error voicecap didn't expect is reported, the address is a link.
 */
export function kindMeaning(meaning: string): Line {
  const address = PROBLEMS_TEXT.issues;
  const at = meaning.indexOf(address);
  if (at < 0) return [meaning];
  return [
    meaning.slice(0, at),
    { text: address, href: ISSUES_URL },
    meaning.slice(at + address.length),
  ];
}

// The evidence.

/**
 * The line that opens the evidence: how many runs there are, that each completed and was sealed, and
 * the fingerprint of the flag rules, with how many pages' flags are as their run recorded them, not
 * the current rules'. The standing draws only on runs that completed and were sealed (and weren't
 * replays), so each run here is both. With no run that counts, it says there is no evidence.
 */
export function evidenceGist(model: ShareModel): Line {
  const runs = model.evidence.length;
  if (runs === 0) return [{ text: NO_RUN, bold: true }, " There is no evidence to show."];
  const each = runs === 1 ? "" : runs === 2 ? " both" : " all";
  const recorded = model.pages.filter((card) => card.flagsAsRecorded).length;
  const except =
    recorded === 0
      ? ""
      : `, except on ${plural(recorded, "page")} marked “${PAGES_TEXT.flagsAsRecorded}”, whose transcripts couldn't all be read here: ${recorded === 1 ? "its flags are as its run" : "their flags are as their runs"} recorded them`;
  return [
    { text: `${plural(runs, "run")},${each} completed and sealed.`, bold: true },
    " The flags were computed with the current flag rules, fingerprint ",
    { text: model.flagRulesSha256, mono: true },
    `${except}.`,
  ];
}

/**
 * That the runs read a copy of the site, when they did: said under the evidence's opening line, on
 * the computer that ran them or at another address, and never which address (a copy's means nothing
 * to a reader). None when they read the site itself, when the site has no canonical address to
 * compare with (it is named by the address voicecap read, so there is no copy to speak of), and when
 * no run is shown, since there are then no "these runs".
 */
export function readCopyNote({ header, evidence }: ShareModel): string | null {
  const { readFrom } = header;
  if (readFrom === null || readFrom === "same" || evidence.length === 0) return null;
  return EVIDENCE_TEXT.readCopy[readFrom];
}

/**
 * The transcripts the check leaves out because they couldn't be read here, by page, so its "21 of
 * 21" never reads as complete when a file is missing from it. None when every one could be read.
 */
export function unreadableNote({ appendix }: ShareModel): Line | null {
  const pages = appendix.filter(({ unreadable }) => unreadable.length > 0);
  const total = pages.reduce((sum, { unreadable }) => sum + unreadable.length, 0);
  if (total === 0) return null;
  const where = pages.map(
    ({ name, unreadable }) => `${name} (${names(unreadable.map((pass) => `${pass}.txt`))})`,
  );
  return [
    {
      text: `${plural(total, "transcript")} couldn't be read, so the check leaves ${total === 1 ? "it" : "them"} out:`,
      bold: true,
    },
    ` ${where.join("; ")}.`,
  ];
}

/**
 * A session's name, above its chart and its table, where a run's timelines name their sessions: when
 * the run has more than one (logged, or `unlogged`, which the log has no line of), or its log begins
 * after its first session (a run begun with a voicecap that kept no log): "Session 2, 30 September
 * 2026", the day it began. None where they don't.
 */
export function sessionLine(
  timelines: SessionTimeline[],
  { session, from }: SessionTimeline,
  unlogged: readonly UnloggedSession[] = [],
): string | null {
  const named =
    timelines.length + unlogged.length > 1 || timelines.some((each) => each.session !== 1);
  return named ? TIMELINE_TEXT.session(session, longDate(from)) : null;
}

/** When a run ran: "29 September 2026, 14:02 to 14:09", with the day again for a run that crossed one. */
export function whenOf(run: RunJson): string {
  const [start, end] = [runStart(run), runEnd(run)];
  const first = `${longDate(start)}, ${clock(start)}`;
  return longDate(end) === longDate(start)
    ? `${first} to ${clock(end)}`
    : `${first} to ${longDate(end)}, ${clock(end)}`;
}

// How voicecap came to be.

/**
 * Why voicecap exists (`STORY.why`) as a line, with the study it rests on linked where the text
 * quotes it: the study's headline, quoted once, is the link.
 */
export function whyLine(): Line {
  const { title, url } = STORY.deque;
  const pieces = STORY.why.split(title);
  const [before, after] = pieces;
  if (pieces.length !== 2 || before === undefined || after === undefined) {
    throw new Error("STORY.why must quote STORY.deque.title once, for the page to link it there.");
  }
  return [before, { text: title, href: url }, after];
}

/**
 * A timeline entry's day (a date is read as the day it begins): with its year ("25 September 2026")
 * for the first date and the first of a later year, and without it ("26 September") for a later
 * date of the same year. `lastYear` is the year of the date before it, or null for the first.
 */
export function timelineDay(date: string, lastYear: string | null): string {
  const day = `${date}T00:00`;
  return date.slice(0, 4) === lastYear ? dayMonth(day) : longDate(day);
}

// The footer.

/**
 * The moment the copies were made, with its offset from UTC: "30 September 2026 at 09:00
 * (UTC−05:00)". The footer's line says it, in both copies.
 */
export function generatedStamp({ generatedAt }: ShareModel["footer"]): string {
  return `${longDate(generatedAt)} at ${clock(generatedAt)} (${utcOffset(generatedAt)})`;
}

/**
 * When the page was made, with its offset from UTC, and the offsets the runs recorded their times
 * in, since each time is shown as its run recorded it (a run recorded elsewhere keeps its own):
 * "Generated on 30 September 2026 at 09:00 (UTC−05:00). Times are as each run recorded them
 * (UTC−05:00)." With no run that counts there are no offsets, and the second sentence is left out.
 */
export function generatedLine(footer: ShareModel["footer"]): string {
  const { offsets } = footer;
  const times =
    offsets.length === 0 ? "" : ` Times are as each run recorded them (${names(offsets)}).`;
  return `Generated on ${generatedStamp(footer)}.${times}`;
}
