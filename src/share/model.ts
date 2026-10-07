/**
 * The shareable page's model: everything the page shows, worked out from a site's records by the
 * design's rules ("The page, top to bottom", "The site's standing", "The human review"). Pure: it
 * works from what loadShareInput (./load.ts) read, and reads nothing itself.
 *
 * Each section's parts come from their own modules: the standing, the problems, the changes since
 * the run before, the human review and the summary, the page cards (./cards.ts), the cards of what
 * needs attention (./attention.ts), each run's evidence (./run-evidence.ts), and each run's event
 * log (./timeline.ts), whose events the evidence and the problems' records say in the same words.
 * This puts them together, and works out the top, the result the verdict goes by and the ring of
 * the pages, the sample of what NVDA said, what the results cover, the appendix of transcripts, and
 * the fingerprint check's data.
 *
 * The home folder is replaced in everything the page shows: flags' and reviewers' words here, and
 * the description of a custom rule, which names its card; the problems' in problemsOf, the
 * evidence's in evidenceOf, the reason a screenshot couldn't be taken in cardsOf. The run records
 * and transcripts the page embeds for its fingerprint check are exactly as recorded, since a seal
 * covers every field.
 *
 * A site is named by its canonical address, and every address the page shows for one of its pages
 * is the page on that address: `shown`, made here, maps the address voicecap read onto it, and the
 * parts that show an address whole (a page's name, the sample, the pages no longer listed, the
 * sitemap, the page source) take it from here. A page's `url` in the records and in the model's
 * lists is as it was read, and a part that shows one shows only its path. The run records, the
 * walkthrough files, and a problem's record keep the address voicecap read.
 */
import {
  PASS_NAMES,
  type FileHash,
  type PageSource,
  type PassName,
  type ReviewsFile,
  type RunJson,
  type ShareResult,
} from "../model.js";
import { canonicalName, readLocation, toCanonical } from "../pages/canonical.js";
import { describeChanges, distinctEnvironments } from "../report/compare.js";
import { pageName } from "../report/model.js";
import { redactHome } from "../run/failure.js";
import { extractBody, MAIN_COMMAND, stepLine } from "../transcripts/format.js";
import { attentionCards, type AttentionCard, type AttentionPage } from "./attention.js";
import {
  cardsOf,
  embeddedOf,
  HEARD,
  noLongerListedOf,
  shownPasses,
  type NoLongerListed,
  type PageCard,
} from "./cards.js";
import { changesOf, type Changes } from "./changes.js";
import type { CheckData } from "./check.js";
import {
  dateAndTime,
  dateRange,
  longDate,
  names,
  seconds,
  utcOffset,
  type Shown,
} from "./format.js";
import type { ShareInput, TranscriptStore } from "./load.js";
import { problemsOf, type EventRows, type ProblemsSection } from "./problems.js";
import { reviewOf, type PageReview } from "./review.js";
import {
  eventLogGap,
  evidenceOf,
  leftOutOf,
  runEnd,
  runStart,
  type RunEvidence,
} from "./run-evidence.js";
import { runBefore, standingOf, type PageStanding, type Standing } from "./standing.js";
import { summaryOf, type Summary } from "./summary.js";
import { TIMELINE_TEXT } from "./text.js";
import {
  attemptEvents,
  eventText,
  eventWordsOf,
  isEventTime,
  type EventWords,
} from "./timeline.js";

export type { NoLongerListed, PageCard } from "./cards.js";
export type {
  EvidenceRow,
  RunEvidence,
  RunWalkthrough,
  WalkthroughDownload,
} from "./run-evidence.js";

/** A transcript file the appendix shows: what NVDA said in a pass, with the file's fingerprint. */
export interface AppendixFile {
  pass: PassName;
  /**
   * The run and the page's slug its record files it under, which with `name` say which of the
   * fingerprint check's files it is: the check compares the text shown with that file's.
   */
  run: string;
  slug: string;
  /** "read.txt". */
  name: string;
  /** The lines NVDA spoke, word for word: the file without its header block. */
  text: string;
  lines: number;
  /** The file's size and SHA-256, as its run recorded them. */
  bytes: number;
  sha256: string;
}

