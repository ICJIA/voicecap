/**
 * The sentences of the shareable report that are worked out from its model, for the page's first
 * half (the top, the summary, "How voicecap works", "Every page", "What the flags found", and the
 * appendix): the numbers, counts, names, and dates in the plain words each copy says them in.
 *
 * Each is a string, or a line (./line.ts): no markup, and nothing escaped. The page's renderers
 * (html/) escape what they draw, and the Word copy sets the same words in its own paragraphs, so the
 * two can't say different things. What no record changes is in text.ts. Pure.
 *
 * A fold's instruction to open it is the page's alone: the Word copy folds nothing. So a line that
 * has one (`appendixGist`) takes the page's sentence, and says none of its own.
 */
import type { PassName } from "../model.js";
import { plural } from "../report/html.js";
import { formatDuration } from "../util/time.js";
import { count, names, seconds } from "./format.js";
import type { Line } from "./line.js";
import type { AppendixFile, PageCard, ShareModel } from "./model.js";
import type { Summary } from "./summary.js";
import { HOW_LEAD, HOW_TEXT, PASS_WORDS, SUMMARY_TEXT, TOP_TEXT } from "./text.js";

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

// The summary.

/** One of the summary's six numbers: how it's counted, and what it counts. */
export interface NumberTile {
  /** Complete is "ok", a flag or a gap "warn", a plain count "quiet": a copy says it in words too. */
  tone: "ok" | "warn" | "quiet";
  value: { count: number } | { part: number; whole: number } | { ms: number };
  /** What follows the number: "pages in scope", "transcribed by NVDA". */
  label: string;
}

/**
 * The six numbers, in order. A count out of its total is in the tone of whether it's complete; a
 * copy says each in words, never by tone alone.
 */
export function numbersOf(model: ShareModel): NumberTile[] {
  const { pagesInScope, transcribed, flagged, rules, listened, linesSpoken, nvdaMs } =
    model.summary.numbers;
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
      tone: transcribed > 0 && listened === transcribed ? "ok" : "quiet",
      value: { part: listened, whole: transcribed },
      label: "heard live by a person",
    },
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

// What the flags found.

/** The line that opens "What the flags found": how many pages have flags, and from how many rules. */
export function flagsGist({ flagged, pages, header }: ShareModel): Line {
  if (header.tested === null) return [{ text: NO_RUN, bold: true }, " There are no flags to show."];
  if (pages.every(({ counts }) => counts === null)) {
    return [{ text: "No page has transcripts yet.", bold: true }, " There are no flags to show."];
  }
  if (flagged.length === 0) {
    return [
      { text: "No page has flags.", bold: true },
      " Flags point a person to pages worth a closer listen; none was raised.",
    ];
  }
  const rules = new Set(flagged.flatMap(({ quotes }) => quotes.map(({ rule }) => rule))).size;
  const has = flagged.length === 1 ? "has" : "have";
  return [
    {
      text: `${plural(flagged.length, "page")} ${has} flags, from ${plural(rules, "rule")}.`,
      bold: true,
    },
    " Flags point a person to pages worth a closer listen. Each quotes what NVDA actually said.",
  ];
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
    `The whole file, its header included: ${plural(file.bytes, "byte")}, SHA-256 `,
    { text: file.sha256, mono: true },
  ];
}
