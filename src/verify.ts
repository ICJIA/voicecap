import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { SCREENSHOT_FILE, type FileHash, type ReviewsFile } from "./model.js";
import { isWebRoot } from "./pages/canonical.js";
import { canonicalKey } from "./pages/url.js";
import { readReviews } from "./reviews/store.js";
import { EVENT_LOG } from "./run/events.js";
import {
  DATE_FOLDER,
  linkPath,
  manualSessionDir,
  reviewsPath,
  runDir,
  shareDir,
  sharePath,
  sharesPath,
  shareWordPath,
  siteDirFor,
} from "./run/paths.js";
import { chooseSiteDir, siteFolders } from "./run/site-dir.js";
import {
  describeShare,
  isPlainName,
  isSeq,
  readShares,
  recordedFiles as recordedShareFiles,
  recordedNames,
  shareResultOf,
} from "./share/shares.js";
import { UsageError } from "./util/errors.js";
import { sealOf, sha256 } from "./util/hash.js";
import type { Logger } from "./util/log.js";
import { OS_LITTER } from "./util/os-litter.js";

export interface VerifyHomeOptions {
  /** The transcripts home. */
  home: string;
  /**
   * Check only this site's folder: any URL on the site, or the site's canonical address (see
   * chooseSiteDir). Default: every site folder in the home.
   */
  site?: string | null;
  /** Gets, for each site, one line per problem, then one per incomplete run, then a summary. */
  logger: Logger;
}

/** What `verifyHome` found in one site folder. */
export interface VerifySiteResult {
  /** The site folder's name, e.g. dvfr.illinois.gov. */
  folder: string;
  /** Runs with a readable run.json, incomplete ones included. */
  runs: number;
  incomplete: number;
  manualSessions: number;
  /** Entries in reviews.json. */
  reviews: number;
  /** Entries in share/shares.json: none when it's missing or can't be read. */
  shares: number;
  /** One line per problem, each starting with a path relative to the home (forward slashes). */
  problems: string[];
}

export interface VerifyResult {
  sites: VerifySiteResult[];
  /** Problems in every site checked: 0 when everything matches. */
  problems: number;
}

/** A site's result while it's checked, with the lines that list its incomplete runs. */
interface SiteTally extends VerifySiteResult {
  /** "<run folder>: incomplete run, not sealed yet", printed after the problems. Not problems. */
  listed: string[];
}

const NOT_SEALED = "not sealed (written before voicecap 0.3.0), so it can't be checked";
const CHANGED = "changed since it was recorded (SHA-256 differs)";
const MISSING = "missing";
const UNRECORDED = "not recorded by the run";
const UNREADABLE = "not a readable run or manual session";

/**
 * Check that the records voicecap wrote in the home still match their hashes and seals (the design
 * doc's "Checking the record"), in every site folder or just --site's: each completed run's seal,
 * where it's filed, and the files in its pages/ folder; each manual session's seal, where it's
 * filed, session.txt, and raw copy; reviews.json's seals and chain; and share/shares.json's seals
 * and chain, each copy it records, and any copy it doesn't. Incomplete runs are listed, not
 * checked. Deleting the newest review entries, the newest share with its copies, or a whole run or
 * manual session, leaves nothing here to find: only Git history shows it. Prints one line per
 * problem, then one per incomplete run, then a summary for each site.
 */
export async function verifyHome(options: VerifyHomeOptions): Promise<VerifyResult> {
  const { home, logger } = options;
  const sites: VerifySiteResult[] = [];
  for (const folder of await foldersToCheck(home, options.site ?? null)) {
    const { listed, ...site } = await verifySite(home, folder);
    for (const line of [...site.problems, ...listed]) logger.info(line);
    logger.info(summary(site));
    sites.push(site);
  }
  return { sites, problems: sites.reduce((total, site) => total + site.problems.length, 0) };
}