export interface ShareModel {
  header: {
    /**
     * The headline: the site's canonical name, the host of its canonical address
     * ("dvfr.illinois.gov"), else, with none known, the host voicecap read ("127.0.0.1:4848").
     */
    name: string;
    /**
     * The site's address, shown small: the root of its canonical address
     * ("https://dvfr.illinois.gov/"), else the address voicecap read.
     */
    site: string;
    /** report.siteName, a line under the name that the setting never replaces. Null when unset. */
    siteName: string | null;
    /**
     * The days of the runs the results come from ("29 to 30 September 2026"): the latest run, and
     * each run a page's transcripts or its latest failure come from, but not a run the page only
     * compares the latest with. Null when no run counts.
     */
    tested: string | null;
    /**
     * When the latest run began (its first session's start, as the evidence's "Started" says it), as
     * that run recorded it: "29 September 2026, 14:02". Null when no run counts.
     */
    testedAt: string | null;
    /** The page's own date: "30 September 2026". */
    asOf: string;
    /** Who ran the latest run's last session, when the record names someone. */
    preparedBy: string | null;
    /** The screen reader the results come from, by name: "NVDA". */
    screenReader: string;
    /**
     * Where the runs read the site, against its canonical address (see readLocation): at that
     * address, or the same but for http or https or a www. ("same"), at a copy on the computer that
     * ran them, at a loopback address ("local"), or at a copy at another address, another
     * computer's IP address among them ("elsewhere"). Null when the site has no canonical address,
     * so there's no copy to speak of. No address is ever said.
     */
    readFrom: "same" | "local" | "elsewhere" | null;
  };
  summary: Summary;
  /**
   * What the page's verdict goes by, and `voicecap share` records for the website's card (see
   * `verdictOf`, in ./verdict.ts): the pages in scope, how many NVDA read (those with transcripts),
   * and the problems that need attention (a card for each, as What needs attention has them) with
   * how many different pages they're on. All four are the summary's.
   */
  result: ShareResult;
  /**
   * The ring of the pages: how many have no problems, how many need attention (a card of What needs
   * attention is on them), and how many were not read (they have no transcripts, so no result of
   * their own to speak of, whatever else is said of them). Each page is in one part, so the three
   * add up to `result.pages`.
   */
  ring: { noProblems: number; needAttention: number; notRead: number };
  /**
   * What needs attention: a card for each problem across the pages in scope, most pages first, from
   * the shown transcripts' flags (the current rules'), the pages the latest run couldn't read, open
   * issues, and pages changed since their review (see attentionCards).
   */
  attention: AttentionCard[];
  /**
   * The first three lines of each pass on the home page (the page at "/", else the first in scope),
   * from its shown transcripts, each with how long it took ("1.3 s"). Null when that page has none.
   * `page` names the page: its label, else its address, as the page shows it.
   */
  heard: {
    page: string;
    passes: { pass: PassName; lines: { text: string; took: string }[] }[];
  } | null;
  pages: PageCard[];
  noLongerListed: NoLongerListed[];
  /** What sounds different since the run before; null when there's no run before. */
  changes: Changes | null;
  problems: ProblemsSection;
  coverage: { covered: string[]; limits: string[] };
  /** The runs the standing draws on, the latest first. */
  evidence: RunEvidence[];
  /** The runs left out, oldest first, each as one line that starts with its id. */
  leftOut: { id: string; text: string }[];
  /**
   * Every page with transcripts, in page order: each pass's TXT transcript, and the passes whose
   * transcript the run recorded but couldn't be read here, which the page names instead.
   */
  appendix: { slug: string; name: string; files: AppendixFile[]; unreadable: PassName[] }[];
  /** What the page's fingerprint check checks: the records and transcripts exactly as recorded. */
  check: CheckData;
  /** The flag rules the page's flags were computed with: their fingerprint, part of the evidence. */
  flagRulesSha256: string;
  /**
   * When the page was made, its file's name and its Word copy's, and each UTC offset the runs it
   * draws on recorded their times in ("UTC−05:00"), in the order met: the page shows each time as
   * its run recorded it.
   */
  footer: { generatedAt: string; fileName: string; wordName: string; offsets: string[] };
}

