/**
 * `voicecap site`: the website of each site's newest shared reports, built from the transcripts
 * home's records of what was shared (./records.ts) into a folder that Netlify publishes. It
 * publishes only what those records name: each file of an entry whose seal holds, of a kind voicecap
 * names its copies (./records.ts), copied byte for byte, and only when it's a regular file (never a
 * link, a device, or a folder) whose size and SHA-256 are the recorded ones. A size that isn't the
 * recorded one is a change, found before the file is read; any other file is read once, checked, and
 * written from those same bytes. One that changed, is gone, or can't be read is left out and named,
 * in the build's output and under its report on the site, and the build goes on: one copy that can't
 * be published never stops every later update.
 *
 * A site keeps its newest KEPT_PER_SITE entries, of all its folders together: its current report,
 * and the ones before it. An older entry's files are never read or published, and the address of
 * its page sends its reader on to the site's current report (_redirects: see redirectRules). The
 * records keep every entry: only the site leaves one off, and the build counts them, as what it
 * did, not as a warning.
 *
 * The page names a site by its canonical name: the one its newest share records, or else its
 * folder's own name (see siteNamed). A site named by a root has a link to that root beside its
 * heading, the newest one when its folders have several. Site folders that have one name are one site, their
 * reports listed together, the newest first. Only what the page shows changes: each file is still
 * published in its own folder, `<folder>/<name>`, so two folders that name one site can have files
 * of one name, and neither takes the other's place. A site headed by its folder's name when that's
 * an IP address or a local address (its shares are from before 0.10.0, which recorded no site) is
 * published all the same, and warned of, with what to do: share it again with its canonical address.
 *
 * Each build empties its folder, so a folder given by mistake must never be one with records, or
 * anyone's work, in it. A folder is built into only when it's new, empty, or one an earlier build
 * made (its _headers starts with HEADERS_FIRST_LINE) and that holds nothing but what a build writes,
 * and never when it's the home, holds the home, or is inside a site's folder or the demo's, by its
 * name and by where it really is: a link, a short name, or another letter case leads to the same
 * folder. On Windows, a folder whose name ends with a dot or a space is refused too (see
 * ENDS_WITH_DOT_OR_SPACE). A build writes files, in its folder and in the folders it makes, and no
 * name that starts with a dot: a folder with such a name (a repository's .git), or with a folder in
 * a folder (a site folder of someone's own), holds more than a build wrote, and is never emptied.
 * The one folder in a folder is the demo's own pages, demo-site/, which has a folder for each page:
 * it's taken for a build's when it holds only the paths a build writes there (see moreThanTheDemo).
 * When it holds a file or a folder that this voicecap's build doesn't write, such as a demo page
 * that a later voicecap removed, the refusal says so, and, when nothing in the folder is anyone's,
 * to delete the folder and build again (see holdsOnlyABuilds).
 * The files an operating system adds to a folder someone opens (.DS_Store, Thumbs.db, desktop.ini)
 * hold nothing of anyone's: they aren't counted, and are emptied with the rest. Every refusal comes
 * before anything is touched. The records, and the facts the trust page states of voicecap (see
 * ./facts.ts), are read before the folder is emptied, so an earlier build is kept when they can't
 * be.
 *
 * Besides each report's files, a build writes the demo's own pages in demo-site/ (the demo site
 * that comes with voicecap, copied byte for byte, but for its 404 page, with a sitemap of its
 * pages at their canonical address: see DEMO_CANONICAL), the site's page (index.html), the trust
 * page (trust.html: see ./trust.ts), robots.txt, _redirects, and _headers, which gives each page
 * its Content Security Policy, made from the hashes of that page's own bytes (the site's page at
 * "/" and "/index.html", and the trust page at "/trust.html" and "/trust"), the demo's pages
 * theirs at each address they answer at (see demoSiteRules), and each download its
 * Content-Disposition. In the home it writes .gitattributes and .gitignore when they aren't there,
 * as a run does, so a home's first build keeps _site/ out of Git with the rest of what voicecap
 * keeps out, then netlify.toml and .nvmrc the first time. None of them is ever written again.
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

import { DEMO_CANONICAL, DEMO_SITE_DIR, DEMO_SITEMAP, sitemapXml } from "../demo/server.js";
import { DEMO_OUT } from "../demo/words.js";
import type { SharedFile } from "../model.js";
import { canonicalName, isLocalHost, recordedCanonical } from "../pages/canonical.js";
import { plural } from "../report/html.js";
import { ensureGitFiles } from "../run/git-files.js";
import { linkPath, resolveHome } from "../run/paths.js";
import { siteFolders } from "../run/site-dir.js";
import { fontFaceCss } from "../share/fonts.js";
import { UsageError } from "../util/errors.js";
import { resolveUserPath } from "../util/git-bash.js";
import { sha256 } from "../util/hash.js";
import { createConsoleLogger, type Logger } from "../util/log.js";
import { OS_LITTER } from "../util/os-litter.js";
import { voicecapVersion } from "../util/version.js";
import { readVoicecapFacts, recordFactsOf, type VoicecapFacts } from "./facts.js";
import {
  contentSecurityPolicy,
  demoSiteRules,
  headersFile,
  HEADERS_FIRST_LINE,
  inlineHashes,
  POLICY_HEADER,
  redirectsFile,
  ROBOTS_TXT,
  type HeaderRule,
  type RedirectRule,
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
import { renderTrustPage } from "./trust.js";

export interface BuildSiteOptions {
  /** The transcripts home. Default: VOICECAP_TRANSCRIPTS, else "transcripts". */
  home?: string;
  /** The folder to build the site in. Default: _site in the home. */
  out?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  logger?: Logger;
  /**
   * What the trust page says of voicecap: its version, its releases, and what its release recorded
   * of itself (see ./facts.ts). Default: what the package that runs the build says of itself
   * (readVoicecapFacts), read with the records, before the folder is emptied. Given, these are all
   * the page says of voicecap, and the package's own package.json, CHANGELOG, and
   * release-facts.json aren't read for them: only the facts come from outside, and the page is
   * still drawn by the voicecap that runs the build.
   */
  voicecapFacts?: VoicecapFacts;
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
/** Netlify's file of redirects: where the page of each share a site leaves off sends its reader. */
const REDIRECTS_FILE = "_redirects";
/**
 * How many of a site's shares the website keeps: its newest, which are its current report and the
 * two before it. The owner asked for it on 2026-10-07: "the only report that matters is the current
 * one", and "the most recent 3 is all that's needed". An older share stays in the records, and
 * `voicecap verify` checks it as ever: the site leaves it off, and sends the address of its page on
 * to the site's current report (see redirectRules).
 */
