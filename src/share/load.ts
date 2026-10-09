/**
 * What the shareable page is made from, read from a site's folder in the transcripts home: its
 * runs, reviews, and manual sessions, the transcripts the page shows or compares, the event logs of
 * the runs it draws on, and the screenshots and axe results it shows. Every read is here;
 * buildShareModel (./model.ts) works from what this gives it, and reads nothing itself.
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { VoicecapConfig } from "../config/schema.js";
import {
  evaluateFlags,
  flagRulesSha256,
  type FlagRules,
  type PagePasses,
} from "../flags/evaluate.js";
import { listManualSessions, type ManualSessionFile } from "../manual/list.js";
import {
  AXE_FILE,
  PASS_NAMES,
  SCREENSHOT_FILE,
  type FlagResult,
  type PageRecord,
  type PassName,
  type ReviewsFile,
  type RunEvent,
  type RunJson,
  type StepRecord,
  type TranscriptJson,
} from "../model.js";
import { recordedCanonical } from "../pages/canonical.js";
import { readReviews } from "../reviews/store.js";
import { EVENT_LOG, readEventLog } from "../run/events.js";
import { homeFolder } from "../run/failure.js";
import { eventLogFile, pageDir, runJsonPath } from "../run/paths.js";
import { listRuns } from "../run/store.js";
import { fileHash } from "../transcripts/write.js";
import { UsageError } from "../util/errors.js";
import { isoLocal } from "../util/time.js";
import { axeRecordOf, screenshotRecordOf } from "./records.js";
import { cardRecord, runBefore, standingOf, type Standing } from "./standing.js";

/** The transcripts the page shows or compares, by run id, page slug, and pass. */
export interface TranscriptStore {
  /**
   * A pass's TXT transcript, exactly as its file holds it (no byte-order mark taken off, no line
   * endings changed), so it encodes back to the bytes its run fingerprinted. Null when the file
   * can't be read, or wasn't: only the transcripts the page shows or compares are read.
   */
  txt(run: string, slug: string, pass: PassName): string | null;
  /** The steps of a pass's JSON transcript, or null when it can't be read (see `txt`). */
  steps(run: string, slug: string, pass: PassName): StepRecord[] | null;
}

export interface ShareInput {
  /**
   * The address voicecap read the site at, as its latest run recorded it ("http://127.0.0.1:4848"):
   * the latest counted run's, else the newest run's. It's the address of a copy when the site's own
   * is `canonical`, and then no page leads with it or shows it for a page.
   */
  readOrigin: string;
  /**
   * The root of the site's canonical address, which the page names the site by, and shows each page
   * on ("https://dvfr.illinois.gov/"): `resolveCanonical`'s. Null when none is known, and the page
   * names the site by `readOrigin`.
   */
  canonical: string | null;
  /**
   * Every run in the site's folder, oldest first. The pages the page shows or compares carry flags
   * computed from their transcripts with the current rules, as the design says flags are; every
   * other field is as recorded.
   */
  runs: RunJson[];
  /**
   * The same runs' records exactly as their run.json files hold them, never changed: a seal covers
   * every field of its record, and the page's fingerprint check embeds these.
   */
  records: RunJson[];
  reviews: ReviewsFile;
  manual: ManualSessionFile[];
  /**
   * The transcripts of each page's shown run, and of the run before's record of each page that
   * sounds different in the latest run (the page compares them line by line).
   */
  transcripts: TranscriptStore;
  /**
   * The event log (events.jsonl) of each run the page draws on, by run id, as readEventLog reads
   * it: its events, and how many of its lines couldn't be read. Only a log its run's record lists,
   * whose file is as recorded there (its size and SHA-256), so the page shows only what the run's
   * seal covers: a run without one isn't in it.
   */
  events: Map<string, { events: RunEvent[]; unreadable: number }>;
  /**
   * The screenshot file of each page the page shows a picture for, by run id and page slug
   * ("2026-09-29_1402/home"): the file of the record its card speaks for (the one whose transcripts
   * the page shows, else a page never transcribed's latest failure's). Only a file its record lists
   * (from voicecap 0.11.0), as the record has it (its size and SHA-256), so the page shows only what
   * the run's seal covers: a page whose file is missing or changed isn't in it, and the page says so.
   */
  screenshots: Map<string, Uint8Array>;
  /**
   * The text of the axe file (axe.json) of each page the page shows axe's results for, by run id
   * and page slug, as `screenshots` holds a picture: the file of the record its card speaks for,
   * only when its record lists one (from voicecap 0.16.0), and only as the record has it (its size
   * and SHA-256). Its exact text: UTF-8, as the page carries it for its fingerprint check, which
   * hashes it back to those bytes. A file that isn't UTF-8 text is held as "", which is no axe
   * results, and the card says so.
   */
  axeFiles: Map<string, string>;
  /**
   * The pages read here whose flags couldn't be computed afresh, since a JSON transcript of theirs
   * couldn't be read: each keeps the flags its record has, by run id and slug.
   */
  flagsAsRecorded: { run: string; slug: string }[];
  /**
   * The ids of the run folders whose run.json is there but couldn't be read (damaged, or not
   * JSON): no record says what they did, and the page lists them among the runs left out.
   */
  unreadableRuns: string[];
  /** config.report.siteName. */
  siteName: string | null;
  /** The current config's flag rules: the flags were computed with them, and quote by them. */
  flagRules: FlagRules;
  /** Their fingerprint, part of the evidence. */
  flagRulesSha256: string;
  /** When the page was made, as a local ISO time (isoLocal). */
  generatedAt: string;
  /**
   * The home folder: the page replaces it wherever it would show it. "" where Node can't give one,
   * which leaves nothing to replace.
   */
  home: string;
  platform: NodeJS.Platform;
  /** The page's own file name, for the footer: "current.html" here; plan 3 passes the dated names. */
  fileName: string;
  /** The Word copy's file name, which the footer names too: "current.docx" here, dated likewise. */
  wordName: string;
}

