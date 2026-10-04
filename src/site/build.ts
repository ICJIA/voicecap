/**
 * `voicecap site`: the website of every report voicecap has shared, built from the transcripts
 * home's records of what was shared (./records.ts) into a folder that Netlify publishes. It
 * publishes only what those records name: each file of an entry whose seal holds, of a kind voicecap
 * names its copies (./records.ts), copied byte for byte, and only when it's a regular file (never a
 * link, a device, or a folder) whose size and SHA-256 are the recorded ones. A size that isn't the
 * recorded one is a change, found before the file is read; any other file is read once, checked, and
 * written from those same bytes. One that changed, is gone, or can't be read is left out and named,
 * in the build's output and under its report on the site, and the build goes on: one copy that can't
 * be published never stops every later update.
 *
 * Each build empties its folder, so a folder given by mistake must never be one with records, or
 * anyone's work, in it. A folder is built into only when it's new, empty, or one an earlier build
 * made (its _headers starts with HEADERS_FIRST_LINE) and that holds nothing but what a build writes,
 * and never when it's the home, holds the home, or is inside a site's folder or the demo's, by its
 * name and by where it really is: a link, a short name, or another letter case leads to the same
 * folder. A build writes files, in its folder and in the folders it makes, and no name that starts
 * with a dot: a folder with such a name (a repository's .git), or with a folder in a folder (a site
 * folder of someone's own), holds more than a build wrote, and is never emptied. The files an
 * operating system adds to a folder someone opens (.DS_Store, Thumbs.db, desktop.ini) hold nothing
 * of anyone's: they aren't counted, and are emptied with the rest. Every refusal comes before
 * anything is touched. The records are read before the folder is emptied, so an earlier build is
 * kept when they can't be.
 *
 * Besides each report's files, a build writes the site's page (index.html), robots.txt, and
 * _headers, which gives each page its Content Security Policy, made from the hashes of that page's
 * own bytes, and each download its Content-Disposition. In the home it writes netlify.toml and
 * .nvmrc the first time, and never again.
 */
import type { Dirent } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { DEMO_OUT } from "../demo/words.js";
import type { SharedFile } from "../model.js";
import { plural } from "../report/html.js";
import { linkPath, resolveHome } from "../run/paths.js";
import { siteFolders } from "../run/site-dir.js";
import { fontFaceCss } from "../share/fonts.js";
import { UsageError } from "../util/errors.js";
import { resolveUserPath } from "../util/git-bash.js";
import { sha256 } from "../util/hash.js";
import { createConsoleLogger, type Logger } from "../util/log.js";
import { OS_LITTER } from "../util/os-litter.js";
import { voicecapVersion } from "../util/version.js";
import {
  contentSecurityPolicy,
  headersFile,
  HEADERS_FIRST_LINE,
  inlineHashes,
  ROBOTS_TXT,
  type HeaderRule,
} from "./headers.js";
import { ensureNetlifyFiles } from "./netlify.js";
import { DEMO_SITE, leaveOut, printable, readSiteRecords, type SiteEntry } from "./records.js";
import {
  fileKind,
  renderSiteIndex,
  type PublishedFile,
  type PublishedReport,
  type SiteContent,
} from "./render.js";

export interface BuildSiteOptions {
  /** The transcripts home. Default: VOICECAP_TRANSCRIPTS, else "transcripts". */
  home?: string;
  /** The folder to build the site in. Default: _site in the home. */
  out?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  logger?: Logger;
}

export interface BuildSiteResult {
  /** The folder the site was built in, as a full path. */
  out: string;
  content: SiteContent;
  /** Each thing left out, as the build's output said it. */
  leftOut: string[];
}

/** The folder the site is built in when none is given: in the home, where .gitignore keeps it out. */
const SITE_DIR = "_site";
/** The file a build's folder is known by: it starts with HEADERS_FIRST_LINE. */
const HEADERS_FILE = "_headers";
/** The site's own files at its top, which a site folder of the same name would take the place of. */
const OWN_FILES: ReadonlySet<string> = new Set(["index.html", "robots.txt", HEADERS_FILE]);
/** The lines of a .gitignore that keep the site's folder out of Git, once trimmed. */
const SITE_LINES: ReadonlySet<string> = new Set([
  SITE_DIR,
  `${SITE_DIR}/`,
  `/${SITE_DIR}`,
  `/${SITE_DIR}/`,
]);

