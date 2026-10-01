/**
 * The page's cards: one for each page in scope, with its result and the person's review in words,
 * what each pass captured, and its flags. Then NVDA's own words that raised each flag, and the
 * pages the latest list no longer has. Pure: it works from records already read.
 */
import { flagQuotes, type FlagRules, type PagePasses } from "../flags/evaluate.js";
import {
  PASS_NAMES,
  type FlagResult,
  type PageRecord,
  type PageStatus,
  type PassName,
  type ReviewStatus,
  type RunJson,
  type StopReason,
} from "../model.js";
import { normalizeSpeech } from "../passes/steps.js";
import { pageName } from "../report/model.js";
import { attentionClauses } from "./attention.js";
import { longDate, pagePath } from "./format.js";
import type { TranscriptStore } from "./load.js";
import type { ProblemsSection } from "./problems.js";
import type { PageReview } from "./review.js";
import { notRecordedBy, sessionVersion, versionOf } from "./run-evidence.js";
import type { PageStanding, Standing } from "./standing.js";
import { SKIP_REASONS } from "./summary.js";

export interface PageCard {
  key: string;
  slug: string;
  /** What the page is called: its label, else its address. */
  name: string;
  /** Its address without the site's: "/how-a-run-works/". */
  path: string;
  /**
   * The title the browser reported with the transcripts shown (for a page never transcribed, with
   * the latest run's record): null when the page had none or never loaded, and "Not recorded" for
   * a run from before voicecap recorded titles.
   */
  title: string | null | { notRecorded: string };
  /**
   * The page's latest result: read in full in the latest run with no flags or with flags; failed
   * there, with transcripts from an earlier run; never transcribed; or skipped there.
   */
  status: "no-flags" | "flags" | "failed" | "never" | "skipped";
  /**
   * The status chip's words: "Transcribed" for a page read in full in the latest run (its flags have
   * chips of their own), else what the latest run did and where the transcripts come from.
   */
  statusText: string;
  /**
   * The person's review, as far as the records show it: "Listened to live by <name>" ("Listened to
   * live" with no name), "<name> listened to part of this session", "Reviewed, no issues", "Issue
   * found", "Fixed", and "Changed since review".
   */
  reviewChips: string[];
  /** The manual NVDA sessions on the page: the day each was, and who imported it. */
  manual: { at: string; reviewer: string | null }[];
  /**
   * What each pass of the shown transcripts captured: the lines read, the headings, and the Tab
   * stops. A pass the run didn't read is null. Null for a page with no transcripts.
   */
  counts: { read: number | null; headings: number | null; tab: number | null } | null;
  /** How long the shown transcription of the page took. */
  timeMs: number | null;
  /** One bar per read-pass line: how long it took, and its length in characters. */
  strip: { ms: number; chars: number }[];
  /**
   * The page as the browser showed it. "Not recorded: this run used voicecap <v>." until stage 2
   * records screenshots, for the run of the record the card speaks for.
   */
  screenshot: { dataUri: string; alt: string } | { notRecorded: string };
  /** When the shown transcripts come from an older run than the latest: its id, and its date. */
  from: { run: string; date: string } | null;
  /** The latest run's failure, or why it skipped the page, in plain words; home replaced. */
  failure: string | null;
  /** The flags of the shown transcripts, computed with the current rules. */
  flags: FlagResult[];
  /**
   * No transcripts, flags, a failure or a skip, an open issue, or transcripts that changed since
   * their review: the card is never folded away as having nothing to note.
   */
  needsAttention: boolean;
}

export interface FlagQuote {
  rule: string;
  /** What the rule found, in plain words. */
  text: string;
  /** Up to 3 lines NVDA spoke that raised it, word for word: none for a rule that finds no items. */
  said: string[];
}

export interface FlaggedPage {
  card: PageCard;
  /** One for each rule that raised a flag, in the order the rules raised them. */
  quotes: FlagQuote[];
}

export interface NoLongerListed {
  name: string;
  url: string;
  /** The last counted run that had the page, and what that run's record of it says. */
  lastRun: string;
  lastStatus: string;
}

interface CardsInput {
  standing: Standing;
  review: Map<string, PageReview>;
  problems: ProblemsSection;
  transcripts: TranscriptStore;
}