/** Build the page's model from what loadShareInput read. Pure. */
export function buildShareModel(input: ShareInput): ShareModel {
  const redact = (text: string) => redactHome(text, input.home, input.platform);
  // An address shown for a page is the page on the canonical address; a label names a page first.
  const shown: Shown = (url) => toCanonical(url, input.readOrigin, input.canonical);
  const nameOf = (page: { label?: string; url: string }) =>
    pageName({ ...page, url: shown(page.url) });
  const standing = standingOf(input.runs.map((run) => withFlagsRedacted(run, redact)));
  const review = reviewOf(
    standing,
    withNotesRedacted(input.reviews, redact),
    input.manual,
    input.generatedAt,
  );
  // A run's event log, and its events in the page's words: each page as the page names it.
  const eventLog = (run: RunJson) => input.events.get(run.id) ?? null;
  const said = new Map<RunJson, EventWords>();
  const wordsFor = (run: RunJson): EventWords => {
    const known = said.get(run);
    if (known !== undefined) return known;
    const words = eventWordsOf(run, nameOf, redact);
    said.set(run, words);
    return words;
  };
  // What a run's log says of an attempt, for its problem's record: its lines, or, where the page
  // can't show the log, the reason the run's evidence gives.
  const eventRows: EventRows = (run, page, attempt) => {
    const log = eventLog(run);
    const gap = eventLogGap(run, log);
    if (gap !== null) return { gap: TIMELINE_TEXT.gaps[gap].problem };
    if (log === null) return null;
    const words = wordsFor(run);
    const rows = attemptEvents(log, page.url, attempt).map((event) => ({
      time: event.at,
      entry: eventText(event, words),
    }));
    return { rows };
  };
  const problems = problemsOf(standing, {
    home: input.home,
    platform: input.platform,
    eventRows,
  });
  const { latest } = standing;
  const before = latest && runBefore(standing.counted, latest);
  const compared =
    latest && before ? changesOf(before, latest, bodyOf(input.transcripts), nameOf) : null;
  // What tools differ can name a setting's path, which can hold the home folder.
  const changes = compared && { ...compared, tools: compared.tools.map(redact) };
  const pages = cardsOf({
    standing,
    review,
    problems,
    transcripts: input.transcripts,
    flagsAsRecorded: input.flagsAsRecorded,
    name: nameOf,
    screenshots: input.screenshots,
    screenReader: (run) => wordsFor(run).screenReader,
    redact,
  });
  // A custom rule's card is named by the rule's description, which a person writes in the config
  // and may hold the home folder: replaced here, as the flags' messages are.
  const rules = {
    ...input.flagRules,
    custom: input.flagRules.custom.map((rule) => ({
      ...rule,
      description: redact(rule.description),
    })),
  };
  const attention = attentionCards(
    attentionPagesOf(standing, pages, review, input.transcripts),
    rules,
  );
  const summary = summaryOf({
    standing,
    review,
    problems,
    changes,
    flags: new Map(standing.pages.map((page) => [page.key, page.shown?.page.flags ?? []])),
    attention,
    name: nameOf,
    linesSpoken: linesSpokenOf(standing),
    nvdaMs: nvdaMsOf(standing.drawnOn),
    sessionsWithoutEnd: standing.drawnOn
      .flatMap((run) => run.sessions)
      .filter((session) => session.endedAt === null).length,
  });
  const recordOf = recordsOf(input.records);
  const header = headerOf(input, standing);
  return {
    header,
    summary,
    result: {
      pages: summary.numbers.pagesInScope,
      read: summary.numbers.transcribed,
      problems: summary.attention.problems,
      problemPages: summary.attention.pages,
    },
    ring: ringOf(pages, attention),
    attention,
    heard: heardOf(standing.pages, input.transcripts, nameOf),
    pages,
    noLongerListed: noLongerListedOf(standing, nameOf, shown),
    changes,
    problems,
    coverage: coverageOf(standing, redact, shown),
    evidence: evidenceOf({
      standing,
      recordOf,
      site: header.site,
      shown,
      redact,
      eventLog,
      words: wordsFor,
    }),
    leftOut: leftOutOf(standing, input.unreadableRuns),
    appendix: appendixOf(standing, input.transcripts, nameOf),
    // What the fingerprint check checks: the records of the runs drawn on and the transcripts shown,
    // exactly as recorded, which screenshots the page shows (their fingerprints are in the records:
    // the page carries no picture a third time), and the review entries.
    check: {
      runs: standing.drawnOn.map(recordOf),
      files: standing.pages.flatMap((page) =>
        shownTranscripts(page, input.transcripts).flatMap(({ run, slug, name, text }) =>
          text === null ? [] : [{ run, slug, name, text }],
        ),
      ),
      screenshots: embeddedOf(standing, pages),
      reviews: Object.keys(input.reviews.pages).length === 0 ? null : input.reviews.pages,
    },
    flagRulesSha256: input.flagRulesSha256,
    footer: {
      generatedAt: input.generatedAt,
      fileName: input.fileName,
      wordName: input.wordName,
      offsets: offsetsOf(standing.drawnOn, input.events),
    },
  };
}

