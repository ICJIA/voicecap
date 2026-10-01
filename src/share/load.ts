/**
 * What the shareable page is made from, read from a site's folder in the transcripts home: its
 * runs, reviews, and manual sessions, and the transcripts the page shows or compares. Every read is
 * here; buildShareModel (./model.ts) works from what this gives it, and reads nothing itself.
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
  PASS_NAMES,
  type FlagResult,
  type PageRecord,
  type PassName,
  type ReviewsFile,
  type RunJson,
  type StepRecord,
  type TranscriptJson,
} from "../model.js";
import { readReviews } from "../reviews/store.js";
import { homeFolder } from "../run/failure.js";
import { pageDir, runJsonPath } from "../run/paths.js";
import { listRuns } from "../run/store.js";
import { UsageError } from "../util/errors.js";
import { isoLocal } from "../util/time.js";
import { runBefore, standingOf, type Standing } from "./standing.js";

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
  /** The site's address, as its latest run recorded it. */
  site: string;
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
  const [reviews, manual, unreadableRuns] = await Promise.all([
    readReviews(siteDir),
    listManualSessions(siteDir),
    runsNotRead(siteDir, records),
  ]);
  const flagsAsRecorded: ShareInput["flagsAsRecorded"] = [];
  return {
    site: (standing.latest ?? newest).site,
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
    siteName: config.report.siteName,
    flagRules: config.flags,
    flagRulesSha256: flagRulesSha256(config.flags),
    generatedAt: isoLocal(options.now ?? new Date()),
    home: homeFolder() ?? "",
    platform: process.platform,
    fileName: options.fileName ?? "current.html",
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