export const KEPT_PER_SITE = 3;
/** The folder of the demo's own pages in a built site: its address is the demo's canonical one. */
const DEMO_FOLDER = "demo-site";
/** The demo site's 404 page, which only its own server gives: it isn't one of its pages. */
const DEMO_NOT_FOUND = "404.html";
/**
 * The demo's pages' address without the slash that ends it: what each address in their sitemap
 * starts with.
 */
const DEMO_BASE = DEMO_CANONICAL.replace(/\/$/, "");
/** The trust page's file, beside the site's page (see ./trust.ts). */
const TRUST_FILE = "trust.html";
/**
 * The address the trust page answers at besides its own: the same without ".html", which is how
 * Netlify serves a page too (see rulesFor).
 */
const TRUST_SHORT = TRUST_FILE.slice(0, -".html".length);
/**
 * The site's own files and folders at its top, which a site folder of the same name would take the
 * place of. The demo's pages are one: a site folder named so would be published among them, and a
 * file of one name would take another's place. The trust page is two names: a folder named for its
 * file would take its place, and one named for its short address would be served where the page
 * itself is.
 */
const OWN_FILES: ReadonlySet<string> = new Set([
  "index.html",
  TRUST_FILE,
  TRUST_SHORT,
  "robots.txt",
  HEADERS_FILE,
  REDIRECTS_FILE,
  DEMO_FOLDER,
]);
/**
 * The lines of a .gitignore that keep the site's folder out of Git, as Git reads them (see
 * gitignoreKeepsSiteOut).
 */
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
 * file of each site's newest shares that still matches its record, and write the site's page, the
 * trust page, robots.txt, _redirects, and _headers beside them, then .gitattributes, .gitignore,
 * netlify.toml, and .nvmrc in the home when they aren't there. Each thing left out is warned of,
 * each site's older shares are counted, and the last line says what was built. Refuses with a
 * UsageError when the home isn't a folder, and when the folder to build in is one that must not be
 * emptied (see the top of this file).
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
  // The demo's own pages are read from the package before the folder is looked at: the guard takes
  // exactly their paths for a build's, and they're written from these same bytes.
  const demoFiles = await readDemoSite();
  const refusal = await whyNotBuiltInto(home, out, treeOfDemoSite(demoFiles));
  if (refusal !== null) {
    // The path is in quotes, so that the sentence's period isn't taken for part of it.
    throw new UsageError(
      refusal.buildAgain
        ? `voicecap site won't build into ${out}: ${refusal.why}: delete the folder and build again.`
        : `voicecap site won't build into ${out}: ${refusal.why}. Give a folder of its own, such as "${path.join(home, SITE_DIR)}".`,
    );
  }

  // What can fail for want of a record, a font, a version, or the package's own facts is read
  // before the folder is emptied. Facts that are given are never read for: they are the facts.
  const records = await readSiteRecords(home);
  const fontCss = await fontFaceCss();
  const version = voicecapVersion();
  const voicecap = options.voicecapFacts ?? (await readVoicecapFacts());

  await rm(out, { recursive: true, force: true, maxRetries: 3 });
  await mkdir(out, { recursive: true });
  // The first line of _headers says a build made this folder, so one that stops before it writes
  // the rest can be emptied by the next. The whole file is written last.
  await writeFile(path.join(out, HEADERS_FILE), headersFile([]));

  const leftOut = [...records.leftOut];
  const publishing: Publishing = { home, out, leftOut, rulesOf: new Map() };
  // Every share of the site folders, in the records' order, and each site's shares, by the site's
  // name: folders that name one site are one site.
  const inRecordOrder: Share[] = [];
  // `rooted` is the newest of its folders' newest shares that records a root people visit, which
  // gives the site its name: the page's link to the site, beside its heading, goes there.
  const named = new Map<
    string,
    { folders: string[]; shares: Share[]; rooted?: { share: Share; root: string } }
  >();
  // The site folders headed by their own name, which is an IP address or a local address.
  const headedByAnAddress: string[] = [];
  for (const [order, { folder, entries }] of records.sites.entries()) {
    if (OWN_FILES.has(folder)) {
      leaveOut(
        leftOut,
        `${folder}: not published: a site folder named ${folder} would take the place of the site's own ${folder}`,
      );
      continue;
    }
    const shares = entries.map((entry): Share => ({ order, folder, entry }));
    inRecordOrder.push(...shares);
    // The folder's newest share names its site.
    const newest = shares.toSorted(newestFirst)[0];
    const { name, root } = siteNamed(folder, newest?.entry.site ?? null);
    if (name === folder && namesAnAddress(folder)) headedByAnAddress.push(folder);
    const site = named.get(name) ?? { folders: [], shares: [] };
    site.folders.push(folder);
    site.shares.push(...shares);
    if (
      root !== null &&
      newest !== undefined &&
      (site.rooted === undefined || newestFirst(newest, site.rooted.share) < 0)
    ) {
      site.rooted = { share: newest, root };
    }
    named.set(name, site);
  }
  // Each site's newest shares, the newest first, which the site keeps, and the older ones it leaves
  // off: of all its folders' shares together.
  const kept = [...named]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, { folders, shares, rooted }]) => {
      const newest = shares.toSorted(newestFirst);
      return {
        name,
        folders,
        address: rooted?.root,
        shares: newest.slice(0, KEPT_PER_SITE),
        older: newest.slice(KEPT_PER_SITE),
      };
    });
  // The kept shares' files are published in the records' order, so what's left out of them is said
  // in that order, wherever their reports are listed. An older share's files are never read.
  const keeping = new Set(kept.flatMap(({ shares }) => shares));
  const reportOf = new Map<Share, PublishedReport>();
  for (const share of inRecordOrder) {
    if (!keeping.has(share)) continue;
    const { folder, entry } = share;
    const id = `report-${folder}-${entry.seq}`;
    reportOf.set(share, await publishReport(publishing, entry, folder, id));
  }
  const sites: SiteContent["sites"] = kept.map(({ name, folders, address, shares }) => ({
    name,
    folders,
    reports: shares.flatMap((share) => {
      const report = reportOf.get(share);
      return report === undefined ? [] : [report];
    }),
    ...(address === undefined ? {} : { address }),
  }));
  const demo =
    records.demo === null
      ? null
      : await publishReport(publishing, records.demo, DEMO_SITE, `report-${DEMO_SITE}`);
  const content: SiteContent = { demo, sites };
  await publishDemoSite(out, demoFiles);

  const index = renderSiteIndex(content, { fontCss });
  // The trust page counts the records' facts from what was just published, so it's drawn after it.
  const trust = renderTrustPage(
    { voicecap, records: recordFactsOf(content), content },
    { fontCss },
  );
  await writeFile(path.join(out, "index.html"), index);
  await writeFile(path.join(out, TRUST_FILE), trust);
  await writeFile(path.join(out, "robots.txt"), ROBOTS_TXT);
  await writeFile(path.join(out, REDIRECTS_FILE), redirectsFile(redirectRules(kept, sites)));
  // The demo's own pages' rules are made from the files just published, so that none is left out.
  const demoRules = demoSiteRules(
    DEMO_FOLDER,
    demoFiles.map((file) => file.path),
  );
  await writeFile(
    path.join(out, HEADERS_FILE),
    headersFile(headerRules(content, { index, trust }, demoRules, publishing.rulesOf)),
  );
  // A home that has no .gitignore gets voicecap's now, with _site/ in it, so the check below warns
  // only of a .gitignore that was there and doesn't keep the site out.
  for (const name of await ensureGitFiles(home)) {
    logger.info(`Wrote ${name} into ${home}, for Git: commit it with the records.`);
  }
  for (const name of await ensureNetlifyFiles(home, version)) {
    logger.info(`Wrote ${name} into ${home}, for Netlify: commit it with the records.`);
  }

  if (isSamePath(out, path.join(home, SITE_DIR)) && !(await gitignoreKeepsSiteOut(home))) {
    logger.warn(
      `${home}'s .gitignore doesn't keep ${SITE_DIR}/ out of Git, so the built site could be committed with the records. Add the line ${SITE_DIR}/ to it.`,
    );
  }

  for (const line of leftOut) logger.warn(line);
  // Shares from before 0.10.0 recorded no site: such a site is headed by its folder's name, which is
  // the address voicecap read. The build is the last moment before the site is public.
  for (const folder of headedByAnAddress.toSorted()) {
    logger.warn(
      printable(
        `${folder}: headed by its folder's name, an IP address or a local address. Share it again with its canonical address (see report.canonical) to name it.`,
      ),
    );
  }
  // What the site keeps of each site is what it does, not a warning.
  for (const { name, older } of kept) {
    if (older.length === 0) continue;
    const count =
      older.length === 1 ? "1 older report isn't" : `${older.length} older reports aren't`;
    logger.info(
      printable(`${name}: ${count} on the site, which shows each site's newest ${KEPT_PER_SITE}.`),
    );
  }
  const reports = sites.reduce((count, site) => count + site.reports.length, 0);
  logger.info(
    `Built the site in ${out}: ${plural(reports, "report")} from ${plural(sites.length, "site")}${demo === null ? "" : ", and the demo's"}.`,
  );
  return { out, content, leftOut };
}