/** --site's folder, or every site folder; a usage error when there's nothing to check. */
async function foldersToCheck(home: string, site: string | null): Promise<string[]> {
  if (site === null) {
    const folders = await siteFolders(home);
    if (folders.length === 0) {
      throw new UsageError(`${home} has no site folders yet, so there's nothing to check.`);
    }
    return folders;
  }
  // The folder named after the address voicecap read, or else the one whose run recorded this
  // canonical address: the same folder every command that takes --site works in.
  const dir = await chooseSiteDir({ home, site });
  const folder = path.basename(dir);
  if (!(await isDirectory(dir))) {
    throw new UsageError(`${home} has no ${folder} folder, so there's nothing to check.`);
  }
  return [folder];
}

async function verifySite(home: string, folder: string): Promise<SiteTally> {
  const site: SiteTally = {
    folder,
    runs: 0,
    incomplete: 0,
    manualSessions: 0,
    reviews: 0,
    shares: 0,
    problems: [],
    listed: [],
  };
  const siteDir = path.join(home, folder);
  for (const name of await subfolders(siteDir)) {
    const dir = path.join(siteDir, name);
    if (DATE_FOLDER.test(name)) {
      await checkDateFolder(home, dir, site);
    } else if (name !== "compare" && name !== "share" && !name.startsWith(".")) {
      // compare/ and share/ are voicecap's own: compare/ holds the diffs it writes again from the
      // records, and share/ is checked below. Records in any other folder (a renamed date folder,
      // say) would go unchecked.
      site.problems.push(
        `${linkPath(home, dir)}: an unexpected folder; runs and manual sessions live in date folders`,
      );
    }
  }
  await checkReviews(home, siteDir, site);
  await checkShares(home, siteDir, site);
  return site;
}

/**
 * The records in a dated folder. Every folder in it is one, so one voicecap can't read is reported
 * rather than skipped. A folder holding a session.json is a manual session, and any other is a run
 * (whose name may even have "_manual_" in it). A folder holding both is a problem, and both records
 * are checked in full, so neither can hide the other.
 */
async function checkDateFolder(home: string, dateDir: string, site: SiteTally): Promise<void> {
  for (const name of await subfolders(dateDir)) {
    const dir = path.join(dateDir, name);
    const hasRun = existsSync(path.join(dir, "run.json"));
    const hasSession = existsSync(path.join(dir, "session.json"));
    if (hasRun && hasSession) {
      site.problems.push(`${linkPath(home, dir)}: holds both a run and a manual session`);
    }
    if (hasRun || !hasSession) await checkRun(home, dir, site);
    if (hasSession) await checkManualSession(home, dir, site);
  }
}

/**
 * A run. A sealed one is checked in full: its seal, where it's filed, each file it records beside
 * its pages (its event log, from 0.11.0) and any event log it doesn't, and every file in pages/,
 * recorded or not. An unsealed one is a completed run from before seals, which can't be checked, or
 * an incomplete run, which must look as voicecap writes one and be where voicecap puts it, and is
 * then listed rather than checked.
 */
async function checkRun(home: string, dir: string, site: SiteTally): Promise<void> {
  const file = path.join(dir, "run.json");
  const run = await readRecord(file);
  const sealed = run !== null && run.seal !== undefined;
  if (run === null || (!sealed && run.status !== "completed" && !isIncompleteRun(run))) {
    site.problems.push(`${linkPath(home, dir)}: ${UNREADABLE}`);
    return;
  }
  site.runs++;
  if (!sealed && run.status === "completed") {
    site.problems.push(`${linkPath(home, file)}: ${NOT_SEALED}`);
    return;
  }
  if (sealed && run.seal !== sealOf(run)) {
    // Its recorded hashes can't be trusted either, so the files aren't checked against them.
    site.problems.push(`${linkPath(home, file)}: changed since it was sealed`);
    return;
  }
  const belongs = runBelongsAt(home, run);
  const recorded = recordedFiles(run);
  const own = ownFiles(run);
  if (belongs === null || recorded === null || own === null) {
    site.problems.push(`${linkPath(home, dir)}: ${UNREADABLE}`);
    return;
  }
  // No seal covers where the folder is, so a copied or moved run is caught only here.
  if (belongs !== dir) {
    site.problems.push(`${linkPath(home, dir)}: this run belongs at ${linkPath(home, belongs)}`);
  }
  if (sealed) {
    await checkOwnFiles(home, dir, own, site);
    await checkRunFiles(home, dir, recorded, site);
  } else if (belongs === dir) {
    // Listed, not checked: an incomplete run's files can change until it's completed and sealed.
    site.incomplete++;
    site.listed.push(`${linkPath(home, dir)}: incomplete run, not sealed yet`);
  }
}

