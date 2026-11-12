/**
 * What the report says of its pages as a sample of the site, for a report whose latest run was
 * given `--sample-of` (its `sample` record): the sitemap they were chosen from, how many pages it
 * lists, and each type of page, with how many the site has and how many are in the report. A type
 * is its URL path pattern ("/news/*"), named, when the page list gave each of its pages in the run
 * the same template ("News post"), by that name too. The page, its Word copy, and the report for AI
 * tools all write it from here, so they say the same thing. Pure.
 */
import type { RunJson } from "../model.js";
import { urlPattern } from "../pages/sample.js";

/** One type of page: its name from the page list, when it gave one, its pattern, and its counts. */
export interface SampleType {
  name: string | null;
  pattern: string;
  onSite: number;
  sampled: number;
}

export interface SampleView {
  /** The sitemap, as the page shows an address (`Shown`). */
  sitemap: string;
  /** The pages the sitemap lists. */
  sitePages: number;
  /** The run's pages the sitemap lists, and those it doesn't. */
  listed: number;
  notInSitemap: number;
  types: SampleType[];
}

/**
 * The sample view of the latest run, or null when it isn't a sample (or there's no run). `shown`
 * gives the sitemap's address as the page shows addresses; `redact` takes the home folder out of a
 * template, which a person wrote in the page list.
 */
export function sampleViewOf(
  latest: RunJson | null,
  shown: (url: string) => string,
  redact: (text: string) => string,
): SampleView | null {
  const sample = latest?.sample;
  if (latest === null || latest === undefined || sample === undefined) return null;
  const templates = new Map<string, Set<string>>();
  for (const page of latest.pages) {
    let pattern: string;
    try {
      pattern = urlPattern(page.url);
    } catch {
      continue;
    }
    const names = templates.get(pattern) ?? new Set<string>();
    names.add((page.template ?? "").trim());
    templates.set(pattern, names);
  }
  const nameOf = (pattern: string): string | null => {
    const names = templates.get(pattern);
    if (names === undefined || names.size !== 1) return null;
    const [name] = [...names];
    return name === undefined || name === "" ? null : redact(name);
  };
  const listed = sample.groups.reduce((sum, group) => sum + group.sampled, 0);
  return {
    sitemap: shown(sample.sitemap),
    sitePages: sample.sitePages,
    listed,
    notInSitemap: sample.notInSitemap,
    types: sample.groups.map((group) => ({ name: nameOf(group.pattern), ...group })),
  };
}

/** A type's name as a reader sees it: "News post (/news/*)", or its pattern alone. */
export function sampleTypeName(type: SampleType): string {
  return type.name === null ? type.pattern : `${type.name} (${type.pattern})`;
}