/** A share of a site folder, with what puts it in its site's order: its folder's place and its seq. */
interface Share {
  /** Where its folder comes among the home's site folders, which are sorted by name. */
  order: number;
  folder: string;
  entry: SiteEntry;
}

/**
 * Newest first, by the moment each share's time names. Of two made at the same moment, the one in
 * the earlier folder comes first, and in one folder the one with the higher seq. So a folder's
 * shares come in the same order alone as among the shares of other folders that name its site.
 */
function newestFirst(a: Share, b: Share): number {
  return (
    Date.parse(b.entry.at) - Date.parse(a.entry.at) ||
    a.order - b.order ||
    b.entry.seq - a.entry.seq
  );
}

/**
 * The rules of _redirects: the page of each share a site leaves off, at its own address and at the
 * same without ".html" (which is how Netlify serves a page too), sent on to the site's current
 * report's page, or to the website's front page when that page isn't published. `kept` and `sites`
 * are the same sites, in the page's order, and each site's older shares come the newest first. An
 * address a published file is at is never sent on: Netlify would serve the file all the same, and
 * the rule would say what isn't so. Nor is an address sent on twice.
 */
function redirectRules(
  kept: readonly { older: readonly Share[] }[],
  sites: SiteContent["sites"],
): RedirectRule[] {
  const taken = new Set(
    sites
      .flatMap(({ reports }) => reports)
      .flatMap(({ files }) => files)
      .flatMap(({ kind, href }) =>
        kind === "page" ? [`/${href}`, `/${href.slice(0, -".html".length)}`] : [`/${href}`],
      ),
  );
  const rules: RedirectRule[] = [];
  for (const [index, { older }] of kept.entries()) {
    const page = sites[index]?.reports[0]?.files.find(({ kind }) => kind === "page");
    const to = page === undefined ? "/" : `/${page.href}`;
    for (const { folder, entry } of older) {
      for (const { name } of entry.files) {
        if (fileKind(name) !== "page") continue;
        const address = `/${folder}/${name}`;
        for (const from of [address, address.slice(0, -".html".length)]) {
          if (taken.has(from)) continue;
          taken.add(from);
          rules.push({ from, to });
        }
      }
    }
  }
  return rules;
}