/**
 * A file a record names that isn't published: what a build says of it, after the file's path from
 * the home and "not published: ", and which of the site's two reasons the page gives under its
 * report.
 */
interface Unpublished {
  why: string;
  reason: PublishedReport["notPublished"][number]["reason"];
}

const CHANGED: Unpublished = { why: "it no longer matches its fingerprint", reason: "changed" };
const MISSING: Unpublished = { why: "the file is missing", reason: "missing" };
/** To a reader of the site, a file that isn't a regular one, or can't be read, is as good as missing. */
const NOT_REGULAR: Unpublished = { why: "it isn't a regular file", reason: "missing" };

/** A file that couldn't be read, and the error's code (EBUSY, ENAMETOOLONG, ...) when it has one. */
function unreadable(error: unknown): Unpublished {
  const code = (error as NodeJS.ErrnoException | null | undefined)?.code;
  const why = typeof code === "string" ? `it couldn't be read (${code})` : "it couldn't be read";
  return { why, reason: "missing" };
}

/**
 * Build the site of the transcripts home: refuse a folder it mustn't empty, empty it, publish each
 * shared file that still matches its record, and write the site's page, robots.txt, and _headers
 * beside them, then netlify.toml and .nvmrc in the home when they aren't there. Each thing left out
 * is warned of, and the last line says what was built. Refuses with a UsageError when the home isn't
 * a folder, and when the folder to build in is one that must not be emptied (see the top of this file).
 */
export async function buildSite(options: BuildSiteOptions = {}): Promise<BuildSiteResult> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const logger = options.logger ?? createConsoleLogger();

  const home = resolveHome({ out: options.home, env, cwd });
  if ((await kindOf(home)) !== "folder") {
    throw new UsageError(
      `${home} isn't a folder, so there's no transcripts home to build the site from.`,
    );
  }
  const out =
    options.out === undefined ? path.join(home, SITE_DIR) : resolveUserPath(cwd, options.out);
  const why = await whyNotBuiltInto(home, out);
  if (why !== null) {
    throw new UsageError(
      `voicecap site won't build into ${out}: ${why}. Give a folder of its own, such as ${path.join(home, SITE_DIR)}.`,
    );
  }

  // What can fail for want of a record, a font, or a version is read before the folder is emptied.
  const records = await readSiteRecords(home);
  const fontCss = await fontFaceCss();
  const version = voicecapVersion();

  await rm(out, { recursive: true, force: true, maxRetries: 3 });
  await mkdir(out, { recursive: true });
  // The first line of _headers says a build made this folder, so one that stops before it writes
  // the rest can be emptied by the next. The whole file is written last.
  await writeFile(path.join(out, HEADERS_FILE), headersFile([]));

  const leftOut = [...records.leftOut];
  const publishing: Publishing = { home, out, leftOut, rulesOf: new Map() };
  const sites: SiteContent["sites"] = [];
  for (const { folder, entries } of records.sites) {
    if (OWN_FILES.has(folder)) {
      leaveOut(
        leftOut,
        `${folder}: not published: a site folder named ${folder} would take the place of the site's own ${folder}`,
      );
      continue;
    }
    const made: { seq: number; report: PublishedReport }[] = [];
    for (const entry of entries) {
      const id = `report-${folder}-${entry.seq}`;
      made.push({ seq: entry.seq, report: await publishReport(publishing, entry, folder, id) });
    }
    // Newest first, by the moment each time names; the higher seq of two made at the same moment.
    made.sort((a, b) => Date.parse(b.report.at) - Date.parse(a.report.at) || b.seq - a.seq);
    sites.push({ folder, reports: made.map(({ report }) => report) });
  }
  const demo =
    records.demo === null
      ? null
      : await publishReport(publishing, records.demo, DEMO_SITE, `report-${DEMO_SITE}`);
  const content: SiteContent = { demo, sites };

  const index = renderSiteIndex(content, { fontCss });
  await writeFile(path.join(out, "index.html"), index);
  await writeFile(path.join(out, "robots.txt"), ROBOTS_TXT);
  await writeFile(
    path.join(out, HEADERS_FILE),
    headersFile(headerRules(content, index, publishing.rulesOf)),
  );
  for (const name of await ensureNetlifyFiles(home, version)) {
    logger.info(`Wrote ${name} into ${home}, for Netlify: commit it with the records.`);
  }

  if (isSamePath(out, path.join(home, SITE_DIR)) && !(await gitignoreKeepsSiteOut(home))) {
    logger.warn(
      `${home}'s .gitignore doesn't keep ${SITE_DIR}/ out of Git, so the built site could be committed with the records. Add the line ${SITE_DIR}/ to it.`,
    );
  }

  for (const line of leftOut) logger.warn(line);
  const reports = sites.reduce((count, site) => count + site.reports.length, 0);
  logger.info(
    `Built the site in ${out}: ${plural(reports, "report")} from ${plural(sites.length, "site")}${demo === null ? "" : ", and the demo's"}.`,
  );
  return { out, content, leftOut };
}

