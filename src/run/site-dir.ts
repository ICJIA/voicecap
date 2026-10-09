import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { isWebRoot, normalizeCanonical, recordedCanonical } from "../pages/canonical.js";
import { hasScheme, parseSiteUrl } from "../pages/url.js";
import { newestSealed, readShares } from "../share/shares.js";
import { UsageError } from "../util/errors.js";
import { assertNotRewritten } from "../util/git-bash.js";
import { DATE_FOLDER, siteDirFor, siteFolder } from "./paths.js";
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
 * 1. the folder named after it, when it holds site records (see holdsSiteRecords): the folder of
 *    the address voicecap read, which is what --site always was. A folder with none is no site's,
 *    whatever it's called: a first attempt that stopped before it recorded anything leaves one;
 * 2. else the one site folder that recorded `site` as its site's canonical address, the one people
 *    visit, by its newest completed run or its newest share (see foldersNaming). So
 *    `--site https://dvfr.illinois.gov/` finds the records of a run that read a copy of the site on
 *    the computer that ran it, whether the run recorded the address or report.canonical named it
 *    when the copies were shared. The two are compared as `normalizeCanonical` writes them, and an
 *    IP address or a local address, which can't be a canonical address, skips this step;
 * 3. else the folder the address would have, which a command that may make it makes.
 * A canonical address with a path, such as https://voicecap.icjia.app/demo-site/, is a site that
 * lives under its host. Folders are named after hosts, so the one named after this host holds the
 * host's own pages, and for such an address step 2 comes before step 1.
 * Two folders that recorded it are a usage error: the address can't say which one is meant, so it
 * asks for the address voicecap read, which names one folder.
 */
async function siteDirNamed(home: string, site: string): Promise<string> {
  const named = siteDirFor(home, parseSiteUrl(site));
  const root = canonicalRoot(site);
  const recorded = async () => (root === null ? null : await folderRecording(home, root));
  const underAPath = root !== null && new URL(root).pathname !== "/";

  if (underAPath) {
    const found = await recorded();
    if (found !== null) return found;
  }
  if (await isSiteFolder(named)) return named;
  if (!underAPath) {
    const found = await recorded();
    if (found !== null) return found;
  }
  return named;
}

/**
 * Whether `dir`, the folder named after an address, is a site's: it is there, and it holds site
 * records (see holdsSiteRecords). A folder that is empty, or holds nothing a site does, isn't.
 */