/**
 * Each page in scope as the cards of what needs attention see it: its card, its review, and the
 * passes of its shown transcripts, whose lines its flags came from. A page with no transcripts
 * shown, or whose flags are as its record has them, has none: NVDA's words aren't here.
 */
function attentionPagesOf(
  standing: Standing,
  cards: PageCard[],
  review: Map<string, PageReview>,
  transcripts: TranscriptStore,
): AttentionPage[] {
  return cards.map((card, index) => {
    const shown = standing.pages[index]?.shown ?? null;
    return {
      card,
      review: review.get(card.key) ?? null,
      passes: shown === null || card.flagsAsRecorded ? null : shownPasses(shown, transcripts),
    };
  });
}

/** The run with its flags' messages as the page shows them: the home folder replaced. */
function withFlagsRedacted(run: RunJson, redact: (text: string) => string): RunJson {
  return {
    ...run,
    pages: run.pages.map((page) =>
      page.flags.length === 0
        ? page
        : {
            ...page,
            flags: page.flags.map((flag) => ({ ...flag, message: redact(flag.message) })),
          },
    ),
  };
}

/** The reviews with each note as the page shows it: the home folder replaced. */
function withNotesRedacted(reviews: ReviewsFile, redact: (text: string) => string): ReviewsFile {
  return {
    ...reviews,
    pages: Object.fromEntries(
      Object.entries(reviews.pages).map(([key, entries]) => [
        key,
        entries.map((entry) =>
          entry.note === null ? entry : { ...entry, note: redact(entry.note) },
        ),
      ]),
    ),
  };
}

/** A pass's body lines for changesOf: null when its TXT can't be read, so the change is named. */
function bodyOf(transcripts: TranscriptStore) {
  return (run: string, slug: string, pass: PassName): string[] | null => {
    const text = transcripts.txt(run, slug, pass);
    return text === null ? null : extractBody(text);
  };
}

/** Every step of every pass in the transcripts shown, as their records count them. */
function linesSpokenOf(standing: Standing): number {
  return standing.pages.reduce(
    (sum, { shown }) =>
      sum +
      Object.values(shown?.page.passes ?? {}).reduce((steps, summary) => steps + summary.steps, 0),
    0,
  );
}

/**
 * How long the runs held NVDA: each session from its start to its end, when it has both. A session
 * with no recorded end isn't counted, and the page says how many (Summary.numbers).
 */
