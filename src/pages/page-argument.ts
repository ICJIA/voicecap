import { readLatestRunId, listRuns, readRunJson } from "../run/store.js";
import { UsageError } from "../util/errors.js";
import { assertNotRewritten } from "../util/git-bash.js";
import { pageSlug } from "./slug.js";
import { canonicalKey, resolvePageUrl } from "./url.js";

export interface PageArgument {
  /** Absolute URL. */
  url: string;
  key: string;
  slug: string;
}

/**
 * A page given on the command line as a full URL or a root-relative path. `review` and
 * `manual add` have no --site, so paths resolve against the site of the latest run.
 */
export async function resolvePageArgument(value: string, outDir: string): Promise<PageArgument> {
  assertNotRewritten("--page", value);
  const trimmed = value.trim();
  let url: URL | null;
  if (/^https?:\/\//i.test(trimmed)) {
    url = resolvePageUrl(trimmed, new URL(trimmed));
  } else {
    const site = await latestSite(outDir);
    if (!site) {
      throw new UsageError(
        `--page "${value}" is a path, but there's no run yet to take the site from. Use the full URL.`,
      );
    }
    url = resolvePageUrl(trimmed, new URL(site));
  }
  if (!url) throw new UsageError(`--page "${value}" isn't a page URL or a path like /about.`);
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
