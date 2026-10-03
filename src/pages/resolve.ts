import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { InvalidEntry, PageRef, PageSource, SkippedRecord, SourceDetails } from "../model.js";
import { MAX_WALKTHROUGH_BYTES, parseWalkthrough, type Walkthrough } from "../share/walkthrough.js";
import { UsageError } from "../util/errors.js";
import { assertNotRewritten, resolveUserPath } from "../util/git-bash.js";
import { sha256 } from "../util/hash.js";
import type { Logger } from "../util/log.js";
import { applyFilters } from "./filter.js";
import { readPageList } from "./page-list.js";
import { fetchSitemap } from "./sitemap.js";
import { pageSlug } from "./slug.js";
import {
  canonicalKey,
  hasScheme,
  nonHtmlExtension,
  resolvePageUrl,
  resolveSitemapUrl,
  sameOrigin,
  startsWithHost,
} from "./url.js";

/** A walkthrough file as a repeat reads it: read once, as bytes, then parsed. */
export interface WalkthroughFile {
  /** The file's path as recorded, as a page list's is: relative to cwd when inside it. */
  file: string;
  /** The SHA-256 of the file's bytes as read. */
  sha256: string;
  parsed: Walkthrough;
}

export interface ResolvePagesOptions {
  /** The site's origin (see parseSiteUrl). */
  site: URL;
  /**
   * Exactly one of sitemap, pagesFile, pageUrls, and walkthrough. The sitemap is its full URL, or a
   * name or path on the site, from its root (see resolveSitemapUrl).
   */
  sitemap?: string;
  pagesFile?: string;
  /** --page, one or more times: full URLs or paths, resolved against site. */
  pageUrls?: readonly string[];
  /**
   * --walkthrough: the file, already read and parsed (see readWalkthroughFile). The pages are the
   * file's, in its order, with their labels, templates, and notes.
   */
  walkthrough?: WalkthroughFile;
  include?: readonly string[];
  exclude?: readonly string[];
  limit?: number | null;
  /** Base for a relative pagesFile, and for how its path is recorded. Default process.cwd(). */
  cwd?: string;
  fetch?: typeof fetch;
  logger?: Logger;
}

export type ResolvedPage = PageRef & { line?: number };

export interface ResolvedPages {
  pageSource: PageSource;
  source: SourceDetails;
  pages: ResolvedPage[];
  /** URLs skipped before the run: off-origin and non-HTML extensions. */
  skipped: SkippedRecord[];
}

/** How many examples to print per kind of skipped or invalid URL. */
const EXAMPLES = 3;

/**
 * Read a walkthrough file for a repeat. A UsageError refuses a file that's over
 * MAX_WALKTHROUGH_BYTES (without reading it: a walkthrough file may come from anyone, and parsing a
 * hostile one takes seconds), one that can't be read, and one that isn't a walkthrough file (see
 * parseWalkthrough). The file is read once, as bytes: their SHA-256 is what the repeat's page source
 * keeps, and then they're parsed. `file` is as the person gave it, resolved against `cwd`; it's
 * named that way in a refusal, and recorded as a page list's file is.
 */
export async function readWalkthroughFile(file: string, cwd: string): Promise<WalkthroughFile> {
  const absolute = resolveUserPath(cwd, file);
  const { size } = await readable(file, () => stat(absolute));
  if (size > MAX_WALKTHROUGH_BYTES) {
    throw new UsageError(
      `${file} is larger than 8 MB, larger than any walkthrough file voicecap writes.`,
    );
  }
  const bytes = await readable(file, () => readFile(absolute));
  // A byte order mark stays in the text: parseWalkthrough is the one place that reads past it.
  const parsed = parseWalkthrough(bytes.toString("utf8"), file);
  return { file: recordedPath(cwd, absolute), sha256: sha256(bytes), parsed };
}

/** What `read` gives, or a UsageError that says the walkthrough file `file` couldn't be read. */
async function readable<T>(file: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    throw new UsageError(`Can't read the walkthrough file ${file}: ${(error as Error).message}`, {
      cause: error,
    });
  }
}

/**
 * The page source of a repeat: the walkthrough file, the run it was made from, and what that run's
 * pages came from. A walkthrough of a repeat says what the pages it repeated came from, so `from`
 * never names a walkthrough, and a repeat of a --page spot check is a spot check too.
 */
function walkthroughSource(walkthrough: WalkthroughFile): PageSource {
  const { run, source } = walkthrough.parsed.original;
  return {
    kind: "walkthrough",
    file: walkthrough.file,
    sha256: walkthrough.sha256,
    run,
    from: source.kind === "walkthrough" ? source.from : source.kind,
  };
}