function nvdaMsOf(runs: RunJson[]): number {
  return runs.reduce(
    (sum, run) =>
      sum +
      run.sessions.reduce((held, session) => {
        if (session.endedAt === null) return held;
        const ms = Date.parse(session.endedAt) - Date.parse(session.startedAt);
        return Number.isFinite(ms) && ms > 0 ? held + ms : held;
      }, 0),
    0,
  );
}

/**
 * The ring of the pages. A page with no transcripts was not read, though a card may name it (the
 * page the latest run couldn't read); a page with transcripts that a card names needs attention;
 * every other page has no problems.
 */
function ringOf(cards: PageCard[], attention: AttentionCard[]): ShareModel["ring"] {
  const named = new Set(attention.flatMap((card) => card.pages.map((page) => page.slug)));
  const ring = { noProblems: 0, needAttention: 0, notRead: 0 };
  for (const card of cards) {
    if (card.counts === null) ring.notRead += 1;
    else if (named.has(card.slug)) ring.needAttention += 1;
    else ring.noProblems += 1;
  }
  return ring;
}

/** The site's home page: the one at "/", else the first. */
function homeOf<T extends { url: string }>(pages: T[]): T | undefined {
  return pages.find((page) => new URL(page.url).pathname === "/") ?? pages[0];
}

/**
 * The header. The site is named by its canonical address when it has one, else by the address
 * voicecap read, with its port as its folder has it. Neither is the setting or the home page's
 * title: the setting is a line under the name, and a page's title names no site.
 */
function headerOf(input: ShareInput, standing: Standing): ShareModel["header"] {
  const { latest } = standing;
  const { canonical, readOrigin } = input;
  const environment = latest?.sessions.findLast(
    (session) => session.environment?.screenReader,
  )?.environment;
  return {
    name: canonical === null ? new URL(readOrigin).host : canonicalName(canonical),
    site: canonical ?? readOrigin,
    siteName: input.siteName?.trim() || null,
    tested: latest === null ? null : testedOf(resultsFrom(standing, latest)),
    testedAt: latest === null ? null : dateAndTime(runStart(latest)),
    asOf: longDate(input.generatedAt),
    preparedBy: latest?.sessions.at(-1)?.reviewer?.name ?? null,
    // Every run voicecap can count today is NVDA's.
    screenReader: environment?.screenReader?.name ?? "NVDA",
    readFrom: canonical === null ? null : readLocation(readOrigin, canonical),
  };
}

/**
 * The runs the results come from: the latest, and each run a page's shown transcripts or latest
 * failure come from. The run before the latest is among them only when one of those is its.
 */
function resultsFrom(standing: Standing, latest: RunJson): RunJson[] {
  const runs = new Set<RunJson>([latest]);
  for (const { shown, latestFailure } of standing.pages) {
    if (shown) runs.add(shown.run);
    if (latestFailure) runs.add(latestFailure.run);
  }
  return [...runs];
}

/**
 * Each UTC offset the runs recorded their times in, once, in the order met: their starts, ends,
 * sessions, listeners' answers, failed attempts, and the events of their logs, the times the page
 * shows.
 */
function offsetsOf(runs: RunJson[], logs: ShareInput["events"]): string[] {
  const times = runs.flatMap((run) => [
    run.createdAt,
    run.completedAt,
    ...run.sessions.flatMap((session) => [
      session.startedAt,
      session.endedAt,
      session.listener?.answeredAt,
    ]),
    ...run.pages.flatMap((page) =>
      (page.failedAttempts ?? []).flatMap((attempt) => [attempt.startedAt, attempt.endedAt]),
    ),
    ...(logs.get(run.id)?.events ?? []).map((event) => event.at).filter(isEventTime),
  ]);
  const recorded = times.filter((time): time is string => typeof time === "string");
  return [...new Set(recorded.filter((time) => OFFSET.test(time)).map(utcOffset))];
}

