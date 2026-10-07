/**
 * The page's cards: one for each page in scope, with its result and the person's review in words,
 * what each pass captured, and its flags. Then the passes of the transcripts shown, which NVDA's own
 * words in "What needs attention" are read from, and the pages the latest list no longer has. Pure:
 * it works from records already read.
 */
import type { PagePasses } from "../flags/evaluate.js";
import {
  PASS_NAMES,
  SCREENSHOT_FILE,
  type FileHash,
  type FlagResult,
  type PageRecord,
  type PageStatus,
  type PassName,
  type ReviewStatus,
  type RunJson,
  type StopReason,
} from "../model.js";
import { normalizeSpeech } from "../passes/steps.js";
import { MAIN_COMMAND, stepLine } from "../transcripts/format.js";
import { jpegSize } from "../util/jpeg.js";
import type { CheckData } from "./check.js";
import { longDate, pagePath, type Shown } from "./format.js";
import type { ShareInput, TranscriptStore } from "./load.js";
import { READ_STOPPED, readStoppedOf, type ProblemsSection } from "./problems.js";
import { screenshotRecordOf } from "./records.js";
import type { PageReview } from "./review.js";
import { keepsScreenshots, notRecordedBy, sessionVersion, versionOf } from "./run-evidence.js";
import { cardRecord, type PageStanding, type Standing } from "./standing.js";
import { SKIP_REASONS } from "./summary.js";
import { SCREENSHOT_TEXT } from "./text.js";

export interface PageCard {
  key: string;
  slug: string;
  /** What the page is called: its label, else its address, as the page shows it (see `Shown`). */
  name: string;
  /** The page list gave the page a label (one that isn't blank): `name` is it, whatever it says. */
  labeled: boolean;
  /** Its address without the site's: "/how-a-run-works/". */
  path: string;
  /**
   * The title the browser reported with the transcripts shown (for a page never transcribed, with
   * the latest run's record): null when the page had none or never loaded, and "Not recorded" for
   * a run from before voicecap recorded titles.
   */
  title: string | null | { notRecorded: string };
  /**
   * The page's latest result: transcribed in the latest run, with no flags or with flags (read in
   * full only when its read reached the page's end: see `readStopped`); failed there, with
   * transcripts from an earlier run; never transcribed; or skipped there.
   */
  status: "no-flags" | "flags" | "failed" | "never" | "skipped";
  /**
   * The status chip's words: "Transcribed" for a page read in full in the latest run (its flags have
   * chips of their own), "Transcribed; its read stopped at the step limit" (or "before the end of
   * the page") for one whose read stopped short, else what the latest run did and where the
   * transcripts come from.
   */
  statusText: string;
  /**
   * How the read pass of the transcripts shown stopped before the page's end: at its step limit, or
   * by the repeat safety net (see READ_STOPPED). Such a page was transcribed, but not read in full.
   * Null when the read reached the end, and for a page with no read pass or no transcripts.
   */
  readStopped: keyof typeof READ_STOPPED | null;
  /**
   * The person's review, as far as the records show it: "Heard live by <name>" ("Heard live" with no
   * name), "<name> heard part of this session" ("Heard part of this session" with no name),
   * "Reviewed, no issues", "Issue found", "Fixed", and "Changed since review". On a page with a flag
   * a review settles (any but a read that stopped before the page's end), a review of the
   * transcripts shown (no change since) is "Checked by <name>, <date>: not an issue" in place of
   * "Reviewed, no issues".
   */
  reviewChips: string[];
  /** The manual NVDA sessions on the page: the day each was, and who imported it. */
  manual: { at: string; reviewer: string | null }[];
  /**
   * What each pass of the shown transcripts captured: the lines read, the headings, and the Tab
   * stops. A pass the run didn't read is null. Null for a page with no transcripts.
   */
  counts: { read: number | null; headings: number | null; tab: number | null } | null;
  /**
   * How long the shown transcription of the page took, or "Not recorded: this run used voicecap
   * <v>." when its record keeps no time. Null for a page with no transcripts.
   */
  timeMs: number | { notRecorded: string } | null;
  /** One bar per read-pass line: how long it took, and its length in characters. */
  strip: { ms: number; chars: number }[];
  /**
   * The first `HEARD` lines NVDA said as it read the page, from the read pass of the transcripts
   * shown, as the transcript writes each line: the steps of the key that pass presses, so not the
   * Ctrl+End and Ctrl+Home that set it up. Fewer when the pass has fewer, and none for a page with
   * no transcripts or whose read transcript can't be read here.
   */
  heardFirst: string[];
  /**
   * The page as the browser showed it once it had loaded, before the screen reader read it: the
   * JPEG as an image's address (`dataUri`), its words for a screen reader, and its size in pixels as
   * its record gives it, a little less than half the browser window's, since the window's own bar
   * takes some of its height. It's the picture of the record the card speaks for (the one whose
   * transcripts it shows, else its latest failure's). Where there's none, the words that say why:
   * the run's voicecap didn't take one (from before 0.11.0), its screen reader driver doesn't, the
   * page wasn't read, the browser couldn't, or the file isn't as the run recorded it.
   */
  screenshot:
    { dataUri: string; alt: string; width: number; height: number } | { notRecorded: string };
  /** When the shown transcripts come from an older run than the latest: its id, and its date. */
  from: { run: string; date: string } | null;
  /** The latest run's failure, or why it skipped the page, in plain words; home replaced. */
  failure: string | null;
  /**
   * The flags of the shown transcripts, computed with the current rules, unless `flagsAsRecorded`
   * says they're as the run recorded them.
   */
  flags: FlagResult[];
  /**
   * The shown transcripts' flags are their record's, not the current rules': a JSON transcript of
   * the page couldn't be read here to compute them afresh.
   */
  flagsAsRecorded: boolean;
  /**
   * No transcripts, flags, a read that stopped short, a failure or a skip, an open issue, or
   * transcripts that changed since their review: the card is never folded away as having nothing
   * to note. It is broader than `ShareModel.ring.needAttention`, which counts only the pages that a
   * card of What needs attention names: a page whose flags a review settled, and one that wasn't
   * read, are true here, and aren't counted there.
   */
  needsAttention: boolean;
}

