import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

import { hasScheme, parseSiteUrl } from "../pages/url.js";
import { UsageError } from "../util/errors.js";
import { assertNotRewritten } from "../util/git-bash.js";
import { DATE_FOLDER, siteDirFor } from "./paths.js";

/** Folders at a home's top that aren't sites: the layout from before site folders. */
const NOT_SITES: ReadonlySet<string> = new Set(["runs", "manual", "compare"]);

/** Files voicecap writes at a site folder's top. */
const SITE_FILES: ReadonlySet<string> = new Set(["reviews.json", "latest.txt", "report.html"]);

/**
 * The site folder that `review`, `manual add`, and `report` work in: --site's; else the site of a
 * --page given as a full URL (even before that site has a folder); else the home's only site
 * folder (see siteFolders). Stops with a usage error when there's no way to tell.
 */
export async function chooseSiteDir(options: {
  home: string;
  site?: string | null;
  page?: string | null;
}): Promise<string> {
  const { home, site, page } = options;
  if (site !== undefined && site !== null) {
    assertNotRewritten("--site", site);
    return siteDirFor(home, parseSiteUrl(site));
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