/**
 * The name the site shows a site folder's reports under, given the root its newest share records for
 * its site: that root's canonical name, with the root, where people visit the site; and otherwise
 * the folder's own name, with no root. A share that records no root (one from before 0.10.0), or one
 * that names the site by no address readers know it by (a share made with no canonical address
 * records the address voicecap read, which `recordedCanonical` turns away: an IP address, or a
 * local address), leaves the folder's name.
 */
function siteNamed(folder: string, site: string | null): { name: string; root: string | null } {
  const root = recordedCanonical(site);
  return { name: root === null ? folder : canonicalName(root), root };
}

/**
 * Whether a site folder's name is that of an IP address or a local address: the name `siteFolder`
 * gives such a host (see isLocalHost), its port after the last "_" (`127.0.0.1_4848`,
 * `localhost_3000`). An IPv6 address's brackets and colons are each a "_" in a folder's name, so a
 * name that starts with one and has only those and hex digits after it is one (`___1__4848`, for
 * `[::1]:4848`): a host people visit doesn't start with "_".
 */
function namesAnAddress(folder: string): boolean {
  return isLocalHost(folder.replace(/_(\d+)$/, ":$1")) || /^_[0-9a-f_]+$/.test(folder);
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
 * A name that ends with a dot or a space. Windows drops either from the end of a name, but Node
 * passes the name on as it is, so a folder made with one is not the folder Windows' own tools see:
 * they can't open it or remove it, and Git can't add it.
 */
const ENDS_WITH_DOT_OR_SPACE = /[. ]$/;

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
 * Why the site isn't built into a folder, and what to do. `why` is in words that finish "won't build
 * into <out>: ...". With `buildAgain`, the folder is one an earlier build made, which holds nothing
 * of anyone's, so it can be deleted and built again; otherwise, the person is to give a folder of
 * its own.
 */
interface Refusal {
  why: string;
  buildAgain: boolean;
}

/**
 * Why the site can't be built into `out`, or null when it can. Nothing is touched: it's only looked
 * at. The checks, in order:
 *
 * - on Windows, its name ends with a dot or a space (see ENDS_WITH_DOT_OR_SPACE);
 * - `out` is a file, not a folder;
 * - it's the home, holds the home, or is inside a site's folder (a folder at the home's top that has
 *   records in it) or the demo's: by the names of the paths, and then by where they really are, so
 *   that a link, a short name, or another letter case is the folder it leads to;
 * - it's there, isn't empty, and isn't one a build made (see builtBefore);
 * - it's one a build made, and holds more than a build writes (see moreThanABuild), the paths
 *   `demoSite` has for the demo's own pages being among those a build writes.
 *
 * Each of these is for a folder of its own, but one: a folder a build made whose demo-site/ holds a
 * file or a folder of files that this voicecap's build doesn't write, which another voicecap's build
 * may have (a demo page that a later voicecap removed), when the folder holds nothing of anyone's
 * at all (see holdsOnlyABuilds). It can be deleted and built again, and the refusal says so.
 *
 * What's left is a folder that isn't there, one with nothing in it, or one an earlier build made and
 * nothing else has been put in.
 */
async function whyNotBuiltInto(
  home: string,
  out: string,
  demoSite: DemoSiteTree,
): Promise<Refusal | null> {
  const refuse = (why: string): Refusal => ({ why, buildAgain: false });
  if (process.platform === "win32" && ENDS_WITH_DOT_OR_SPACE.test(path.basename(out))) {
    return refuse("its name ends with a dot or a space, which Windows drops");
  }
  const found = await kindOf(out);
  if (found === "file") return refuse("it's a file, not a folder");

  const sites = await siteFolders(home);
  const demo = path.join(home, DEMO_OUT);
  const byName = whyAmongTheRecords(
    { home, sites: sites.map((folder) => path.join(home, folder)), demo },
    out,
  );
  if (byName !== null) return refuse(byName);
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
  if (byPlace !== null) return refuse(byPlace);

  if (found === "folder" && (await readdir(out)).length > 0) {
    if (!(await builtBefore(out)))
      return refuse("it isn't empty, and voicecap site didn't build it");
    const more = await moreThanABuild(out, demoSite);
    if (more === null) return null;
    // A person is told to delete the folder only when that can lose nothing of anyone's, whatever
    // they delete it with.
    if (more.ofAnotherBuild !== null && (await holdsOnlyABuilds(out))) {
      return { why: more.ofAnotherBuild, buildAgain: true };
    }
    return refuse(more.why);
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
 * What a folder a build made holds more than a build writes. `why` is in words that finish "won't
 * build into <out>: ...". `ofAnotherBuild` is what's said instead when that's a file or a folder in
 * demo-site/ that another voicecap's build may have written, and null for anything else.
 */
interface More {
  why: string;
  ofAnotherBuild: string | null;
}

/**
 * What a folder that a build made holds more than that (see More), or null when it holds only what a
 * build writes. A build writes files, in its folder and in each folder it makes, and no name that
 * starts with a dot. A name with a dot first (a repository's .git), or a folder in a folder (a site
 * folder of someone's own, with its date folder and its record), is somebody's, and emptying the
 * folder would lose it. The one exception is the folder at the top that's named DEMO_FOLDER: the
 * demo's own pages, which a build writes with a folder for each page, and which holds nothing else
 * (see moreThanTheDemo). A link isn't looked into: when the folder is emptied it's removed, and what
 * it leads to isn't. The files an operating system adds (see isOsLitter) are no one's, at the
 * folder's top, one folder down, and in each folder of the demo's pages, and aren't counted.
 */
async function moreThanABuild(folder: string, demoSite: DemoSiteTree): Promise<More | null> {
  const somebodys = (why: string): More => ({ why, ofAnotherBuild: null });
  for (const entry of await entriesOf(folder)) {
    if (isOsLitter(entry)) continue;
    if (entry.name.startsWith(".")) {
      return somebodys(`it holds ${printable(entry.name)}, which a build never writes`);
    }
    if (!entry.isDirectory()) continue;
    if (entry.name === DEMO_FOLDER) {
      const more = await moreThanTheDemo(path.join(folder, entry.name), "", demoSite);
      if (more !== null) return more;
      continue;
    }
    for (const inner of await entriesOf(path.join(folder, entry.name))) {
      if (isOsLitter(inner)) continue;
      const where = printable(`${entry.name}/${inner.name}`);
      if (inner.name.startsWith(".")) {
        return somebodys(`it holds ${where}, which a build never writes`);
      }
      if (inner.isDirectory()) {
        return somebodys(`it holds ${where}, a folder inside a folder, which a build never writes`);
      }
    }
  }
  return null;
}

/**
 * What a demo-site/ folder that a build made holds more than that (see More), or null when it holds
 * only what this voicecap's build writes there: each file at a path the demo's pages have (see
 * DemoSiteTree), in a folder they have, and nothing else. A name with a dot first, a file or a folder
 * of any other name, a folder where a file goes, a file where a folder goes, and a link, are
 * somebody's, or at best a build's of another voicecap, and emptying the folder would lose them. A
 * file or a folder with no dot first may be another voicecap's demo page, such as one that a later
 * voicecap removed, and is said to be. The files an operating system adds (see isOsLitter) aren't
 * counted. A folder is looked into only when the pages have it, so the walk goes no deeper than
 * they do. `dir` is the folder, and `inside` its path from demo-site/ ("" for demo-site/ itself).
 */
async function moreThanTheDemo(
  dir: string,
  inside: string,
  demoSite: DemoSiteTree,
): Promise<More | null> {
  for (const entry of await entriesOf(dir)) {
    if (isOsLitter(entry)) continue;
    const relative = inside === "" ? entry.name : `${inside}/${entry.name}`;
    const written = entry.isDirectory()
      ? demoSite.folders.has(relative)
      : entry.isFile() && demoSite.files.has(relative);
    if (!written) {
      const where = printable(`${DEMO_FOLDER}/${relative}`);
      const mayBeAnotherBuilds =
        !entry.name.startsWith(".") && (entry.isFile() || entry.isDirectory());
      return {
        why: entry.isDirectory()
          ? `it holds ${where}, a folder inside a folder, which a build never writes`
          : `it holds ${where}, which a build never writes`,
        ofAnotherBuild: mayBeAnotherBuilds
          ? `it holds ${where}, which this voicecap's build doesn't write (it may be from another voicecap)`
          : null,
      };
    }
    if (entry.isDirectory()) {
      const more = await moreThanTheDemo(path.join(dir, entry.name), relative, demoSite);
      if (more !== null) return more;
    }
  }
  return null;
}

/**
 * Whether everything in a folder an earlier build made, all the way down, is what a build of some
 * voicecap writes: files; folders at its top (a site's, the demo's report's) and anywhere in
 * demo-site/; no link, nor anything else that isn't a file or a folder; and no name with a dot
 * first but the files an operating system adds (see isOsLitter). Only then is a person told that
 * the folder can be deleted: however they delete it, nothing of anyone's goes with it. Some ways of
 * deleting a folder follow a link in it, and empty what it leads to.
 */
async function holdsOnlyABuilds(folder: string): Promise<boolean> {
  for (const entry of await readdir(folder, { recursive: true, withFileTypes: true })) {
    if (isOsLitter(entry)) continue;
    if (entry.name.startsWith(".") || !(entry.isFile() || entry.isDirectory())) return false;
    const names = path.relative(folder, path.join(entry.parentPath, entry.name)).split(path.sep);
    if (entry.isDirectory() && names.length > 1 && names[0] !== DEMO_FOLDER) return false;
  }
  return true;
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

/** A file a build writes in demo-site/: its path from there, with "/" between names, and its bytes. */
interface DemoSiteFile {
  path: string;
  bytes: Buffer;
}

/**
 * The files a build writes in demo-site/: every file of the demo site that comes with voicecap
 * (DEMO_SITE_DIR), but its 404 page, and a sitemap of the pages at their canonical address. Only
 * regular files are taken, so a link in the package's folder is never followed. The files an
 * operating system adds to a folder someone opens (OS_LITTER), as a checkout of voicecap opened in
 * Finder or Explorer has, are no part of the demo, and are never published.
 */
async function readDemoSite(): Promise<DemoSiteFile[]> {
  const files: DemoSiteFile[] = [];
  for (const entry of await readdir(DEMO_SITE_DIR, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || OS_LITTER.has(entry.name)) continue;
    const source = path.join(entry.parentPath, entry.name);
    const relative = path.relative(DEMO_SITE_DIR, source).split(path.sep).join("/");
    if (relative === DEMO_NOT_FOUND) continue;
    files.push({ path: relative, bytes: await readFile(source) });
  }
  files.push({ path: DEMO_SITEMAP, bytes: Buffer.from(sitemapXml(DEMO_BASE)) });
  return files;
}

/**
 * What a build writes in demo-site/, as the guard takes it for a build's own (see
 * moreThanTheDemo): each file by its path from there, and each folder those paths are in.
 */
interface DemoSiteTree {
  files: ReadonlySet<string>;
  folders: ReadonlySet<string>;
}

/** The paths of `files`, and the folders they're in. */
function treeOfDemoSite(files: readonly DemoSiteFile[]): DemoSiteTree {
  const folders = new Set<string>();
  for (const { path: file } of files) {
    for (let slash = file.indexOf("/"); slash !== -1; slash = file.indexOf("/", slash + 1)) {
      folders.add(file.slice(0, slash));
    }
  }
  return { files: new Set(files.map((file) => file.path)), folders };
}

/** Write the demo's own pages into `<out>/demo-site/`, a folder made for each page. */
async function publishDemoSite(out: string, files: readonly DemoSiteFile[]): Promise<void> {
  for (const { path: file, bytes } of files) {
    const target = path.join(out, DEMO_FOLDER, ...file.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
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
  return {
    folder,
    id,
    at: entry.at,
    by: entry.by,
    files,
    notPublished,
    // What its copies say of the site, for its card: an entry from before 0.12.3 says nothing.
    ...(entry.result === null ? {} : { result: entry.result }),
  };
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
      { path: address, headers: [[POLICY_HEADER, policy]] },
      { path: address.slice(0, -".html".length), headers: [[POLICY_HEADER, policy]] },
    ];
  }
  if (file.kind === "word" || file.kind === "walkthrough") {
    return [{ path: address, headers: [["Content-Disposition", "attachment"]] }];
  }
  return [];
}

/**
 * The rules of _headers: the index at both its addresses, the trust page at both its own, each with
 * the policy of that page's own bytes (`pages`, the text of each), the demo's own pages' rules
 * (`demoRules`, made by demoSiteRules: a rule for each address a page answers at), then each
 * published file's, in the order the site lists them (the demo's report first, then each site's
 * reports as they're shown). A path has one rule, however many reports list its file.
 */
function headerRules(
  content: SiteContent,
  pages: { index: string; trust: string },
  demoRules: readonly HeaderRule[],
  rulesOf: ReadonlyMap<PublishedFile, HeaderRule[]>,
): HeaderRule[] {
  const indexPolicy = contentSecurityPolicy(inlineHashes(pages.index));
  const trustPolicy = contentSecurityPolicy(inlineHashes(pages.trust));
  const rules: HeaderRule[] = [
    { path: "/", headers: [[POLICY_HEADER, indexPolicy]] },
    { path: "/index.html", headers: [[POLICY_HEADER, indexPolicy]] },
    { path: `/${TRUST_FILE}`, headers: [[POLICY_HEADER, trustPolicy]] },
    { path: `/${TRUST_SHORT}`, headers: [[POLICY_HEADER, trustPolicy]] },
    ...demoRules,
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
 * `_site/`, `/_site`, or `/_site/`, read as Git reads it. Git skips a UTF-8 byte order mark at the
 * file's start (Windows PowerShell 5.1 writes one), and drops the CR of a CRLF line ending, then the
 * line's trailing spaces. White space at a line's start, and a tab at its end, are the pattern's, so
 * `  _site/` keeps nothing out. No file, or one that can't be read, keeps nothing out.
 *
 * A line Git would honor but that isn't one of the four, such as `_site/*`, gets the warning too: the
 * warning says to add `_site/`, which ends it.
 */
async function gitignoreKeepsSiteOut(home: string): Promise<boolean> {
  let text: string;
  try {
    text = await readFile(path.join(home, ".gitignore"), "utf8");
  } catch {
    return false;
  }
  return text
    .replace(/^\uFEFF/, "")
    .split("\n")
    .some((line) => SITE_LINES.has(withoutTrailingSpaces(line.replace(/\r$/, ""))));
}

/**
 * A line without its trailing spaces, which Git drops (but not tabs). In one pass from the end, so a
 * long run of spaces inside a line can't stall the build, as a pattern such as / +$/ would.
 */
function withoutTrailingSpaces(line: string): string {
  let end = line.length;
  while (end > 0 && line.charCodeAt(end - 1) === 0x20) end--;
  return line.slice(0, end);
}
