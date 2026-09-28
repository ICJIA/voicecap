import { readLatestRunId, listRuns, readRunJson } from "../run/store.js";
import { UsageError } from "../util/errors.js";
import { assertNotRewritten } from "../util/git-bash.js";
import { pageSlug } from "./slug.js";
import { canonicalKey, hasScheme, parseSiteUrl, resolvePageUrl, sameOrigin } from "./url.js";

export interface PageArgument {
  /** Absolute URL. */
  url: string;
  key: string;
  slug: string;
}

/**
 * A page given on the command line as a full URL (anything starting with a scheme, as
 * resolvePageUrl tests it) or a root-relative path. With --site (`site`), a path resolves against
 * its origin, and the page must be on that origin, so a record can't be filed under the wrong
 * site. Without it, a path resolves against the site of the latest run in `outDir`, a site's
 * folder, and must stay on that site too.
 */
export async function resolvePageArgument(
  value: string,
  outDir: string,
  site?: string | null,
): Promise<PageArgument> {
  assertNotRewritten("--page", value);
  const trimmed = value.trim();
  const given = site === undefined || site === null ? null : parseSiteUrl(site);
  let url: URL | null;
  if (hasScheme(trimmed)) {
    url = URL.canParse(trimmed) ? resolvePageUrl(trimmed, new URL(trimmed)) : null;
  } else {
    const found = given ?? (await latestSite(outDir));
    if (!found) {
      throw new UsageError(
        `--page "${value}" is a path, but there's no run yet to take the site from. Use the full URL, or add --site.`,
      );
    }
    const base = new URL(found);
    url = resolvePageUrl(trimmed, base);
    // A path can still name another host ("//other.host/page"). With --site, the check below
    // refuses that; without it, this one does, since the site came from the latest run.
    if (url && given === null && !sameOrigin(url, base)) {
      throw new UsageError(
        `--page "${value}" resolves to ${url.href}, which isn't on ${base.origin}. Give the page's full URL, or add --site.`,
      );
    }
  }
  if (!url) throw new UsageError(`--page "${value}" isn't a page URL or a path like /about.`);
  if (given && !sameOrigin(url, given)) {
    // The hosts say which site each is on; when only the scheme differs, the origins do.
    const [page, wanted] =
      url.host === given.host ? [url.origin, given.origin] : [url.host, given.host];
    throw new UsageError(`--page ${trimmed} is on ${page}, but --site is ${wanted}.`);
  }
  const key = canonicalKey(url);
  return { url: url.href, key, slug: pageSlug(key) };
}

async function latestSite(outDir: string): Promise<string | null> {
  const latest = await readLatestRunId(outDir);
  if (latest) {
    try {
      return (await readRunJson(outDir, latest)).site;
    } catch {
      // Fall back to the newest run on disk.
    }
  }
  return (await listRuns(outDir)).at(-1)?.site ?? null;
}