/** A recorded time's offset at its end: "-05:00", or "Z". */
const OFFSET = /(?:[+-]\d{2}:\d{2}|Z)$/;

/** The days the runs ran, from the first one's start to the last one's end. */
function testedOf(runs: RunJson[]): string {
  const earliest = (a: string, b: string) => (Date.parse(b) < Date.parse(a) ? b : a);
  const latest = (a: string, b: string) => (Date.parse(b) > Date.parse(a) ? b : a);
  const starts = runs.map(runStart);
  const ends = runs.map(runEnd);
  return dateRange(starts.reduce(earliest), ends.reduce(latest));
}

/**
 * The home page's first lines in each pass: the steps of the key that pass presses, so not the
 * read pass's Ctrl+End and Ctrl+Home, which set it up. Each with how long it took: the key press
 * and NVDA's speech, until NVDA was quiet.
 */
function heardOf(
  pages: PageStanding[],
  transcripts: TranscriptStore,
  nameOf: (page: { label?: string; url: string }) => string,
): ShareModel["heard"] {
  const home = homeOf(pages);
  const shown = home?.shown;
  if (!home || !shown) return null;
  const passes = PASS_NAMES.flatMap((pass) => {
    const steps = transcripts.steps(shown.run.id, shown.page.slug, pass) ?? [];
    const lines = steps
      .filter((step) => step.command === MAIN_COMMAND[pass])
      .slice(0, HEARD)
      .map((step) => ({ text: stepLine(step, pass), took: seconds(step.durationMs) }));
    return lines.length === 0 ? [] : [{ pass, lines }];
  });
  return passes.length === 0 ? null : { page: nameOf(home), passes };
}

/** How each pass goes through a page, with the key NVDA's users press for it. */
const WAYS: Record<PassName, string> = {
  read: "line by line (Down Arrow)",
  headings: "heading by heading (H)",
  tab: "control by control (Tab)",
};

function coverageOf(
  standing: Standing,
  redact: (text: string) => string,
  shown: Shown,
): ShareModel["coverage"] {
  const { latest } = standing;
  if (latest === null) {
    return { covered: ["No live run counts yet, so these results cover no pages."], limits: [] };
  }
  return {
    covered: [
      scopeOf(standing.pages.length, latest.settings.source, redact, shown),
      passesOf(standing, latest),
      "Every problem during the runs is explained under Problems during the runs.",
    ],
    limits: [
      ...toolsOf(latest),
      "Flags match NVDA's English phrasing, and the person reviewing decides what they mean.",
      ...toolChanges(standing.drawnOn).map(redact),
    ],
  };
}

/**
 * The passes the latest run read on each page. A page shown from an earlier run that read fewer
 * has fewer, and the line says so rather than claim them for it.
 */
function passesOf(standing: Standing, latest: RunJson): string {
  const passes = PASS_NAMES.filter((pass) => latest.settings.passes.includes(pass));
  const fewer = standing.pages.filter(
    ({ shown }) =>
      shown !== null &&
      shown.run !== latest &&
      passes.some((pass) => shown.page.passes[pass] === undefined),
  ).length;
  const except =
    fewer === 0
      ? ""
      : fewer === 1
        ? ", except 1 page shown from an earlier run, which had fewer"
        : `, except ${fewer} pages shown from earlier runs, which had fewer`;
  const each = `${passes.length} ${passes.length === 1 ? "pass" : "passes"} on each page${except}`;
  return `${each}: ${names(passes.map((pass) => WAYS[pass]))}.`;
}

/** The pages in scope, and the list they came from. */
function scopeOf(
  count: number,
  source: PageSource,
  redact: (text: string) => string,
  shown: Shown,
): string {
  return `${count === 1 ? "1 page" : `${count} pages`} from ${listOf(source, redact, shown)}.`;
}

/**
 * The list the pages came from, as the page names it, with the home folder replaced and a sitemap's
 * address as the page shows it.
 */