/** A card for each page in scope, in the latest run's page order. */
export function cardsOf(input: CardsInput): PageCard[] {
  const { standing, transcripts } = input;
  return standing.pages.map((page) => {
    const { shown } = page;
    const flags = shown?.page.flags ?? [];
    const review = input.review.get(page.key) ?? null;
    const { status, statusText } = statusOf(page, flags);
    // The record the card speaks for: the transcripts shown, else the latest run's. A completed run
    // has a record of every page, done, failed, or skipped, so there is always one.
    const source = shown ?? page.latestFailure;
    const version =
      source === null
        ? standing.latest && versionOf(standing.latest)
        : sessionVersion(source.run, source.page.session);
    return {
      key: page.key,
      slug: page.slug,
      name: pageName(page),
      path: pagePath(page.url),
      title: source === null ? null : titleOf(source.page, version),
      status,
      statusText,
      reviewChips: reviewChips(review),
      manual: (review?.manual ?? []).map(({ json }) => ({
        // A session's local date, as its record keeps it: "2026-09-25".
        at: longDate(`${json.session.date}T00:00`),
        reviewer: json.reviewer || null,
      })),
      counts: shown === null ? null : countsOf(shown.page),
      timeMs: shown?.page.durationMs ?? null,
      strip:
        shown === null
          ? []
          : (transcripts.steps(shown.run.id, shown.page.slug, "read") ?? []).map((step) => ({
              ms: step.durationMs,
              chars: normalizeSpeech(step.spoken).length,
            })),
      screenshot: { notRecorded: notRecordedBy(version) },
      from:
        shown !== null && shown.run !== standing.latest
          ? { run: shown.run.id, date: longDate(shown.run.createdAt) }
          : null,
      failure: failureOf(page, input.problems),
      flags,
      needsAttention:
        shown === null ||
        flags.length > 0 ||
        page.latestFailure !== null ||
        review?.latest?.status === "issue" ||
        review?.changedSinceReview === true,
    };
  });
}

function statusOf(
  page: PageStanding,
  flags: FlagResult[],
): Pick<PageCard, "status" | "statusText"> {
  const { shown, latestFailure } = page;
  const transcribed = shown === null ? "never transcribed" : `transcribed in run ${shown.run.id}`;
  if (latestFailure?.page.status === "failed") {
    return {
      status: shown === null ? "never" : "failed",
      statusText: `Failed in run ${latestFailure.run.id} · ${transcribed}`,
    };
  }
  if (latestFailure?.page.status === "skipped") {
    return {
      status: "skipped",
      statusText: `Skipped in run ${latestFailure.run.id} · ${transcribed}`,
    };
  }
  if (shown === null) return { status: "never", statusText: "Never transcribed" };
  return { status: flags.length > 0 ? "flags" : "no-flags", statusText: "Transcribed" };
}

function titleOf(page: PageRecord, version: string | null): PageCard["title"] {
  return page.title === undefined ? { notRecorded: notRecordedBy(version) } : page.title;
}

/** The latest review's status, as the report words it; an unreviewed page has no chip for it. */
const REVIEWED: Partial<Record<ReviewStatus, string>> = {
  reviewed: "Reviewed, no issues",
  issue: "Issue found",
  fixed: "Fixed",
};

/** The person's review, leading with what they did. What they haven't done has no chip. */
function reviewChips(review: PageReview | null): string[] {
  if (review === null) return [];
  const chips: string[] = [];
  const { listened, latest } = review;
  if (listened?.answer === "all") {
    chips.push(
      listened.name === null ? "Listened to live" : `Listened to live by ${listened.name}`,
    );
  } else if (listened?.answer === "part") {
    chips.push(
      listened.name === null
        ? "Listened to part of this session"
        : `${listened.name} listened to part of this session`,
    );
  }
  const decision = latest === null ? undefined : REVIEWED[latest.status];
  if (decision !== undefined) chips.push(decision);
  if (review.changedSinceReview) chips.push("Changed since review");
  return chips;
}

/**
 * What each pass captured, from the page's record: the lines of the read pass, and the headings and
 * Tab stops, without the step that found the end ("no next heading", or focus leaving the page).
 */