export interface NoLongerListed {
  /** What the page is called: its label, else its address. */
  name: string;
  /** Its address, as the page shows it: on the site's canonical address (see `Shown`). */
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
  /** The pages whose flags are their record's (ShareInput.flagsAsRecorded). */
  flagsAsRecorded: { run: string; slug: string }[];
  /** How a page is called: its label, else its address as the page shows it (see `Shown`). */
  name: (page: { label?: string; url: string }) => string;
  /** The screenshot files the page can show (ShareInput.screenshots). */
  screenshots: ShareInput["screenshots"];
  /** A run's screen reader, as its environment records it ("NVDA"). */
  screenReader: (run: RunJson) => string;
  /** The home folder replaced, in what a record's reason says. */
  redact: (text: string) => string;
}

/**
 * How many lines of a pass a sample of what NVDA said has: the home page's sample of each pass
 * (see `heardOf`, in ./model.ts), and each page's first lines of the read pass (`heardFirst`).
 */
export const HEARD = 3;

/** A card for each page in scope, in the latest run's page order. */
export function cardsOf(input: CardsInput): PageCard[] {
  const { standing, transcripts } = input;
  const asRecorded = new Set(input.flagsAsRecorded.map(({ run, slug }) => `${run}/${slug}`));
  const tookAny = new Map<RunJson, boolean>();
  return standing.pages.map((page) => {
    const { shown } = page;
    const flags = shown?.page.flags ?? [];
    const review = input.review.get(page.key) ?? null;
    const readStopped = shown === null ? null : readStoppedOf(shown.page);
    const { status, statusText } = statusOf(page, flags, readStopped);
    // The record the card speaks for: the transcripts shown, else the latest run's. A completed run
    // has a record of every page, done, failed, or skipped, so there is always one.
    const source = cardRecord(page);
    const version =
      source === null
        ? standing.latest && versionOf(standing.latest)
        : sessionVersion(source.run, source.page.session);
    const name = input.name(page);
    const readSteps =
      shown === null ? [] : (transcripts.steps(shown.run.id, shown.page.slug, "read") ?? []);
    return {
      key: page.key,
      slug: page.slug,
      name,
      labeled: (page.label?.trim() ?? "") !== "",
      path: pagePath(page.url),
      title: source === null ? null : titleOf(source.page, version),
      status,
      statusText,
      readStopped,
      reviewChips: reviewChips(review, flags),
      manual: (review?.manual ?? []).map(({ json }) => ({
        // A session's local date, as its record keeps it: "2026-09-25".
        at: longDate(`${json.session.date}T00:00`),
        reviewer: json.reviewer || null,
      })),
      counts: shown === null ? null : countsOf(shown.page),
      timeMs:
        shown === null ? null : (shown.page.durationMs ?? { notRecorded: notRecordedBy(version) }),
      strip: readSteps.map((step) => ({
        ms: step.durationMs,
        chars: normalizeSpeech(step.spoken).length,
      })),
      heardFirst: readSteps
        .filter((step) => step.command === MAIN_COMMAND.read)
        .slice(0, HEARD)
        .map((step) => stepLine(step, "read")),
      screenshot: screenshotOf(source, version, name, input, tookAny),
      from:
        shown !== null && shown.run !== standing.latest
          ? { run: shown.run.id, date: longDate(shown.run.createdAt) }
          : null,
      failure: failureOf(page, input.problems),
      flags,
      flagsAsRecorded: shown !== null && asRecorded.has(`${shown.run.id}/${shown.page.slug}`),
      needsAttention:
        shown === null ||
        flags.length > 0 ||
        readStopped !== null ||
        page.latestFailure !== null ||
        review?.latest?.status === "issue" ||
        review?.changedSinceReview === true,
    };
  });
}