/**
 * Identify a page source without fetching anything, for the resume check. A sitemap is its full
 * URL, however it was given (a name or path is read on site, from its root, as resolvePages reads
 * it); a page list is its path (relative to cwd, with forward slashes, when inside cwd) plus the
 * SHA-256 of its contents; --page values are their resolved URLs; a walkthrough is its file,
 * SHA-256, and run, from the file as already read. site is required for --page values and for a
 * sitemap given as a name or path.
 */
export async function pageSourceFor(options: {
  sitemap?: string;
  pagesFile?: string;
  pageUrls?: readonly string[];
  walkthrough?: WalkthroughFile;
  site?: URL;
  cwd?: string;
}): Promise<PageSource> {
  const { sitemap, pagesFile, pageUrls, walkthrough } = requireOneSource(options);
  if (walkthrough !== undefined) return walkthroughSource(walkthrough);
  if (sitemap !== undefined) {
    return { kind: "sitemap", url: parseSitemapUrl(sitemap, options.site) };
  }
  if (pageUrls !== undefined) {
    return { kind: "urls", urls: resolvePageUrlOption(pageUrls, options.site!) };
  }
  const cwd = options.cwd ?? process.cwd();
  const absolute = resolveUserPath(cwd, pagesFile!);
  let bytes: Uint8Array;
  try {
    bytes = await readFile(absolute);
  } catch (error) {
    throw new UsageError(`Can't read the page list ${pagesFile}: ${(error as Error).message}`, {
      cause: error,
    });
  }
  return { kind: "pages", file: recordedPath(cwd, absolute), sha256: sha256(bytes) };
}

/**
 * Build a run's page list: read the source, resolve each entry against the site, drop fragments
 * and duplicates (keeping the form listed first), skip other origins and non-HTML extensions,
 * then apply --include, --exclude, and --limit, in that order. A walkthrough's pages are its
 * file's, in its order, and go through the same steps.
 */