/**
 * The root of the canonical address a site's page names it by: the root `configCanonical` gives
 * (report.canonical, which the config has checked), else the root `latest`, the latest counted run,
 * recorded, else none: the site is then named by the address voicecap read. A recorded root is
 * checked again (`recordedCanonical`), since a record is data: one that isn't a site's name (an IP
 * address, say) names nothing.
 */
export function resolveCanonical(input: {
  configCanonical: string | null;
  latest: RunJson | null;
}): string | null {
  if (input.configCanonical !== null) return input.configCanonical;
  return recordedCanonical(input.latest?.canonical);
}

/**
 * Read everything a site's page is made from. A site folder with no run has nothing to share. A
 * transcript that can't be read is left out (the store gives null for it), and the page says so
 * where it would have shown it.
 */
export async function loadShareInput(options: {
  siteDir: string;
  config: VoicecapConfig;
  now?: Date;
  fileName?: string;
  wordName?: string;
}): Promise<ShareInput> {
  const { siteDir, config } = options;
  const records = await listRuns(siteDir);
  const newest = records.at(-1);
  if (newest === undefined) {
    throw new UsageError(`There's no run in ${siteDir} yet, so there's nothing to share.`);
  }
  const standing = standingOf(records);
  const read = new Map<string, PageTranscripts>();
  for (const { run, page } of pagesToRead(standing)) {
    read.set(storeKey(run.id, page.slug), await readPage(siteDir, run.id, page));
  }
  const [reviews, manual, unreadableRuns, events, screenshots, axeFiles] = await Promise.all([
    readReviews(siteDir),
    listManualSessions(siteDir),
    runsNotRead(siteDir, records),
    eventLogsOf(siteDir, standing.drawnOn),
    screenshotsOf(siteDir, standing),
    axeFilesOf(siteDir, standing),
  ]);
  const flagsAsRecorded: ShareInput["flagsAsRecorded"] = [];
  return {
    readOrigin: (standing.latest ?? newest).site,
    canonical: resolveCanonical({
      configCanonical: config.report.canonical,
      latest: standing.latest,
    }),
    runs: records.map((record) =>
      withFlagsFromTranscripts(record, read, config.flags, (slug) =>
        flagsAsRecorded.push({ run: record.id, slug }),
      ),
    ),
    records,
    flagsAsRecorded,
    unreadableRuns,
    reviews,
    manual,
    transcripts: storeOf(read),
    events,
    screenshots,
    axeFiles,
    siteName: config.report.siteName,
    flagRules: config.flags,
    flagRulesSha256: flagRulesSha256(config.flags),
    generatedAt: isoLocal(options.now ?? new Date()),
    home: homeFolder() ?? "",
    platform: process.platform,
    fileName: options.fileName ?? "current.html",
    wordName: options.wordName ?? "current.docx",
  };
}

/** A page's transcripts in one run, by pass: those that could be read. */
interface PageTranscripts {
  txt: Partial<Record<PassName, string>>;
  json: Partial<Record<PassName, TranscriptJson>>;
}