/** A JPEG as the address an image of the page has: its bytes in base64, as the page carries them. */
const JPEG_ADDRESS = "data:image/jpeg;base64,";

/**
 * The JPEG an address of that kind holds, as bytes (a plain Uint8Array of its own, not a view of the
 * pool Node's Buffers share): what the Word copy embeds.
 */
export function jpegOfAddress(address: string): Uint8Array {
  return new Uint8Array(Buffer.from(address.slice(JPEG_ADDRESS.length), "base64"));
}

/**
 * A page's screenshot as its card shows it, of the record the card speaks for. A record with the
 * file's fingerprint is the picture, when the loader holds the file (it holds only a file as its
 * record has it), at the size the record gives, else the size the picture itself gives; otherwise
 * it's the words that say why there's none, as SCREENSHOT_TEXT has them: the file isn't as recorded,
 * the file is as recorded but isn't a picture with a size, or the record itself (read through
 * `screenshotRecordOf`) is of no kind voicecap writes.
 *
 * A record with no screenshot says it as every part a run didn't record is said, when its run is
 * from before voicecap took screenshots (0.11.0). From then on, either its run's driver took none of
 * its pages' screenshots, or this page wasn't read (it was skipped, or it failed before it
 * loaded). `tookAny` remembers, by run, whether any page of it has a screenshot record.
 */
function screenshotOf(
  source: { run: RunJson; page: PageRecord } | null,
  version: string | null,
  name: string,
  input: CardsInput,
  tookAny: Map<RunJson, boolean>,
): PageCard["screenshot"] {
  if (source === null) return { notRecorded: notRecordedBy(version) };
  const { run, page } = source;
  const record = screenshotRecordOf(page);
  if (record === "unreadable") return { notRecorded: SCREENSHOT_TEXT.unreadable };
  if (record === undefined) {
    if (!keepsScreenshots(version)) return { notRecorded: notRecordedBy(version) };
    let took = tookAny.get(run);
    if (took === undefined) {
      took = run.pages.some((each) => each.screenshot !== undefined);
      tookAny.set(run, took);
    }
    return { notRecorded: took ? SCREENSHOT_TEXT.notRead : SCREENSHOT_TEXT.noDriver };
  }
  if ("error" in record) {
    return { notRecorded: SCREENSHOT_TEXT.failed(reasonOf(record.error, input.redact)) };
  }
  // The loader holds a file only when it's as its record has it.
  const bytes = input.screenshots.get(`${run.id}/${page.slug}`);
  if (bytes === undefined) return { notRecorded: SCREENSHOT_TEXT.changed };
  const size = sizeOf(record, bytes);
  if (size === null) return { notRecorded: SCREENSHOT_TEXT.notAPicture };
  return {
    dataUri: `${JPEG_ADDRESS}${Buffer.from(bytes).toString("base64")}`,
    alt: SCREENSHOT_TEXT.alt(name, input.screenReader(run)),
    ...size,
  };
}