export async function resolvePages(options: ResolvePagesOptions): Promise<ResolvedPages> {
  const { sitemap, pagesFile, pageUrls, walkthrough } = requireOneSource(options);
  const cwd = options.cwd ?? process.cwd();
  const logger = options.logger;
  const site = options.site;

  let pageSource: PageSource;
  let source: SourceDetails;
  let entries: {
    value: string;
    line: number | null;
    label?: string;
    template?: string;
    notes?: string;
  }[];
  const invalid: InvalidEntry[] = [];

  if (sitemap !== undefined) {
    const url = parseSitemapUrl(sitemap, site);
    const result = await fetchSitemap(url, {
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(logger ? { logger } : {}),
    });
    pageSource = { kind: "sitemap", url };
    entries = result.urls.map((item) => ({ value: item.loc, line: null }));
    source = baseDetails("sitemap", entries.length, result.warnings);
    source.sitemaps = result.documents;
  } else if (pagesFile !== undefined) {
    const absolute = resolveUserPath(cwd, pagesFile);
    const list = await readPageList(absolute);
    const file = recordedPath(cwd, absolute);
    pageSource = { kind: "pages", file, sha256: list.sha256 };
    entries = list.entries;
    invalid.push(...list.invalid);
    source = baseDetails("pages", list.entries.length + list.invalid.length, list.warnings);
    source.file = file;
    source.sha256 = list.sha256;
    source.format = list.format;
    source.encoding = list.encoding;
    for (const warning of list.warnings) logger?.warn(warning);
  } else if (walkthrough !== undefined) {
    pageSource = walkthroughSource(walkthrough);
    entries = walkthrough.parsed.pages.map((page) => ({
      value: page.url,
      line: null,
      label: page.label,
      template: page.template,
      notes: page.notes,
    }));
    source = baseDetails("walkthrough", entries.length, []);
    source.file = walkthrough.file;
    source.sha256 = walkthrough.sha256;
  } else {
    const urls = resolvePageUrlOption(pageUrls!, site);
    pageSource = { kind: "urls", urls };
    entries = urls.map((value) => ({ value, line: null }));
    source = baseDetails("urls", urls.length, []);
  }

  // Resolve, then dedupe by canonical URL, keeping the form listed first.
  const byKey = new Map<string, ResolvedPage & { parsed: URL }>();
  const duplicateLines: (number | null)[] = [];
  for (const entry of entries) {
    const url = resolvePageUrl(entry.value, site);
    if (!url) {
      invalid.push({
        line: entry.line,
        value: entry.value,
        reason: "not an http(s) URL or a root-relative path",
      });
      continue;
    }
    const key = canonicalKey(url);
    if (byKey.has(key)) {
      duplicateLines.push(entry.line);
      continue;
    }
    const page: ResolvedPage & { parsed: URL } = { url: url.href, key, slug: "", parsed: url };
    if (entry.line !== null) page.line = entry.line;
    if (entry.label !== undefined) page.label = entry.label;
    if (entry.template !== undefined) page.template = entry.template;
    if (entry.notes !== undefined) page.notes = entry.notes;
    byKey.set(key, page);
  }
  source.invalid = invalid;
  source.duplicates = duplicateLines.length;
  // A list that may be made or edited by hand says it, with its lines where it has them.
  if (duplicateLines.length > 0 && (source.kind === "pages" || source.kind === "walkthrough")) {
    const lines = duplicateLines.filter((line): line is number => line !== null);
    const message =
      `Ignored ${duplicateLines.length} duplicate entr${duplicateLines.length === 1 ? "y" : "ies"}` +
      (lines.length > 0 ? ` (line${lines.length === 1 ? "" : "s"} ${lines.join(", ")})` : "") +
      "; the first listing of each page is used.";
    source.warnings.push(message);
    logger?.warn(message);
  }

  const skipped: SkippedRecord[] = [];
  const candidates: (ResolvedPage & { parsed: URL })[] = [];
  let offOrigin = 0;
  for (const page of byKey.values()) {
    const record = (reason: SkippedRecord["reason"]): SkippedRecord =>
      page.line !== undefined
        ? { url: page.url, reason, line: page.line }
        : { url: page.url, reason };
    if (!sameOrigin(page.parsed, site)) {
      offOrigin += 1;
      skipped.push(record("off-origin"));
    } else if (nonHtmlExtension(page.parsed) !== null) {
      skipped.push(record("non-html-extension"));
    } else {
      candidates.push(page);
    }
  }

  const filtered = applyFilters(candidates, {
    ...(options.include ? { include: options.include } : {}),
    ...(options.exclude ? { exclude: options.exclude } : {}),
    limit: options.limit ?? null,
  });
  source.excludedByFilter = filtered.excludedByFilter;
  source.excludedByLimit = filtered.excludedByLimit;

  const slugOwners = new Map<string, string>();
  const pages: ResolvedPage[] = filtered.kept.map(({ parsed: _parsed, ...page }) => {
    const slug = pageSlug(page.key);
    const owner = slugOwners.get(slug);
    if (owner !== undefined && owner !== page.key) {
      // A page's name is its path and ten hex digits of a fingerprint of its address, so two
      // addresses can share one: a person who makes a page list or a walkthrough file can make a
      // pair on purpose. The name is never changed, since a run's folders are found by it.
      throw new UsageError(
        `${owner} and ${page.key} would be saved under the same name ("${slug}"), so voicecap can't read both in one run.`,
      );
    }
    slugOwners.set(slug, page.key);
    return { ...page, slug };
  });

  const valid = byKey.size;
  if (valid > 0 && offOrigin > valid / 2) {
    const origins = countBy(
      skipped.filter((s) => s.reason === "off-origin"),
      (s) => new URL(s.url).origin,
    );
    const message =
      `${offOrigin} of ${valid} URLs in ${describeSource(pageSource)} are not on ${site.origin} and were skipped ` +
      `(found: ${origins.map(([origin, n]) => `${origin} ×${n}`).join(", ")}). ` +
      `Sitemaps that list http:// or www. variants of the site are a common misconfiguration: ` +
      `check that --site matches the URLs in the source.`;
    source.warnings.push(message);
    logger?.alert(message);
  }

  if (logger) logSummary(logger, site, pages.length, skipped, invalid, source);
  return { pageSource, source, pages, skipped };
}

function requireOneSource(options: {
  sitemap?: string | undefined;
  pagesFile?: string | undefined;
  pageUrls?: readonly string[] | undefined;
  walkthrough?: WalkthroughFile | undefined;
}): {
  sitemap?: string;
  pagesFile?: string;
  pageUrls?: readonly string[];
  walkthrough?: WalkthroughFile;
} {
  const hasSitemap = options.sitemap !== undefined && options.sitemap !== "";
  const hasPages = options.pagesFile !== undefined && options.pagesFile !== "";
  const hasPageUrls = options.pageUrls !== undefined && options.pageUrls.length > 0;
  const hasWalkthrough = options.walkthrough !== undefined;
  const count = [hasSitemap, hasPages, hasPageUrls, hasWalkthrough].filter(Boolean).length;
  if (count === 0) {
    throw new UsageError("Give a page source: --sitemap <url>, --pages <file>, or --page <url>.");
  }
  if (count > 1) {
    throw new UsageError(
      hasWalkthrough
        ? "Use one kind of page source: --walkthrough, --sitemap, --pages, or --page, not a mix."
        : "Use one kind of page source: --sitemap, --pages, or --page, not a mix.",
    );
  }
  if (hasWalkthrough) return { walkthrough: options.walkthrough! };
  if (hasSitemap) return { sitemap: options.sitemap! };
  if (hasPages) return { pagesFile: options.pagesFile! };
  return { pageUrls: options.pageUrls! };
}