const storeKey = (run: string, slug: string): string => `${run}/${slug}`;

/**
 * The pages whose transcripts the page reads: each page's shown transcripts, and the run before's
 * record of each page the latest run read in full whose transcripts differ from it, which the page
 * compares line by line. A page the latest run read in full is shown from it, so none is twice.
 */
function pagesToRead(standing: Standing): { run: RunJson; page: PageRecord }[] {
  const pages = standing.pages.flatMap(({ shown }) => (shown === null ? [] : [shown]));
  const { latest } = standing;
  const before = latest && runBefore(standing.counted, latest);
  if (latest && before) {
    const earlier = new Map(before.pages.map((page): [string, PageRecord] => [page.key, page]));
    for (const page of latest.pages) {
      const was = earlier.get(page.key);
      if (page.status !== "done" || was?.status !== "done") continue;
      if (
        PASS_NAMES.some(
          (pass) => was.passes[pass]?.contentSha256 !== page.passes[pass]?.contentSha256,
        )
      ) {
        pages.push({ run: before, page: was });
      }
    }
  }
  return pages;
}

/** The transcripts a page's record lists, each pass's TXT and JSON, as far as they can be read. */
async function readPage(
  siteDir: string,
  runId: string,
  page: PageRecord,
): Promise<PageTranscripts> {
  const dir = pageDir(siteDir, runId, page.slug);
  const listed = (name: string) => Object.hasOwn(page.files, name);
  const read: PageTranscripts = { txt: {}, json: {} };
  await Promise.all(
    PASS_NAMES.map(async (pass) => {
      const text = listed(`${pass}.txt`) ? await readText(path.join(dir, `${pass}.txt`)) : null;
      if (text !== null) read.txt[pass] = text;
      const transcript = listed(`${pass}.json`)
        ? await readTranscript(path.join(dir, `${pass}.json`))
        : null;
      if (transcript !== null) read.json[pass] = transcript;
    }),
  );
  return read;
}

/**
 * The event log of each run, by run id: one its record lists (from voicecap 0.11.0), whose file is
 * there and is as its record has it. A log that isn't (missing, unreadable, or changed since its
 * run's seal) is left out, and the page says so; `voicecap verify` names it.
 */
async function eventLogsOf(siteDir: string, runs: RunJson[]): Promise<ShareInput["events"]> {
  const logs: ShareInput["events"] = new Map();
  for (const run of runs) {
    const recorded = run.files?.[EVENT_LOG];
    if (recorded === undefined) continue;
    let bytes: Buffer;
    try {
      bytes = await readFile(eventLogFile(siteDir, run.id));
    } catch {
      continue;
    }
    const { sha256, bytes: size } = fileHash(bytes);
    if (sha256 !== recorded.sha256 || size !== recorded.bytes) continue;
    logs.set(run.id, readEventLog(bytes.toString("utf8")));
  }
  return logs;
}

/**
 * The screenshot of each page, by run id and slug: the file of the record its card speaks for, when
 * the record lists one (a record of why there's none lists no file, and neither does a record of no
 * kind voicecap writes) and the file is there and is as the record has it. A file that isn't
 * (missing, unreadable, or changed since its run's seal) is left out, and the page says so;
 * `voicecap verify` names it. They're read one at a time: a site of hundreds of pages would
 * otherwise hold hundreds of files open at once, more than some systems allow.
 */
async function screenshotsOf(
  siteDir: string,
  standing: Standing,
): Promise<ShareInput["screenshots"]> {
  const pictures: ShareInput["screenshots"] = new Map();
  for (const card of standing.pages) {
    const source = cardRecord(card);
    const recorded = source === null ? undefined : screenshotRecordOf(source.page);
    if (source === null || recorded === undefined || recorded === "unreadable") continue;
    if ("error" in recorded) continue;
    let bytes: Buffer;
    try {
      bytes = await readFile(
        path.join(pageDir(siteDir, source.run.id, source.page.slug), SCREENSHOT_FILE),
      );
    } catch {
      continue;
    }
    const { sha256, bytes: size } = fileHash(bytes);
    if (sha256 === recorded.sha256 && size === recorded.bytes) {
      pictures.set(storeKey(source.run.id, source.page.slug), bytes);
    }
  }
  return pictures;
}