/**
 * The reason a screenshot couldn't be taken, as a sentence's brackets hold it: the home folder
 * replaced, on one line, and with no full stop at its end, which the sentence puts after its bracket.
 */
function reasonOf(error: unknown, redact: (text: string) => string): string {
  const said = typeof error === "string" ? redact(error) : "";
  return said
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.\s]+$/, "");
}

/**
 * A picture's size in pixels: its record's, when that's a size (two whole numbers above 0), else the
 * picture's own, from its JPEG header. Null when neither is: bytes that aren't a JPEG with a size
 * aren't what the run recorded.
 */
function sizeOf(
  record: FileHash & { width: number; height: number },
  bytes: Uint8Array,
): { width: number; height: number } | null {
  const whole = (value: unknown): value is number =>
    typeof value === "number" && Number.isInteger(value) && value > 0;
  return whole(record.width) && whole(record.height)
    ? { width: record.width, height: record.height }
    : jpegSize(bytes);
}

/**
 * The screenshots the page carries, as its fingerprint check names them: the run and the page of
 * each picture a card shows, in the order of the cards.
 */
export function embeddedOf(standing: Standing, cards: PageCard[]): CheckData["screenshots"] {
  return standing.pages.flatMap((page, index) => {
    const source = cardRecord(page);
    const shot = cards[index]?.screenshot;
    return source !== null && shot !== undefined && "dataUri" in shot
      ? [{ run: source.run.id, slug: source.page.slug, name: SCREENSHOT_FILE }]
      : [];
  });
}

function statusOf(
  page: PageStanding,
  flags: FlagResult[],
  readStopped: PageCard["readStopped"],
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
  return {
    status: flags.length > 0 ? "flags" : "no-flags",
    statusText:
      readStopped === null ? "Transcribed" : `Transcribed; its read ${READ_STOPPED[readStopped]}`,
  };
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

/**
 * The person's review, leading with what they did. What they haven't done has no chip. A review of
 * a page with flags, of the transcripts shown, checks them: it says who checked, and when, and
 * that what NVDA said is not an issue ("Checked by Pat Lee, 6 October 2026: not an issue"). A read
 * that stopped before the page's end isn't a flag a review can check: only a later run that reads
 * the page to its end settles it, so a page with no other flag has none to check.
 */
function reviewChips(review: PageReview | null, flags: FlagResult[]): string[] {
  if (review === null) return [];
  const chips: string[] = [];
  const { listened, latest } = review;
  if (listened?.answer === "all") {
    chips.push(listened.name === null ? "Heard live" : `Heard live by ${listened.name}`);
  } else if (listened?.answer === "part") {
    chips.push(
      listened.name === null
        ? "Heard part of this session"
        : `${listened.name} heard part of this session`,
    );
  }
  if (latest !== null) {
    const checkable = flags.some((flag) => flag.rule !== "read-not-finished");
    const checks = latest.status === "reviewed" && checkable && !review.changedSinceReview;
    const decision = REVIEWED[latest.status];
    if (checks) {
      chips.push(`Checked by ${latest.reviewer}, ${longDate(latest.at)}: not an issue`);
    } else if (decision !== undefined) {
      chips.push(decision);
    }
  }
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

/**
 * A sentence's first word in lowercase, to follow other words: "A step" as well as "During", and
 * never a name in capitals such as "NVDA".
 */
function lowerFirst(text: string): string {
  return /^[A-Z](?![A-Z])/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/**
 * The passes of a page's shown transcripts, as the flag rules read them: steps and stop reason. A
 * pass whose JSON transcript can't be read here isn't among them. What needs attention shows the
 * lines its flags were raised by from these (attentionCards).
 */
export function shownPasses(
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

/**
 * The pages earlier counted runs had and the latest's list doesn't, with their last record. `name`
 * says how a page is called, and `shown` gives its address, as the page shows them.
 */
export function noLongerListedOf(
  standing: Standing,
  name: CardsInput["name"],
  shown: Shown,
): NoLongerListed[] {
  return standing.noLongerListed.map(({ run, page }) => ({
    name: name(page),
    url: shown(page.url),
    lastRun: run.id,
    lastStatus: LAST_STATUS[page.status],
  }));
}