function countsOf(page: PageRecord): NonNullable<PageCard["counts"]> {
  const found = (pass: PassName, end: StopReason): number | null => {
    const summary = page.passes[pass];
    if (summary === undefined) return null;
    return summary.steps - (summary.stopReason === end && summary.steps > 0 ? 1 : 0);
  };
  return {
    read: page.passes.read?.steps ?? null,
    headings: found("headings", "no-next-heading"),
    tab: found("tab", "left-document"),
  };
}

/**
 * The latest run's failure of the page in plain words: what happened on its last attempt, as the
 * problems say it, after how many attempts failed. A skipped page says why voicecap skipped it.
 */
function failureOf(page: PageStanding, problems: ProblemsSection): string | null {
  const latest = page.latestFailure;
  if (latest === null) return null;
  if (latest.page.status === "skipped") {
    const reason = latest.page.skip?.reason;
    const why = reason === undefined ? undefined : SKIP_REASONS[reason];
    return why === undefined
      ? "voicecap skipped it after it loaded."
      : `voicecap skipped it: ${why}.`;
  }
  const last = problems.problems.findLast(
    (problem) => problem.run === latest.run.id && problem.page.key === page.key,
  );
  if (last === undefined) return "It couldn't be read, and its record doesn't say why.";
  const attempts = latest.page.attempts;
  if (attempts <= 1) return last.happened;
  const all = attempts === 2 ? "both" : `all ${attempts}`;
  return `It failed on ${all} attempts. On the last, ${lowerFirst(last.happened)}`;
}

/** A sentence's first word in lowercase, to follow other words: never a name such as "NVDA". */
function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/** The most lines quoted for a rule. */
const QUOTED = 3;

/**
 * Each page with flags, with NVDA's own words that raised them: a row for each rule, what it found
 * in plain words, and up to 3 of the lines it matched in the shown transcripts, as the rule itself
 * matched them with `rules` (flagQuotes).
 */
export function flaggedOf(
  standing: Standing,
  cards: PageCard[],
  transcripts: TranscriptStore,
  rules: FlagRules,
): FlaggedPage[] {
  return standing.pages.flatMap((page, index) => {
    const card = cards[index];
    const { shown } = page;
    if (card === undefined || shown === null || card.flags.length === 0) return [];
    const passes = shownPasses(shown, transcripts);
    const ruleIds = [...new Set(card.flags.map((flag) => flag.rule))];
    const quotes = ruleIds.map((rule): FlagQuote => {
      const flags = card.flags.filter((flag) => flag.rule === rule);
      const clause = attentionClauses(flags, null, null);
      // A rule raised in more than one pass quotes each line once, the first pass's first.
      const said = [...new Set(flags.flatMap((flag) => flagQuotes(passes, rules, flag)))];
      return {
        rule,
        text: `${clause.charAt(0).toUpperCase()}${clause.slice(1)}.`,
        said: said.slice(0, QUOTED),
      };
    });
    return [{ card, quotes }];
  });
}

/** The passes of a page's shown transcripts, as the flag rules read them: steps and stop reason. */
function shownPasses(
  shown: { run: RunJson; page: PageRecord },
  transcripts: TranscriptStore,
): PagePasses {
  const passes: PagePasses = {};
  for (const pass of PASS_NAMES) {
    const summary = shown.page.passes[pass];
    const steps = transcripts.steps(shown.run.id, shown.page.slug, pass);
    if (summary !== undefined && steps !== null) {
      passes[pass] = { steps, stopReason: summary.stopReason };
    }
  }
  return passes;
}

/** A page's status in its last record, for the "No longer listed" table. */
const LAST_STATUS: Record<PageStatus, string> = {
  done: "Transcribed",
  failed: "Failed",
  skipped: "Skipped",
  pending: "Not reached",
};

/** The pages earlier counted runs had and the latest's list doesn't, with their last record. */
export function noLongerListedOf(standing: Standing): NoLongerListed[] {
  return standing.noLongerListed.map(({ run, page }) => ({
    name: pageName(page),
    url: page.url,
    lastRun: run.id,
    lastStatus: LAST_STATUS[page.status],
  }));
}