/** Whether an unsealed run.json has the shape voicecap gives an incomplete run. */
function isIncompleteRun(run: Record<string, unknown>): boolean {
  return (
    run.status === "incomplete" &&
    run.schemaVersion === 1 &&
    typeof run.id === "string" &&
    isUrl(run.site) &&
    Array.isArray(run.pages) &&
    typeof run.createdAt === "string"
  );
}

/** Where a run belongs, by its own id and site; null when those aren't as voicecap writes them. */
function runBelongsAt(home: string, run: Record<string, unknown>): string | null {
  return typeof run.id === "string" && isUrl(run.site)
    ? runDir(siteDirFor(home, run.site), run.id)
    : null;
}

/**
 * The files a completed run records beside its pages (run.files): each one that's missing or
 * changed, and an event log the run doesn't record, which someone put in a folder that had none.
 * The problems come in the order of the files' paths.
 */
async function checkOwnFiles(
  home: string,
  dir: string,
  recorded: Map<string, FileHash>,
  site: VerifySiteResult,
): Promise<void> {
  const names = new Set(recorded.keys());
  if (existsSync(path.join(dir, EVENT_LOG))) names.add(EVENT_LOG);
  for (const name of [...names].sort()) {
    const file = path.join(dir, ...name.split("/"));
    const hash = recorded.get(name);
    const problem = hash === undefined ? UNRECORDED : await difference(file, hash);
    if (problem !== null) site.problems.push(`${linkPath(home, file)}: ${problem}`);
  }
}

/** A completed run's pages/ folder: each file the run records, and any it doesn't. */
async function checkRunFiles(
  home: string,
  dir: string,
  recorded: Map<string, FileHash>,
  site: VerifySiteResult,
): Promise<void> {
  const pagesDir = path.join(dir, "pages");
  const onDisk = new Map((await filesIn(pagesDir)).map((file) => [linkPath(pagesDir, file), file]));
  for (const name of [...new Set([...recorded.keys(), ...onDisk.keys()])].sort()) {
    const shown = `${linkPath(home, pagesDir)}/${name}`;
    const hash = recorded.get(name);
    if (hash === undefined) {
      // An operating system's own files in a folder someone opened aren't part of the record.
      if (!OS_LITTER.has(path.posix.basename(name))) {
        site.problems.push(`${shown}: ${UNRECORDED}`);
      }
      continue;
    }
    const file = onDisk.get(name);
    const problem = file === undefined ? MISSING : await difference(file, hash);
    if (problem !== null) site.problems.push(`${shown}: ${problem}`);
  }
}

/**
 * The files a run records, by path in pages/: each page's transcripts, and its screenshot when the
 * page's record has the file's hash (a record of why there's none has no file to check). Null when
 * its pages aren't as voicecap writes them.
 */
function recordedFiles(run: Record<string, unknown>): Map<string, FileHash> | null {
  if (!Array.isArray(run.pages)) return null;
  const files = new Map<string, FileHash>();
  for (const page of run.pages as unknown[]) {
    if (!isRecord(page) || typeof page.slug !== "string" || !isRecord(page.files)) return null;
    for (const [name, hash] of Object.entries(page.files)) {
      if (!isFileHash(hash)) return null;
      files.set(`${page.slug}/${name}`, hash);
    }
    if (isFileHash(page.screenshot)) files.set(`${page.slug}/${SCREENSHOT_FILE}`, page.screenshot);
  }
  return files;
}

/**
 * The files a run records beside its pages, by path from its folder, written with "/"; none for a
 * run from before it recorded any. Null when they aren't as voicecap writes them, which includes a
 * path that leads out of the run's folder: it's never read.
 */