/**
 * Resolve --page's values against the site into absolute URLs, fragment dropped, in the order
 * given. Rejects a value Git Bash rewrote into a Windows path, or one that isn't a page URL or a
 * root-relative path.
 */
function resolvePageUrlOption(values: readonly string[], site: URL): string[] {
  return values.map((value) => {
    assertNotRewritten("--page", value);
    const url = resolvePageUrl(value, site);
    if (!url) throw new UsageError(`--page "${value}" isn't a page URL or a path like /faq/.`);
    return url.href;
  });
}

/**
 * --sitemap's full URL: the value itself, or a name or path on `site`, from its root (see
 * resolveSitemapUrl). Rejects, before anything is fetched: a value Git Bash rewrote into a Windows
 * path; an address written without https:// (`dvfr.illinois.gov/sitemap.xml`), which would
 * otherwise be read as a path on the site; a name or path with no site to read it on; and anything
 * else that isn't a sitemap's address.
 */
function parseSitemapUrl(input: string, site: URL | undefined): string {
  assertNotRewritten("--sitemap", input);
  const value = input.trim();
  if (startsWithHost(value)) {
    throw new UsageError(
      `--sitemap "${value}" looks like an address without https://: give its full URL (https://${value}), or just its name on --site, such as sitemap.xml.`,
    );
  }
  const url = resolveSitemapUrl(input, site);
  if (url) return url.href;
  if (site === undefined && input.trim() !== "" && !hasScheme(input)) {
    throw new UsageError(
      `--sitemap "${input}" is read relative to --site, and there's no --site: give --site, or the sitemap's full URL, such as https://dvfr.illinois.gov/sitemap.xml.`,
    );
  }
  throw new UsageError(
    `--sitemap must be a full URL such as https://dvfr.illinois.gov/sitemap.xml, or a name or path on --site such as sitemap.xml (got "${input}").`,
  );
}

/** A page list's path as recorded: relative to cwd with forward slashes if inside it. */
function recordedPath(cwd: string, absolute: string): string {
  const relative = path.relative(cwd, absolute);
  if (relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.split(path.sep).join("/");
  }
  return absolute;
}

function baseDetails(
  kind: SourceDetails["kind"],
  listed: number,
  warnings: string[],
): SourceDetails {
  return {
    kind,
    listed,
    duplicates: 0,
    invalid: [],
    excludedByFilter: 0,
    excludedByLimit: 0,
    warnings: [...warnings],
  };
}

/** Where the pages came from, in a sentence: "the page list pages.csv". */
export function describeSource(source: PageSource): string {
  switch (source.kind) {
    case "sitemap":
      return `the sitemap ${source.url}`;
    case "pages":
      return `the page list ${source.file}`;
    case "walkthrough":
      return `the walkthrough ${source.file} from run ${source.run}`;
    case "urls":
      return "the pages given with --page";
    default: {
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}

function logSummary(
  logger: Logger,
  site: URL,
  kept: number,
  skipped: SkippedRecord[],
  invalid: InvalidEntry[],
  source: SourceDetails,
): void {
  for (const entry of invalid.slice(0, 10)) {
    const where = entry.line !== null ? `line ${entry.line}: ` : "";
    logger.warn(`Ignored an invalid entry (${where}${entry.reason}): ${entry.value}`);
  }
  if (invalid.length > 10) logger.warn(`...and ${invalid.length - 10} more invalid entries.`);

  const describe: Record<SkippedRecord["reason"], string> = {
    "off-origin": `not on ${site.origin}`,
    "non-html-extension": "not HTML pages (by file extension)",
    "non-html-response": "not HTML responses",
    "redirect-off-origin": "redirected to another origin",
  };
  for (const [reason, records] of groupBy(skipped, (s) => s.reason)) {
    const examples = records
      .slice(0, EXAMPLES)
      .map((s) => s.url)
      .join(", ");
    const more = records.length > EXAMPLES ? `, and ${records.length - EXAMPLES} more` : "";
    logger.info(
      `Skipped ${records.length} URL${records.length === 1 ? "" : "s"} ${describe[reason]}: ${examples}${more}`,
    );
  }
  const filteredOut = source.excludedByFilter + source.excludedByLimit;
  logger.info(
    `${kept} page${kept === 1 ? "" : "s"} to transcribe` +
      (source.duplicates > 0
        ? `, ${source.duplicates} duplicate${source.duplicates === 1 ? "" : "s"} ignored`
        : "") +
      (filteredOut > 0
        ? `, ${source.excludedByFilter} left out by --include/--exclude, ${source.excludedByLimit} by --limit`
        : "") +
      ".",
  );
}

function groupBy<T, K>(items: readonly T[], keyOf: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

function countBy<T>(items: readonly T[], keyOf: (item: T) => string): [string, number][] {
  return [...groupBy(items, keyOf)].map(([key, group]) => [key, group.length]);
}