/** What kind of thing is at a path: nothing, a folder (a link to one too), or anything else. */
async function kindOf(target: string): Promise<"nothing" | "folder" | "file"> {
  try {
    return (await stat(target)).isDirectory() ? "folder" : "file";
  } catch (error) {
    if (isNotThere(error)) return "nothing";
    throw error;
  }
}

/** Whether a lookup failed because there's nothing by that name: no such file, or a file where a folder should be. */
function isNotThere(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/** Whether `target` is `folder` itself or in it, by their names. */
function isWithin(folder: string, target: string): boolean {
  const relative = path.relative(folder, target);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

/** Whether two paths name the same folder, by their names. Case counts as Windows counts it. */
function isSamePath(a: string, b: string): boolean {
  return path.relative(a, b) === "";
}

/** What the build says of a folder that's, or is in, or holds, the records. */
const THE_HOME = "it's the transcripts home itself";
const HOLDS_THE_HOME = "it holds the transcripts home";
const IN_A_SITE = "it's inside a site's folder, where its records are";
const IN_THE_DEMO = `it's inside ${DEMO_OUT}, where the demo's records are`;

/** The folders the records are in: the home, each site's folder in it, and the demo's. */
interface RecordFolders {
  home: string;
  sites: string[];
  demo: string;
}

/**
 * Why `out` is, holds, or is inside one of the records' folders, judging by the paths alone; null
 * when it's none of them.
 */
function whyAmongTheRecords(records: RecordFolders, out: string): string | null {
  if (isWithin(out, records.home)) {
    return isSamePath(out, records.home) ? THE_HOME : HOLDS_THE_HOME;
  }
  if (records.sites.some((site) => isWithin(site, out))) return IN_A_SITE;
  if (isWithin(records.demo, out)) return IN_THE_DEMO;
  return null;
}

/**
 * Where a path really is: as far as it's there, the operating system's own name for it, with each
 * link followed and each name in the letters and the length the disk keeps, and the rest of it as
 * written. A folder that isn't there yet, under a link to a site's folder, is then in that site's
 * folder. Only a name that isn't there is passed over, to look for the folder it would be in; any
 * other failure leaves the path as written, which the checks by name have seen.
 */
async function realOf(target: string): Promise<string> {
  const rest: string[] = [];
  for (let at = target; ; at = path.dirname(at)) {
    try {
      return path.join(await realpath(at), ...rest);
    } catch (error) {
      if (!isNotThere(error) || path.dirname(at) === at) return target;
      rest.unshift(path.basename(at));
    }
  }
}

/**
 * Why the site can't be built into `out`, in words that finish "won't build into <out>: ...", or
 * null when it can. Nothing is touched: it's only looked at. The checks, in order:
 *
 * - `out` is a file, not a folder;
 * - it's the home, holds the home, or is inside a site's folder (a folder at the home's top that has
 *   records in it) or the demo's: by the names of the paths, and then by where they really are, so
 *   that a link, a short name, or another letter case is the folder it leads to;
 * - it's there, isn't empty, and isn't one a build made (see builtBefore);
 * - it's one a build made, and holds more than a build writes (see moreThanABuild).
 *
 * What's left is a folder that isn't there, one with nothing in it, or one an earlier build made and
 * nothing else has been put in.
 */
async function whyNotBuiltInto(home: string, out: string): Promise<string | null> {
  const found = await kindOf(out);
  if (found === "file") return "it's a file, not a folder";

  const sites = await siteFolders(home);
  const demo = path.join(home, DEMO_OUT);
  const byName = whyAmongTheRecords(
    { home, sites: sites.map((folder) => path.join(home, folder)), demo },
    out,
  );
  if (byName !== null) return byName;
  // A site's folder is a folder, not a link, so it's in the home's real place.
  const realHome = await realOf(home);
  const byPlace = whyAmongTheRecords(
    {
      home: realHome,
      sites: sites.map((folder) => path.join(realHome, folder)),
      demo: await realOf(demo),
    },
    await realOf(out),
  );
  if (byPlace !== null) return byPlace;

  if (found === "folder" && (await readdir(out)).length > 0) {
    if (!(await builtBefore(out))) return "it isn't empty, and voicecap site didn't build it";
    return moreThanABuild(out);
  }
  return null;
}

/**
 * What a folder holds, by name. A listing comes in the disk's order, so it's sorted: what's said of
 * a folder is then the same each time.
 */
async function entriesOf(folder: string): Promise<Dirent[]> {
  const entries = await readdir(folder, { withFileTypes: true });
  return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * Whether a listed thing is one of the files an operating system adds to a folder someone opens: a
 * file with one of those names. A folder or a link with the name of one is somebody's, not the
 * system's, and its contents would be lost with it.
 */
function isOsLitter(entry: Dirent): boolean {
  return entry.isFile() && OS_LITTER.has(entry.name);
}

/**
 * Why a folder that a build made is more than that, in words that finish "won't build into <out>:
 * ...", or null when it holds only what a build writes. A build writes files, in its folder and in
 * each folder it makes, and no name that starts with a dot. A name with a dot first (a repository's
 * .git), or a folder in a folder (a site folder of someone's own, with its date folder and its
 * record), is somebody's, and emptying the folder would lose it. A link isn't looked into: when the
 * folder is emptied it's removed, and what it leads to isn't. The files an operating system adds
 * (see isOsLitter) are no one's, at the folder's top and one folder down, and aren't counted.
 */
async function moreThanABuild(folder: string): Promise<string | null> {
  for (const entry of await entriesOf(folder)) {
    if (isOsLitter(entry)) continue;
    if (entry.name.startsWith(".")) {
      return `it holds ${printable(entry.name)}, which a build never writes`;
    }
    if (!entry.isDirectory()) continue;
    for (const inner of await entriesOf(path.join(folder, entry.name))) {
      if (isOsLitter(inner)) continue;
      const where = printable(`${entry.name}/${inner.name}`);
      if (inner.name.startsWith(".")) return `it holds ${where}, which a build never writes`;
      if (inner.isDirectory()) {
        return `it holds ${where}, a folder inside a folder, which a build never writes`;
      }
    }
  }
  return null;
}

/**
 * Whether a folder was made by a build: it has a _headers that's a file and starts with
 * HEADERS_FIRST_LINE. Only that many bytes of it are read.
 */
async function builtBefore(folder: string): Promise<boolean> {
  const file = path.join(folder, HEADERS_FILE);
  try {
    if (!(await lstat(file)).isFile()) return false;
    const handle = await open(file, "r");
    try {
      const first = Buffer.from(HEADERS_FIRST_LINE);
      const { buffer, bytesRead } = await handle.read(
        Buffer.alloc(first.length),
        0,
        first.length,
        0,
      );
      return buffer.subarray(0, bytesRead).equals(first);
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (isNotThere(error)) return false;
    throw error;
  }
}

/** What publishing a report needs of the build, and what it adds to it. */
interface Publishing {
  home: string;
  out: string;
  /** What's left out so far: the records' lines, then this build's own, in the order met. */
  leftOut: string[];
  /** The rules of _headers that each published file has, which are written once the site is known. */
  rulesOf: Map<PublishedFile, HeaderRule[]>;
}

/**
 * Publish one entry's files to `<out>/<folder>/`, in the record's order, and give the report the
 * site shows of them. A file that can't be published is a line of what's left out, and an
 * "isn't here" line under its report.
 */
async function publishReport(
  publishing: Publishing,
  entry: SiteEntry,
  folder: string,
  id: string,
): Promise<PublishedReport> {
  const files: PublishedFile[] = [];
  const notPublished: PublishedReport["notPublished"] = [];
  for (const recorded of entry.files) {
    const source = path.join(entry.dir, recorded.name);
    const copy = await readCopy(source, recorded);
    if ("left" in copy) {
      leaveOut(
        publishing.leftOut,
        `${linkPath(publishing.home, source)}: not published: ${copy.left.why}`,
      );
      notPublished.push({ name: recorded.name, reason: copy.left.reason });
      continue;
    }
    const target = path.join(publishing.out, folder, recorded.name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, copy.bytes);
    const file: PublishedFile = {
      kind: fileKind(recorded.name),
      name: recorded.name,
      href: `${folder}/${recorded.name}`,
      bytes: recorded.bytes,
      sha256: recorded.sha256,
      run: recorded.run ?? null,
    };
    files.push(file);
    publishing.rulesOf.set(file, rulesFor(file, copy.bytes));
  }
  return { folder, id, at: entry.at, by: entry.by, files, notPublished };
}

/**
 * A file a record names, read once: its bytes when it's a regular file whose size and SHA-256 are
 * the recorded ones, and otherwise what's wrong with it. A link, a device, and a folder are never
 * read: a link could lead anywhere, and no rule about a name can know every device. A size that
 * isn't the recorded one says the file changed, and it isn't read. Whatever else stops it being
 * looked at or read (another program holds it, its name is too long, this account may not read it)
 * leaves out that file alone: it's never a reason to stop the build.
 */
async function readCopy(
  source: string,
  recorded: SharedFile,
): Promise<{ bytes: Buffer } | { left: Unpublished }> {
  try {
    const found = await lstat(source);
    if (!found.isFile()) return { left: NOT_REGULAR };
    if (found.size !== recorded.bytes) return { left: CHANGED };
    const bytes = await readFile(source);
    if (bytes.length !== recorded.bytes || sha256(bytes) !== recorded.sha256) {
      return { left: CHANGED };
    }
    return { bytes };
  } catch (error) {
    return { left: isNotThere(error) ? MISSING : unreadable(error) };
  }
}

const POLICY = "Content-Security-Policy";

/**
 * The rules of _headers for one published file, from the bytes written: a page is given the policy of
 * its own bytes at its address and at the same without ".html", which is how Netlify serves it too;
 * a Word copy and a walkthrough file are downloads; any other file has none.
 */
function rulesFor(file: PublishedFile, bytes: Buffer): HeaderRule[] {
  const address = `/${file.href}`;
  if (file.kind === "page") {
    const policy = contentSecurityPolicy(inlineHashes(bytes.toString("utf8")));
    return [
      { path: address, headers: [[POLICY, policy]] },
      { path: address.slice(0, -".html".length), headers: [[POLICY, policy]] },
    ];
  }
  if (file.kind === "word" || file.kind === "walkthrough") {
    return [{ path: address, headers: [["Content-Disposition", "attachment"]] }];
  }
  return [];
}

/**
 * The rules of _headers: the index at both its addresses, then each published file's, in the order
 * the site lists them (the demo's first, then each site's reports as they're shown). A path has one
 * rule, however many reports list its file.
 */
function headerRules(
  content: SiteContent,
  index: string,
  rulesOf: ReadonlyMap<PublishedFile, HeaderRule[]>,
): HeaderRule[] {
  const policy = contentSecurityPolicy(inlineHashes(index));
  const rules: HeaderRule[] = [
    { path: "/", headers: [[POLICY, policy]] },
    { path: "/index.html", headers: [[POLICY, policy]] },
  ];
  const seen = new Set(rules.map((rule) => rule.path));
  const reports = [
    ...(content.demo === null ? [] : [content.demo]),
    ...content.sites.flatMap((site) => site.reports),
  ];
  for (const file of reports.flatMap((report) => report.files)) {
    for (const rule of rulesOf.get(file) ?? []) {
      if (seen.has(rule.path)) continue;
      seen.add(rule.path);
      rules.push(rule);
    }
  }
  return rules;
}

/**
 * Whether the home's .gitignore has a line that keeps the site's folder out of Git: `_site`,
 * `_site/`, `/_site`, or `/_site/`, with white space around it. No file, or one that can't be read,
 * keeps nothing out.
 */
async function gitignoreKeepsSiteOut(home: string): Promise<boolean> {
  let text: string;
  try {
    text = await readFile(path.join(home, ".gitignore"), "utf8");
  } catch {
    return false;
  }
  return text.split("\n").some((line) => SITE_LINES.has(line.trim()));
}
