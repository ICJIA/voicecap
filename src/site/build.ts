/**
 * `voicecap site`: the website of every report voicecap has shared, built from the transcripts
 * home's records of what was shared (./records.ts) into a folder that Netlify publishes. It
 * publishes only what those records name: each file of an entry whose seal holds, copied byte for
 * byte, and only when it's a regular file (never a link, a device, or a folder) whose size and
 * SHA-256 are the recorded ones. A file is read once, checked, and written from those same bytes. One
 * that changed or is gone is left out and named, in the build's output and under its report on the
 * site, and the build goes on: one changed copy never stops every later update.
 *
 * Each build empties its folder, so a folder given by mistake must never be one with records in it.
 * A folder is built into only when it's new, empty, or one an earlier build made (its _headers starts
 * with HEADERS_FIRST_LINE), and never when it's the home, holds the home, or is inside a site's
 * folder or the demo's. Every refusal comes before anything is touched. The records are read before
 * the folder is emptied, so an earlier build is kept when they can't be.
 *
 * Besides each report's files, a build writes the site's page (index.html), robots.txt, and
 * _headers, which gives each page its Content Security Policy, made from the hashes of that page's
 * own bytes, and each download its Content-Disposition. In the home it writes netlify.toml and
 * .nvmrc the first time, and never again.
 */
import { lstat, mkdir, open, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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
import { leaveOut, readSiteRecords, type SiteEntry } from "./records.js";
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
/** The folder the demo's report is published in. records.ts leaves out a site folder of this name. */
const DEMO_FOLDER = "demo";
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

/** Why a file a record names isn't published. */
type Problem = "changed" | "missing" | "not a regular file";

/** What a build says of each, after the file's path from the home and "not published: ". */
const WHY_NOT_PUBLISHED: Record<Problem, string> = {
  changed: "it no longer matches its fingerprint",
  missing: "the file is missing",
  "not a regular file": "it isn't a regular file",
};

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
      : await publishReport(publishing, records.demo, DEMO_FOLDER, `report-${DEMO_FOLDER}`);
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

/**
 * Why the site can't be built into `out`, in words that finish "won't build into <out>: ...", or
 * null when it can. Nothing is touched: it's only looked at. The checks, in order:
 *
 * - `out` is a file, not a folder;
 * - it's the home, or holds the home;
 * - it's inside a site's folder (a folder at the home's top that has records in it), or in the demo's;
 * - it's there, isn't empty, and isn't one a build made (see builtBefore).
 *
 * What's left is a folder that isn't there, one with nothing in it, or one an earlier build made.
 */
async function whyNotBuiltInto(home: string, out: string): Promise<string | null> {
  const found = await kindOf(out);
  if (found === "file") return "it's a file, not a folder";
  if (isWithin(out, home)) {
    return isSamePath(out, home)
      ? "it's the transcripts home itself"
      : "it holds the transcripts home";
  }
  for (const folder of await siteFolders(home)) {
    if (isWithin(path.join(home, folder), out)) {
      return "it's inside a site's folder, where its records are";
    }
  }
  if (isWithin(path.join(home, DEMO_OUT), out)) {
    return `it's inside ${DEMO_OUT}, where the demo's records are`;
  }
  if (found === "folder" && (await readdir(out)).length > 0 && !(await builtBefore(out))) {
    return "it isn't empty, and voicecap site didn't build it";
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
    if ("problem" in copy) {
      leaveOut(
        publishing.leftOut,
        `${linkPath(publishing.home, source)}: not published: ${WHY_NOT_PUBLISHED[copy.problem]}`,
      );
      // A file that isn't a regular one is as good as missing, to a reader of the site.
      notPublished.push({
        name: recorded.name,
        reason: copy.problem === "changed" ? "changed" : "missing",
      });
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
 * read: a link could lead anywhere, and no rule about a name can know every device.
 */
async function readCopy(
  source: string,
  recorded: SharedFile,
): Promise<{ bytes: Buffer } | { problem: Problem }> {
  try {
    if (!(await lstat(source)).isFile()) return { problem: "not a regular file" };
    const bytes = await readFile(source);
    if (bytes.length !== recorded.bytes || sha256(bytes) !== recorded.sha256) {
      return { problem: "changed" };
    }
    return { bytes };
  } catch (error) {
    if (isNotThere(error)) return { problem: "missing" };
    throw error;
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