/** Bytes as UTF-8 text, refusing any that aren't: text that encodes back to the same bytes. */
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * The axe file of each page, by run id and slug, as `screenshotsOf` reads a page's picture: the file
 * of the record its card speaks for, when the record lists one (a record of why there's none lists
 * no file, and neither does a record of no kind voicecap writes) and the file is there and is as the
 * record has it. A file that isn't (missing, unreadable, or changed since its run's seal) is left
 * out, and the card says so; `voicecap verify` names it. Its text is exactly its bytes, so the
 * page's check hashes it back to them: bytes that aren't UTF-8 text are held as "", which is no axe
 * results. They're read one at a time, as the screenshots are.
 */
async function axeFilesOf(siteDir: string, standing: Standing): Promise<ShareInput["axeFiles"]> {
  const files: ShareInput["axeFiles"] = new Map();
  for (const card of standing.pages) {
    const source = cardRecord(card);
    const recorded = source === null ? undefined : axeRecordOf(source.page);
    if (source === null || recorded === undefined || recorded === "unreadable") continue;
    if ("error" in recorded) continue;
    let bytes: Buffer;
    try {
      bytes = await readFile(
        path.join(pageDir(siteDir, source.run.id, source.page.slug), AXE_FILE),
      );
    } catch {
      continue;
    }
    const { sha256, bytes: size } = fileHash(bytes);
    if (sha256 !== recorded.sha256 || size !== recorded.bytes) continue;
    let text = "";
    try {
      text = UTF8.decode(bytes);
    } catch {
      // Not UTF-8 text, so no axe results as voicecap keeps them: "", and the card says so.
    }
    files.set(storeKey(source.run.id, source.page.slug), text);
  }
  return files;
}

/** A file's text, exactly: UTF-8, with a byte-order mark and line endings kept. */
async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

/** A pass's JSON transcript, or null when it's missing or isn't one. */
async function readTranscript(file: string): Promise<TranscriptJson | null> {
  const text = await readText(file);
  if (text === null) return null;
  try {
    const transcript = JSON.parse(text) as TranscriptJson;
    return Array.isArray(transcript.steps) ? transcript : null;
  } catch {
    return null;
  }
}

/**
 * The run with the flags of each page read here computed from its JSON transcripts with `rules`,
 * so every flag the page shows or compares is the current rules', with what each found. A page
 * whose transcripts can't all be read keeps the flags its record has, and `asRecorded` is told its
 * slug. The record itself is never changed: a page with flags computed here is a new object, and
 * so is its run.
 */
function withFlagsFromTranscripts(
  run: RunJson,
  read: Map<string, PageTranscripts>,
  rules: FlagRules,
  asRecorded: (slug: string) => void,
): RunJson {
  let computed = false;
  const pages = run.pages.map((page) => {
    const transcripts = read.get(storeKey(run.id, page.slug));
    if (transcripts === undefined) return page;
    const flags = flagsOf(page, transcripts, rules);
    if (flags === null) {
      asRecorded(page.slug);
      return page;
    }
    computed = true;
    return { ...page, flags };
  });
  return computed ? { ...run, pages } : run;
}

/**
 * The run folders of a site whose run.json is there but wasn't read (listRuns leaves out one it
 * can't parse), by run id, oldest first. A folder with no run.json at all, as a manual session's,
 * isn't a run.
 */
async function runsNotRead(siteDir: string, records: RunJson[]): Promise<string[]> {
  const read = new Set(records.map((run) => run.id));
  const ids: string[] = [];
  for (const day of await readdir(siteDir, { withFileTypes: true })) {
    if (!day.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(day.name)) continue;
    for (const entry of await readdir(path.join(siteDir, day.name), { withFileTypes: true })) {
      const id = `${day.name}_${entry.name}`;
      if (entry.isDirectory() && !read.has(id) && existsSync(runJsonPath(siteDir, id))) {
        ids.push(id);
      }
    }
  }
  return ids.sort();
}

/** A page's flags from its transcripts: null when a pass it read has no JSON transcript to read. */
function flagsOf(
  page: PageRecord,
  transcripts: PageTranscripts,
  rules: FlagRules,
): FlagResult[] | null {
  const passes: PagePasses = {};
  for (const pass of PASS_NAMES) {
    if (page.passes[pass] === undefined) continue;
    const transcript = transcripts.json[pass];
    if (transcript === undefined) return null;
    passes[pass] = transcript;
  }
  return evaluateFlags(passes, rules);
}

function storeOf(read: Map<string, PageTranscripts>): TranscriptStore {
  return {
    txt: (run, slug, pass) => read.get(storeKey(run, slug))?.txt[pass] ?? null,
    steps: (run, slug, pass) => read.get(storeKey(run, slug))?.json[pass]?.steps ?? null,
  };
}
