import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

import { normalizeCanonical, recordedCanonical } from "../pages/canonical.js";
import { hasScheme, parseSiteUrl } from "../pages/url.js";
import { UsageError } from "../util/errors.js";
import { assertNotRewritten } from "../util/git-bash.js";
import { DATE_FOLDER, siteDirFor } from "./paths.js";
import { listRuns } from "./store.js";

/** Folders at a home's top that aren't sites: the layout from before site folders. */
const NOT_SITES: ReadonlySet<string> = new Set(["runs", "manual", "compare"]);

/** Files voicecap writes at a site folder's top. */
const SITE_FILES: ReadonlySet<string> = new Set(["reviews.json", "latest.txt", "report.html"]);

/**
 * The site folder that `review`, `manual add`, `report`, `share`, `walkthrough`, and `verify` work
 * in: --site's (see siteDirNamed: the address voicecap read, or the canonical address people
 * visit); else the site of a --page given as a full URL (even before that site has a folder); else
 * the home's only site folder (see siteFolders). Stops with a usage error when there's no way to
 * tell.
 */
export async function chooseSiteDir(options: {
  home: string;
  site?: string | null;
  page?: string | null;
}): Promise<string> {
  const { home, site, page } = options;
  if (site !== undefined && site !== null) {
    assertNotRewritten("--site", site);
    return siteDirNamed(home, site);
  }
  if (page !== undefined && page !== null) {
    assertNotRewritten("--page", page);
    const url = fullPageUrl(page);
    if (url) return siteDirFor(home, url);
  }

  const sites = await siteFolders(home);
  const [only] = sites;
  if (sites.length === 1 && only !== undefined) return path.join(home, only);
  if (sites.length === 0) {
    throw new UsageError(
      `${home} has no site folders yet: run voicecap on the site first, or add --site.`,
    );
  }
  const fix =
    page === undefined || page === null
      ? "add --site."
      : "add --site, or give --page as a full URL.";
  throw new UsageError(
    `${path.basename(home)} has ${new Intl.ListFormat("en").format(sites)}: ${fix}`,
  );
}

/**
 * The site folder `site`, given as --site, names:
 * 1. the folder named after it, when there is one: the folder of the address voicecap read, which
 *    is what --site always was;
 * 2. else the one site folder whose newest completed run recorded `site` as its site's canonical
 *    address, the one people visit. So `--site https://dvfr.illinois.gov/` finds the records of a
 *    run that read a copy of the site on this computer. The two are compared as `normalizeCanonical`
 *    writes them, and an IP address or a local address, which can't be a canonical address, skips
 *    this step;
 * 3. else the folder the address would have, which a command that may make it makes.
 * Two folders that recorded it are a usage error: the address can't say which one is meant, so it
 * asks for the address voicecap read, which names one folder.
 */
async function siteDirNamed(home: string, site: string): Promise<string> {
  const named = siteDirFor(home, parseSiteUrl(site));
  if (existsSync(named)) return named;
  const root = canonicalRoot(site);
  if (root === null) return named;

  const recording = await foldersRecording(home, root);
  const [only] = recording;
  if (only === undefined) return named;
  if (recording.length > 1) {
    const folders = new Intl.ListFormat("en").format(recording.map(({ folder }) => folder));
    const addresses = new Intl.ListFormat("en", { type: "disjunction" }).format(
      recording.map(({ read }) => read),
    );
    throw new UsageError(
      `${root} is the canonical address of ${folders}: give --site the address voicecap read, ${addresses}.`,
    );
  }
  return path.join(home, only.folder);
}

/**
 * `site` as the root of a canonical address (see `normalizeCanonical`), or null when it can't be
 * one: an IP address or a local address, which is only the address of a copy.
 */
function canonicalRoot(site: string): string | null {
  try {
    return normalizeCanonical(site);
  } catch (error) {
    if (error instanceof UsageError) return null;
    throw error;
  }
}

/** A site folder, and the address its newest completed run read. */
interface FolderRecording {
  folder: string;
  read: string;
}

/**
 * The site folders whose newest completed run recorded `root` as its site's canonical address,
 * sorted, each with the address that run read. A folder counts once, however many of its runs
 * recorded `root`: an older run, or one that didn't complete, doesn't speak for its site. A record
 * is data, so each is checked again (see `recordedCanonical`): a root that isn't a site's name
 * never matches, and a folder from before 0.10.0, whose runs recorded none, isn't one.
 */
async function foldersRecording(home: string, root: string): Promise<FolderRecording[]> {
  const found: FolderRecording[] = [];
  for (const folder of await siteFolders(home)) {
    const runs = await listRuns(path.join(home, folder));
    const newest = runs.findLast((run) => run.status === "completed");
    if (newest !== undefined && recordedCanonical(newest.canonical) === root) {
      found.push({ folder, read: newest.site });
    }
  }
  return found;
}

/**
 * A --page given as a full URL, by resolvePageUrl's test: it starts with a scheme, parses, and is
 * http or https ("https:/host/page" is one too). Null for a path.
 */
function fullPageUrl(page: string): URL | null {
  const value = page.trim();
  if (!hasScheme(value)) return null;
  const url = URL.canParse(value) ? new URL(value) : null;
  if (url === null || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new UsageError(`--page "${page}" isn't a page URL or a path like /about.`);
  }
  return url;
}

/**
 * The home's site folders, sorted: the folders at its top that hold a date folder, reviews.json,
 * latest.txt, or report.html, other than runs, manual, compare, and dot-folders. Any other folder
 * there, such as the owner's own notes or the empty folder a run that fails before recording
 * anything leaves behind, isn't a site.
 */
export async function siteFolders(home: string): Promise<string[]> {
  if (!existsSync(home)) return [];
  const sites: string[] = [];
  for (const entry of await readdir(home, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || NOT_SITES.has(entry.name)) continue;
    if (await holdsSiteRecords(path.join(home, entry.name))) sites.push(entry.name);
  }
  return sites.sort();
}

/** Whether a folder holds a date folder or one of SITE_FILES. */
async function holdsSiteRecords(dir: string): Promise<boolean> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.some((entry) =>
    entry.isDirectory() ? DATE_FOLDER.test(entry.name) : SITE_FILES.has(entry.name),
  );
}