function ownFiles(run: Record<string, unknown>): Map<string, FileHash> | null {
  if (run.files === undefined) return new Map();
  if (!isRecord(run.files)) return null;
  const files = new Map<string, FileHash>();
  for (const [name, hash] of Object.entries(run.files)) {
    if (!isPathInside(name) || !isFileHash(hash)) return null;
    files.set(name, hash);
  }
  return files;
}

/** Whether a name is a path inside a folder: written with "/", with no empty, "." or ".." part. */
function isPathInside(name: string): boolean {
  return (
    !name.includes("\\") &&
    name.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

/** A manual session: its seal, where it's filed, its session.txt, and its raw copy if there. */
async function checkManualSession(
  home: string,
  dir: string,
  site: VerifySiteResult,
): Promise<void> {
  const file = path.join(dir, "session.json");
  const session = await readRecord(file);
  if (session === null) {
    site.problems.push(`${linkPath(home, dir)}: ${UNREADABLE}`);
    return;
  }
  site.manualSessions++;
  if (session.seal === undefined) {
    site.problems.push(`${linkPath(home, file)}: ${NOT_SEALED}`);
    return;
  }
  if (session.seal !== sealOf(session)) {
    site.problems.push(`${linkPath(home, file)}: changed since it was sealed`);
    return;
  }
  const belongs = sessionBelongsAt(home, session);
  if (belongs === null || !isFileHash(session.transcript)) {
    site.problems.push(`${linkPath(home, dir)}: ${UNREADABLE}`);
    return;
  }
  // The seal doesn't cover where the folder is, so a copied or moved session still matches it.
  if (belongs !== dir) {
    site.problems.push(
      `${linkPath(home, dir)}: this manual session belongs at ${linkPath(home, belongs)}`,
    );
  }
  const txt = path.join(dir, "session.txt");
  const problem = await difference(txt, session.transcript);
  if (problem !== null) site.problems.push(`${linkPath(home, txt)}: ${problem}`);

  const input = session.input;
  if (
    isRecord(input) &&
    isFileHash(input) &&
    isRecord(input.raw) &&
    input.raw.kept === true &&
    typeof input.raw.path === "string"
  ) {
    const raw = path.join(dir, input.raw.path);
    // A missing raw copy isn't a problem: .gitignore keeps raw copies out of Git, so a clone of
    // the home never has them.
    if ((await difference(raw, input)) === CHANGED) {
      site.problems.push(`${linkPath(home, raw)}: ${CHANGED}`);
    }
  }
}

/**
 * Where a manual session belongs, by its own id and page; null when those aren't as voicecap
 * writes them.
 */
function sessionBelongsAt(home: string, session: Record<string, unknown>): string | null {
  const page = session.page;
  if (typeof session.id !== "string" || !isRecord(page) || typeof page.slug !== "string") {
    return null;
  }
  return isUrl(page.url)
    ? manualSessionDir(siteDirFor(home, page.url), session.id, page.slug)
    : null;
}

/** One entry of a chain (reviews.json's, or shares.json's): an entry with a seq. */
interface ChainLink {
  entry: Record<string, unknown>;
  seq: number;
  /** Whether it still matches its own seal. */
  intact: boolean;
}

/** One entry of reviews.json's chain. */
interface Link extends ChainLink {
  /** The page key it's filed under. */
  key: string;
}

/** reviews.json: each entry's seal, the chain (seq and prev), and where each entry is filed. */
async function checkReviews(home: string, siteDir: string, site: VerifySiteResult): Promise<void> {
  const where = linkPath(home, reviewsPath(siteDir));
  let reviews: ReviewsFile;
  try {
    reviews = await readReviews(siteDir);
  } catch {
    site.problems.push(`${where}: not a readable review history`);
    return;
  }
  const filed = filedEntries(reviews);
  if (filed === null) {
    site.problems.push(`${where}: not a readable review history`);
    return;
  }

  const problems: string[] = [];
  const chain: Link[] = [];
  for (const [key, entries] of filed) {
    site.reviews += entries.length;
    for (const entry of entries) {
      if (entry.seal === undefined && entry.seq === undefined) {
        // An entry from before seals, which has no place in the chain either.
        problems.push(`${describeEntry(entry, key)} is ${NOT_SEALED}`);
        continue;
      }
      // An entry that lost its seal was changed, just like one that no longer matches it.
      const intact = entry.seal === sealOf(entry);
      if (!intact) problems.push(`${describeEntry(entry, key)} changed since it was recorded`);
      if (isSeq(entry.seq)) {
        chain.push({ key, entry, seq: entry.seq, intact });
      } else if (intact) {
        // Sealed, but in no place in the chain, so no check of seq or prev would reach it.
        problems.push(`${describeEntry(entry, key)} is outside the chain (no seq)`);
      }
    }
  }
  problems.push(...chainProblems(chain), ...filingProblems(chain));
  site.problems.push(...problems.map((problem) => `${where}: ${problem}`));
}

/** Each page's entries, by the key they're filed under; null unless every entry is an object. */
function filedEntries(reviews: ReviewsFile): Map<string, Record<string, unknown>[]> | null {
  const filed = new Map<string, Record<string, unknown>[]>();
  for (const [key, entries] of Object.entries(reviews.pages)) {
    const objects = (entries as unknown[]).filter(isRecord);
    if (objects.length !== entries.length) return null;
    filed.set(key, objects);
  }
  return filed;
}

/**
 * seq running 1, 2, ... with no gaps or repeats, and each intact entry's prev the seal of the
 * intact entry before it (null for the first). A missing or changed entry is reported once, not
 * again as a broken link from the entry after it. It's the same for any chain of entries: the
 * reviews', or the shares'.
 */
function chainProblems(chain: readonly ChainLink[]): string[] {
  const problems: string[] = [];
  const bySeq = new Map<number, ChainLink[]>();
  for (const link of chain) bySeq.set(link.seq, [...(bySeq.get(link.seq) ?? []), link]);
  let next = 1;
  for (const seq of [...bySeq.keys()].sort((a, b) => a - b)) {
    if (seq === next + 1) problems.push(`entry ${next} is missing`);
    if (seq > next + 1) problems.push(`entries ${next} to ${seq - 1} are missing`);
    if (bySeq.get(seq)!.length > 1) problems.push(`more than one entry is numbered ${seq}`);
    next = seq + 1;
  }
  // A changed entry can't be trusted: not its own prev, and not its seal as the next one's prev.
  for (const { entry, seq, intact } of [...chain].sort((a, b) => a.seq - b.seq)) {
    if (!intact) continue;
    if (seq === 1) {
      if (entry.prev !== null) problems.push("entry 1 follows an entry that isn't there");
      continue;
    }
    const before = (bySeq.get(seq - 1) ?? []).filter((link) => link.intact);
    if (before.length > 0 && !before.some((link) => link.entry.seal === entry.prev)) {
      problems.push(`entry ${seq} doesn't follow entry ${seq - 1}`);
    }
  }
  return problems;
}

/**
 * What no seal covers: where each entry is filed. Each intact entry must be filed under its own
 * URL's key, and each page's entries must run in increasing seq.
 */
function filingProblems(chain: Link[]): string[] {
  const problems: string[] = [];
  const previous = new Map<string, Link>();
  const outOfOrder = new Set<string>();
  for (const link of chain) {
    if (!link.intact) continue;
    if (keyOf(link.entry.url) !== link.key) {
      problems.push(
        `${describeEntry(link.entry, link.key)} is filed under another page (${link.key})`,
      );
      continue;
    }
    const before = previous.get(link.key);
    if (before && before.seq > link.seq && !outOfOrder.has(link.key)) {
      outOfOrder.add(link.key);
      problems.push(
        `the entries for ${pageUrl(before.entry, before.key)} are out of order (entry ${before.seq} comes before entry ${link.seq})`,
      );
    }
    previous.set(link.key, link);
  }
  return problems;
}

/** "entry 3 (<page URL>)", or "an entry for <page URL> at <time>" for one without a seq. */
function describeEntry(entry: Record<string, unknown>, key: string): string {
  const url = pageUrl(entry, key);
  return isSeq(entry.seq)
    ? `entry ${entry.seq} (${url})`
    : `an entry for ${url} at ${String(entry.at)}`;
}

/** The page URL an entry records, or the key it's filed under if it has none. */
function pageUrl(entry: Record<string, unknown>, key: string): string {
  return typeof entry.url === "string" ? entry.url : key;
}

/** The canonical key of a page URL; null for anything that isn't a URL. */
function keyOf(url: unknown): string | null {
  return isUrl(url) ? canonicalKey(url) : null;
}

/**
 * share/: shares.json's entries (each one's seal, then the chain), the site and each file of each
 * entry that still matches its seal, and each file or folder no entry names. The problems come in
 * that order, an entry's site before its files, in the entries' order, and the rest by name. A site
 * with no share/ folder has nothing to check. voicecap writes current.html and current.docx again
 * from the records, so they're never checked.
 */
async function checkShares(home: string, siteDir: string, site: VerifySiteResult): Promise<void> {
  const dir = shareDir(siteDir);
  if (!(await isDirectory(dir))) return;
  const where = linkPath(home, sharesPath(siteDir));

  const problems: string[] = [];
  let entries: Record<string, unknown>[] = [];
  try {
    // Reading checks only that each entry is an object: every field of one is read as unknown.
    entries = (await readShares(siteDir)).shares;
  } catch {
    // A record voicecap can't use vouches for no copy, so each is one nothing records, below.
    problems.push(`${where}: not a readable record of what was shared`);
  }
  site.shares = entries.length;

  const sealed = entries.map((entry) => ({ entry, intact: entry.seal === sealOf(entry) }));
  const chain: ChainLink[] = [];
  for (const { entry, intact } of sealed) {
    // An entry that lost its seal was changed, just like one that no longer matches it.
    if (!intact) problems.push(`${where}: ${describeShare(entry)} changed since it was recorded`);
    if (isSeq(entry.seq)) {
      chain.push({ entry, seq: entry.seq, intact });
    } else if (intact) {
      // Sealed, but in no place in the chain, so no check of seq or prev would reach it.
      problems.push(`${where}: ${describeShare(entry)} is outside the chain (no seq)`);
    }
  }
  problems.push(...chainProblems(chain).map((problem) => `${where}: ${problem}`));

  // An entry that changed can't vouch for its site or its files, so only an intact entry's are
  // checked.
  for (const { entry, intact } of sealed) {
    if (!intact) continue;
    const problem = siteProblem(entry);
    if (problem !== null) problems.push(`${where}: ${problem}`);
    // The result (from 0.12.3), which an entry from before has none of.
    if (entry.result !== undefined && shareResultOf(entry.result) === null) {
      problems.push(
        `${where}: ${describeShare(entry)} lists its result in a form voicecap can't read`,
      );
    }
    problems.push(...(await copyProblems(home, dir, where, entry)));
  }
  problems.push(...(await unrecordedProblems(home, siteDir, entries)));
  site.problems.push(...problems);
}

/**
 * The problem with the site an entry records (from 0.10.0): it must be the root of a web address,
 * as voicecap writes one (see isWebRoot). One line for the entry, or null when it's one, and when
 * the entry has none, as an entry from before 0.10.0 has none. A site is shown as JSON writes it,
 * in quotes, with the characters a line can't hold (a line break, say) written out, so that nothing
 * in it is taken for the line's own words.
 */
function siteProblem(entry: Record<string, unknown>): string | null {
  const { site } = entry;
  if (site === undefined || isWebRoot(site)) return null;
  return typeof site === "string"
    ? `${describeShare(entry)} names ${JSON.stringify(site)} as its site, which isn't a site's root address, such as https://dvfr.illinois.gov/`
    : `${describeShare(entry)} lists its site in a form voicecap can't read`;
}

/**
 * The problems with the files an entry records, in the order it lists them: one that's missing or
 * changed, or a name that can't be a file in share/ (which is never read: it could lead anywhere),
 * or, when the entry doesn't list its files in a form voicecap can read, one line for the entry.
 */
async function copyProblems(
  home: string,
  dir: string,
  where: string,
  entry: Record<string, unknown>,
): Promise<string[]> {
  const files = recordedShareFiles(entry.files);
  if (files === null) {
    return [`${where}: ${describeShare(entry)} lists its files in a form voicecap can't read`];
  }
  const problems: string[] = [];
  for (const file of files) {
    if (!isPlainName(file.name)) {
      problems.push(
        `${where}: ${describeShare(entry)} names "${file.name}", which isn't a file in share/`,
      );
      continue;
    }
    const copy = path.join(dir, file.name);
    const problem = await difference(copy, file);
    if (problem !== null) problems.push(`${linkPath(home, copy)}: ${problem}`);
  }
  return problems;
}

/**
 * What share/ holds that no entry of the record names, by name: a file is "not recorded", and a
 * folder is unexpected (voicecap makes none). Not these: the files voicecap writes again from the
 * records, a name that starts with a dot, the files an operating system leaves, and the owner file
 * Word keeps beside a copy that's open.
 */
async function unrecordedProblems(
  home: string,
  siteDir: string,
  entries: readonly unknown[],
): Promise<string[]> {
  const dir = shareDir(siteDir);
  const written = [sharePath(siteDir), shareWordPath(siteDir), sharesPath(siteDir)].map((file) =>
    path.basename(file),
  );
  const named = recordedNames(entries);
  const problems: string[] = [];
  const found = (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
    a.name < b.name ? -1 : 1,
  );
  for (const item of found) {
    const name = item.name;
    if (name.startsWith(".") || OS_LITTER.has(name) || written.includes(name)) continue;
    // Word keeps an owner file beside a document while it's open, named with ~$ first (here,
    // ~$ample.illinois.gov_2027-01-15.docx). It's no copy that was missed, and someone reading a
    // sent copy in Word has one when they run verify, so it's skipped, as the files an operating
    // system leaves are.
    if (name.startsWith("~$")) continue;
    const shown = linkPath(home, path.join(dir, name));
    if (item.isDirectory()) problems.push(`${shown}: an unexpected folder`);
    else if (!named.has(name)) problems.push(`${shown}: not recorded in shares.json`);
  }
  return problems;
}

/**
 * "<folder>: 3 runs (1 incomplete), 2 manual sessions, 4 reviews, 1 share checked: everything
 * matches."
 */
function summary(site: VerifySiteResult): string {
  const checked =
    `${count(site.runs, "run")} (${site.incomplete} incomplete), ` +
    `${count(site.manualSessions, "manual session")}, ${count(site.reviews, "review")}, ` +
    `${count(site.shares, "share")} checked`;
  const verdict =
    site.problems.length === 0 ? "everything matches" : count(site.problems.length, "problem");
  return `${site.folder}: ${checked}: ${verdict}.`;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** How a file differs from its record: MISSING, CHANGED, or null when it doesn't. */
async function difference(file: string, recorded: FileHash): Promise<string | null> {
  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") return MISSING;
    throw error;
  }
  return bytes.length === recorded.bytes && sha256(bytes) === recorded.sha256 ? null : CHANGED;
}

/** A JSON file's top-level object; null when the file is missing, isn't JSON, or isn't an object. */
async function readRecord(file: string): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = JSON.parse(await readFile(file, "utf8"));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/** The names of the folders in `dir`, sorted. */
async function subfolders(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Every file under `dir`, at any depth; none when there's no such folder. */
async function filesIn(dir: string): Promise<string[]> {
  if (!(await isDirectory(dir))) return [];
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await filesIn(full)));
    else files.push(full);
  }
  return files;
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFileHash(value: unknown): value is FileHash {
  return isRecord(value) && typeof value.sha256 === "string" && typeof value.bytes === "number";
}

function isUrl(value: unknown): value is string {
  return typeof value === "string" && URL.canParse(value);
}
