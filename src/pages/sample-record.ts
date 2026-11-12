/**
 * A run's pages as a sample of a site (`--sample-of <sitemap>`): the sitemap's pages counted by URL
 * path pattern (`urlPattern`, as `list-urls --sample` groups them), and how many of each the run
 * reads. Pages are matched by their canonical key, so `/about` and `/about/` are one page, as a run
 * counts them. A large site's pages are mostly a few types, each built from one template
 * (`/news/*`, `/about/publications/*`), and the record says, type by type, how many the site has and
 * how many NVDA read, which the report shows beside the reason a sample stands for the rest.
 */
import type { SampleRecord } from "../model.js";
import { urlPattern } from "./sample.js";

interface Listed {
  url: string;
  key: string;
}

/**
 * The sample record of a run that reads `runPages`, chosen from the pages `sitePages` (the sitemap
 * `sitemap` lists, cleaned up as a run's are): each pattern of the sitemap's pages, with how many it
 * lists and how many of those the run reads, most pages first (then by pattern, so the order is the
 * same each time); and how many of the run's pages the sitemap doesn't list.
 */
export function sampleRecordOf(
  sitemap: string,
  sitePages: readonly Listed[],
  runPages: readonly Listed[],
): SampleRecord {
  const onSite = new Map<string, number>();
  const keys = new Map<string, string>();
  for (const page of sitePages) {
    if (keys.has(page.key)) continue;
    const pattern = urlPattern(page.url);
    keys.set(page.key, pattern);
    onSite.set(pattern, (onSite.get(pattern) ?? 0) + 1);
  }
  const sampled = new Map<string, number>();
  let notInSitemap = 0;
  const seen = new Set<string>();
  for (const page of runPages) {
    if (seen.has(page.key)) continue;
    seen.add(page.key);
    const pattern = keys.get(page.key);
    if (pattern === undefined) notInSitemap += 1;
    else sampled.set(pattern, (sampled.get(pattern) ?? 0) + 1);
  }
  const groups = [...onSite]
    .map(([pattern, count]) => ({ pattern, onSite: count, sampled: sampled.get(pattern) ?? 0 }))
    .sort(
      (a, b) => b.onSite - a.onSite || (a.pattern < b.pattern ? -1 : a.pattern > b.pattern ? 1 : 0),
    );
  return { sitemap, sitePages: keys.size, groups, notInSitemap };
}