async function isSiteFolder(dir: string): Promise<boolean> {
  return existsSync(dir) && (await stat(dir)).isDirectory() && (await holdsSiteRecords(dir));
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

/** A site folder, by its name in the home, and the address voicecap read there. */
interface SiteFolder {
  folder: string;
  /**
   * The address its newest completed run read, or its newest run's when none completed, as the run
   * recorded it: null for a folder with no run that can be read.
   */
  read: string | null;
}

/**
 * Every site folder of `home` that recorded `root` as its site's canonical address, in the home's
 * order (see siteFolders): by its newest completed run, or by its newest share (see newestShareRoot),
 * since a share names the site by report.canonical when it's set, which no run recorded. A folder
 * counts once, however many of its records named `root`: an older run, or one that didn't complete,
 * doesn't speak for its site, and neither does an older share. A record is data, so each is checked
 * again (see `recordedCanonical`): a root that isn't a site's name never matches, and a folder from
 * before 0.10.0, whose runs and shares recorded none, isn't one.
 */
async function foldersNaming(home: string, root: string): Promise<SiteFolder[]> {
  const found: SiteFolder[] = [];
  for (const folder of await siteFolders(home)) {
    const siteDir = path.join(home, folder);
    const runs = await listRuns(siteDir);
    const newest = runs.findLast((run) => run.status === "completed");
    if (
      recordedCanonical(newest?.canonical) === root ||
      (await newestShareRoot(siteDir)) === root
    ) {
      found.push({ folder, read: (newest ?? runs.at(-1))?.site ?? null });
    }
  }
  return found;
}

/**
 * The root a site folder's newest share recorded as the site its copies name (`ShareEntry.site`), of
 * the entries whose seal holds, the one with the highest seq (see newestSealed). It's read as the
 * website reads it: only a root as voicecap writes one (see `isWebRoot`), checked again as a record
 * is (see `recordedCanonical`). Null when there's no such entry, when it records no site readers
 * know it by, and when share/shares.json can't be read, which vouches for nothing.
 */
async function newestShareRoot(siteDir: string): Promise<string | null> {
  let site: unknown;
  try {
    site = newestSealed((await readShares(siteDir)).shares)?.site;
  } catch {
    return null;
  }
  return isWebRoot(site) ? recordedCanonical(site) : null;
}

/** ", A or B", the addresses voicecap read in these folders, or "" when it read none it recorded. */
function readAddresses(folders: readonly SiteFolder[]): string {
  const read = folders.flatMap(({ read: address }) => (address === null ? [] : [address]));
  return read.length === 0
    ? ""
    : `, ${new Intl.ListFormat("en", { type: "disjunction" }).format(read)}`;
}

/**
 * The one site folder, as a path in `home`, that recorded `root` as its site's canonical address
 * (see foldersNaming); null when none did. Two or more folders is a usage error, which asks for the
 * address voicecap read.
 */
async function folderRecording(home: string, root: string): Promise<string | null> {
  const found = await foldersNaming(home, root);
  const [only] = found;
  if (only === undefined) return null;
  if (found.length > 1) {
    const folders = new Intl.ListFormat("en").format(found.map(({ folder }) => folder));
    throw new UsageError(
      `${root} is the canonical address of ${folders}: give --site the address voicecap read${readAddresses(found)}.`,
    );
  }
  return path.join(home, only.folder);
}

/**
 * The site folder that `voicecap walkthrough --site <site> --run <run>` writes from: the command the
 * shareable page and its Word copy print for each run, which names the site by its canonical
 * address. That address can name more than one folder: the folder named after it, when it holds
 * records, and each folder that recorded it (see foldersNaming), such as a copy's beside the live
 * site's own. So every one of them is looked in, and the one that holds `run` is taken. When none
 * of them holds it, a usage error names the run and the folders it looked in. When several do, the
 * folder named after an address with no path is taken, as step 1 of siteDirNamed takes it: it's
 * the address voicecap read for that folder, so there's no other to ask for. Otherwise, a usage
 * error names the folders, and asks for the address voicecap read, which names one. A --site that
 * isn't a canonical address (an IP address or a local address), a canonical address that no folder
 * names, and no --site at all, are as chooseSiteDir has them: the run is then looked for there.
 */
export async function chooseSiteDirOfRun(options: {
  home: string;
  site?: string | null;
  run: string;
}): Promise<string> {
  const { home, site, run } = options;
  if (site === undefined || site === null) return chooseSiteDir({ home });
  assertNotRewritten("--site", site);
  const url = parseSiteUrl(site);
  const root = canonicalRoot(site);
  if (root === null) return siteDirNamed(home, site);

  const namedFolder = siteFolder(url);
  const named = (await isSiteFolder(path.join(home, namedFolder)))
    ? [{ folder: namedFolder, read: null }]
    : [];
  const recorded = (await foldersNaming(home, root)).filter(({ folder }) => folder !== namedFolder);
  // In the order siteDirNamed looks in them.
  const underAPath = new URL(root).pathname !== "/";
  const candidates = underAPath ? [...recorded, ...named] : [...named, ...recorded];
  if (candidates.length === 0) return siteDirNamed(home, site);

  const holding: SiteFolder[] = [];
  for (const { folder } of candidates) {
    const record = (await listRuns(path.join(home, folder))).find(({ id }) => id === run);
    if (record !== undefined) holding.push({ folder, read: record.site });
  }
  const [only] = holding;
  if (only !== undefined && holding.length === 1) return path.join(home, only.folder);
  if (only === undefined) {
    const dirs = candidates.map(({ folder }) => path.join(home, folder));
    throw new UsageError(
      `There's no run ${run} in ${new Intl.ListFormat("en", { type: "disjunction" }).format(dirs)}.`,
    );
  }
  if (!underAPath && holding.some(({ folder }) => folder === namedFolder)) {
    return path.join(home, namedFolder);
  }
  const folders = new Intl.ListFormat("en").format(holding.map(({ folder }) => folder));
  throw new UsageError(
    `Run ${run} is in ${folders}: give --site the address voicecap read${readAddresses(holding)}.`,
  );
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