function listOf(source: PageSource, redact: (text: string) => string, shown: Shown): string {
  switch (source.kind) {
    case "sitemap":
      return `the sitemap ${shown(source.url)}`;
    case "pages":
      return `the page list ${redact(source.file)}`;
    case "walkthrough":
      return `the walkthrough ${redact(source.file)} from run ${source.run}`;
    case "urls":
      return "the pages given";
    default: {
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}

/** The screen reader and browser the latest run's results come from. */
function toolsOf(run: RunJson): string[] {
  const environment = run.sessions.findLast((session) => session.environment !== null)?.environment;
  const reader = environment?.screenReader;
  if (!environment || !reader) return [];
  const language = reader.language === null ? "" : ` (${reader.language})`;
  const browser = environment.browser
    ? ` and ${environment.browser.name} ${environment.browser.version}`
    : "";
  return [`Results come from ${reader.name} ${reader.version}${language}${browser}.`];
}

/**
 * Each change of tools in the runs the standing draws on, as describeChanges words it: within a
 * run resumed with other tools, and from each run to the next, as the comparison with the run
 * before words it (environmentDifferences).
 */
function toolChanges(runs: RunJson[]): string[] {
  const environments = runs.map(distinctEnvironments);
  return runs.flatMap((run, index) => {
    const distinct = environments[index] ?? [];
    const [first] = distinct;
    const last = distinct.at(-1);
    const during =
      first && last && distinct.length > 1
        ? describeChanges(first, last).map((change) => `${change} (during run ${run.id}).`)
        : [];
    const next = runs[index + 1];
    const to = environments[index + 1]?.at(-1);
    const between =
      next && last && to
        ? describeChanges(last, to).map((change) => `${change} (run ${run.id} → run ${next.id}).`)
        : [];
    return [...during, ...between];
  });
}

/** A TXT transcript the page shows: the shown run's record of it, and its text. */
interface ShownTranscript {
  run: string;
  slug: string;
  pass: PassName;
  name: string;
  hash: FileHash;
  /** Its text exactly as on disk, or null when it couldn't be read. */
  text: string | null;
}

/** The TXT transcripts a page's shown record lists, in pass order: none when it has none shown. */
function shownTranscripts(page: PageStanding, transcripts: TranscriptStore): ShownTranscript[] {
  const { shown } = page;
  if (shown === null) return [];
  const { id: run } = shown.run;
  const { slug } = shown.page;
  return PASS_NAMES.flatMap((pass) => {
    const name = `${pass}.txt`;
    const hash = shown.page.files[name];
    if (hash === undefined) return [];
    return [{ run, slug, pass, name, hash, text: transcripts.txt(run, slug, pass) }];
  });
}

function appendixOf(
  standing: Standing,
  transcripts: TranscriptStore,
  nameOf: (page: { label?: string; url: string }) => string,
): ShareModel["appendix"] {
  return standing.pages.flatMap((page) => {
    if (page.shown === null) return [];
    const own = shownTranscripts(page, transcripts);
    return [
      {
        slug: page.slug,
        name: nameOf(page),
        files: own.flatMap(({ run, slug, pass, name, hash, text }): AppendixFile[] => {
          if (text === null) return [];
          const lines = extractBody(text);
          return [
            {
              pass,
              run,
              slug,
              name,
              text: lines.join("\n"),
              lines: lines.length,
              bytes: hash.bytes,
              sha256: hash.sha256,
            },
          ];
        }),
        unreadable: own.filter((file) => file.text === null).map((file) => file.pass),
      },
    ];
  });
}

/**
 * A run's record exactly as its run.json holds it, for the evidence and the fingerprint check. A
 * copy with anything changed, such as flags computed afresh, would never match its seal.
 */
function recordsOf(records: RunJson[]): (run: RunJson) => RunJson {
  const byId = new Map(records.map((record): [string, RunJson] => [record.id, record]));
  return (run) => {
    const record = byId.get(run.id);
    if (record === undefined) throw new Error(`The record of run ${run.id} wasn't read.`);
    return record;
  };
}
